"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleServiceAccountClient = void 0;
exports.normalizeGoogleServiceAccountCredentials = normalizeGoogleServiceAccountCredentials;
exports.normalizeAnalyticsPropertyName = normalizeAnalyticsPropertyName;
exports.formatGoogleApiError = formatGoogleApiError;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEARCH_CONSOLE_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing';
const JWT_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
const INDEXING_PUBLISH_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const URL_INSPECTION_ENDPOINT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const URL_INSPECTION_DEFAULT_MAX = 30;
const URL_INSPECTION_MAX = 500;
const URL_INSPECTION_CONCURRENCY = 4;
const URL_INSPECTION_TIMEOUT_MS = 15000;
const SITEMAP_FETCH_TIMEOUT_MS = 20000;
const SITEMAP_MAX_DEPTH = 2;
const PAGE_INDEX_EXAMPLES_PER_REASON = 50;
/** Reasons Search Console attributes to "Google systems" rather than the site itself. */
const GOOGLE_SYSTEM_PAGE_INDEX_REASONS = new Set([
    'Crawled - currently not indexed',
    'Discovered - currently not indexed',
    'Duplicate, Google chose different canonical than user',
    'Indexed, though blocked by robots.txt',
]);
function isOAuthTokenSource(source) {
    return source.kind === 'oauth';
}
function normalizeGoogleServiceAccountCredentials(input) {
    const source = extractCredentialSource(input);
    if (!source || typeof source !== 'object')
        return null;
    const record = source;
    const clientEmail = typeof record.client_email === 'string' ? record.client_email.trim() : '';
    const privateKeyRaw = typeof record.private_key === 'string' ? record.private_key.trim() : '';
    const privateKey = privateKeyRaw.includes('\\n') ? privateKeyRaw.replace(/\\n/g, '\n') : privateKeyRaw;
    if (!clientEmail || !privateKey.includes('BEGIN PRIVATE KEY')) {
        return null;
    }
    return {
        type: typeof record.type === 'string' ? record.type : 'service_account',
        project_id: typeof record.project_id === 'string' ? record.project_id : undefined,
        private_key_id: typeof record.private_key_id === 'string' ? record.private_key_id : undefined,
        private_key: privateKey,
        client_email: clientEmail,
        client_id: typeof record.client_id === 'string' ? record.client_id : undefined,
        token_uri: typeof record.token_uri === 'string' ? record.token_uri : TOKEN_URL,
    };
}
function normalizeAnalyticsPropertyName(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return '';
    return trimmed.startsWith('properties/') ? trimmed : `properties/${trimmed}`;
}
class GoogleServiceAccountClient {
    credentials;
    oauth;
    tokenCache = new Map();
    constructor(source) {
        if (isOAuthTokenSource(source)) {
            this.oauth = source;
            this.credentials = null;
        }
        else {
            this.credentials = source;
            this.oauth = null;
        }
    }
    get serviceAccountEmail() {
        return this.credentials?.client_email ?? this.oauth?.email ?? '';
    }
    async listSearchConsoleSites() {
        const accessToken = await this.getAccessToken([SEARCH_CONSOLE_SCOPE]);
        const response = await axios_1.default.get('https://www.googleapis.com/webmasters/v3/sites', {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 15000,
        });
        return (response.data.siteEntry ?? [])
            .map((entry) => ({
            siteUrl: entry.siteUrl ?? '',
            permissionLevel: entry.permissionLevel ?? '',
        }))
            .filter((entry) => entry.siteUrl);
    }
    async querySearchConsolePreview(siteUrl, range) {
        const accessToken = await this.getAccessToken([SEARCH_CONSOLE_SCOPE]);
        const win = resolvePerformanceWindow(range, getStableGoogleDateRange(range.days));
        const response = await axios_1.default.post(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
            startDate: win.startDate,
            endDate: win.endDate,
            dimensions: ['query', 'page'],
            rowLimit: 10,
        }, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 20000,
        });
        const rows = response.data.rows ?? [];
        return {
            siteUrl,
            startDate: win.startDate,
            endDate: win.endDate,
            rangeDays: win.rangeDays,
            rangeKey: win.rangeKey,
            rowCount: rows.length,
            totalClicks: sumRows(rows, 'clicks'),
            totalImpressions: sumRows(rows, 'impressions'),
        };
    }
    async querySearchConsolePerformanceReport(siteUrl, range) {
        const accessToken = await this.getAccessToken([SEARCH_CONSOLE_SCOPE]);
        const win = resolvePerformanceWindow(range, getStableGoogleDateRange(range.days));
        const dateRange = { startDate: win.startDate, endDate: win.endDate };
        const partialErrors = [];
        const summaryRows = await this.querySearchAnalytics(accessToken, siteUrl, dateRange, [], 1);
        const [daily, queries, pages, countries, devices, searchAppearance] = await Promise.all([
            this.querySearchAnalyticsOptional(accessToken, siteUrl, dateRange, ['date'], win.rangeDays, partialErrors, 'Daily performance'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, dateRange, ['query'], 25, partialErrors, 'Queries'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, dateRange, ['page'], 25, partialErrors, 'Pages'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, dateRange, ['country'], 25, partialErrors, 'Countries'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, dateRange, ['device'], 10, partialErrors, 'Devices'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, dateRange, ['searchAppearance'], 10, partialErrors, 'Search appearance'),
        ]);
        const dailyRows = daily
            .map((row) => {
            const normalized = normalizeSearchConsoleMetricRow(row);
            const date = row.keys?.[0] ?? '';
            return normalized && date ? { ...normalized, date } : null;
        })
            .filter(Boolean);
        const summary = normalizeSearchConsoleMetricRow(summaryRows[0]) ?? summarizeSearchConsoleRows(dailyRows);
        return {
            siteUrl,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            rangeDays: win.rangeDays,
            rangeKey: win.rangeKey,
            summary,
            daily: dailyRows,
            queries: normalizeSearchConsoleDimensionRows(queries),
            pages: normalizeSearchConsoleDimensionRows(pages),
            countries: normalizeSearchConsoleDimensionRows(countries),
            devices: normalizeSearchConsoleDimensionRows(devices),
            searchAppearance: normalizeSearchConsoleDimensionRows(searchAppearance),
            days: dailyRows,
            partialErrors,
        };
    }
    /**
     * Reproduce the Search Console "Insights" view. Queries the selected window plus the
     * immediately-preceding window of equal length, then derives the headline trends and the
     * "Your content" tabs (top / trending up / trending down) by diffing per-page clicks.
     */
    async querySearchConsoleInsights(siteUrl, range) {
        const accessToken = await this.getAccessToken([SEARCH_CONSOLE_SCOPE]);
        const win = resolvePerformanceWindow(range, getStableGoogleDateRange(range.days));
        const current = { startDate: win.startDate, endDate: win.endDate };
        const previous = priorSearchConsoleWindow(win.startDate, win.rangeDays);
        const partialErrors = [];
        const [currentTotals, previousTotals, dailyRows, currentPages, previousPages] = await Promise.all([
            this.querySearchAnalyticsOptional(accessToken, siteUrl, current, [], 1, partialErrors, 'Current totals'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, previous, [], 1, partialErrors, 'Previous totals'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, current, ['date'], win.rangeDays, partialErrors, 'Daily series'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, current, ['page'], 1000, partialErrors, 'Top content'),
            this.querySearchAnalyticsOptional(accessToken, siteUrl, previous, ['page'], 1000, partialErrors, 'Previous content'),
        ]);
        const currentSummary = normalizeSearchConsoleMetricRow(currentTotals[0]);
        const previousSummary = normalizeSearchConsoleMetricRow(previousTotals[0]);
        const daily = dailyRows
            .map((row) => {
            const normalized = normalizeSearchConsoleMetricRow(row);
            const date = row.keys?.[0] ?? '';
            return normalized && date ? { ...normalized, date } : null;
        })
            .filter(Boolean);
        const previousClicksByPage = new Map();
        for (const row of previousPages) {
            const url = row.keys?.[0];
            if (url)
                previousClicksByPage.set(url, safeNumber(row.clicks));
        }
        const pages = currentPages
            .map((row) => {
            const url = row.keys?.[0] ?? '';
            const clicks = safeNumber(row.clicks);
            const previousClicks = previousClicksByPage.get(url) ?? 0;
            return {
                url,
                clicks,
                previousClicks,
                impressions: safeNumber(row.impressions),
                deltaPct: previousClicks > 0 ? (clicks - previousClicks) / previousClicks : null,
            };
        })
            .filter((page) => page.url.length > 0);
        const topPages = [...pages].sort((a, b) => b.clicks - a.clicks).slice(0, 10);
        const trendingUp = [...pages]
            .filter((page) => page.clicks >= 3 && page.clicks > page.previousClicks)
            .sort((a, b) => trendingSortKey(b) - trendingSortKey(a))
            .slice(0, 10);
        const trendingDown = [...pages]
            .filter((page) => page.previousClicks >= 3 && page.clicks < page.previousClicks)
            .sort((a, b) => (a.deltaPct ?? 0) - (b.deltaPct ?? 0))
            .slice(0, 10);
        return {
            siteUrl,
            startDate: current.startDate,
            endDate: current.endDate,
            previousStartDate: previous.startDate,
            previousEndDate: previous.endDate,
            rangeDays: win.rangeDays,
            rangeKey: win.rangeKey,
            clicks: insightsMetric(currentSummary?.clicks ?? 0, previousSummary?.clicks ?? 0),
            impressions: insightsMetric(currentSummary?.impressions ?? 0, previousSummary?.impressions ?? 0),
            daily,
            topPages,
            trendingUp,
            trendingDown,
            partialErrors,
        };
    }
    async listAnalyticsProperties() {
        const accessToken = await this.getAccessToken([ANALYTICS_SCOPE]);
        const properties = [];
        let pageToken = '';
        for (let page = 0; page < 10; page += 1) {
            const response = await axios_1.default.get('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: pageToken ? { pageToken } : undefined,
                timeout: 15000,
            });
            for (const account of response.data.accountSummaries ?? []) {
                for (const property of account.propertySummaries ?? []) {
                    if (!property.property)
                        continue;
                    properties.push({
                        account: account.account ?? '',
                        accountDisplayName: account.displayName ?? '',
                        property: property.property,
                        propertyDisplayName: property.displayName ?? property.property,
                    });
                }
            }
            pageToken = response.data.nextPageToken ?? '';
            if (!pageToken)
                break;
        }
        return properties;
    }
    async queryAnalyticsOrganicPreview(propertyName, range) {
        const property = normalizeAnalyticsPropertyName(propertyName);
        if (!property)
            throw new Error('GA4 property is required.');
        const accessToken = await this.getAccessToken([ANALYTICS_SCOPE]);
        const win = resolvePerformanceWindow(range, getStableAnalyticsDateRange(range.days));
        const response = await axios_1.default.post(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, {
            dateRanges: [{ startDate: win.startDate, endDate: win.endDate }],
            dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'sessionDefaultChannelGroup' }],
            metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
            dimensionFilter: {
                filter: {
                    fieldName: 'sessionDefaultChannelGroup',
                    stringFilter: {
                        matchType: 'EXACT',
                        value: 'Organic Search',
                    },
                },
            },
            limit: '10',
        }, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 20000,
        });
        const rows = response.data.rows ?? [];
        return {
            property,
            startDate: win.startDate,
            endDate: win.endDate,
            rangeDays: win.rangeDays,
            rangeKey: win.rangeKey,
            rowCount: rows.length,
            totalSessions: sumAnalyticsMetric(rows, 0),
            totalUsers: sumAnalyticsMetric(rows, 1),
        };
    }
    async queryAnalyticsReport(propertyName, range) {
        const property = normalizeAnalyticsPropertyName(propertyName);
        if (!property)
            throw new Error('GA4 property is required.');
        const accessToken = await this.getAccessToken([ANALYTICS_SCOPE]);
        const win = resolvePerformanceWindow(range, getStableAnalyticsDateRange(range.days));
        const dateRange = { startDate: win.startDate, endDate: win.endDate };
        const partialErrors = [];
        const summaryMetrics = [
            'activeUsers',
            'eventCount',
            'sessions',
            'totalUsers',
            'engagedSessions',
            'userEngagementDuration',
        ];
        const summaryRows = await this.runAnalyticsReport(accessToken, property, {
            dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
            metrics: summaryMetrics.map((name) => ({ name })),
        });
        const summaryRow = normalizeAnalyticsMetricRow(summaryRows[0], [], summaryMetrics) ?? { key: 'Total' };
        const activeUsers = summaryRow.activeUsers ?? 0;
        const userEngagementDuration = summaryRow.userEngagementDuration ?? 0;
        // `eventCountPerUser` is incompatible with the `eventName` dimension in the GA4 Data API
        // (the request 400s and returns nothing), so request the compatible metrics and derive the
        // per-user ratio ourselves to match GA4's "Event count per active user" column.
        const eventMetrics = ['eventCount', 'totalUsers', 'totalRevenue'];
        const events = (await this.runAnalyticsReportOptional(accessToken, property, {
            dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
            dimensions: [{ name: 'eventName' }],
            metrics: eventMetrics.map((name) => ({ name })),
            orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
            limit: '15',
        }, eventMetrics, partialErrors, 'Events')).map((row) => ({
            ...row,
            eventCountPerUser: row.totalUsers && row.totalUsers > 0 ? (row.eventCount ?? 0) / row.totalUsers : 0,
        }));
        const topEventNames = events.map((row) => row.key).filter(Boolean).slice(0, 5);
        const [daily, channels, countries, dailyEvents, organicLandingPages, realtimeCountries] = await Promise.all([
            this.runAnalyticsReportOptional(accessToken, property, {
                dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
                dimensions: [{ name: 'date' }],
                metrics: [
                    { name: 'activeUsers' },
                    { name: 'eventCount' },
                    { name: 'sessions' },
                    { name: 'totalUsers' },
                ],
                orderBys: [{ dimension: { dimensionName: 'date' } }],
                limit: String(win.rangeDays),
            }, ['activeUsers', 'eventCount', 'sessions', 'totalUsers'], partialErrors, 'Daily analytics'),
            this.runAnalyticsReportOptional(accessToken, property, {
                dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
                dimensions: [{ name: 'sessionDefaultChannelGroup' }],
                metrics: [
                    { name: 'sessions' },
                    { name: 'totalUsers' },
                    { name: 'eventCount' },
                ],
                orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                limit: '10',
            }, ['sessions', 'totalUsers', 'eventCount'], partialErrors, 'Channels'),
            this.runAnalyticsReportOptional(accessToken, property, {
                dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
                dimensions: [{ name: 'country' }],
                metrics: [
                    { name: 'activeUsers' },
                    { name: 'eventCount' },
                    { name: 'sessions' },
                ],
                orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }],
                limit: '10',
            }, ['activeUsers', 'eventCount', 'sessions'], partialErrors, 'Countries'),
            this.runAnalyticsReportOptional(accessToken, property, {
                dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
                dimensions: [{ name: 'date' }, { name: 'eventName' }],
                metrics: [{ name: 'eventCount' }],
                orderBys: [{ dimension: { dimensionName: 'date' } }, { metric: { metricName: 'eventCount' }, desc: true }],
                ...(topEventNames.length > 0
                    ? {
                        dimensionFilter: {
                            filter: {
                                fieldName: 'eventName',
                                inListFilter: { values: topEventNames },
                            },
                        },
                    }
                    : {}),
                limit: String(Math.max(win.rangeDays * Math.max(topEventNames.length, 1), 80)),
            }, ['eventCount'], partialErrors, 'Daily events'),
            this.runAnalyticsReportOptional(accessToken, property, {
                dateRanges: [{ startDate: dateRange.startDate, endDate: dateRange.endDate }],
                dimensions: [{ name: 'landingPagePlusQueryString' }, { name: 'sessionDefaultChannelGroup' }],
                metrics: [
                    { name: 'sessions' },
                    { name: 'totalUsers' },
                    { name: 'eventCount' },
                ],
                dimensionFilter: {
                    filter: {
                        fieldName: 'sessionDefaultChannelGroup',
                        stringFilter: {
                            matchType: 'EXACT',
                            value: 'Organic Search',
                        },
                    },
                },
                orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
                limit: '15',
            }, ['sessions', 'totalUsers', 'eventCount'], partialErrors, 'Organic landing pages'),
            this.runAnalyticsRealtimeOptional(accessToken, property, {
                dimensions: [{ name: 'country' }],
                metrics: [{ name: 'activeUsers' }],
                limit: '10',
            }, ['activeUsers'], partialErrors, 'Realtime countries'),
        ]);
        return {
            property,
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            rangeDays: win.rangeDays,
            rangeKey: win.rangeKey,
            summary: {
                activeUsers,
                eventCount: summaryRow.eventCount ?? 0,
                sessions: summaryRow.sessions ?? 0,
                totalUsers: summaryRow.totalUsers ?? 0,
                engagedSessions: summaryRow.engagedSessions ?? 0,
                userEngagementDuration,
                averageEngagementSeconds: activeUsers > 0 ? userEngagementDuration / activeUsers : 0,
            },
            daily: daily.map((row) => ({ ...row, date: row.key })),
            channels,
            countries,
            dailyEvents: dailyEvents.map((row) => splitDailyEventRow(row)),
            events,
            organicLandingPages: organicLandingPages.map((row) => ({ ...row, key: stripOrganicChannelKey(row.key) })),
            realtimeCountries,
            partialErrors,
        };
    }
    async publishUrlNotification(input) {
        const accessToken = await this.getAccessToken([INDEXING_SCOPE]);
        const response = await axios_1.default.post(INDEXING_PUBLISH_ENDPOINT, { url: input.url, type: input.type }, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            timeout: 20000,
        });
        return response.data;
    }
    async getAccessToken(scopes) {
        // OAuth-backed clients hold one user token that already carries every consented scope, so the
        // per-scope argument is irrelevant — return the (already auto-refreshed) user token.
        if (this.oauth)
            return this.oauth.getAccessToken();
        const credentials = this.credentials;
        if (!credentials)
            throw new Error('Google client has no credentials.');
        const scope = [...scopes].sort().join(' ');
        const cached = this.tokenCache.get(scope);
        if (cached && cached.expiresAt > Date.now() + 60_000) {
            return cached.accessToken;
        }
        const assertion = this.createJwtAssertion(scope);
        const response = await axios_1.default.post(credentials.token_uri ?? TOKEN_URL, new URLSearchParams({
            grant_type: JWT_GRANT_TYPE,
            assertion,
        }), {
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
        });
        const accessToken = response.data.access_token;
        this.tokenCache.set(scope, {
            accessToken,
            expiresAt: Date.now() + Math.max(60, response.data.expires_in - 60) * 1000,
        });
        return accessToken;
    }
    createJwtAssertion(scope) {
        const credentials = this.credentials;
        if (!credentials)
            throw new Error('Google client has no service-account credentials.');
        const nowSeconds = Math.floor(Date.now() / 1000);
        const header = {
            alg: 'RS256',
            typ: 'JWT',
            kid: credentials.private_key_id,
        };
        const claim = {
            iss: credentials.client_email,
            scope,
            aud: credentials.token_uri ?? TOKEN_URL,
            iat: nowSeconds,
            exp: nowSeconds + 3600,
        };
        const signingInput = `${base64UrlJson(header)}.${base64UrlJson(claim)}`;
        const signature = (0, crypto_1.createSign)('RSA-SHA256').update(signingInput).sign(credentials.private_key);
        return `${signingInput}.${base64Url(signature)}`;
    }
    async querySearchAnalytics(accessToken, siteUrl, dateRange, dimensions, rowLimit) {
        const response = await axios_1.default.post(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            dimensions,
            rowLimit,
            dataState: 'all',
        }, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 20000,
        });
        return response.data.rows ?? [];
    }
    async querySearchAnalyticsOptional(accessToken, siteUrl, dateRange, dimensions, rowLimit, partialErrors, label) {
        try {
            return await this.querySearchAnalytics(accessToken, siteUrl, dateRange, dimensions, rowLimit);
        }
        catch (error) {
            partialErrors.push(`${label}: ${formatGoogleApiError(error)}`);
            return [];
        }
    }
    async runAnalyticsReport(accessToken, property, body) {
        const response = await axios_1.default.post(`https://analyticsdata.googleapis.com/v1beta/${property}:runReport`, body, {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeout: 20000,
        });
        return response.data.rows ?? [];
    }
    async runAnalyticsReportOptional(accessToken, property, body, metrics, partialErrors, label) {
        try {
            const rows = await this.runAnalyticsReport(accessToken, property, body);
            return rows.map((row) => normalizeAnalyticsMetricRow(row, row.dimensionValues?.map((item) => item.value ?? '') ?? [], metrics)).filter(Boolean);
        }
        catch (error) {
            partialErrors.push(`${label}: ${formatGoogleApiError(error)}`);
            return [];
        }
    }
    async runAnalyticsRealtimeOptional(accessToken, property, body, metrics, partialErrors, label) {
        try {
            const response = await axios_1.default.post(`https://analyticsdata.googleapis.com/v1beta/${property}:runRealtimeReport`, body, {
                headers: { Authorization: `Bearer ${accessToken}` },
                timeout: 20000,
            });
            return (response.data.rows ?? [])
                .map((row) => normalizeAnalyticsMetricRow(row, row.dimensionValues?.map((item) => item.value ?? '') ?? [], metrics))
                .filter(Boolean);
        }
        catch (error) {
            partialErrors.push(`${label}: ${formatGoogleApiError(error)}`);
            return [];
        }
    }
    async listSitemaps(siteUrl) {
        const accessToken = await this.getAccessToken([SEARCH_CONSOLE_SCOPE]);
        const response = await axios_1.default.get(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 });
        return (response.data.sitemap ?? [])
            .map((entry) => (typeof entry.path === 'string' ? entry.path : ''))
            .filter((path) => path.length > 0);
    }
    /** Inspect a single URL through the official URL Inspection API. */
    async inspectUrl(siteUrl, inspectionUrl) {
        const accessToken = await this.getAccessToken([SEARCH_CONSOLE_SCOPE]);
        const response = await axios_1.default.post(URL_INSPECTION_ENDPOINT, { inspectionUrl, siteUrl, languageCode: 'en-US' }, { headers: { Authorization: `Bearer ${accessToken}` }, timeout: URL_INSPECTION_TIMEOUT_MS });
        const result = response.data.inspectionResult ?? {};
        const status = result.indexStatusResult ?? {};
        return {
            url: inspectionUrl,
            coverageState: (status.coverageState ?? '').trim() || 'Unknown',
            verdict: status.verdict ?? 'VERDICT_UNSPECIFIED',
            indexingState: status.indexingState ?? '',
            robotsTxtState: status.robotsTxtState ?? '',
            lastCrawlTime: status.lastCrawlTime ?? null,
            inspectionLink: result.inspectionResultLink ?? '',
        };
    }
    /**
     * Build a Page Indexing report by inspecting a representative sample of the site's URLs —
     * merged from the sitemap and Search Analytics pages — and bucketing each by coverage state.
     * The API cannot enumerate every URL Google knows, so this is a sample, not the full GSC report.
     */
    async buildPageIndexReport(siteUrl, options) {
        const maxUrls = Math.max(1, Math.min(options?.maxUrls ?? URL_INSPECTION_DEFAULT_MAX, URL_INSPECTION_MAX));
        const onProgress = options?.onProgress;
        const partialErrors = [];
        onProgress?.({ phase: 'collecting', done: 0, total: 0, currentUrl: '' });
        const { urls, total, source } = await this.collectKnownUrls(siteUrl, maxUrls, partialErrors);
        if (urls.length === 0) {
            throw new Error('No URLs found to inspect. Submit a sitemap in Search Console or pull Search Performance first.');
        }
        const entries = [];
        let cursor = 0;
        let completed = 0;
        let aborted = false;
        onProgress?.({ phase: 'inspecting', done: 0, total: urls.length, currentUrl: urls[0] });
        const worker = async () => {
            while (!aborted && cursor < urls.length) {
                const target = urls[cursor];
                cursor += 1;
                try {
                    entries.push(await this.inspectUrl(siteUrl, target));
                }
                catch (error) {
                    partialErrors.push(`Inspect ${target}: ${formatGoogleApiError(error)}`);
                    // Quota (429) or permission (403) errors will repeat for every remaining URL, so stop early.
                    if (axios_1.default.isAxiosError(error) && (error.response?.status === 429 || error.response?.status === 403)) {
                        aborted = true;
                    }
                }
                completed += 1;
                onProgress?.({ phase: 'inspecting', done: completed, total: urls.length, currentUrl: target });
            }
        };
        await Promise.all(Array.from({ length: Math.min(URL_INSPECTION_CONCURRENCY, urls.length) }, () => worker()));
        const groups = new Map();
        let indexedCount = 0;
        for (const entry of entries) {
            const indexed = entry.verdict === 'PASS';
            if (indexed)
                indexedCount += 1;
            const reason = entry.coverageState || (indexed ? 'Submitted and indexed' : 'Unknown');
            const existing = groups.get(reason);
            if (existing) {
                existing.count += 1;
                if (existing.examples.length < PAGE_INDEX_EXAMPLES_PER_REASON)
                    existing.examples.push(entry);
            }
            else {
                groups.set(reason, {
                    reason,
                    source: GOOGLE_SYSTEM_PAGE_INDEX_REASONS.has(reason) ? 'Google systems' : 'Website',
                    indexed,
                    count: 1,
                    examples: [entry],
                });
            }
        }
        const reasons = Array.from(groups.values()).sort((a, b) => b.count - a.count);
        const inspectedCount = entries.length;
        onProgress?.({ phase: 'done', done: inspectedCount, total: urls.length, currentUrl: '' });
        return {
            siteUrl,
            generatedAt: new Date().toISOString(),
            urlSource: source,
            totalKnownUrls: Math.max(total, inspectedCount),
            inspectedCount,
            indexedCount,
            notIndexedCount: inspectedCount - indexedCount,
            sampled: total > inspectedCount,
            reasons,
            partialErrors,
        };
    }
    async collectKnownUrls(siteUrl, maxUrls, partialErrors) {
        // Gather a wider pool than maxUrls so the inspection sample stays representative.
        const poolCap = Math.max(maxUrls * 6, 600);
        // Two complementary universes:
        //  - sitemap URLs surface "Google systems" reasons (Crawled/Discovered - not indexed).
        //  - Search Analytics page URLs include pages Google found OUTSIDE the sitemap
        //    (old/removed/redirected/duplicate URLs) — the source of most "Website" reasons
        //    (404, redirect, blocked by robots.txt, canonical). Merging both is what lets the
        //    capped sample reproduce the variety of reasons GSC shows.
        const sitemapUrls = await this.gatherSitemapUrls(siteUrl, poolCap, partialErrors);
        const searchUrls = await this.gatherSearchAnalyticsUrls(siteUrl, poolCap, partialErrors);
        const merged = interleaveDedupe(sitemapUrls, searchUrls);
        if (merged.length === 0) {
            return { urls: [], total: 0, source: 'sitemap' };
        }
        const source = sitemapUrls.length > 0 && searchUrls.length > 0
            ? 'mixed'
            : sitemapUrls.length > 0
                ? 'sitemap'
                : 'search-analytics';
        return { urls: merged.slice(0, maxUrls), total: merged.length, source };
    }
    async gatherSitemapUrls(siteUrl, limit, partialErrors) {
        const sitemapPaths = await this.listSitemaps(siteUrl).catch((error) => {
            partialErrors.push(`Sitemaps: ${formatGoogleApiError(error)}`);
            return [];
        });
        const collected = new Set();
        const budget = { remaining: limit };
        for (const path of sitemapPaths) {
            if (collected.size >= limit)
                break;
            const urls = await this.fetchSitemapUrls(path, 0, budget, partialErrors);
            for (const url of urls) {
                collected.add(url);
                if (collected.size >= limit)
                    break;
            }
        }
        return Array.from(collected);
    }
    async gatherSearchAnalyticsUrls(siteUrl, limit, partialErrors) {
        try {
            const accessToken = await this.getAccessToken([SEARCH_CONSOLE_SCOPE]);
            const win = resolvePerformanceWindow({ days: 90 }, getStableGoogleDateRange(90));
            const rows = await this.querySearchAnalytics(accessToken, siteUrl, { startDate: win.startDate, endDate: win.endDate }, ['page'], Math.min(limit, 1000));
            return rows.map((row) => row.keys?.[0] ?? '').filter((url) => url.length > 0);
        }
        catch (error) {
            partialErrors.push(`Page list: ${formatGoogleApiError(error)}`);
            return [];
        }
    }
    async fetchSitemapUrls(sitemapUrl, depth, budget, partialErrors) {
        if (depth > SITEMAP_MAX_DEPTH || budget.remaining <= 0)
            return [];
        let xml;
        try {
            const response = await axios_1.default.get(sitemapUrl, {
                timeout: SITEMAP_FETCH_TIMEOUT_MS,
                responseType: 'text',
                transformResponse: (data) => data,
            });
            xml = typeof response.data === 'string' ? response.data : String(response.data ?? '');
        }
        catch (error) {
            partialErrors.push(`Sitemap ${sitemapUrl}: ${formatGoogleApiError(error)}`);
            return [];
        }
        const locations = extractSitemapLocations(xml);
        if (/<sitemapindex[\s>]/i.test(xml)) {
            const pages = [];
            for (const childSitemap of locations) {
                if (budget.remaining <= 0)
                    break;
                pages.push(...(await this.fetchSitemapUrls(childSitemap, depth + 1, budget, partialErrors)));
            }
            return pages;
        }
        const pages = locations.slice(0, budget.remaining);
        budget.remaining -= pages.length;
        return pages;
    }
}
exports.GoogleServiceAccountClient = GoogleServiceAccountClient;
function formatGoogleApiError(error) {
    if (axios_1.default.isAxiosError(error)) {
        const message = readGoogleErrorMessage(error.response?.data);
        if (message) {
            if (/analyticsadmin\.googleapis\.com/.test(message) && /has not been used|disabled/i.test(message)) {
                return 'Google Analytics Admin API is disabled for the OAuth client project. The OAuth scope is present, but GA4 property discovery also requires analyticsadmin.googleapis.com to be enabled.';
            }
            if (/analyticsdata\.googleapis\.com/.test(message) && /has not been used|disabled/i.test(message)) {
                return 'Google Analytics Data API is disabled for the OAuth client project. The OAuth scope is present, but GA4 reports require analyticsdata.googleapis.com to be enabled.';
            }
            return message;
        }
        if (error.response?.status)
            return `Google API request failed with HTTP ${error.response.status}.`;
        return error.message;
    }
    return error instanceof Error ? error.message : 'Google API request failed.';
}
function extractCredentialSource(input) {
    if (!input || typeof input !== 'object')
        return input;
    const record = input;
    if (typeof record.serviceAccountJson === 'string') {
        try {
            return JSON.parse(record.serviceAccountJson);
        }
        catch {
            return null;
        }
    }
    if (record.serviceAccount && typeof record.serviceAccount === 'object') {
        return record.serviceAccount;
    }
    return input;
}
/** Round-robin merge of two URL lists, dropping duplicates, so a capped slice covers both sources. */
function interleaveDedupe(a, b) {
    const seen = new Set();
    const out = [];
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i += 1) {
        for (const url of [a[i], b[i]]) {
            if (url && !seen.has(url)) {
                seen.add(url);
                out.push(url);
            }
        }
    }
    return out;
}
function decodeXmlEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
function extractSitemapLocations(xml) {
    const matches = xml.match(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/gi) ?? [];
    return matches
        .map((match) => decodeXmlEntities(match.replace(/<\/?loc>/gi, '').trim()))
        .filter((url) => /^https?:\/\//i.test(url));
}
function base64UrlJson(value) {
    return base64Url(Buffer.from(JSON.stringify(value), 'utf8'));
}
function base64Url(value) {
    return value.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function sumRows(rows, key) {
    return rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : 0), 0);
}
function sumAnalyticsMetric(rows, index) {
    return rows.reduce((total, row) => {
        const value = Number(row.metricValues?.[index]?.value ?? 0);
        return Number.isFinite(value) ? total + value : total;
    }, 0);
}
function normalizeSearchConsoleMetricRow(row) {
    if (!row)
        return null;
    return {
        clicks: safeNumber(row.clicks),
        impressions: safeNumber(row.impressions),
        ctr: safeNumber(row.ctr),
        position: safeNumber(row.position),
    };
}
function normalizeSearchConsoleDimensionRows(rows) {
    return rows
        .map((row) => {
        const key = row.keys?.[0] ?? '';
        const metrics = normalizeSearchConsoleMetricRow(row);
        return key && metrics ? { key, ...metrics } : null;
    })
        .filter(Boolean);
}
function summarizeSearchConsoleRows(rows) {
    const clicks = rows.reduce((total, row) => total + row.clicks, 0);
    const impressions = rows.reduce((total, row) => total + row.impressions, 0);
    const weightedPosition = rows.reduce((total, row) => total + row.position * row.impressions, 0);
    return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: impressions > 0 ? weightedPosition / impressions : 0,
    };
}
function normalizeAnalyticsMetricRow(row, dimensions, metrics) {
    if (!row)
        return null;
    const key = dimensions.filter(Boolean).join(' - ') || 'Total';
    const result = { key };
    metrics.forEach((metric, index) => {
        result[metric] = safeNumber(row.metricValues?.[index]?.value);
    });
    if (result.activeUsers && result.userEngagementDuration) {
        result.averageEngagementSeconds = result.userEngagementDuration / result.activeUsers;
    }
    return result;
}
function stripOrganicChannelKey(value) {
    return value.replace(/\s+-\s+Organic Search$/i, '') || value;
}
function splitDailyEventRow(row) {
    const separator = ' - ';
    const separatorIndex = row.key.indexOf(separator);
    const date = separatorIndex >= 0 ? row.key.slice(0, separatorIndex) : row.key;
    const eventName = separatorIndex >= 0 ? row.key.slice(separatorIndex + separator.length) : 'Unknown event';
    return { ...row, date, key: eventName };
}
function safeNumber(value) {
    const numberValue = Number(value ?? 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
}
function inclusiveDayCount(startDate, endDate, fallback) {
    const start = Date.parse(`${startDate}T00:00:00Z`);
    const end = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
        return fallback;
    return Math.round((end - start) / 86_400_000) + 1;
}
function resolvePerformanceWindow(range, fallback) {
    const custom = Boolean(range.startDate && range.endDate);
    const startDate = range.startDate || fallback.startDate;
    const endDate = range.endDate || fallback.endDate;
    return {
        startDate,
        endDate,
        rangeDays: custom ? inclusiveDayCount(startDate, endDate, range.days) : range.days,
        rangeKey: range.rangeKey ?? String(range.days),
    };
}
/** The window of `rangeDays` ending the day before `startDate` — the comparison period for Insights. */
function priorSearchConsoleWindow(startDate, rangeDays) {
    const startMs = Date.parse(`${startDate}T00:00:00Z`);
    const safeStartMs = Number.isFinite(startMs) ? startMs : Date.now();
    const priorEnd = new Date(safeStartMs - 86_400_000);
    const priorStart = new Date(priorEnd.getTime() - Math.max(0, rangeDays - 1) * 86_400_000);
    return { startDate: toGoogleDate(priorStart), endDate: toGoogleDate(priorEnd) };
}
function insightsMetric(current, previous) {
    return { current, previous, deltaPct: previous > 0 ? (current - previous) / previous : null };
}
/** Sort key for "trending up": brand-new pages (no prior clicks) rank above any finite % gain. */
function trendingSortKey(page) {
    return page.deltaPct == null ? Number.POSITIVE_INFINITY : page.deltaPct;
}
function getStableGoogleDateRange(days = 7) {
    const end = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - Math.max(1, days - 1) * 24 * 60 * 60 * 1000);
    return {
        startDate: toGoogleDate(start),
        endDate: toGoogleDate(end),
    };
}
function getStableAnalyticsDateRange(days = 28) {
    const end = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - Math.max(1, days - 1) * 24 * 60 * 60 * 1000);
    return {
        startDate: toGoogleDate(start),
        endDate: toGoogleDate(end),
    };
}
function toGoogleDate(date) {
    return date.toISOString().slice(0, 10);
}
function readGoogleErrorMessage(data) {
    if (!data || typeof data !== 'object')
        return null;
    const record = data;
    const error = record.error;
    // API endpoints (GSC/GA4/Indexing) nest the human message under `error.message`.
    if (error && typeof error === 'object') {
        const message = error.message;
        if (typeof message === 'string' && message.trim())
            return message;
    }
    // OAuth token endpoints (token refresh + service-account JWT exchange) use a FLAT shape where
    // `error` is a string code with `error_description` alongside — e.g.
    // `{ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }`. Without this branch
    // those failures collapse to an opaque "HTTP 400", hiding the real cause (expired/revoked refresh
    // token, rotated service-account key, clock skew, etc.).
    if (typeof error === 'string' && error.trim()) {
        const description = record.error_description;
        return typeof description === 'string' && description.trim() ? `${error}: ${description}` : error;
    }
    return null;
}
//# sourceMappingURL=GoogleServiceAccountClient.js.map