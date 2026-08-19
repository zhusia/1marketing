"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DISTRIBUTION_ANALYTICS_PROVIDER_MAP = exports.DISTRIBUTION_ANALYTICS_PROVIDERS = void 0;
exports.distributionProviderError = distributionProviderError;
const axios_1 = __importDefault(require("axios"));
const registry_1 = require("../../publishers/registry");
const metrics_1 = require("../metrics");
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
function count(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return Math.max(0, value);
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
    }
    return null;
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
function values(patch) {
    return { ...metrics_1.EMPTY_DISTRIBUTION_METRICS, ...patch };
}
function sumKnown(...items) {
    const known = items.filter((item) => item != null);
    return known.length ? known.reduce((sum, item) => sum + item, 0) : null;
}
function errorMessage(error) {
    if (axios_1.default.isAxiosError(error)) {
        const detail = record(error.response?.data);
        const nested = record(detail?.error);
        const message = text(nested?.message) ??
            text(detail?.message) ??
            (typeof error.response?.data === 'string' ? error.response.data.slice(0, 240) : null);
        return message ?? error.message;
    }
    return error instanceof Error ? error.message : 'Analytics request failed.';
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
function median(valuesToSort) {
    if (!valuesToSort.length)
        return null;
    const sorted = [...valuesToSort].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}
function authHeader(token) {
    return token ? { Authorization: 'Bearer ' + token } : {};
}
function basicAuth(connection) {
    const username = pick(connection.config, 'username') ?? pick(connection.secret, 'username');
    const password = pick(connection.secret, 'appPassword', 'password', 'application_password');
    if (!username || !password)
        return null;
    return 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
}
const twitter = {
    connectorName: 'twitter',
    label: 'X / Twitter',
    supportedMetrics: ['impressions', 'likes', 'comments', 'reposts', 'quotes', 'saves', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: false,
    requiredScopes: [],
    async syncArtifact(input, connection) {
        const secret = connection.secret;
        const apiKey = pick(secret, 'apiKey');
        const apiSecret = pick(secret, 'apiSecret');
        const accessToken = pick(secret, 'accessToken');
        const accessTokenSecret = pick(secret, 'accessTokenSecret');
        if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
            throw new Error('X API keys are incomplete.');
        }
        const url = 'https://api.twitter.com/2/tweets';
        const params = {
            ids: input.artifact.remotePostId,
            'tweet.fields': 'public_metrics,created_at',
        };
        const response = await axios_1.default.get(url, {
            params,
            headers: {
                Authorization: (0, registry_1.oauth1Header)('GET', url, { apiKey, apiSecret, accessToken, accessTokenSecret }, params),
            },
            timeout: 20_000,
        });
        const tweet = record(list(record(response.data)?.data)[0]);
        const publicMetrics = record(tweet?.public_metrics);
        if (!tweet || !publicMetrics)
            throw new Error('X returned no metrics for this post.');
        const likes = count(publicMetrics.like_count);
        const comments = count(publicMetrics.reply_count);
        const reposts = count(publicMetrics.retweet_count);
        const quotes = count(publicMetrics.quote_count);
        const saves = count(publicMetrics.bookmark_count);
        const impressions = count(publicMetrics.impression_count);
        return {
            quality: 'public_counter',
            metrics: values({
                impressions,
                likes,
                comments,
                reposts,
                quotes,
                saves,
                engagements: sumKnown(likes, comments, reposts, quotes, saves),
            }),
            providerUpdatedAt: timestamp(tweet.created_at),
        };
    },
};
function mastodonBase(artifact, connection) {
    const configured = pick(connection.config, 'instanceUrl', 'instance_url', 'instance');
    if (configured)
        return (/^https?:\/\//i.test(configured) ? configured : 'https://' + configured).replace(/\/+$/, '');
    if (artifact.remoteUrl)
        return new URL(artifact.remoteUrl).origin;
    throw new Error('Mastodon instance URL is unavailable.');
}
const mastodon = {
    connectorName: 'mastodon',
    label: 'Mastodon',
    supportedMetrics: ['likes', 'comments', 'reposts', 'quotes', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: true,
    requiredScopes: [],
    async syncArtifact(input, connection) {
        const base = mastodonBase(input.artifact, connection);
        const tokenValue = pick(connection.secret, 'accessToken', 'token', 'access_token');
        const headers = authHeader(tokenValue);
        const statusResponse = await axios_1.default.get(base + '/api/v1/statuses/' + encodeURIComponent(input.artifact.remotePostId), { headers, timeout: 20_000 });
        const status = record(statusResponse.data) ?? {};
        const likes = count(status.favourites_count);
        const comments = count(status.replies_count);
        const reposts = count(status.reblogs_count);
        const quotes = count(status.quotes_count);
        let conversation = null;
        if (tokenValue) {
            try {
                const [contextResponse, meResponse] = await Promise.all([
                    axios_1.default.get(base + '/api/v1/statuses/' + encodeURIComponent(input.artifact.remotePostId) + '/context', { headers, timeout: 20_000 }),
                    axios_1.default.get(base + '/api/v1/accounts/verify_credentials', { headers, timeout: 20_000 }),
                ]);
                const ownId = text(record(meResponse.data)?.id);
                const descendants = list(record(contextResponse.data)?.descendants)
                    .map(record)
                    .filter((item) => Boolean(item));
                const byParent = new Map();
                for (const item of descendants) {
                    const parent = text(item.in_reply_to_id);
                    if (!parent)
                        continue;
                    byParent.set(parent, [...(byParent.get(parent) ?? []), item]);
                }
                const topLevel = byParent.get(input.artifact.remotePostId) ?? [];
                const audience = topLevel.filter((item) => text(record(item.account)?.id) !== ownId);
                const responseTimes = [];
                let answered = 0;
                let oldestUnansweredAt = null;
                const hasOwnedDescendant = (rootId, audienceAt) => {
                    const queue = [...(byParent.get(rootId) ?? [])];
                    while (queue.length) {
                        const child = queue.shift();
                        const childAt = timestamp(child.created_at);
                        if (text(record(child.account)?.id) === ownId) {
                            if (audienceAt != null && childAt != null)
                                responseTimes.push(Math.max(0, (childAt - audienceAt) / 1000));
                            return true;
                        }
                        const childId = text(child.id);
                        if (childId)
                            queue.push(...(byParent.get(childId) ?? []));
                    }
                    return false;
                };
                for (const item of audience) {
                    const id = text(item.id);
                    const createdAt = timestamp(item.created_at);
                    if (id && hasOwnedDescendant(id, createdAt)) {
                        answered += 1;
                    }
                    else if (createdAt != null && (oldestUnansweredAt == null || createdAt < oldestUnansweredAt)) {
                        oldestUnansweredAt = createdAt;
                    }
                }
                conversation = {
                    audienceTopLevelCount: audience.length,
                    totalReplyCount: descendants.length,
                    ownedReplyCount: descendants.filter((item) => text(record(item.account)?.id) === ownId).length,
                    answeredThreadCount: answered,
                    unansweredThreadCount: audience.length - answered,
                    oldestUnansweredAt,
                    medianFirstResponseSeconds: median(responseTimes),
                    coverageComplete: true,
                };
            }
            catch {
                conversation = null;
            }
        }
        return {
            quality: 'public_counter',
            metrics: values({
                likes,
                comments,
                reposts,
                quotes,
                engagements: sumKnown(likes, comments, reposts, quotes),
            }),
            providerUpdatedAt: timestamp(status.edited_at) ?? timestamp(status.created_at),
            conversation,
        };
    },
};
function blueskyReplyAnswered(value, ownDid, audienceAt, responseTimes) {
    for (const childValue of list(value.replies)) {
        const child = record(childValue);
        const post = record(child?.post);
        const authorDid = text(record(post?.author)?.did);
        const childAt = timestamp(record(post?.record)?.createdAt);
        if (authorDid === ownDid) {
            if (audienceAt != null && childAt != null)
                responseTimes.push(Math.max(0, (childAt - audienceAt) / 1000));
            return true;
        }
        if (child && blueskyReplyAnswered(child, ownDid, audienceAt, responseTimes))
            return true;
    }
    return false;
}
const bluesky = {
    connectorName: 'bluesky',
    label: 'Bluesky',
    supportedMetrics: ['likes', 'comments', 'reposts', 'quotes', 'saves', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: true,
    requiredScopes: [],
    async syncArtifact(input) {
        const uri = input.artifact.remotePostId;
        const response = await axios_1.default.get('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts', {
            params: { uris: uri },
            timeout: 20_000,
        });
        const post = record(list(record(response.data)?.posts)[0]);
        if (!post)
            throw new Error('Bluesky returned no post for this artifact.');
        const likes = count(post.likeCount);
        const comments = count(post.replyCount);
        const reposts = count(post.repostCount);
        const quotes = count(post.quoteCount);
        const saves = count(post.bookmarkCount);
        let conversation = null;
        try {
            const threadResponse = await axios_1.default.get('https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread', {
                params: { uri, depth: 6, parentHeight: 0 },
                timeout: 20_000,
            });
            const thread = record(record(threadResponse.data)?.thread);
            const ownDid = uri.startsWith('at://') ? uri.slice(5).split('/')[0] : '';
            const topLevel = list(thread?.replies)
                .map(record)
                .filter((item) => Boolean(item));
            const audience = topLevel.filter((item) => text(record(record(item.post)?.author)?.did) !== ownDid);
            const responseTimes = [];
            let answered = 0;
            let oldestUnansweredAt = null;
            for (const item of audience) {
                const audienceAt = timestamp(record(record(item.post)?.record)?.createdAt);
                if (blueskyReplyAnswered(item, ownDid, audienceAt, responseTimes)) {
                    answered += 1;
                }
                else if (audienceAt != null && (oldestUnansweredAt == null || audienceAt < oldestUnansweredAt)) {
                    oldestUnansweredAt = audienceAt;
                }
            }
            conversation = {
                audienceTopLevelCount: audience.length,
                totalReplyCount: comments,
                ownedReplyCount: null,
                answeredThreadCount: answered,
                unansweredThreadCount: audience.length - answered,
                oldestUnansweredAt,
                medianFirstResponseSeconds: median(responseTimes),
                coverageComplete: true,
            };
        }
        catch {
            conversation = null;
        }
        return {
            quality: 'public_counter',
            metrics: values({
                likes,
                comments,
                reposts,
                quotes,
                saves,
                engagements: sumKnown(likes, comments, reposts, quotes, saves),
            }),
            providerUpdatedAt: timestamp(record(post.record)?.createdAt),
            conversation,
        };
    },
};
const devto = {
    connectorName: 'devto',
    label: 'Dev.to',
    supportedMetrics: ['views', 'reactions', 'likes', 'comments', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: false,
    requiredScopes: [],
    async syncArtifact(input, connection) {
        const apiKey = pick(connection.secret, 'apiKey', 'api_key', 'token');
        const response = await axios_1.default.get('https://dev.to/api/articles/' + encodeURIComponent(input.artifact.remotePostId), {
            headers: apiKey ? { 'api-key': apiKey } : {},
            timeout: 20_000,
        });
        const article = record(response.data) ?? {};
        const reactions = count(article.public_reactions_count);
        const likes = count(article.positive_reactions_count);
        const comments = count(article.comments_count);
        const views = count(article.page_views_count);
        return {
            quality: 'public_counter',
            metrics: values({
                views,
                reactions,
                likes,
                comments,
                engagements: sumKnown(reactions ?? likes, comments),
            }),
            providerUpdatedAt: timestamp(article.edited_at) ?? timestamp(article.published_at),
        };
    },
};
const wordpress = {
    connectorName: 'wordpress',
    label: 'WordPress',
    supportedMetrics: ['comments', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: true,
    requiredScopes: [],
    async syncArtifact(input, connection) {
        const rawBase = pick(connection.config, 'siteUrl', 'baseUrl', 'url', 'site_url');
        if (!rawBase)
            throw new Error('WordPress site URL is missing.');
        const base = (/^https?:\/\//i.test(rawBase) ? rawBase : 'https://' + rawBase).replace(/\/+$/, '');
        const authorization = basicAuth(connection);
        const headers = authorization ? { Authorization: authorization } : {};
        const [postResponse, commentsResponse] = await Promise.all([
            axios_1.default.get(base + '/wp-json/wp/v2/posts/' + encodeURIComponent(input.artifact.remotePostId), {
                headers,
                timeout: 20_000,
            }),
            axios_1.default.get(base + '/wp-json/wp/v2/comments', {
                params: {
                    post: input.artifact.remotePostId,
                    per_page: 100,
                    status: 'approve',
                    orderby: 'date',
                    order: 'asc',
                },
                headers,
                timeout: 20_000,
            }),
        ]);
        const comments = list(commentsResponse.data)
            .map(record)
            .filter((item) => Boolean(item));
        const totalComments = count(commentsResponse.headers['x-wp-total']) ?? comments.length;
        let ownAuthorId = null;
        if (authorization) {
            try {
                const me = await axios_1.default.get(base + '/wp-json/wp/v2/users/me', { headers, timeout: 15_000 });
                ownAuthorId = count(record(me.data)?.id);
            }
            catch {
                ownAuthorId = null;
            }
        }
        const topLevel = comments.filter((item) => (count(item.parent) ?? 0) === 0 && count(item.author) !== ownAuthorId);
        const responses = [];
        let answered = 0;
        let oldestUnansweredAt = null;
        for (const root of topLevel) {
            const rootId = count(root.id);
            const rootAt = timestamp(root.date_gmt ?? root.date);
            const ownReplies = comments.filter((item) => count(item.parent) === rootId && ownAuthorId != null && count(item.author) === ownAuthorId);
            if (ownReplies.length) {
                answered += 1;
                const firstAt = Math.min(...ownReplies
                    .map((item) => timestamp(item.date_gmt ?? item.date))
                    .filter((value) => value != null));
                if (rootAt != null && Number.isFinite(firstAt))
                    responses.push(Math.max(0, (firstAt - rootAt) / 1000));
            }
            else if (rootAt != null && (oldestUnansweredAt == null || rootAt < oldestUnansweredAt)) {
                oldestUnansweredAt = rootAt;
            }
        }
        return {
            quality: 'native_lifetime',
            metrics: values({ comments: totalComments, engagements: totalComments }),
            providerUpdatedAt: timestamp(record(postResponse.data)?.modified_gmt),
            conversation: {
                audienceTopLevelCount: ownAuthorId == null ? null : topLevel.length,
                totalReplyCount: totalComments,
                ownedReplyCount: ownAuthorId == null ? null : comments.filter((item) => count(item.author) === ownAuthorId).length,
                answeredThreadCount: ownAuthorId == null ? null : answered,
                unansweredThreadCount: ownAuthorId == null ? null : topLevel.length - answered,
                oldestUnansweredAt: ownAuthorId == null ? null : oldestUnansweredAt,
                medianFirstResponseSeconds: ownAuthorId == null ? null : median(responses),
                coverageComplete: totalComments === comments.length,
            },
        };
    },
};
const discord = {
    connectorName: 'discord',
    label: 'Discord',
    supportedMetrics: ['reactions', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: false,
    requiredScopes: [],
    async syncArtifact(input, connection) {
        const webhook = pick(connection.config, 'webhookUrl', 'webhook_url') ??
            pick(connection.secret, 'webhookUrl', 'webhook_url');
        if (!webhook)
            throw new Error('Discord webhook URL is missing.');
        const cleanWebhook = webhook.split('?')[0].replace(/\/+$/, '');
        const response = await axios_1.default.get(cleanWebhook + '/messages/' + encodeURIComponent(input.artifact.remotePostId), { timeout: 20_000 });
        const message = record(response.data) ?? {};
        const reactions = list(message.reactions)
            .map((item) => count(record(item)?.count) ?? 0)
            .reduce((sum, item) => sum + item, 0);
        return {
            quality: 'public_counter',
            metrics: values({ reactions, engagements: reactions }),
            providerUpdatedAt: timestamp(message.edited_timestamp) ?? timestamp(message.timestamp),
        };
    },
};
function isoDate(date) {
    return date.toISOString().slice(0, 10);
}
const pinterest = {
    connectorName: 'pinterest',
    label: 'Pinterest',
    supportedMetrics: ['impressions', 'saves', 'clicks', 'linkClicks', 'engagements'],
    // This adapter currently stores a lifetime Pin snapshot. Enable the activity lens only after
    // native day buckets are persisted to distribution_metric_daily.
    supportsDailySeries: false,
    supportsConversationSummary: false,
    // These reads are already part of the established Pinterest publisher connection, so analytics
    // must not force a second consent flow or treat older tokens with an omitted scope field as bad.
    requiredScopes: [],
    async syncArtifact(input, connection) {
        const sandbox = (pick(connection.config, 'pinterestEnv') ?? 'production').toLowerCase() === 'sandbox';
        const tokenValue = (sandbox ? pick(connection.secret, 'sandboxToken', 'sandbox_token') : null) ??
            pick(connection.secret, 'productionToken', 'production_token') ??
            connection.accessToken ??
            pick(connection.secret, 'accessToken');
        if (!tokenValue)
            throw new Error('Pinterest analytics access is not connected.');
        const apiBase = sandbox ? 'https://api-sandbox.pinterest.com' : 'https://api.pinterest.com';
        const start = new Date(Math.max(input.artifact.publishedAt, Date.now() - 89 * 86_400_000));
        const end = new Date();
        const response = await axios_1.default.get(apiBase + '/v5/pins/' + encodeURIComponent(input.artifact.remotePostId) + '/analytics', {
            params: {
                start_date: isoDate(start),
                end_date: isoDate(end),
                metric_types: 'IMPRESSION,PIN_CLICK,OUTBOUND_CLICK,SAVE',
                split_field: 'NO_SPLIT',
            },
            headers: authHeader(tokenValue),
            timeout: 25_000,
        });
        const root = record(response.data) ?? {};
        const all = record(root.all) ?? root;
        const summary = record(all.summary_metrics) ?? record(root.summary_metrics) ?? {};
        const impressions = count(summary.IMPRESSION ?? summary.impression);
        const clicks = count(summary.PIN_CLICK ?? summary.pin_click);
        const linkClicks = count(summary.OUTBOUND_CLICK ?? summary.outbound_click);
        const saves = count(summary.SAVE ?? summary.save);
        return {
            quality: 'native_lifetime',
            metrics: values({
                impressions,
                clicks,
                linkClicks,
                saves,
                engagements: sumKnown(clicks, linkClicks, saves),
            }),
        };
    },
};
const youtube = {
    connectorName: 'youtube',
    label: 'YouTube',
    supportedMetrics: [
        'views',
        'likes',
        'comments',
        'shares',
        'engagements',
        'watchTimeSeconds',
        'averageWatchSeconds',
        'averageWatchPercentage',
    ],
    supportsDailySeries: false,
    supportsConversationSummary: true,
    requiredScopes: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
    ],
    scopeFeatures: {
        'https://www.googleapis.com/auth/youtube.readonly': 'Video statistics and comment threads',
        'https://www.googleapis.com/auth/yt-analytics.readonly': 'Watch time and audience performance',
    },
    async syncArtifact(input, connection) {
        if (!connection.accessToken)
            throw new Error('YouTube analytics requires reconnecting the channel.');
        const videoResponse = await axios_1.default.get('https://www.googleapis.com/youtube/v3/videos', {
            params: { part: 'statistics,snippet', id: input.artifact.remotePostId },
            headers: authHeader(connection.accessToken),
            timeout: 20_000,
        });
        const video = record(list(record(videoResponse.data)?.items)[0]);
        if (!video)
            throw new Error('YouTube returned no video for this artifact.');
        const statistics = record(video.statistics) ?? {};
        const snippet = record(video.snippet) ?? {};
        const views = count(statistics.viewCount);
        const likes = count(statistics.likeCount);
        const comments = count(statistics.commentCount);
        let analyticsViews = null;
        let analyticsLikes = null;
        let analyticsComments = null;
        let shares = null;
        let watchTimeSeconds = null;
        let averageWatchSeconds = null;
        let averageWatchPercentage = null;
        try {
            const startDate = new Date(input.artifact.publishedAt).toISOString().slice(0, 10);
            const endDate = new Date().toISOString().slice(0, 10);
            const analyticsResponse = await axios_1.default.get('https://youtubeanalytics.googleapis.com/v2/reports', {
                params: {
                    ids: 'channel==MINE',
                    startDate,
                    endDate,
                    metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares',
                    filters: 'video==' + input.artifact.remotePostId,
                },
                headers: authHeader(connection.accessToken),
                timeout: 25_000,
            });
            const analytics = record(analyticsResponse.data) ?? {};
            const headers = list(analytics.columnHeaders)
                .map((header) => text(record(header)?.name))
                .filter((name) => name != null);
            const row = list(list(analytics.rows)[0]);
            const valueFor = (name) => {
                const index = headers.indexOf(name);
                return index >= 0 ? count(row[index]) : null;
            };
            analyticsViews = valueFor('views');
            analyticsLikes = valueFor('likes');
            analyticsComments = valueFor('comments');
            shares = valueFor('shares');
            const minutesWatched = valueFor('estimatedMinutesWatched');
            watchTimeSeconds = minutesWatched == null ? null : minutesWatched * 60;
            averageWatchSeconds = valueFor('averageViewDuration');
            averageWatchPercentage = valueFor('averageViewPercentage');
        }
        catch {
            // The Data API counters below remain useful if the Analytics report is not eligible yet.
        }
        let conversation = null;
        try {
            const commentResponse = await axios_1.default.get('https://www.googleapis.com/youtube/v3/commentThreads', {
                params: {
                    part: 'snippet,replies',
                    videoId: input.artifact.remotePostId,
                    maxResults: 100,
                    order: 'time',
                    textFormat: 'plainText',
                },
                headers: authHeader(connection.accessToken),
                timeout: 25_000,
            });
            const ownerChannelId = text(snippet.channelId);
            const root = record(commentResponse.data) ?? {};
            const threads = list(root.items)
                .map(record)
                .filter((item) => Boolean(item));
            const audienceThreads = threads.filter((thread) => {
                const threadSnippet = record(thread.snippet) ?? {};
                const topComment = record(record(threadSnippet.topLevelComment)?.snippet) ?? {};
                return text(record(topComment.authorChannelId)?.value) !== ownerChannelId;
            });
            const responseTimes = [];
            let answered = 0;
            let ownedReplyCount = 0;
            let includedReplyCount = 0;
            let expectedReplyCount = 0;
            let oldestUnansweredAt = null;
            for (const thread of audienceThreads) {
                const threadSnippet = record(thread.snippet) ?? {};
                const topComment = record(record(threadSnippet.topLevelComment)?.snippet) ?? {};
                const topAuthor = text(record(topComment.authorChannelId)?.value);
                if (topAuthor === ownerChannelId)
                    continue;
                const topAt = timestamp(topComment.publishedAt);
                const replies = list(record(thread.replies)?.comments)
                    .map(record)
                    .filter((item) => Boolean(item));
                expectedReplyCount += count(threadSnippet.totalReplyCount) ?? 0;
                includedReplyCount += replies.length;
                const ownedReplies = replies.filter((reply) => text(record(record(reply.snippet)?.authorChannelId)?.value) === ownerChannelId);
                ownedReplyCount += ownedReplies.length;
                if (ownedReplies.length) {
                    answered += 1;
                    const firstAt = Math.min(...ownedReplies
                        .map((reply) => timestamp(record(reply.snippet)?.publishedAt))
                        .filter((value) => value != null));
                    if (topAt != null && Number.isFinite(firstAt))
                        responseTimes.push(Math.max(0, (firstAt - topAt) / 1000));
                }
                else if (topAt != null && (oldestUnansweredAt == null || topAt < oldestUnansweredAt)) {
                    oldestUnansweredAt = topAt;
                }
            }
            conversation = {
                audienceTopLevelCount: audienceThreads.length,
                totalReplyCount: analyticsComments ?? comments,
                ownedReplyCount,
                answeredThreadCount: answered,
                unansweredThreadCount: audienceThreads.length - answered,
                oldestUnansweredAt,
                medianFirstResponseSeconds: median(responseTimes),
                coverageComplete: !root.nextPageToken && includedReplyCount >= expectedReplyCount,
            };
        }
        catch {
            conversation = null;
        }
        return {
            quality: 'public_counter',
            metrics: values({
                views: analyticsViews ?? views,
                likes: analyticsLikes ?? likes,
                comments: analyticsComments ?? comments,
                shares,
                watchTimeSeconds,
                averageWatchSeconds,
                averageWatchPercentage,
                engagements: sumKnown(analyticsLikes ?? likes, analyticsComments ?? comments, shares),
            }),
            providerUpdatedAt: timestamp(snippet.publishedAt),
            conversation,
        };
    },
};
const tiktok = {
    connectorName: 'tiktok',
    label: 'TikTok',
    supportedMetrics: ['views', 'likes', 'comments', 'shares', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: false,
    requiredScopes: ['video.list'],
    scopeFeatures: {
        'video.list': 'Published-video views and engagement',
    },
    async syncArtifact(input, connection) {
        if (!connection.accessToken)
            throw new Error('TikTok analytics requires reconnecting the channel.');
        if (input.artifact.mappingStatus === 'pending') {
            throw new Error('TikTok is still waiting for the inbox upload to become a public post.');
        }
        const response = await axios_1.default.post('https://open.tiktokapis.com/v2/video/query/', { filters: { video_ids: [input.artifact.remotePostId] } }, {
            params: {
                fields: 'id,create_time,share_url,like_count,comment_count,share_count,view_count',
            },
            headers: {
                Authorization: 'Bearer ' + connection.accessToken,
                'Content-Type': 'application/json',
            },
            timeout: 25_000,
        });
        const video = record(list(record(record(response.data)?.data)?.videos)[0]);
        if (!video)
            throw new Error('TikTok returned no public video for this artifact.');
        const views = count(video.view_count);
        const likes = count(video.like_count);
        const comments = count(video.comment_count);
        const shares = count(video.share_count);
        return {
            quality: 'public_counter',
            metrics: values({
                views,
                likes,
                comments,
                shares,
                engagements: sumKnown(likes, comments, shares),
            }),
            providerUpdatedAt: timestamp(video.create_time),
        };
    },
    async resolvePendingArtifact(artifact, connection) {
        if (!connection.accessToken)
            return [];
        const response = await axios_1.default.post('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { publish_id: artifact.remotePostId }, {
            headers: {
                Authorization: 'Bearer ' + connection.accessToken,
                'Content-Type': 'application/json; charset=UTF-8',
            },
            timeout: 20_000,
        });
        const data = record(record(response.data)?.data) ?? {};
        const idsValue = data.publicaly_available_post_id ?? data.publicly_available_post_id;
        const ids = Array.isArray(idsValue) ? idsValue : text(idsValue) ? [idsValue] : [];
        return ids
            .map(text)
            .filter((value) => Boolean(value))
            .map((remotePostId) => ({ remotePostId }));
    },
};
function insightMap(payload) {
    const result = new Map();
    for (const itemValue of list(record(payload)?.data)) {
        const item = record(itemValue);
        const name = text(item?.name);
        const value = count(list(item?.values).length ? record(list(item?.values)[0])?.value : null) ??
            count(item?.total_value) ??
            count(item?.value);
        if (name && value != null)
            result.set(name, value);
    }
    return result;
}
const instagram = {
    connectorName: 'instagram',
    label: 'Instagram',
    supportedMetrics: ['views', 'reach', 'likes', 'comments', 'shares', 'saves', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: true,
    requiredScopes: ['instagram_business_manage_insights'],
    supplementalScopes: ['instagram_business_manage_comments'],
    scopeFeatures: {
        instagram_business_manage_insights: 'Post reach, views, saves, shares, and interactions',
        instagram_business_manage_comments: 'Conversation response coverage',
    },
    async syncArtifact(input, connection) {
        if (!connection.accessToken)
            throw new Error('Instagram analytics requires reconnecting the channel.');
        const base = 'https://graph.instagram.com/v23.0';
        const mediaResponse = await axios_1.default.get(base + '/' + encodeURIComponent(input.artifact.remotePostId), {
            params: {
                fields: 'id,like_count,comments_count,timestamp,media_type,permalink',
                access_token: connection.accessToken,
            },
            timeout: 20_000,
        });
        const media = record(mediaResponse.data) ?? {};
        const likes = count(media.like_count);
        const comments = count(media.comments_count);
        let insights = new Map();
        try {
            const insightResponse = await axios_1.default.get(base + '/' + encodeURIComponent(input.artifact.remotePostId) + '/insights', {
                params: {
                    metric: 'views,reach,saved,shares,total_interactions',
                    access_token: connection.accessToken,
                },
                timeout: 20_000,
            });
            insights = insightMap(insightResponse.data);
        }
        catch {
            insights = new Map();
        }
        const views = insights.get('views') ?? null;
        const reach = insights.get('reach') ?? null;
        const saves = insights.get('saved') ?? null;
        const shares = insights.get('shares') ?? null;
        const engagements = insights.get('total_interactions') ??
            sumKnown(likes, comments, saves, shares);
        let conversation = null;
        try {
            const [meResponse, commentsResponse] = await Promise.all([
                axios_1.default.get(base + '/me', {
                    params: { fields: 'user_id,username', access_token: connection.accessToken },
                    timeout: 15_000,
                }),
                axios_1.default.get(base + '/' + encodeURIComponent(input.artifact.remotePostId) + '/comments', {
                    params: {
                        fields: 'id,timestamp,from,replies.limit(100){id,timestamp,from}',
                        limit: 100,
                        access_token: connection.accessToken,
                    },
                    timeout: 25_000,
                }),
            ]);
            const me = record(meResponse.data) ?? {};
            const ownId = text(me.user_id) ?? text(me.id);
            const ownUsername = text(me.username);
            const commentsRoot = record(commentsResponse.data) ?? {};
            const roots = list(commentsRoot.data)
                .map(record)
                .filter((item) => Boolean(item))
                .filter((item) => {
                const from = record(item.from);
                return text(from?.id) !== ownId && text(from?.username) !== ownUsername;
            });
            const responseTimes = [];
            let answered = 0;
            let ownedReplyCount = 0;
            let oldestUnansweredAt = null;
            for (const root of roots) {
                const rootAt = timestamp(root.timestamp);
                const replies = list(record(root.replies)?.data)
                    .map(record)
                    .filter((item) => Boolean(item));
                const owned = replies.filter((reply) => {
                    const from = record(reply.from);
                    return text(from?.id) === ownId || text(from?.username) === ownUsername;
                });
                ownedReplyCount += owned.length;
                if (owned.length) {
                    answered += 1;
                    const firstAt = Math.min(...owned
                        .map((reply) => timestamp(reply.timestamp))
                        .filter((value) => value != null));
                    if (rootAt != null && Number.isFinite(firstAt))
                        responseTimes.push(Math.max(0, (firstAt - rootAt) / 1000));
                }
                else if (rootAt != null && (oldestUnansweredAt == null || rootAt < oldestUnansweredAt)) {
                    oldestUnansweredAt = rootAt;
                }
            }
            conversation = {
                audienceTopLevelCount: roots.length,
                totalReplyCount: comments,
                ownedReplyCount,
                answeredThreadCount: answered,
                unansweredThreadCount: roots.length - answered,
                oldestUnansweredAt,
                medianFirstResponseSeconds: median(responseTimes),
                coverageComplete: !record(commentsRoot.paging)?.next,
            };
        }
        catch {
            conversation = null;
        }
        return {
            quality: 'native_lifetime',
            metrics: values({ views, reach, likes, comments, shares, saves, engagements }),
            providerUpdatedAt: timestamp(media.timestamp),
            conversation,
        };
    },
};
const threads = {
    connectorName: 'threads',
    label: 'Threads',
    supportedMetrics: ['views', 'likes', 'comments', 'reposts', 'quotes', 'shares', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: true,
    requiredScopes: ['threads_manage_insights'],
    supplementalScopes: ['threads_read_replies'],
    scopeFeatures: {
        threads_manage_insights: 'Post views and engagement',
        threads_read_replies: 'Conversation response coverage',
    },
    async syncArtifact(input, connection) {
        if (!connection.accessToken)
            throw new Error('Threads analytics requires reconnecting the channel.');
        const base = 'https://graph.threads.net/v1.0';
        const response = await axios_1.default.get(base + '/' + encodeURIComponent(input.artifact.remotePostId) + '/insights', {
            params: {
                metric: 'views,likes,replies,reposts,quotes,shares',
                access_token: connection.accessToken,
            },
            timeout: 20_000,
        });
        const insights = insightMap(response.data);
        const views = insights.get('views') ?? null;
        const likes = insights.get('likes') ?? null;
        const comments = insights.get('replies') ?? null;
        const reposts = insights.get('reposts') ?? null;
        const quotes = insights.get('quotes') ?? null;
        const shares = insights.get('shares') ?? null;
        let conversation = null;
        try {
            const repliesResponse = await axios_1.default.get(base + '/' + encodeURIComponent(input.artifact.remotePostId) + '/conversation', {
                params: {
                    fields: 'id,timestamp,is_reply_owned_by_me,replied_to,root_post',
                    limit: 100,
                    access_token: connection.accessToken,
                },
                timeout: 25_000,
            });
            const root = record(repliesResponse.data) ?? {};
            const replies = list(root.data)
                .map(record)
                .filter((item) => Boolean(item));
            const rootId = input.artifact.remotePostId;
            const topLevel = replies.filter((item) => text(record(item.replied_to)?.id) === rootId);
            const responseTimes = [];
            let answered = 0;
            let oldestUnansweredAt = null;
            for (const audienceReply of topLevel.filter((item) => item.is_reply_owned_by_me !== true)) {
                const id = text(audienceReply.id);
                const at = timestamp(audienceReply.timestamp);
                const owned = replies
                    .filter((item) => item.is_reply_owned_by_me === true && text(record(item.replied_to)?.id) === id)
                    .sort((a, b) => (timestamp(a.timestamp) ?? 0) - (timestamp(b.timestamp) ?? 0));
                if (owned.length) {
                    answered += 1;
                    const replyAt = timestamp(owned[0].timestamp);
                    if (at != null && replyAt != null)
                        responseTimes.push(Math.max(0, (replyAt - at) / 1000));
                }
                else if (at != null && (oldestUnansweredAt == null || at < oldestUnansweredAt)) {
                    oldestUnansweredAt = at;
                }
            }
            const audienceCount = topLevel.filter((item) => item.is_reply_owned_by_me !== true).length;
            conversation = {
                audienceTopLevelCount: audienceCount,
                totalReplyCount: comments,
                ownedReplyCount: replies.filter((item) => item.is_reply_owned_by_me === true).length,
                answeredThreadCount: answered,
                unansweredThreadCount: audienceCount - answered,
                oldestUnansweredAt,
                medianFirstResponseSeconds: median(responseTimes),
                coverageComplete: !record(root.paging)?.next,
            };
        }
        catch {
            conversation = null;
        }
        return {
            quality: 'native_lifetime',
            metrics: values({
                views,
                likes,
                comments,
                reposts,
                quotes,
                shares,
                engagements: sumKnown(likes, comments, reposts, quotes, shares),
            }),
            conversation,
        };
    },
};
const facebook = {
    connectorName: 'facebook',
    label: 'Facebook Page',
    supportedMetrics: ['impressions', 'reach', 'reactions', 'comments', 'shares', 'clicks', 'engagements'],
    supportsDailySeries: false,
    supportsConversationSummary: true,
    requiredScopes: ['read_insights'],
    supplementalScopes: ['pages_manage_engagement'],
    scopeFeatures: {
        read_insights: 'Page post impressions, reach, clicks, and engagement',
        pages_manage_engagement: 'Conversation response coverage',
    },
    async syncArtifact(input, connection) {
        if (!connection.accessToken)
            throw new Error('Facebook analytics requires reconnecting the channel.');
        const base = 'https://graph.facebook.com/v23.0';
        const pagesResponse = await axios_1.default.get(base + '/me/accounts', {
            params: { fields: 'id,name,access_token', access_token: connection.accessToken },
            timeout: 20_000,
        });
        const pages = list(record(pagesResponse.data)?.data)
            .map(record)
            .filter((item) => Boolean(item));
        const page = pages.find((item) => text(item.id) === input.artifact.remoteAccountId) ??
            (pages.length === 1 ? pages[0] : null);
        const pageToken = text(page?.access_token);
        if (!pageToken)
            throw new Error('The Facebook Page token for this post is unavailable.');
        const postResponse = await axios_1.default.get(base + '/' + encodeURIComponent(input.artifact.remotePostId), {
            params: {
                fields: 'shares,reactions.limit(0).summary(true),comments.limit(100).summary(true){id,from,created_time,comments.limit(100){id,from,created_time}}',
                access_token: pageToken,
            },
            timeout: 25_000,
        });
        const post = record(postResponse.data) ?? {};
        const shares = count(record(post.shares)?.count);
        const reactions = count(record(record(post.reactions)?.summary)?.total_count);
        const commentsRoot = record(post.comments) ?? {};
        const comments = count(record(commentsRoot.summary)?.total_count);
        let insights = new Map();
        try {
            const insightResponse = await axios_1.default.get(base + '/' + encodeURIComponent(input.artifact.remotePostId) + '/insights', {
                params: {
                    metric: 'post_impressions,post_impressions_unique,post_engaged_users,post_clicks',
                    access_token: pageToken,
                },
                timeout: 20_000,
            });
            insights = insightMap(insightResponse.data);
        }
        catch {
            insights = new Map();
        }
        const impressions = insights.get('post_impressions') ?? null;
        const reach = insights.get('post_impressions_unique') ?? null;
        const clicks = insights.get('post_clicks') ?? null;
        const engagements = insights.get('post_engaged_users') ??
            sumKnown(reactions, comments, shares, clicks);
        const pageId = text(page?.id);
        const roots = list(commentsRoot.data)
            .map(record)
            .filter((item) => Boolean(item))
            .filter((item) => text(record(item.from)?.id) !== pageId);
        const responseTimes = [];
        let answered = 0;
        let ownedReplyCount = 0;
        let oldestUnansweredAt = null;
        for (const root of roots) {
            const rootAt = timestamp(root.created_time);
            const replies = list(record(root.comments)?.data)
                .map(record)
                .filter((item) => Boolean(item));
            const owned = replies.filter((reply) => text(record(reply.from)?.id) === pageId);
            ownedReplyCount += owned.length;
            if (owned.length) {
                answered += 1;
                const firstAt = Math.min(...owned
                    .map((reply) => timestamp(reply.created_time))
                    .filter((value) => value != null));
                if (rootAt != null && Number.isFinite(firstAt))
                    responseTimes.push(Math.max(0, (firstAt - rootAt) / 1000));
            }
            else if (rootAt != null && (oldestUnansweredAt == null || rootAt < oldestUnansweredAt)) {
                oldestUnansweredAt = rootAt;
            }
        }
        return {
            quality: 'native_lifetime',
            metrics: values({ impressions, reach, reactions, comments, shares, clicks, engagements }),
            conversation: {
                audienceTopLevelCount: roots.length,
                totalReplyCount: comments,
                ownedReplyCount,
                answeredThreadCount: answered,
                unansweredThreadCount: roots.length - answered,
                oldestUnansweredAt,
                medianFirstResponseSeconds: median(responseTimes),
                coverageComplete: !record(commentsRoot.paging)?.next,
            },
        };
    },
};
exports.DISTRIBUTION_ANALYTICS_PROVIDERS = [
    twitter,
    pinterest,
    mastodon,
    bluesky,
    devto,
    wordpress,
    discord,
    youtube,
    tiktok,
    instagram,
    threads,
    facebook,
];
exports.DISTRIBUTION_ANALYTICS_PROVIDER_MAP = new Map(exports.DISTRIBUTION_ANALYTICS_PROVIDERS.map((provider) => [provider.connectorName, provider]));
function distributionProviderError(error) {
    return errorMessage(error);
}
//# sourceMappingURL=index.js.map