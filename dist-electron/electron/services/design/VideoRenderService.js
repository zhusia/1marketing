"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoRenderService = exports.VideoRenderService = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const id_1 = require("../../utils/id");
/**
 * "HyperFrames" — turns an animated design HTML document into an MP4. The same
 * Chromium the app ships renders the page offscreen; we deterministically seek a
 * paused Web-Animations timeline (`window.__odSeek(ms)`) one frame at a time,
 * capture each frame as PNG, then mux them with FFmpeg. No browser MediaRecorder,
 * no remote services. Inspired by open-design's HyperFrames pipeline.
 */
class VideoRenderService {
    ffmpegPathCache = null;
    scavenged = false;
    /** System FFmpeg (smaller footprint when present) first, else the bundled binary. */
    resolveFfmpegPath() {
        if (this.ffmpegPathCache)
            return this.ffmpegPathCache;
        const onPath = (0, child_process_1.spawnSync)('ffmpeg', ['-version'], { stdio: 'ignore' });
        if (!onPath.error && onPath.status === 0) {
            this.ffmpegPathCache = 'ffmpeg';
            return this.ffmpegPathCache;
        }
        // Bundled @ffmpeg-installer binary. When packaged it lives in the unpacked asar.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const installer = require('@ffmpeg-installer/ffmpeg');
        const bundled = installer.path.replace('app.asar', 'app.asar.unpacked');
        if (!fs_1.default.existsSync(bundled)) {
            throw new Error('FFmpeg is unavailable. Install FFmpeg or reinstall the app to restore the bundled binary.');
        }
        this.ffmpegPathCache = bundled;
        return this.ffmpegPathCache;
    }
    tempRoot() {
        const base = electron_1.app.isReady() ? electron_1.app.getPath('userData') : os_1.default.tmpdir();
        const parent = path_1.default.join(base, '.design-video');
        if (!this.scavenged) {
            this.scavenged = true;
            void this.scavenge(parent);
        }
        const root = path_1.default.join(parent, (0, id_1.createId)());
        fs_1.default.mkdirSync(root, { recursive: true });
        return root;
    }
    async scavenge(parent) {
        const entries = await fs_1.default.promises.readdir(parent, { withFileTypes: true }).catch(() => []);
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        await Promise.all(entries.map(async (entry) => {
            if (!entry.isDirectory())
                return;
            const target = path_1.default.join(parent, entry.name);
            const stat = await fs_1.default.promises.stat(target).catch(() => null);
            if (stat && stat.mtimeMs < cutoff) {
                await fs_1.default.promises.rm(target, { recursive: true, force: true }).catch(() => undefined);
            }
        }));
    }
    async renderHtmlToMp4(html, options) {
        const { width, height } = options;
        const fps = Math.max(12, Math.min(60, options.fps ?? 30));
        const durationMs = Math.max(1000, Math.min(15000, options.durationMs ?? 4000));
        const frameCount = Math.max(1, Math.round((durationMs / 1000) * fps));
        const ffmpeg = this.resolveFfmpegPath();
        const dir = this.tempRoot();
        const win = new electron_1.BrowserWindow({
            width,
            height,
            useContentSize: true,
            show: false,
            frame: false,
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                backgroundThrottling: false,
            },
        });
        const abortWindow = () => {
            if (!win.isDestroyed())
                win.destroy();
        };
        options.signal?.addEventListener('abort', abortWindow, { once: true });
        const htmlFile = path_1.default.join(dir, 'scene.html');
        try {
            throwIfAborted(options.signal);
            await fs_1.default.promises.writeFile(htmlFile, html, 'utf8');
            await win.loadFile(htmlFile);
            await win.webContents
                .executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
                .catch(() => undefined);
            options.onProgress?.(`Capturing ${frameCount} frames…`);
            for (let i = 0; i < frameCount; i += 1) {
                throwIfAborted(options.signal);
                const t = frameCount === 1 ? 0 : (i / (frameCount - 1)) * durationMs;
                await win.webContents
                    .executeJavaScript(`window.__odSeek && window.__odSeek(${t.toFixed(2)}); true`)
                    .catch(() => undefined);
                // A short beat lets the compositor flush the seeked frame before capture.
                await delay(16);
                let image = await win.webContents.capturePage();
                const size = image.getSize();
                if (size.width !== width || size.height !== height) {
                    image = image.resize({ width, height, quality: 'best' });
                }
                await fs_1.default.promises.writeFile(path_1.default.join(dir, `frame-${String(i).padStart(5, '0')}.png`), image.toPNG());
            }
            options.onProgress?.('Encoding MP4…');
            const outFile = path_1.default.join(dir, 'out.mp4');
            await this.encode(ffmpeg, dir, outFile, fps, options.signal);
            throwIfAborted(options.signal);
            return await fs_1.default.promises.readFile(outFile);
        }
        finally {
            options.signal?.removeEventListener('abort', abortWindow);
            if (!win.isDestroyed())
                win.destroy();
            await fs_1.default.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    encode(ffmpeg, dir, outFile, fps, signal) {
        // yuv420p (broad player support) needs even dimensions — force them with a scale pad.
        // Pin codec/profile/rate/timebase explicitly so every clip is byte-compatible for the
        // FFmpeg `concat -c copy` fast path used when composing multi-scene storyboards.
        const args = [
            '-y',
            '-framerate', String(fps),
            '-i', path_1.default.join(dir, 'frame-%05d.png'),
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
            '-r', String(fps),
            '-c:v', 'libx264',
            '-profile:v', 'high',
            '-level', '4.0',
            '-pix_fmt', 'yuv420p',
            '-video_track_timescale', String(fps * 1000),
            '-movflags', '+faststart',
            outFile,
        ];
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
            const abort = () => child.kill('SIGKILL');
            signal?.addEventListener('abort', abort, { once: true });
            let stderr = '';
            child.stderr.on('data', (chunk) => {
                stderr += String(chunk);
                if (stderr.length > 8000)
                    stderr = stderr.slice(-8000);
            });
            child.on('error', (error) => {
                signal?.removeEventListener('abort', abort);
                reject(error);
            });
            child.on('close', (code) => {
                signal?.removeEventListener('abort', abort);
                if (signal?.aborted)
                    reject(new Error('Video render canceled.'));
                else if (code === 0)
                    resolve();
                else
                    reject(new Error(`FFmpeg exited with code ${code}.\n${stderr.trim()}`));
            });
        });
    }
}
exports.VideoRenderService = VideoRenderService;
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw new Error('Video render canceled.');
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.videoRenderService = new VideoRenderService();
//# sourceMappingURL=VideoRenderService.js.map