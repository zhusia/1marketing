"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateDistributionPerformance = aggregateDistributionPerformance;
const metrics_1 = require("./metrics");
const ADDITIVE_METRIC_KEYS = [
    'impressions',
    'views',
    'reach',
    'engagements',
    'reactions',
    'likes',
    'comments',
    'shares',
    'reposts',
    'quotes',
    'saves',
    'clicks',
    'linkClicks',
    'videoStarts',
    'watchTimeSeconds',
];
function addNullable(left, right) {
    if (left == null && right == null)
        return null;
    return (left ?? 0) + (right ?? 0);
}
function addMetrics(target, source) {
    for (const key of ADDITIVE_METRIC_KEYS) {
        target[key] = addNullable(target[key], source[key]);
    }
}
function exposure(metrics) {
    return metrics?.impressions ?? metrics?.views ?? null;
}
function engagementRate(metrics) {
    const denominator = exposure(metrics);
    return denominator != null && denominator > 0 && metrics?.engagements != null
        ? metrics.engagements / denominator
        : null;
}
function rateFor(engagements, exposureValue) {
    return exposureValue != null && exposureValue > 0 && engagements != null
        ? engagements / exposureValue
        : null;
}
function performanceScore(metrics) {
    const rate = engagementRate(metrics);
    return rate == null ? null : rate * 1000;
}
function maxNullable(values) {
    const known = values.filter((value) => value != null);
    return known.length ? Math.max(...known) : null;
}
function supportState(covered, eligible) {
    if (covered === 0)
        return 'unavailable';
    if (covered < eligible)
        return 'partial';
    return 'available';
}
function isFreshObservation(item, now) {
    const checkedAt = item.artifact.lastCheckedAt ?? item.metricObservedAt;
    if (checkedAt == null)
        return false;
    const age = Math.max(0, now - item.artifact.publishedAt);
    const expectedInterval = age <= 2 * 86_400_000
        ? 2 * 60 * 60 * 1000
        : age <= 7 * 86_400_000
            ? 6 * 60 * 60 * 1000
            : age <= 30 * 86_400_000
                ? 24 * 60 * 60 * 1000
                : age <= 90 * 86_400_000
                    ? 7 * 86_400_000
                    : 30 * 86_400_000;
    return now - checkedAt <= expectedInterval * 1.25;
}
function dateParts(timestamp, timezone) {
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            weekday: 'short',
            hour: '2-digit',
            hourCycle: 'h23',
        });
        const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
        const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
        return {
            date: [parts.year, parts.month, parts.day].join('-'),
            weekday: weekday >= 0 ? weekday : 0,
            hour: Number(parts.hour) || 0,
        };
    }
    catch {
        const date = new Date(timestamp);
        return {
            date: date.toISOString().slice(0, 10),
            weekday: (date.getDay() + 6) % 7,
            hour: date.getHours(),
        };
    }
}
function compactLabel(body) {
    const first = body
        .split('\n')
        .map((line) => line.replace(/^#+\s*/, '').trim())
        .find(Boolean);
    if (!first)
        return 'Untitled post';
    return first.length > 74 ? first.slice(0, 71) + '…' : first;
}
function mediaFormat(media) {
    const hasVideo = media.some((item) => /video|mp4|mov|webm|m4v/i.test(item.type + ' ' + item.path));
    const hasImage = media.some((item) => /image|png|jpe?g|gif|webp/i.test(item.type + ' ' + item.path));
    if (hasVideo && hasImage)
        return 'mixed';
    if (hasVideo)
        return 'video';
    if (hasImage)
        return 'image';
    return 'text';
}
function median(numbers) {
    if (!numbers.length)
        return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}
function percentile(sorted, ratio) {
    if (!sorted.length)
        return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * ratio)));
    return sorted[index];
}
function buildBestTimes(artifacts, timezone) {
    const eligible = artifacts
        .map((item) => ({
        item,
        score: performanceScore(item.fixedAgeMetrics),
        parts: dateParts(item.artifact.publishedAt, timezone),
        metricAge: item.fixedAgeObservedAt == null
            ? null
            : item.fixedAgeObservedAt - item.artifact.publishedAt,
    }))
        .filter((item) => item.score != null &&
        item.metricAge != null &&
        item.metricAge >= 5 * 86_400_000 &&
        item.metricAge <= 9 * 86_400_000);
    const allScores = eligible.map((item) => item.score).sort((a, b) => a - b);
    const lower = percentile(allScores, 0.05);
    const upper = percentile(allScores, 0.95);
    const globalMean = allScores.length
        ? allScores.reduce((sum, value) => sum + Math.min(upper, Math.max(lower, value)), 0) / allScores.length
        : 0;
    const byBucket = new Map();
    for (const item of eligible) {
        const hour = Math.floor(item.parts.hour / 3) * 3;
        const key = item.parts.weekday + ':' + hour;
        const score = Math.min(upper, Math.max(lower, item.score));
        byBucket.set(key, [...(byBucket.get(key) ?? []), score]);
    }
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const enoughHistory = eligible.length >= 20;
    const buckets = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
        for (let hour = 0; hour < 24; hour += 3) {
            const samples = byBucket.get(weekday + ':' + hour) ?? [];
            const sampleSize = samples.length;
            const score = enoughHistory && sampleSize >= 3
                ? (samples.reduce((sum, value) => sum + value, 0) + globalMean * 3) / (sampleSize + 3)
                : null;
            const confidence = !enoughHistory || sampleSize < 3
                ? 'insufficient'
                : sampleSize >= 10
                    ? 'high'
                    : sampleSize >= 6
                        ? 'medium'
                        : 'low';
            buckets.push({
                weekday,
                hour,
                label: labels[weekday] + ' ' + String(hour).padStart(2, '0') + ':00',
                sampleSize,
                score,
                confidence,
            });
        }
    }
    return buckets;
}
function buildTopContent(artifacts) {
    const groups = new Map();
    for (const item of artifacts) {
        const key = item.artifact.contentId ?? item.artifact.scheduledPostId;
        const group = groups.get(key) ?? {
            contentId: item.artifact.contentId,
            label: compactLabel(item.body),
            format: mediaFormat(item.media),
            postIds: new Set(),
            artifacts: 0,
            metrics: { ...metrics_1.EMPTY_DISTRIBUTION_METRICS },
            exposure: null,
            scores: [],
        };
        group.postIds.add(item.artifact.scheduledPostId);
        group.artifacts += 1;
        if (item.metrics) {
            addMetrics(group.metrics, item.metrics);
            group.exposure = addNullable(group.exposure, exposure(item.metrics));
        }
        const score = performanceScore(item.metrics);
        if (score != null)
            group.scores.push(score);
        groups.set(key, group);
    }
    return Array.from(groups.entries())
        .map(([key, group]) => ({
        key,
        contentId: group.contentId,
        label: group.label,
        format: group.format,
        posts: group.postIds.size,
        artifacts: group.artifacts,
        exposure: group.exposure,
        engagements: group.metrics.engagements,
        engagementRate: rateFor(group.metrics.engagements, group.exposure),
        score: median(group.scores),
    }))
        .sort((left, right) => (right.score ?? -1) - (left.score ?? -1))
        .slice(0, 8);
}
function aggregateDistributionPerformance(input) {
    const { filters, targets, artifacts, capabilities } = input;
    const generatedAt = Date.now();
    const timezone = filters.timezone || 'UTC';
    const mappedArtifacts = artifacts.filter((item) => item.artifact.mappingStatus === 'resolved');
    const mappedTargetIds = new Set(mappedArtifacts.map((item) => item.artifact.targetId));
    const metricArtifacts = artifacts.filter((item) => item.metrics != null);
    const freshArtifacts = metricArtifacts.filter((item) => isFreshObservation(item, generatedAt));
    const eligibleChannels = new Set(targets.map((target) => target.connectorName));
    const reportingChannels = new Set(metricArtifacts.map((item) => item.artifact.connectorName));
    const unmappedTargets = targets.filter((target) => !mappedTargetIds.has(target.targetId));
    const warnings = [];
    if (unmappedTargets.length) {
        warnings.push(String(unmappedTargets.length) +
            ' published target' +
            (unmappedTargets.length === 1 ? '' : 's') +
            ' could not be mapped to a remote post.');
    }
    const reconnectCount = capabilities.filter((capability) => capability.state === 'reconnect_required').length;
    if (reconnectCount) {
        warnings.push(String(reconnectCount) +
            ' channel' +
            (reconnectCount === 1 ? '' : 's') +
            ' need analytics permission.');
    }
    if (metricArtifacts.length && freshArtifacts.length < metricArtifacts.length) {
        warnings.push('Some metrics are outside their expected age-based refresh cadence.');
    }
    const latestMetricAt = maxNullable(artifacts.map((item) => item.artifact.lastCheckedAt ?? item.metricObservedAt));
    const totalMetrics = { ...metrics_1.EMPTY_DISTRIBUTION_METRICS };
    for (const item of metricArtifacts)
        addMetrics(totalMetrics, item.metrics);
    const totalExposure = metricArtifacts.reduce((sum, item) => addNullable(sum, exposure(item.metrics)), null);
    const hasImpressions = metricArtifacts.some((item) => item.metrics?.impressions != null);
    const hasViews = metricArtifacts.some((item) => item.metrics?.views != null);
    const conversationRows = artifacts.filter((item) => item.conversation?.audienceTopLevelCount != null &&
        item.conversation.answeredThreadCount != null &&
        item.conversation.unansweredThreadCount != null);
    const audienceThreads = conversationRows.reduce((sum, item) => sum + (item.conversation?.audienceTopLevelCount ?? 0), 0);
    const answeredThreads = conversationRows.reduce((sum, item) => sum + (item.conversation?.answeredThreadCount ?? 0), 0);
    const unansweredThreads = conversationRows.reduce((sum, item) => sum + (item.conversation?.unansweredThreadCount ?? 0), 0);
    const conversationUpdatedAt = maxNullable(conversationRows.map((item) => item.conversation?.observedAt ?? null));
    const kpis = [
        {
            key: 'posts',
            label: 'Posts',
            value: targets.length,
            rate: null,
            delta: null,
            coveredArtifacts: targets.length,
            eligibleArtifacts: targets.length,
            updatedAt: maxNullable(targets.map((target) => target.publishedAt)),
            support: 'available',
            hint: 'Local publish records in this cohort',
        },
        {
            key: 'exposure',
            label: hasImpressions && hasViews ? 'Exposure' : hasImpressions ? 'Impressions' : 'Views',
            value: totalExposure,
            rate: null,
            delta: null,
            coveredArtifacts: metricArtifacts.filter((item) => exposure(item.metrics) != null).length,
            eligibleArtifacts: artifacts.length,
            updatedAt: latestMetricAt,
            support: supportState(metricArtifacts.filter((item) => exposure(item.metrics) != null).length, artifacts.length),
            hint: 'Impressions where available, otherwise platform views',
        },
        {
            key: 'reach',
            label: 'Reach',
            value: totalMetrics.reach,
            rate: null,
            delta: null,
            coveredArtifacts: metricArtifacts.filter((item) => item.metrics?.reach != null).length,
            eligibleArtifacts: artifacts.length,
            updatedAt: latestMetricAt,
            support: supportState(metricArtifacts.filter((item) => item.metrics?.reach != null).length, artifacts.length),
            hint: 'Unique accounts only when supplied by the platform',
        },
        {
            key: 'engagements',
            label: 'Engagements',
            value: totalMetrics.engagements,
            rate: totalMetrics.engagements != null && totalExposure != null && totalExposure > 0
                ? totalMetrics.engagements / totalExposure
                : null,
            delta: null,
            coveredArtifacts: metricArtifacts.filter((item) => item.metrics?.engagements != null).length,
            eligibleArtifacts: artifacts.length,
            updatedAt: latestMetricAt,
            support: supportState(metricArtifacts.filter((item) => item.metrics?.engagements != null).length, artifacts.length),
            hint: 'Non-overlapping native reactions, replies, shares, saves, and clicks',
        },
        {
            key: 'conversations',
            label: 'Conversations',
            value: conversationRows.length ? audienceThreads : null,
            rate: audienceThreads > 0 ? answeredThreads / audienceThreads : null,
            delta: null,
            coveredArtifacts: conversationRows.length,
            eligibleArtifacts: artifacts.length,
            updatedAt: conversationUpdatedAt,
            support: supportState(conversationRows.length, artifacts.length),
            hint: 'Audience threads; rate is the share answered by the connected account',
        },
    ];
    const trendMap = new Map();
    const countedTargetIds = new Set();
    for (const target of targets) {
        const date = dateParts(target.publishedAt, timezone).date;
        if (!countedTargetIds.has(target.targetId)) {
            countedTargetIds.add(target.targetId);
            const row = trendMap.get(date) ?? {
                date,
                posts: 0,
                exposure: null,
                ...metrics_1.EMPTY_DISTRIBUTION_METRICS,
            };
            row.posts += 1;
            trendMap.set(date, row);
        }
    }
    for (const item of artifacts) {
        if (!item.metrics)
            continue;
        const date = dateParts(item.artifact.publishedAt, timezone).date;
        const row = trendMap.get(date) ?? {
            date,
            posts: 0,
            exposure: null,
            ...metrics_1.EMPTY_DISTRIBUTION_METRICS,
        };
        addMetrics(row, item.metrics);
        row.exposure = addNullable(row.exposure, exposure(item.metrics));
        trendMap.set(date, row);
    }
    const trend = Array.from(trendMap.values()).sort((left, right) => left.date.localeCompare(right.date));
    const capabilityMap = new Map(capabilities.map((capability) => [capability.connectorName, capability]));
    const channelNames = new Set([
        ...targets.map((target) => target.connectorName),
        ...artifacts.map((item) => item.artifact.connectorName),
    ]);
    const channels = Array.from(channelNames)
        .map((connectorName) => {
        const rows = artifacts.filter((item) => item.artifact.connectorName === connectorName);
        const channelMetrics = { ...metrics_1.EMPTY_DISTRIBUTION_METRICS };
        let channelExposure = null;
        for (const row of rows) {
            if (row.metrics) {
                addMetrics(channelMetrics, row.metrics);
                channelExposure = addNullable(channelExposure, exposure(row.metrics));
            }
        }
        const conversations = rows.filter((row) => row.conversation?.audienceTopLevelCount != null &&
            row.conversation.answeredThreadCount != null);
        const channelAudience = conversations.reduce((sum, row) => sum + (row.conversation?.audienceTopLevelCount ?? 0), 0);
        const channelAnswered = conversations.reduce((sum, row) => sum + (row.conversation?.answeredThreadCount ?? 0), 0);
        const capability = capabilityMap.get(connectorName);
        return {
            connectorName,
            label: capability?.label ?? connectorName,
            posts: new Set(targets.filter((target) => target.connectorName === connectorName).map((target) => target.targetId)).size,
            artifacts: rows.length,
            coveredArtifacts: rows.filter((row) => row.metrics != null).length,
            exposure: channelExposure,
            engagementRate: rateFor(channelMetrics.engagements, channelExposure),
            responseRate: channelAudience > 0 ? channelAnswered / channelAudience : null,
            updatedAt: maxNullable(rows.map((row) => row.artifact.lastCheckedAt ?? row.metricObservedAt)),
            capabilityState: capability?.state ?? 'unsupported',
            ...channelMetrics,
        };
    })
        .sort((left, right) => (right.engagements ?? -1) - (left.engagements ?? -1));
    const topPosts = artifacts
        .filter((item) => item.artifact.mappingStatus === 'resolved')
        .map((item) => ({
        artifactId: item.artifact.id,
        postId: item.artifact.scheduledPostId,
        contentId: item.artifact.contentId,
        productId: item.artifact.productId,
        connectorName: item.artifact.connectorName,
        body: item.body,
        media: item.media,
        remoteUrl: item.artifact.remoteUrl,
        publishedAt: item.artifact.publishedAt,
        exposure: exposure(item.metrics),
        engagementRate: engagementRate(item.metrics),
        score: performanceScore(item.metrics),
        updatedAt: item.artifact.lastCheckedAt ?? item.metricObservedAt,
        ...(item.metrics ?? metrics_1.EMPTY_DISTRIBUTION_METRICS),
    }))
        .slice(0, 100);
    const unansweredDates = conversationRows
        .map((item) => item.conversation?.oldestUnansweredAt ?? null)
        .filter((value) => value != null);
    const oldestUnansweredAt = unansweredDates.length ? Math.min(...unansweredDates) : null;
    const responseMedians = conversationRows
        .map((item) => item.conversation?.medianFirstResponseSeconds ?? null)
        .filter((value) => value != null);
    return {
        generatedAt,
        lastSyncedAt: latestMetricAt,
        lens: filters.lens ?? 'cohort',
        coverage: {
            publishedPosts: targets.length,
            artifacts: artifacts.length,
            mappedArtifacts: mappedArtifacts.length,
            metricArtifacts: metricArtifacts.length,
            freshArtifacts: freshArtifacts.length,
            eligibleChannels: eligibleChannels.size,
            reportingChannels: reportingChannels.size,
            unmappedPosts: unmappedTargets.length,
            warnings,
        },
        kpis,
        trend,
        channels,
        topPosts,
        topContent: buildTopContent(mappedArtifacts),
        bestTimes: filters.connectorName && filters.connectorName !== 'all'
            ? buildBestTimes(artifacts, timezone)
            : [],
        conversation: {
            audienceThreads: conversationRows.length ? audienceThreads : null,
            answeredThreads: conversationRows.length ? answeredThreads : null,
            unansweredThreads: conversationRows.length ? unansweredThreads : null,
            responseRate: audienceThreads > 0 ? answeredThreads / audienceThreads : null,
            medianFirstResponseSeconds: median(responseMedians),
            oldestUnansweredAt,
            coveredArtifacts: conversationRows.length,
        },
        capabilities,
    };
}
//# sourceMappingURL=aggregations.js.map