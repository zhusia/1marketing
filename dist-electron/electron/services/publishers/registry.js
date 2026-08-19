"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.oauth1Header = oauth1Header;
exports.facebookPageIdsForProject = facebookPageIdsForProject;
exports.suggestedOutputFormatForPlatform = suggestedOutputFormatForPlatform;
exports.getPublisher = getPublisher;
exports.listPlatformDescriptors = listPlatformDescriptors;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const url_1 = require("url");
const electron_1 = require("electron");
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const customApiTemplate_1 = require("./customApiTemplate");
const relayFiles_1 = require("./relayFiles");
const textLimits_1 = require("./textLimits");
/** Keep unsupported channels honest: lack of an API and lack of a usable connector transport differ. */
function noComments(unsupportedReason) {
    return {
        supported: false,
        chain: 'none',
        maxChars: null,
        supportsMedia: false,
        maxCount: null,
        unsupportedReason,
    };
}
/**
 * X / Bluesky / Mastodon / Threads / Telegram — a follow-up is the next post in the thread.
 * `supportsMedia` is false everywhere for now: comment() posts text only, so promising media
 * would let the composer accept an attachment that silently never appears.
 */
function threadComments(maxChars, overrides = {}) {
    return { supported: true, chain: 'thread', maxChars, supportsMedia: false, maxCount: 10, ...overrides };
}
/** LinkedIn / WordPress / Meta — every comment attaches to the root post, never to each other. */
function flatComments(maxChars, overrides = {}) {
    return { supported: true, chain: 'flat', maxChars, supportsMedia: false, maxCount: 10, ...overrides };
}
function pick(source, ...keys) {
    if (!source)
        return null;
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    return null;
}
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, '');
}
function ensureUrl(value) {
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}
function errMessage(error) {
    if (axios_1.default.isAxiosError(error)) {
        const data = error.response?.data;
        const detail = typeof data === 'string' ? data : data ? JSON.stringify(data).slice(0, 300) : '';
        return `${error.response?.status ?? ''} ${error.message}${detail ? ` — ${detail}` : ''}`.trim();
    }
    return error instanceof Error ? error.message : 'Unknown error';
}
function ok(url, response, message, artifacts) {
    return { ok: true, url, response, message, artifacts };
}
function fail(error) {
    return { ok: false, url: null, response: {}, error };
}
/** Resolve a PostMedia.path (absolute fs path or mt-local-file://localhost / file:// URL) to a readable fs path. */
function localFilePath(p) {
    if (/^mt-local-file:\/\//i.test(p))
        return (0, url_1.fileURLToPath)(p.replace(/^mt-local-file:\/\/(localhost)?/i, 'file://'));
    if (/^file:\/\//i.test(p))
        return (0, url_1.fileURLToPath)(p);
    return p;
}
/** Best-effort image MIME from an explicit type or the file extension. */
function imageMime(filePath, type) {
    if (type && type.includes('/'))
        return type;
    const ext = filePath.toLowerCase().split('.').pop() ?? '';
    if (ext === 'png')
        return 'image/png';
    if (ext === 'gif')
        return 'image/gif';
    if (ext === 'webp')
        return 'image/webp';
    return 'image/jpeg';
}
function isImageMedia(item) {
    return /image/i.test(item.type) || /\.(png|jpe?g|gif|webp)$/i.test(item.path);
}
function readImageFile(item) {
    const filePath = localFilePath(item.path);
    const buffer = fs_1.default.readFileSync(filePath);
    const filename = filePath.split(/[\\/]/).pop() || 'image';
    return { buffer, filename, contentType: imageMime(filePath, item.type), alt: item.alt ?? null };
}
/** Read every image attached to a post off disk, in order. Empty when there are none. */
function allImageFiles(media) {
    return media.filter(isImageMedia).map(readImageFile);
}
/**
 * Instagram's image container accepts JPEG only, so PNG (and other) images must be re-encoded first.
 * Uses Electron's built-in `nativeImage` (no extra dependency). If the source can't be decoded it is
 * passed through unchanged so Instagram surfaces the real error rather than us swallowing it.
 */
function toInstagramJpeg(file) {
    if (/jpe?g/i.test(file.contentType))
        return { buffer: file.buffer, contentType: 'image/jpeg' };
    const image = electron_1.nativeImage.createFromBuffer(file.buffer);
    if (image.isEmpty())
        return { buffer: file.buffer, contentType: file.contentType };
    return { buffer: image.toJPEG(90), contentType: 'image/jpeg' };
}
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
function isVideoMedia(item) {
    return /video/i.test(item.type) || VIDEO_EXT.test(item.path);
}
/** Best-effort video MIME from an explicit type or the file extension. */
function videoMime(filePath, type) {
    if (type && type.includes('/'))
        return type;
    const ext = filePath.toLowerCase().split('.').pop() ?? '';
    if (ext === 'mov')
        return 'video/quicktime';
    if (ext === 'webm')
        return 'video/webm';
    if (ext === 'm4v')
        return 'video/x-m4v';
    if (ext === 'avi')
        return 'video/x-msvideo';
    if (ext === 'mkv')
        return 'video/x-matroska';
    return 'video/mp4';
}
function readVideoFile(item) {
    const filePath = localFilePath(item.path);
    const buffer = fs_1.default.readFileSync(filePath);
    const filename = filePath.split(/[\\/]/).pop() || 'video';
    return { buffer, filename, contentType: videoMime(filePath, item.type), alt: item.alt ?? null };
}
/** Read every video attached to a post off disk, in order. Empty when there are none. */
function allVideoFiles(media) {
    return media.filter(isVideoMedia).map(readVideoFile);
}
/** Read every image/video attached to a post off disk, in original order, each tagged by kind. */
function allMediaFiles(media) {
    return media
        .filter((item) => isImageMedia(item) || isVideoMedia(item))
        .map((item) => {
        const kind = isVideoMedia(item) ? 'video' : 'image';
        const file = kind === 'video' ? readVideoFile(item) : readImageFile(item);
        return { ...file, kind };
    });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** RFC3986 percent-encoding — stricter than encodeURIComponent (also escapes !*'()), as OAuth 1.0a requires. */
function oauthEncode(value) {
    return encodeURIComponent(value).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
/**
 * Build an OAuth 1.0a (HMAC-SHA1) Authorization header for X's API.
 * The signature base string includes the oauth_* params plus any URL query params (or
 * x-www-form-urlencoded body params). For JSON or multipart/form-data bodies the body is NOT signed, so
 * those callers pass no `extraParams`. Pass the query params via `extraParams` for signed GETs (e.g. the
 * chunked-upload STATUS call). `extraParams` are signed but never placed in the Authorization header.
 */
function oauth1Header(method, url, creds, extraParams = {}) {
    const params = {
        oauth_consumer_key: creds.apiKey,
        oauth_nonce: crypto_1.default.randomBytes(16).toString('hex'),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: String(Math.floor(Date.now() / 1000)),
        oauth_token: creds.accessToken,
        oauth_version: '1.0',
    };
    const signedParams = { ...params, ...extraParams };
    const paramString = Object.keys(signedParams)
        .sort()
        .map((key) => `${oauthEncode(key)}=${oauthEncode(signedParams[key])}`)
        .join('&');
    const base = `${method}&${oauthEncode(url)}&${oauthEncode(paramString)}`;
    const signingKey = `${oauthEncode(creds.apiSecret)}&${oauthEncode(creds.accessTokenSecret)}`;
    params.oauth_signature = crypto_1.default.createHmac('sha1', signingKey).update(base).digest('base64');
    return ('OAuth ' +
        Object.keys(params)
            .sort()
            .map((key) => `${oauthEncode(key)}="${oauthEncode(params[key])}"`)
            .join(', '));
}
const telegram = {
    platform: 'telegram',
    descriptor: {
        platform: 'telegram',
        label: 'Telegram',
        implemented: true,
        authKind: 'bot_token',
        maxChars: 4096,
        supportsMedia: true,
        supportsAltText: false,
        notes: 'Bot token + target chat id. Bot must be an admin of the channel. Attaches images and videos — several post as one album (up to 10, photos + videos can mix); caption ≤1024 chars.',
        comments: threadComments(4096),
    },
    async publish(input, secret, config) {
        const token = pick(secret, 'botToken', 'token');
        const chatId = pick(config, 'chatId', 'chat_id') ?? pick(secret, 'chatId', 'chat_id');
        if (!token)
            return fail('Telegram bot token is missing.');
        if (!chatId)
            return fail('Telegram chat id is missing (set it in the connector config).');
        const api = (method) => `https://api.telegram.org/bot${token}/${method}`;
        const caption = input.body.slice(0, 1024); // Telegram caps captions at 1024 chars.
        // Best-effort public permalink: only public channels (@username) have a guessable t.me URL.
        const buildUrl = (response) => {
            const result = response?.result;
            const message = Array.isArray(result) ? result[0] : result;
            const messageId = message?.message_id;
            if (!messageId || !chatId.startsWith('@'))
                return null;
            return `https://t.me/${chatId.slice(1)}/${messageId}`;
        };
        // Follow-up comments reply to this message id, so it has to be persisted — a t.me permalink only
        // exists for public @channels, and private chats would otherwise leave nothing to reply to.
        const artifactFor = (response) => {
            const result = response?.result;
            const message = Array.isArray(result) ? result[0] : result;
            const messageId = message?.message_id;
            if (!messageId)
                return undefined;
            return [{
                    remotePostId: String(messageId),
                    remoteAccountId: chatId,
                    url: buildUrl(response) ?? undefined,
                    kind: 'message',
                    providerMetadata: { chatId, messageId },
                }];
        };
        try {
            const media = allMediaFiles(input.media);
            // No media → plain text message.
            if (media.length === 0) {
                const { data } = await axios_1.default.post(api('sendMessage'), { chat_id: chatId, text: input.body, disable_web_page_preview: false }, { timeout: 15000 });
                return ok(buildUrl(data), data ?? {}, undefined, artifactFor(data));
            }
            // One item → sendPhoto/sendVideo; 2–10 → sendMediaGroup (photos + videos can mix). Telegram caps an
            // album at 10, so chunk beyond that into multiple albums; the caption rides only the first message.
            const sendChunk = async (chunk, withCaption) => {
                if (chunk.length === 1) {
                    const item = chunk[0];
                    const method = item.kind === 'video' ? 'sendVideo' : 'sendPhoto';
                    const field = item.kind === 'video' ? 'video' : 'photo';
                    const form = new form_data_1.default();
                    form.append('chat_id', chatId);
                    if (withCaption && caption)
                        form.append('caption', caption);
                    form.append(field, item.buffer, { filename: item.filename, contentType: item.contentType });
                    const { data } = await axios_1.default.post(api(method), form, {
                        headers: form.getHeaders(),
                        timeout: 120000,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                    });
                    return data;
                }
                const form = new form_data_1.default();
                form.append('chat_id', chatId);
                form.append('media', JSON.stringify(chunk.map((item, index) => {
                    const entry = {
                        type: item.kind === 'video' ? 'video' : 'photo',
                        media: `attach://file${index}`,
                    };
                    if (index === 0 && withCaption && caption)
                        entry.caption = caption;
                    return entry;
                })));
                chunk.forEach((item, index) => form.append(`file${index}`, item.buffer, { filename: item.filename, contentType: item.contentType }));
                const { data } = await axios_1.default.post(api('sendMediaGroup'), form, {
                    headers: form.getHeaders(),
                    timeout: 120000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });
                return data;
            };
            let firstResponse = null;
            for (let start = 0; start < media.length; start += 10) {
                const response = await sendChunk(media.slice(start, start + 10), start === 0);
                if (start === 0)
                    firstResponse = response;
            }
            return ok(buildUrl(firstResponse), firstResponse ?? {}, undefined, artifactFor(firstResponse));
        }
        catch (error) {
            const raw = errMessage(error);
            // Telegram's terse "chat not found" / rights errors are the #1 setup snag — add actionable guidance.
            if (/chat not found/i.test(raw)) {
                return fail('Telegram could not find that chat. Add the bot to the target group/channel first (for channels, make it ' +
                    'an admin with the “Post messages” permission), then use the chat’s real id — supergroups and channels ' +
                    'use a -100… id (read it from @getidsbot or the bot’s getUpdates response). A public channel’s ' +
                    '@username also works.');
            }
            if (/not enough rights|administrator rights|CHAT_ADMIN_REQUIRED/i.test(raw)) {
                return fail('The bot is in the chat but lacks permission to post. Promote it to admin with the “Post messages” right, then retry.');
            }
            return fail(raw);
        }
    },
    async comment(input, secret, config) {
        const token = pick(secret, 'botToken', 'token');
        const chatId = pick(config, 'chatId', 'chat_id') ?? pick(secret, 'chatId', 'chat_id');
        if (!token)
            return fail('Telegram bot token is missing.');
        if (!chatId)
            return fail('Telegram chat id is missing (set it in the connector config).');
        const replyTo = Number(input.parent.remoteId);
        if (!Number.isFinite(replyTo))
            return fail('Telegram message id for the parent post is unavailable.');
        try {
            const { data } = await axios_1.default.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text: input.body, reply_to_message_id: replyTo, allow_sending_without_reply: true }, { timeout: 15000 });
            const messageId = data?.result?.message_id;
            const url = messageId && chatId.startsWith('@') ? `https://t.me/${chatId.slice(1)}/${messageId}` : null;
            return ok(url, data ?? {}, undefined, messageId
                ? [{
                        remotePostId: String(messageId),
                        remoteParentId: String(replyTo),
                        remoteAccountId: chatId,
                        url: url ?? undefined,
                        kind: 'message',
                        providerMetadata: { chatId, messageId },
                    }]
                : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const discord = {
    platform: 'discord',
    descriptor: {
        platform: 'discord',
        label: 'Discord',
        implemented: true,
        authKind: 'webhook',
        maxChars: 2000,
        supportsMedia: true,
        supportsAltText: false,
        notes: 'Channel webhook URL. Attaches up to 10 images/videos (photos + videos can mix) as file uploads; otherwise posts text.',
        comments: noComments('Discord incoming webhooks cannot reply to the original message or create a thread without bot credentials.'),
    },
    async publish(input, secret, config) {
        const webhook = pick(config, 'webhookUrl', 'webhook_url') ?? pick(secret, 'webhookUrl', 'webhook_url');
        if (!webhook)
            return fail('Discord webhook URL is missing.');
        // ?wait=true returns the created message (so we capture its id) instead of a bare 204.
        const waitUrl = `${webhook}${webhook.includes('?') ? '&' : '?'}wait=true`;
        const artifactFor = (record) => {
            const id = typeof record.id === 'string' ? record.id : null;
            if (!id)
                return null;
            return {
                remotePostId: id,
                remoteAccountId: typeof record.channel_id === 'string' ? record.channel_id : undefined,
                kind: 'message',
            };
        };
        try {
            const media = allMediaFiles(input.media);
            // No media → plain JSON text post.
            if (media.length === 0) {
                const { data } = await axios_1.default.post(waitUrl, { content: input.body }, { timeout: 15000 });
                const record = data ?? {};
                const artifact = artifactFor(record);
                return ok(null, record, undefined, artifact ? [artifact] : undefined);
            }
            // Up to 10 files per message (images + videos can mix); chunk beyond that. payload_json carries the
            // content (text only on the first message so it isn't repeated), files[n] carry the uploads.
            const messages = [];
            for (let start = 0; start < media.length; start += 10) {
                const chunk = media.slice(start, start + 10);
                const form = new form_data_1.default();
                form.append('payload_json', JSON.stringify({ content: start === 0 ? input.body : '' }));
                chunk.forEach((item, index) => form.append(`files[${index}]`, item.buffer, { filename: item.filename, contentType: item.contentType }));
                const { data } = await axios_1.default.post(waitUrl, form, {
                    headers: form.getHeaders(),
                    timeout: 120000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });
                messages.push(data ?? {});
            }
            return ok(null, { messages }, undefined, messages.map(artifactFor).filter((artifact) => artifact != null));
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const slack = {
    platform: 'slack',
    descriptor: {
        platform: 'slack',
        label: 'Slack',
        implemented: true,
        authKind: 'webhook',
        maxChars: 40000,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'Incoming webhook URL. Text only — attached images and video are not posted (Slack incoming webhooks can\'t upload files; that needs a Web API token).',
        comments: noComments('Slack incoming webhooks do not return the root message timestamp, and this connector has no bot token to look it up.'),
    },
    async publish(input, secret, config) {
        const webhook = pick(config, 'webhookUrl', 'webhook_url') ?? pick(secret, 'webhookUrl', 'webhook_url');
        if (!webhook)
            return fail('Slack webhook URL is missing.');
        try {
            const { data } = await axios_1.default.post(webhook, { text: input.body }, { timeout: 15000 });
            return ok(null, { result: data });
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const mastodon = {
    platform: 'mastodon',
    descriptor: {
        platform: 'mastodon',
        label: 'Mastodon',
        implemented: true,
        authKind: 'access_token',
        maxChars: 500,
        supportsMedia: true,
        supportsAltText: true,
        notes: 'Instance URL + access token. Limit is instance-configurable. Attaches up to 4 images, or a video, per toot (Mastodon never mixes them); a post with both publishes as separate toots.',
        comments: threadComments(500),
    },
    async publish(input, secret, config) {
        const instance = pick(config, 'instanceUrl', 'instance_url', 'instance') ?? pick(secret, 'instanceUrl', 'instance');
        const token = pick(secret, 'accessToken', 'token', 'access_token');
        if (!instance)
            return fail('Mastodon instance URL is missing.');
        if (!token)
            return fail('Mastodon access token is missing.');
        const base = trimTrailingSlash(ensureUrl(instance));
        const status = (0, textLimits_1.limitPostText)(input.body, 500);
        const successMessage = status.shortened
            ? 'Mastodon published successfully. The post was shortened to the 500-character limit.'
            : undefined;
        // Upload one file to /api/v2/media → id. Video/large media returns 202 (still processing); poll
        // GET /api/v1/media/:id until it's ready (200) before attaching, so we fail fast on processing errors.
        const uploadMedia = async (file) => {
            const form = new form_data_1.default();
            form.append('file', file.buffer, { filename: file.filename, contentType: file.contentType });
            if (file.alt)
                form.append('description', file.alt);
            const upload = await axios_1.default.post(`${base}/api/v2/media`, form, {
                headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` },
                timeout: 120000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                validateStatus: (status) => status === 200 || status === 202,
            });
            const id = upload.data?.id;
            if (!id)
                throw new Error('Mastodon did not return a media id.');
            if (upload.status === 202) {
                for (let attempt = 0; attempt < 30; attempt++) {
                    await delay(2000);
                    const check = await axios_1.default.get(`${base}/api/v1/media/${id}`, {
                        headers: { Authorization: `Bearer ${token}` },
                        timeout: 15000,
                        validateStatus: (status) => status === 200 || status === 206,
                    });
                    if (check.status === 200)
                        return id;
                }
                throw new Error('Mastodon media is still processing — try again shortly.');
            }
            return id;
        };
        const createStatus = async (mediaIds) => {
            const { data } = await axios_1.default.post(`${base}/api/v1/statuses`, mediaIds.length ? { status: status.text, media_ids: mediaIds } : { status: status.text }, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
            return data ?? {};
        };
        const artifactFor = (record) => {
            const id = typeof record.id === 'string' ? record.id : null;
            if (!id)
                return null;
            const accountId = record.account && typeof record.account === 'object' && typeof record.account.id === 'string'
                ? (record.account.id)
                : null;
            return {
                remotePostId: id,
                remoteAccountId: `${new URL(base).origin}${accountId ? `#${accountId}` : ''}`,
                url: typeof record.url === 'string' ? record.url : undefined,
                kind: 'post',
            };
        };
        try {
            // Mastodon allows up to 4 images, OR a single video, but never a mix. So photos post as one toot
            // (capped at 4) and each video posts as its own toot — a mixed post becomes separate toots.
            const images = allImageFiles(input.media).slice(0, 4);
            const videos = allVideoFiles(input.media);
            if (!images.length && !videos.length) {
                const record = await createStatus([]);
                const artifact = artifactFor(record);
                return ok(typeof record.url === 'string' ? record.url : null, record, successMessage, artifact ? [artifact] : undefined);
            }
            const records = [];
            const errors = [];
            if (images.length) {
                try {
                    const ids = [];
                    for (const image of images)
                        ids.push(await uploadMedia(image));
                    const record = await createStatus(ids);
                    records.push(record);
                }
                catch (error) {
                    errors.push(`images: ${errMessage(error)}`);
                }
            }
            for (const video of videos) {
                try {
                    const id = await uploadMedia(video);
                    const record = await createStatus([id]);
                    records.push(record);
                }
                catch (error) {
                    errors.push(`video: ${errMessage(error)}`);
                }
            }
            const artifacts = records
                .map(artifactFor)
                .filter((artifact) => artifact != null);
            const urls = records
                .map((record) => (typeof record.url === 'string' ? record.url : null))
                .filter((url) => url != null);
            if (!records.length)
                return fail(errors.join('; ') || 'Mastodon post failed.');
            if (errors.length) {
                return { ok: false, url: urls[0] ?? null, response: { records, urls }, error: errors.join('; '), artifacts };
            }
            return ok(urls[0] ?? null, { records, urls }, successMessage, artifacts);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
    async comment(input, secret, config) {
        const instance = pick(config, 'instanceUrl', 'instance_url', 'instance') ?? pick(secret, 'instanceUrl', 'instance');
        const token = pick(secret, 'accessToken', 'token', 'access_token');
        if (!instance)
            return fail('Mastodon instance URL is missing.');
        if (!token)
            return fail('Mastodon access token is missing.');
        const base = trimTrailingSlash(ensureUrl(instance));
        const status = (0, textLimits_1.limitPostText)(input.body, 500);
        try {
            const { data } = await axios_1.default.post(`${base}/api/v1/statuses`, { status: status.text, in_reply_to_id: input.parent.remoteId, visibility: 'public' }, { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
            const record = data ?? {};
            const id = typeof record.id === 'string' ? record.id : null;
            const url = typeof record.url === 'string' ? record.url : null;
            return ok(url, record, status.shortened ? 'Comment was shortened to the 500-character limit.' : undefined, id
                ? [{ remotePostId: id, remoteParentId: input.parent.remoteId, url: url ?? undefined, kind: 'post' }]
                : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const bluesky = {
    platform: 'bluesky',
    descriptor: {
        platform: 'bluesky',
        label: 'Bluesky',
        implemented: true,
        authKind: 'app_password',
        maxChars: 300,
        supportsMedia: true,
        supportsAltText: true,
        notes: 'Handle + app password (AT Protocol). No OAuth app required. Attaches up to 4 images (each ≤2MB), or an MP4 video (uploaded via the Bluesky video service). A post with both publishes as separate posts (Bluesky can\'t mix them).',
        comments: threadComments(300),
    },
    async publish(input, secret, config) {
        const service = trimTrailingSlash(pick(config, 'service') ?? 'https://bsky.social');
        const identifier = pick(secret, 'identifier', 'handle', 'username');
        const password = pick(secret, 'appPassword', 'password', 'app_password');
        if (!identifier || !password)
            return fail('Bluesky handle and app password are required.');
        const VIDEO_SERVICE = 'https://video.bsky.app';
        const postText = (0, textLimits_1.limitPostText)(input.body, 300, 3000);
        const successMessage = postText.shortened
            ? 'Bluesky published successfully. The post was shortened to the 300-character limit.'
            : undefined;
        try {
            const session = await axios_1.default.post(`${service}/xrpc/com.atproto.server.createSession`, { identifier, password }, { timeout: 15000 });
            const sessionData = session.data ?? {};
            const accessJwt = sessionData.accessJwt;
            const did = sessionData.did;
            if (!accessJwt || !did)
                return fail('Bluesky authentication failed.');
            // The video service needs a service-auth token scoped to the user's real PDS host — read it from the
            // session's DID document when present, else fall back to the connected service host.
            const didDoc = sessionData.didDoc;
            const pdsEndpoint = didDoc?.service?.find((entry) => entry?.id === '#atproto_pds')?.serviceEndpoint;
            const pdsHost = pdsEndpoint ? new URL(pdsEndpoint).host : new URL(service).host;
            // Create a feed post carrying the given embed (or none). Preserve the canonical AT URI;
            // analytics reads by URI and should never have to reconstruct it from the public URL.
            const createPost = async (embed) => {
                const record = {
                    $type: 'app.bsky.feed.post',
                    text: postText.text,
                    createdAt: new Date().toISOString(),
                };
                if (embed)
                    record.embed = embed;
                const { data } = await axios_1.default.post(`${service}/xrpc/com.atproto.repo.createRecord`, { repo: did, collection: 'app.bsky.feed.post', record }, { headers: { Authorization: `Bearer ${accessJwt}` }, timeout: 15000 });
                const uri = data?.uri ?? '';
                const cid = data?.cid ?? null;
                const rkey = uri.split('/').pop() ?? '';
                return rkey ? { uri, cid, url: `https://bsky.app/profile/${did}/post/${rkey}` } : null;
            };
            // Build an images embed by uploading each image as a blob (max 4).
            const buildImageEmbed = async (images) => {
                const embedImages = [];
                for (const image of images) {
                    const blobRes = await axios_1.default.post(`${service}/xrpc/com.atproto.repo.uploadBlob`, image.buffer, {
                        headers: { Authorization: `Bearer ${accessJwt}`, 'Content-Type': image.contentType },
                        timeout: 30000,
                        maxBodyLength: Infinity,
                    });
                    const blob = blobRes.data?.blob;
                    if (blob)
                        embedImages.push({ alt: image.alt ?? '', image: blob });
                }
                return embedImages.length ? { $type: 'app.bsky.embed.images', images: embedImages } : undefined;
            };
            // Build a video embed via the dedicated flow: mint a service-auth token, upload to video.bsky.app,
            // poll the transcode job until its blob is ready, then embed it. Bluesky only accepts MP4.
            const readJob = (data) => {
                const wrapped = data?.jobStatus;
                return (wrapped ?? data ?? {});
            };
            const buildVideoEmbed = async (video) => {
                if (!/^video\/mp4/i.test(video.contentType)) {
                    throw new Error(`Bluesky only supports MP4 video (got ${video.contentType || 'unknown type'}).`);
                }
                const authRes = await axios_1.default.get(`${service}/xrpc/com.atproto.server.getServiceAuth`, {
                    params: { aud: `did:web:${pdsHost}`, lxm: 'com.atproto.repo.uploadBlob', exp: Math.floor(Date.now() / 1000) + 1800 },
                    headers: { Authorization: `Bearer ${accessJwt}` },
                    timeout: 15000,
                });
                const serviceToken = authRes.data?.token;
                if (!serviceToken)
                    throw new Error('Bluesky did not issue a video service token.');
                let jobId;
                let blob;
                try {
                    const upload = await axios_1.default.post(`${VIDEO_SERVICE}/xrpc/app.bsky.video.uploadVideo`, video.buffer, {
                        params: { did, name: video.filename },
                        headers: {
                            Authorization: `Bearer ${serviceToken}`,
                            'Content-Type': 'video/mp4',
                            'Content-Length': String(video.buffer.length),
                        },
                        timeout: 180000,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                    });
                    const job = readJob(upload.data);
                    jobId = job.jobId;
                    blob = job.blob ?? null;
                }
                catch (error) {
                    // Re-uploading identical bytes returns 409 already_exists, but still carries a job we can poll.
                    if (axios_1.default.isAxiosError(error) && error.response?.status === 409) {
                        const job = readJob(error.response.data);
                        jobId = job.jobId;
                        blob = job.blob ?? null;
                    }
                    else {
                        throw error;
                    }
                }
                if (!jobId && !blob)
                    throw new Error('Bluesky did not start a video upload job.');
                for (let attempt = 0; !blob && jobId && attempt < 60; attempt++) {
                    await delay(3000);
                    const statusRes = await axios_1.default.get(`${VIDEO_SERVICE}/xrpc/app.bsky.video.getJobStatus`, {
                        params: { jobId },
                        headers: { Authorization: `Bearer ${serviceToken}` },
                        timeout: 15000,
                    });
                    const job = readJob(statusRes.data);
                    if (job.blob) {
                        blob = job.blob;
                        break;
                    }
                    if (job.state === 'JOB_STATE_FAILED') {
                        throw new Error(`Bluesky video processing failed: ${job.error ?? job.message ?? 'unknown error'}.`);
                    }
                }
                if (!blob)
                    throw new Error('Bluesky video is still processing — try again shortly.');
                return { $type: 'app.bsky.embed.video', video: blob };
            };
            // Bluesky's embed is a single union — images and video can't share a post, so a mixed post becomes
            // separate posts: up to 4 images in one, each video in its own.
            const images = allImageFiles(input.media).slice(0, 4);
            const videos = allVideoFiles(input.media);
            if (!images.length && !videos.length) {
                const post = await createPost();
                return ok(post?.url ?? null, post ?? {}, successMessage, post
                    ? [{
                            remotePostId: post.uri,
                            remoteAccountId: did,
                            url: post.url,
                            kind: 'post',
                            providerMetadata: post.cid ? { cid: post.cid } : undefined,
                        }]
                    : undefined);
            }
            const posts = [];
            const errors = [];
            if (images.length) {
                try {
                    const post = await createPost(await buildImageEmbed(images));
                    if (post)
                        posts.push(post);
                }
                catch (error) {
                    errors.push(`images: ${errMessage(error)}`);
                }
            }
            for (const video of videos) {
                try {
                    const post = await createPost(await buildVideoEmbed(video));
                    if (post)
                        posts.push(post);
                }
                catch (error) {
                    errors.push(`video: ${errMessage(error)}`);
                }
            }
            if (!posts.length)
                return fail(errors.join('; ') || 'Bluesky post failed.');
            const artifacts = posts.map((post) => ({
                remotePostId: post.uri,
                remoteAccountId: did,
                url: post.url,
                kind: 'post',
                providerMetadata: post.cid ? { cid: post.cid } : undefined,
            }));
            const urls = posts.map((post) => post.url);
            if (errors.length) {
                return { ok: false, url: urls[0], response: { posts, urls }, error: errors.join('; '), artifacts };
            }
            return ok(urls[0], { posts, urls }, successMessage, artifacts);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
    async comment(input, secret, config) {
        const service = trimTrailingSlash(pick(config, 'service') ?? 'https://bsky.social');
        const identifier = pick(secret, 'identifier', 'handle', 'username');
        const password = pick(secret, 'appPassword', 'password', 'app_password');
        if (!identifier || !password)
            return fail('Bluesky handle and app password are required.');
        // AT Protocol replies need a strong ref (uri + cid) for BOTH the thread root and the direct parent.
        // The cid is persisted in provider metadata at publish time — without it we cannot build a valid reply.
        const strongRef = (anchor) => {
            const cid = anchor.metadata?.cid;
            return typeof cid === 'string' && cid ? { uri: anchor.remoteId, cid } : null;
        };
        const root = strongRef(input.root);
        const parent = strongRef(input.parent);
        if (!root || !parent)
            return fail('Bluesky reply needs the original post’s record id (cid), which was not stored.');
        const text = (0, textLimits_1.limitPostText)(input.body, 300, 3000);
        try {
            const session = await axios_1.default.post(`${service}/xrpc/com.atproto.server.createSession`, { identifier, password }, { timeout: 15000 });
            const sessionData = session.data ?? {};
            const accessJwt = sessionData.accessJwt;
            const did = sessionData.did;
            if (!accessJwt || !did)
                return fail('Bluesky authentication failed.');
            const { data } = await axios_1.default.post(`${service}/xrpc/com.atproto.repo.createRecord`, {
                repo: did,
                collection: 'app.bsky.feed.post',
                record: {
                    $type: 'app.bsky.feed.post',
                    text: text.text,
                    createdAt: new Date().toISOString(),
                    reply: { root, parent },
                },
            }, { headers: { Authorization: `Bearer ${accessJwt}` }, timeout: 15000 });
            const uri = data?.uri ?? '';
            const cid = data?.cid ?? null;
            const rkey = uri.split('/').pop() ?? '';
            const url = rkey ? `https://bsky.app/profile/${did}/post/${rkey}` : null;
            return ok(url, data ?? {}, text.shortened ? 'Comment was shortened to the 300-character limit.' : undefined, uri
                ? [{
                        remotePostId: uri,
                        remoteParentId: input.parent.remoteId,
                        remoteAccountId: did,
                        url: url ?? undefined,
                        kind: 'post',
                        providerMetadata: cid ? { cid } : undefined,
                    }]
                : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const wordpress = {
    platform: 'wordpress',
    descriptor: {
        platform: 'wordpress',
        label: 'WordPress',
        implemented: true,
        authKind: 'basic_auth',
        maxChars: null,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'Site URL + username + application password (REST API). First line becomes the post title. Text/HTML only — attached images and video are not uploaded.',
        comments: flatComments(null, { supportsMedia: false }),
    },
    async publish(input, secret, config) {
        const baseUrl = pick(config, 'siteUrl', 'baseUrl', 'url', 'site_url');
        const username = pick(config, 'username') ?? pick(secret, 'username');
        const password = pick(secret, 'appPassword', 'password', 'application_password');
        if (!baseUrl)
            return fail('WordPress site URL is missing.');
        if (!username || !password)
            return fail('WordPress username and application password are required.');
        const lines = input.body.split('\n');
        const title = (lines[0] || 'New post').slice(0, 120);
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        const siteBase = trimTrailingSlash(ensureUrl(baseUrl));
        try {
            const { data } = await axios_1.default.post(`${siteBase}/wp-json/wp/v2/posts`, { title, content: input.body, status: 'publish' }, { headers: { Authorization: `Basic ${auth}` }, timeout: 20000 });
            const record = data ?? {};
            const url = typeof record.link === 'string' ? record.link : null;
            const id = typeof record.id === 'number' || typeof record.id === 'string' ? String(record.id) : null;
            return ok(url, record, undefined, id
                ? [{
                        remotePostId: id,
                        remoteAccountId: new URL(siteBase).origin,
                        url: url ?? undefined,
                        kind: 'article',
                    }]
                : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
    async comment(input, secret, config) {
        const baseUrl = pick(config, 'siteUrl', 'baseUrl', 'url', 'site_url');
        const username = pick(config, 'username') ?? pick(secret, 'username');
        const password = pick(secret, 'appPassword', 'password', 'application_password');
        if (!baseUrl)
            return fail('WordPress site URL is missing.');
        if (!username || !password)
            return fail('WordPress username and application password are required.');
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        const siteBase = trimTrailingSlash(ensureUrl(baseUrl));
        // WordPress comments are flat against the post; `parent` is only set when replying to a comment,
        // which never happens here because every follow-up anchors to the root post.
        try {
            const { data } = await axios_1.default.post(`${siteBase}/wp-json/wp/v2/comments`, { post: input.root.remoteId, content: input.body }, { headers: { Authorization: `Basic ${auth}` }, timeout: 20000 });
            const record = data ?? {};
            const id = record.id != null ? String(record.id) : null;
            const url = typeof record.link === 'string' ? record.link : null;
            return ok(url, record, undefined, id
                ? [{ remotePostId: id, remoteParentId: input.root.remoteId, url: url ?? undefined, kind: 'message' }]
                : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const ghost = {
    platform: 'ghost',
    descriptor: {
        platform: 'ghost',
        label: 'Ghost',
        implemented: true,
        authKind: 'access_token',
        maxChars: null,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'Admin API URL + Admin API key (id:secret). First line becomes the post title. Text/HTML only — attached images and video are not uploaded.',
        comments: noComments('Ghost does not expose member comment creation through its documented Admin API.'),
    },
    async publish(input, secret, config) {
        const apiUrl = pick(config, 'siteUrl', 'apiUrl', 'url', 'admin_url');
        const adminKey = pick(secret, 'adminApiKey', 'adminKey', 'key');
        if (!apiUrl)
            return fail('Ghost admin API URL is missing.');
        if (!adminKey || !adminKey.includes(':'))
            return fail('Ghost Admin API key (format id:secret) is required.');
        const [keyId, keySecret] = adminKey.split(':');
        const token = signGhostJwt(keyId, keySecret);
        const lines = input.body.split('\n');
        const title = (lines[0] || 'New post').slice(0, 120);
        try {
            const { data } = await axios_1.default.post(`${trimTrailingSlash(ensureUrl(apiUrl))}/ghost/api/admin/posts/?source=html`, { posts: [{ title, html: `<p>${input.body.replace(/\n/g, '<br/>')}</p>`, status: 'published' }] }, { headers: { Authorization: `Ghost ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 });
            const post = data?.posts?.[0] ?? {};
            return ok(typeof post.url === 'string' ? post.url : null, post);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
function base64url(input) {
    return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
/** Ghost Admin API uses a short-lived HS256 JWT signed with the hex-decoded key secret. */
function signGhostJwt(keyId, keySecret) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: keyId }));
    const iat = Math.floor(Date.now() / 1000);
    const payload = base64url(JSON.stringify({ iat, exp: iat + 300, aud: '/admin/' }));
    const data = `${header}.${payload}`;
    const signature = crypto_1.default.createHmac('sha256', Buffer.from(keySecret, 'hex')).update(data).digest();
    return `${data}.${base64url(signature)}`;
}
const twitter = {
    platform: 'twitter',
    descriptor: {
        platform: 'twitter',
        label: 'X / Twitter',
        implemented: true,
        authKind: 'oauth1',
        maxChars: 280,
        supportsMedia: true,
        supportsAltText: false,
        notes: 'Your own X dev app keys (OAuth 1.0a). Standard posts are 280 characters; set X post length to Premium / Premium+ in the channel config for up to 25,000 characters. Attaches up to 4 images, or a video, per post (X never mixes them).',
        comments: threadComments(280, { costWarning: 'On X a follow-up comment is a post, and posts with links cost more.' }),
    },
    async publish(input, secret) {
        const apiKey = pick(secret, 'apiKey');
        const apiSecret = pick(secret, 'apiSecret');
        const accessToken = pick(secret, 'accessToken');
        const accessTokenSecret = pick(secret, 'accessTokenSecret');
        if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
            return fail('X API keys are incomplete (need API key/secret + access token/secret).');
        }
        const creds = { apiKey, apiSecret, accessToken, accessTokenSecret };
        // X meters API writes; a 402 means the developer account has no credits — surface a plain-language
        // explanation instead of the raw "CreditsDepleted" payload (auth was fine; this is X's paywall).
        const xError = (error) => {
            if (axios_1.default.isAxiosError(error) && error.response?.status === 402) {
                return ('X has no API credits for this account (HTTP 402). X bills posting per request — add credits or pick a ' +
                    'plan with a posting allowance at developer.x.com → your Project → Subscriptions, then try again. ' +
                    'Your keys are valid; this is purely a billing limit on X’s side.');
            }
            return errMessage(error);
        };
        // v1.1 upload.twitter.com is sunset; media now uploads through the v2 command endpoint on api.x.com.
        const UPLOAD_URL = 'https://api.x.com/2/media/upload';
        const TWEET_URL = 'https://api.twitter.com/2/tweets';
        // Simple one-shot image upload → returns the media id string.
        const uploadImage = async (image) => {
            const form = new form_data_1.default();
            form.append('media', image.buffer, { filename: image.filename, contentType: image.contentType });
            form.append('media_category', 'tweet_image');
            form.append('media_type', image.contentType);
            const { data } = await axios_1.default.post(UPLOAD_URL, form, {
                headers: { ...form.getHeaders(), Authorization: oauth1Header('POST', UPLOAD_URL, creds) },
                timeout: 60000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
            const id = data?.data?.id;
            if (!id)
                throw new Error('X did not return a media id for the image.');
            return id;
        };
        // Chunked video upload: INIT → APPEND (≤5MB chunks) → FINALIZE → poll STATUS until processing succeeds.
        const uploadVideo = async (video) => {
            const totalBytes = video.buffer.length;
            const initForm = new form_data_1.default();
            initForm.append('command', 'INIT');
            initForm.append('total_bytes', String(totalBytes));
            initForm.append('media_type', video.contentType || 'video/mp4');
            initForm.append('media_category', 'tweet_video');
            const init = await axios_1.default.post(UPLOAD_URL, initForm, {
                headers: { ...initForm.getHeaders(), Authorization: oauth1Header('POST', UPLOAD_URL, creds) },
                timeout: 30000,
            });
            const mediaId = init.data?.data?.id;
            if (!mediaId)
                throw new Error('X did not return a media id for the video.');
            const CHUNK = 4 * 1024 * 1024; // 4MB, under the 5MB per-APPEND cap.
            let segment = 0;
            for (let offset = 0; offset < totalBytes; offset += CHUNK, segment++) {
                const chunk = video.buffer.subarray(offset, Math.min(offset + CHUNK, totalBytes));
                const appendForm = new form_data_1.default();
                appendForm.append('command', 'APPEND');
                appendForm.append('media_id', mediaId);
                appendForm.append('segment_index', String(segment));
                appendForm.append('media', chunk, { filename: `chunk${segment}`, contentType: 'application/octet-stream' });
                await axios_1.default.post(UPLOAD_URL, appendForm, {
                    headers: { ...appendForm.getHeaders(), Authorization: oauth1Header('POST', UPLOAD_URL, creds) },
                    timeout: 120000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });
            }
            const finalizeForm = new form_data_1.default();
            finalizeForm.append('command', 'FINALIZE');
            finalizeForm.append('media_id', mediaId);
            const finalize = await axios_1.default.post(UPLOAD_URL, finalizeForm, {
                headers: { ...finalizeForm.getHeaders(), Authorization: oauth1Header('POST', UPLOAD_URL, creds) },
                timeout: 30000,
            });
            // FINALIZE returns processing_info for video; poll STATUS (a GET → its query params must be signed).
            let info = finalize.data
                ?.data?.processing_info;
            for (let attempt = 0; info && info.state !== 'succeeded' && attempt < 40; attempt++) {
                if (info.state === 'failed')
                    throw new Error(`X video processing failed: ${info.error?.message ?? 'unknown error'}.`);
                await delay((info.check_after_secs ?? 5) * 1000);
                const statusParams = { command: 'STATUS', media_id: mediaId };
                const status = await axios_1.default.get(UPLOAD_URL, {
                    params: statusParams,
                    headers: { Authorization: oauth1Header('GET', UPLOAD_URL, creds, statusParams) },
                    timeout: 15000,
                });
                info = status.data
                    ?.data?.processing_info;
            }
            if (info && info.state !== 'succeeded')
                throw new Error('X video is still processing — try again shortly.');
            return mediaId;
        };
        const postTweet = async (mediaIds) => {
            const body = mediaIds.length ? { text: input.body, media: { media_ids: mediaIds } } : { text: input.body };
            const { data } = await axios_1.default.post(TWEET_URL, body, {
                headers: { Authorization: oauth1Header('POST', TWEET_URL, creds), 'Content-Type': 'application/json' },
                timeout: 15000,
            });
            const id = data?.data?.id;
            return typeof id === 'string' ? { id, url: `https://x.com/i/web/status/${id}` } : null;
        };
        try {
            // X allows up to 4 images, OR a single video, but never a mix — photos post as one tweet (≤4) and
            // each video posts as its own tweet, so a mixed post becomes separate (separately-billed) tweets.
            const images = allImageFiles(input.media).slice(0, 4);
            const videos = allVideoFiles(input.media);
            if (!images.length && !videos.length) {
                const tweet = await postTweet([]);
                return ok(tweet?.url ?? null, tweet ? { id: tweet.id } : {}, undefined, tweet ? [{ remotePostId: tweet.id, url: tweet.url, kind: 'post' }] : undefined);
            }
            const tweets = [];
            const errors = [];
            if (images.length) {
                try {
                    const ids = [];
                    for (const image of images)
                        ids.push(await uploadImage(image));
                    const tweet = await postTweet(ids);
                    if (tweet)
                        tweets.push(tweet);
                }
                catch (error) {
                    errors.push(`images: ${xError(error)}`);
                }
            }
            for (const video of videos) {
                try {
                    const id = await uploadVideo(video);
                    const tweet = await postTweet([id]);
                    if (tweet)
                        tweets.push(tweet);
                }
                catch (error) {
                    errors.push(`video: ${xError(error)}`);
                }
            }
            if (!tweets.length)
                return fail(errors.join('; ') || 'X post failed.');
            const artifacts = tweets.map((tweet) => ({
                remotePostId: tweet.id,
                url: tweet.url,
                kind: 'post',
            }));
            const urls = tweets.map((tweet) => tweet.url);
            if (errors.length) {
                return { ok: false, url: urls[0], response: { tweets, urls }, error: errors.join('; '), artifacts };
            }
            return ok(urls[0], { tweets, urls }, undefined, artifacts);
        }
        catch (error) {
            return fail(xError(error));
        }
    },
    async comment(input, secret) {
        const apiKey = pick(secret, 'apiKey');
        const apiSecret = pick(secret, 'apiSecret');
        const accessToken = pick(secret, 'accessToken');
        const accessTokenSecret = pick(secret, 'accessTokenSecret');
        if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
            return fail('X API keys are incomplete (need API key/secret + access token/secret).');
        }
        const creds = { apiKey, apiSecret, accessToken, accessTokenSecret };
        const TWEET_URL = 'https://api.twitter.com/2/tweets';
        const text = (0, textLimits_1.limitPostText)(input.body, 280);
        try {
            // A reply is an ordinary tweet with in_reply_to_tweet_id — so it is billed like one, and a reply
            // carrying a link costs more. The composer warns before this ever runs.
            const { data } = await axios_1.default.post(TWEET_URL, { text: text.text, reply: { in_reply_to_tweet_id: input.parent.remoteId } }, {
                headers: {
                    Authorization: oauth1Header('POST', TWEET_URL, creds),
                    'Content-Type': 'application/json',
                },
                timeout: 20000,
            });
            const id = data?.data?.id ?? null;
            const url = id ? `https://x.com/i/web/status/${id}` : null;
            return ok(url, data ?? {}, text.shortened ? 'Comment was shortened to the 280-character limit.' : undefined, id ? [{ remotePostId: id, remoteParentId: input.parent.remoteId, url: url ?? undefined, kind: 'post' }] : undefined);
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error) && error.response?.status === 402) {
                return fail('X has no API credits for this account (HTTP 402). Each follow-up comment is billed as a post — ' +
                    'add credits at developer.x.com → your Project → Subscriptions, then retry.');
            }
            return fail(errMessage(error));
        }
    },
};
const devto = {
    platform: 'devto',
    descriptor: {
        platform: 'devto',
        label: 'Dev.to',
        implemented: true,
        authKind: 'access_token',
        maxChars: null,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'DEV Community API key. First line becomes the article title; the rest is the markdown body. Published live. Text/markdown only — attached images and video are not uploaded.',
        comments: noComments('The DEV/Forem API exposes comment reads, but not comment creation.'),
    },
    async publish(input, secret) {
        const apiKey = pick(secret, 'apiKey', 'api_key', 'token');
        if (!apiKey)
            return fail('Dev.to API key is missing.');
        const lines = input.body.split('\n');
        const title = (lines[0] || 'New post').replace(/^#+\s*/, '').slice(0, 120);
        const bodyMarkdown = lines.slice(1).join('\n').trim() || input.body;
        try {
            const { data } = await axios_1.default.post('https://dev.to/api/articles', { article: { title, body_markdown: bodyMarkdown, published: true } }, { headers: { 'api-key': apiKey, 'Content-Type': 'application/json' }, timeout: 20000 });
            const record = data ?? {};
            return ok(typeof record.url === 'string' ? record.url : null, record);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
/**
 * Hashnode retired free GraphQL API access on 2026-05-13 ("GraphQL API is moving to a paid
 * offering"). Every query/mutation now requires a Pro plan on the publication; gql.hashnode.com
 * 301-redirects non-Pro publications to the announcement page. Surfaced to the user when we detect
 * that redirect (which previously masqueraded as success — axios followed it to a 200 HTML page).
 */
const HASHNODE_PRO_REQUIRED = 'Hashnode retired its free GraphQL API on May 13, 2026 — the API now requires a Pro plan on your ' +
    'publication. Open your Hashnode blog dashboard → Billing → Upgrade to Pro, then retry.';
const hashnode = {
    platform: 'hashnode',
    descriptor: {
        platform: 'hashnode',
        label: 'Hashnode',
        implemented: true,
        authKind: 'access_token',
        maxChars: null,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'Hashnode Personal Access Token + Publication ID. First line becomes the article title; the rest is the markdown body. Published live. Text/markdown only — attached images and video are not uploaded.',
        comments: noComments('Hashnode does not document a public API mutation for creating post comments.'),
    },
    async publish(input, secret, config) {
        const token = pick(secret, 'apiKey', 'token', 'pat');
        if (!token)
            return fail('Hashnode Personal Access Token is missing.');
        const publicationId = pick(config, 'publicationId', 'publication_id') ?? pick(secret, 'publicationId');
        if (!publicationId)
            return fail('Hashnode Publication ID is missing (set it in the connector config).');
        const lines = input.body.split('\n');
        const title = (lines[0] || 'New post').replace(/^#+\s*/, '').slice(0, 250);
        const contentMarkdown = lines.slice(1).join('\n').trim() || input.body;
        const query = 'mutation Publish($input: PublishPostInput!) { publishPost(input: $input) { post { id url slug } } }';
        try {
            const res = await axios_1.default.post('https://gql.hashnode.com/', { query, variables: { input: { title, contentMarkdown, publicationId, tags: [] } } }, {
                headers: { Authorization: token, 'Content-Type': 'application/json' },
                timeout: 20000,
                // Don't follow the deprecation 301 — axios would land on a 200 HTML page that has no
                // errors[] and report a false success. Resolve 3xx so we can detect it explicitly.
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400,
            });
            if (res.status >= 300)
                return fail(HASHNODE_PRO_REQUIRED);
            const payload = res.data;
            if (!payload || typeof payload !== 'object')
                return fail(HASHNODE_PRO_REQUIRED);
            if (payload.errors?.length) {
                return fail(payload.errors.map((e) => e.message ?? 'GraphQL error').join('; '));
            }
            const post = payload.data?.publishPost?.post;
            // No post id means nothing was created — never report success on an empty/unexpected payload.
            if (!post || typeof post.id !== 'string')
                return fail(`Hashnode did not publish the post. ${HASHNODE_PRO_REQUIRED}`);
            return ok(typeof post.url === 'string' ? post.url : null, post);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
/** Reddit — planned Devvit + hosted relay publisher for moderator-owned subreddits. */
const reddit = {
    platform: 'reddit',
    descriptor: {
        platform: 'reddit',
        label: 'Reddit',
        implemented: false,
        authKind: 'webhook',
        maxChars: 40000,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'Coming soon: Reddit publishing will use a 1MarketingTool Devvit app installed by a subreddit moderator plus relay. ' +
            'It is planned for owned subreddits only and is not available in this build.',
        comments: noComments('Reddit publishing is not implemented for this connector yet.'),
    },
    async publish() {
        return fail('Reddit publishing is coming soon. The hosted Devvit relay is not available yet.');
    },
};
/**
 * LinkedIn — BYO app ("Sign In with LinkedIn using OpenID Connect" + "Share on LinkedIn").
 * Posts a plain-text share to the member's personal feed. The author URN comes from the OpenID
 * userinfo `sub`; uses the UGC Posts API (plain text, no Little-Text escaping). PublisherService
 * injects a fresh `accessToken` into `secret` via OAuthService.ensureFreshToken before publish().
 */
const linkedin = {
    platform: 'linkedin',
    descriptor: {
        platform: 'linkedin',
        label: 'LinkedIn',
        implemented: true,
        authKind: 'oauth2',
        maxChars: 3000,
        supportsMedia: true,
        supportsAltText: true,
        notes: 'Your own LinkedIn app (OAuth2, "Share on LinkedIn" + OpenID Connect). Posts to your personal feed: text, up to 20 images, or a video. A post mixing images + video publishes as separate posts (LinkedIn can\'t combine them). Video may require app approval.',
        comments: flatComments(3000, { supportsMedia: false }),
    },
    async publish(input, secret) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken) {
            return fail('LinkedIn is not connected — open the channel settings and click "Connect with LinkedIn".');
        }
        const text = input.body.trim();
        try {
            const me = await axios_1.default.get('https://api.linkedin.com/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 15000,
            });
            const sub = me.data?.sub;
            if (!sub)
                return fail('Could not resolve your LinkedIn member id (userinfo returned no sub).');
            const author = `urn:li:person:${sub}`;
            const images = allImageFiles(input.media).slice(0, 20);
            const videos = allVideoFiles(input.media);
            // No media → legacy /v2/ugcPosts text share (stable; no versioned header to keep current).
            if (!images.length && !videos.length) {
                if (!text)
                    return fail('Nothing to post.');
                const payload = {
                    author,
                    lifecycleState: 'PUBLISHED',
                    specificContent: {
                        'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' },
                    },
                    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
                };
                const { data, headers } = await axios_1.default.post('https://api.linkedin.com/v2/ugcPosts', payload, {
                    headers: { Authorization: `Bearer ${accessToken}`, 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' },
                    timeout: 20000,
                });
                const id = data?.id ?? headers['x-restli-id'] ?? null;
                const url = id ? `https://www.linkedin.com/feed/update/${id}` : null;
                // Persist the share URN — /rest/socialActions/{urn}/comments needs it to post a follow-up.
                return ok(url, data ?? {}, undefined, id ? [{ remotePostId: id, remoteAccountId: author, url: url ?? undefined, kind: 'post' }] : undefined);
            }
            // Media posts go through the versioned /rest API (the only path that reliably renders multi-image).
            const REST = 'https://api.linkedin.com/rest';
            const VERSION = '202606'; // LinkedIn-Version (YYYYMM); each is supported ~12 months — bump periodically.
            const restHeaders = {
                Authorization: `Bearer ${accessToken}`,
                'LinkedIn-Version': VERSION,
                'X-Restli-Protocol-Version': '2.0.0',
                'Content-Type': 'application/json',
            };
            // /rest/posts "commentary" is Little Text Format — reserved characters must be backslash-escaped.
            const commentary = text.replace(/[\\(){}\[\]<>@|#*_~]/g, (char) => `\\${char}`);
            const uploadImage = async (image) => {
                const init = await axios_1.default.post(`${REST}/images?action=initializeUpload`, { initializeUploadRequest: { owner: author } }, { headers: restHeaders, timeout: 20000 });
                const value = init.data?.value ?? {};
                if (!value.uploadUrl || !value.image)
                    throw new Error('LinkedIn did not return an image upload URL.');
                await axios_1.default.put(value.uploadUrl, image.buffer, {
                    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
                    timeout: 60000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });
                return value.image;
            };
            // Video uses the chunked /rest/videos flow: initialize → PUT each part (capturing ETags) → finalize.
            const uploadVideo = async (video) => {
                const init = await axios_1.default.post(`${REST}/videos?action=initializeUpload`, { initializeUploadRequest: { owner: author, fileSizeBytes: video.buffer.length, uploadCaptions: false, uploadThumbnail: false } }, { headers: restHeaders, timeout: 20000 });
                const value = init.data?.value ?? {};
                const instructions = value.uploadInstructions ?? [];
                if (!value.video || !instructions.length)
                    throw new Error('LinkedIn did not return video upload instructions.');
                const partIds = [];
                for (const part of instructions) {
                    const put = await axios_1.default.put(part.uploadUrl, video.buffer.subarray(part.firstByte, part.lastByte + 1), {
                        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' },
                        timeout: 120000,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                    });
                    const etag = (put.headers.etag ?? put.headers.ETag);
                    if (etag)
                        partIds.push(etag.replace(/"/g, ''));
                }
                await axios_1.default.post(`${REST}/videos?action=finalizeUpload`, { finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? '', uploadedPartIds: partIds } }, { headers: restHeaders, timeout: 30000 });
                return value.video;
            };
            const createPost = async (content) => {
                const payload = {
                    author,
                    commentary,
                    visibility: 'PUBLIC',
                    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
                    content,
                    lifecycleState: 'PUBLISHED',
                    isReshareDisabledByAuthor: false,
                };
                const { data, headers } = await axios_1.default.post(`${REST}/posts`, payload, { headers: restHeaders, timeout: 30000 });
                const id = headers['x-restli-id'] ?? data?.id ?? null;
                return id ? `https://www.linkedin.com/feed/update/${id}` : null;
            };
            // LinkedIn's content is single-category — images and a video can't share a post, so a mixed post
            // becomes separate posts: all images in one (carousel when >1), each video in its own.
            const urls = [];
            const errors = [];
            if (images.length) {
                try {
                    const urns = [];
                    for (const image of images)
                        urns.push(await uploadImage(image));
                    const content = urns.length === 1
                        ? { media: { id: urns[0], altText: images[0].alt ?? '' } }
                        : { multiImage: { images: urns.map((id, index) => ({ id, altText: images[index].alt ?? '' })) } };
                    const url = await createPost(content);
                    if (url)
                        urls.push(url);
                }
                catch (error) {
                    errors.push(`images: ${errMessage(error)}`);
                }
            }
            for (const video of videos) {
                try {
                    const urn = await uploadVideo(video);
                    const url = await createPost({ media: { id: urn, title: video.alt ?? 'Video' } });
                    if (url)
                        urls.push(url);
                }
                catch (error) {
                    errors.push(`video: ${errMessage(error)}`);
                }
            }
            if (!urls.length)
                return fail(errors.join('; ') || 'LinkedIn post failed.');
            // The share URN is the last path segment of /feed/update/<urn> — recover it so comments have an anchor.
            const mediaArtifacts = urls
                .map((url) => ({ url, urn: url.split('/').filter(Boolean).pop() ?? '' }))
                .filter((entry) => entry.urn.startsWith('urn:'))
                .map((entry) => ({ remotePostId: entry.urn, remoteAccountId: author, url: entry.url, kind: 'post' }));
            if (errors.length) {
                return { ok: false, url: urls[0], response: { urls }, error: errors.join('; '), artifacts: mediaArtifacts };
            }
            return ok(urls[0], { urls }, undefined, mediaArtifacts.length ? mediaArtifacts : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
    async comment(input, secret) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken)
            return fail('LinkedIn is not connected.');
        const activityUrn = input.root.remoteId;
        if (!activityUrn.startsWith('urn:'))
            return fail('LinkedIn post URN is unavailable for this post.');
        try {
            const me = await axios_1.default.get('https://api.linkedin.com/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 15000,
            });
            const sub = me.data?.sub;
            if (!sub)
                return fail('Could not resolve your LinkedIn member id (userinfo returned no sub).');
            // Comments are flat on LinkedIn — every follow-up attaches to the share itself, never to each other.
            const { data } = await axios_1.default.post(`https://api.linkedin.com/rest/socialActions/${encodeURIComponent(activityUrn)}/comments`, { actor: `urn:li:person:${sub}`, object: activityUrn, message: { text: input.body } }, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'LinkedIn-Version': '202606',
                    'X-Restli-Protocol-Version': '2.0.0',
                    'Content-Type': 'application/json',
                },
                timeout: 20000,
            });
            const record = data ?? {};
            const id = typeof record.$URN === 'string' ? record.$URN : typeof record.id === 'string' ? record.id : null;
            return ok(input.root.url ?? null, record, undefined, id ? [{ remotePostId: id, remoteParentId: activityUrn, kind: 'message' }] : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const PINTEREST_API = 'https://api.pinterest.com';
const PINTEREST_SANDBOX_API = 'https://api-sandbox.pinterest.com';
const PINTEREST_SANDBOX_BOARD = '1MarketingTool Test';
/**
 * Resolve a usable board on the *sandbox* account. Honors the configured board id when it actually
 * exists in the sandbox (the user may have created a sandbox board and pasted its id); otherwise —
 * the common case, where the saved id is a *production* board that doesn't exist in this separate data
 * world — we reuse (or first-time create) a dedicated test board so the pin works from the token alone.
 */
async function resolveSandboxBoard(token, configuredBoardId) {
    const auth = { Authorization: `Bearer ${token}` };
    if (configuredBoardId) {
        try {
            const res = await axios_1.default.get(`${PINTEREST_SANDBOX_API}/v5/boards/${configuredBoardId}`, {
                headers: auth,
                timeout: 15000,
            });
            const id = res.data?.id;
            if (id)
                return id;
        }
        catch {
            // Not a sandbox board (production ids 404 here) — fall through to find-or-create.
        }
    }
    const list = await axios_1.default.get(`${PINTEREST_SANDBOX_API}/v5/boards`, {
        headers: auth,
        params: { page_size: 25 },
        timeout: 20000,
    });
    const boards = list.data?.items ?? [];
    const reuse = boards.find((b) => b.name === PINTEREST_SANDBOX_BOARD) ?? boards[0];
    if (reuse?.id)
        return reuse.id;
    const created = await axios_1.default.post(`${PINTEREST_SANDBOX_API}/v5/boards`, { name: PINTEREST_SANDBOX_BOARD, privacy: 'PUBLIC' }, { headers: { ...auth, 'Content-Type': 'application/json' }, timeout: 20000 });
    const id = created.data?.id;
    if (!id)
        throw new Error('sandbox board could not be created');
    return id;
}
/**
 * Pinterest — BYO app (OAuth2, client secret). Creates a Pin on the configured board. Pinterest has
 * NO text-only pins, so an image is required: we read the local media file and upload it as
 * `image_base64`. First body line is the title, the rest the description. PublisherService injects a
 * fresh `accessToken` via OAuthService.ensureFreshToken before publish().
 *
 * Environment switch (config `pinterestEnv`): 'production' (default) or 'sandbox'.
 *  - Sandbox: Trial-access apps can't create Pins on production (HTTP 403, code 29). Posts go to
 *    api-sandbox.pinterest.com with the pasted `sandboxToken` (console → Sandbox → Generate token) on a
 *    private auto-created board — verifies the integration before the app earns Standard access.
 *  - Production: posts to api.pinterest.com using the OAuth token (injected by PublisherService) or a
 *    pasted `productionToken`. Requires the app to be approved for Standard access (Pinterest review).
 */
/**
 * Upload a video for a Pinterest video Pin: register the media (POST /v5/media) → push the bytes to the
 * returned pre-signed S3 URL (no auth; the upload_parameters fields MUST precede the file part) → poll
 * GET /v5/media/{id} until transcoding succeeds. Returns the media_id to reference on the Pin.
 */
async function uploadPinterestVideo(apiBase, token, video) {
    const register = await axios_1.default.post(`${apiBase}/v5/media`, { media_type: 'video' }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    const registered = register.data ?? {};
    const mediaId = registered.media_id;
    const uploadUrl = registered.upload_url;
    if (!mediaId || !uploadUrl)
        throw new Error('Pinterest did not return a media upload URL.');
    // Pre-signed S3 POST: append every upload_parameters field first, then the file LAST, and NO auth header.
    const form = new form_data_1.default();
    for (const [key, value] of Object.entries(registered.upload_parameters ?? {}))
        form.append(key, String(value));
    form.append('file', video.buffer, { filename: video.filename, contentType: video.contentType });
    await axios_1.default.post(uploadUrl, form, {
        headers: form.getHeaders(),
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    // Poll until Pinterest finishes transcoding (status 'succeeded'); bail on 'failed'.
    for (let attempt = 0; attempt < 60; attempt++) {
        await delay(3000);
        const status = await axios_1.default.get(`${apiBase}/v5/media/${mediaId}`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15000,
        });
        const state = status.data?.status;
        if (state === 'succeeded')
            return mediaId;
        if (state === 'failed')
            throw new Error('Pinterest could not process the video (status: failed).');
    }
    throw new Error('Pinterest video is still processing — try again shortly.');
}
const pinterest = {
    platform: 'pinterest',
    descriptor: {
        platform: 'pinterest',
        label: 'Pinterest',
        implemented: true,
        authKind: 'oauth2',
        maxChars: 800,
        supportsMedia: true,
        supportsAltText: true,
        notes: 'Your own Pinterest app (OAuth2). Creates an image or video Pin on the chosen board (Pinterest has no text-only pins). A video Pin needs a cover image — attach an image alongside the video to use as the thumbnail. The first line is the title, the rest the description. Switch to the Sandbox environment to test before your app earns Standard access.',
        comments: noComments('Pinterest API v5 does not expose Pin comment creation.'),
    },
    async publish(input, secret, config) {
        const sandbox = (pick(config, 'pinterestEnv') ?? 'production').toLowerCase() === 'sandbox';
        const accessToken = sandbox
            ? pick(secret, 'sandboxToken', 'sandbox_token')
            : pick(secret, 'productionToken', 'production_token') ?? pick(secret, 'accessToken');
        if (!accessToken) {
            return fail(sandbox
                ? 'Pinterest sandbox needs a Sandbox access token — generate one in the Pinterest app console ' +
                    '(Generate token → Sandbox) and paste it into the channel settings.'
                : 'Pinterest is not connected — open the channel settings and click "Connect with Pinterest" ' +
                    '(or paste a Production access token).');
        }
        const apiBase = sandbox ? PINTEREST_SANDBOX_API : PINTEREST_API;
        let image;
        let video;
        try {
            image = allImageFiles(input.media)[0];
            video = allVideoFiles(input.media)[0];
        }
        catch (error) {
            return fail(`Could not read the attached media: ${errMessage(error)}`);
        }
        if (!image && !video) {
            return fail('Pinterest pins require an image or video — attach media to the post (text-only posts cannot be pinned).');
        }
        // Video Pins must carry a cover image, and Pinterest can't auto-generate one from the video.
        if (video && !image) {
            return fail('Pinterest video Pins need a cover image — attach an image alongside the video to use as the thumbnail (Pinterest can’t generate one automatically).');
        }
        // Resolve the target board. Production uses the saved board id directly. Sandbox honors it only if
        // that id exists in the sandbox; otherwise (a production id in a separate data world) it find-or-
        // creates its own test board so a sandbox pin works from the token alone.
        const configuredBoardId = pick(config, 'boardId', 'board_id');
        let boardId;
        try {
            boardId = sandbox ? await resolveSandboxBoard(accessToken, configuredBoardId) : configuredBoardId;
        }
        catch (error) {
            return fail(`Could not resolve a Pinterest board: ${errMessage(error)}`);
        }
        if (!boardId)
            return fail('Set a Board ID in the Pinterest channel settings.');
        const lines = input.body.split('\n');
        const title = (lines[0] || '').replace(/^#+\s*/, '').slice(0, 100) || undefined;
        const description = (lines.slice(1).join('\n').trim() || input.body).slice(0, 800);
        // A video Pin (upload the clip, then attach the image as its required cover) or a base64 image Pin.
        let mediaSource;
        if (video) {
            let mediaId;
            try {
                mediaId = await uploadPinterestVideo(apiBase, accessToken, video);
            }
            catch (error) {
                return fail(`Pinterest video upload failed: ${errMessage(error)}`);
            }
            mediaSource = {
                source_type: 'video_id',
                media_id: mediaId,
                cover_image_content_type: image.contentType,
                cover_image_data: image.buffer.toString('base64'),
            };
        }
        else {
            mediaSource = { source_type: 'image_base64', content_type: image.contentType, data: image.buffer.toString('base64') };
        }
        const altSource = video ?? image;
        try {
            const { data } = await axios_1.default.post(`${apiBase}/v5/pins`, {
                board_id: boardId,
                title,
                description,
                alt_text: altSource?.alt ? altSource.alt.slice(0, 500) : undefined,
                media_source: mediaSource,
            }, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, timeout: 60000 });
            const id = data?.id ?? null;
            // Sandbox pins live only in the sandbox (not on public pinterest.com) — don't fabricate a public
            // URL (it would 404). Surface the sandbox pin id in the message so the test is still verifiable.
            const url = id && !sandbox ? `https://www.pinterest.com/pin/${id}/` : null;
            const message = sandbox
                ? `Pin created in the Pinterest sandbox${id ? ` (id ${id})` : ''} — sandbox pins aren’t on public pinterest.com, so there’s no link.`
                : undefined;
            return ok(url, data ?? {}, message);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const TIKTOK_API = 'https://open.tiktokapis.com/v2';
const TIKTOK_MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const TIKTOK_INBOX_MESSAGE = 'Sent to your TikTok inbox — open the TikTok app to finish posting.';
function tiktokMappedError(code, detail) {
    const mapped = {
        access_token_invalid: 'TikTok session expired or was revoked — reconnect TikTok in channel settings.',
        scope_not_authorized: 'TikTok app is missing the video.upload scope — enable it in the TikTok developer portal, then reconnect.',
        spam_risk_too_many_posts: 'TikTok rejected this upload because the account has posted too often recently. Wait and try again later.',
        spam_risk_user_banned_from_posting: 'TikTok rejected this upload because the account cannot post right now. Check the TikTok app for account restrictions.',
        rate_limit_exceeded: 'TikTok rate limit reached. Wait and try again later.',
        invalid_params: 'TikTok rejected the upload request. Check that the attached file is a valid video and try again.',
        url_ownership_unverified: 'TikTok rejected the upload because the app is not approved for URL-sourced media. This channel uploads files directly; reconnect TikTok and try again.',
    };
    const message = mapped[code] ?? `TikTok error ${code}`;
    return detail && detail !== code ? `${message} — ${detail}` : message;
}
function tiktokApiError(data) {
    if (!data || typeof data !== 'object')
        return null;
    const error = data.error;
    if (!error || typeof error !== 'object')
        return null;
    const code = error.code;
    const message = error.message;
    if (typeof code === 'string' && code && code.toLowerCase() !== 'ok') {
        return tiktokMappedError(code, typeof message === 'string' && message.trim() ? message.trim() : null);
    }
    return null;
}
function tiktokErrorFromAxios(error) {
    if (axios_1.default.isAxiosError(error)) {
        const mapped = tiktokApiError(error.response?.data);
        if (mapped)
            return mapped;
    }
    return errMessage(error);
}
function tiktokPublishStatus(data) {
    if (!data || typeof data !== 'object')
        return null;
    const payload = data.data;
    if (!payload || typeof payload !== 'object')
        return null;
    const record = payload;
    const status = record.status ?? record.publish_status;
    return typeof status === 'string' && status.trim() ? status.trim() : null;
}
function tiktokStatusSucceeded(status) {
    const normalized = status.toUpperCase();
    return (normalized === 'SEND_TO_USER_INBOX' ||
        normalized === 'PUBLISH_COMPLETE' ||
        normalized === 'SUCCESS' ||
        normalized.endsWith('_SUCCEEDED') ||
        normalized.endsWith('_SUCCESS') ||
        normalized.includes('COMPLETE'));
}
function tiktokStatusFailed(status) {
    return /FAIL|ERROR|REJECT|CANCEL/.test(status.toUpperCase());
}
/**
 * TikTok — BYO app, Content Posting API `video.upload` inbox flow. This does not create a public post:
 * it sends the uploaded video to the creator's TikTok inbox/drafts, where they finish publishing in-app.
 * PublisherService injects a fresh `accessToken` before publish().
 */
const tiktok = {
    platform: 'tiktok',
    descriptor: {
        platform: 'tiktok',
        label: 'TikTok',
        implemented: true,
        authKind: 'oauth2',
        maxChars: 2200,
        supportsMedia: true,
        supportsAltText: false,
        notes: 'Your own TikTok app (OAuth2). Uploads one attached video to your TikTok inbox/drafts; finish posting in the TikTok app.',
        comments: noComments('TikTok’s Content Posting API does not expose comment creation.'),
    },
    async publish(input, secret) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken) {
            return fail('TikTok is not connected — open the channel settings and click "Connect with TikTok".');
        }
        const videoMedia = input.media.find(isVideoMedia);
        if (!videoMedia)
            return fail('TikTok requires a video — attach a video file to the post.');
        let video;
        try {
            video = readVideoFile(videoMedia);
        }
        catch (error) {
            return fail(`Could not read the video file: ${errMessage(error)}`);
        }
        const fileSize = video.buffer.length;
        if (fileSize <= 0)
            return fail('TikTok requires a non-empty video file.');
        const chunkSize = fileSize <= TIKTOK_MAX_CHUNK_BYTES ? fileSize : TIKTOK_MAX_CHUNK_BYTES;
        const totalChunkCount = Math.ceil(fileSize / chunkSize);
        const authHeaders = {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
        };
        let publishId;
        try {
            const init = await axios_1.default.post(`${TIKTOK_API}/post/publish/inbox/video/init/`, {
                source_info: {
                    source: 'FILE_UPLOAD',
                    video_size: fileSize,
                    chunk_size: chunkSize,
                    total_chunk_count: totalChunkCount,
                },
            }, { headers: authHeaders, timeout: 30000 });
            const initError = tiktokApiError(init.data);
            if (initError)
                return fail(initError);
            const data = init.data?.data;
            publishId = typeof data?.publish_id === 'string' ? data.publish_id : '';
            const uploadUrl = typeof data?.upload_url === 'string' ? data.upload_url : '';
            if (!publishId || !uploadUrl)
                return fail('TikTok did not return an upload URL.');
            for (let start = 0; start < fileSize; start += chunkSize) {
                const end = Math.min(start + chunkSize, fileSize) - 1;
                const chunk = video.buffer.subarray(start, end + 1);
                await axios_1.default.put(uploadUrl, chunk, {
                    headers: {
                        'Content-Type': 'video/mp4',
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Content-Length': String(chunk.length),
                    },
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity,
                    timeout: 0,
                });
            }
        }
        catch (error) {
            return fail(tiktokErrorFromAxios(error));
        }
        let lastStatus = null;
        let lastResponse = { publish_id: publishId };
        try {
            for (let attempt = 0; attempt < 6; attempt += 1) {
                if (attempt > 0)
                    await delay(5000);
                const status = await axios_1.default.post(`${TIKTOK_API}/post/publish/status/fetch/`, { publish_id: publishId }, { headers: authHeaders, timeout: 20000 });
                const statusError = tiktokApiError(status.data);
                if (statusError)
                    return fail(statusError);
                lastResponse = status.data ?? { publish_id: publishId };
                lastStatus = tiktokPublishStatus(status.data);
                if (lastStatus && tiktokStatusFailed(lastStatus)) {
                    return fail(`TikTok could not send the video to your inbox: ${lastStatus}.`);
                }
                if (lastStatus && tiktokStatusSucceeded(lastStatus)) {
                    return ok(null, { ...lastResponse, publish_id: publishId }, TIKTOK_INBOX_MESSAGE);
                }
            }
        }
        catch (error) {
            return ok(null, { ...lastResponse, publish_id: publishId, status: lastStatus ?? 'processing', statusError: errMessage(error) }, 'TikTok accepted the video and is processing it — open the TikTok app shortly to finish posting.');
        }
        return ok(null, { ...lastResponse, publish_id: publishId, status: lastStatus ?? 'processing' }, lastStatus
            ? `TikTok accepted the video and is still processing (${lastStatus}) — open the TikTok app shortly to finish posting.`
            : 'TikTok accepted the video and is processing it — open the TikTok app shortly to finish posting.');
    },
};
/**
 * YouTube — BYO Google app (OAuth2, YouTube Data API v3). Uploads an attached video via the
 * resumable endpoint: POST metadata → get a session URL → PUT the bytes. First body line is the
 * title, the rest the description. PublisherService injects a fresh `accessToken` before publish().
 * Note: while the user's Google app is unverified, uploads are policy-locked to private.
 */
const youtube = {
    platform: 'youtube',
    descriptor: {
        platform: 'youtube',
        label: 'YouTube',
        implemented: true,
        authKind: 'oauth2',
        maxChars: 5000,
        supportsMedia: true,
        supportsAltText: false,
        notes: 'One-click via our verified Google app, or bring your own (OAuth2, YouTube Data API). Uploads an attached video; the first line is the title, the rest the description. Requires a video file. Vertical clips ≤3 min can post as Shorts.',
        comments: flatComments(10000, {
            supportsMedia: false,
            requiredScopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
        }),
    },
    async publish(input, secret, config) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken) {
            return fail('YouTube is not connected — open the channel settings and click "Connect with YouTube".');
        }
        const video = input.media.find((item) => /video|mp4|mov|webm|m4v|avi|mkv/i.test(`${item.type} ${item.path}`));
        if (!video)
            return fail('YouTube requires a video — attach a video file to the post.');
        let buffer;
        try {
            buffer = fs_1.default.readFileSync(localFilePath(video.path));
        }
        catch (error) {
            return fail(`Could not read the video file: ${errMessage(error)}`);
        }
        const lines = input.body.split('\n');
        const title = (lines[0] || 'New video').replace(/^#+\s*/, '').slice(0, 100);
        let description = (lines.slice(1).join('\n').trim() || input.body).slice(0, 5000);
        // YouTube has no "Short" API flag — it auto-classifies by aspect ratio (vertical/square) + duration
        // (≤3 min). The only upload-time nudge is a #Shorts hint in the description. The per-post toggle
        // (input.options.short) wins; otherwise the channel default `shortsDefault` opts in only on 'always'
        // ('auto'/'never' leave classification to YouTube). The composer handles dimension/length validation.
        const shortsDefault = (pick(config, 'shortsDefault') ?? 'auto').toLowerCase();
        const wantShort = typeof input.options?.short === 'boolean' ? input.options.short : shortsDefault === 'always';
        if (wantShort && !/#shorts\b/i.test(`${title}\n${description}`)) {
            description = `${description}\n\n#Shorts`.trim().slice(0, 5000);
        }
        const requested = (pick(config, 'privacy', 'visibility') ?? '').toLowerCase();
        const privacyStatus = ['private', 'unlisted', 'public'].includes(requested) ? requested : 'unlisted';
        const contentType = video.type && video.type.includes('/') ? video.type : 'video/*';
        try {
            // 1. Open a resumable upload session — returns the upload URL in the Location header.
            const init = await axios_1.default.post('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { snippet: { title, description }, status: { privacyStatus } }, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Type': contentType,
                    'X-Upload-Content-Length': String(buffer.length),
                },
                maxRedirects: 0,
            });
            const uploadUrl = init.headers['location'];
            if (!uploadUrl)
                return fail('YouTube did not return a resumable upload URL.');
            // 2. Upload the bytes.
            const { data } = await axios_1.default.put(uploadUrl, buffer, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': contentType,
                    'Content-Length': String(buffer.length),
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 0,
            });
            const id = data?.id ?? null;
            const url = id ? `https://www.youtube.com/watch?v=${id}` : null;
            return ok(url, data ?? {}, undefined, id ? [{ remotePostId: id, url: url ?? undefined, kind: 'video' }] : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
    async comment(input, secret) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken)
            return fail('YouTube is not connected.');
        const videoId = input.root.remoteId;
        if (!videoId || videoId.startsWith('unavailable:')) {
            return fail('YouTube video id is unavailable for this post.');
        }
        const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
        try {
            let channelId = input.root.remoteAccountId ?? null;
            if (!channelId) {
                const { data: channelData } = await axios_1.default.get('https://www.googleapis.com/youtube/v3/channels', {
                    params: { part: 'id', mine: 'true' },
                    headers,
                    timeout: 15000,
                });
                channelId =
                    channelData?.items?.find((item) => item.id)?.id ?? null;
            }
            if (!channelId)
                return fail('Could not resolve the connected YouTube channel id.');
            const { data } = await axios_1.default.post('https://www.googleapis.com/youtube/v3/commentThreads', {
                snippet: {
                    channelId,
                    videoId,
                    topLevelComment: { snippet: { textOriginal: input.body } },
                },
            }, { params: { part: 'snippet' }, headers, timeout: 20000 });
            const record = data ?? {};
            const snippet = record.snippet;
            const id = snippet?.topLevelComment?.id ?? (typeof record.id === 'string' ? record.id : null);
            const url = id
                ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(id)}`
                : input.root.url ?? null;
            return ok(url, record, undefined, id
                ? [{
                        remotePostId: id,
                        remoteParentId: videoId,
                        remoteAccountId: channelId,
                        url: url ?? undefined,
                        kind: 'message',
                    }]
                : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const FB_GRAPH = 'https://graph.facebook.com/v23.0';
// Video uploads must go to the dedicated graph-video host, not the regular graph host.
const FB_GRAPH_VIDEO = 'https://graph-video.facebook.com/v23.0';
// "Instagram API with Instagram login" uses its own graph host; the connected token IS the IG user
// token (no Facebook Page traversal), so publishing targets `me` directly.
const IG_GRAPH = 'https://graph.instagram.com/v23.0';
/**
 * Resolve which Page id(s) a project posts to from the connector config (see facebookPageMapping.ts —
 * this is the backend copy of that logic). `pageMap[projectId]` wins (an explicit `[]` means skip, but
 * the publish gate already filtered those out); otherwise the project inherits `defaultPageIds`, then
 * the legacy single `pageId`. An empty result lets the caller fall back to the account's first Page.
 */
function facebookPageIdsForProject(config, projectId) {
    const asStrings = (value) => Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
    const map = config?.pageMap && typeof config.pageMap === 'object' ? config.pageMap : null;
    if (map && projectId && Array.isArray(map[projectId]))
        return asStrings(map[projectId]);
    const def = asStrings(config?.defaultPageIds);
    if (def.length)
        return def;
    const legacy = pick(config, 'pageId', 'page_id');
    return legacy ? [legacy] : [];
}
/**
 * Facebook Page — BYO OAuth2 (the user registers their own Meta app; see byo_https_redirect.md).
 * OAuthService mints a long-lived (~60d) USER token; PublisherService injects it as `accessToken`.
 * We resolve the target Page(s) for this project + their (non-expiring) Page access tokens via
 * /me/accounts, then post to each Page: a single photo via /{page-id}/photos (caption inline), several
 * photos as one album (each uploaded unpublished, then referenced from one /{page-id}/feed story), each
 * video via /{page-id}/videos (graph-video host), or plain text via /{page-id}/feed. Photos and videos
 * can't share one story (Graph API limit), so a post mixing them publishes the album + each video as
 * separate Page stories.
 */
const facebook = {
    platform: 'facebook',
    descriptor: {
        platform: 'facebook',
        label: 'Facebook Page',
        implemented: true,
        authKind: 'oauth2',
        maxChars: 63206,
        supportsMedia: true,
        supportsAltText: false,
        notes: 'Posts to a Facebook Page you manage. BYO Meta app (Development mode posts to your own Pages, no App Review). Attaches images (single photo or album) and videos; a post mixing photos + video publishes them as separate Page stories.',
        comments: flatComments(8000, {
            supportsMedia: false,
            requiredScopes: ['pages_manage_engagement'],
            needsAppReview: true,
        }),
    },
    async publish(input, secret, config) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken) {
            return fail('Facebook is not connected — open the channel settings and click "Connect with Facebook".');
        }
        try {
            const pagesRes = await axios_1.default.get(`${FB_GRAPH}/me/accounts`, {
                params: { access_token: accessToken, fields: 'id,name,access_token' },
                timeout: 15000,
            });
            const pages = pagesRes.data?.data ?? [];
            if (!pages.length) {
                return fail('No Facebook Page found — you must be an admin of at least one Page for this account.');
            }
            // Which Page(s) does this project post to? Falls back to the first Page when nothing is mapped.
            let wantedIds = facebookPageIdsForProject(config, input.product?.id ?? null);
            if (!wantedIds.length)
                wantedIds = [pages[0].id];
            // Facebook's Graph API can't mix photos and a video in one story, so each media kind posts on its own:
            // photos as a single photo / album, and every video as its own video story. Text-only when nothing is attached.
            const images = allImageFiles(input.media);
            const videos = allVideoFiles(input.media);
            // Upload one image to /{page}/photos. published=false returns just the photo id (for album assembly);
            // published=true returns post_id (the feed story) so we can build the public URL directly.
            const uploadPhoto = async (page, image, published) => {
                const form = new form_data_1.default();
                form.append('published', published ? 'true' : 'false');
                if (published && input.body)
                    form.append('message', input.body);
                form.append('access_token', page.access_token);
                form.append('source', image.buffer, { filename: image.filename, contentType: image.contentType });
                const { data } = await axios_1.default.post(`${FB_GRAPH}/${page.id}/photos`, form, {
                    headers: form.getHeaders(),
                    timeout: 60000,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });
                return data;
            };
            // Upload one video to /{page}/videos (graph-video host) via the resumable protocol: start → transfer
            // each chunk Facebook asks for until the whole file is sent → finish (the body becomes the description).
            // The simple non-resumable `source` upload is unreliable for Page videos, so we always chunk.
            const uploadVideo = async (page, video) => {
                const endpoint = `${FB_GRAPH_VIDEO}/${page.id}/videos`;
                const fileSize = video.buffer.length;
                // 1. Start: open an upload session sized to the file.
                const startForm = new form_data_1.default();
                startForm.append('access_token', page.access_token);
                startForm.append('upload_phase', 'start');
                startForm.append('file_size', String(fileSize));
                const start = await axios_1.default.post(endpoint, startForm, { headers: startForm.getHeaders(), timeout: 30000 });
                const session = start.data;
                const sessionId = session.upload_session_id;
                const videoId = session.video_id;
                if (!sessionId)
                    throw new Error('Facebook did not open a video upload session.');
                // 2. Transfer: send the chunk [start_offset, end_offset) Facebook requests, until the offsets meet.
                let startOffset = Number(session.start_offset ?? 0);
                let endOffset = Number(session.end_offset ?? fileSize);
                while (startOffset < endOffset) {
                    const chunk = video.buffer.subarray(startOffset, endOffset);
                    const transferForm = new form_data_1.default();
                    transferForm.append('access_token', page.access_token);
                    transferForm.append('upload_phase', 'transfer');
                    transferForm.append('upload_session_id', sessionId);
                    transferForm.append('start_offset', String(startOffset));
                    transferForm.append('video_file_chunk', chunk, { filename: video.filename, contentType: video.contentType });
                    const transfer = await axios_1.default.post(endpoint, transferForm, {
                        headers: transferForm.getHeaders(),
                        timeout: 180000,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                    });
                    const next = transfer.data;
                    const nextStart = Number(next.start_offset ?? endOffset);
                    // Guard against a stalled session rather than looping forever on the same chunk.
                    if (nextStart <= startOffset && nextStart < endOffset) {
                        throw new Error('Facebook video upload stalled (offset did not advance).');
                    }
                    startOffset = nextStart;
                    endOffset = Number(next.end_offset ?? endOffset);
                }
                // 3. Finish: commit the session and attach the description.
                const finishForm = new form_data_1.default();
                finishForm.append('access_token', page.access_token);
                finishForm.append('upload_phase', 'finish');
                finishForm.append('upload_session_id', sessionId);
                if (input.body)
                    finishForm.append('description', input.body);
                await axios_1.default.post(endpoint, finishForm, { headers: finishForm.getHeaders(), timeout: 60000 });
                return { id: videoId };
            };
            // Publish all of a post's stories (photo album + each video, or plain text) to one Page.
            const publishToPage = async (page) => {
                const urls = [];
                const artifacts = [];
                const errors = [];
                if (images.length === 1) {
                    try {
                        const data = await uploadPhoto(page, images[0], true);
                        const id = data.post_id ?? data.id ?? null;
                        if (id) {
                            const url = `https://www.facebook.com/${id}`;
                            urls.push(url);
                            artifacts.push({ remotePostId: id, remoteAccountId: page.id, url, kind: 'post' });
                        }
                    }
                    catch (error) {
                        errors.push(`photo: ${errMessage(error)}`);
                    }
                }
                else if (images.length > 1) {
                    // Upload each photo unpublished, then create one feed story that references them all.
                    try {
                        const fbids = [];
                        for (const image of images) {
                            const data = await uploadPhoto(page, image, false);
                            if (data.id)
                                fbids.push(data.id);
                        }
                        if (!fbids.length)
                            throw new Error('none of the attached images could be uploaded');
                        const params = { access_token: page.access_token };
                        if (input.body)
                            params.message = input.body;
                        fbids.forEach((fbid, index) => {
                            params[`attached_media[${index}]`] = JSON.stringify({ media_fbid: fbid });
                        });
                        const { data } = await axios_1.default.post(`${FB_GRAPH}/${page.id}/feed`, null, { params, timeout: 30000 });
                        const id = data?.id ?? null;
                        if (id) {
                            const url = `https://www.facebook.com/${id}`;
                            urls.push(url);
                            artifacts.push({ remotePostId: id, remoteAccountId: page.id, url, kind: 'post' });
                        }
                    }
                    catch (error) {
                        errors.push(`album: ${errMessage(error)}`);
                    }
                }
                // Each video is its own Page video story (Graph API can't fold them into the photo album).
                for (const video of videos) {
                    try {
                        const data = await uploadVideo(page, video);
                        if (data.id) {
                            const url = `https://www.facebook.com/${page.id}/videos/${data.id}`;
                            urls.push(url);
                            artifacts.push({ remotePostId: data.id, remoteAccountId: page.id, url, kind: 'video' });
                        }
                    }
                    catch (error) {
                        errors.push(`video: ${errMessage(error)}`);
                    }
                }
                if (!images.length && !videos.length) {
                    try {
                        const { data } = await axios_1.default.post(`${FB_GRAPH}/${page.id}/feed`, null, {
                            params: { message: input.body, access_token: page.access_token },
                            timeout: 15000,
                        });
                        const id = data?.id ?? null;
                        if (id) {
                            const url = `https://www.facebook.com/${id}`;
                            urls.push(url);
                            artifacts.push({ remotePostId: id, remoteAccountId: page.id, url, kind: 'post' });
                        }
                    }
                    catch (error) {
                        errors.push(`post: ${errMessage(error)}`);
                    }
                }
                return { urls, artifacts, errors };
            };
            const results = [];
            for (const pageId of wantedIds) {
                const page = pages.find((p) => p.id === pageId) ?? null;
                if (!page) {
                    results.push({
                        id: pageId,
                        ok: false,
                        url: null,
                        urls: [],
                        artifacts: [],
                        name: pageId,
                        error: `Page ${pageId} is not among your managed Pages.`,
                    });
                    continue;
                }
                const { urls, artifacts, errors } = await publishToPage(page);
                // Page is fully OK only when every story published; a mix counts as a (partial) failure but keeps the URL.
                const url = urls[0] ?? null;
                if (errors.length) {
                    results.push({ id: page.id, ok: false, url, urls, artifacts, name: page.name, error: errors.join('; ') });
                }
                else {
                    results.push({ id: page.id, ok: true, url, urls, artifacts, name: page.name });
                }
            }
            const succeeded = results.filter((r) => r.ok);
            const failed = results.filter((r) => !r.ok);
            const artifacts = results.flatMap((result) => result.artifacts);
            if (!succeeded.length) {
                const error = failed.map((r) => `${r.name}: ${r.error}`).join('; ') || 'Facebook post failed.';
                return artifacts.length
                    ? { ok: false, url: artifacts[0].url ?? null, response: { results }, error, artifacts }
                    : fail(error);
            }
            // Partial failure across multiple Pages: report it (and which Pages did publish) rather than
            // silently succeeding — the response carries per-Page results for diagnostics.
            if (failed.length) {
                return {
                    ok: false,
                    url: succeeded[0].url,
                    response: { results },
                    error: `Posted to ${succeeded.map((r) => r.name).join(', ')}; failed: ${failed
                        .map((r) => `${r.name}: ${r.error}`)
                        .join('; ')}`,
                    artifacts,
                };
            }
            return ok(succeeded[0].url, { results }, undefined, artifacts);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
    async comment(input, secret) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken)
            return fail('Facebook is not connected.');
        const rootId = input.root.remoteId;
        const pageId = input.root.remoteAccountId ??
            (rootId.includes('_') ? rootId.slice(0, rootId.indexOf('_')) : null);
        try {
            const pagesRes = await axios_1.default.get(`${FB_GRAPH}/me/accounts`, {
                params: { access_token: accessToken, fields: 'id,name,access_token' },
                timeout: 15000,
            });
            const pages = pagesRes.data?.data ?? [];
            const page = pageId ? pages.find((item) => item.id === pageId) : pages.length === 1 ? pages[0] : null;
            if (!page) {
                return fail(pageId
                    ? `Facebook Page ${pageId} is no longer available to this connection.`
                    : 'Could not identify which Facebook Page owns this post.');
            }
            const { data } = await axios_1.default.post(`${FB_GRAPH}/${encodeURIComponent(rootId)}/comments`, null, {
                params: { message: input.body, access_token: page.access_token },
                timeout: 20000,
            });
            const record = data ?? {};
            const id = typeof record.id === 'string' ? record.id : null;
            const commentId = id?.split('_').pop() ?? null;
            const url = input.root.url && commentId
                ? `${input.root.url}${input.root.url.includes('?') ? '&' : '?'}comment_id=${encodeURIComponent(commentId)}`
                : input.root.url ?? null;
            return ok(url, record, undefined, id
                ? [{
                        remotePostId: id,
                        remoteParentId: rootId,
                        remoteAccountId: page.id,
                        url: url ?? undefined,
                        kind: 'message',
                    }]
                : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
const THREADS_GRAPH = 'https://graph.threads.net/v1.0';
/**
 * Threads — BYO Meta app (Threads use case), authorized on-device through the HTTPS bounce (same as
 * Facebook). Two-step publish (like Instagram, unlike FB's single /feed): create a TEXT container, then
 * publish it. OAuthService mints a long-lived user token; PublisherService injects it as `accessToken`.
 * Text-only for now — image/video need the media-hosting phase.
 */
const threads = {
    platform: 'threads',
    descriptor: {
        platform: 'threads',
        label: 'Threads',
        implemented: true,
        authKind: 'oauth2',
        maxChars: 500,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'Posts to your Threads account via your own Meta app (Threads use case). Text only for now — attached images and video are not posted yet.',
        comments: threadComments(500, {
            supportsMedia: false,
            requiredScopes: ['threads_manage_replies'],
            needsAppReview: true,
        }),
    },
    async publish(input, secret) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken) {
            return fail('Threads is not connected — open the channel settings and click "Connect with Threads".');
        }
        const status = (0, textLimits_1.limitPostText)(input.body, 500);
        const successMessage = status.shortened
            ? 'Threads published successfully. The post was shortened to the 500-character limit.'
            : undefined;
        try {
            const create = await axios_1.default.post(`${THREADS_GRAPH}/me/threads`, null, {
                params: { media_type: 'TEXT', text: status.text, access_token: accessToken },
                timeout: 15000,
            });
            const creationId = create.data?.id;
            if (!creationId)
                return fail('Threads did not return a creation id.');
            const { data } = await axios_1.default.post(`${THREADS_GRAPH}/me/threads_publish`, null, {
                params: { creation_id: creationId, access_token: accessToken },
                timeout: 15000,
            });
            const mediaId = data?.id ?? null;
            let url = null;
            if (mediaId) {
                // Permalink is best-effort — the post is already live even if this lookup fails.
                try {
                    const perma = await axios_1.default.get(`${THREADS_GRAPH}/${mediaId}`, {
                        params: { fields: 'permalink', access_token: accessToken },
                        timeout: 10000,
                    });
                    const link = perma.data?.permalink;
                    if (typeof link === 'string')
                        url = link;
                }
                catch {
                    /* ignore — keep url null */
                }
            }
            return ok(url, data ?? {}, successMessage, 
            // The media id is the reply anchor — `reply_to_id` on the next create call threads onto it.
            mediaId ? [{ remotePostId: mediaId, url: url ?? undefined, kind: 'thread' }] : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
    async comment(input, secret) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken)
            return fail('Threads is not connected.');
        const status = (0, textLimits_1.limitPostText)(input.body, 500);
        try {
            // Same two-step create/publish flow as a post; `reply_to_id` is what makes it a thread reply.
            const create = await axios_1.default.post(`${THREADS_GRAPH}/me/threads`, null, {
                params: {
                    media_type: 'TEXT',
                    text: status.text,
                    reply_to_id: input.parent.remoteId,
                    access_token: accessToken,
                },
                timeout: 15000,
            });
            const creationId = create.data?.id;
            if (!creationId)
                return fail('Threads did not return a creation id for the comment.');
            const { data } = await axios_1.default.post(`${THREADS_GRAPH}/me/threads_publish`, null, {
                params: { creation_id: creationId, access_token: accessToken },
                timeout: 15000,
            });
            const mediaId = data?.id ?? null;
            let url = null;
            if (mediaId) {
                try {
                    const perma = await axios_1.default.get(`${THREADS_GRAPH}/${mediaId}`, {
                        params: { fields: 'permalink', access_token: accessToken },
                        timeout: 10000,
                    });
                    const link = perma.data?.permalink;
                    if (typeof link === 'string')
                        url = link;
                }
                catch {
                    /* ignore — the comment is already live even if the permalink lookup fails */
                }
            }
            return ok(url, data ?? {}, status.shortened ? 'Comment was shortened to the 500-character limit.' : undefined, mediaId
                ? [{ remotePostId: mediaId, remoteParentId: input.parent.remoteId, url: url ?? undefined, kind: 'thread' }]
                : undefined);
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
/**
 * Custom API — a generic, user-templated HTTP publisher. The user supplies an endpoint, method,
 * headers, and a body template with `{{tokens}}` (content/title/secret/productUrl/…); we render the
 * post into that shape and POST/PUT/PATCH it to their blog/CMS/system. Versatile by design: any API
 * that accepts a single HTTP request per post is reachable without a bespoke publisher.
 */
const customApi = {
    platform: 'custom_api',
    descriptor: {
        platform: 'custom_api',
        label: 'Custom API',
        implemented: true,
        authKind: 'custom',
        maxChars: null,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'Sends each post to an HTTP endpoint you define, using a headers + body template with {{tokens}}. Media isn\'t auto-attached — reference the attached file paths in your template if your endpoint needs them.',
        comments: noComments('Custom API publishing has no configured comment endpoint or remote comment-id mapping.'),
    },
    async publish(input, secret, config) {
        const endpoint = pick(config, 'endpointUrl', 'endpoint_url', 'url');
        if (!endpoint)
            return fail('Custom API endpoint URL is missing.');
        const token = pick(secret, 'secret', 'token', 'apiKey') ?? '';
        try {
            const values = (0, customApiTemplate_1.buildTemplateValues)(input, token, new Date().toISOString());
            const request = (0, customApiTemplate_1.renderRequest)({
                method: typeof config.method === 'string' ? config.method : null,
                headersTemplate: typeof config.headersTemplate === 'string' ? config.headersTemplate : null,
                bodyTemplate: typeof config.bodyTemplate === 'string' ? config.bodyTemplate : null,
            }, values);
            const { data, status } = await axios_1.default.request({
                url: ensureUrl(endpoint),
                method: request.method,
                headers: request.headers,
                data: request.data,
                timeout: 30000,
                maxBodyLength: Infinity,
                validateStatus: (s) => s >= 200 && s < 300,
            });
            const responsePath = pick(config, 'responseUrlPath', 'response_url_path');
            const url = (0, customApiTemplate_1.pickResponsePath)(data, responsePath);
            return ok(url, typeof data === 'object' && data ? data : { status, body: data });
        }
        catch (error) {
            return fail(errMessage(error));
        }
    },
};
/**
 * Instagram — BYO Meta app via "Instagram API with Instagram login" (its own Instagram App ID/Secret,
 * not the Facebook app). The connected token is the IG user token, so publishing targets `me` on
 * graph.instagram.com directly — no Facebook Page. Instagram's publish API takes no binary upload: you
 * create a media *container* that references a public `image_url`/`video_url`, (poll for video
 * processing,) then publish the container. Local files are hosted briefly on the media relay
 * (relay-files.1marketingtool.com) and deleted once the post is live; assets that already have a public
 * HTTPS URL skip the relay. See docs/channel_implementation/channels/instagram.md.
 */
const instagram = {
    platform: 'instagram',
    descriptor: {
        platform: 'instagram',
        label: 'Instagram',
        implemented: true,
        authKind: 'oauth2',
        maxChars: 2200,
        supportsMedia: true,
        supportsAltText: false,
        notes: 'Posts to your Instagram Professional account (BYO Meta app, Instagram login). Requires media — a single image, a video (Reel), or a carousel (2–10). Local files are hosted briefly via the media relay, then deleted after publishing.',
        comments: noComments('Instagram’s official API can reply to an existing comment, but does not expose creating the top-level first comment required here.'),
    },
    async publish(input, secret) {
        const accessToken = pick(secret, 'accessToken');
        if (!accessToken) {
            return fail('Instagram is not connected — open the channel settings and click "Connect with Instagram".');
        }
        const items = input.media.filter((item) => isImageMedia(item) || isVideoMedia(item));
        if (!items.length) {
            return fail('Instagram requires media — attach an image or a video to the post.');
        }
        const caption = input.body.slice(0, 2200);
        const uploadedKeys = [];
        // Resolve a public URL for one media item: reuse the path if it's already a public HTTPS URL
        // (synced asset), otherwise upload the bytes to the relay and remember the key for cleanup.
        const publicUrlFor = async (item) => {
            const kind = isVideoMedia(item) ? 'video' : 'image';
            if (/^https:\/\//i.test(item.path))
                return { url: item.path, kind };
            // Videos upload as-is; images are normalized to JPEG (Instagram rejects PNG/other in a container).
            const media = kind === 'video'
                ? (() => {
                    const file = readVideoFile(item);
                    return { buffer: file.buffer, contentType: file.contentType };
                })()
                : toInstagramJpeg(readImageFile(item));
            const { url, key } = await (0, relayFiles_1.uploadToRelay)(media.buffer, media.contentType);
            uploadedKeys.push(key);
            return { url, kind };
        };
        try {
            // With Instagram login the connected token is the IG user token, so publish to `me` directly —
            // no Facebook Page lookup. Confirm the account resolves (and surface a clear error if not).
            let igUsername = 'your account';
            try {
                const meRes = await axios_1.default.get(`${IG_GRAPH}/me`, {
                    params: { access_token: accessToken, fields: 'user_id,username' },
                    timeout: 15000,
                });
                igUsername = meRes.data?.username ?? igUsername;
            }
            catch {
                return fail('Could not read your Instagram account — reconnect Instagram (it must be a Professional Business/Creator account).');
            }
            // IG content publishing uses the connected IG user token against `me` on graph.instagram.com.
            const igToken = accessToken;
            // Helpers: create a media container, and poll it to FINISHED (videos process asynchronously).
            const createContainer = async (params) => {
                const { data } = await axios_1.default.post(`${IG_GRAPH}/me/media`, null, {
                    params: { ...params, access_token: igToken },
                    timeout: 30000,
                });
                const id = data?.id;
                if (!id)
                    throw new Error('Instagram did not return a media container id.');
                return id;
            };
            const waitFinished = async (containerId) => {
                for (let attempt = 0; attempt < 30; attempt += 1) {
                    const { data } = await axios_1.default.get(`${IG_GRAPH}/${containerId}`, {
                        params: { fields: 'status_code', access_token: igToken },
                        timeout: 15000,
                    });
                    const status = data?.status_code;
                    if (status === 'FINISHED')
                        return;
                    if (status === 'ERROR')
                        throw new Error('Instagram failed to process the media (check format/aspect ratio).');
                    await delay(3000);
                }
                throw new Error('Instagram media processing timed out.');
            };
            // 2. Build the container(s): single image / single Reel / carousel of 2–10 children.
            let creationId;
            if (items.length === 1) {
                const { url, kind } = await publicUrlFor(items[0]);
                creationId =
                    kind === 'video'
                        ? await createContainer({ media_type: 'REELS', video_url: url, caption })
                        : await createContainer({ image_url: url, caption });
                await waitFinished(creationId);
            }
            else {
                const childIds = [];
                for (const item of items.slice(0, 10)) {
                    const { url, kind } = await publicUrlFor(item);
                    const childId = kind === 'video'
                        ? await createContainer({ media_type: 'VIDEO', video_url: url, is_carousel_item: 'true' })
                        : await createContainer({ image_url: url, is_carousel_item: 'true' });
                    childIds.push(childId);
                }
                for (const childId of childIds)
                    await waitFinished(childId);
                creationId = await createContainer({ media_type: 'CAROUSEL', caption, children: childIds.join(',') });
                await waitFinished(creationId);
            }
            // 3. Publish the container, then resolve the permalink for the post URL.
            const { data: published } = await axios_1.default.post(`${IG_GRAPH}/me/media_publish`, null, {
                params: { creation_id: creationId, access_token: igToken },
                timeout: 30000,
            });
            const mediaId = published?.id ?? null;
            let permalink = null;
            if (mediaId) {
                try {
                    const { data: pl } = await axios_1.default.get(`${IG_GRAPH}/${mediaId}`, {
                        params: { fields: 'permalink', access_token: igToken },
                        timeout: 15000,
                    });
                    permalink = pl?.permalink ?? null;
                }
                catch {
                    // permalink is best-effort — the publish already succeeded
                }
            }
            return ok(permalink, { mediaId, account: igUsername });
        }
        catch (error) {
            return fail(errMessage(error));
        }
        finally {
            // Meta has ingested the bytes by publish time, so the hosted copies are safe to remove now.
            for (const key of uploadedKeys) {
                try {
                    await (0, relayFiles_1.deleteFromRelay)(key);
                }
                catch {
                    // the relay's cron sweep is the backstop
                }
            }
        }
    },
};
/**
 * LinkedIn Page (company/organization) — coming soon. Unlike Facebook, LinkedIn has no self-serve "dev
 * mode" for Pages: posting with `urn:li:organization` + `w_organization_social` lives behind the
 * Community Management API, which LinkedIn must approve per app. The existing `linkedin` channel covers
 * the self-serve personal feed; this placeholder reserves the Page channel until that access lands.
 */
const linkedinPage = {
    platform: 'linkedin_page',
    descriptor: {
        platform: 'linkedin_page',
        label: 'LinkedIn Page',
        implemented: false,
        authKind: 'oauth2',
        maxChars: 3000,
        supportsMedia: false,
        supportsAltText: false,
        notes: 'Coming soon: posting to a LinkedIn company/organization Page needs LinkedIn’s Community Management API ' +
            '(w_organization_social), which LinkedIn must approve per app — there is no self-serve dev mode like Facebook. ' +
            'The LinkedIn channel above already posts to your personal feed. Not available in this build.',
        comments: noComments('LinkedIn Page publishing is not implemented for this connector yet.'),
    },
    async publish() {
        return fail('LinkedIn Page publishing is coming soon — it requires LinkedIn’s approved Community Management API.');
    },
};
const PUBLISHERS = [
    telegram,
    discord,
    slack,
    mastodon,
    bluesky,
    wordpress,
    ghost,
    devto,
    hashnode,
    twitter,
    linkedin,
    linkedinPage,
    reddit,
    pinterest,
    youtube,
    instagram,
    facebook,
    tiktok,
    threads,
    customApi,
];
const REGISTRY = new Map(PUBLISHERS.map((publisher) => [publisher.platform, publisher]));
const SUGGESTED_OUTPUT_FORMATS = {
    discord: 'markdown',
    reddit: 'markdown',
    wordpress: 'html',
    ghost: 'html',
    devto: 'markdown',
    hashnode: 'markdown',
};
function suggestedOutputFormatForPlatform(platform) {
    return SUGGESTED_OUTPUT_FORMATS[platform] ?? 'plaintext';
}
function getPublisher(platform) {
    return REGISTRY.get(platform) ?? null;
}
function listPlatformDescriptors() {
    return PUBLISHERS.map((publisher) => ({
        ...publisher.descriptor,
        suggestedOutputFormat: suggestedOutputFormatForPlatform(publisher.platform),
    }));
}
//# sourceMappingURL=registry.js.map