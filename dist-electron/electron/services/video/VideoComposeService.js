"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoComposeService = exports.VideoComposeService = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const electron_1 = require("electron");
const id_1 = require("../../utils/id");
const VideoRenderService_1 = require("../design/VideoRenderService");
const templates_1 = require("../design/templates");
const storyboard_1 = require("./storyboard");
const MP4_FILE_TYPE = Buffer.from('ftyp', 'ascii');
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function assTime(ms) {
    const centiseconds = Math.max(0, Math.round(ms / 10));
    const hours = Math.floor(centiseconds / 360000);
    const minutes = Math.floor((centiseconds % 360000) / 6000);
    const seconds = Math.floor((centiseconds % 6000) / 100);
    const cs = centiseconds % 100;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
function escapeAssText(value) {
    return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\N').replace(/[{}]/g, '');
}
function filterPath(filePath) {
    return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
class VideoComposeService {
    scavenged = false;
    tempRoot() {
        const base = electron_1.app.isReady() ? electron_1.app.getPath('userData') : os_1.default.tmpdir();
        const parent = path_1.default.join(base, '.video-compose');
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
    async compose(options) {
        if (!options.storyboard.scenes.length)
            throw new Error('The storyboard has no scenes.');
        if (options.clips.length !== options.storyboard.scenes.length)
            throw new Error('Every scene needs a rendered clip before compose.');
        const clipsById = new Map(options.clips.map((clip) => [clip.sceneId, clip.asset]));
        const clipPaths = options.storyboard.scenes.map((scene) => {
            const asset = clipsById.get(scene.id);
            if (asset && !asset.mimeType.startsWith('video/')) {
                throw new Error(`Rendered clip for scene ${scene.id} is not a video asset.`);
            }
            if (!asset?.localPath || !fs_1.default.existsSync(asset.localPath))
                throw new Error(`Rendered clip is missing for scene ${scene.id}.`);
            return asset.localPath;
        });
        const ffmpeg = VideoRenderService_1.videoRenderService.resolveFfmpegPath();
        const dir = this.tempRoot();
        const bodyFile = path_1.default.join(dir, 'body.mp4');
        const captionedFile = path_1.default.join(dir, 'captioned.mp4');
        try {
            throwIfAborted(options.signal);
            options.onProgress?.('Composing scene clips…');
            await this.composeBody(ffmpeg, clipPaths, options.storyboard, bodyFile, dir, options.signal);
            let finalFile = bodyFile;
            const composeWarnings = [];
            if (options.wantsCaptions && options.storyboard.scenes.some((scene) => scene.captions?.length)) {
                options.onProgress?.('Burning captions…');
                try {
                    const assFile = path_1.default.join(dir, 'captions.ass');
                    await fs_1.default.promises.writeFile(assFile, this.buildAss(options.storyboard), 'utf8');
                    await this.run(ffmpeg, [
                        '-y', '-i', bodyFile,
                        '-vf', `subtitles='${filterPath(assFile)}'`,
                        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(options.storyboard.fps),
                        '-an', '-movflags', '+faststart', captionedFile,
                    ], options.signal);
                    finalFile = captionedFile;
                }
                catch (error) {
                    // A packaged ffmpeg build without libass would otherwise fail the whole compose.
                    // Degrade to an uncaptioned export and surface it as a review warning instead.
                    if (options.signal?.aborted)
                        throw error;
                    composeWarnings.push('Caption burn-in is unavailable on this platform; exported without burned-in captions.');
                    options.onProgress?.('Caption burn-in failed; exporting without captions.');
                    finalFile = bodyFile;
                }
            }
            throwIfAborted(options.signal);
            options.onProgress?.('Reviewing final render…');
            const review = await this.review(ffmpeg, finalFile, options.storyboard, options.wantsAudio, options.signal);
            if (composeWarnings.length)
                review.warnings = Array.from(new Set([...composeWarnings, ...review.warnings]));
            const bytes = await fs_1.default.promises.readFile(finalFile);
            this.assertPlayableMp4(bytes, review);
            return { bytes, review };
        }
        finally {
            await fs_1.default.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    /**
     * Never let an empty/invalid compose masquerade as campaign media. This is the
     * final boundary before VideoOrchestratorService persists the bytes as an MP4.
     */
    assertPlayableMp4(bytes, review) {
        const fileTypeOffset = bytes.indexOf(MP4_FILE_TYPE, 0);
        if (bytes.length < 32 || fileTypeOffset < 4 || fileTypeOffset > 32) {
            throw new Error('Video compose did not produce a valid MP4 file.');
        }
        if (!review.passed) {
            const detail = review.warnings.length ? ` ${review.warnings.join(' ')}` : '';
            throw new Error(`Video compose failed technical review.${detail}`);
        }
    }
    async composeBody(ffmpeg, clipPaths, storyboard, outFile, dir, signal) {
        if (clipPaths.length === 1) {
            await this.run(ffmpeg, ['-y', '-i', clipPaths[0], '-c', 'copy', '-movflags', '+faststart', outFile], signal);
            return;
        }
        const hasTransitions = storyboard.scenes.slice(1).some((scene) => scene.transitionIn?.type !== 'cut');
        if (!hasTransitions) {
            const listFile = path_1.default.join(dir, 'clips.txt');
            const list = clipPaths.map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`).join('\n');
            await fs_1.default.promises.writeFile(listFile, `${list}\n`, 'utf8');
            await this.run(ffmpeg, [
                '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
                '-c', 'copy', '-movflags', '+faststart', outFile,
            ], signal);
            return;
        }
        const timeline = (0, storyboard_1.calculateVideoTimeline)(storyboard);
        const args = ['-y', ...clipPaths.flatMap((clipPath) => ['-i', clipPath])];
        const filters = [];
        let previous = '[0:v]';
        for (let index = 1; index < storyboard.scenes.length; index += 1) {
            const scene = storyboard.scenes[index];
            const timelineScene = timeline.scenes[index];
            const duration = Math.max(1 / storyboard.fps, timelineScene.overlapFrames / storyboard.fps);
            const offset = timelineScene.startFrame / storyboard.fps;
            const transition = scene.transitionIn?.type === 'slide' ? 'slideleft' : 'fade';
            const output = `[v${index}]`;
            filters.push(`${previous}[${index}:v]xfade=transition=${transition}:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${output}`);
            previous = output;
        }
        args.push('-filter_complex', filters.join(';'), '-map', previous, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(storyboard.fps), '-an', '-movflags', '+faststart', outFile);
        await this.run(ffmpeg, args, signal);
    }
    buildAss(storyboard) {
        const info = (0, templates_1.formatInfo)(storyboard.format);
        const timeline = (0, storyboard_1.calculateVideoTimeline)(storyboard);
        const events = [];
        storyboard.scenes.forEach((scene, index) => {
            const startMs = Math.round((timeline.scenes[index].startFrame / storyboard.fps) * 1000);
            for (const caption of scene.captions ?? []) {
                events.push(`Dialogue: 0,${assTime(startMs + caption.startMs)},${assTime(startMs + caption.endMs)},Default,,0,0,0,,${escapeAssText(caption.text)}`);
            }
        });
        return [
            '[Script Info]',
            'ScriptType: v4.00+',
            `PlayResX: ${info.width}`,
            `PlayResY: ${info.height}`,
            'WrapStyle: 2',
            '',
            '[V4+ Styles]',
            'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
            `Style: Default,Arial,${Math.round(info.width * 0.045)},&H00FFFFFF,&H000000FF,&H99000000,&H99000000,-1,0,0,0,100,100,0,0,3,1,0,2,${Math.round(info.width * 0.06)},${Math.round(info.width * 0.06)},${Math.round(info.height * 0.07)},1`,
            '',
            '[Events]',
            'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
            ...events,
            '',
        ].join('\n');
    }
    async review(ffmpeg, filePath, storyboard, wantsAudio, signal) {
        const inspection = await this.run(ffmpeg, ['-hide_banner', '-i', filePath, '-f', 'null', '-'], signal);
        const durationMatch = inspection.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        const durationMs = durationMatch
            ? Math.round((Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])) * 1000)
            : null;
        const videoLine = inspection.stderr.split('\n').find((line) => line.includes('Video:')) ?? '';
        const dimensions = videoLine.match(/(\d{2,5})x(\d{2,5})/);
        const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/);
        const width = dimensions ? Number(dimensions[1]) : null;
        const height = dimensions ? Number(dimensions[2]) : null;
        const fps = fpsMatch ? Number(fpsMatch[1]) : null;
        const hasAudio = inspection.stderr.split('\n').some((line) => line.includes('Audio:'));
        const samples = await this.run(ffmpeg, [
            '-loglevel', 'error', '-i', filePath,
            '-vf', 'fps=1,scale=32:32,format=gray', '-frames:v', '20', '-f', 'rawvideo', '-'
        ], signal);
        const frameSize = 32 * 32;
        const frameCount = Math.floor(samples.stdout.length / frameSize);
        let brightness = 0;
        let delta = 0;
        for (let frame = 0; frame < frameCount; frame += 1) {
            const start = frame * frameSize;
            for (let pixel = 0; pixel < frameSize; pixel += 1) {
                const value = samples.stdout[start + pixel];
                brightness += value;
                if (frame > 0)
                    delta += Math.abs(value - samples.stdout[start - frameSize + pixel]);
            }
        }
        const averageBrightness = frameCount ? brightness / (frameCount * frameSize) : 0;
        const averageDelta = frameCount > 1 ? delta / ((frameCount - 1) * frameSize) : 0;
        const slideshowRisk = Number(clamp(1 - averageDelta / 12, 0, 1).toFixed(2));
        const warnings = [];
        const expected = storyboard.totalDurationMs;
        if (durationMs === null)
            warnings.push('FFmpeg could not determine the final duration.');
        else if (Math.abs(durationMs - expected) > Math.max(250, 1000 / storyboard.fps * 3)) {
            warnings.push(`Final duration is ${durationMs}ms; the storyboard expects ${expected}ms.`);
        }
        if (!width || !height)
            warnings.push('The final video dimensions could not be verified.');
        if (fps && Math.abs(fps - storyboard.fps) > 0.5)
            warnings.push(`Final frame rate is ${fps}; expected ${storyboard.fps}.`);
        if (wantsAudio && !hasAudio)
            warnings.push('Audio was requested, but the final file has no audio track.');
        if (averageBrightness < 2)
            warnings.push('The sampled output appears black or nearly black.');
        if (slideshowRisk >= 0.78 && storyboard.totalDurationMs >= 6000)
            warnings.push('Low frame-to-frame motion suggests slideshow risk.');
        if (storyboard.scenes.some((scene) => scene.role === 'cta' && !scene.spec.inputs.cta.trim())) {
            warnings.push('A CTA scene has no CTA copy.');
        }
        for (const scene of storyboard.scenes) {
            // Narration only matters once audio is actually produced (TTS is not wired yet), so
            // don't warn about scripts that will never be spoken.
            if (wantsAudio && (scene.narration?.trim().split(/\s+/).length ?? 0) > Math.ceil((scene.durationMs / 1000) * 3.2)) {
                warnings.push(`Narration may not fit in scene ${scene.id}.`);
            }
            if ((scene.captions ?? []).some((caption) => caption.text.length > 120)) {
                warnings.push(`A caption in scene ${scene.id} may be too long for the frame.`);
            }
        }
        // Missing audio is only a soft warning: v1 never produces an audio track, so it must not
        // hard-fail the review even if a future toggle requests one.
        const technicalFailure = durationMs === null || !width || !height || averageBrightness < 2;
        return {
            passed: !technicalFailure,
            warnings: Array.from(new Set(warnings)),
            durationMs,
            width,
            height,
            fps,
            hasAudio,
            slideshowRisk,
            reviewedAt: Date.now(),
        };
    }
    run(ffmpeg, args, signal) {
        throwIfAborted(signal);
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
            const stdout = [];
            let stderr = '';
            const abort = () => child.kill('SIGKILL');
            signal?.addEventListener('abort', abort, { once: true });
            child.stdout.on('data', (chunk) => stdout.push(chunk));
            child.stderr.on('data', (chunk) => {
                stderr += String(chunk);
                if (stderr.length > 50000)
                    stderr = stderr.slice(-50000);
            });
            child.on('error', (error) => {
                signal?.removeEventListener('abort', abort);
                reject(error);
            });
            child.on('close', (code) => {
                signal?.removeEventListener('abort', abort);
                if (signal?.aborted)
                    reject(new Error('Video compose canceled.'));
                else if (code === 0)
                    resolve({ stdout: Buffer.concat(stdout), stderr });
                else
                    reject(new Error(`FFmpeg exited with code ${code}.\n${stderr.trim()}`));
            });
        });
    }
}
exports.VideoComposeService = VideoComposeService;
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw new Error('Video compose canceled.');
}
exports.videoComposeService = new VideoComposeService();
//# sourceMappingURL=VideoComposeService.js.map