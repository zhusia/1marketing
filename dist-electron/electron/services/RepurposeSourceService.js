"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.repurposeSourceService = exports.RepurposeSourceService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const AppRepository_1 = require("./AppRepository");
const PipelineService_1 = require("./PipelineService");
const OAuthService_1 = require("./oauth/OAuthService");
const readable_1 = require("./seo/audit/readable");
const registry_1 = require("./publishers/registry");
const sourceReaders_1 = require("./repurpose/sourceReaders");
const urlWatch_1 = require("./repurpose/urlWatch");
const shared_1 = require("./pipelines/shared");
const userDataPath_1 = require("../utils/userDataPath");
const FB_GRAPH = 'https://graph.facebook.com/v23.0';
const FETCH_TIMEOUT_MS = 20_000;
const MAX_MEDIA_PER_SOURCE = 4;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
/** Reels/videos from public Facebook pages are often larger than stills. */
const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
const MAX_AUTOMATED_POSTS_PER_RUN = 5;
/** Skip downloaded "images" smaller than this — favicons, tracking pixels, spacer gifs. */
const MIN_MEDIA_BYTES = 10 * 1024;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
function mediaFolder() {
    const folder = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), 'repurpose-media');
    fs_1.default.mkdirSync(folder, { recursive: true });
    return folder;
}
const IMAGE_EXTENSIONS = {
    'image/apng': 'apng',
    'image/avif': 'avif',
    'image/gif': 'gif',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};
const VIDEO_EXTENSIONS = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-m4v': 'm4v',
};
/** Facebook profile avatars and chrome — never attach these as post media. */
function isFacebookProfileOrChromeImage(url) {
    const lower = url.toLowerCase();
    if (/\/t1\.6435-1\//i.test(lower))
        return true;
    if (/\/t39\.30808-1\//i.test(lower))
        return true;
    if (/[?&]stp=[^&]*c\d+(?:\.\d+){3}a_/i.test(lower))
        return true;
    if (/[?&](?:ctp|stp)=[^&]*s(?:40|50|80|100|120|160|200|240|320)x/i.test(lower))
        return true;
    if (/profile[_-]?pic|profilepicture|\/p\d+x\d+\//i.test(lower))
        return true;
    if (/static\.xx\.fbcdn\.net|rsrc\.php/i.test(lower))
        return true;
    return false;
}
function looksLikeVideoUrl(url) {
    return /\.(mp4|m4v|webm|mov)(\?|#|$)/i.test(url)
        || /video\.[a-z0-9.-]+\.fbcdn\.net/i.test(url);
}
function attachmentImageUrls(attachment, into) {
    const src = attachment.media?.image?.src;
    if (src && !into.includes(src))
        into.push(src);
    for (const sub of attachment.subattachments?.data ?? [])
        attachmentImageUrls(sub, into);
}
function toChannelPost(post, accountName) {
    const text = (post.message ?? post.story ?? '').trim();
    const mediaUrls = [];
    for (const attachment of post.attachments?.data ?? [])
        attachmentImageUrls(attachment, mediaUrls);
    if (!mediaUrls.length && post.full_picture)
        mediaUrls.push(post.full_picture);
    if (!text && !mediaUrls.length)
        return null;
    const createdAt = post.created_time ? Date.parse(post.created_time) : NaN;
    return {
        id: post.id,
        text,
        createdAt: Number.isFinite(createdAt) ? createdAt : null,
        url: post.permalink_url ?? null,
        accountName,
        mediaUrls: mediaUrls.slice(0, MAX_MEDIA_PER_SOURCE),
    };
}
function sourceTitle(post) {
    const firstLine = post.text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
    if (firstLine)
        return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine;
    return `${post.accountName ?? 'Facebook'} post`;
}
/**
 * Pull image URLs out of a fetched page. Curated meta images (og:image / twitter:image)
 * win outright; the in-content <img> scan only runs when a page declares none, because
 * it also picks up avatars, emoji sprites, and layout chrome. Attribute values are
 * HTML-entity-encoded in source (`&amp;` inside signed CDN query strings), so every
 * candidate is entity-decoded before use — an encoded URL fails the CDN signature.
 */
function pageImageUrls(html, pageUrl, opts) {
    const urls = [];
    const push = (raw) => {
        if (!raw)
            return;
        try {
            const resolved = new URL((0, readable_1.decodeEntities)(raw).trim(), pageUrl).toString();
            if (!/^https?:/i.test(resolved))
                return;
            if (/\.svg(\?|#|$)/i.test(resolved))
                return;
            if (opts?.skipProfileImages && isFacebookProfileOrChromeImage(resolved))
                return;
            if (!urls.includes(resolved))
                urls.push(resolved);
        }
        catch {
            // Ignore unparsable image URLs.
        }
    };
    for (const property of ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
        const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property.replace(':', '\\:')}["'][^>]+content=["']([^"']+)["']`, 'i');
        push(pattern.exec(html)?.[1]);
    }
    if (urls.length)
        return urls;
    const imgPattern = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
    let match;
    while ((match = imgPattern.exec(html)) !== null && urls.length < MAX_MEDIA_PER_SOURCE * 3) {
        push(match[1]);
    }
    return urls;
}
/** Extract progressive MP4 URLs Facebook embeds for reels/videos. */
function pageVideoUrls(html, pageUrl) {
    const urls = [];
    const push = (raw) => {
        if (!raw)
            return;
        try {
            const resolved = new URL((0, readable_1.decodeEntities)(raw.replace(/\\\//g, '/').replace(/\\u002F/gi, '/')).trim(), pageUrl).toString();
            if (!/^https?:/i.test(resolved))
                return;
            if (!looksLikeVideoUrl(resolved))
                return;
            if (!urls.includes(resolved))
                urls.push(resolved);
        }
        catch {
            // Ignore unparsable video URLs.
        }
    };
    for (const pattern of [
        /"browser_native_hd_url"\s*:\s*"((?:\\.|[^"\\])*)"/g,
        /"browser_native_sd_url"\s*:\s*"((?:\\.|[^"\\])*)"/g,
        /"playable_url(?:_quality_hd)?"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    ]) {
        let match;
        while ((match = pattern.exec(html)) !== null)
            push(match[1]);
    }
    for (const property of ['og:video', 'og:video:url', 'og:video:secure_url']) {
        const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${property.replace(':', '\\:')}["'][^>]+content=["']([^"']+)["']`, 'i');
        push(pattern.exec(html)?.[1]);
    }
    return urls.slice(0, MAX_MEDIA_PER_SOURCE);
}
function isFacebookHost(host) {
    return host === 'facebook.com' || host.endsWith('.facebook.com');
}
/**
 * Facebook post pages render the post inside server-side JSON payloads as
 * `"message":{"text":"…"}` (the first occurrence is the story itself). The visible
 * DOM fallback is unusable — a readable-text scrape returns the page chrome,
 * reaction counts, and the whole comment thread around the actual post.
 */
function facebookPostFromHtml(html) {
    const match = /"message":\{"text":"((?:\\.|[^"\\])*)"/.exec(html);
    if (!match)
        return null;
    let text;
    try {
        text = JSON.parse(`"${match[1]}"`);
    }
    catch {
        return null;
    }
    if (!text.trim())
        return null;
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch ? (0, readable_1.decodeEntities)(titleMatch[1]).replace(/\s+/g, ' ').trim() : '';
    return { title, text: text.trim() };
}
class RepurposeSourceService {
    runningPipelineIds = new Set();
    async listSourceAccounts(input) {
        const platform = String(input.platform ?? '').trim();
        if (platform === 'linkedin' || platform === 'linkedin_page') {
            throw new Error('LinkedIn source reading requires separate approved read permissions.');
        }
        if (!sourceReaders_1.AUTOMATED_REPURPOSE_SOURCES.has(platform)) {
            throw new Error(`Accounts from ${platform || 'this channel'} are not supported yet.`);
        }
        if (platform !== 'facebook') {
            return (0, sourceReaders_1.listExternalSourceAccounts)({ platform, productId: input.productId ?? null });
        }
        const accessToken = await OAuthService_1.oauthService.ensureFreshToken('facebook');
        const pagesRes = await axios_1.default.get(`${FB_GRAPH}/me/accounts`, {
            params: { access_token: accessToken, fields: 'id,name' },
            timeout: FETCH_TIMEOUT_MS,
        });
        return (pagesRes.data?.data ?? []).map((page) => ({
            id: page.id,
            name: page.name,
            handle: null,
        }));
    }
    /**
     * Probe a public profile/post URL for the latest readable snapshot(s).
     * Used by the social pipeline's "Watch URL" source mode and by the config UI.
     */
    async probeWatchUrl(input) {
        return (0, urlWatch_1.listPostsFromWatchUrl)({
            url: input.url,
            platform: input.platform ?? null,
            // Always try for at least 3 recent posts for milestone selection.
            limit: Math.max(3, input.limit ?? 8),
        });
    }
    /** List the user's recent posts on a connected channel so one can be repurposed. */
    async listChannelPosts(input) {
        const platform = String(input.platform ?? '').trim();
        const limit = Math.max(1, Math.min(50, input.limit ?? 20));
        if (platform === 'linkedin' || platform === 'linkedin_page') {
            throw new Error('LinkedIn source reading requires restricted r_member_social or r_organization_social approval. ' +
                'Use Watch URL with a public post/profile link, or request LinkedIn read approval.');
        }
        if (!sourceReaders_1.AUTOMATED_REPURPOSE_SOURCES.has(platform)) {
            throw new Error(`Loading posts from ${platform || 'this channel'} is not supported yet. Try Watch URL with a public link.`);
        }
        if (platform !== 'facebook') {
            return (0, sourceReaders_1.listExternalChannelPosts)({
                platform,
                productId: input.productId ?? null,
                accountId: input.accountId?.trim() || null,
                limit,
            });
        }
        const connector = AppRepository_1.repository.getConnector('facebook');
        if (!connector)
            throw new Error('Facebook is not connected — open Channels and connect it first.');
        const accessToken = await OAuthService_1.oauthService.ensureFreshToken('facebook');
        const pagesRes = await axios_1.default.get(`${FB_GRAPH}/me/accounts`, {
            params: { access_token: accessToken, fields: 'id,name,access_token' },
            timeout: FETCH_TIMEOUT_MS,
        });
        const pages = pagesRes.data?.data ?? [];
        if (!pages.length)
            throw new Error('No Facebook Page found — you must be an admin of at least one Page.');
        const selectedAccountId = input.accountId?.trim() || null;
        const wantedIds = (0, registry_1.facebookPageIdsForProject)(connector.config ?? {}, input.productId ?? null);
        const targets = selectedAccountId
            ? pages.filter((page) => page.id === selectedAccountId)
            : wantedIds.length
                ? pages.filter((page) => wantedIds.includes(page.id))
                : [pages[0]];
        if (!targets.length) {
            throw new Error('The mapped Facebook Page is not accessible with the connected account.');
        }
        const posts = [];
        for (const page of targets) {
            const { data } = await axios_1.default.get(`${FB_GRAPH}/${page.id}/posts`, {
                params: {
                    access_token: page.access_token,
                    fields: 'id,message,story,created_time,permalink_url,full_picture,attachments{media_type,media,subattachments}',
                    limit,
                },
                timeout: FETCH_TIMEOUT_MS,
            });
            for (const raw of (data?.data ?? [])) {
                const post = toChannelPost(raw, page.name);
                if (post)
                    posts.push(post);
            }
        }
        return posts.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, limit);
    }
    /**
     * Crawl a pasted post/article URL into a repurpose source: readable text plus the
     * page's images downloaded locally so they can be attached as campaign media.
     */
    async fetchFromUrl(input) {
        const raw = String(input.url ?? '').trim();
        if (!raw)
            throw new Error('Paste a URL to fetch.');
        let target;
        try {
            target = new URL(raw.includes('://') ? raw : `https://${raw}`);
        }
        catch {
            throw new Error('That does not look like a valid URL.');
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            throw new Error('Only http(s) URLs can be fetched.');
        }
        const response = await axios_1.default.get(target.toString(), {
            timeout: FETCH_TIMEOUT_MS,
            responseType: 'text',
            transformResponse: (value) => value,
            maxRedirects: 5,
            decompress: true,
            validateStatus: () => true,
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
                'User-Agent': BROWSER_UA,
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`The page returned HTTP ${response.status}. If the post is behind a login, paste its text instead.`);
        }
        const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
        // Facebook posts: read the post from the embedded JSON payload. Scraping the DOM
        // would drag in the page chrome and every comment under the post.
        if (isFacebookHost(target.hostname)) {
            const post = facebookPostFromHtml(html);
            if (!post) {
                throw new Error('Could not read the post from that Facebook URL (it may be private). Use "Load posts" or paste its text instead.');
            }
            // Prefer real video delivery URLs for reels; never fall back to the profile avatar.
            const mediaUrls = [
                ...pageVideoUrls(html, target.toString()),
                ...pageImageUrls(html, target.toString(), { skipProfileImages: true }),
            ];
            const media = await this.importMedia({ urls: mediaUrls });
            return { url: target.toString(), title: post.title, text: post.text, media };
        }
        const { title, text } = (0, readable_1.extractReadableText)(html);
        if (!text.trim()) {
            throw new Error('No readable text found on that page. If the post is behind a login, paste its text instead.');
        }
        const media = await this.importMedia({ urls: pageImageUrls(html, target.toString()) });
        return { url: target.toString(), title, text, media };
    }
    /** Download remote images/videos to the local repurpose-media folder as attachable PostMedia. */
    async importMedia(input) {
        const urls = (input.urls ?? [])
            .filter((url) => typeof url === 'string' && url.trim())
            // Drop Facebook profile avatars even if a caller still passes them.
            .filter((url) => !isFacebookProfileOrChromeImage(url) || looksLikeVideoUrl(url))
            .slice(0, MAX_MEDIA_PER_SOURCE * 3);
        const media = [];
        for (const url of urls) {
            if (media.length >= MAX_MEDIA_PER_SOURCE)
                break;
            const expectVideo = looksLikeVideoUrl(url);
            const maxBytes = expectVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
            try {
                const response = await axios_1.default.get(url, {
                    timeout: expectVideo ? FETCH_TIMEOUT_MS * 3 : FETCH_TIMEOUT_MS,
                    responseType: 'arraybuffer',
                    maxRedirects: 5,
                    maxContentLength: maxBytes,
                    headers: {
                        'User-Agent': BROWSER_UA,
                        // Facebook CDN video often requires a same-site referer.
                        Referer: 'https://www.facebook.com/',
                        Accept: expectVideo ? 'video/*,*/*;q=0.8' : 'image/*,*/*;q=0.8',
                    },
                });
                let type = String(response.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
                // Some CDN responses omit a useful content-type; infer from the URL.
                if (!type || type === 'application/octet-stream') {
                    if (/\.mp4(\?|#|$)/i.test(url))
                        type = 'video/mp4';
                    else if (/\.webm(\?|#|$)/i.test(url))
                        type = 'video/webm';
                    else if (/\.mov(\?|#|$)/i.test(url))
                        type = 'video/quicktime';
                    else if (/\.(jpe?g)(\?|#|$)/i.test(url))
                        type = 'image/jpeg';
                    else if (/\.png(\?|#|$)/i.test(url))
                        type = 'image/png';
                    else if (/\.webp(\?|#|$)/i.test(url))
                        type = 'image/webp';
                }
                const extension = IMAGE_EXTENSIONS[type] ?? VIDEO_EXTENSIONS[type];
                if (!extension)
                    continue;
                const buffer = Buffer.from(response.data);
                const maxForType = VIDEO_EXTENSIONS[type] ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
                if (buffer.length < MIN_MEDIA_BYTES || buffer.length > maxForType)
                    continue;
                const name = `${crypto_1.default.createHash('sha1').update(url).digest('hex').slice(0, 16)}.${extension}`;
                const filePath = path_1.default.join(mediaFolder(), name);
                fs_1.default.writeFileSync(filePath, buffer);
                if (!media.some((item) => item.path === filePath))
                    media.push({ path: filePath, type });
            }
            catch {
                // Best-effort: a failed media download never blocks the text import.
            }
        }
        return media;
    }
    listPipelines(input) {
        return AppRepository_1.repository.listRepurposePipelines(input?.productId, 'social');
    }
    listPipelineLogs(input) {
        return AppRepository_1.repository.listRepurposePipelineLogs(input);
    }
    savePipeline(input) {
        if (!input || typeof input !== 'object')
            throw new Error('Pipeline configuration is required.');
        if (!AppRepository_1.repository.getProduct(input.productId))
            throw new Error('Select a valid project for this pipeline.');
        if (input.sourcePlatform === 'folder') {
            throw new Error('Folder pipelines are saved through the folder pipeline service.');
        }
        const sourcePlatform = input.sourcePlatform;
        const sourceMode = input.sourceMode === 'url' ? 'url' : 'connected';
        let sourceUrl = null;
        let sourceAccountId = input.sourceAccountId?.trim() || null;
        let sourceAccountName = input.sourceAccountName?.trim().slice(0, 160) || null;
        if (sourceMode === 'url') {
            const target = (0, urlWatch_1.normalizeWatchUrl)(String(input.sourceUrl ?? ''));
            sourceUrl = target.toString();
            sourceAccountId = `url:${crypto_1.default.createHash('sha1').update(sourceUrl).digest('hex').slice(0, 16)}`;
            sourceAccountName = sourceAccountName
                || (0, urlWatch_1.watchAccountName)(sourceUrl, sourcePlatform)
                || target.hostname;
        }
        else {
            if (!sourceReaders_1.AUTOMATED_REPURPOSE_SOURCES.has(sourcePlatform)) {
                throw new Error('Choose a source channel with a supported read API, or switch to Watch URL for public profile/post links.');
            }
            if (!sourceAccountId)
                throw new Error('Select the source account this pipeline should watch.');
        }
        const implemented = new Set((0, registry_1.listPlatformDescriptors)().filter((descriptor) => descriptor.implemented).map((descriptor) => descriptor.platform));
        const requestedDestinations = Array.isArray(input.destinationPlatforms) ? input.destinationPlatforms : [];
        const destinations = Array.from(new Set(requestedDestinations)).filter((platform) => implemented.has(platform));
        if (!destinations.length)
            throw new Error('Select at least one supported destination channel.');
        const language = typeof input.language === 'string' ? input.language.trim().toLowerCase() : '';
        if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(language))
            throw new Error('Choose a valid content language.');
        if (!['concise', 'balanced', 'detailed'].includes(input.contentDetail)) {
            throw new Error('Choose a valid content detail level.');
        }
        if (!['plaintext', 'markdown', 'html'].includes(input.outputFormat)) {
            throw new Error('Choose a valid output format.');
        }
        if (input.scheduleMode !== 'draft' && input.scheduleMode !== 'scheduled') {
            throw new Error('Choose how generated content should be delivered.');
        }
        if (input.status !== 'paused' && input.status !== 'active')
            throw new Error('Choose a valid pipeline status.');
        const pollIntervalHours = Number.isFinite(input.pollIntervalHours)
            ? Math.max(1, Math.min(168, Math.round(input.pollIntervalHours)))
            : 6;
        const scheduleDelayMinutes = Number.isFinite(input.scheduleDelayMinutes)
            ? Math.max(0, Math.min(10_080, Math.round(input.scheduleDelayMinutes)))
            : 60;
        const timezone = typeof input.timezone === 'string' ? input.timezone.trim().slice(0, 100) || 'UTC' : 'UTC';
        const milestoneSourceId = typeof input.milestoneSourceId === 'string' && input.milestoneSourceId.trim()
            ? input.milestoneSourceId.trim()
            : input.milestoneSourceId === null
                ? null
                : undefined;
        const pipeline = AppRepository_1.repository.upsertRepurposePipeline({
            ...input,
            name: input.name?.trim().slice(0, 100) || 'Repurpose Content',
            kind: 'social',
            sourceMode,
            sourceUrl,
            sourceAccountId,
            sourceAccountName,
            ...(milestoneSourceId !== undefined ? { milestoneSourceId } : {}),
            pollIntervalHours,
            destinationPlatforms: destinations,
            language,
            scheduleDelayMinutes,
            timezone,
        });
        // Seed the milestone baseline so only *newer* posts trigger generation.
        const baselineIds = Array.isArray(input.baselineSourceIds)
            ? input.baselineSourceIds.map((id) => String(id ?? '').trim()).filter(Boolean)
            : milestoneSourceId
                ? [milestoneSourceId]
                : [];
        for (const sourceId of Array.from(new Set(baselineIds))) {
            AppRepository_1.repository.markRepurposeSourceProcessed(pipeline.id, sourceId, null);
        }
        return pipeline;
    }
    pausePipeline(id) {
        const pipeline = AppRepository_1.repository.getRepurposePipeline(id);
        if (!pipeline || pipeline.kind !== 'social')
            throw new Error('Repurpose Content pipeline not found.');
        const paused = AppRepository_1.repository.pauseRepurposePipeline(id);
        if (!paused)
            throw new Error('Could not pause the pipeline.');
        return paused;
    }
    removePipeline(id) {
        const pipeline = AppRepository_1.repository.getRepurposePipeline(id);
        if (!pipeline || pipeline.kind !== 'social')
            return { removed: false };
        AppRepository_1.repository.deleteRepurposePipeline(id);
        return { removed: true };
    }
    async runPipeline(id, options) {
        const pipeline = AppRepository_1.repository.getRepurposePipeline(id);
        if (!pipeline || pipeline.kind !== 'social')
            throw new Error('Repurpose Content pipeline not found.');
        // The due-pipeline sweep snapshots its list before earlier entries' long runs, so a pipeline
        // paused meanwhile can still reach here — and markRepurposePipelineRunning would mint a fresh
        // revision that defeats the in-run pause guard. Only an explicit manual run may proceed.
        if (pipeline.status !== 'active' && !options?.includeLatest)
            throw new Error('This pipeline is paused.');
        if (this.runningPipelineIds.has(id))
            throw new Error('This pipeline is already checking for new content.');
        this.runningPipelineIds.add(id);
        const startedAt = Date.now();
        const runningPipeline = AppRepository_1.repository.markRepurposePipelineRunning(id, startedAt);
        if (!runningPipeline) {
            this.runningPipelineIds.delete(id);
            throw new Error('Repurpose Content pipeline not found.');
        }
        const pipelineRevision = runningPipeline.updatedAt;
        const runLog = AppRepository_1.repository.createRepurposePipelineLog({
            pipeline,
            trigger: options?.includeLatest ? 'manual' : 'scheduled',
            startedAt,
        });
        let fetchedPosts = 0;
        let processedPosts = 0;
        let generatedContentItems = 0;
        let scheduledPosts = 0;
        const contentRunIds = [];
        let latestTitle = null;
        let latestUrl = null;
        try {
            const posts = pipeline.sourceMode === 'url'
                ? await this.probeWatchUrl({
                    url: pipeline.sourceUrl ?? '',
                    platform: pipeline.sourcePlatform === 'folder' ? null : pipeline.sourcePlatform,
                    limit: 10,
                })
                : await this.listChannelPosts({
                    platform: pipeline.sourcePlatform,
                    productId: pipeline.productId,
                    accountId: pipeline.sourceAccountId,
                    limit: 20,
                });
            fetchedPosts = posts.length;
            // Honor the user-selected milestone: that post and anything older is baseline.
            if (pipeline.milestoneSourceId) {
                const milestone = posts.find((post) => post.id === pipeline.milestoneSourceId) ?? null;
                const milestoneTime = milestone?.createdAt ?? null;
                for (const post of posts) {
                    const isMilestone = post.id === pipeline.milestoneSourceId;
                    const isOlder = milestoneTime != null
                        && typeof post.createdAt === 'number'
                        && post.createdAt <= milestoneTime;
                    // Without timestamps, only the explicit milestone id is baseline (newer posts
                    // appear first in the probe list and keep different fingerprints).
                    if (isMilestone || isOlder) {
                        AppRepository_1.repository.markRepurposeSourceProcessed(id, post.id, post.url);
                    }
                }
            }
            const unprocessed = posts.filter((post) => !AppRepository_1.repository.hasProcessedRepurposeSource(id, post.id));
            // URL snapshots without a milestone: first scheduled poll seeds a baseline so we
            // only generate when a *new* fingerprint appears later.
            const hasHistory = AppRepository_1.repository.countProcessedRepurposeSources(id) > 0;
            if (pipeline.sourceMode === 'url'
                && !hasHistory
                && !pipeline.milestoneSourceId
                && !options?.includeLatest) {
                for (const post of unprocessed) {
                    AppRepository_1.repository.markRepurposeSourceProcessed(id, post.id, post.url);
                }
                const completedAt = Date.now();
                const current = AppRepository_1.repository.getRepurposePipeline(id) ?? pipeline;
                const updated = AppRepository_1.repository.completeRepurposePipelineRun({
                    id,
                    status: 'completed',
                    completedAt,
                    nextRunAt: (0, shared_1.nextRunAt)(current, completedAt),
                    sourceTitle: posts[0] ? sourceTitle(posts[0]) : null,
                    sourceUrl: posts[0]?.url ?? pipeline.sourceUrl,
                });
                if (!updated)
                    throw new Error('The pipeline was removed while it was running.');
                AppRepository_1.repository.completeRepurposePipelineLog({
                    id: runLog.id,
                    status: 'completed',
                    completedAt,
                    fetchedPosts,
                    processedPosts: 0,
                    generatedContentItems: 0,
                    scheduledPosts: 0,
                    sourceTitle: posts[0] ? sourceTitle(posts[0]) : null,
                    sourceUrl: posts[0]?.url ?? pipeline.sourceUrl,
                });
                return {
                    pipeline: updated,
                    fetchedPosts,
                    processedPosts: 0,
                    generatedContentItems: 0,
                    scheduledPosts: 0,
                };
            }
            const publishedSinceCreation = unprocessed.filter((post) => typeof post.createdAt === 'number' && post.createdAt >= pipeline.createdAt);
            // With a milestone, any unprocessed post is fair game (newer than the baseline).
            // Without one, keep the previous connected/url heuristics.
            const candidates = pipeline.milestoneSourceId
                ? unprocessed
                : pipeline.sourceMode === 'url'
                    ? (options?.includeLatest || hasHistory ? unprocessed : [])
                    : publishedSinceCreation.length
                        ? publishedSinceCreation
                        : options?.includeLatest
                            ? unprocessed.slice(0, 1)
                            : [];
            const unseen = candidates
                .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
                .slice(0, MAX_AUTOMATED_POSTS_PER_RUN);
            for (const post of unseen) {
                if (!post.text.trim()) {
                    AppRepository_1.repository.markRepurposeSourceProcessed(id, post.id, post.url);
                    continue;
                }
                const title = sourceTitle(post);
                latestTitle = title;
                latestUrl = post.url;
                const media = await this.importMedia({ urls: post.mediaUrls });
                const outputFormats = Object.fromEntries(pipeline.destinationPlatforms.map((platform) => [platform, pipeline.outputFormat]));
                const generation = await PipelineService_1.pipelineService.runPipeline('P1', {
                    productId: pipeline.productId,
                    trigger: 'repurpose_pipeline',
                    payload: {
                        sourceMode: 'repurpose',
                        sourceChannel: pipeline.sourcePlatform,
                        sourceAccountId: pipeline.sourceAccountId,
                        sourceAccountName: pipeline.sourceAccountName,
                        sourceWatchUrl: pipeline.sourceUrl,
                        sourceTitle: title,
                        sourceText: post.text,
                        featureSummary: post.text,
                        detectedType: 'social post',
                        platforms: pipeline.destinationPlatforms,
                        languages: [pipeline.language],
                        languageNames: {
                            [pipeline.language]: shared_1.LANGUAGE_NAMES[pipeline.language] ?? pipeline.language.toUpperCase(),
                        },
                        contentDetail: pipeline.contentDetail,
                        platformOutputFormats: outputFormats,
                        media,
                        repurposePipelineId: pipeline.id,
                        repurposePipelineRevision: pipelineRevision,
                        repurposeSourceId: post.id,
                        repurposeSourceUrl: post.url ?? pipeline.sourceUrl,
                    },
                });
                const generated = AppRepository_1.repository
                    .listContent({ productId: pipeline.productId })
                    .filter((item) => item.runId === generation.run.id);
                if (generation.run.status === 'failed') {
                    for (const item of generated)
                        AppRepository_1.repository.deleteContent(item.id);
                    throw new Error(generation.notes[0] ?? `Could not repurpose “${title}”.`);
                }
                generatedContentItems += generated.length;
                if (generated.length)
                    contentRunIds.push(generation.run.id);
                if (pipeline.scheduleMode === 'scheduled') {
                    scheduledPosts += (0, shared_1.scheduleGeneratedContent)({
                        pipeline,
                        items: generated,
                        alreadyScheduled: scheduledPosts,
                    });
                }
                AppRepository_1.repository.markRepurposeSourceProcessed(id, post.id, post.url);
                processedPosts += 1;
            }
            const completedAt = Date.now();
            const current = AppRepository_1.repository.getRepurposePipeline(id) ?? pipeline;
            const updated = AppRepository_1.repository.completeRepurposePipelineRun({
                id,
                status: 'completed',
                completedAt,
                nextRunAt: (0, shared_1.nextRunAt)(current, completedAt),
                sourceTitle: latestTitle,
                sourceUrl: latestUrl,
            });
            if (!updated)
                throw new Error('The pipeline was removed while it was running.');
            AppRepository_1.repository.completeRepurposePipelineLog({
                id: runLog.id,
                status: 'completed',
                completedAt,
                fetchedPosts,
                processedPosts,
                generatedContentItems,
                scheduledPosts,
                contentRunIds,
                sourceTitle: latestTitle,
                sourceUrl: latestUrl,
            });
            return {
                pipeline: updated,
                fetchedPosts,
                processedPosts,
                generatedContentItems,
                scheduledPosts,
            };
        }
        catch (error) {
            const completedAt = Date.now();
            const current = AppRepository_1.repository.getRepurposePipeline(id) ?? pipeline;
            const errorMessage = error instanceof Error ? error.message : 'Repurpose pipeline failed.';
            AppRepository_1.repository.completeRepurposePipelineRun({
                id,
                status: 'failed',
                completedAt,
                nextRunAt: (0, shared_1.nextRunAt)(current, completedAt),
                error: errorMessage,
            });
            AppRepository_1.repository.completeRepurposePipelineLog({
                id: runLog.id,
                status: 'failed',
                completedAt,
                fetchedPosts,
                processedPosts,
                generatedContentItems,
                scheduledPosts,
                contentRunIds,
                sourceTitle: latestTitle,
                sourceUrl: latestUrl,
                errorMessage,
            });
            throw error;
        }
        finally {
            this.runningPipelineIds.delete(id);
        }
    }
    async runDuePipelines() {
        for (const pipeline of AppRepository_1.repository.listDueRepurposePipelines(Date.now(), 'social')) {
            if (this.runningPipelineIds.has(pipeline.id))
                continue;
            // The due list is a snapshot — the pipeline may have been paused or deleted while the
            // earlier entries were running.
            if (AppRepository_1.repository.getRepurposePipeline(pipeline.id)?.status !== 'active')
                continue;
            try {
                await this.runPipeline(pipeline.id);
            }
            catch (error) {
                console.error(`[repurpose-pipeline] ${pipeline.id} failed:`, error);
            }
        }
    }
}
exports.RepurposeSourceService = RepurposeSourceService;
exports.repurposeSourceService = new RepurposeSourceService();
//# sourceMappingURL=RepurposeSourceService.js.map