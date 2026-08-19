"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWatchUrl = normalizeWatchUrl;
exports.watchAccountName = watchAccountName;
exports.listPostsFromWatchUrl = listPostsFromWatchUrl;
/**
 * Public-URL watch for social repurpose pipelines.
 *
 * Used when the channel API cannot list posts (personal Facebook profiles,
 * LinkedIn without read approval, etc.). Best-effort HTML scrape — private
 * or login-walled pages will fail; paste a public post URL or use a connected
 * account when available.
 */
const crypto_1 = __importDefault(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const readable_1 = require("../seo/audit/readable");
const FETCH_TIMEOUT_MS = 20_000;
const MAX_MEDIA_PER_SOURCE = 4;
/** Real browser UA — Facebook withholds video delivery URLs from bot-like agents. */
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
function isFacebookHost(host) {
    return host === 'facebook.com' || host === 'fb.com' || host === 'fb.watch' || host.endsWith('.facebook.com');
}
function isLinkedInHost(host) {
    return host === 'linkedin.com' || host.endsWith('.linkedin.com');
}
function metaContent(html, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(html);
        if (match?.[1])
            return (0, readable_1.decodeEntities)(match[1]).replace(/\s+/g, ' ').trim();
    }
    return null;
}
function pageTitle(html) {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    return match ? (0, readable_1.decodeEntities)(match[1]).replace(/\s+/g, ' ').trim() : '';
}
/** Decode a JSON string fragment that appeared inside HTML (often double-escaped). */
function decodeJsonStringFragment(raw) {
    try {
        return JSON.parse(`"${raw}"`);
    }
    catch {
        try {
            return JSON.parse(`"${raw.replace(/\\\\/g, '\\')}"`);
        }
        catch {
            return null;
        }
    }
}
function unescapeFbUrl(raw) {
    const decoded = decodeJsonStringFragment(raw) ?? raw;
    return (0, readable_1.decodeEntities)(decoded.replace(/\\\//g, '/').replace(/\\u002F/gi, '/')).trim();
}
/**
 * Facebook profile avatars and cover chrome — never treat these as post media.
 * Real post photos use paths like `t39.99422-*` / feed sizes; video frames use
 * `t15.*`. Actor portraits live on `t1.6435-1` / `t39.30808-1` and circular crops.
 */
function isFacebookProfileOrChromeImage(url) {
    const lower = url.toLowerCase();
    if (/\/t1\.6435-1\//i.test(lower))
        return true;
    if (/\/t39\.30808-1\//i.test(lower))
        return true;
    // Circular / face-crop profile transforms (cX.Y.Z.Wa_…)
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
/** Video poster frames Facebook stores under the t15.* CDN tree. */
function isFacebookVideoThumbnail(url) {
    return /\/t15\.\d+-/i.test(url);
}
function looksLikeVideoUrl(url) {
    return /\.(mp4|m4v|webm|mov)(\?|#|$)/i.test(url)
        || /\/v\/t\d+\/.*\.mp4/i.test(url)
        || /video\.[a-z0-9.-]+\.fbcdn\.net/i.test(url)
        || /browser_native/i.test(url);
}
function pushUniqueUrl(into, raw, pageUrl, opts) {
    if (!raw)
        return;
    try {
        const resolved = new URL(unescapeFbUrl(raw), pageUrl).toString();
        if (!/^https?:/i.test(resolved))
            return;
        if (/\.svg(\?|#|$)/i.test(resolved))
            return;
        if (!opts?.allowProfile && isFacebookProfileOrChromeImage(resolved) && !looksLikeVideoUrl(resolved)) {
            return;
        }
        if (!into.includes(resolved))
            into.push(resolved);
    }
    catch {
        // Ignore unparsable URLs.
    }
}
function pageImageUrls(html, pageUrl, opts) {
    const urls = [];
    const push = (raw) => {
        pushUniqueUrl(urls, raw, pageUrl, { allowProfile: !opts?.skipProfileImages });
    };
    for (const property of ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
        push(metaContent(html, property));
    }
    if (urls.length)
        return urls.slice(0, MAX_MEDIA_PER_SOURCE);
    const imgPattern = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;
    let match;
    while ((match = imgPattern.exec(html)) !== null && urls.length < MAX_MEDIA_PER_SOURCE * 3) {
        push(match[1]);
    }
    return urls.slice(0, MAX_MEDIA_PER_SOURCE);
}
/**
 * Facebook reels/videos embed progressive MP4s as browser_native_hd/sd_url in the
 * server-rendered JSON. Prefer HD, then SD, then og:video meta.
 */
function pageVideoUrls(html, pageUrl) {
    const urls = [];
    const push = (raw) => {
        pushUniqueUrl(urls, raw, pageUrl, { allowProfile: true });
    };
    // Prefer HD over SD; collect in two passes so HD wins order.
    const hdPattern = /"browser_native_hd_url"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    const sdPattern = /"browser_native_sd_url"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    let match;
    while ((match = hdPattern.exec(html)) !== null)
        push(match[1]);
    while ((match = sdPattern.exec(html)) !== null)
        push(match[1]);
    for (const property of ['og:video', 'og:video:url', 'og:video:secure_url', 'twitter:player:stream']) {
        push(metaContent(html, property));
    }
    // playable_url variants used by older Facebook payloads
    const playablePattern = /"playable_url(?:_quality_hd)?"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    while ((match = playablePattern.exec(html)) !== null)
        push(match[1]);
    return urls.filter(looksLikeVideoUrl).slice(0, MAX_MEDIA_PER_SOURCE);
}
/**
 * Facebook post pages render the post inside server-side JSON as
 * `"message":{"text":"…"}`. First hit is usually the post itself.
 */
function facebookPostTextFromHtml(html) {
    const match = /"message":\{"text":"((?:\\.|[^"\\])*)"/.exec(html);
    if (!match)
        return null;
    const textValue = decodeJsonStringFragment(match[1]);
    return textValue?.trim() || null;
}
/**
 * Collect multiple `"message":{"text":"…"}` payloads from a profile/timeline
 * page. De-dupe and keep unique texts (short chrome/react strings filtered out).
 */
function facebookTimelineTexts(html) {
    const pattern = /"message":\{"text":"((?:\\.|[^"\\])*)"/g;
    const seen = new Set();
    const texts = [];
    let match;
    while ((match = pattern.exec(html)) !== null && texts.length < 12) {
        const value = decodeJsonStringFragment(match[1])?.trim();
        if (!value || value.length < 12)
            continue;
        const key = value.slice(0, 200);
        if (seen.has(key))
            continue;
        seen.add(key);
        texts.push(value);
    }
    return texts;
}
/** Post ids currently pinned on a profile (`profile_pinned_post.pinned_post_story`). */
function facebookPinnedPostIds(html) {
    const pinned = new Set();
    // Nested JSON means brace-limited regex is unreliable — take a fixed window after each marker.
    const markers = ['"profile_pinned_post"', '"pinned_post_story"'];
    for (const marker of markers) {
        let from = 0;
        while (from < html.length) {
            const at = html.indexOf(marker, from);
            if (at < 0)
                break;
            const chunk = html.slice(at, at + 10_000);
            const postId = /"post_id"\s*:\s*"(\d+)"/.exec(chunk)?.[1];
            if (postId)
                pinned.add(postId);
            const storyId = /"id"\s*:\s*"(Uzpf[^"]+)"/.exec(chunk)?.[1];
            if (storyId) {
                try {
                    const decoded = Buffer.from(storyId, 'base64').toString('utf8');
                    for (const id of decoded.match(/\d{10,}/g) ?? [])
                        pinned.add(id);
                }
                catch {
                    // Ignore undecodable ids.
                }
            }
            // feedback ids are base64("feedback:<postId>")
            const feedbackId = /"id"\s*:\s*"(ZmVlZGJhY2s6[^"]+)"/.exec(chunk)?.[1];
            if (feedbackId) {
                try {
                    const decoded = Buffer.from(feedbackId, 'base64').toString('utf8');
                    const id = decoded.match(/feedback:(\d+)/i)?.[1];
                    if (id)
                        pinned.add(id);
                }
                catch {
                    // Ignore.
                }
            }
            from = at + marker.length;
        }
    }
    return pinned;
}
function ensureStory(stories, postId, pinnedIds, patch) {
    const existing = stories.get(postId) ?? {
        postId,
        creationTime: null,
        url: null,
        text: '',
        mediaUrls: [],
        pinned: pinnedIds.has(postId),
    };
    if (patch?.creationTime != null) {
        existing.creationTime =
            existing.creationTime == null || patch.creationTime > existing.creationTime
                ? patch.creationTime
                : existing.creationTime;
    }
    if (patch?.url && !existing.url)
        existing.url = patch.url;
    if (patch?.text && (!existing.text || patch.text.length > existing.text.length)) {
        existing.text = patch.text;
    }
    if (patch?.mediaUrls?.length) {
        for (const url of patch.mediaUrls) {
            if (!existing.mediaUrls.includes(url))
                existing.mediaUrls.push(url);
        }
    }
    existing.pinned = existing.pinned || pinnedIds.has(postId) || Boolean(patch?.pinned);
    stories.set(postId, existing);
    return existing;
}
/**
 * Structured story units from Facebook's server-rendered JSON: post_id +
 * creation_time + permalink. Sorted by real publish time so pinned posts do not
 * masquerade as "latest" — they stay in the list for milestone selection.
 */
function facebookStoriesFromHtml(html, pageUrl) {
    const pinnedIds = facebookPinnedPostIds(html);
    const stories = new Map();
    // Pattern A: "post_id":"…","creation_time":…
    const pairPattern = /"post_id"\s*:\s*"(\d+)"\s*,\s*"creation_time"\s*:\s*(\d+)/g;
    let match;
    while ((match = pairPattern.exec(html)) !== null) {
        const postId = match[1];
        const creationTime = Number(match[2]);
        if (!postId || !Number.isFinite(creationTime))
            continue;
        ensureStory(stories, postId, pinnedIds, { creationTime });
    }
    // Pattern A2: reverse order + alternate keys Facebook sometimes emits
    const revPairPattern = /"creation_time"\s*:\s*(\d+)\s*,\s*"post_id"\s*:\s*"(\d+)"/g;
    while ((match = revPairPattern.exec(html)) !== null) {
        const creationTime = Number(match[1]);
        const postId = match[2];
        if (!postId || !Number.isFinite(creationTime))
            continue;
        ensureStory(stories, postId, pinnedIds, { creationTime });
    }
    // Pattern A3: tracking / share payloads often carry top_level_post_id
    const topLevelPattern = /top_level_post_id\\?"\s*:\s*\\?"?(\d{8,})/g;
    while ((match = topLevelPattern.exec(html)) !== null) {
        ensureStory(stories, match[1], pinnedIds);
    }
    const storyFbidPattern = /story_fbid(?:=|\\?":\\?")(\d{8,})/g;
    while ((match = storyFbidPattern.exec(html)) !== null) {
        ensureStory(stories, match[1], pinnedIds);
    }
    // Pattern B: story blocks with creation_time + url — match by nearby post_id, path id, or same timestamp.
    const storyUrlPattern = /"creation_time"\s*:\s*(\d+)\s*,\s*"unpublished_content_type"\s*:\s*"[^"]*"\s*,\s*"url"\s*:\s*"((?:\\.|[^"\\])*)"/g;
    while ((match = storyUrlPattern.exec(html)) !== null) {
        const creationTime = Number(match[1]);
        const url = unescapeFbUrl(match[2]);
        if (!Number.isFinite(creationTime) || !url)
            continue;
        const windowStart = Math.max(0, match.index - 4000);
        const windowEnd = Math.min(html.length, match.index + 1200);
        const nearby = html.slice(windowStart, windowEnd);
        const nearbyPostId = /"post_id"\s*:\s*"(\d+)"/.exec(nearby)?.[1]
            ?? /\/(?:posts|videos|reel)\/(?:[^/"'\\]+\/)?(\d{8,})/i.exec(url)?.[1]
            ?? /story_fbid=(\d+)/i.exec(url)?.[1]
            ?? null;
        if (nearbyPostId) {
            ensureStory(stories, nearbyPostId, pinnedIds, { creationTime, url });
        }
        // Same publish timestamp → fill missing permalinks on already-known stories.
        for (const story of stories.values()) {
            if (story.creationTime === creationTime && (!story.url || story.url === pageUrl)) {
                story.url = url;
            }
        }
    }
    // Attach message text: walk each message and associate with the nearest post_id in a local window.
    const messagePattern = /"message":\{"text":"((?:\\.|[^"\\])*)"/g;
    const orphanTexts = [];
    while ((match = messagePattern.exec(html)) !== null) {
        const text = decodeJsonStringFragment(match[1])?.trim();
        if (!text || text.length < 12)
            continue;
        const windowStart = Math.max(0, match.index - 6000);
        const windowEnd = Math.min(html.length, match.index + 6000);
        const nearby = html.slice(windowStart, windowEnd);
        const postIds = Array.from(nearby.matchAll(/"(?:post_id|top_level_post_id|story_fbid)"\s*:\s*"?(\d{8,})"?/g), (item) => item[1]);
        const uniqueIds = Array.from(new Set(postIds)).filter((id) => stories.has(id) || /^\d{8,}$/.test(id));
        let attached = false;
        for (const postId of uniqueIds) {
            ensureStory(stories, postId, pinnedIds, { text });
            attached = true;
        }
        // Orphan timeline text (no nearby post id) — still surface for milestone picking.
        if (!attached)
            orphanTexts.push(text);
    }
    for (const text of orphanTexts) {
        const anonId = `text:${crypto_1.default.createHash('sha1').update(text.slice(0, 280)).digest('hex').slice(0, 16)}`;
        ensureStory(stories, anonId, pinnedIds, { text });
    }
    // Media only from each story's own attachments[] — never nearby actor avatars.
    for (const story of stories.values()) {
        if (story.postId.startsWith('text:'))
            continue;
        story.mediaUrls = mediaForFacebookStory(html, story.postId, pageUrl);
        story.pinned = story.pinned || pinnedIds.has(story.postId);
    }
    return Array.from(stories.values());
}
/**
 * Extract media strictly from the story's attachments block.
 * A loose scan around post_id pulls in the author's profilePic / neighboring
 * posts — that's how avatar URLs were leaking into "media attachment".
 */
function mediaForFacebookStory(html, postId, pageUrl) {
    const anchor = `"post_id":"${postId}","creation_time":`;
    let at = html.indexOf(anchor);
    if (at < 0) {
        // Spaced JSON variant
        const loose = new RegExp(`"post_id"\\s*:\\s*"${postId}"\\s*,\\s*"creation_time"\\s*:\\s*\\d+`).exec(html);
        if (!loose)
            return [];
        at = loose.index;
    }
    // Bound this story: from post_id until the next different post_id (or a hard cap).
    const sliceStart = at;
    const sliceEnd = Math.min(html.length, at + 16_000);
    let storyChunk = html.slice(sliceStart, sliceEnd);
    const nextPost = /"post_id"\s*:\s*"(\d+)"/.exec(storyChunk.slice(40));
    if (nextPost && nextPost[1] !== postId) {
        storyChunk = storyChunk.slice(0, 40 + nextPost.index);
    }
    const attMatch = /"attachments"\s*:\s*\[/.exec(storyChunk);
    if (!attMatch)
        return [];
    // Attachment payload is nested deeply for videos — take a generous window.
    const attChunk = storyChunk.slice(attMatch.index, attMatch.index + 12_000);
    // Text-only posts often have `"attachments":[{"action_links":[]}]` with no media node.
    const mediaType = /"media"\s*:\s*\{\s*"__typename"\s*:\s*"(Video|Photo)"/.exec(attChunk)?.[1];
    if (!mediaType)
        return [];
    const media = [];
    if (mediaType === 'Photo') {
        // Prefer photo_image inside the attachment styles (full-size post photo).
        const photoUri = /"photo_image"\s*:\s*\{\s*"uri"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(attChunk)?.[1];
        pushUniqueUrl(media, photoUri, pageUrl);
        return media.slice(0, MAX_MEDIA_PER_SOURCE);
    }
    // Video / reel
    const videoId = /"media"\s*:\s*\{\s*"__typename"\s*:\s*"Video"\s*,\s*(?:"__isNode"\s*:\s*"Video"\s*,\s*)?"id"\s*:\s*"(\d+)"/
        .exec(attChunk)?.[1]
        ?? /"__typename"\s*:\s*"Video"[^{]{0,40}"id"\s*:\s*"(\d+)"/.exec(attChunk)?.[1]
        ?? null;
    // Poster frame (t15.*) near the video id — reliable for UI previews. Prefer larger crops.
    if (videoId) {
        let searchFrom = 0;
        const idToken = `"${videoId}"`;
        while (searchFrom < html.length && media.filter((url) => !looksLikeVideoUrl(url)).length < 1) {
            const idAt = html.indexOf(idToken, searchFrom);
            if (idAt < 0)
                break;
            const near = html.slice(idAt, idAt + 6_000);
            const uriPattern = /"(?:uri|src)"\s*:\s*"(https:\\?\/\\?\/scontent[^"]+)"/g;
            let uriMatch;
            while ((uriMatch = uriPattern.exec(near)) !== null) {
                const resolved = (() => {
                    try {
                        return new URL(unescapeFbUrl(uriMatch[1]), pageUrl).toString();
                    }
                    catch {
                        return '';
                    }
                })();
                if (!resolved || isFacebookProfileOrChromeImage(resolved))
                    continue;
                // Prefer real video frames; skip unrelated feed images that happen to sit nearby.
                if (isFacebookVideoThumbnail(resolved) || /\/t39\./i.test(resolved)) {
                    pushUniqueUrl(media, resolved, pageUrl);
                    if (media.length)
                        break;
                }
            }
            searchFrom = idAt + idToken.length;
        }
        // Progressive MP4 delivery for this video id (HD first).
        const deliveryPattern = /"browser_native_(?:hd|sd)_url"\s*:\s*"((?:\\.|[^"\\])*)"/g;
        const hdUrls = [];
        const sdUrls = [];
        let delMatch;
        while ((delMatch = deliveryPattern.exec(html)) !== null) {
            const around = html.slice(Math.max(0, delMatch.index - 8_000), delMatch.index + 200);
            if (!around.includes(videoId))
                continue;
            const url = (() => {
                try {
                    return new URL(unescapeFbUrl(delMatch[1]), pageUrl).toString();
                }
                catch {
                    return '';
                }
            })();
            if (!url || !looksLikeVideoUrl(url))
                continue;
            if (delMatch[0].includes('hd_url'))
                hdUrls.push(url);
            else
                sdUrls.push(url);
        }
        for (const url of [...hdUrls, ...sdUrls]) {
            if (!media.includes(url))
                media.push(url);
            if (media.length >= MAX_MEDIA_PER_SOURCE)
                break;
        }
    }
    return media.slice(0, MAX_MEDIA_PER_SOURCE);
}
function stablePostId(parts) {
    const key = parts
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join('|')
        .slice(0, 2000);
    return `url:${crypto_1.default.createHash('sha1').update(key).digest('hex').slice(0, 24)}`;
}
function accountLabelFromUrl(target, platform) {
    const host = target.hostname.replace(/^www\./, '');
    const path = target.pathname.replace(/\/+$/, '');
    if (isFacebookHost(host)) {
        const parts = path.split('/').filter(Boolean);
        if (parts[0] === 'profile.php') {
            const id = target.searchParams.get('id');
            return id ? `Facebook profile ${id}` : 'Facebook profile';
        }
        if (parts[0] && !['posts', 'photos', 'videos', 'reel', 'watch', 'share'].includes(parts[0])) {
            return parts[0];
        }
        return 'Facebook';
    }
    if (isLinkedInHost(host)) {
        const parts = path.split('/').filter(Boolean);
        if ((parts[0] === 'in' || parts[0] === 'company') && parts[1])
            return parts[1].replace(/-/g, ' ');
        return 'LinkedIn';
    }
    if (platform === 'twitter')
        return 'X profile';
    if (platform === 'instagram')
        return 'Instagram';
    if (platform === 'threads')
        return 'Threads';
    return host;
}
function inferPlatform(target, preferred) {
    if (preferred)
        return preferred;
    const host = target.hostname.replace(/^www\./, '').toLowerCase();
    if (isFacebookHost(host))
        return 'facebook';
    if (isLinkedInHost(host)) {
        if (target.pathname.includes('/company/'))
            return 'linkedin_page';
        return 'linkedin';
    }
    if (host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')) {
        return 'twitter';
    }
    if (host === 'instagram.com' || host.endsWith('.instagram.com'))
        return 'instagram';
    if (host === 'threads.net' || host.endsWith('.threads.net'))
        return 'threads';
    if (host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com'))
        return 'youtube';
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com'))
        return 'tiktok';
    if (host === 'bsky.app' || host.endsWith('.bsky.social'))
        return 'bluesky';
    return 'facebook';
}
function looksLikeFacebookPostPath(pathname) {
    return /\/(posts|permalink|photo|photos|videos|reel|watch|share)\b/i.test(pathname)
        || /story_fbid|fbid=/i.test(pathname);
}
function looksLikeLinkedInPostPath(pathname) {
    return /\/(posts|feed\/update|pulse)\b/i.test(pathname);
}
/**
 * Media for a single post/reel page.
 * Prefer attachment-scoped extraction when a post_id is present; otherwise video
 * delivery URLs + non-avatar og:image. Never return the profile portrait.
 */
function facebookPostMedia(html, pageUrl) {
    const target = new URL(pageUrl);
    const isPost = looksLikeFacebookPostPath(target.pathname) || target.searchParams.has('story_fbid');
    if (!isPost)
        return [];
    // Try structured story media first (same path as profile timeline).
    const postId = /"post_id"\s*:\s*"(\d+)"\s*,\s*"creation_time"\s*:\s*\d+/.exec(html)?.[1]
        ?? /\/(?:reel|videos)\/(?:[^/"?#]+\/)?(\d{8,})/i.exec(target.pathname)?.[1]
        ?? null;
    if (postId) {
        const scoped = mediaForFacebookStory(html, postId, pageUrl);
        if (scoped.length)
            return scoped;
    }
    // Reel/video pages: delivery URLs + poster (t15), never bare profile og:image.
    const videos = pageVideoUrls(html, pageUrl);
    const media = [];
    // Poster first so the UI has a paint-able image even when the MP4 CDN blocks hotlinking.
    const ogImage = metaContent(html, 'og:image') ?? metaContent(html, 'og:image:url');
    if (ogImage) {
        try {
            const resolved = new URL(unescapeFbUrl(ogImage), pageUrl).toString();
            if (!isFacebookProfileOrChromeImage(resolved))
                pushUniqueUrl(media, resolved, pageUrl);
        }
        catch {
            // ignore
        }
    }
    for (const url of videos) {
        if (!media.includes(url))
            media.push(url);
        if (media.length >= MAX_MEDIA_PER_SOURCE)
            break;
    }
    return media.slice(0, MAX_MEDIA_PER_SOURCE);
}
function toPost(input) {
    const body = input.text.trim();
    const mediaUrls = (input.mediaUrls ?? []).filter(Boolean).slice(0, MAX_MEDIA_PER_SOURCE);
    if (!body && !mediaUrls.length)
        return null;
    return {
        id: stablePostId(input.idParts ?? [input.url, body.slice(0, 280)]),
        text: body,
        createdAt: input.createdAt ?? null,
        url: input.url,
        accountName: input.accountName,
        mediaUrls,
    };
}
async function fetchHtml(url) {
    const response = await axios_1.default.get(url, {
        timeout: FETCH_TIMEOUT_MS,
        responseType: 'text',
        transformResponse: (value) => value,
        maxRedirects: 5,
        decompress: true,
        validateStatus: () => true,
        headers: {
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'User-Agent': USER_AGENT,
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Upgrade-Insecure-Requests': '1',
        },
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`The page returned HTTP ${response.status}. If the profile is private or login-walled, paste a public post URL instead.`);
    }
    const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    const finalUrl = typeof response.request?.res?.responseUrl === 'string'
        ? response.request.res.responseUrl
        : url;
    return { html, finalUrl };
}
/**
 * Facebook seconds-since-epoch creation_time values can arrive as either classic
 * unix seconds (~1e9) or a higher-resolution clock. Normalize to ms.
 */
function facebookTimeToMs(value) {
    if (value == null || !Number.isFinite(value) || value <= 0)
        return null;
    // Already ms
    if (value > 1e12)
        return value;
    // Classic unix seconds
    if (value < 2e10)
        return value * 1000;
    // Some FB payloads use a non-unix "FB epoch" style large second count —
    // still usable for relative ordering; treat as seconds.
    return value * 1000;
}
function postsFromFacebook(html, pageUrl, accountName) {
    const target = new URL(pageUrl);
    const isPost = looksLikeFacebookPostPath(target.pathname) || target.searchParams.has('story_fbid');
    if (isPost) {
        const textValue = facebookPostTextFromHtml(html)
            ?? metaContent(html, 'og:description')
            ?? metaContent(html, 'description');
        const media = facebookPostMedia(html, pageUrl);
        const post = toPost({
            text: textValue ?? '',
            url: pageUrl,
            accountName,
            mediaUrls: media,
            idParts: [pageUrl, textValue],
        });
        return post ? [post] : [];
    }
    // Profile / timeline: all readable stories sorted by real publish time.
    // Pinned posts stay in the list (for milestone selection) but sort by creation
    // time so an old pin is never treated as the newest post.
    const stories = facebookStoriesFromHtml(html, pageUrl);
    if (stories.length) {
        const ordered = stories
            .filter((story) => story.text.trim() || story.mediaUrls.length)
            .sort((a, b) => {
            const aTime = a.creationTime ?? 0;
            const bTime = b.creationTime ?? 0;
            if (bTime !== aTime)
                return bTime - aTime;
            // Same timestamp (or none): prefer non-pinned, then stable id.
            if (a.pinned !== b.pinned)
                return a.pinned ? 1 : -1;
            return a.postId.localeCompare(b.postId);
        });
        const posts = ordered
            .map((story) => toPost({
            text: story.text || (story.mediaUrls.length ? 'Media post' : ''),
            url: story.url || pageUrl,
            accountName,
            // Per-story media only — never the profile og:image avatar.
            mediaUrls: story.mediaUrls,
            createdAt: facebookTimeToMs(story.creationTime),
            idParts: [story.postId, story.url, story.text.slice(0, 280)],
        }))
            .filter((post) => Boolean(post));
        if (posts.length)
            return posts;
    }
    // Fallback: message texts only, no profile-pic media.
    const timeline = facebookTimelineTexts(html);
    if (timeline.length) {
        return timeline
            .map((body) => toPost({
            text: body,
            url: pageUrl,
            accountName,
            mediaUrls: [],
            idParts: [pageUrl, body.slice(0, 280)],
        }))
            .filter((post) => Boolean(post));
    }
    const fallback = facebookPostTextFromHtml(html)
        ?? metaContent(html, 'og:description')
        ?? metaContent(html, 'description');
    // Never attach profile og:image on a profile page fallback.
    const post = toPost({
        text: fallback ?? '',
        url: pageUrl,
        accountName,
        mediaUrls: [],
        idParts: [pageUrl, fallback],
    });
    return post ? [post] : [];
}
function postsFromLinkedIn(html, pageUrl, accountName) {
    const media = pageImageUrls(html, pageUrl);
    const target = new URL(pageUrl);
    const ogTitle = metaContent(html, 'og:title');
    const ogDescription = metaContent(html, 'og:description') ?? metaContent(html, 'description');
    if (looksLikeLinkedInPostPath(target.pathname)) {
        const body = [ogTitle, ogDescription].filter(Boolean).join('\n\n')
            || (0, readable_1.extractReadableText)(html).text;
        const post = toPost({
            text: body,
            url: pageUrl,
            accountName,
            mediaUrls: media,
            idParts: [pageUrl, body.slice(0, 280)],
        });
        return post ? [post] : [];
    }
    // Profile pages: og:description is usually the headline, not a post. Prefer
    // readable article-like content; if thin, surface headline as the snapshot.
    const readable = (0, readable_1.extractReadableText)(html);
    const body = readable.text.trim().length > 80
        ? readable.text.trim()
        : [ogTitle, ogDescription].filter(Boolean).join('\n\n');
    const post = toPost({
        text: body,
        url: pageUrl,
        accountName: accountName || ogTitle || 'LinkedIn',
        mediaUrls: media,
        idParts: [pageUrl, body.slice(0, 280)],
    });
    return post ? [post] : [];
}
function postsFromGeneric(html, pageUrl, accountName) {
    const media = pageImageUrls(html, pageUrl);
    const readable = (0, readable_1.extractReadableText)(html);
    const ogDescription = metaContent(html, 'og:description') ?? metaContent(html, 'description');
    const title = readable.title || metaContent(html, 'og:title') || pageTitle(html);
    const body = readable.text.trim() || [title, ogDescription].filter(Boolean).join('\n\n');
    const post = toPost({
        text: body,
        url: pageUrl,
        accountName: accountName || title || new URL(pageUrl).hostname,
        mediaUrls: media,
        idParts: [pageUrl, body.slice(0, 280)],
    });
    return post ? [post] : [];
}
function normalizeWatchUrl(raw) {
    const value = String(raw ?? '').trim();
    if (!value)
        throw new Error('Paste a public profile or post URL to watch.');
    let target;
    try {
        target = new URL(value.includes('://') ? value : `https://${value}`);
    }
    catch {
        throw new Error('That does not look like a valid URL.');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error('Only http(s) URLs can be watched.');
    }
    return target;
}
function watchAccountName(url, platform) {
    try {
        const target = normalizeWatchUrl(url);
        return accountLabelFromUrl(target, platform ?? inferPlatform(target, platform));
    }
    catch {
        return 'Watch URL';
    }
}
/** Extra profile URLs that sometimes surface more timeline units than the root. */
function facebookProfileFetchUrls(target) {
    const host = target.hostname.replace(/^www\./, '');
    if (!isFacebookHost(host))
        return [target.toString()];
    if (looksLikeFacebookPostPath(target.pathname) || target.searchParams.has('story_fbid')) {
        return [target.toString()];
    }
    const path = target.pathname.replace(/\/+$/, '') || '';
    const parts = path.split('/').filter(Boolean);
    // Already on /posts or similar — just the given URL.
    if (parts.some((part) => ['posts', 'photos', 'videos', 'reels'].includes(part.toLowerCase()))) {
        return [target.toString()];
    }
    const origin = `${target.protocol}//${target.hostname}`;
    const basePath = path || '';
    const root = `${origin}${basePath || '/'}`;
    const cleaned = root.replace(/\/+$/, '');
    const variants = [
        target.toString(),
        `${cleaned}/`,
        `${cleaned}/posts`,
        `${cleaned}/posts/`,
    ];
    // profile.php?id=… → also try posts tab via sk=
    if (parts[0] === 'profile.php' && target.searchParams.get('id')) {
        const id = target.searchParams.get('id');
        variants.push(`${origin}/profile.php?id=${encodeURIComponent(id)}&sk=posts`);
    }
    return Array.from(new Set(variants));
}
function mergeChannelPosts(into, extra) {
    const byId = new Map();
    for (const post of [...into, ...extra]) {
        const existing = byId.get(post.id);
        if (!existing) {
            byId.set(post.id, post);
            continue;
        }
        // Prefer the richer snapshot (more text / media / newer timestamp).
        const richer = (post.text?.length ?? 0) > (existing.text?.length ?? 0)
            || (post.mediaUrls?.length ?? 0) > (existing.mediaUrls?.length ?? 0)
            || (post.createdAt ?? 0) > (existing.createdAt ?? 0);
        if (richer) {
            byId.set(post.id, {
                ...existing,
                ...post,
                text: post.text?.trim() ? post.text : existing.text,
                mediaUrls: post.mediaUrls.length ? post.mediaUrls : existing.mediaUrls,
                createdAt: post.createdAt ?? existing.createdAt,
                url: post.url ?? existing.url,
            });
        }
    }
    return Array.from(byId.values()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
/**
 * Fetch a public profile/post URL and return the latest readable post snapshot(s).
 * Profile feeds that require login return an empty list or throw with a clear error.
 * For Facebook profiles we try a few URL variants and merge until we have enough
 * recent posts for milestone selection (at least 3 when the page exposes them).
 */
async function listPostsFromWatchUrl(input) {
    const target = normalizeWatchUrl(input.url);
    const platform = inferPlatform(target, input.platform ?? null);
    // Always aim for at least 3 recent posts when the source can provide them.
    const limit = Math.max(3, Math.min(20, input.limit ?? 5));
    const minDesired = Math.min(3, limit);
    const candidates = isFacebookHost(target.hostname.replace(/^www\./, ''))
        ? facebookProfileFetchUrls(target)
        : [target.toString()];
    let posts = [];
    let lastLoginWall = null;
    let anyHtml = false;
    for (const candidate of candidates) {
        if (posts.length >= limit)
            break;
        try {
            const { html, finalUrl } = await fetchHtml(candidate);
            anyHtml = true;
            const pageUrl = finalUrl || candidate;
            const accountName = accountLabelFromUrl(new URL(pageUrl), platform);
            // Login walls often still return 200 with an auth interstitial.
            if (/log\s*in\s*to\s*(continue|facebook|linkedin)|sign\s*in\s*to\s*linkedin|authwall/i.test(html)
                && !facebookPostTextFromHtml(html)
                && !(metaContent(html, 'og:description') ?? '').trim()) {
                lastLoginWall = new Error('That page looks login-walled. Use a public post URL, or a connected account when the channel supports it.');
                continue;
            }
            let batch;
            if (isFacebookHost(new URL(pageUrl).hostname)) {
                batch = postsFromFacebook(html, pageUrl, accountName);
            }
            else if (isLinkedInHost(new URL(pageUrl).hostname)) {
                batch = postsFromLinkedIn(html, pageUrl, accountName);
            }
            else {
                batch = postsFromGeneric(html, pageUrl, accountName);
            }
            posts = mergeChannelPosts(posts, batch);
            // Enough posts for milestone UI — stop extra profile fetches.
            if (posts.length >= minDesired && posts.length >= Math.min(limit, 5))
                break;
        }
        catch (error) {
            // Keep trying variants; surface the last real error only if nothing worked.
            lastLoginWall = error instanceof Error ? error : new Error(String(error));
        }
    }
    if (!posts.length) {
        if (lastLoginWall)
            throw lastLoginWall;
        if (!anyHtml) {
            throw new Error('Could not fetch that URL. Check the link and try again.');
        }
        throw new Error('No readable posts found at that URL. Private profiles and heavily scripted feeds often block scrapers — try a public post permalink.');
    }
    // Prefer real timestamps when present (newest first).
    posts = [...posts].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return posts.slice(0, limit);
}
//# sourceMappingURL=urlWatch.js.map