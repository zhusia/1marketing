"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publisherService = exports.PublisherService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const db_1 = require("../db");
const AppRepository_1 = require("./AppRepository");
const ConnectorService_1 = require("./ConnectorService");
const registry_1 = require("./publishers/registry");
const mediaValidation_1 = require("./publishers/mediaValidation");
const OAuthService_1 = require("./oauth/OAuthService");
const userDataPath_1 = require("../utils/userDataPath");
const artifacts_1 = require("./distribution-performance/artifacts");
const repository_1 = require("./distribution-performance/repository");
const CommentService_1 = require("./CommentService");
const connectorScope_1 = require("./publishers/connectorScope");
function resolvePublishFolder() {
    const folder = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), 'published-content');
    fs_1.default.mkdirSync(folder, { recursive: true });
    return folder;
}
function sanitizeFileName(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\-]+/g, '-')
        .replace(/\-+/g, '-')
        .replace(/^\-+|\-+$/g, '')
        .slice(0, 60);
}
/**
 * Channels that can't publish a text-only post and need an image attached for a test post to go
 * through (Pinterest has no text-only pins; Instagram requires media on every post). Add other
 * image-required channels here as they land.
 */
const IMAGE_REQUIRED_CHANNELS = new Set(['pinterest', 'instagram']);
/**
 * Some channels can't publish a text-only post — YouTube/TikTok require a video file, Pinterest an image.
 * For "Send test post" to exercise them end-to-end we attach a small bundled sample (resources/samples/,
 * shipped via the electron-builder `files` glob). Returns [] for channels that need no attachment.
 */
function sampleMediaForTest(channel) {
    const samplesDir = path_1.default.resolve(electron_1.app.getAppPath(), 'resources', 'samples');
    if (channel === 'youtube' || channel === 'tiktok') {
        return [{ path: path_1.default.join(samplesDir, 'youtube-test-video.mp4'), type: 'video/mp4' }];
    }
    if (IMAGE_REQUIRED_CHANNELS.has(channel)) {
        return [
            {
                path: path_1.default.join(samplesDir, 'social-test-image.png'),
                type: 'image/png',
                alt: '1Marketing Tool — sample image for a social test post',
            },
        ];
    }
    return [];
}
function inferChannels(content) {
    const platform = content.metadata?.platform;
    if (typeof platform === 'string' && platform.trim())
        return [platform.trim()];
    if (content.type === 'blog')
        return ['ghost', 'wordpress'];
    if (content.type === 'tweet_thread')
        return ['twitter'];
    if (content.type === 'linkedin')
        return ['linkedin'];
    if (content.type === 'reddit')
        return ['reddit'];
    return ['local'];
}
/** Whether the channel is paused for a specific project (mapped, but publishing muted — Phase 4). */
function connectorMutedForProject(config, productId) {
    if (!config || productId == null)
        return false;
    const raw = config.mutedProjectIds;
    return Array.isArray(raw) && raw.includes(productId);
}
/** Whether a channel connector is mapped to a given project. 'all'-scope (or unset) serves every project. */
function connectorServesProject(config, productId) {
    if (!config)
        return true;
    // Facebook page-map model (see facebookPageMapping.ts): a project is served unless its mapping is an
    // explicit empty array (skip). Absent ⇒ inherits the default Page, so still served.
    if (config.pageMap && typeof config.pageMap === 'object') {
        const entry = productId != null ? config.pageMap[productId] : undefined;
        if (Array.isArray(entry))
            return entry.length > 0;
        return true;
    }
    // Generic scope model used by the other channels.
    if ((0, connectorScope_1.rootConnectorServesProject)(config, productId))
        return true;
    return (0, connectorScope_1.readConnectorProfiles)(config).some((profile) => (0, connectorScope_1.profileServesProject)(profile, productId));
}
class PublisherService {
    async publishContent(contentId, channels) {
        const content = AppRepository_1.repository.getContentById(contentId);
        if (!content)
            return null;
        const targetChannels = channels?.length ? channels : inferChannels(content);
        const publishedChannels = [];
        const skippedChannels = [];
        const urls = [];
        for (const channel of targetChannels) {
            if (channel === 'local') {
                const fileName = `${Date.now()}-${sanitizeFileName(content.title)}.md`;
                const filePath = path_1.default.join(resolvePublishFolder(), fileName);
                fs_1.default.writeFileSync(filePath, `# ${content.title}\n\n${content.content}\n`, 'utf8');
                AppRepository_1.repository.createPublishHistory(content.id, channel, filePath, { persisted: true });
                publishedChannels.push(channel);
                urls.push(filePath);
                continue;
            }
            const connector = AppRepository_1.repository.getConnector(channel);
            if (!connector || !connector.enabled || connector.status === 'error') {
                skippedChannels.push(channel);
                continue;
            }
            const fileName = `${Date.now()}-${channel}-${sanitizeFileName(content.title)}.md`;
            const filePath = path_1.default.join(resolvePublishFolder(), fileName);
            fs_1.default.writeFileSync(filePath, [`# ${content.title}`, '', `Channel: ${channel}`, '', content.content].join('\n'), 'utf8');
            AppRepository_1.repository.createPublishHistory(content.id, channel, filePath, {
                mode: 'local-stub',
                note: 'Connector enabled. Replace with direct API publish in production connector implementation.',
            });
            publishedChannels.push(channel);
            urls.push(filePath);
        }
        AppRepository_1.repository.updateContent({
            id: content.id,
            status: publishedChannels.length ? 'published' : content.status,
            publishedAt: publishedChannels.length ? Date.now() : content.publishedAt,
            metadata: {
                ...content.metadata,
                publishedChannels,
                skippedChannels,
            },
        });
        return {
            contentId: content.id,
            publishedChannels,
            skippedChannels,
            urls,
        };
    }
    async publishScheduledDueContent() {
        const now = Date.now();
        const dueItems = AppRepository_1.repository
            .listContent({ status: 'scheduled' })
            .filter((item) => typeof item.scheduledAt === 'number' && item.scheduledAt <= now);
        let published = 0;
        for (const item of dueItems) {
            // Pause/delete may have reset a pipeline item after this sweep captured its due list.
            const current = AppRepository_1.repository.getContentById(item.id);
            if (!current || current.status !== 'scheduled' || current.scheduledAt === null || current.scheduledAt > now) {
                continue;
            }
            await this.publishContent(current.id);
            published += 1;
        }
        return published;
    }
    /** Retry backoff per failed attempt: 1m, 5m, 30m, then give up. */
    backoffMs(priorAttempts) {
        const schedule = [60_000, 5 * 60_000, 30 * 60_000];
        return schedule[Math.min(priorAttempts, schedule.length - 1)];
    }
    /** Publish one scheduled post across its targets, recording per-target results and rolling up status. */
    async publishScheduledPost(postId, eventType = 'scheduled_post') {
        const post = AppRepository_1.repository.getScheduledPost(postId);
        if (!post || post.status === 'canceled')
            return post;
        AppRepository_1.repository.setScheduledPostStatus(post.id, 'publishing');
        const product = AppRepository_1.repository.getProduct(post.productId);
        const nowTs = Date.now();
        for (const target of post.targets) {
            if (target.status === 'published')
                continue;
            if (typeof target.nextAttemptAt === 'number' && target.nextAttemptAt > nowTs)
                continue;
            const publisher = (0, registry_1.getPublisher)(target.connectorName);
            if (!publisher || !publisher.descriptor.implemented) {
                const error = publisher
                    ? `${publisher.descriptor.label} publishing is coming soon.`
                    : `Unknown platform: ${target.connectorName}`;
                AppRepository_1.repository.updatePostTarget(target.id, {
                    status: 'skipped',
                    error,
                });
                AppRepository_1.repository.createDistributionEvent({
                    productId: post.productId,
                    connectorName: target.connectorName,
                    eventType,
                    status: 'skipped',
                    postId: post.id,
                    targetId: target.id,
                    message: error,
                    error,
                    metadata: { reason: 'publisher_unavailable' },
                });
                continue;
            }
            const connector = AppRepository_1.repository.getConnector(target.connectorName);
            if (!connector || !connector.enabled) {
                const error = `${target.connectorName} connector is not enabled.`;
                AppRepository_1.repository.updatePostTarget(target.id, {
                    status: 'skipped',
                    error,
                });
                AppRepository_1.repository.createDistributionEvent({
                    productId: post.productId,
                    connectorName: target.connectorName,
                    eventType,
                    status: 'skipped',
                    postId: post.id,
                    targetId: target.id,
                    message: error,
                    error,
                    metadata: { reason: 'connector_disabled' },
                });
                continue;
            }
            if (!connectorServesProject(connector.config, post.productId)) {
                const error = `${target.connectorName} is not mapped to this project.`;
                AppRepository_1.repository.updatePostTarget(target.id, {
                    status: 'skipped',
                    error,
                });
                AppRepository_1.repository.createDistributionEvent({
                    productId: post.productId,
                    connectorName: target.connectorName,
                    eventType,
                    status: 'skipped',
                    postId: post.id,
                    targetId: target.id,
                    message: error,
                    error,
                    metadata: { reason: 'project_mapping' },
                });
                continue;
            }
            if (connectorMutedForProject(connector.config, post.productId)) {
                const error = `${target.connectorName} is paused for this project.`;
                AppRepository_1.repository.updatePostTarget(target.id, { status: 'skipped', error });
                AppRepository_1.repository.createDistributionEvent({
                    productId: post.productId,
                    connectorName: target.connectorName,
                    eventType,
                    status: 'skipped',
                    postId: post.id,
                    targetId: target.id,
                    message: error,
                    error,
                    metadata: { reason: 'project_muted' },
                });
                continue;
            }
            const mediaValidation = await mediaValidation_1.postMediaValidationService.validate({
                media: post.media,
                channels: [target.connectorName],
                optionsByChannel: { [target.connectorName]: target.options },
            });
            if (!mediaValidation.valid) {
                const error = mediaValidation.issues.map((issue) => issue.message).join(' ');
                AppRepository_1.repository.updatePostTarget(target.id, {
                    status: 'failed',
                    attempts: Math.max(target.attempts + 1, 4),
                    error,
                    nextAttemptAt: null,
                });
                AppRepository_1.repository.createDistributionEvent({
                    productId: post.productId,
                    connectorName: target.connectorName,
                    eventType,
                    status: 'failed',
                    postId: post.id,
                    targetId: target.id,
                    message: `${publisher.descriptor.label} media is incompatible.`,
                    error,
                    metadata: {
                        reason: 'media_validation',
                        issues: mediaValidation.issues,
                    },
                });
                continue;
            }
            AppRepository_1.repository.updatePostTarget(target.id, { status: 'publishing' });
            const profileConfig = (0, connectorScope_1.connectorConfigForProject)(connector.config, post.productId);
            const publishConfig = target.connectorName === 'facebook' && target.accountRef
                ? {
                    ...profileConfig,
                    pageMap: {
                        ...(profileConfig.pageMap && typeof profileConfig.pageMap === 'object'
                            ? profileConfig.pageMap
                            : {}),
                        [post.productId]: [target.accountRef],
                    },
                }
                : profileConfig;
            const baseSecret = await ConnectorService_1.connectorService.getSecret(target.connectorName, post.productId);
            const outcome = await this.resolveOAuth(publisher, target.connectorName, baseSecret, publishConfig)
                .then((secret) => {
                // A pause/delete can arrive while credentials or OAuth are being resolved. This is the
                // last safe cancellation point before the remote API request begins.
                const current = AppRepository_1.repository.getScheduledPost(post.id);
                if (!current || current.status === 'canceled')
                    return null;
                return publisher.publish({
                    body: target.bodyOverride ?? post.body,
                    media: post.media,
                    firstComment: target.firstComment,
                    product,
                    options: target.options,
                }, secret, publishConfig);
            })
                .catch((error) => ({
                ok: false,
                url: null,
                response: {},
                error: error instanceof Error ? error.message : 'Publish failed.',
            }));
            if (!outcome)
                return AppRepository_1.repository.getScheduledPost(post.id);
            const publishedAt = Date.now();
            const artifacts = (0, artifacts_1.normalizePublishedArtifacts)(target.connectorName, outcome, publishedAt);
            const persistRemoteOutcome = (includeUnavailableMarker = false) => {
                const storedArtifacts = artifacts.length || !includeUnavailableMarker
                    ? artifacts
                    : [
                        {
                            remotePostId: `unavailable:${target.id}`,
                            kind: 'post',
                            publishedAt,
                            identitySource: 'publish_response',
                            mappingStatus: 'unavailable',
                            providerMetadata: { reason: 'publisher_did_not_return_remote_identity' },
                        },
                    ];
                (0, db_1.getDb)().transaction(() => {
                    AppRepository_1.repository.createPostPublishHistory({
                        targetId: target.id,
                        postId: post.id,
                        connectorName: target.connectorName,
                        publishedUrl: outcome.url,
                        response: outcome.response,
                    });
                    repository_1.distributionPerformanceRepository.upsertPublishedArtifacts({
                        targetId: target.id,
                        scheduledPostId: post.id,
                        contentId: post.contentId,
                        productId: post.productId,
                        connectorName: target.connectorName,
                        accountRef: target.accountRef,
                        artifacts: storedArtifacts,
                    });
                })();
            };
            if (outcome.ok) {
                AppRepository_1.repository.updatePostTarget(target.id, {
                    status: 'published',
                    publishedUrl: outcome.url,
                    error: null,
                    nextAttemptAt: null,
                });
                persistRemoteOutcome(true);
                // Arm follow-up comments straight away: the publish time is known exactly here, so a
                // "30 seconds later" comment runs on a timer instead of waiting for the next sweep (§9.2).
                CommentService_1.commentService.armAfterPublish(target.id);
                const message = outcome.message ?? `${publisher.descriptor.label} published successfully.`;
                AppRepository_1.repository.createDistributionEvent({
                    productId: post.productId,
                    connectorName: target.connectorName,
                    eventType,
                    status: 'success',
                    postId: post.id,
                    targetId: target.id,
                    message,
                    publishedUrl: outcome.url,
                    metadata: { response: outcome.response, artifactCount: artifacts.length, accountRef: target.accountRef },
                });
            }
            else {
                // Some multi-story publishers can create one or more physical posts before another story
                // fails. Preserve those identities even though the target remains retryable/failed.
                if (artifacts.length)
                    persistRemoteOutcome();
                const attempts = target.attempts + 1;
                const giveUp = attempts >= 4;
                const error = outcome.error ?? 'Publish failed.';
                AppRepository_1.repository.updatePostTarget(target.id, {
                    status: 'failed',
                    attempts,
                    error,
                    nextAttemptAt: giveUp ? null : Date.now() + this.backoffMs(attempts - 1),
                });
                AppRepository_1.repository.createDistributionEvent({
                    productId: post.productId,
                    connectorName: target.connectorName,
                    eventType,
                    status: 'failed',
                    postId: post.id,
                    targetId: target.id,
                    message: `${publisher.descriptor.label} publish failed.`,
                    error,
                    metadata: {
                        attempts,
                        giveUp,
                        response: outcome.response,
                        artifactCount: artifacts.length,
                        accountRef: target.accountRef,
                    },
                });
            }
        }
        const refreshed = AppRepository_1.repository.getScheduledPost(post.id);
        if (refreshed) {
            const total = refreshed.targets.length;
            const published = refreshed.targets.filter((target) => target.status === 'published').length;
            let status;
            if (total > 0 && published === total)
                status = 'published';
            else if (published > 0)
                status = 'partial';
            else
                status = 'failed';
            AppRepository_1.repository.setScheduledPostStatus(post.id, status);
            if (total > 1) {
                const eventStatus = status === 'published' ? 'success' : status === 'partial' ? 'partial' : 'failed';
                AppRepository_1.repository.createDistributionEvent({
                    productId: post.productId,
                    connectorName: 'multiple',
                    eventType,
                    status: eventStatus,
                    postId: post.id,
                    message: `${eventType === 'manual_post' ? 'Manual' : 'Scheduled'} post finished: ${published}/${total} channels published.`,
                    metadata: {
                        total,
                        published,
                        failed: refreshed.targets.filter((target) => target.status === 'failed').length,
                        skipped: refreshed.targets.filter((target) => target.status === 'skipped').length,
                        targets: refreshed.targets.map((target) => ({
                            connectorName: target.connectorName,
                            status: target.status,
                        })),
                    },
                });
            }
        }
        return AppRepository_1.repository.getScheduledPost(post.id);
    }
    /** Sweep entry point: publish every scheduled post whose time has arrived. */
    async publishDueScheduledPosts() {
        const due = AppRepository_1.repository.listDueScheduledPosts(Date.now());
        for (const post of due) {
            await this.publishScheduledPost(post.id);
        }
        return due.length;
    }
    /** Manual "publish now": reset every target to pending and fire immediately, bypassing the schedule. */
    async publishScheduledPostNow(postId) {
        const post = AppRepository_1.repository.getScheduledPost(postId);
        if (!post)
            return null;
        for (const target of post.targets) {
            AppRepository_1.repository.updatePostTarget(target.id, {
                status: 'pending',
                attempts: 0,
                nextAttemptAt: null,
                publishedUrl: null,
                error: null,
            });
        }
        return this.publishScheduledPost(postId, 'manual_post');
    }
    async testPublishingChannel(channel) {
        const connector = AppRepository_1.repository.getConnector(channel);
        if (!connector || !connector.enabled) {
            return { ok: false, message: `${channel} connector is not enabled.` };
        }
        const test = await ConnectorService_1.connectorService.testConnector(channel);
        return { ok: test.ok, message: test.message };
    }
    /**
     * Publish a real, clearly-labelled test message through a channel's live publisher so the user
     * can confirm end-to-end delivery (not just credential validity). Posts for real — on public
     * networks (X, Mastodon, Bluesky) it appears on the account timeline.
     */
    /** For OAuth2 channels, refresh + inject a valid access token into the secret handed to the publisher. */
    async resolveOAuth(publisher, channel, base, config) {
        if (publisher.descriptor.authKind !== 'oauth2' && publisher.descriptor.authKind !== 'oauth2_relay')
            return base;
        // Pinterest uses an explicit environment switch. Sandbox always uses the pasted sandbox token; in
        // production a pasted token (if present) wins over OAuth. Either way we skip the OAuth fetch so a
        // sandbox-only / paste-token setup works without ever connecting (and the prod OAuth token wouldn't
        // authorize against api-sandbox anyway).
        if (channel === 'pinterest') {
            const sandbox = (typeof config?.pinterestEnv === 'string' ? config.pinterestEnv : 'production').toLowerCase() === 'sandbox';
            if (sandbox)
                return base;
            if (typeof base?.productionToken === 'string' && base.productionToken.trim())
                return base;
        }
        const accessToken = await OAuthService_1.oauthService.ensureFreshToken(channel);
        return { ...(base ?? {}), accessToken };
    }
    async sendTestPost(channel, productId) {
        const publisher = (0, registry_1.getPublisher)(channel);
        if (!publisher || !publisher.descriptor.implemented) {
            const message = `${channel} does not support test posts yet.`;
            AppRepository_1.repository.createDistributionEvent({
                productId: productId ?? null,
                connectorName: channel,
                eventType: 'test_post',
                status: 'skipped',
                message,
                error: message,
                metadata: { reason: 'publisher_unavailable' },
            });
            return { ok: false, message, url: null };
        }
        const connector = AppRepository_1.repository.getConnector(channel);
        if (!connector) {
            const message = `Save the ${publisher.descriptor.label} channel before sending a test post.`;
            AppRepository_1.repository.createDistributionEvent({
                productId: productId ?? null,
                connectorName: channel,
                eventType: 'test_post',
                status: 'skipped',
                message,
                error: message,
                metadata: { reason: 'connector_missing' },
            });
            return { ok: false, message, url: null };
        }
        const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
        const body = `✅ Test post from 1Marketing Tool — your ${publisher.descriptor.label} channel is connected and can publish. (${stamp} UTC)`;
        const profileConfig = (0, connectorScope_1.connectorConfigForProject)(connector.config, productId ?? null);
        let secret;
        try {
            secret = await this.resolveOAuth(publisher, channel, await ConnectorService_1.connectorService.getSecret(channel, productId ?? null), profileConfig);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'OAuth token unavailable.';
            AppRepository_1.repository.updateConnector({ name: channel, status: 'attention', lastError: message });
            AppRepository_1.repository.createDistributionEvent({
                productId: productId ?? null,
                connectorName: channel,
                eventType: 'test_post',
                status: 'failed',
                message,
                error: message,
                metadata: { reason: 'oauth_unavailable' },
            });
            return { ok: false, message, url: null };
        }
        const media = sampleMediaForTest(channel);
        const outcome = await publisher.publish({ body, media, firstComment: null, product: null }, secret, profileConfig);
        if (outcome.ok) {
            // A successful publish proves the channel end-to-end → mark it verified so the card pill turns green.
            AppRepository_1.repository.updateConnector({ name: channel, status: 'connected', lastError: null, lastTestedAt: Date.now() });
            const message = outcome.message ?? `Test post published to ${publisher.descriptor.label}.`;
            AppRepository_1.repository.createDistributionEvent({
                productId: productId ?? null,
                connectorName: channel,
                eventType: 'test_post',
                status: 'success',
                message,
                publishedUrl: outcome.url,
                metadata: { response: outcome.response },
            });
            return { ok: true, message, url: outcome.url };
        }
        const error = outcome.error ?? 'Test post failed.';
        AppRepository_1.repository.updateConnector({
            name: channel,
            status: 'attention',
            lastError: error,
            lastTestedAt: Date.now(),
        });
        AppRepository_1.repository.createDistributionEvent({
            productId: productId ?? null,
            connectorName: channel,
            eventType: 'test_post',
            status: 'failed',
            message: error,
            error,
            metadata: { response: outcome.response },
        });
        return { ok: false, message: error, url: null };
    }
}
exports.PublisherService = PublisherService;
exports.publisherService = new PublisherService();
//# sourceMappingURL=PublisherService.js.map