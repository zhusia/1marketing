"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePublishedArtifacts = normalizePublishedArtifacts;
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function asString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function kindFor(connectorName) {
    if (connectorName === 'youtube' || connectorName === 'tiktok')
        return 'video';
    if (connectorName === 'pinterest')
        return 'pin';
    if (connectorName === 'wordpress' ||
        connectorName === 'ghost' ||
        connectorName === 'devto' ||
        connectorName === 'hashnode') {
        return 'article';
    }
    if (connectorName === 'telegram' || connectorName === 'discord' || connectorName === 'slack')
        return 'message';
    if (connectorName === 'threads')
        return 'thread';
    return 'post';
}
function artifactFromUrl(connectorName, url) {
    let remotePostId = null;
    let remoteAccountId;
    try {
        if (connectorName === 'twitter') {
            remotePostId = url.match(/\/status\/([^/?#]+)/i)?.[1] ?? null;
        }
        else if (connectorName === 'bluesky') {
            const match = url.match(/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/i);
            if (match) {
                remoteAccountId = decodeURIComponent(match[1]);
                remotePostId = remoteAccountId.startsWith('did:')
                    ? 'at://' + remoteAccountId + '/app.bsky.feed.post/' + match[2]
                    : match[2];
            }
        }
        else if (connectorName === 'pinterest') {
            remotePostId = url.match(/\/pin\/([^/?#]+)/i)?.[1] ?? null;
        }
        else if (connectorName === 'youtube') {
            remotePostId =
                new URL(url).searchParams.get('v') ??
                    url.match(/youtu\.be\/([^/?#]+)/i)?.[1] ??
                    url.match(/\/shorts\/([^/?#]+)/i)?.[1] ??
                    null;
        }
        else if (connectorName === 'facebook') {
            const video = url.match(/facebook\.com\/([^/]+)\/videos\/([^/?#]+)/i);
            if (video) {
                remoteAccountId = video[1];
                remotePostId = video[2];
            }
            else {
                remotePostId = url.match(/facebook\.com\/([^/?#]+)\/?$/i)?.[1] ?? null;
                if (remotePostId?.includes('_'))
                    remoteAccountId = remotePostId.split('_')[0];
            }
        }
        else if (connectorName === 'mastodon') {
            remotePostId = url.match(/\/([^/?#]+)\/?$/)?.[1] ?? null;
        }
    }
    catch {
        return null;
    }
    if (!remotePostId)
        return null;
    return {
        remotePostId,
        remoteAccountId,
        url,
        kind: kindFor(connectorName),
        identitySource: 'url_backfill',
        mappingStatus: 'resolved',
    };
}
function responseArtifacts(connectorName, response) {
    const artifacts = [];
    const data = asRecord(response.data);
    const result = asRecord(response.result);
    const pushId = (remotePostId, options = {}) => {
        if (!remotePostId)
            return;
        artifacts.push({
            remotePostId,
            kind: options.kind ?? kindFor(connectorName),
            identitySource: options.identitySource ?? 'publish_response',
            mappingStatus: options.mappingStatus ?? 'resolved',
            ...options,
        });
    };
    if (connectorName === 'instagram') {
        pushId(asString(response.mediaId), {
            remoteAccountName: asString(response.account) ?? undefined,
        });
    }
    else if (connectorName === 'tiktok') {
        const statusData = data ?? response;
        const publicIds = statusData.publicaly_available_post_id ??
            statusData.publicly_available_post_id ??
            response.publicaly_available_post_id;
        if (Array.isArray(publicIds)) {
            for (const id of publicIds)
                pushId(asString(id), { identitySource: 'status_resolution' });
        }
        else {
            pushId(asString(publicIds), { identitySource: 'status_resolution' });
        }
        if (!artifacts.length) {
            const publishId = asString(response.publish_id) ?? asString(statusData.publish_id);
            pushId(publishId, {
                remoteParentId: publishId ?? undefined,
                mappingStatus: 'pending',
                providerMetadata: publishId ? { publishId } : undefined,
            });
        }
    }
    else if (connectorName === 'telegram') {
        const message = result ?? data ?? response;
        const chat = asRecord(message.chat);
        pushId(typeof message.message_id === 'number' ? String(message.message_id) : asString(message.message_id), {
            remoteAccountId: typeof chat?.id === 'number' ? String(chat.id) : asString(chat?.id) ?? undefined,
        });
    }
    else if (connectorName === 'discord') {
        const messages = Array.isArray(response.messages) ? response.messages : [response];
        for (const value of messages) {
            const message = asRecord(value);
            pushId(asString(message?.id), {
                remoteAccountId: asString(message?.channel_id) ?? undefined,
            });
        }
    }
    else if (connectorName === 'facebook') {
        const results = Array.isArray(response.results) ? response.results : [];
        for (const item of results) {
            const record = asRecord(item);
            const nested = Array.isArray(record?.artifacts) ? record.artifacts : [];
            for (const value of nested) {
                const artifact = asRecord(value);
                pushId(asString(artifact?.remotePostId), {
                    remoteAccountId: asString(artifact?.remoteAccountId) ?? asString(record?.id) ?? undefined,
                    remoteAccountName: asString(record?.name) ?? undefined,
                    url: asString(artifact?.url) ?? undefined,
                    kind: asString(artifact?.kind) ?? 'post',
                });
            }
            if (nested.length)
                continue;
            const urls = Array.isArray(record?.urls) ? record.urls : [record?.url];
            for (const value of urls) {
                const url = asString(value);
                const fromUrl = url ? artifactFromUrl(connectorName, url) : null;
                if (!fromUrl)
                    continue;
                artifacts.push({
                    ...fromUrl,
                    remoteAccountId: asString(record?.id) ?? fromUrl.remoteAccountId,
                    remoteAccountName: asString(record?.name) ?? undefined,
                    identitySource: 'publish_response',
                });
            }
        }
    }
    else if (connectorName === 'twitter') {
        const tweets = Array.isArray(response.tweets) ? response.tweets : [];
        for (const value of tweets) {
            const tweet = asRecord(value);
            pushId(asString(tweet?.id), { url: asString(tweet?.url) ?? undefined });
        }
    }
    else if (connectorName === 'mastodon') {
        const records = Array.isArray(response.records) ? response.records : [response];
        for (const value of records) {
            const status = asRecord(value);
            const url = asString(status?.url);
            const accountId = asString(asRecord(status?.account)?.id);
            let remoteAccountId = accountId ?? undefined;
            try {
                if (url)
                    remoteAccountId = `${new URL(url).origin}${accountId ? `#${accountId}` : ''}`;
            }
            catch {
                // Keep the instance-local account id when the historical URL is malformed.
            }
            pushId(asString(status?.id), {
                remoteAccountId,
                url: url ?? undefined,
            });
        }
    }
    else if (connectorName === 'bluesky') {
        const posts = Array.isArray(response.posts) ? response.posts : [response];
        for (const value of posts) {
            const post = asRecord(value);
            const cid = asString(post?.cid);
            pushId(asString(post?.uri), {
                remoteAccountId: asString(post?.uri)?.startsWith('at://')
                    ? asString(post?.uri)?.slice(5).split('/')[0]
                    : undefined,
                url: asString(post?.url) ?? undefined,
                providerMetadata: cid ? { cid } : undefined,
            });
        }
    }
    else if (connectorName === 'wordpress') {
        const id = asString(response.id) ??
            (typeof response.id === 'number' ? String(response.id) : null);
        const url = asString(response.link);
        let remoteAccountId;
        try {
            remoteAccountId = url ? new URL(url).origin : undefined;
        }
        catch {
            remoteAccountId = undefined;
        }
        pushId(id, { remoteAccountId, url: url ?? undefined, kind: 'article' });
    }
    else {
        const id = asString(response.id) ??
            (typeof response.id === 'number' ? String(response.id) : null) ??
            asString(data?.id) ??
            (typeof data?.id === 'number' ? String(data.id) : null);
        const stableIdConnectors = new Set([
            'wordpress',
            'ghost',
            'devto',
            'hashnode',
            'pinterest',
            'youtube',
            'threads',
            'custom_api',
        ]);
        if (stableIdConnectors.has(connectorName))
            pushId(id);
    }
    return artifacts;
}
function responseUrls(response) {
    const urls = [];
    if (Array.isArray(response.urls)) {
        for (const value of response.urls) {
            const url = asString(value);
            if (url)
                urls.push(url);
        }
    }
    if (Array.isArray(response.results)) {
        for (const value of response.results) {
            const url = asString(asRecord(value)?.url);
            if (url)
                urls.push(url);
        }
    }
    return urls;
}
/**
 * Normalize old and new publisher outcomes into durable remote artifacts.
 * Publisher-supplied artifacts win; URL/response parsing is the compatibility backstop.
 */
function normalizePublishedArtifacts(connectorName, outcome, publishedAt = Date.now()) {
    const candidates = outcome.artifacts?.length
        ? outcome.artifacts
        : [
            ...responseArtifacts(connectorName, outcome.response),
            ...[outcome.url, ...responseUrls(outcome.response)]
                .filter((value) => Boolean(value))
                .map((url) => artifactFromUrl(connectorName, url))
                .filter((value) => Boolean(value)),
        ];
    const seen = new Set();
    const normalized = [];
    for (const artifact of candidates) {
        const remotePostId = artifact.remotePostId.trim();
        if (!remotePostId)
            continue;
        const key = [artifact.remoteAccountId ?? '', remotePostId].join(':');
        if (seen.has(key))
            continue;
        seen.add(key);
        normalized.push({
            ...artifact,
            remotePostId,
            publishedAt: artifact.publishedAt ?? publishedAt,
            identitySource: artifact.identitySource ?? 'publish_response',
            mappingStatus: artifact.mappingStatus ?? 'resolved',
        });
    }
    return normalized;
}
//# sourceMappingURL=artifacts.js.map