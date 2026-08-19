"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.postMediaValidationService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const url_1 = require("url");
const electron_1 = require("electron");
const VideoRenderService_1 = require("../design/VideoRenderService");
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const VIDEO_EXTENSIONS = /\.(avi|m4v|mkv|mov|mp4|webm)(?:$|[?#])/i;
const IMAGE_EXTENSIONS = /\.(avif|gif|jpe?g|png|webp)(?:$|[?#])/i;
// Platform limits reviewed against first-party documentation on 2026-07-18. Keep these rules in one
// main-process service so composer hints and the final publisher guard cannot drift apart. Mastodon
// byte/duration limits remain instance-configurable, so only its universal attachment count is checked.
function mediaKind(item) {
    if (/^image\//i.test(item.type) || IMAGE_EXTENSIONS.test(item.path))
        return 'image';
    if (/^video\//i.test(item.type) || VIDEO_EXTENSIONS.test(item.path))
        return 'video';
    return 'unknown';
}
function localFilePath(value) {
    if (/^https?:\/\//i.test(value))
        return null;
    if (/^mt-local-file:\/\//i.test(value)) {
        return (0, url_1.fileURLToPath)(value.replace(/^mt-local-file:\/\/(localhost)?/i, 'file://'));
    }
    if (/^file:\/\//i.test(value))
        return (0, url_1.fileURLToPath)(value);
    return value;
}
function fileName(value) {
    const local = localFilePath(value);
    if (local)
        return path_1.default.basename(local);
    try {
        return decodeURIComponent(new URL(value).pathname.split('/').pop() || 'media');
    }
    catch {
        return path_1.default.basename(value) || 'media';
    }
}
function formatBytes(value) {
    if (value >= GIB)
        return `${(value / GIB).toFixed(value >= 10 * GIB ? 0 : 1)} GB`;
    return `${(value / MIB).toFixed(value >= 10 * MIB ? 0 : 1)} MB`;
}
function formatDuration(value) {
    const seconds = Math.round(value / 1000);
    if (seconds < 60)
        return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}
function uniqueIssues(issues) {
    const seen = new Set();
    return issues.filter((issue) => {
        const key = `${issue.channel}:${issue.path ?? ''}:${issue.code}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function pushIssue(issues, channel, code, message, mediaPath = null) {
    issues.push({ channel, path: mediaPath, code, message });
}
class PostMediaValidationService {
    cache = new Map();
    async validate(input) {
        const media = input.media.filter((item) => item.path.trim());
        const inspections = await Promise.all(media.map((item) => this.inspect(item)));
        const issues = [];
        const images = inspections.filter((item) => item.kind === 'image');
        const videos = inspections.filter((item) => item.kind === 'video');
        for (const channel of Array.from(new Set(input.channels))) {
            const options = input.optionsByChannel?.[channel] ?? {};
            this.validateChannel(channel, inspections, images, videos, options, issues);
        }
        const resultIssues = uniqueIssues(issues);
        return { valid: resultIssues.length === 0, inspections, issues: resultIssues };
    }
    async inspect(item) {
        const kind = mediaKind(item);
        const local = localFilePath(item.path);
        if (!local)
            return this.inspectRemote(item, kind);
        let stat;
        try {
            stat = await fs_1.default.promises.stat(local);
        }
        catch {
            return {
                path: item.path,
                kind,
                mimeType: item.type,
                sizeBytes: null,
                width: null,
                height: null,
                durationMs: null,
                inspectError: 'The local media file could not be read.',
            };
        }
        const signature = `${item.type}:${stat.size}:${stat.mtimeMs}`;
        const cached = this.cache.get(item.path);
        if (cached?.signature === signature)
            return cached.inspection;
        const base = {
            path: item.path,
            kind,
            mimeType: item.type,
            sizeBytes: stat.size,
            width: null,
            height: null,
            durationMs: null,
            inspectError: null,
        };
        const inspection = kind === 'image'
            ? this.inspectImage(local, base)
            : kind === 'video'
                ? await this.inspectVideo(local, base)
                : base;
        this.cache.set(item.path, { signature, inspection });
        return inspection;
    }
    inspectImage(local, base) {
        try {
            const image = electron_1.nativeImage.createFromPath(local);
            if (image.isEmpty())
                return { ...base, inspectError: 'Image dimensions could not be read.' };
            const size = image.getSize();
            return { ...base, width: size.width, height: size.height };
        }
        catch {
            return { ...base, inspectError: 'Image dimensions could not be read.' };
        }
    }
    inspectVideo(local, base) {
        return new Promise((resolve) => {
            let ffmpeg;
            try {
                ffmpeg = VideoRenderService_1.videoRenderService.resolveFfmpegPath();
            }
            catch {
                resolve({ ...base, inspectError: 'Video metadata could not be read because FFmpeg is unavailable.' });
                return;
            }
            const child = (0, child_process_1.spawn)(ffmpeg, ['-hide_banner', '-i', local], { stdio: ['ignore', 'ignore', 'pipe'] });
            let stderr = '';
            let settled = false;
            const finish = (inspection) => {
                if (settled)
                    return;
                settled = true;
                resolve(inspection);
            };
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                finish({ ...base, inspectError: 'Video metadata inspection timed out.' });
            }, 15_000);
            child.stderr.on('data', (chunk) => {
                stderr += String(chunk);
                if (stderr.length > 50_000)
                    stderr = stderr.slice(-50_000);
            });
            child.on('error', () => {
                clearTimeout(timer);
                finish({ ...base, inspectError: 'Video metadata could not be read.' });
            });
            child.on('close', () => {
                clearTimeout(timer);
                if (settled)
                    return;
                const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
                const dimensions = stderr.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/i);
                const durationMs = duration
                    ? Math.round((Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000)
                    : null;
                finish({
                    ...base,
                    width: dimensions ? Number(dimensions[1]) : null,
                    height: dimensions ? Number(dimensions[2]) : null,
                    durationMs,
                    inspectError: dimensions || duration ? null : 'Video dimensions and duration could not be read.',
                });
            });
        });
    }
    async inspectRemote(item, kind) {
        let sizeBytes = null;
        let mimeType = item.type;
        let inspectError = null;
        try {
            const response = await fetch(item.path, { method: 'HEAD', signal: AbortSignal.timeout(8_000) });
            const length = Number(response.headers.get('content-length'));
            if (Number.isFinite(length) && length >= 0)
                sizeBytes = length;
            mimeType = response.headers.get('content-type')?.split(';')[0] || mimeType;
            if (!response.ok)
                inspectError = `Remote media returned HTTP ${response.status}.`;
        }
        catch {
            inspectError = 'Remote media metadata could not be read.';
        }
        return {
            path: item.path,
            kind,
            mimeType,
            sizeBytes,
            width: null,
            height: null,
            durationMs: null,
            inspectError,
        };
    }
    validateChannel(channel, all, images, videos, options, issues) {
        if (channel === 'instagram')
            this.validateInstagram(all, images, videos, issues);
        else if (channel === 'twitter')
            this.validateX(images, videos, issues);
        else if (channel === 'linkedin' || channel === 'linkedin_page')
            this.validateLinkedIn(images, videos, issues, channel);
        else if (channel === 'tiktok')
            this.validateTikTok(videos, issues);
        else if (channel === 'youtube')
            this.validateYouTube(videos, options, issues);
        else if (channel === 'telegram')
            this.validateTelegram(images, videos, issues);
        else if (channel === 'discord')
            this.validateDiscord(all, issues);
        else if (channel === 'pinterest')
            this.validatePinterest(all, images, videos, issues);
        else if (channel === 'facebook')
            this.validateFacebook(videos, issues);
        else if (channel === 'bluesky')
            this.validateBluesky(images, videos, issues);
        else if (channel === 'mastodon' && images.length > 4) {
            pushIssue(issues, 'mastodon', 'image_count', `Mastodon accepts at most 4 images; ${images.length} are attached.`);
        }
    }
    validateInstagram(all, images, videos, issues) {
        if (!all.length) {
            pushIssue(issues, 'instagram', 'media_required', 'Instagram requires an image or video.');
            return;
        }
        if (all.length > 10) {
            pushIssue(issues, 'instagram', 'media_count', `Instagram accepts at most 10 media items; ${all.length} are attached.`);
        }
        for (const image of images) {
            const name = fileName(image.path);
            if (image.sizeBytes !== null && image.sizeBytes > 8 * MIB) {
                pushIssue(issues, 'instagram', 'image_size', `Instagram: ${name} is ${formatBytes(image.sizeBytes)}; images must be 8 MB or smaller.`, image.path);
            }
            if (image.width && image.height) {
                const ratio = image.width / image.height;
                if (ratio < 0.8 - 0.002 || ratio > 1.91 + 0.002) {
                    pushIssue(issues, 'instagram', 'image_aspect_ratio', `Instagram: ${name} is ${ratio.toFixed(2)}:1; crop it between 4:5 and 1.91:1.`, image.path);
                }
            }
        }
        for (const video of videos) {
            const name = fileName(video.path);
            if (video.sizeBytes !== null && video.sizeBytes > GIB) {
                pushIssue(issues, 'instagram', 'video_size', `Instagram: ${name} must be 1 GB or smaller.`, video.path);
            }
            if (video.durationMs !== null && (video.durationMs < 3_000 || video.durationMs > 15 * 60_000)) {
                pushIssue(issues, 'instagram', 'video_duration', `Instagram: ${name} is ${formatDuration(video.durationMs)}; Reels must be 3 seconds to 15 minutes.`, video.path);
            }
            if (video.width !== null && video.width > 1920) {
                pushIssue(issues, 'instagram', 'video_width', `Instagram: ${name} is ${video.width}px wide; the maximum is 1920px.`, video.path);
            }
        }
    }
    validateX(images, videos, issues) {
        if (images.length > 4)
            pushIssue(issues, 'twitter', 'image_count', `X accepts at most 4 images; ${images.length} are attached.`);
        for (const image of images) {
            const isGif = /gif/i.test(`${image.mimeType} ${image.path}`);
            const maximum = isGif ? 15 * MIB : 5 * MIB;
            if (image.sizeBytes !== null && image.sizeBytes > maximum) {
                pushIssue(issues, 'twitter', 'image_size', `X: ${fileName(image.path)} is ${formatBytes(image.sizeBytes)}; ${isGif ? 'GIFs' : 'images'} must be ${isGif ? '15' : '5'} MB or smaller.`, image.path);
            }
        }
        for (const video of videos) {
            const name = fileName(video.path);
            if (video.sizeBytes !== null && video.sizeBytes > 512 * MIB) {
                pushIssue(issues, 'twitter', 'video_size', `X: ${name} must be 512 MB or smaller.`, video.path);
            }
            if (video.durationMs !== null && (video.durationMs < 500 || video.durationMs > 140_000)) {
                pushIssue(issues, 'twitter', 'video_duration', `X: ${name} is ${formatDuration(video.durationMs)}; videos must be 0.5 to 140 seconds.`, video.path);
            }
            if (video.width && video.height) {
                const ratio = video.width / video.height;
                if (ratio < 1 / 3 || ratio > 3) {
                    pushIssue(issues, 'twitter', 'video_aspect_ratio', `X: ${name} must have an aspect ratio between 1:3 and 3:1.`, video.path);
                }
            }
        }
    }
    validateLinkedIn(images, videos, issues, channel) {
        const label = channel === 'linkedin_page' ? 'LinkedIn Page' : 'LinkedIn';
        if (images.length > 20)
            pushIssue(issues, channel, 'image_count', `${label} accepts at most 20 images; ${images.length} are attached.`);
        for (const image of images) {
            if (image.width && image.height && image.width * image.height >= 36_152_320) {
                pushIssue(issues, channel, 'image_pixels', `${label}: ${fileName(image.path)} has too many pixels; keep it below 36,152,320 pixels.`, image.path);
            }
        }
        for (const video of videos) {
            const name = fileName(video.path);
            if (video.sizeBytes !== null && (video.sizeBytes < 75 * 1024 || video.sizeBytes > 500 * MIB)) {
                pushIssue(issues, channel, 'video_size', `${label}: ${name} is ${formatBytes(video.sizeBytes)}; videos must be 75 KB to 500 MB.`, video.path);
            }
            if (video.durationMs !== null && (video.durationMs < 3_000 || video.durationMs > 30 * 60_000)) {
                pushIssue(issues, channel, 'video_duration', `${label}: ${name} is ${formatDuration(video.durationMs)}; videos must be 3 seconds to 30 minutes.`, video.path);
            }
            if (!/mp4/i.test(`${video.mimeType} ${video.path}`)) {
                pushIssue(issues, channel, 'video_format', `${label}: ${name} must be an MP4 video.`, video.path);
            }
        }
    }
    validateTikTok(videos, issues) {
        if (!videos.length) {
            pushIssue(issues, 'tiktok', 'video_required', 'TikTok requires one video.');
            return;
        }
        if (videos.length > 1)
            pushIssue(issues, 'tiktok', 'video_count', `TikTok accepts one video; ${videos.length} are attached.`);
        const video = videos[0];
        const name = fileName(video.path);
        if (!/(mp4|webm|quicktime|\.mov)/i.test(`${video.mimeType} ${video.path}`)) {
            pushIssue(issues, 'tiktok', 'video_format', `TikTok: ${name} must be MP4, MOV, or WebM.`, video.path);
        }
        if (video.sizeBytes !== null && video.sizeBytes > 4 * GIB) {
            pushIssue(issues, 'tiktok', 'video_size', `TikTok: ${name} must be 4 GB or smaller.`, video.path);
        }
        if (video.durationMs !== null && video.durationMs > 10 * 60_000) {
            pushIssue(issues, 'tiktok', 'video_duration', `TikTok: ${name} is ${formatDuration(video.durationMs)}; uploads must be 10 minutes or shorter.`, video.path);
        }
        if (video.width && video.height && [video.width, video.height].some((value) => value < 360 || value > 4096)) {
            pushIssue(issues, 'tiktok', 'video_dimensions', `TikTok: ${name} is ${video.width}x${video.height}; each side must be between 360px and 4096px.`, video.path);
        }
    }
    validateYouTube(videos, options, issues) {
        if (!videos.length) {
            pushIssue(issues, 'youtube', 'video_required', 'YouTube requires one video.');
            return;
        }
        if (videos.length > 1)
            pushIssue(issues, 'youtube', 'video_count', `YouTube accepts one video; ${videos.length} are attached.`);
        const video = videos[0];
        const name = fileName(video.path);
        if (video.sizeBytes !== null && video.sizeBytes > 256 * GIB) {
            pushIssue(issues, 'youtube', 'video_size', `YouTube: ${name} must be 256 GB or smaller.`, video.path);
        }
        if (video.durationMs !== null && video.durationMs > 12 * 60 * 60_000) {
            pushIssue(issues, 'youtube', 'video_duration', `YouTube: ${name} must be 12 hours or shorter.`, video.path);
        }
        if (options.short === true) {
            if (video.durationMs !== null && video.durationMs > 180_000) {
                pushIssue(issues, 'youtube', 'short_duration', `YouTube Short: ${name} must be 3 minutes or shorter.`, video.path);
            }
            if (video.width && video.height && video.width > video.height) {
                pushIssue(issues, 'youtube', 'short_aspect_ratio', `YouTube Short: ${name} must be square or vertical.`, video.path);
            }
        }
    }
    validateTelegram(images, videos, issues) {
        for (const image of images) {
            if (image.sizeBytes !== null && image.sizeBytes > 10 * MIB) {
                pushIssue(issues, 'telegram', 'image_size', `Telegram: ${fileName(image.path)} must be 10 MB or smaller.`, image.path);
            }
        }
        for (const video of videos) {
            if (video.sizeBytes !== null && video.sizeBytes > 50 * MIB) {
                pushIssue(issues, 'telegram', 'video_size', `Telegram: ${fileName(video.path)} must be 50 MB or smaller.`, video.path);
            }
        }
    }
    validateDiscord(all, issues) {
        for (const item of all) {
            if (item.sizeBytes !== null && item.sizeBytes > 10 * MIB) {
                pushIssue(issues, 'discord', 'media_size', `Discord: ${fileName(item.path)} is ${formatBytes(item.sizeBytes)}; the default upload limit is 10 MB.`, item.path);
            }
        }
    }
    validatePinterest(all, images, videos, issues) {
        if (!all.length)
            pushIssue(issues, 'pinterest', 'media_required', 'Pinterest requires an image or video.');
        if (videos.length && !images.length) {
            pushIssue(issues, 'pinterest', 'video_cover_required', 'Pinterest video Pins require an image for the cover.');
        }
    }
    validateFacebook(videos, issues) {
        for (const video of videos) {
            const name = fileName(video.path);
            if (video.sizeBytes !== null && video.sizeBytes > 4 * GIB) {
                pushIssue(issues, 'facebook', 'video_size', `Facebook: ${name} must be 4 GB or smaller.`, video.path);
            }
            if (video.durationMs !== null && video.durationMs > 240 * 60_000) {
                pushIssue(issues, 'facebook', 'video_duration', `Facebook: ${name} is ${formatDuration(video.durationMs)}; videos must be 240 minutes or shorter.`, video.path);
            }
        }
    }
    validateBluesky(images, videos, issues) {
        if (images.length > 4) {
            pushIssue(issues, 'bluesky', 'image_count', `Bluesky accepts at most 4 images; ${images.length} are attached.`);
        }
        for (const image of images) {
            if (image.sizeBytes !== null && image.sizeBytes > 2 * MIB) {
                pushIssue(issues, 'bluesky', 'image_size', `Bluesky: ${fileName(image.path)} must be 2 MB or smaller.`, image.path);
            }
        }
        for (const video of videos) {
            if (!/mp4/i.test(`${video.mimeType} ${video.path}`)) {
                pushIssue(issues, 'bluesky', 'video_format', `Bluesky: ${fileName(video.path)} must be an MP4 video.`, video.path);
            }
        }
    }
}
exports.postMediaValidationService = new PostMediaValidationService();
//# sourceMappingURL=mediaValidation.js.map