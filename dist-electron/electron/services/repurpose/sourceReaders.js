"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTOMATED_REPURPOSE_SOURCES = void 0;
exports.listExternalSourceAccounts = listExternalSourceAccounts;
exports.listExternalChannelPosts = listExternalChannelPosts;
const axios_1 = __importDefault(require("axios"));
const ConnectorService_1 = require("../ConnectorService");
const OAuthService_1 = require("../oauth/OAuthService");
const registry_1 = require("../publishers/registry");
const readable_1 = require("../seo/audit/readable");
const FETCH_TIMEOUT_MS = 20_000;
const MAX_MEDIA_PER_SOURCE = 4;
exports.AUTOMATED_REPURPOSE_SOURCES = new Set([
    'facebook',
    'twitter',
    'instagram',
    'threads',
    'youtube',
    'tiktok',
    'bluesky',
    'mastodon',
]);
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function list(value) {
    return Array.isArray(value) ? value : [];
}
function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function pick(source, ...keys) {
    if (!source)
        return null;
    for (const key of keys) {
        const value = text(source[key]);
        if (value)
            return value;
    }
    return null;
}
function assertSelectedAccount(selectedId, actualId, label) {
    if (selectedId && selectedId !== actualId) {
        throw new Error(`The selected ${label} account is no longer available. Reload the account list.`);
    }
}
function timestamp(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value > 10_000_000_000 ? value : value * 1000;
    }
    const raw = text(value);
    if (!raw)
        return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
}
function pushMediaUrl(urls, value) {
    const url = text(value);
    if (!url || !/^https?:\/\//i.test(url) || urls.includes(url) || urls.length >= MAX_MEDIA_PER_SOURCE)
        return;
    urls.push(url);
}
function apiErrorMessage(error) {
    if (axios_1.default.isAxiosError(error)) {
        const body = record(error.response?.data);
        const nested = record(body?.error);
        return (text(nested?.message) ??
            text(nested?.error_description) ??
            text(body?.message) ??
            text(body?.error_description) ??
            (typeof error.response?.data === 'string' ? error.response.data.slice(0, 240) : null) ??
            error.message);
    }
    return error instanceof Error ? error.message : 'The channel request failed.';
}
function plainTextFromHtml(value) {
    const html = text(value) ?? '';
    return (0, readable_1.decodeEntities)(html
        .replace(/<br\b[^>]*>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' '))
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
}
function sourcePost(input) {
    const id = text(input.id);
    const postText = input.text.trim();
    const mediaUrls = (input.mediaUrls ?? []).slice(0, MAX_MEDIA_PER_SOURCE);
    if (!id || (!postText && !mediaUrls.length))
        return null;
    return {
        id,
        text: postText,
        createdAt: timestamp(input.createdAt),
        url: text(input.url),
        accountName: input.accountName,
        mediaUrls,
    };
}
async function readXPosts(productId, accountId, limit) {
    const { secret } = await ConnectorService_1.connectorService.getConnectionProfile('twitter', productId);
    const apiKey = pick(secret, 'apiKey');
    const apiSecret = pick(secret, 'apiSecret');
    const accessToken = pick(secret, 'accessToken');
    const accessTokenSecret = pick(secret, 'accessTokenSecret');
    if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
        throw new Error('X API keys are incomplete.');
    }
    const credentials = { apiKey, apiSecret, accessToken, accessTokenSecret };
    const meUrl = 'https://api.twitter.com/2/users/me';
    const meResponse = await axios_1.default.get(meUrl, {
        headers: { Authorization: (0, registry_1.oauth1Header)('GET', meUrl, credentials) },
        timeout: FETCH_TIMEOUT_MS,
    });
    const user = record(record(meResponse.data)?.data);
    const userId = text(user?.id);
    const username = text(user?.username);
    if (!userId)
        throw new Error('X did not return the connected user id.');
    assertSelectedAccount(accountId, userId, 'X');
    const url = `https://api.twitter.com/2/users/${encodeURIComponent(userId)}/tweets`;
    const params = {
        max_results: String(Math.max(5, limit)),
        exclude: 'replies,retweets',
        'tweet.fields': 'created_at,attachments,note_tweet',
        expansions: 'attachments.media_keys',
        'media.fields': 'media_key,type,url,preview_image_url',
    };
    const response = await axios_1.default.get(url, {
        params,
        headers: { Authorization: (0, registry_1.oauth1Header)('GET', url, credentials, params) },
        timeout: FETCH_TIMEOUT_MS,
    });
    const responseRecord = record(response.data);
    const mediaByKey = new Map();
    for (const raw of list(record(responseRecord?.includes)?.media)) {
        const media = record(raw);
        const key = text(media?.media_key);
        if (media && key)
            mediaByKey.set(key, media);
    }
    return list(responseRecord?.data)
        .map((raw) => {
        const post = record(raw);
        if (!post)
            return null;
        const mediaUrls = [];
        for (const key of list(record(post.attachments)?.media_keys)) {
            const media = mediaByKey.get(String(key));
            pushMediaUrl(mediaUrls, media?.url ?? media?.preview_image_url);
        }
        const noteText = text(record(post.note_tweet)?.text);
        const id = text(post.id);
        return sourcePost({
            id,
            text: noteText ?? text(post.text) ?? '',
            createdAt: post.created_at,
            url: id && username ? `https://x.com/${username}/status/${id}` : null,
            accountName: username ? `@${username}` : 'X account',
            mediaUrls,
        });
    })
        .filter((post) => Boolean(post))
        .slice(0, limit);
}
function metaMediaUrls(media) {
    const urls = [];
    const collect = (item) => {
        const mediaType = text(item.media_type)?.toUpperCase();
        pushMediaUrl(urls, mediaType === 'VIDEO' ? item.thumbnail_url : item.media_url ?? item.thumbnail_url);
        for (const child of list(record(item.children)?.data)) {
            const childRecord = record(child);
            if (childRecord)
                collect(childRecord);
        }
    };
    collect(media);
    return urls;
}
async function readInstagramPosts(accountId, limit) {
    const accessToken = await OAuthService_1.oauthService.ensureFreshToken('instagram');
    const profileResponse = await axios_1.default.get('https://graph.instagram.com/v23.0/me', {
        params: { access_token: accessToken, fields: 'user_id,username' },
        timeout: FETCH_TIMEOUT_MS,
    });
    const profile = record(profileResponse.data);
    const profileId = text(profile?.user_id) ?? text(profile?.id);
    const username = text(profile?.username);
    if (!profileId)
        throw new Error('Instagram did not return the connected account id.');
    assertSelectedAccount(accountId, profileId, 'Instagram');
    const response = await axios_1.default.get('https://graph.instagram.com/v23.0/me/media', {
        params: {
            access_token: accessToken,
            fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}',
            limit,
        },
        timeout: FETCH_TIMEOUT_MS,
    });
    return list(record(response.data)?.data)
        .map((raw) => {
        const media = record(raw);
        return media
            ? sourcePost({
                id: media.id,
                text: text(media.caption) ?? '',
                createdAt: media.timestamp,
                url: media.permalink,
                accountName: username ? `@${username}` : 'Instagram account',
                mediaUrls: metaMediaUrls(media),
            })
            : null;
    })
        .filter((post) => Boolean(post))
        .slice(0, limit);
}
async function readThreadsPosts(accountId, limit) {
    const accessToken = await OAuthService_1.oauthService.ensureFreshToken('threads');
    const profileResponse = await axios_1.default.get('https://graph.threads.net/v1.0/me', {
        params: { access_token: accessToken, fields: 'id,username' },
        timeout: FETCH_TIMEOUT_MS,
    });
    const profile = record(profileResponse.data);
    const profileId = text(profile?.id);
    const username = text(profile?.username);
    if (!profileId)
        throw new Error('Threads did not return the connected account id.');
    assertSelectedAccount(accountId, profileId, 'Threads');
    const response = await axios_1.default.get('https://graph.threads.net/v1.0/me/threads', {
        params: {
            access_token: accessToken,
            fields: 'id,text,timestamp,permalink,media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}',
            limit,
        },
        timeout: FETCH_TIMEOUT_MS,
    });
    return list(record(response.data)?.data)
        .map((raw) => {
        const post = record(raw);
        return post
            ? sourcePost({
                id: post.id,
                text: text(post.text) ?? '',
                createdAt: post.timestamp,
                url: post.permalink,
                accountName: username ? `@${username}` : 'Threads account',
                mediaUrls: metaMediaUrls(post),
            })
            : null;
    })
        .filter((post) => Boolean(post))
        .slice(0, limit);
}
function youtubeThumbnail(snippet) {
    const thumbnails = record(snippet.thumbnails);
    for (const size of ['maxres', 'standard', 'high', 'medium', 'default']) {
        const url = text(record(thumbnails?.[size])?.url);
        if (url)
            return url;
    }
    return null;
}
async function readYouTubePosts(accountId, limit) {
    const accessToken = await OAuthService_1.oauthService.ensureFreshToken('youtube');
    const headers = { Authorization: `Bearer ${accessToken}` };
    const channelResponse = await axios_1.default.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'snippet,contentDetails', mine: 'true' },
        headers,
        timeout: FETCH_TIMEOUT_MS,
    });
    const channels = list(record(channelResponse.data)?.items).map(record).filter(Boolean);
    const channel = accountId ? channels.find((item) => text(item.id) === accountId) ?? null : channels[0] ?? null;
    if (accountId && !channel)
        throw new Error('The selected YouTube channel is no longer available. Reload the account list.');
    const uploadsId = text(record(record(channel?.contentDetails)?.relatedPlaylists)?.uploads);
    const channelName = text(record(channel?.snippet)?.title) ?? 'YouTube channel';
    if (!uploadsId)
        throw new Error('No YouTube channel or uploads playlist was found for this account.');
    const response = await axios_1.default.get('https://www.googleapis.com/youtube/v3/playlistItems', {
        params: {
            part: 'snippet,contentDetails,status',
            playlistId: uploadsId,
            maxResults: limit,
        },
        headers,
        timeout: FETCH_TIMEOUT_MS,
    });
    return list(record(response.data)?.items)
        .map((raw) => {
        const item = record(raw);
        const snippet = record(item?.snippet);
        const videoId = text(record(snippet?.resourceId)?.videoId) ?? text(record(item?.contentDetails)?.videoId);
        if (!item || !snippet || !videoId)
            return null;
        const title = text(snippet.title) ?? '';
        const description = text(snippet.description) ?? '';
        const mediaUrls = [];
        pushMediaUrl(mediaUrls, youtubeThumbnail(snippet));
        return sourcePost({
            id: videoId,
            text: [title, description].filter(Boolean).join('\n\n'),
            createdAt: record(item.contentDetails)?.videoPublishedAt ?? snippet.publishedAt,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            accountName: channelName,
            mediaUrls,
        });
    })
        .filter((post) => Boolean(post))
        .slice(0, limit);
}
async function readTikTokPosts(accountId, limit) {
    const accessToken = await OAuthService_1.oauthService.ensureFreshToken('tiktok');
    const headers = { Authorization: `Bearer ${accessToken}` };
    const profileResponse = await axios_1.default.get('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', { headers, timeout: FETCH_TIMEOUT_MS });
    const user = record(record(profileResponse.data)?.data)?.user;
    const openId = text(record(user)?.open_id);
    const username = text(record(user)?.username);
    const displayName = text(record(user)?.display_name) ?? (username ? `@${username}` : 'TikTok account');
    if (!openId)
        throw new Error('TikTok did not return the connected account id.');
    assertSelectedAccount(accountId, openId, 'TikTok');
    const response = await axios_1.default.post('https://open.tiktokapis.com/v2/video/list/?fields=id,title,video_description,create_time,cover_image_url,share_url', { max_count: Math.min(20, limit) }, { headers: { ...headers, 'Content-Type': 'application/json' }, timeout: FETCH_TIMEOUT_MS });
    const responseRecord = record(response.data);
    const responseError = record(responseRecord?.error);
    const errorCode = text(responseError?.code);
    if (errorCode && errorCode !== 'ok')
        throw new Error(text(responseError?.message) ?? errorCode);
    return list(record(responseRecord?.data)?.videos)
        .map((raw) => {
        const video = record(raw);
        if (!video)
            return null;
        const mediaUrls = [];
        pushMediaUrl(mediaUrls, video.cover_image_url);
        return sourcePost({
            id: video.id,
            text: text(video.video_description) ?? text(video.title) ?? '',
            createdAt: video.create_time,
            url: video.share_url,
            accountName: displayName,
            mediaUrls,
        });
    })
        .filter((post) => Boolean(post))
        .slice(0, limit);
}
function blueskyMediaUrls(embed) {
    const urls = [];
    if (!embed)
        return urls;
    for (const raw of list(embed.images)) {
        const image = record(raw);
        pushMediaUrl(urls, image?.fullsize ?? image?.thumb);
    }
    const external = record(embed.external);
    if (external)
        pushMediaUrl(urls, external.thumb);
    pushMediaUrl(urls, embed.thumbnail);
    const media = record(embed.media);
    for (const url of blueskyMediaUrls(media))
        pushMediaUrl(urls, url);
    return urls;
}
async function readBlueskyPosts(productId, accountId, limit) {
    const { config, secret } = await ConnectorService_1.connectorService.getConnectionProfile('bluesky', productId);
    const service = (pick(config, 'service') ?? 'https://bsky.social').replace(/\/+$/, '');
    const identifier = pick(secret, 'identifier', 'handle', 'username');
    const password = pick(secret, 'appPassword', 'password', 'app_password');
    if (!identifier || !password)
        throw new Error('Bluesky handle and app password are required.');
    const sessionResponse = await axios_1.default.post(`${service}/xrpc/com.atproto.server.createSession`, { identifier, password }, { timeout: FETCH_TIMEOUT_MS });
    const session = record(sessionResponse.data);
    const did = text(session?.did);
    const handle = text(session?.handle) ?? identifier;
    if (!did)
        throw new Error('Bluesky did not return the connected account id.');
    assertSelectedAccount(accountId, did, 'Bluesky');
    const response = await axios_1.default.get('https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed', {
        params: { actor: did, limit, filter: 'posts_no_replies' },
        timeout: FETCH_TIMEOUT_MS,
    });
    return list(record(response.data)?.feed)
        .map((raw) => {
        const feedItem = record(raw);
        const post = record(feedItem?.post);
        const author = record(post?.author);
        const postRecord = record(post?.record);
        const uri = text(post?.uri);
        if (!post || !postRecord || !uri || text(author?.did) !== did || feedItem?.reason)
            return null;
        const rkey = uri.split('/').pop();
        return sourcePost({
            id: uri,
            text: text(postRecord.text) ?? '',
            createdAt: postRecord.createdAt ?? post.indexedAt,
            url: rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : null,
            accountName: `@${handle}`,
            mediaUrls: blueskyMediaUrls(record(post.embed)),
        });
    })
        .filter((post) => Boolean(post))
        .slice(0, limit);
}
async function readMastodonPosts(productId, selectedAccountId, limit) {
    const { config, secret } = await ConnectorService_1.connectorService.getConnectionProfile('mastodon', productId);
    const configuredInstance = pick(config, 'instanceUrl', 'instance_url', 'instance');
    const token = pick(secret, 'accessToken', 'token', 'access_token');
    if (!configuredInstance)
        throw new Error('Mastodon instance URL is missing.');
    if (!token)
        throw new Error('Mastodon access token is missing.');
    const base = (/^https?:\/\//i.test(configuredInstance) ? configuredInstance : `https://${configuredInstance}`).replace(/\/+$/, '');
    const headers = { Authorization: `Bearer ${token}` };
    const accountResponse = await axios_1.default.get(`${base}/api/v1/accounts/verify_credentials`, {
        headers,
        timeout: FETCH_TIMEOUT_MS,
    });
    const account = record(accountResponse.data);
    const accountId = text(account?.id);
    const accountName = text(account?.acct) ?? text(account?.username) ?? 'Mastodon account';
    if (!accountId)
        throw new Error('Mastodon did not return the connected account id.');
    assertSelectedAccount(selectedAccountId, accountId, 'Mastodon');
    const response = await axios_1.default.get(`${base}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses`, {
        params: { limit, exclude_replies: true, exclude_reblogs: true },
        headers,
        timeout: FETCH_TIMEOUT_MS,
    });
    return list(response.data)
        .map((raw) => {
        const status = record(raw);
        if (!status)
            return null;
        const mediaUrls = [];
        for (const rawMedia of list(status.media_attachments)) {
            const media = record(rawMedia);
            const kind = text(media?.type);
            pushMediaUrl(mediaUrls, kind === 'image' ? media?.url ?? media?.preview_url : media?.preview_url);
        }
        return sourcePost({
            id: status.id,
            text: plainTextFromHtml(status.content),
            createdAt: status.created_at,
            url: status.url,
            accountName: accountName.startsWith('@') ? accountName : `@${accountName}`,
            mediaUrls,
        });
    })
        .filter((post) => Boolean(post))
        .slice(0, limit);
}
const READ_PERMISSION_HINTS = {
    twitter: 'Confirm that your X API plan allows user timeline reads.',
    youtube: 'Reconnect YouTube in Channels and grant its read permissions.',
    tiktok: 'Reconnect TikTok in Channels and grant the video.list permission.',
    mastodon: 'Create the Mastodon token with read:accounts and read:statuses access.',
};
async function listExternalSourceAccounts(input) {
    try {
        switch (input.platform) {
            case 'twitter': {
                const { secret } = await ConnectorService_1.connectorService.getConnectionProfile('twitter', input.productId);
                const apiKey = pick(secret, 'apiKey');
                const apiSecret = pick(secret, 'apiSecret');
                const accessToken = pick(secret, 'accessToken');
                const accessTokenSecret = pick(secret, 'accessTokenSecret');
                if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
                    throw new Error('X API keys are incomplete.');
                }
                const url = 'https://api.twitter.com/2/users/me';
                const response = await axios_1.default.get(url, {
                    headers: {
                        Authorization: (0, registry_1.oauth1Header)('GET', url, { apiKey, apiSecret, accessToken, accessTokenSecret }),
                    },
                    timeout: FETCH_TIMEOUT_MS,
                });
                const user = record(record(response.data)?.data);
                const id = text(user?.id);
                const username = text(user?.username);
                if (!id)
                    throw new Error('X did not return the connected user id.');
                return [{ id, name: text(user?.name) ?? (username ? `@${username}` : 'X account'), handle: username }];
            }
            case 'instagram': {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('instagram');
                const response = await axios_1.default.get('https://graph.instagram.com/v23.0/me', {
                    params: { access_token: accessToken, fields: 'user_id,username' },
                    timeout: FETCH_TIMEOUT_MS,
                });
                const profile = record(response.data);
                const id = text(profile?.user_id) ?? text(profile?.id);
                const username = text(profile?.username);
                if (!id)
                    throw new Error('Instagram did not return the connected account id.');
                return [{ id, name: username ? `@${username}` : 'Instagram account', handle: username }];
            }
            case 'threads': {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('threads');
                const response = await axios_1.default.get('https://graph.threads.net/v1.0/me', {
                    params: { access_token: accessToken, fields: 'id,username' },
                    timeout: FETCH_TIMEOUT_MS,
                });
                const profile = record(response.data);
                const id = text(profile?.id);
                const username = text(profile?.username);
                if (!id)
                    throw new Error('Threads did not return the connected account id.');
                return [{ id, name: username ? `@${username}` : 'Threads account', handle: username }];
            }
            case 'youtube': {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('youtube');
                const response = await axios_1.default.get('https://www.googleapis.com/youtube/v3/channels', {
                    params: { part: 'snippet', mine: 'true', maxResults: 50 },
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeout: FETCH_TIMEOUT_MS,
                });
                return list(record(response.data)?.items)
                    .map((raw) => {
                    const channel = record(raw);
                    const id = text(channel?.id);
                    const snippet = record(channel?.snippet);
                    return id ? { id, name: text(snippet?.title) ?? 'YouTube channel', handle: text(snippet?.customUrl) } : null;
                })
                    .filter((account) => Boolean(account));
            }
            case 'tiktok': {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('tiktok');
                const response = await axios_1.default.get('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', { headers: { Authorization: `Bearer ${accessToken}` }, timeout: FETCH_TIMEOUT_MS });
                const user = record(record(record(response.data)?.data)?.user);
                const id = text(user?.open_id);
                const username = text(user?.username);
                if (!id)
                    throw new Error('TikTok did not return the connected account id.');
                return [{ id, name: text(user?.display_name) ?? (username ? `@${username}` : 'TikTok account'), handle: username }];
            }
            case 'bluesky': {
                const { config, secret } = await ConnectorService_1.connectorService.getConnectionProfile('bluesky', input.productId);
                const service = (pick(config, 'service') ?? 'https://bsky.social').replace(/\/+$/, '');
                const identifier = pick(secret, 'identifier', 'handle', 'username');
                const password = pick(secret, 'appPassword', 'password', 'app_password');
                if (!identifier || !password)
                    throw new Error('Bluesky handle and app password are required.');
                const response = await axios_1.default.post(`${service}/xrpc/com.atproto.server.createSession`, { identifier, password }, { timeout: FETCH_TIMEOUT_MS });
                const session = record(response.data);
                const id = text(session?.did);
                const handle = text(session?.handle) ?? identifier;
                if (!id)
                    throw new Error('Bluesky did not return the connected account id.');
                return [{ id, name: `@${handle}`, handle }];
            }
            case 'mastodon': {
                const { config, secret } = await ConnectorService_1.connectorService.getConnectionProfile('mastodon', input.productId);
                const configuredInstance = pick(config, 'instanceUrl', 'instance_url', 'instance');
                const token = pick(secret, 'accessToken', 'token', 'access_token');
                if (!configuredInstance)
                    throw new Error('Mastodon instance URL is missing.');
                if (!token)
                    throw new Error('Mastodon access token is missing.');
                const base = (/^https?:\/\//i.test(configuredInstance) ? configuredInstance : `https://${configuredInstance}`)
                    .replace(/\/+$/, '');
                const response = await axios_1.default.get(`${base}/api/v1/accounts/verify_credentials`, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: FETCH_TIMEOUT_MS,
                });
                const profile = record(response.data);
                const id = text(profile?.id);
                const handle = text(profile?.acct) ?? text(profile?.username);
                if (!id)
                    throw new Error('Mastodon did not return the connected account id.');
                return [{ id, name: handle ? `@${handle}` : 'Mastodon account', handle }];
            }
            default:
                return [];
        }
    }
    catch (error) {
        const hint = READ_PERMISSION_HINTS[input.platform];
        throw new Error(`${apiErrorMessage(error)}${hint ? ` ${hint}` : ''}`);
    }
}
async function listExternalChannelPosts(input) {
    try {
        switch (input.platform) {
            case 'twitter':
                return await readXPosts(input.productId, input.accountId, input.limit);
            case 'instagram':
                return await readInstagramPosts(input.accountId, input.limit);
            case 'threads':
                return await readThreadsPosts(input.accountId, input.limit);
            case 'youtube':
                return await readYouTubePosts(input.accountId, input.limit);
            case 'tiktok':
                return await readTikTokPosts(input.accountId, input.limit);
            case 'bluesky':
                return await readBlueskyPosts(input.productId, input.accountId, input.limit);
            case 'mastodon':
                return await readMastodonPosts(input.productId, input.accountId, input.limit);
            default:
                throw new Error(`Loading posts from ${input.platform} is not supported.`);
        }
    }
    catch (error) {
        const hint = READ_PERMISSION_HINTS[input.platform];
        throw new Error(`${apiErrorMessage(error)}${hint ? ` ${hint}` : ''}`);
    }
}
//# sourceMappingURL=sourceReaders.js.map