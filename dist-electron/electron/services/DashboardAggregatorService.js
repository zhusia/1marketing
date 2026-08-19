"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dashboardAggregatorService = exports.DashboardAggregatorService = void 0;
const db_1 = require("../db");
const GoogleServiceAccountClient_1 = require("./google/GoogleServiceAccountClient");
const gscProperty_1 = require("./google/gscProperty");
const AIService_1 = require("./AIService");
const AppRepository_1 = require("./AppRepository");
const ConnectorService_1 = require("./ConnectorService");
const SeoDataService_1 = require("./seo/SeoDataService");
const domain_1 = require("../utils/domain");
/**
 * Domain rating moves at most once per day, so we only re-fetch when the newest cached
 * snapshot is older than this. Until then the dashboard reads the stored value (zero API cost).
 */
const RANK_REFRESH_TTL_MS = 20 * 60 * 60 * 1000;
const DOMAIN_RATING_SOURCE = 'ahrefs';
/** Settings row holding the per-site GSC/GA4 cache, keyed `productId -> rangeKey -> entry`. */
const DASHBOARD_SITE_CACHE_KEY = 'dashboard.siteCache';
const PRESET_RANGE_DAYS = [1, 7, 30, 90];
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function readString(record, key) {
    const value = record?.[key];
    return typeof value === 'string' ? value.trim() : '';
}
function isIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}
function toIsoDate(date) {
    return date.toISOString().slice(0, 10);
}
function stableDashboardDateRange(days) {
    const end = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - Math.max(1, days - 1) * 86_400_000);
    return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
}
function normalizeTrendDate(value) {
    const raw = value.trim();
    if (/^\d{8}$/.test(raw)) {
        return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        return raw.slice(0, 10);
    }
    return raw;
}
function dateDaysBefore(date, daysBefore) {
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(time))
        return date;
    return toIsoDate(new Date(time - Math.max(0, daysBefore) * 86_400_000));
}
function trailingWindowRows(rows, endDate, days) {
    const normalized = rows
        .map((row) => ({ ...row, date: normalizeTrendDate(row.date) }))
        .filter((row) => isIsoDate(row.date))
        .sort((a, b) => a.date.localeCompare(b.date));
    if (normalized.length === 0)
        return [];
    const end = isIsoDate(endDate) ? endDate : normalized[normalized.length - 1].date;
    const start = dateDaysBefore(end, Math.max(1, days) - 1);
    return normalized.filter((row) => row.date >= start && row.date <= end);
}
function presetRangesCoveredBy(rangeKey, rangeDays) {
    if (rangeKey.startsWith('custom:'))
        return [{ rangeKey, rangeDays }];
    const covered = PRESET_RANGE_DAYS.filter((days) => days <= rangeDays);
    if (!covered.includes(rangeDays))
        covered.push(rangeDays);
    return covered
        .sort((a, b) => b - a)
        .map((days) => ({ rangeKey: String(days), rangeDays: days }));
}
function broaderPresetRangeKeys(rangeKey, rangeDays) {
    if (rangeKey.startsWith('custom:'))
        return [];
    return PRESET_RANGE_DAYS.filter((days) => days > rangeDays)
        .sort((a, b) => a - b)
        .map(String);
}
/**
 * Mirror the renderer's range key while pinning preset syncs to one stable calendar window.
 * GSC usually lags GA4, so the unified dashboard asks both APIs for the GSC-stable window
 * instead of merging two different date ranges into one chart.
 */
function resolveRange(range) {
    const startDate = typeof range?.startDate === 'string' ? range.startDate : '';
    const endDate = typeof range?.endDate === 'string' ? range.endDate : '';
    if (range?.kind === 'custom' && isIsoDate(startDate) && isIsoDate(endDate) && startDate <= endDate) {
        const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
        const rangeKey = `custom:${startDate}:${endDate}`;
        return { input: { days, rangeKey, startDate, endDate }, rangeKey, rangeDays: days };
    }
    const raw = typeof range?.days === 'number' ? range.days : Number(range?.days);
    const days = PRESET_RANGE_DAYS.includes(raw) ? raw : 30;
    const stableRange = stableDashboardDateRange(days);
    return {
        input: {
            days,
            rangeKey: String(days),
            startDate: stableRange.startDate,
            endDate: stableRange.endDate,
        },
        rangeKey: String(days),
        rangeDays: days,
    };
}
function hostOf(url) {
    const raw = (url ?? '').trim().toLowerCase();
    if (!raw)
        return '';
    const stripped = raw.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '');
    return stripped.replace(/^www\./, '').replace(/\/.*$/, '').replace(/\/$/, '');
}
function normalizeMatchText(value) {
    return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function explainRankRefreshFailure(message) {
    return `Domain Rating refresh failed. Provider error: ${message}`;
}
function analyticsPropertyMatchText(property) {
    return normalizeMatchText([property.propertyDisplayName, property.accountDisplayName, property.property].filter(Boolean).join(' '));
}
function readGoogleAccounts(config) {
    const accounts = config.serviceAccounts;
    if (!Array.isArray(accounts))
        return [];
    return accounts
        .map((item) => {
        if (!isRecord(item))
            return null;
        const id = readString(item, 'id');
        if (!id)
            return null;
        return {
            id,
            searchConsoleSites: Array.isArray(item.searchConsoleSites)
                ? item.searchConsoleSites
                : undefined,
            analyticsProperties: Array.isArray(item.analyticsProperties)
                ? item.analyticsProperties
                : undefined,
        };
    })
        .filter(Boolean);
}
function defaultGoogleAccountId(config, explicitAccountId) {
    if (explicitAccountId)
        return explicitAccountId;
    const configuredDefault = readString(config, 'defaultServiceAccountId');
    if (configuredDefault)
        return configuredDefault;
    return readGoogleAccounts(config)[0]?.id ?? '';
}
function searchConsoleSitesForAccount(config, accountId) {
    const account = readGoogleAccounts(config).find((item) => item.id === accountId);
    if (account?.searchConsoleSites?.length)
        return account.searchConsoleSites;
    return Array.isArray(config.searchConsoleSites) ? config.searchConsoleSites : [];
}
function analyticsPropertiesForAccount(config, accountId) {
    const account = readGoogleAccounts(config).find((item) => item.id === accountId);
    if (account?.analyticsProperties?.length)
        return account.analyticsProperties;
    return Array.isArray(config.analyticsProperties) ? config.analyticsProperties : [];
}
function inferSearchConsoleSiteForProduct(product, sites) {
    const host = (0, gscProperty_1.hostKeyFromUrl)(product.url);
    if (!host)
        return null;
    return sites.find((site) => (0, gscProperty_1.parseGscSiteUrl)(site.siteUrl ?? '')?.host === host) ?? null;
}
function inferAnalyticsPropertyForProduct(product, properties) {
    const host = (0, gscProperty_1.hostKeyFromUrl)(product.url);
    const hostText = normalizeMatchText(host);
    const rootText = normalizeMatchText(host.split('.')[0] ?? '');
    const nameText = normalizeMatchText(product.name);
    let best = null;
    for (const property of properties) {
        const text = analyticsPropertyMatchText(property);
        let score = 0;
        if (hostText && text.includes(hostText))
            score = Math.max(score, 100);
        if (nameText.length >= 3 && text.includes(nameText))
            score = Math.max(score, 80);
        if (rootText.length >= 3 && text.includes(rootText))
            score = Math.max(score, 60);
        if (score > 0 && (!best || score > best.score)) {
            best = { property, score };
        }
    }
    return best?.property ?? null;
}
function resolveProjectMapping(product, mapping, config) {
    const accountId = defaultGoogleAccountId(config, mapping?.serviceAccountId ?? '');
    const inferredSite = mapping?.propertyUrl
        ? null
        : inferSearchConsoleSiteForProduct(product, searchConsoleSitesForAccount(config, accountId));
    const inferredProperty = mapping?.ga4Property
        ? null
        : inferAnalyticsPropertyForProduct(product, analyticsPropertiesForAccount(config, accountId));
    const propertyUrl = mapping?.propertyUrl || inferredSite?.siteUrl?.trim() || '';
    const ga4Property = mapping?.ga4Property || (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(inferredProperty?.property ?? '');
    if (!propertyUrl && !ga4Property)
        return null;
    return {
        productId: product.id,
        serviceAccountId: mapping?.serviceAccountId || accountId,
        propertyUrl,
        ga4Property,
    };
}
function sourceMatches(record, sourceKey, expected) {
    if (!expected)
        return false;
    const actual = readString(record, sourceKey);
    if (!actual)
        return false;
    if (sourceKey === 'property') {
        return (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(actual) === (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(expected);
    }
    return actual === expected;
}
function readCachedReport(config, rangeCacheKey, latestKey, rangeKey, sourceKey, sourceValue) {
    if (!sourceValue)
        return null;
    const cache = config[rangeCacheKey];
    const byRange = isRecord(cache) ? cache[rangeKey] : null;
    if (isRecord(byRange)) {
        const direct = byRange[sourceValue];
        if (isRecord(direct) && sourceMatches(direct, sourceKey, sourceValue))
            return direct;
        for (const candidate of Object.values(byRange)) {
            if (isRecord(candidate) && sourceMatches(candidate, sourceKey, sourceValue)) {
                return candidate;
            }
        }
        if (sourceMatches(byRange, sourceKey, sourceValue))
            return byRange;
    }
    const latest = config[latestKey];
    if (isRecord(latest) && readString(latest, 'rangeKey') === rangeKey && sourceMatches(latest, sourceKey, sourceValue)) {
        return latest;
    }
    return null;
}
function readCachedReportForRange(config, rangeCacheKey, latestKey, rangeKey, rangeDays, sourceKey, sourceValue) {
    const exact = readCachedReport(config, rangeCacheKey, latestKey, rangeKey, sourceKey, sourceValue);
    if (exact)
        return { report: exact };
    for (const broaderKey of broaderPresetRangeKeys(rangeKey, rangeDays)) {
        const broader = readCachedReport(config, rangeCacheKey, latestKey, broaderKey, sourceKey, sourceValue);
        if (broader)
            return { report: broader, targetDays: rangeDays };
    }
    return null;
}
function isSearchReport(value) {
    return isRecord(value) && isRecord(value.summary) && Array.isArray(value.daily);
}
function isAnalyticsReport(value) {
    return isRecord(value) && isRecord(value.summary) && Array.isArray(value.daily);
}
function hasValidSearchSource(entry, mapping) {
    return Boolean(entry.search && mapping?.propertyUrl && entry.propertyUrl === mapping.propertyUrl);
}
function hasValidAnalyticsSource(entry, mapping) {
    return Boolean(entry.analytics &&
        mapping?.ga4Property &&
        (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(entry.ga4Property) === (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(mapping.ga4Property));
}
function hasMatchingEntrySource(entry, mapping) {
    return Boolean((mapping.propertyUrl && entry.propertyUrl === mapping.propertyUrl) ||
        (mapping.ga4Property &&
            (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(entry.ga4Property) === (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(mapping.ga4Property)));
}
function mergeCacheEntries(siteEntry, connectorEntry, mapping) {
    if (!mapping)
        return null;
    const siteSearch = siteEntry && hasValidSearchSource(siteEntry, mapping) ? siteEntry.search : null;
    const siteAnalytics = siteEntry && hasValidAnalyticsSource(siteEntry, mapping) ? siteEntry.analytics : null;
    const search = siteSearch ?? connectorEntry?.search ?? null;
    const analytics = siteAnalytics ?? connectorEntry?.analytics ?? null;
    if (!search && !analytics) {
        if (siteEntry?.errors.length && hasMatchingEntrySource(siteEntry, mapping)) {
            return {
                ...siteEntry,
                propertyUrl: mapping.propertyUrl,
                ga4Property: mapping.ga4Property,
                search: null,
                analytics: null,
            };
        }
        return null;
    }
    return {
        syncedAt: Math.max(siteSearch || siteAnalytics ? siteEntry?.syncedAt ?? 0 : 0, connectorEntry && (connectorEntry.search || connectorEntry.analytics) ? connectorEntry.syncedAt : 0),
        propertyUrl: mapping.propertyUrl,
        ga4Property: mapping.ga4Property,
        search,
        analytics,
        errors: siteEntry?.errors ?? connectorEntry?.errors ?? [],
    };
}
function compactSearch(report, targetDays) {
    if (!report)
        return null;
    const isDerived = typeof targetDays === 'number' && targetDays < report.rangeDays;
    const rows = isDerived ? trailingWindowRows(report.daily ?? [], report.endDate, targetDays) : report.daily ?? [];
    const daily = rows.map((row) => ({
        date: normalizeTrendDate(row.date),
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
    }));
    if (isDerived) {
        const clicks = daily.reduce((sum, row) => sum + row.clicks, 0);
        const impressions = daily.reduce((sum, row) => sum + row.impressions, 0);
        const positionWeight = daily.reduce((sum, row) => sum + (row.position != null ? row.position * row.impressions : 0), 0);
        const weightedImpressions = daily.reduce((sum, row) => sum + (row.position != null ? row.impressions : 0), 0);
        return {
            clicks,
            impressions,
            ctr: impressions > 0 ? clicks / impressions : 0,
            position: weightedImpressions > 0 ? positionWeight / weightedImpressions : report.summary.position,
            daily,
        };
    }
    return {
        clicks: report.summary.clicks,
        impressions: report.summary.impressions,
        ctr: report.summary.ctr,
        position: report.summary.position,
        daily,
    };
}
function compactAnalytics(report, targetDays) {
    if (!report)
        return null;
    const isDerived = typeof targetDays === 'number' && targetDays < report.rangeDays;
    const rows = isDerived ? trailingWindowRows(report.daily ?? [], report.endDate, targetDays) : report.daily ?? [];
    const daily = rows.map((row) => ({
        date: normalizeTrendDate(row.date),
        users: row.activeUsers ?? 0,
        sessions: row.sessions ?? 0,
    }));
    if (isDerived) {
        return {
            users: daily.reduce((sum, row) => sum + row.users, 0),
            sessions: daily.reduce((sum, row) => sum + row.sessions, 0),
            engagementSeconds: report.summary.averageEngagementSeconds,
            daily,
        };
    }
    return {
        users: report.summary.activeUsers,
        sessions: report.summary.sessions,
        engagementSeconds: report.summary.averageEngagementSeconds,
        daily,
    };
}
function deriveCachedSearch(search, targetDays) {
    if (!search)
        return null;
    const rows = trailingWindowRows(search.daily ?? [], '', targetDays);
    if (rows.length === 0)
        return search;
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const positionWeight = rows.reduce((sum, row) => sum + (row.position != null ? row.position * row.impressions : 0), 0);
    const weightedImpressions = rows.reduce((sum, row) => sum + (row.position != null ? row.impressions : 0), 0);
    return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: weightedImpressions > 0 ? positionWeight / weightedImpressions : search.position,
        daily: rows,
    };
}
function deriveCachedAnalytics(analytics, targetDays) {
    if (!analytics)
        return null;
    const rows = trailingWindowRows(analytics.daily ?? [], '', targetDays);
    if (rows.length === 0)
        return analytics;
    return {
        users: rows.reduce((sum, row) => sum + row.users, 0),
        sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
        engagementSeconds: analytics.engagementSeconds,
        daily: rows,
    };
}
function deriveSiteCacheEntry(entry, targetDays) {
    return {
        ...entry,
        search: deriveCachedSearch(entry.search, targetDays),
        analytics: deriveCachedAnalytics(entry.analytics, targetDays),
    };
}
function siteCacheEntryForRange(byRange, rangeKey, rangeDays, mapping) {
    if (!byRange)
        return null;
    const exact = byRange[rangeKey] ?? null;
    if (exact)
        return exact;
    for (const broaderKey of broaderPresetRangeKeys(rangeKey, rangeDays)) {
        const broader = byRange[broaderKey];
        if (!broader)
            continue;
        if (mapping && !hasMatchingEntrySource(broader, mapping))
            continue;
        return deriveSiteCacheEntry(broader, rangeDays);
    }
    return null;
}
/** Merge a single site's GSC + GA4 daily slices into one oldest-first series for the card sparkline. */
function buildRowSpark(entry) {
    if (!entry)
        return [];
    const byDate = new Map();
    const pointFor = (rawDate) => {
        const date = normalizeTrendDate(rawDate);
        if (!date)
            return null;
        const existing = byDate.get(date);
        if (existing)
            return existing;
        const created = { date, clicks: 0, impressions: 0, users: 0, sessions: 0 };
        byDate.set(date, created);
        return created;
    };
    for (const day of entry.search?.daily ?? []) {
        const point = pointFor(day.date);
        if (!point)
            continue;
        point.clicks += day.clicks;
        point.impressions += day.impressions;
    }
    for (const day of entry.analytics?.daily ?? []) {
        const point = pointFor(day.date);
        if (!point)
            continue;
        point.users += day.users;
        point.sessions += day.sessions;
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}
function promptNum(value) {
    return value == null ? 'n/a' : Math.round(value).toString();
}
function promptPct(value) {
    return value == null ? 'n/a' : `${(value * 100).toFixed(2)}%`;
}
function promptDec(value) {
    return value == null ? 'n/a' : value.toFixed(1);
}
function rangeLabel(rangeKey, rangeDays) {
    return rangeKey.startsWith('custom:')
        ? rangeKey.slice('custom:'.length).replace(':', ' to ')
        : `last ${rangeDays} day${rangeDays === 1 ? '' : 's'}`;
}
/** Flatten the aggregated dashboard into a compact, token-bounded text block for the analyst prompt. */
function serializeDashboard(dashboard) {
    const { totals } = dashboard;
    const lines = [];
    lines.push(`Window: ${rangeLabel(dashboard.rangeKey, dashboard.rangeDays)}.`);
    lines.push(`Sites: ${totals.sites} total, ${totals.syncedSites} with Search Console / Analytics data synced.`);
    lines.push('');
    lines.push('WORKSPACE TOTALS:');
    lines.push(`- Clicks: ${promptNum(totals.clicks)}`);
    lines.push(`- Impressions: ${promptNum(totals.impressions)}`);
    lines.push(`- Avg CTR: ${promptPct(totals.ctr)}`);
    lines.push(`- Avg position (impression-weighted, lower is better): ${promptDec(totals.position)}`);
    lines.push(`- Users: ${promptNum(totals.users)}`);
    lines.push(`- Sessions: ${promptNum(totals.sessions)}`);
    lines.push(`- Unacknowledged rank alerts: ${promptNum(totals.rankAlerts)}`);
    lines.push('');
    lines.push('PER-SITE (tab-separated: site, host, clicks, impressions, ctr, avg_position, users, sessions, domain_rating, backlinks, rank_alerts, data_state):');
    for (const row of dashboard.rows.slice(0, 60)) {
        lines.push([
            row.name,
            row.host || 'n/a',
            promptNum(row.clicks),
            promptNum(row.impressions),
            promptPct(row.ctr),
            promptDec(row.position),
            promptNum(row.users),
            promptNum(row.sessions),
            promptNum(row.domainRating),
            promptNum(row.backlinks),
            String(row.rankAlerts),
            row.dataState,
        ].join('\t'));
    }
    if (dashboard.rows.length > 60) {
        lines.push(`(+${dashboard.rows.length - 60} more sites not shown)`);
    }
    if (dashboard.attention.length > 0) {
        lines.push('');
        lines.push('ATTENTION SIGNALS:');
        for (const item of dashboard.attention.slice(0, 30)) {
            lines.push(`- [${item.severity}] ${item.productName}: ${item.message}`);
        }
    }
    if (dashboard.trend.length > 0) {
        lines.push('');
        lines.push('AGGREGATE DAILY TREND (date, clicks, impressions, users, sessions), oldest first:');
        for (const point of dashboard.trend.slice(-30)) {
            lines.push(`${point.date}\t${point.clicks}\t${point.impressions}\t${point.users}\t${point.sessions}`);
        }
    }
    return lines.join('\n');
}
class DashboardAggregatorService {
    readCache() {
        const value = AppRepository_1.repository.getSetting(DASHBOARD_SITE_CACHE_KEY)?.value;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value;
        }
        return {};
    }
    writeCache(cache) {
        AppRepository_1.repository.setSetting(DASHBOARD_SITE_CACHE_KEY, cache);
    }
    workspaceProducts(workspaceId) {
        const target = workspaceId || db_1.DEFAULT_WORKSPACE_ID;
        return AppRepository_1.repository
            .listProducts(false)
            .filter((product) => (product.workspaceId || db_1.DEFAULT_WORKSPACE_ID) === target);
    }
    resolvedMappingsByProduct(products, googleConnector) {
        const explicitMappings = this.mappingsByProduct();
        const config = googleConnector?.config ?? {};
        const map = new Map();
        for (const product of products) {
            const mapping = resolveProjectMapping(product, explicitMappings.get(product.id) ?? null, config);
            if (mapping)
                map.set(product.id, mapping);
        }
        return map;
    }
    connectorCacheEntry(googleConnector, rangeKey, rangeDays, mapping) {
        if (!googleConnector || !mapping)
            return null;
        const cachedSearch = readCachedReportForRange(googleConnector.config, 'searchPerformanceReportsByRange', 'searchPerformanceReport', rangeKey, rangeDays, 'siteUrl', mapping.propertyUrl);
        const cachedAnalytics = readCachedReportForRange(googleConnector.config, 'analyticsReportsByRange', 'analyticsReport', rangeKey, rangeDays, 'property', (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(mapping.ga4Property));
        const searchReport = cachedSearch && isSearchReport(cachedSearch.report) ? cachedSearch.report : null;
        const analyticsReport = cachedAnalytics && isAnalyticsReport(cachedAnalytics.report) ? cachedAnalytics.report : null;
        const search = compactSearch(searchReport, cachedSearch?.targetDays);
        const analytics = compactAnalytics(analyticsReport, cachedAnalytics?.targetDays);
        if (!search && !analytics)
            return null;
        return {
            syncedAt: googleConnector.updatedAt,
            propertyUrl: mapping.propertyUrl,
            ga4Property: (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(mapping.ga4Property),
            search,
            analytics,
            errors: [],
        };
    }
    dashboardRangeLabel(range) {
        if (range.startDate && range.endDate)
            return `${range.startDate} to ${range.endDate}`;
        return `${range.days}d`;
    }
    dashboardSyncDetail(productName, entry) {
        const parts = [];
        if (entry.search) {
            parts.push(`GSC ${entry.search.clicks.toLocaleString()} click(s), ` +
                `${entry.search.impressions.toLocaleString()} impression(s)`);
        }
        if (entry.analytics) {
            parts.push(`GA4 ${entry.analytics.users.toLocaleString()} user(s), ` +
                `${entry.analytics.sessions.toLocaleString()} session(s)`);
        }
        return `${productName}: ${parts.join('; ') || 'No Google data returned'}`;
    }
    recordDashboardGoogleSyncLog(input) {
        try {
            const failed = input.total === 0
                ? ['No Search Console / GA4 properties are mapped for this workspace.']
                : input.failed;
            const errors = input.total === 0 ? failed : input.errors;
            const status = failed.length > 0 ? (input.succeeded.length > 0 ? 'partial' : 'error') : 'success';
            const rangeLabel = this.dashboardRangeLabel(input.range);
            const summary = input.total === 0
                ? 'No mapped Google properties found for workspace dashboard sync.'
                : `Workspace dashboard sync ${status}: ` +
                    `${input.succeeded.length}/${input.total} site(s) synced for ${rangeLabel}.`;
            AppRepository_1.repository.createSyncLog({
                source: 'google_search_console',
                label: 'Workspace dashboard sync',
                status,
                summary,
                itemsSucceeded: input.succeeded.length,
                itemsFailed: failed.length,
                durationMs: Date.now() - input.startedAt,
                details: {
                    succeeded: input.succeeded,
                    failed,
                    errors,
                },
            });
        }
        catch {
            // Logging must not break dashboard sync.
        }
    }
    /** Read-only assembly: rank/DR/alerts are always live; GSC/GA4 come from the cache. */
    getWorkspaceDashboard(request) {
        const workspaceId = request.workspaceId || db_1.DEFAULT_WORKSPACE_ID;
        const { rangeKey, rangeDays } = resolveRange(request.range);
        const products = this.workspaceProducts(workspaceId);
        const googleConnector = AppRepository_1.repository.getConnector('google_search_console');
        const cache = this.readCache();
        const mappings = this.resolvedMappingsByProduct(products, googleConnector);
        const alerts = this.alertCountsByProduct();
        return this.assemble({ workspaceId, rangeKey, rangeDays, products, cache, mappings, alerts, googleConnector });
    }
    /**
     * Force a domain rating refresh for the workspace, bypassing the daily freshness gate,
     * then re-assemble from the (unchanged) GSC/GA4 cache. Used by the manual "Refresh ranks" action
     * for a same-day re-check; the regular "Sync all sites" path refreshes ratings too but only when stale.
     */
    async refreshWorkspaceRanks(request, onProgress) {
        const workspaceId = request.workspaceId || db_1.DEFAULT_WORKSPACE_ID;
        const { rangeKey, rangeDays } = resolveRange(request.range);
        const products = this.workspaceProducts(workspaceId);
        // refreshDomainRanks drives its own 'rank' progress; emit a final 'done' so listeners clear.
        await this.refreshDomainRanks(products, onProgress, { force: true });
        onProgress?.({ phase: 'done', done: 0, total: 0, productId: null, productName: '', status: 'done' });
        const googleConnector = AppRepository_1.repository.getConnector('google_search_console');
        // Re-read so freshly persisted domain rating rows are attached to the assembled rows.
        const refreshed = this.workspaceProducts(workspaceId);
        return this.assemble({
            workspaceId,
            rangeKey,
            rangeDays,
            products: refreshed,
            cache: this.readCache(),
            mappings: this.resolvedMappingsByProduct(refreshed, googleConnector),
            alerts: this.alertCountsByProduct(),
            googleConnector,
        });
    }
    /** Fetch each mapped site's GSC/GA4 report for the range, persist to cache, then assemble. */
    async syncWorkspaceDashboard(request, onProgress) {
        const workspaceId = request.workspaceId || db_1.DEFAULT_WORKSPACE_ID;
        const { input, rangeKey, rangeDays } = resolveRange(request.range);
        const products = this.workspaceProducts(workspaceId);
        const googleConnector = AppRepository_1.repository.getConnector('google_search_console');
        const mappings = this.resolvedMappingsByProduct(products, googleConnector);
        const mappedProducts = products.filter((product) => {
            const mapping = mappings.get(product.id);
            return Boolean(mapping && (mapping.propertyUrl || mapping.ga4Property));
        });
        const cache = this.readCache();
        const total = mappedProducts.length;
        const log = {
            startedAt: Date.now(),
            succeeded: [],
            failed: [],
            errors: [],
        };
        onProgress?.({ phase: 'start', done: 0, total, productId: null, productName: '', status: 'queued' });
        let done = 0;
        for (const product of mappedProducts) {
            onProgress?.({ phase: 'site', done, total, productId: product.id, productName: product.name, status: 'fetching' });
            try {
                const result = await ConnectorService_1.connectorService.fetchSitePerformance({ productId: product.id, range: input });
                const syncedAt = Date.now();
                const byRange = cache[product.id] ?? {};
                for (const coveredRange of presetRangesCoveredBy(rangeKey, rangeDays)) {
                    byRange[coveredRange.rangeKey] = {
                        syncedAt,
                        propertyUrl: result.propertyUrl,
                        ga4Property: result.ga4Property,
                        search: compactSearch(result.search, coveredRange.rangeDays),
                        analytics: compactAnalytics(result.analytics, coveredRange.rangeDays),
                        errors: result.errors,
                    };
                }
                cache[product.id] = byRange;
                this.writeCache(cache);
                ConnectorService_1.connectorService.persistGooglePerformanceReports({
                    productId: product.id,
                    serviceAccountId: mappings.get(product.id)?.serviceAccountId,
                    propertyUrl: result.propertyUrl,
                    ga4Property: result.ga4Property,
                    range: input,
                    search: result.search,
                    analytics: result.analytics,
                    errors: result.errors,
                });
                const entry = byRange[rangeKey] ?? {
                    syncedAt,
                    propertyUrl: result.propertyUrl,
                    ga4Property: result.ga4Property,
                    search: compactSearch(result.search),
                    analytics: compactAnalytics(result.analytics),
                    errors: result.errors,
                };
                const hasData = Boolean(entry.search || entry.analytics);
                const failed = entry.errors.length > 0 && !hasData;
                if (hasData) {
                    log.succeeded.push(this.dashboardSyncDetail(product.name, entry));
                }
                if (entry.errors.length > 0) {
                    const messages = entry.errors.map((message) => `${product.name}: ${message}`);
                    log.failed.push(...messages);
                    log.errors.push(...messages);
                }
                done += 1;
                onProgress?.({
                    phase: 'site',
                    done,
                    total,
                    productId: product.id,
                    productName: product.name,
                    status: failed ? 'failed' : 'done',
                    message: failed ? entry.errors[0] : undefined,
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Sync failed.';
                const mapping = mappings.get(product.id);
                const byRange = cache[product.id] ?? {};
                byRange[rangeKey] = {
                    syncedAt: Date.now(),
                    propertyUrl: mapping?.propertyUrl ?? '',
                    ga4Property: mapping?.ga4Property ?? '',
                    search: null,
                    analytics: null,
                    errors: [message],
                };
                cache[product.id] = byRange;
                this.writeCache(cache);
                log.failed.push(`${product.name}: ${message}`);
                log.errors.push(`${product.name}: ${message}`);
                done += 1;
                onProgress?.({ phase: 'site', done, total, productId: product.id, productName: product.name, status: 'failed', message });
            }
        }
        this.writeCache(cache);
        this.recordDashboardGoogleSyncLog({ range: input, total, ...log });
        // One Ahrefs Domain Rating refresh for the whole workspace (gated to once/day), independent of GSC/GA4.
        await this.refreshDomainRanks(products, onProgress);
        onProgress?.({ phase: 'done', done, total, productId: null, productName: '', status: 'done' });
        return this.assemble({
            workspaceId,
            rangeKey,
            rangeDays,
            // Re-read so freshly persisted domain rating rows are attached to the assembled rows.
            products: this.workspaceProducts(workspaceId),
            cache,
            mappings,
            alerts: this.alertCountsByProduct(),
            googleConnector,
        });
    }
    /**
     * Refresh Domain Rating for the workspace via Ahrefs' public free endpoint.
     *
     * Ahrefs' free endpoint is single-target, so we dedupe domains and use a per-domain freshness gate
     * to skip anything checked within {@link RANK_REFRESH_TTL_MS}. Repeated syncs the same day therefore
     * cost zero API calls. Results land in the `domain_authority` table (source `ahrefs`) so they flow
     * back through `product.latestDomain*` on the next product read.
     *
     * Non-fatal by design for regular dashboard sync: any API failure is surfaced as a `rank`/`failed`
     * progress event without blocking the GSC/GA4 sync or the assemble. Forced/manual refreshes rethrow
     * so the renderer can show a troubleshooting modal.
     */
    async refreshDomainRanks(products, onProgress, opts = {}) {
        const cutoff = opts.force ? Infinity : Date.now() - RANK_REFRESH_TTL_MS;
        const targets = [];
        for (const product of products) {
            const domain = (0, domain_1.extractDomain)(product.url);
            if (!domain)
                continue;
            const latest = AppRepository_1.repository.getLatestDomainAuthority(product.id, domain, DOMAIN_RATING_SOURCE);
            if (latest && latest.checkedAt >= cutoff)
                continue;
            targets.push({ productId: product.id, domain });
        }
        if (targets.length === 0)
            return;
        onProgress?.({ phase: 'rank', done: 0, total: targets.length, productId: null, productName: '', status: 'fetching' });
        try {
            const domains = Array.from(new Set(targets.map((target) => target.domain)));
            const metricsByDomain = new Map((await SeoDataService_1.seoDataService.bulkDomainAuthority(domains)).map((result) => [result.domain, result]));
            for (const target of targets) {
                const metrics = metricsByDomain.get(target.domain);
                if (!metrics)
                    continue;
                const previous = AppRepository_1.repository.getLatestDomainAuthority(target.productId, target.domain);
                AppRepository_1.repository.createDomainAuthority({
                    productId: target.productId,
                    domain: target.domain,
                    domainRating: metrics.domainRating,
                    urlRating: previous?.urlRating ?? 0,
                    backlinks: previous?.backlinks ?? metrics.backlinks,
                    linkingWebsites: previous?.linkingWebsites ?? metrics.linkingWebsites,
                    source: metrics.source,
                });
            }
            onProgress?.({ phase: 'rank', done: targets.length, total: targets.length, productId: null, productName: '', status: 'done' });
        }
        catch (error) {
            const rawMessage = error instanceof Error ? error.message : 'Domain Rating refresh failed.';
            const message = explainRankRefreshFailure(rawMessage);
            onProgress?.({ phase: 'rank', done: 0, total: targets.length, productId: null, productName: '', status: 'failed', message });
            if (opts.force) {
                throw new Error(message);
            }
        }
    }
    /**
     * Answer a natural-language question grounded in the workspace's aggregated dashboard, using the
     * local AI CLI (same path as keyword clustering / SEO audit). The dataset is re-aggregated here
     * so the model always reasons over canonical numbers, not whatever the renderer last held.
     */
    async askWorkspaceDashboard(input, hooks) {
        const question = (input.question ?? '').trim();
        if (!question)
            throw new Error('Type a question about your sites first.');
        const dashboard = this.getWorkspaceDashboard({ workspaceId: input.workspaceId, range: input.range });
        if (dashboard.rows.length === 0) {
            throw new Error('There are no sites in this workspace to analyze yet.');
        }
        hooks?.onLog?.('Reading your workspace performance data...');
        const dataset = serializeDashboard(dashboard);
        const prompt = [
            'You are a senior marketing and SEO business-intelligence analyst embedded in a desktop app.',
            "Answer the user's question using ONLY the workspace data block below.",
            'Rules:',
            '- Lead with the direct answer in one sentence, then up to 3 short supporting bullets.',
            '- Reference sites by their exact name as written in the data.',
            '- Use only the numbers present; never invent sites, metrics, or dates.',
            '- CTR is a percentage; avg_position is a Google rank where lower is better.',
            '- data_state shows whether a site has synced data: "ok" has data, "unsynced"/"unmapped" do not, "error" failed to sync.',
            '- If the data cannot answer the question (e.g. it asks about a time comparison or metric not present), say so plainly and suggest what to sync or connect.',
            '- Reply in short GitHub-flavored markdown. Do not echo the raw data block.',
            '',
            '=== WORKSPACE DATA ===',
            dataset,
            '=== END DATA ===',
            '',
            `Question: ${question}`,
        ].join('\n');
        const { content, provider } = await AIService_1.aiService.complete(prompt, {
            conversationId: `dashboard-ask:${input.workspaceId}`,
            agentId: input.agentId ?? null,
            cwd: null,
            onLog: hooks?.onLog,
            onToken: hooks?.onToken,
        });
        const answer = content.trim();
        if (!answer) {
            throw new Error('The AI did not return an answer. Try again or switch CLI agent.');
        }
        return { answer, provider };
    }
    mappingsByProduct() {
        const map = new Map();
        for (const mapping of ConnectorService_1.connectorService.listProjectMappings()) {
            map.set(mapping.productId, mapping);
        }
        return map;
    }
    alertCountsByProduct() {
        const counts = new Map();
        for (const alert of AppRepository_1.repository.listRankAlerts(undefined, false)) {
            counts.set(alert.productId, (counts.get(alert.productId) ?? 0) + 1);
        }
        return counts;
    }
    assemble(params) {
        const { workspaceId, rangeKey, rangeDays, products, cache, mappings, alerts, googleConnector } = params;
        const rows = [];
        const trendByDate = new Map();
        const attention = [];
        let syncedAt = null;
        let unmappedCount = 0;
        for (const product of products) {
            const mapping = mappings.get(product.id) ?? null;
            const mapped = Boolean(mapping && (mapping.propertyUrl || mapping.ga4Property));
            const entry = mergeCacheEntries(siteCacheEntryForRange(cache[product.id], rangeKey, rangeDays, mapping), this.connectorCacheEntry(googleConnector, rangeKey, rangeDays, mapping), mapping);
            const alertCount = alerts.get(product.id) ?? 0;
            let dataState;
            if (entry && (entry.search || entry.analytics)) {
                dataState = 'ok';
            }
            else if (entry && entry.errors.length > 0) {
                dataState = 'error';
            }
            else if (mapped) {
                dataState = 'unsynced';
            }
            else {
                dataState = 'unmapped';
            }
            if (dataState === 'unmapped')
                unmappedCount += 1;
            if (entry?.syncedAt)
                syncedAt = Math.max(syncedAt ?? 0, entry.syncedAt);
            const spark = buildRowSpark(entry);
            rows.push({
                productId: product.id,
                name: product.name,
                url: product.url,
                host: hostOf(product.url),
                workspaceId: product.workspaceId || db_1.DEFAULT_WORKSPACE_ID,
                dataState,
                propertyUrl: mapping?.propertyUrl || null,
                ga4Property: mapping?.ga4Property || null,
                syncedAt: entry?.syncedAt ?? null,
                clicks: entry?.search?.clicks ?? null,
                impressions: entry?.search?.impressions ?? null,
                ctr: entry?.search?.ctr ?? null,
                position: entry?.search?.position ?? null,
                users: entry?.analytics?.users ?? null,
                sessions: entry?.analytics?.sessions ?? null,
                engagementSeconds: entry?.analytics?.engagementSeconds ?? null,
                domainRating: product.latestDomainRating,
                domainRatingSource: product.latestDomainSource,
                backlinks: product.latestDomainBacklinks,
                domainRatingCheckedAt: product.latestDomainCheckedAt,
                rankAlerts: alertCount,
                error: entry?.errors[0] ?? null,
                spark,
            });
            for (const point of spark) {
                const agg = trendByDate.get(point.date) ?? { date: point.date, clicks: 0, impressions: 0, users: 0, sessions: 0 };
                agg.clicks += point.clicks;
                agg.impressions += point.impressions;
                agg.users += point.users;
                agg.sessions += point.sessions;
                trendByDate.set(point.date, agg);
            }
            if (alertCount > 0) {
                attention.push({
                    id: `rank-alert:${product.id}`,
                    productId: product.id,
                    productName: product.name,
                    kind: 'rank-alert',
                    severity: alertCount >= 5 ? 'high' : 'medium',
                    message: `${alertCount} unacknowledged rank alert${alertCount === 1 ? '' : 's'}`,
                });
            }
            if (dataState === 'error') {
                attention.push({
                    id: `sync-error:${product.id}`,
                    productId: product.id,
                    productName: product.name,
                    kind: 'sync-error',
                    severity: 'medium',
                    message: entry?.errors[0] ?? 'Performance sync failed.',
                });
            }
            else if (dataState === 'unmapped') {
                attention.push({
                    id: `unmapped:${product.id}`,
                    productId: product.id,
                    productName: product.name,
                    kind: 'unmapped',
                    severity: 'low',
                    message: 'No Search Console / GA4 property connected',
                });
            }
        }
        const trend = Array.from(trendByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
        const severityRank = { high: 0, medium: 1, low: 2 };
        attention.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
        return {
            workspaceId,
            rangeKey,
            rangeDays,
            generatedAt: Date.now(),
            syncedAt,
            totals: this.totals(rows),
            rows,
            trend,
            attention,
            unmappedCount,
        };
    }
    totals(rows) {
        let clicks = 0;
        let impressions = 0;
        let users = 0;
        let sessions = 0;
        let positionWeighted = 0;
        let positionWeight = 0;
        let rankAlerts = 0;
        let syncedSites = 0;
        for (const row of rows) {
            if (row.dataState === 'ok')
                syncedSites += 1;
            if (row.clicks != null)
                clicks += row.clicks;
            if (row.impressions != null)
                impressions += row.impressions;
            if (row.users != null)
                users += row.users;
            if (row.sessions != null)
                sessions += row.sessions;
            if (row.position != null && row.impressions != null && row.impressions > 0) {
                positionWeighted += row.position * row.impressions;
                positionWeight += row.impressions;
            }
            rankAlerts += row.rankAlerts;
        }
        return {
            sites: rows.length,
            syncedSites,
            clicks,
            impressions,
            ctr: impressions > 0 ? clicks / impressions : 0,
            position: positionWeight > 0 ? positionWeighted / positionWeight : 0,
            users,
            sessions,
            rankAlerts,
        };
    }
}
exports.DashboardAggregatorService = DashboardAggregatorService;
exports.dashboardAggregatorService = new DashboardAggregatorService();
//# sourceMappingURL=DashboardAggregatorService.js.map