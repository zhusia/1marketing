"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distributionPerformanceRepository = exports.DistributionPerformanceRepository = void 0;
const db_1 = require("../../db");
const id_1 = require("../../utils/id");
const json_1 = require("../../utils/json");
const metrics_1 = require("./metrics");
function mapArtifact(row) {
    return {
        id: row.id,
        targetId: row.target_id,
        scheduledPostId: row.scheduled_post_id,
        contentId: row.content_id,
        productId: row.product_id,
        connectorName: row.connector_name,
        accountRef: row.account_ref,
        remoteAccountId: row.remote_account_id || null,
        remoteAccountName: row.remote_account_name,
        remotePostId: row.remote_post_id,
        remoteParentId: row.remote_parent_id,
        remoteUrl: row.remote_url,
        artifactKind: row.artifact_kind,
        artifactIndex: row.artifact_index,
        publishedAt: row.published_at,
        identitySource: row.identity_source,
        mappingStatus: row.mapping_status,
        providerMetadata: (0, json_1.safeParseJson)(row.provider_metadata_json, {}),
        lastCheckedAt: row.last_checked_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function metricsFromRow(row) {
    return {
        impressions: row.impressions,
        views: row.views,
        reach: row.reach,
        engagements: row.engagements,
        reactions: row.reactions,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        reposts: row.reposts,
        quotes: row.quotes,
        saves: row.saves,
        clicks: row.clicks,
        linkClicks: row.link_clicks,
        videoStarts: row.video_starts,
        watchTimeSeconds: row.watch_time_seconds,
        averageWatchSeconds: row.average_watch_seconds,
        averageWatchPercentage: row.average_watch_percentage,
    };
}
function metricParams(metrics) {
    return {
        impressions: metrics.impressions,
        views: metrics.views,
        reach: metrics.reach,
        engagements: metrics.engagements,
        reactions: metrics.reactions,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        reposts: metrics.reposts,
        quotes: metrics.quotes,
        saves: metrics.saves,
        clicks: metrics.clicks,
        linkClicks: metrics.linkClicks,
        videoStarts: metrics.videoStarts,
        watchTimeSeconds: metrics.watchTimeSeconds,
        averageWatchSeconds: metrics.averageWatchSeconds,
        averageWatchPercentage: metrics.averageWatchPercentage,
    };
}
function metricValuesEqual(left, right) {
    return Object.keys(metrics_1.EMPTY_DISTRIBUTION_METRICS).every((key) => {
        const metricKey = key;
        return left[metricKey] === right[metricKey];
    });
}
function hasCounterDecrease(left, right) {
    return Object.keys(metrics_1.EMPTY_DISTRIBUTION_METRICS).some((key) => {
        const metricKey = key;
        return left[metricKey] != null && right[metricKey] != null && right[metricKey] < left[metricKey];
    });
}
function filterSql(filters, dateColumn) {
    const clauses = [dateColumn + ' >= ?', dateColumn + ' <= ?'];
    const args = [filters.from, filters.to];
    const productIds = filters.productId
        ? [filters.productId]
        : (filters.productIds ?? []).filter(Boolean);
    if (productIds.length) {
        clauses.push('sp.product_id IN (' + productIds.map(() => '?').join(', ') + ')');
        args.push(...productIds);
    }
    else if (!filters.productId && Array.isArray(filters.productIds)) {
        // An explicitly empty workspace scope must not fall through to every project in the database.
        clauses.push('1 = 0');
    }
    if (filters.connectorName && filters.connectorName !== 'all') {
        clauses.push('pt.connector_name = ?');
        args.push(filters.connectorName);
    }
    return { where: clauses.join(' AND '), args };
}
class DistributionPerformanceRepository {
    db = (0, db_1.getDb)();
    upsertPublishedArtifacts(input) {
        const timestamp = Date.now();
        const statement = this.db.prepare([
            'INSERT INTO distribution_post_artifacts (',
            'id, target_id, scheduled_post_id, content_id, product_id, connector_name, account_ref,',
            'remote_account_id, remote_account_name, remote_post_id, remote_parent_id, remote_url,',
            'artifact_kind, artifact_index, published_at, identity_source, mapping_status,',
            'provider_metadata_json, last_checked_at, created_at, updated_at',
            ') VALUES (',
            '@id, @targetId, @scheduledPostId, @contentId, @productId, @connectorName, @accountRef,',
            '@remoteAccountId, @remoteAccountName, @remotePostId, @remoteParentId, @remoteUrl,',
            '@artifactKind, @artifactIndex, @publishedAt, @identitySource, @mappingStatus,',
            '@providerMetadataJson, NULL, @createdAt, @updatedAt',
            ') ON CONFLICT(connector_name, remote_account_id, remote_post_id) DO UPDATE SET',
            'target_id = excluded.target_id, scheduled_post_id = excluded.scheduled_post_id,',
            'content_id = excluded.content_id, product_id = excluded.product_id,',
            'account_ref = excluded.account_ref, remote_account_name = excluded.remote_account_name,',
            'remote_parent_id = excluded.remote_parent_id,',
            'remote_url = COALESCE(excluded.remote_url, distribution_post_artifacts.remote_url),',
            'artifact_kind = excluded.artifact_kind, mapping_status = excluded.mapping_status,',
            'provider_metadata_json = excluded.provider_metadata_json, updated_at = excluded.updated_at',
        ].join(' '));
        const tx = this.db.transaction(() => {
            input.artifacts.forEach((artifact, artifactIndex) => {
                statement.run({
                    id: (0, id_1.createId)(),
                    targetId: input.targetId,
                    scheduledPostId: input.scheduledPostId,
                    contentId: input.contentId,
                    productId: input.productId,
                    connectorName: input.connectorName,
                    accountRef: input.accountRef,
                    remoteAccountId: artifact.remoteAccountId ?? input.accountRef ?? '',
                    remoteAccountName: artifact.remoteAccountName ?? null,
                    remotePostId: artifact.remotePostId,
                    remoteParentId: artifact.remoteParentId ?? null,
                    remoteUrl: artifact.url ?? null,
                    artifactKind: artifact.kind,
                    artifactIndex,
                    publishedAt: artifact.publishedAt ?? timestamp,
                    identitySource: artifact.identitySource ?? 'publish_response',
                    mappingStatus: artifact.mappingStatus ?? 'resolved',
                    providerMetadataJson: (0, json_1.safeStringify)(artifact.providerMetadata ?? {}),
                    createdAt: timestamp,
                    updatedAt: timestamp,
                });
            });
        });
        tx();
        if (!input.artifacts.length)
            return [];
        return this.db
            .prepare('SELECT * FROM distribution_post_artifacts WHERE target_id = ? ORDER BY artifact_index ASC, created_at ASC')
            .all(input.targetId).map(mapArtifact);
    }
    listPublishedTargets(filters) {
        const filter = filterSql(filters, 'COALESCE(ph.published_at, pt.updated_at, sp.created_at)');
        const rows = this.db
            .prepare([
            'SELECT sp.id AS post_id, pt.id AS target_id, sp.product_id, sp.content_id,',
            'pt.connector_name, pt.account_ref, sp.body, sp.media_json, sp.timezone, pt.published_url,',
            'COALESCE(ph.published_at, pt.updated_at, sp.created_at) AS published_at',
            'FROM scheduled_posts sp',
            'JOIN post_targets pt ON pt.post_id = sp.id',
            'LEFT JOIN (',
            'SELECT target_id, MAX(published_at) AS published_at FROM post_publish_history GROUP BY target_id',
            ') ph ON ph.target_id = pt.id',
            "WHERE (pt.status = 'published' OR EXISTS (" +
                "SELECT 1 FROM distribution_post_artifacts pa WHERE pa.target_id = pt.id AND pa.mapping_status = 'resolved'" +
                ")) AND " + filter.where,
            'ORDER BY published_at DESC',
        ].join(' '))
            .all(...filter.args);
        return rows.map((row) => ({
            postId: row.post_id,
            targetId: row.target_id,
            productId: row.product_id,
            contentId: row.content_id,
            connectorName: row.connector_name,
            accountRef: row.account_ref,
            body: row.body,
            media: (0, json_1.safeParseJson)(row.media_json, []),
            timezone: row.timezone,
            publishedUrl: row.published_url,
            publishedAt: row.published_at,
        }));
    }
    listBackfillTargets() {
        const rows = this.db
            .prepare([
            'SELECT sp.id AS post_id, ph.target_id, sp.product_id, sp.content_id, ph.connector_name,',
            'pt.account_ref, sp.body, sp.media_json, sp.timezone, ph.published_url, ph.published_at,',
            'ph.response_json',
            'FROM post_publish_history ph',
            'JOIN scheduled_posts sp ON sp.id = ph.post_id',
            'JOIN post_targets pt ON pt.id = ph.target_id',
            'WHERE NOT EXISTS (',
            'SELECT 1 FROM distribution_post_artifacts a WHERE a.target_id = ph.target_id',
            ') ORDER BY ph.published_at DESC',
        ].join(' '))
            .all();
        return rows.map((row) => ({
            postId: row.post_id,
            targetId: row.target_id,
            productId: row.product_id,
            contentId: row.content_id,
            connectorName: row.connector_name,
            accountRef: row.account_ref,
            body: row.body,
            media: (0, json_1.safeParseJson)(row.media_json, []),
            timezone: row.timezone,
            publishedUrl: row.published_url,
            publishedAt: row.published_at,
            response: (0, json_1.safeParseJson)(row.response_json, {}),
        }));
    }
    listArtifactAnalytics(filters) {
        const filter = filterSql(filters, 'a.published_at');
        const query = [
            'SELECT a.*, sp.body, sp.media_json, sp.timezone,',
            'm.observed_at AS metric_observed_at, m.quality AS metric_quality, m.source AS metric_source,',
            'm.impressions, m.views, m.reach, m.engagements, m.reactions, m.likes, m.comments,',
            'm.shares, m.reposts, m.quotes, m.saves, m.clicks, m.link_clicks, m.video_starts,',
            'm.watch_time_seconds, m.average_watch_seconds, m.average_watch_percentage,',
            'c.observed_at AS conversation_observed_at, c.audience_top_level_count, c.total_reply_count,',
            'c.owned_reply_count, c.answered_thread_count, c.unanswered_thread_count,',
            'c.oldest_unanswered_at, c.median_first_response_seconds, c.coverage_complete',
            'FROM distribution_post_artifacts a',
            'JOIN scheduled_posts sp ON sp.id = a.scheduled_post_id',
            'JOIN post_targets pt ON pt.id = a.target_id',
            'LEFT JOIN distribution_metric_snapshots m ON m.id = (',
            'SELECT ms.id FROM distribution_metric_snapshots ms',
            'WHERE ms.artifact_id = a.id ORDER BY ms.observed_at DESC LIMIT 1',
            ')',
            'LEFT JOIN distribution_conversation_snapshots c ON c.id = (',
            'SELECT cs.id FROM distribution_conversation_snapshots cs',
            'WHERE cs.artifact_id = a.id ORDER BY cs.observed_at DESC LIMIT 1',
            ')',
            'WHERE ' + filter.where,
            'ORDER BY a.published_at DESC, a.artifact_index ASC',
        ].join(' ');
        const rows = this.db.prepare(query).all(...filter.args);
        return rows.map((row) => {
            const fixedAge = this.metricClosestToAge(row.id, row.published_at, 7 * 86_400_000, 2 * 86_400_000);
            return {
                artifact: mapArtifact(row),
                body: row.body,
                media: (0, json_1.safeParseJson)(row.media_json, []),
                timezone: row.timezone,
                metrics: row.metric_observed_at ? metricsFromRow(row) : null,
                metricObservedAt: row.metric_observed_at,
                metricQuality: row.metric_quality,
                metricSource: row.metric_source,
                fixedAgeMetrics: fixedAge?.metrics ?? null,
                fixedAgeObservedAt: fixedAge?.observedAt ?? null,
                conversation: row.conversation_observed_at
                    ? {
                        observedAt: row.conversation_observed_at,
                        audienceTopLevelCount: row.audience_top_level_count,
                        totalReplyCount: row.total_reply_count,
                        ownedReplyCount: row.owned_reply_count,
                        answeredThreadCount: row.answered_thread_count,
                        unansweredThreadCount: row.unanswered_thread_count,
                        oldestUnansweredAt: row.oldest_unanswered_at,
                        medianFirstResponseSeconds: row.median_first_response_seconds,
                        coverageComplete: row.coverage_complete === 1,
                    }
                    : null,
            };
        });
    }
    metricClosestToAge(artifactId, publishedAt, targetAge, tolerance) {
        const row = this.db
            .prepare([
            'SELECT observed_at, impressions, views, reach, engagements, reactions, likes, comments,',
            'shares, reposts, quotes, saves, clicks, link_clicks, video_starts, watch_time_seconds,',
            'average_watch_seconds, average_watch_percentage',
            'FROM distribution_metric_snapshots',
            'WHERE artifact_id = ? AND observed_at BETWEEN ? AND ?',
            'ORDER BY ABS(observed_at - ?) ASC LIMIT 1',
        ].join(' '))
            .get(artifactId, publishedAt + targetAge - tolerance, publishedAt + targetAge + tolerance, publishedAt + targetAge);
        if (!row)
            return null;
        return {
            observedAt: row.observed_at,
            metrics: {
                impressions: row.impressions,
                views: row.views,
                reach: row.reach,
                engagements: row.engagements,
                reactions: row.reactions,
                likes: row.likes,
                comments: row.comments,
                shares: row.shares,
                reposts: row.reposts,
                quotes: row.quotes,
                saves: row.saves,
                clicks: row.clicks,
                linkClicks: row.link_clicks,
                videoStarts: row.video_starts,
                watchTimeSeconds: row.watch_time_seconds,
                averageWatchSeconds: row.average_watch_seconds,
                averageWatchPercentage: row.average_watch_percentage,
            },
        };
    }
    /**
     * Artifacts a target produced, in publish order. Follow-up comments anchor to the first resolved
     * one — a target can create several (Bluesky splits media into sibling posts), and an unresolved
     * artifact (TikTok's inbox flow) is not commentable yet.
     */
    artifactsForTarget(targetId) {
        return this.db
            .prepare('SELECT * FROM distribution_post_artifacts WHERE target_id = ? ORDER BY artifact_index ASC, created_at ASC')
            .all(targetId).map(mapArtifact);
    }
    markArtifactMapping(id, mappingStatus) {
        this.db
            .prepare('UPDATE distribution_post_artifacts SET mapping_status = ?, updated_at = ? WHERE id = ?')
            .run(mappingStatus, Date.now(), id);
    }
    latestMetric(artifactId) {
        const row = this.db
            .prepare([
            'SELECT id, observed_at, provider_updated_at, source, quality, impressions, views, reach, engagements, reactions,',
            'likes, comments, shares, reposts, quotes, saves, clicks, link_clicks, video_starts,',
            'watch_time_seconds, average_watch_seconds, average_watch_percentage',
            'FROM distribution_metric_snapshots WHERE artifact_id = ? ORDER BY observed_at DESC LIMIT 1',
        ].join(' '))
            .get(artifactId);
        if (!row)
            return null;
        return {
            id: row.id,
            observedAt: row.observed_at,
            providerUpdatedAt: row.provider_updated_at,
            source: row.source,
            quality: row.quality,
            impressions: row.impressions,
            views: row.views,
            reach: row.reach,
            engagements: row.engagements,
            reactions: row.reactions,
            likes: row.likes,
            comments: row.comments,
            shares: row.shares,
            reposts: row.reposts,
            quotes: row.quotes,
            saves: row.saves,
            clicks: row.clicks,
            linkClicks: row.link_clicks,
            videoStarts: row.video_starts,
            watchTimeSeconds: row.watch_time_seconds,
            averageWatchSeconds: row.average_watch_seconds,
            averageWatchPercentage: row.average_watch_percentage,
        };
    }
    saveMetricObservation(input) {
        const observedAt = input.observedAt ?? Date.now();
        const source = input.source ?? 'api';
        const quality = input.quality ?? 'native_lifetime';
        const latest = this.latestMetric(input.artifactId);
        if (latest &&
            latest.source === source &&
            latest.quality === quality &&
            latest.providerUpdatedAt === (input.providerUpdatedAt ?? null) &&
            metricValuesEqual(latest, input.metrics)) {
            this.db
                .prepare('UPDATE distribution_post_artifacts SET last_checked_at = ?, updated_at = ? WHERE id = ?')
                .run(observedAt, observedAt, input.artifactId);
            return { inserted: false, observedAt: latest.observedAt };
        }
        const id = (0, id_1.createId)();
        const extraMetrics = {
            ...(input.extraMetrics ?? {}),
            ...(latest && hasCounterDecrease(latest, input.metrics) ? { counterDiscontinuity: true } : {}),
        };
        this.db
            .prepare([
            'INSERT INTO distribution_metric_snapshots (',
            'id, artifact_id, observed_at, provider_updated_at, source, quality, impressions, views, reach,',
            'engagements, reactions, likes, comments, shares, reposts, quotes, saves, clicks, link_clicks,',
            'video_starts, watch_time_seconds, average_watch_seconds, average_watch_percentage,',
            'extra_metrics_json, definition_version',
            ') VALUES (',
            '@id, @artifactId, @observedAt, @providerUpdatedAt, @source, @quality, @impressions, @views, @reach,',
            '@engagements, @reactions, @likes, @comments, @shares, @reposts, @quotes, @saves, @clicks, @linkClicks,',
            '@videoStarts, @watchTimeSeconds, @averageWatchSeconds, @averageWatchPercentage,',
            '@extraMetricsJson, 1',
            ')',
        ].join(' '))
            .run({
            id,
            artifactId: input.artifactId,
            observedAt,
            providerUpdatedAt: input.providerUpdatedAt ?? null,
            source,
            quality,
            ...metricParams(input.metrics),
            extraMetricsJson: (0, json_1.safeStringify)(extraMetrics),
        });
        this.db
            .prepare('UPDATE distribution_post_artifacts SET last_checked_at = ?, updated_at = ? WHERE id = ?')
            .run(observedAt, observedAt, input.artifactId);
        return { inserted: true, observedAt };
    }
    saveConversationObservation(input) {
        const observedAt = input.observedAt ?? Date.now();
        const source = input.source ?? 'api';
        const latest = this.db
            .prepare([
            'SELECT audience_top_level_count, total_reply_count, owned_reply_count, answered_thread_count,',
            'unanswered_thread_count, oldest_unanswered_at, median_first_response_seconds, coverage_complete, source',
            'FROM distribution_conversation_snapshots WHERE artifact_id = ?',
            'ORDER BY observed_at DESC LIMIT 1',
        ].join(' '))
            .get(input.artifactId);
        if (latest &&
            latest.source === source &&
            latest.audience_top_level_count === input.audienceTopLevelCount &&
            latest.total_reply_count === input.totalReplyCount &&
            latest.owned_reply_count === input.ownedReplyCount &&
            latest.answered_thread_count === input.answeredThreadCount &&
            latest.unanswered_thread_count === input.unansweredThreadCount &&
            latest.oldest_unanswered_at === input.oldestUnansweredAt &&
            latest.median_first_response_seconds === input.medianFirstResponseSeconds &&
            latest.coverage_complete === (input.coverageComplete ? 1 : 0)) {
            return;
        }
        this.db
            .prepare([
            'INSERT INTO distribution_conversation_snapshots (',
            'id, artifact_id, observed_at, audience_top_level_count, total_reply_count, owned_reply_count,',
            'answered_thread_count, unanswered_thread_count, oldest_unanswered_at,',
            'median_first_response_seconds, coverage_complete, source',
            ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ].join(' '))
            .run((0, id_1.createId)(), input.artifactId, observedAt, input.audienceTopLevelCount, input.totalReplyCount, input.ownedReplyCount, input.answeredThreadCount, input.unansweredThreadCount, input.oldestUnansweredAt, input.medianFirstResponseSeconds, input.coverageComplete ? 1 : 0, source);
    }
    startSyncRun(input) {
        this.db
            .prepare([
            'INSERT INTO distribution_performance_sync_runs (',
            'id, trigger, filters_json, requested_connectors_json, status, started_at',
            ") VALUES (?, ?, ?, ?, 'running', ?)",
        ].join(' '))
            .run(input.runId, input.trigger, (0, json_1.safeStringify)(input.filters), (0, json_1.safeStringify)(input.connectorNames), Date.now());
    }
    finishSyncRun(input) {
        this.db
            .prepare([
            'UPDATE distribution_performance_sync_runs SET status = ?, artifacts_considered = ?,',
            'artifacts_succeeded = ?, artifacts_skipped = ?, artifacts_failed = ?, warnings_json = ?,',
            'error = ?, finished_at = ? WHERE id = ?',
        ].join(' '))
            .run(input.status, input.considered, input.succeeded, input.skipped, input.failed, (0, json_1.safeStringify)(input.warnings), input.error ?? null, Date.now(), input.runId);
    }
    lastMetricSyncByConnector() {
        const rows = this.db
            .prepare([
            'SELECT connector_name, MAX(last_checked_at) AS observed_at',
            'FROM distribution_post_artifacts',
            'WHERE last_checked_at IS NOT NULL GROUP BY connector_name',
        ].join(' '))
            .all();
        return new Map(rows.map((row) => [row.connector_name, row.observed_at]));
    }
}
exports.DistributionPerformanceRepository = DistributionPerformanceRepository;
exports.distributionPerformanceRepository = new DistributionPerformanceRepository();
//# sourceMappingURL=repository.js.map