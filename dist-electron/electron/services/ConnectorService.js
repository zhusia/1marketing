"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectorService = exports.ConnectorService = void 0;
const axios_1 = __importDefault(require("axios"));
const electron_1 = require("electron");
const AppRepository_1 = require("./AppRepository");
const channels_1 = require("../ipc/channels");
const CredentialVault_1 = require("./CredentialVault");
const registry_1 = require("./publishers/registry");
const customApiTemplate_1 = require("./publishers/customApiTemplate");
const OAuthService_1 = require("./oauth/OAuthService");
const DataForSeoClient_1 = require("./seo/DataForSeoClient");
const GoogleServiceAccountClient_1 = require("./google/GoogleServiceAccountClient");
const gscProperty_1 = require("./google/gscProperty");
const PageSpeedService_1 = require("./PageSpeedService");
const id_1 = require("../utils/id");
const PERFORMANCE_DATE_RANGE_DAYS = [1, 7, 30, 90];
/**
 * Reserved id for the synthetic "Sign in with Google" (user OAuth) account. It lives in
 * `config.serviceAccounts[]` like a service account so the import/mapping UIs work unchanged, but
 * it has no SA credentials — its Bearer token comes from `oauthService.ensureFreshToken`.
 */
const GOOGLE_OAUTH_ACCOUNT_ID = 'google-oauth';
/** Maximum number of past PageSpeed runs retained per project (across both strategies). */
const PAGE_SPEED_HISTORY_LIMIT = 40;
function assertConfigValue(config, key) {
    const value = config[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function isPlainRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readString(input, key) {
    const value = input?.[key];
    return typeof value === 'string' ? value.trim() : '';
}
function readNullableNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim())
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function readPositiveLimit(value) {
    return value != null && value > 0 ? value : null;
}
function readNestedRecord(input, path) {
    let current = input;
    for (const part of path) {
        if (!isPlainRecord(current))
            return null;
        current = current[part];
    }
    return isPlainRecord(current) ? current : null;
}
function readDataForSeoTotal(input) {
    if (!input)
        return null;
    const direct = readNullableNumber(input.total);
    if (direct != null)
        return direct;
    const totals = Object.entries(input)
        .filter(([key]) => key.startsWith('total_'))
        .map(([, value]) => readNullableNumber(value))
        .filter((value) => value != null);
    return totals.length ? totals.reduce((sum, value) => sum + value, 0) : null;
}
function readDataForSeoPeriodTotal(raw, section, bucket, period) {
    return readDataForSeoTotal(readNestedRecord(raw, [section, bucket, period]));
}
function readOptionalDateString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function normalizeDataForSeoAccountStatus(account) {
    const raw = isPlainRecord(account.raw) ? account.raw : {};
    const money = readNestedRecord(raw, ['money']);
    return {
        login: account.login,
        balanceUsd: account.balance,
        totalDepositedUsd: readNullableNumber(money?.total),
        spentTodayUsd: readDataForSeoPeriodTotal(raw, 'money', 'statistics', 'day'),
        dailySpendLimitUsd: readPositiveLimit(readDataForSeoPeriodTotal(raw, 'money', 'limits', 'day')),
        requestsToday: readDataForSeoPeriodTotal(raw, 'rates', 'statistics', 'day'),
        dailyRequestLimit: readPositiveLimit(readDataForSeoPeriodTotal(raw, 'rates', 'limits', 'day')),
        requestsThisMinute: readDataForSeoPeriodTotal(raw, 'rates', 'statistics', 'minute'),
        minuteRequestLimit: readPositiveLimit(readDataForSeoPeriodTotal(raw, 'rates', 'limits', 'minute')),
        backlinksSubscriptionExpiresAt: readOptionalDateString(raw.backlinks_subscription_expiry_date),
        llmMentionsSubscriptionExpiresAt: readOptionalDateString(raw.llm_mentions_subscription_expiry_date),
        refreshedAt: Date.now(),
    };
}
function recordMatchesSource(record, key, expected) {
    return Boolean(expected) && readString(record, key) === expected;
}
function isIsoDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}
function resolvePerformanceWindow(input) {
    const record = input;
    const startDate = readString(record ?? null, 'dateRangeStart');
    const endDate = readString(record ?? null, 'dateRangeEnd');
    if (isIsoDate(startDate) && isIsoDate(endDate) && startDate <= endDate) {
        const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
        return { days, rangeKey: `custom:${startDate}:${endDate}`, startDate, endDate };
    }
    const value = record?.dateRangeDays;
    const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    const days = PERFORMANCE_DATE_RANGE_DAYS.includes(numberValue)
        ? numberValue
        : 30;
    return { days, rangeKey: String(days) };
}
function resolvePerformanceRangeInput(range) {
    const startDate = range.startDate?.trim() ?? '';
    const endDate = range.endDate?.trim() ?? '';
    if (isIsoDate(startDate) && isIsoDate(endDate) && startDate <= endDate) {
        const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
        return { days, rangeKey: range.rangeKey ?? `custom:${startDate}:${endDate}`, startDate, endDate };
    }
    const days = PERFORMANCE_DATE_RANGE_DAYS.includes(range.days)
        ? range.days
        : 30;
    return { days, rangeKey: range.rangeKey ?? String(days) };
}
function performanceRangeConfig(range) {
    return range.startDate && range.endDate
        ? { kind: 'custom', startDate: range.startDate, endDate: range.endDate }
        : { kind: 'preset', days: range.days };
}
function performanceRangeInputConfig(range) {
    const resolved = resolvePerformanceRangeInput(range);
    const isPreset = PERFORMANCE_DATE_RANGE_DAYS.includes(resolved.days)
        && resolved.rangeKey === String(resolved.days);
    return isPreset ? { kind: 'preset', days: resolved.days } : performanceRangeConfig(resolved);
}
function upsertRangeCache(config, key, rangeKey, value, source) {
    const current = config[key];
    const cache = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    const sourceKey = source?.key;
    const sourceValue = source?.value.trim();
    if (sourceKey && sourceValue) {
        const currentRangeValue = cache[rangeKey];
        const currentRange = currentRangeValue && typeof currentRangeValue === 'object' && !Array.isArray(currentRangeValue)
            ? currentRangeValue
            : {};
        const legacySource = readString(currentRange, sourceKey);
        const sourceCache = legacySource ? { [legacySource]: currentRange } : currentRange;
        return {
            ...config,
            [key]: {
                ...cache,
                [rangeKey]: {
                    ...sourceCache,
                    [sourceValue]: value,
                },
            },
        };
    }
    return {
        ...config,
        [key]: {
            ...cache,
            [rangeKey]: value,
        },
    };
}
function removeRangeCacheEntry(config, key, rangeKey, source) {
    const current = config[key];
    if (!current || typeof current !== 'object' || Array.isArray(current))
        return config;
    const cache = { ...current };
    const sourceKey = source?.key;
    const sourceValue = source?.value.trim();
    if (!sourceKey || !sourceValue) {
        delete cache[rangeKey];
        return { ...config, [key]: cache };
    }
    const rangeValue = cache[rangeKey];
    if (!rangeValue || typeof rangeValue !== 'object' || Array.isArray(rangeValue))
        return config;
    const rangeRecord = rangeValue;
    if (recordMatchesSource(rangeRecord, sourceKey, sourceValue)) {
        delete cache[rangeKey];
        return { ...config, [key]: cache };
    }
    const nextRange = { ...rangeRecord };
    delete nextRange[sourceValue];
    if (Object.keys(nextRange).length === 0) {
        delete cache[rangeKey];
    }
    else {
        cache[rangeKey] = nextRange;
    }
    return { ...config, [key]: cache };
}
function clearLatestIfSourceMatches(config, key, sourceKey, sourceValue) {
    const current = config[key];
    if (!current || typeof current !== 'object' || Array.isArray(current))
        return config;
    if (!recordMatchesSource(current, sourceKey, sourceValue))
        return config;
    const nextConfig = { ...config };
    delete nextConfig[key];
    return nextConfig;
}
function searchPreviewFromReport(report) {
    return {
        siteUrl: report.siteUrl,
        startDate: report.startDate,
        endDate: report.endDate,
        rangeDays: report.rangeDays,
        rangeKey: report.rangeKey,
        rowCount: report.queries.length,
        totalClicks: report.summary.clicks,
        totalImpressions: report.summary.impressions,
    };
}
function analyticsPreviewFromReport(report) {
    return {
        property: report.property,
        startDate: report.startDate,
        endDate: report.endDate,
        rangeDays: report.rangeDays,
        rangeKey: report.rangeKey,
        rowCount: report.organicLandingPages.length,
        totalSessions: report.summary.sessions,
        totalUsers: report.summary.totalUsers,
    };
}
function readGoogleServiceAccounts(config) {
    const value = config.serviceAccounts;
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => {
        if (!item || typeof item !== 'object')
            return null;
        const record = item;
        const id = readString(record, 'id');
        const serviceAccountEmail = readString(record, 'serviceAccountEmail');
        if (!id || !serviceAccountEmail)
            return null;
        return {
            id,
            label: readString(record, 'label') || serviceAccountEmail,
            serviceAccountEmail,
            googleProjectId: readString(record, 'googleProjectId'),
            clientId: readString(record, 'clientId'),
            createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
            updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
            lastSyncedAt: typeof record.lastSyncedAt === 'number' ? record.lastSyncedAt : null,
            searchConsoleSites: Array.isArray(record.searchConsoleSites)
                ? record.searchConsoleSites
                : undefined,
            analyticsProperties: Array.isArray(record.analyticsProperties)
                ? record.analyticsProperties
                : undefined,
            searchConsoleError: readString(record, 'searchConsoleError') || undefined,
            analyticsError: readString(record, 'analyticsError') || undefined,
        };
    })
        .filter(Boolean);
}
function readGoogleProjectMappings(config) {
    const value = config.projectMappings;
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => {
        if (!item || typeof item !== 'object')
            return null;
        const record = item;
        const productId = readString(record, 'productId');
        if (!productId)
            return null;
        return {
            productId,
            serviceAccountId: readString(record, 'serviceAccountId'),
            propertyUrl: readString(record, 'propertyUrl'),
            ga4Property: readString(record, 'ga4Property'),
            updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
        };
    })
        .filter(Boolean);
}
function upsertGoogleProjectMapping(config, mapping) {
    const mappings = readGoogleProjectMappings(config);
    const index = mappings.findIndex((item) => item.productId === mapping.productId);
    const nextMappings = index === -1
        ? [...mappings, mapping]
        : mappings.map((item) => (item.productId === mapping.productId ? mapping : item));
    return {
        ...config,
        projectMappings: nextMappings,
    };
}
function normalizeMatchText(value) {
    return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function analyticsPropertyMatchText(property) {
    return normalizeMatchText([property.propertyDisplayName, property.accountDisplayName, property.property].filter(Boolean).join(' '));
}
function googleAccountSummary(config, accountId) {
    const accounts = readGoogleServiceAccounts(config);
    return accounts.find((account) => account.id === accountId) ?? accounts[0] ?? null;
}
function searchConsoleSitesForAccount(config, accountId) {
    const account = googleAccountSummary(config, accountId);
    if (account?.searchConsoleSites?.length)
        return account.searchConsoleSites;
    return Array.isArray(config.searchConsoleSites) ? config.searchConsoleSites : [];
}
function analyticsPropertiesForAccount(config, accountId) {
    const account = googleAccountSummary(config, accountId);
    if (account?.analyticsProperties?.length)
        return account.analyticsProperties;
    return Array.isArray(config.analyticsProperties) ? config.analyticsProperties : [];
}
function inferSearchConsoleSiteForProject(productId, sites) {
    const product = AppRepository_1.repository.getProduct(productId);
    if (!product || sites.length === 0)
        return null;
    const host = (0, gscProperty_1.hostKeyFromUrl)(product.url);
    if (!host)
        return null;
    return sites.find((site) => (0, gscProperty_1.parseGscSiteUrl)(site.siteUrl ?? '')?.host === host) ?? null;
}
function inferAnalyticsPropertyForProject(productId, properties) {
    const product = AppRepository_1.repository.getProduct(productId);
    if (!product || properties.length === 0)
        return null;
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
function normalizeGoogleSecretStore(secret, config) {
    const accounts = {};
    const configuredAccounts = readGoogleServiceAccounts(config);
    const configuredDefaultId = readString(config, 'defaultServiceAccountId');
    const explicitAccounts = secret?.accounts;
    if (explicitAccounts && typeof explicitAccounts === 'object' && !Array.isArray(explicitAccounts)) {
        for (const [id, value] of Object.entries(explicitAccounts)) {
            const credentials = (0, GoogleServiceAccountClient_1.normalizeGoogleServiceAccountCredentials)(value);
            if (id && credentials) {
                accounts[id] = credentials;
            }
        }
    }
    if (Object.keys(accounts).length === 0) {
        const legacyCredentials = (0, GoogleServiceAccountClient_1.normalizeGoogleServiceAccountCredentials)(secret);
        if (legacyCredentials) {
            const legacyId = configuredDefaultId ||
                configuredAccounts.find((account) => account.serviceAccountEmail === legacyCredentials.client_email)?.id ||
                configuredAccounts[0]?.id ||
                'default';
            accounts[legacyId] = legacyCredentials;
        }
    }
    const defaultAccountId = readString(secret, 'defaultAccountId') ||
        configuredDefaultId ||
        Object.keys(accounts)[0] ||
        undefined;
    return {
        defaultAccountId,
        accounts,
    };
}
function accountSummaryFromCredentials(accountId, credentials, existing, label) {
    const timestamp = Date.now();
    return {
        id: accountId,
        label: label?.trim() || existing?.label || credentials.project_id || credentials.client_email,
        serviceAccountEmail: credentials.client_email,
        googleProjectId: credentials.project_id ?? existing?.googleProjectId ?? '',
        clientId: credentials.client_id ?? existing?.clientId ?? '',
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lastSyncedAt: existing?.lastSyncedAt ?? null,
        searchConsoleSites: existing?.searchConsoleSites,
        analyticsProperties: existing?.analyticsProperties,
        searchConsoleError: existing?.searchConsoleError,
        analyticsError: existing?.analyticsError,
    };
}
/**
 * Build the Google API client for a resolved selection: an OAuth-token-backed client for the
 * signed-in user account, or the service-account client otherwise. Both expose the same methods.
 */
function buildGoogleClient(selection, email = '') {
    if (selection.authMode === 'oauth') {
        return new GoogleServiceAccountClient_1.GoogleServiceAccountClient({
            kind: 'oauth',
            email,
            getAccessToken: () => OAuthService_1.oauthService.ensureFreshToken('google_search_console'),
        });
    }
    if (!selection.credentials) {
        throw new Error('Google service account credentials are missing.');
    }
    return new GoogleServiceAccountClient_1.GoogleServiceAccountClient(selection.credentials);
}
/**
 * Create/refresh the synthetic OAuth account (`google-oauth`) in the connector config after a
 * "Sign in with Google". Mirrors `upsertGoogleAccountSummary` but carries no SA project id and marks
 * the account (and, when it is the default, the whole connector) as `authMode: 'oauth'`.
 */
function upsertGoogleOAuthSummary(config, input) {
    const accounts = readGoogleServiceAccounts(config);
    const existing = accounts.find((account) => account.id === GOOGLE_OAUTH_ACCOUNT_ID);
    const timestamp = Date.now();
    const summary = {
        id: GOOGLE_OAUTH_ACCOUNT_ID,
        authMode: 'oauth',
        label: input.email ? `Google (${input.email})` : existing?.label || 'Google account',
        serviceAccountEmail: input.email || existing?.serviceAccountEmail || '',
        googleProjectId: '',
        clientId: '',
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
        lastSyncedAt: existing?.lastSyncedAt ?? null,
        searchConsoleSites: input.searchConsoleSites ?? existing?.searchConsoleSites,
        analyticsProperties: input.analyticsProperties ?? existing?.analyticsProperties,
        searchConsoleError: existing?.searchConsoleError,
        analyticsError: existing?.analyticsError,
    };
    const index = accounts.findIndex((item) => item.id === GOOGLE_OAUTH_ACCOUNT_ID);
    const nextAccounts = index === -1 ? [...accounts, summary] : accounts.map((item) => (item.id === GOOGLE_OAUTH_ACCOUNT_ID ? summary : item));
    const defaultServiceAccountId = readString(config, 'defaultServiceAccountId') || GOOGLE_OAUTH_ACCOUNT_ID;
    return {
        ...config,
        authMode: defaultServiceAccountId === GOOGLE_OAUTH_ACCOUNT_ID ? 'oauth' : readString(config, 'authMode') || 'service_account',
        serviceAccounts: nextAccounts,
        defaultServiceAccountId,
        serviceAccountEmail: summary.serviceAccountEmail || readString(config, 'serviceAccountEmail'),
    };
}
function upsertGoogleAccountSummary(config, account) {
    const accounts = readGoogleServiceAccounts(config);
    const index = accounts.findIndex((item) => item.id === account.id);
    const nextAccounts = index === -1 ? [...accounts, account] : accounts.map((item) => (item.id === account.id ? account : item));
    const defaultServiceAccountId = readString(config, 'defaultServiceAccountId') || account.id;
    const defaultAccount = nextAccounts.find((item) => item.id === defaultServiceAccountId) ?? account;
    return {
        ...config,
        authMode: 'service_account',
        serviceAccounts: nextAccounts,
        defaultServiceAccountId,
        serviceAccountEmail: defaultAccount.serviceAccountEmail,
    };
}
function resolveGoogleSelection(config, store, input) {
    const mappings = readGoogleProjectMappings(config);
    const mapping = input?.productId ? mappings.find((item) => item.productId === input.productId) ?? null : null;
    const hasExplicitPropertyInput = Boolean(input?.propertyUrl?.trim() || input?.ga4Property?.trim());
    const allowGlobalPropertyFallback = !input?.productId ||
        hasExplicitPropertyInput ||
        (!mapping && mappings.length === 0 && AppRepository_1.repository.listProducts(false).length <= 1);
    const requestedAccountId = input?.serviceAccountId?.trim() ||
        mapping?.serviceAccountId ||
        readString(config, 'defaultServiceAccountId') ||
        store.defaultAccountId ||
        '';
    // The OAuth account is synthetic — it never lives in `store.accounts`. Select it when explicitly
    // requested/mapped, or when the connector defaults to OAuth and no usable SA account was named.
    const isOAuthSelection = requestedAccountId === GOOGLE_OAUTH_ACCOUNT_ID ||
        (readString(config, 'authMode') === 'oauth' && (!requestedAccountId || !store.accounts?.[requestedAccountId]));
    const accountId = isOAuthSelection
        ? GOOGLE_OAUTH_ACCOUNT_ID
        : requestedAccountId && store.accounts?.[requestedAccountId]
            ? requestedAccountId
            : Object.keys(store.accounts ?? {})[0] ?? '';
    const credentials = isOAuthSelection ? null : accountId ? store.accounts?.[accountId] ?? null : null;
    const inferredSite = input?.productId && !mapping?.propertyUrl
        ? inferSearchConsoleSiteForProject(input.productId, searchConsoleSitesForAccount(config, accountId))
        : null;
    const inferredAnalyticsProperty = input?.productId && !mapping?.ga4Property
        ? inferAnalyticsPropertyForProject(input.productId, analyticsPropertiesForAccount(config, accountId))
        : null;
    const inferredPropertyUrl = inferredSite?.siteUrl?.trim() ?? '';
    const inferredGa4Property = (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(inferredAnalyticsProperty?.property ?? '');
    const resolvedMapping = input?.productId && (mapping || inferredPropertyUrl || inferredGa4Property)
        ? {
            productId: input.productId,
            serviceAccountId: mapping?.serviceAccountId || accountId,
            propertyUrl: mapping?.propertyUrl || inferredPropertyUrl,
            ga4Property: mapping?.ga4Property || inferredGa4Property,
            updatedAt: mapping?.updatedAt ?? Date.now(),
        }
        : null;
    const inferredMapping = Boolean(input?.productId &&
        resolvedMapping &&
        ((!mapping && (resolvedMapping.propertyUrl || resolvedMapping.ga4Property)) ||
            (!mapping?.propertyUrl && resolvedMapping.propertyUrl) ||
            (!mapping?.ga4Property && resolvedMapping.ga4Property)));
    // When the project has its own mapping, resolve strictly from the explicit request and that mapping.
    // The global `propertyUrl`/`ga4Property` only hold the last-synced project's values, so falling back
    // to them for a mapped project would sync another project's property (e.g. a project with an unset
    // GA4 property would silently pull the previously-synced project's analytics). The global fallback is
    // reserved for legacy single-project setups that never created a mapping.
    return {
        accountId,
        authMode: isOAuthSelection ? 'oauth' : 'service_account',
        credentials,
        mapping: resolvedMapping,
        inferredMapping,
        requiresProjectMapping: Boolean(input?.productId && !hasExplicitPropertyInput && !resolvedMapping && !allowGlobalPropertyFallback),
        propertyUrl: input?.propertyUrl?.trim() || resolvedMapping?.propertyUrl || (allowGlobalPropertyFallback ? readString(config, 'propertyUrl') : ''),
        ga4Property: input?.ga4Property?.trim() || resolvedMapping?.ga4Property || (allowGlobalPropertyFallback ? readString(config, 'ga4Property') : ''),
    };
}
function setGoogleAccountResourceState(config, accountId, patch) {
    const accounts = readGoogleServiceAccounts(config);
    const nextAccounts = accounts.map((account) => account.id === accountId
        ? {
            ...account,
            ...patch,
            updatedAt: Date.now(),
        }
        : account);
    return {
        ...config,
        serviceAccounts: nextAccounts,
    };
}
async function ping(url, timeout = 8000) {
    try {
        await axios_1.default.get(url, { timeout, validateStatus: (status) => status < 500 });
        return true;
    }
    catch {
        return false;
    }
}
function dedupeGoogleIndexUrls(urls) {
    const seen = new Set();
    const deduped = [];
    for (const url of urls) {
        const trimmed = (url ?? '').trim();
        if (!trimmed || seen.has(trimmed))
            continue;
        seen.add(trimmed);
        deduped.push(trimmed);
    }
    return deduped;
}
function normalizeGoogleIndexUrl(rawUrl) {
    try {
        return new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`).toString();
    }
    catch {
        return null;
    }
}
function urlBelongsToGscProperty(rawUrl, property) {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        return false;
    }
    const urlHost = (0, gscProperty_1.hostKeyFromUrl)(parsed.host);
    if (property.type === 'domain') {
        return urlHost === property.host || urlHost.endsWith(`.${property.host}`);
    }
    if (urlHost !== property.host)
        return false;
    return rawUrl.startsWith(property.canonicalUrl);
}
const CHANNEL_HISTORY_KEY = '__history';
// `__history`/`mutedProjectIds` are bookkeeping, not configuration — exclude from status/equality/"is configured".
const CONNECTOR_METADATA_CONFIG_KEYS = new Set(['projectScope', 'projectIds', CHANNEL_HISTORY_KEY, 'mutedProjectIds']);
const CHANNEL_PROFILES_KEY = 'projectProfiles';
const PROFILE_ID_KEY = '__channelProfileId';
const PROFILE_PRODUCT_ID_KEY = '__channelProfileProductId';
const ROOT_PROFILE_ID = 'root';
const CHANNEL_HISTORY_LIMIT = 20;
function readConnectorProjectIds(config) {
    const raw = config?.projectIds;
    return Array.isArray(raw) ? raw.filter((value) => typeof value === 'string' && value.length > 0) : [];
}
function connectorProjectScope(config) {
    const ids = readConnectorProjectIds(config);
    if (config?.projectScope === 'selected')
        return 'selected';
    if (config?.projectScope === 'all')
        return 'all';
    return ids.length > 0 ? 'selected' : 'all';
}
function profileServesProject(profile, productId) {
    return profile.projectScope === 'all' || profile.projectIds.includes(productId);
}
function readConnectorProfiles(config) {
    const raw = config?.[CHANNEL_PROFILES_KEY];
    if (!Array.isArray(raw))
        return [];
    const profiles = [];
    for (const item of raw) {
        if (!isPlainRecord(item))
            continue;
        const id = readString(item, 'id');
        if (!id)
            continue;
        const profileConfig = isPlainRecord(item.config) ? item.config : {};
        const projectScope = item.projectScope === 'all' ? 'all' : 'selected';
        const projectIds = Array.isArray(item.projectIds)
            ? item.projectIds.filter((value) => typeof value === 'string' && value.length > 0)
            : [];
        const createdAt = typeof item.createdAt === 'number' ? item.createdAt : undefined;
        const updatedAt = typeof item.updatedAt === 'number' ? item.updatedAt : undefined;
        profiles.push({ id, config: profileConfig, projectScope, projectIds, createdAt, updatedAt });
    }
    return profiles;
}
function stripProfileControlKeys(config) {
    return Object.fromEntries(Object.entries(config).filter(([key]) => key !== PROFILE_ID_KEY && key !== PROFILE_PRODUCT_ID_KEY && key !== CHANNEL_PROFILES_KEY));
}
function profileSecretStore(secret) {
    const raw = secret?.[CHANNEL_PROFILES_KEY];
    if (!isPlainRecord(raw))
        return {};
    const profiles = {};
    for (const [id, value] of Object.entries(raw)) {
        if (isPlainRecord(value))
            profiles[id] = value;
    }
    return profiles;
}
function resolveConnectorProfile(config, secret, productId) {
    const rootScope = connectorProjectScope(config);
    const rootIds = readConnectorProjectIds(config);
    if (!productId || rootScope === 'all' || rootIds.includes(productId)) {
        return { id: ROOT_PROFILE_ID, isRoot: true, config, secret };
    }
    const profile = readConnectorProfiles(config).find((item) => profileServesProject(item, productId));
    if (!profile)
        return { id: '', isRoot: false, config: {}, secret: null };
    const profileSecrets = profileSecretStore(secret);
    return { id: profile.id, isRoot: false, config: profile.config, secret: profileSecrets[profile.id] ?? null };
}
const CONFIG_FIELD_SKIP_KEYS = new Set([
    'projectScope',
    'projectIds',
    CHANNEL_PROFILES_KEY,
    CHANNEL_HISTORY_KEY,
    PROFILE_ID_KEY,
    PROFILE_PRODUCT_ID_KEY,
]);
/** The real (publishable) config fields of a root/profile config — no mapping or bookkeeping keys. */
function configFieldsOnly(config) {
    return Object.fromEntries(Object.entries(config).filter(([key]) => !CONFIG_FIELD_SKIP_KEYS.has(key)));
}
function sameConfigFields(a, b) {
    return JSON.stringify(sortJsonValue(a)) === JSON.stringify(sortJsonValue(b));
}
function readConnectorHistory(config) {
    const raw = config?.[CHANNEL_HISTORY_KEY];
    if (!Array.isArray(raw))
        return [];
    const entries = [];
    for (const item of raw) {
        if (!isPlainRecord(item))
            continue;
        const id = readString(item, 'id');
        const at = typeof item.at === 'number' ? item.at : 0;
        if (!id)
            continue;
        const replaced = [];
        if (Array.isArray(item.replaced)) {
            for (const r of item.replaced) {
                if (!isPlainRecord(r))
                    continue;
                replaced.push({
                    source: r.source === 'profile' ? 'profile' : 'root',
                    profileId: readString(r, 'profileId'),
                    scope: r.scope === 'all' ? 'all' : 'selected',
                    projectIds: Array.isArray(r.projectIds)
                        ? r.projectIds.filter((v) => typeof v === 'string' && v.length > 0)
                        : [],
                    config: isPlainRecord(r.config) ? r.config : {},
                });
            }
        }
        entries.push({ id, at, action: 'widen-to-all', byProject: readString(item, 'byProject'), replaced });
    }
    return entries;
}
/** Snapshot the per-project configs a widen-to-all is about to replace: the old root (if it differs
 *  from the new shared value) plus every project profile being cleared. */
function collectReplacedConfigs(existingConfig, existingProfiles, newFields) {
    const replaced = [];
    const rootScope = connectorProjectScope(existingConfig);
    const rootIds = readConnectorProjectIds(existingConfig);
    const rootFields = configFieldsOnly(existingConfig);
    if (Object.keys(rootFields).length && !sameConfigFields(rootFields, newFields)) {
        replaced.push({
            source: 'root',
            profileId: ROOT_PROFILE_ID,
            scope: rootScope,
            projectIds: rootScope === 'all' ? [] : rootIds,
            config: rootFields,
        });
    }
    for (const profile of existingProfiles) {
        if (Object.keys(configFieldsOnly(profile.config)).length) {
            replaced.push({
                source: 'profile',
                profileId: profile.id,
                scope: profile.projectScope,
                projectIds: profile.projectIds,
                config: configFieldsOnly(profile.config),
            });
        }
    }
    return replaced;
}
function appendConnectorHistory(existing, entry) {
    const next = {
        id: (0, id_1.createId)(),
        at: Date.now(),
        action: 'widen-to-all',
        byProject: entry.byProject,
        replaced: entry.replaced,
    };
    return [next, ...existing].slice(0, CHANNEL_HISTORY_LIMIT);
}
/**
 * Pure restore: re-create a dedicated profile for `productId` from a history snapshot, and narrow a
 * root 'all' scope so the restored profile can actually win resolution again (root 'all' would
 * otherwise shadow it). Kept pure so it can be unit-tested away from the DB.
 */
function computeRestoreConfig(existingConfig, entry, productId, allProjectIds) {
    const target = entry.replaced.find((r) => r.projectIds.includes(productId)) ??
        entry.replaced.find((r) => r.source === 'root') ??
        entry.replaced[0];
    if (!target)
        return null;
    const now = Date.now();
    const restored = {
        id: (0, id_1.createId)(),
        config: target.config,
        projectScope: 'selected',
        projectIds: [productId],
        createdAt: now,
        updatedAt: now,
    };
    // Replace any profile already dedicated solely to this project; keep the rest.
    const nextProfiles = readConnectorProfiles(existingConfig).filter((profile) => !(profile.projectIds.length === 1 && profile.projectIds[0] === productId));
    nextProfiles.push(restored);
    const nextConfig = { ...existingConfig, [CHANNEL_PROFILES_KEY]: nextProfiles };
    const rootScope = connectorProjectScope(existingConfig);
    if (rootScope === 'all') {
        // Root served everyone (incl. this project). Narrow it to every *other* project so the restored
        // profile is the one that resolves for `productId`.
        nextConfig.projectScope = 'selected';
        nextConfig.projectIds = allProjectIds.filter((id) => id !== productId);
    }
    else {
        nextConfig.projectScope = 'selected';
        nextConfig.projectIds = readConnectorProjectIds(existingConfig).filter((id) => id !== productId);
    }
    return nextConfig;
}
function upsertConnectorProfileConfig(existingConfig, incomingConfig) {
    const profileId = readString(incomingConfig, PROFILE_ID_KEY);
    const productId = readString(incomingConfig, PROFILE_PRODUCT_ID_KEY);
    const cleanConfig = stripProfileControlKeys(incomingConfig);
    const existingProfiles = readConnectorProfiles(existingConfig);
    const existingHistory = readConnectorHistory(existingConfig);
    // "Use everywhere": this config becomes the shared root for EVERY project (present and future).
    // Snapshot the per-project values it replaces so nothing is silently lost, then clear the now-
    // shadowed profiles (a root 'all' scope hides them anyway). See docs/channel_settings_ux.md §4.7.
    // This also fixes the old defect where a non-root profile set to 'all' became a dead catch-all.
    if (cleanConfig.projectScope === 'all') {
        const newFields = configFieldsOnly(cleanConfig);
        const replaced = collectReplacedConfigs(existingConfig, existingProfiles, newFields);
        const nextHistory = replaced.length
            ? appendConnectorHistory(existingHistory, { byProject: productId, replaced })
            : existingHistory;
        const nextConfig = { ...cleanConfig };
        if (nextHistory.length)
            nextConfig[CHANNEL_HISTORY_KEY] = nextHistory;
        return { config: nextConfig, profileId: ROOT_PROFILE_ID };
    }
    if (profileId === ROOT_PROFILE_ID || (!profileId && !productId)) {
        const nextConfig = { ...cleanConfig };
        if (existingProfiles.length)
            nextConfig[CHANNEL_PROFILES_KEY] = existingProfiles;
        if (existingHistory.length)
            nextConfig[CHANNEL_HISTORY_KEY] = existingHistory;
        return { config: nextConfig, profileId: ROOT_PROFILE_ID };
    }
    const now = Date.now();
    const id = profileId || (0, id_1.createId)();
    const explicitIds = readConnectorProjectIds(cleanConfig);
    const projectIds = explicitIds.length ? explicitIds : productId ? [productId] : [];
    const profileConfig = Object.fromEntries(Object.entries(cleanConfig).filter(([key]) => key !== 'projectScope' && key !== 'projectIds'));
    const existing = existingProfiles.find((profile) => profile.id === id);
    const nextProfile = {
        id,
        config: profileConfig,
        projectScope: 'selected',
        projectIds,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    const nextProfiles = existingProfiles.filter((profile) => profile.id !== id);
    nextProfiles.push(nextProfile);
    return { config: { ...existingConfig, [CHANNEL_PROFILES_KEY]: nextProfiles }, profileId: id };
}
function upsertConnectorProfileSecret(currentSecret, profileId, incomingSecret) {
    if (!profileId || profileId === ROOT_PROFILE_ID)
        return { ...(currentSecret ?? {}), ...incomingSecret };
    const profiles = profileSecretStore(currentSecret);
    profiles[profileId] = { ...(profiles[profileId] ?? {}), ...incomingSecret };
    return { ...(currentSecret ?? {}), [CHANNEL_PROFILES_KEY]: profiles };
}
function hasMeaningfulConnectorConfigValue(value) {
    if (typeof value === 'string')
        return value.trim().length > 0;
    if (typeof value === 'number' || typeof value === 'boolean')
        return true;
    if (Array.isArray(value))
        return value.length > 0;
    return !!value && typeof value === 'object' && Object.keys(value).length > 0;
}
function hasMeaningfulConnectorConfig(config) {
    return Object.entries(config).some(([key, value]) => !CONNECTOR_METADATA_CONFIG_KEYS.has(key) && hasMeaningfulConnectorConfigValue(value));
}
function sortJsonValue(value) {
    if (Array.isArray(value))
        return value.map(sortJsonValue);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJsonValue(item)]));
}
function connectorStatusConfig(config) {
    return Object.fromEntries(Object.entries(config).filter(([key]) => !CONNECTOR_METADATA_CONFIG_KEYS.has(key)));
}
function connectorConfigsEqual(left, right) {
    return (JSON.stringify(sortJsonValue(connectorStatusConfig(left))) ===
        JSON.stringify(sortJsonValue(connectorStatusConfig(right))));
}
class ConnectorService {
    listConnectors() {
        return AppRepository_1.repository.listConnectors();
    }
    async getDataForSeoAccountStatus() {
        const secret = await CredentialVault_1.credentialVault.getSecret('dataforseo');
        const credentials = (0, DataForSeoClient_1.normalizeDataForSeoCredentials)(secret);
        if (!credentials) {
            throw new Error('DataForSEO API login and password are required. Add them in Settings > API.');
        }
        const account = await new DataForSeoClient_1.DataForSeoClient({ credentials }).getAccount();
        return normalizeDataForSeoAccountStatus(account);
    }
    async saveConnector(input) {
        const existing = AppRepository_1.repository.getConnector(input.name);
        if (!existing)
            return null;
        let secretToSave = input.secret;
        let nextConfig = input.config ?? existing.config;
        let profileSecretId = null;
        if (input.name === 'dataforseo' && input.secret) {
            secretToSave = (0, DataForSeoClient_1.normalizeDataForSeoCredentials)(input.secret) ?? input.secret;
        }
        if (input.name === 'google_search_console' && input.secret) {
            const credentials = (0, GoogleServiceAccountClient_1.normalizeGoogleServiceAccountCredentials)(input.secret);
            if (!credentials) {
                throw new Error('Paste a valid Google service account JSON key.');
            }
            const currentSecret = await CredentialVault_1.credentialVault.getSecret(input.name);
            const store = normalizeGoogleSecretStore(currentSecret, existing.config);
            const currentAccounts = readGoogleServiceAccounts(existing.config);
            const requestedAccountId = readString(input.secret, 'accountId');
            const accountId = requestedAccountId ||
                currentAccounts.find((account) => account.serviceAccountEmail === credentials.client_email)?.id ||
                (0, id_1.createId)();
            const existingAccount = currentAccounts.find((account) => account.id === accountId);
            const label = readString(input.secret, 'label');
            store.accounts = {
                ...(store.accounts ?? {}),
                [accountId]: credentials,
            };
            store.defaultAccountId = readString(nextConfig, 'defaultServiceAccountId') || store.defaultAccountId || accountId;
            // Preserve any OAuth tokens written by OAuthService under `oauth` — rebuilding the store from
            // the SA credentials must not drop the "Sign in with Google" session (the two coexist).
            if (currentSecret && typeof currentSecret.oauth === 'object' && currentSecret.oauth) {
                store.oauth = currentSecret.oauth;
            }
            secretToSave = store;
            nextConfig = upsertGoogleAccountSummary(nextConfig, accountSummaryFromCredentials(accountId, credentials, existingAccount, label));
            nextConfig.defaultServiceAccountId = readString(nextConfig, 'defaultServiceAccountId') || accountId;
        }
        const profileSave = input.config &&
            input.name !== 'google_search_console' &&
            input.name !== 'dataforseo' &&
            (PROFILE_ID_KEY in input.config || PROFILE_PRODUCT_ID_KEY in input.config);
        if (profileSave && input.config) {
            const result = upsertConnectorProfileConfig(existing.config, input.config);
            nextConfig = result.config;
            profileSecretId = result.profileId;
        }
        // A re-save sends only the fields the user re-typed this session (the modal omits blank
        // "leave blank to keep" fields). Merge them onto the existing stored secret so untouched
        // fields survive — e.g. the Bluesky handle when only the app password is changed, or the
        // OAuth tokens written separately by OAuthService under `oauth`. Without this, setSecret
        // replaces the secret wholesale and silently drops everything not in this payload.
        // google_search_console / dataforseo rebuild their full secret above, so skip the merge.
        if (secretToSave &&
            typeof secretToSave === 'object' &&
            input.name !== 'google_search_console' &&
            input.name !== 'dataforseo') {
            const currentSecret = await CredentialVault_1.credentialVault.getSecret(input.name);
            if (profileSecretId) {
                secretToSave = upsertConnectorProfileSecret(currentSecret, profileSecretId, secretToSave);
            }
            else if (currentSecret) {
                secretToSave = { ...currentSecret, ...secretToSave };
            }
        }
        if (secretToSave) {
            await CredentialVault_1.credentialVault.setSecret(input.name, secretToSave);
        }
        if (input.secret === null) {
            await CredentialVault_1.credentialVault.removeSecret(input.name);
        }
        const hasSecret = await CredentialVault_1.credentialVault.hasSecret(input.name);
        const configChanged = !connectorConfigsEqual(existing.config, nextConfig);
        const secretChanged = secretToSave !== undefined;
        const hasConfiguration = hasSecret || hasMeaningfulConnectorConfig(nextConfig);
        const shouldPreserveStatus = hasConfiguration && existing.status !== 'not_configured' && !configChanged && !secretChanged;
        const status = shouldPreserveStatus
            ? existing.status
            : hasConfiguration
                ? 'attention'
                : 'not_configured';
        return AppRepository_1.repository.updateConnector({
            name: input.name,
            enabled: input.enabled ?? existing.enabled,
            config: nextConfig,
            hasSecret,
            status,
            lastError: shouldPreserveStatus ? existing.lastError : null,
            lastTestedAt: existing.lastTestedAt,
        });
    }
    /**
     * Permanently remove a saved Google service account: prune its key from the credential vault (so a
     * revoked/rotated key does not linger locally), drop it from `config.serviceAccounts`, and repoint
     * anything that referenced it — the connector default account and every project mapping — to the
     * next available account so nothing silently falls back to a stale id. The synthetic `google-oauth`
     * sign-in is not a service account and is rejected. Returns the updated connector plus how many
     * project mappings were repointed, so the UI can confirm the impact.
     */
    async deleteGoogleServiceAccount(accountId) {
        const id = (accountId ?? '').trim();
        if (!id || id === GOOGLE_OAUTH_ACCOUNT_ID) {
            throw new Error('That account cannot be removed here.');
        }
        const existing = AppRepository_1.repository.getConnector('google_search_console');
        if (!existing)
            return { connector: null, unlinkedProjects: 0 };
        // 1) Prune the private key from the vault while preserving other accounts + any OAuth session.
        const currentSecret = await CredentialVault_1.credentialVault.getSecret('google_search_console');
        const store = normalizeGoogleSecretStore(currentSecret, existing.config);
        if (store.accounts)
            delete store.accounts[id];
        if (currentSecret && typeof currentSecret.oauth === 'object' && currentSecret.oauth) {
            store.oauth = currentSecret.oauth;
        }
        const remainingAccounts = readGoogleServiceAccounts(existing.config).filter((account) => account.id !== id);
        // Pick the replacement default: keep the current one unless it was the removed account, then
        // prefer the OAuth sign-in, else the first remaining account, else none.
        const currentDefault = readString(existing.config, 'defaultServiceAccountId') || store.defaultAccountId || '';
        const nextDefaultId = currentDefault && currentDefault !== id
            ? currentDefault
            : remainingAccounts.find((account) => account.id === GOOGLE_OAUTH_ACCOUNT_ID)?.id ??
                remainingAccounts[0]?.id ??
                '';
        store.defaultAccountId = nextDefaultId || undefined;
        await CredentialVault_1.credentialVault.setSecret('google_search_console', store);
        // 2) Rebuild config: drop the account, repoint default + mappings, refresh authMode.
        const nextConfig = { ...existing.config, serviceAccounts: remainingAccounts };
        nextConfig.defaultServiceAccountId = nextDefaultId;
        let unlinkedProjects = 0;
        nextConfig.projectMappings = readGoogleProjectMappings(existing.config).map((mapping) => {
            if (mapping.serviceAccountId !== id)
                return mapping;
            unlinkedProjects += 1;
            return { ...mapping, serviceAccountId: nextDefaultId, updatedAt: Date.now() };
        });
        const nextDefaultAccount = remainingAccounts.find((account) => account.id === nextDefaultId) ?? null;
        nextConfig.authMode =
            nextDefaultAccount?.authMode === 'oauth' || nextDefaultId === GOOGLE_OAUTH_ACCOUNT_ID
                ? 'oauth'
                : 'service_account';
        // Clear connector-level error state that belonged to the removed account.
        if (readString(nextConfig, 'activeServiceAccountId') === id) {
            delete nextConfig.activeServiceAccountId;
        }
        const hasSecret = await CredentialVault_1.credentialVault.hasSecret('google_search_console');
        const connector = AppRepository_1.repository.updateConnector({
            name: 'google_search_console',
            config: nextConfig,
            hasSecret,
            lastError: null,
        });
        return { connector, unlinkedProjects };
    }
    /**
     * Undo a "use everywhere" overwrite for one project by re-creating its dedicated profile from a
     * saved history snapshot (docs/channel_settings_ux.md §4.7). Narrows a root 'all' scope so the
     * restored value can resolve again. The history entry is kept so other projects can also restore.
     */
    restoreConnectorProfile(name, entryId, productId) {
        const existing = AppRepository_1.repository.getConnector(name);
        if (!existing)
            return null;
        const entry = readConnectorHistory(existing.config).find((item) => item.id === entryId);
        if (!entry || !productId)
            return existing;
        const allProjectIds = AppRepository_1.repository.listProducts().map((product) => product.id);
        const nextConfig = computeRestoreConfig(existing.config, entry, productId, allProjectIds);
        if (!nextConfig)
            return existing;
        return AppRepository_1.repository.updateConnector({ name, config: nextConfig });
    }
    /**
     * Add or remove a single project from a channel's mapping without opening the full editor — backs
     * the "Used by" popover and the project×channel matrix (docs/channel_settings_ux.md §4.4/§4.3).
     * "Add" shares the root config. "Remove" drops the project from the root scope (narrowing a root
     * 'all' to every *other* project) and from any profile serving it (deleting a profile left empty).
     * Non-destructive to stored config values; never touches secrets.
     */
    setConnectorProjectMapping(name, productId, assigned) {
        const existing = AppRepository_1.repository.getConnector(name);
        if (!existing || !productId)
            return existing ?? null;
        const config = existing.config;
        const scope = connectorProjectScope(config);
        const rootIds = readConnectorProjectIds(config);
        const nextConfig = { ...config };
        if (assigned) {
            if (scope === 'all' || rootIds.includes(productId))
                return existing; // already served by root
            nextConfig.projectScope = 'selected';
            nextConfig.projectIds = [...rootIds, productId];
        }
        else {
            if (scope === 'all') {
                // Root served everyone — narrow it to every other project so this one stops being served.
                const allIds = AppRepository_1.repository.listProducts().map((product) => product.id);
                nextConfig.projectScope = 'selected';
                nextConfig.projectIds = allIds.filter((id) => id !== productId);
            }
            else if (rootIds.includes(productId)) {
                nextConfig.projectScope = 'selected';
                nextConfig.projectIds = rootIds.filter((id) => id !== productId);
            }
            const profiles = readConnectorProfiles(config)
                .map((profile) => ({ ...profile, projectIds: profile.projectIds.filter((id) => id !== productId) }))
                .filter((profile) => profile.projectScope === 'all' || profile.projectIds.length > 0);
            if (profiles.length)
                nextConfig[CHANNEL_PROFILES_KEY] = profiles;
            else
                delete nextConfig[CHANNEL_PROFILES_KEY];
        }
        return AppRepository_1.repository.updateConnector({ name, config: nextConfig });
    }
    /**
     * Pause/resume a channel for one project without unmapping it or disabling it globally (Phase 4).
     * Muted projects stay configured but are skipped at publish time (PublisherService enforces it).
     */
    setConnectorProjectMuted(name, productId, muted) {
        const existing = AppRepository_1.repository.getConnector(name);
        if (!existing || !productId)
            return existing ?? null;
        const current = Array.isArray(existing.config.mutedProjectIds)
            ? existing.config.mutedProjectIds.filter((value) => typeof value === 'string' && value.length > 0)
            : [];
        const set = new Set(current);
        if (muted)
            set.add(productId);
        else
            set.delete(productId);
        const next = Array.from(set);
        const nextConfig = { ...existing.config };
        if (next.length)
            nextConfig.mutedProjectIds = next;
        else
            delete nextConfig.mutedProjectIds;
        return AppRepository_1.repository.updateConnector({ name, config: nextConfig });
    }
    /**
     * Quick Facebook project→Page assignment for the matrix/popover (§4.5): 'default' clears the
     * per-project mapping so it inherits the default Page; 'skip' stops the project posting to
     * Facebook. Choosing specific Pages still happens in the full editor.
     */
    setConnectorFacebookMapping(name, productId, mode) {
        const existing = AppRepository_1.repository.getConnector(name);
        if (!existing || !productId)
            return existing ?? null;
        const config = existing.config;
        const pageMap = config.pageMap && typeof config.pageMap === 'object' && !Array.isArray(config.pageMap)
            ? { ...config.pageMap }
            : {};
        if (mode === 'skip')
            pageMap[productId] = [];
        else
            delete pageMap[productId]; // inherit the default Page
        return AppRepository_1.repository.updateConnector({ name, config: { ...config, pageMap } });
    }
    /**
     * Merge Search Console / GA4 property mappings into the google connector config.
     * Used when importing GSC sites as projects so each new project is immediately
     * wired to its GSC property (GA4 left blank for the user to fill later).
     */
    addGoogleProjectMappings(mappings) {
        const existing = AppRepository_1.repository.getConnector('google_search_console');
        if (!existing || mappings.length === 0)
            return existing;
        const byProduct = new Map(readGoogleProjectMappings(existing.config).map((mapping) => [mapping.productId, mapping]));
        for (const mapping of mappings) {
            if (!mapping.productId)
                continue;
            byProduct.set(mapping.productId, {
                productId: mapping.productId,
                serviceAccountId: mapping.serviceAccountId,
                propertyUrl: mapping.propertyUrl,
                ga4Property: mapping.ga4Property ?? '',
                updatedAt: Date.now(),
            });
        }
        const nextConfig = {
            ...existing.config,
            projectMappings: Array.from(byProduct.values()),
        };
        const defaultAccountId = mappings.find((mapping) => mapping.serviceAccountId)?.serviceAccountId;
        if (defaultAccountId && !readString(nextConfig, 'defaultServiceAccountId')) {
            nextConfig.defaultServiceAccountId = defaultAccountId;
        }
        return AppRepository_1.repository.updateConnector({ name: 'google_search_console', config: nextConfig });
    }
    /**
     * Read-only view of the Search Console / GA4 property mappings, so the unified
     * dashboard can tell which projects are wired to a Google property (and therefore
     * eligible for a performance sync) without touching the secret store.
     */
    listProjectMappings() {
        const connector = AppRepository_1.repository.getConnector('google_search_console');
        if (!connector)
            return [];
        return readGoogleProjectMappings(connector.config).map((mapping) => ({
            productId: mapping.productId,
            serviceAccountId: mapping.serviceAccountId,
            propertyUrl: mapping.propertyUrl,
            ga4Property: mapping.ga4Property,
        }));
    }
    /**
     * Fetch a single site's GSC + GA4 performance reports for the given range, resolving
     * credentials from the project mapping. Unlike `testConnector`, this does NOT mutate the
     * connector config — the unified dashboard owns its own per-site cache. Returns nulls for
     * properties that are unmapped or that error, with the failures collected in `errors`.
     */
    async fetchSitePerformance(input) {
        const name = 'google_search_console';
        const connector = AppRepository_1.repository.getConnector(name);
        if (!connector) {
            return { propertyUrl: '', ga4Property: '', search: null, analytics: null, errors: ['Google connector not found.'] };
        }
        const secret = await CredentialVault_1.credentialVault.getSecret(name);
        const store = normalizeGoogleSecretStore(secret, connector.config);
        const selection = resolveGoogleSelection(connector.config, store, {
            productId: input.productId,
            serviceAccountId: input.serviceAccountId,
            propertyUrl: input.propertyUrl,
            ga4Property: input.ga4Property,
        });
        if (selection.authMode !== 'oauth' && !selection.credentials) {
            return {
                propertyUrl: selection.propertyUrl,
                ga4Property: selection.ga4Property,
                search: null,
                analytics: null,
                errors: ['Google service account JSON key is missing.'],
            };
        }
        const client = buildGoogleClient(selection);
        const errors = [];
        let search = null;
        let analytics = null;
        if (selection.propertyUrl) {
            try {
                search = await client.querySearchConsolePerformanceReport(selection.propertyUrl, input.range);
            }
            catch (error) {
                errors.push(`GSC: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`);
            }
        }
        if (selection.ga4Property) {
            try {
                analytics = await client.queryAnalyticsReport((0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(selection.ga4Property), input.range);
            }
            catch (error) {
                errors.push(`GA4: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`);
            }
        }
        return { propertyUrl: selection.propertyUrl, ga4Property: selection.ga4Property, search, analytics, errors };
    }
    /**
     * Persist reports fetched by the workspace dashboard into the connector-level caches used by the
     * Performance views. This keeps "sync all sites" and per-project Performance screens on one
     * canonical Google data source instead of requiring a second connector test/sync.
     */
    persistGooglePerformanceReports(input) {
        const connector = AppRepository_1.repository.getConnector('google_search_console');
        if (!connector)
            return null;
        const range = resolvePerformanceRangeInput(input.range);
        const propertyUrl = input.search?.siteUrl ?? input.propertyUrl.trim();
        const ga4Property = (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(input.analytics?.property ?? input.ga4Property);
        let nextConfig = {
            ...connector.config,
            lastSyncedProductId: input.productId ?? null,
            lastResourceSyncAt: Date.now(),
            performanceDateRangeDays: range.days,
            performanceDateRange: performanceRangeInputConfig(input.range),
            propertyUrl,
            ga4Property,
        };
        if (input.productId && (propertyUrl || ga4Property)) {
            nextConfig = upsertGoogleProjectMapping(nextConfig, {
                productId: input.productId,
                serviceAccountId: input.serviceAccountId ?? readString(nextConfig, 'defaultServiceAccountId'),
                propertyUrl,
                ga4Property,
                updatedAt: Date.now(),
            });
        }
        if (input.search) {
            const preview = searchPreviewFromReport(input.search);
            nextConfig.searchConsolePreview = preview;
            nextConfig.searchPerformanceReport = input.search;
            nextConfig = upsertRangeCache(nextConfig, 'searchConsolePreviewsByRange', input.search.rangeKey, preview, {
                key: 'siteUrl',
                value: input.search.siteUrl,
            });
            nextConfig = upsertRangeCache(nextConfig, 'searchPerformanceReportsByRange', input.search.rangeKey, input.search, {
                key: 'siteUrl',
                value: input.search.siteUrl,
            });
            nextConfig = removeRangeCacheEntry(nextConfig, 'searchConsoleErrorsByRange', input.search.rangeKey, {
                key: 'siteUrl',
                value: input.search.siteUrl,
            });
            delete nextConfig.searchConsoleError;
        }
        else {
            const searchError = input.errors?.find((message) => message.startsWith('GSC:'));
            if (searchError) {
                const message = searchError.replace(/^GSC:\s*/, '');
                nextConfig.searchConsoleError = message;
                if (propertyUrl) {
                    nextConfig = upsertRangeCache(nextConfig, 'searchConsoleErrorsByRange', range.rangeKey, {
                        siteUrl: propertyUrl,
                        rangeKey: range.rangeKey,
                        message,
                    }, {
                        key: 'siteUrl',
                        value: propertyUrl,
                    });
                }
            }
        }
        if (input.analytics) {
            const preview = analyticsPreviewFromReport(input.analytics);
            nextConfig.analyticsPreview = preview;
            nextConfig.analyticsReport = input.analytics;
            nextConfig = upsertRangeCache(nextConfig, 'analyticsPreviewsByRange', input.analytics.rangeKey, preview, {
                key: 'property',
                value: input.analytics.property,
            });
            nextConfig = upsertRangeCache(nextConfig, 'analyticsReportsByRange', input.analytics.rangeKey, input.analytics, {
                key: 'property',
                value: input.analytics.property,
            });
            nextConfig = removeRangeCacheEntry(nextConfig, 'analyticsErrorsByRange', input.analytics.rangeKey, {
                key: 'property',
                value: input.analytics.property,
            });
            delete nextConfig.analyticsError;
        }
        else {
            const analyticsError = input.errors?.find((message) => message.startsWith('GA4:'));
            if (analyticsError) {
                const message = analyticsError.replace(/^GA4:\s*/, '');
                nextConfig.analyticsError = message;
                if (ga4Property) {
                    nextConfig = upsertRangeCache(nextConfig, 'analyticsErrorsByRange', range.rangeKey, {
                        property: ga4Property,
                        rangeKey: range.rangeKey,
                        message,
                    }, {
                        key: 'property',
                        value: ga4Property,
                    });
                }
            }
        }
        return AppRepository_1.repository.updateConnector({
            name: 'google_search_console',
            config: nextConfig,
            status: input.search || input.analytics ? 'connected' : connector.status,
            lastTestedAt: Date.now(),
            lastError: input.search || input.analytics ? null : connector.lastError,
        });
    }
    /**
     * Fetch the Search Console "Insights" report (headline trends + top/trending content) for the
     * project's mapped property over the given range. Like `fetchSitePerformance`, this resolves
     * credentials from the project mapping and does NOT mutate the connector config — the view owns
     * its own state. Returns a null report with an `error` when unmapped or on failure.
     */
    async fetchSearchInsights(input) {
        const name = 'google_search_console';
        const connector = AppRepository_1.repository.getConnector(name);
        if (!connector) {
            return { propertyUrl: '', report: null, error: 'Google connector not found.' };
        }
        const secret = await CredentialVault_1.credentialVault.getSecret(name);
        const store = normalizeGoogleSecretStore(secret, connector.config);
        const selection = resolveGoogleSelection(connector.config, store, {
            productId: input.productId,
            serviceAccountId: input.serviceAccountId,
            propertyUrl: input.propertyUrl,
        });
        if (selection.authMode !== 'oauth' && !selection.credentials) {
            return { propertyUrl: selection.propertyUrl, report: null, error: 'Google service account JSON key is missing.' };
        }
        if (!selection.propertyUrl) {
            return {
                propertyUrl: '',
                report: null,
                error: 'No Search Console property is mapped for this project. Choose one in Google data setup.',
            };
        }
        const client = buildGoogleClient(selection);
        try {
            const report = await client.querySearchConsoleInsights(selection.propertyUrl, input.range);
            return { propertyUrl: selection.propertyUrl, report, error: null };
        }
        catch (error) {
            return { propertyUrl: selection.propertyUrl, report: null, error: (0, GoogleServiceAccountClient_1.formatGoogleApiError)(error) };
        }
    }
    /**
     * Run a PageSpeed Insights check and, when a project is given, persist the result into the
     * `pagespeed` connector config: the latest report per project (so it survives reloads) plus a
     * capped history of past runs (so the view can chart score trends).
     */
    async runPageSpeed(input) {
        const secret = await CredentialVault_1.credentialVault.getSecret('pagespeed');
        const apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey.trim() : undefined;
        const report = await PageSpeedService_1.pageSpeedService.run(input.url, input.strategy ?? 'mobile', apiKey || undefined);
        if (input.productId) {
            this.persistPageSpeedReport(input.productId, report);
        }
        return report;
    }
    persistPageSpeedReport(productId, report) {
        const connector = AppRepository_1.repository.getConnector('pagespeed');
        if (!connector)
            return;
        const config = { ...connector.config };
        // Keep the latest report per strategy so the Mobile/Desktop toggle each show their own run.
        const latest = isPlainRecord(config.latestByProject) ? { ...config.latestByProject } : {};
        const byStrategy = isPlainRecord(latest[productId]) ? { ...latest[productId] } : {};
        byStrategy[report.strategy] = report;
        latest[productId] = byStrategy;
        const history = isPlainRecord(config.historyByProject) ? { ...config.historyByProject } : {};
        const prior = Array.isArray(history[productId]) ? history[productId] : [];
        const entry = {
            checkedAt: report.checkedAt,
            strategy: report.strategy,
            url: report.url,
            performanceScore: report.performanceScore,
            seoScore: report.seoScore,
            accessibilityScore: report.accessibilityScore,
            bestPracticesScore: report.bestPracticesScore,
        };
        history[productId] = [entry, ...prior].slice(0, PAGE_SPEED_HISTORY_LIMIT);
        config.latestByProject = latest;
        config.historyByProject = history;
        AppRepository_1.repository.updateConnector({ name: 'pagespeed', config });
    }
    async toggleConnector(name, enabled) {
        const existing = AppRepository_1.repository.getConnector(name);
        if (!existing)
            return null;
        return AppRepository_1.repository.updateConnector({ name, enabled });
    }
    async getSecretStatus(name) {
        const hasSecret = await CredentialVault_1.credentialVault.hasSecret(name);
        const existing = AppRepository_1.repository.getConnector(name);
        if (existing && existing.hasSecret !== hasSecret) {
            AppRepository_1.repository.updateConnector({ name, hasSecret });
        }
        return { hasSecret };
    }
    async getSecret(name, productId) {
        const secret = await CredentialVault_1.credentialVault.getSecret(name);
        if (!productId)
            return secret;
        const connector = AppRepository_1.repository.getConnector(name);
        if (!connector)
            return secret;
        return resolveConnectorProfile(connector.config, secret, productId).secret;
    }
    /** Main-process-only resolved project profile for publishers and read-side analytics adapters. */
    async getConnectionProfile(name, productId) {
        const connector = AppRepository_1.repository.getConnector(name);
        if (!connector)
            return { config: {}, secret: null };
        const secret = await CredentialVault_1.credentialVault.getSecret(name);
        const resolved = resolveConnectorProfile(connector.config, secret, productId);
        return { config: resolved.config, secret: resolved.secret };
    }
    /**
     * Scalar secret field values for the channel config UI to preview (masked first/last chars)
     * and reveal on demand. Excludes the `oauth` token blob (managed by OAuthService, never
     * user-edited) and any non-scalar values, so refresh tokens never reach the renderer.
     */
    async getSecretValues(name, productId) {
        const baseSecret = await CredentialVault_1.credentialVault.getSecret(name);
        const connector = productId ? AppRepository_1.repository.getConnector(name) : null;
        const secret = connector ? resolveConnectorProfile(connector.config, baseSecret, productId).secret : baseSecret;
        if (!secret)
            return {};
        const values = {};
        for (const [key, value] of Object.entries(secret)) {
            if (key === 'oauth')
                continue;
            if (typeof value === 'string')
                values[key] = value;
            else if (typeof value === 'number' || typeof value === 'boolean')
                values[key] = String(value);
        }
        return values;
    }
    /**
     * List the Pages the connected account can post to (id + name) — drives the Facebook project→Page
     * mapping UI. Requires a live OAuth token; only Facebook exposes a Page list today.
     */
    async listPages(name) {
        if (name !== 'facebook')
            return [];
        const accessToken = await OAuthService_1.oauthService.ensureFreshToken('facebook');
        const { data } = await axios_1.default.get('https://graph.facebook.com/v23.0/me/accounts', {
            params: { access_token: accessToken, fields: 'id,name' },
            timeout: 10000,
        });
        const pages = data?.data ?? [];
        return pages
            .filter((page) => typeof page.id === 'string')
            .map((page) => ({ id: page.id, name: typeof page.name === 'string' ? page.name : page.id }));
    }
    async testConnector(name, input) {
        const connector = AppRepository_1.repository.getConnector(name);
        if (!connector) {
            AppRepository_1.repository.createDistributionEvent({
                connectorName: name,
                eventType: 'test_connection',
                status: 'failed',
                message: 'Connector not found',
                error: 'Connector not found',
            });
            return {
                ok: false,
                status: 'error',
                message: 'Connector not found',
            };
        }
        const baseSecret = await CredentialVault_1.credentialVault.getSecret(name);
        const resolvedProfile = resolveConnectorProfile(connector.config, baseSecret, input?.productId);
        const secret = resolvedProfile.secret;
        const config = resolvedProfile.config;
        const fail = async (message) => {
            AppRepository_1.repository.updateConnector({
                name,
                status: 'error',
                lastError: message,
                lastTestedAt: Date.now(),
            });
            AppRepository_1.repository.createDistributionEvent({
                productId: input?.productId ?? null,
                connectorName: name,
                eventType: 'test_connection',
                status: 'failed',
                message,
                error: message,
                metadata: { connectorStatus: 'error' },
            });
            return { ok: false, status: 'error', message };
        };
        const success = async (message, configUpdate) => {
            AppRepository_1.repository.updateConnector({
                name,
                status: 'connected',
                config: configUpdate,
                lastError: null,
                lastTestedAt: Date.now(),
            });
            AppRepository_1.repository.createDistributionEvent({
                productId: input?.productId ?? null,
                connectorName: name,
                eventType: 'test_connection',
                status: 'success',
                message,
                metadata: { connectorStatus: 'connected' },
            });
            return { ok: true, status: 'connected', message };
        };
        const attention = async (message, configUpdate) => {
            AppRepository_1.repository.updateConnector({
                name,
                status: 'attention',
                config: configUpdate,
                lastError: message,
                lastTestedAt: Date.now(),
            });
            AppRepository_1.repository.createDistributionEvent({
                productId: input?.productId ?? null,
                connectorName: name,
                eventType: 'test_connection',
                status: 'failed',
                message,
                error: message,
                metadata: { connectorStatus: 'attention' },
            });
            return { ok: false, status: 'attention', message };
        };
        if (name === 'pagespeed') {
            return success('PageSpeed Insights is available without credentials.');
        }
        if (name === 'openai') {
            const apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey : null;
            if (!apiKey)
                return fail('OpenAI API key is missing.');
            try {
                await axios_1.default.get('https://api.openai.com/v1/models', {
                    headers: { Authorization: `Bearer ${apiKey}` },
                    timeout: 10000,
                });
                return success('OpenAI credentials are valid.');
            }
            catch (error) {
                return fail(`OpenAI validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'claude') {
            const apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey : null;
            if (!apiKey)
                return fail('Anthropic API key is missing.');
            try {
                await axios_1.default.post('https://api.anthropic.com/v1/messages', {
                    model: 'claude-3-5-haiku-latest',
                    max_tokens: 16,
                    messages: [{ role: 'user', content: 'Say ok' }],
                }, {
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json',
                    },
                    timeout: 12000,
                });
                return success('Anthropic credentials are valid.');
            }
            catch (error) {
                return fail(`Anthropic validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'telegram') {
            const token = typeof secret?.botToken === 'string' ? secret.botToken : null;
            if (!token)
                return fail('Telegram bot token is missing.');
            const ok = await ping(`https://api.telegram.org/bot${token}/getMe`);
            return ok ? success('Telegram bot token is valid.') : fail('Telegram bot token test failed.');
        }
        if (name === 'twitter') {
            const apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey : null;
            const apiSecret = typeof secret?.apiSecret === 'string' ? secret.apiSecret : null;
            const accessToken = typeof secret?.accessToken === 'string' ? secret.accessToken : null;
            const accessTokenSecret = typeof secret?.accessTokenSecret === 'string' ? secret.accessTokenSecret : null;
            if (!apiKey || !apiSecret || !accessToken || !accessTokenSecret) {
                return fail('X API keys are incomplete (need API key/secret + access token/secret).');
            }
            try {
                const url = 'https://api.twitter.com/2/users/me';
                const { data } = await axios_1.default.get(url, {
                    headers: { Authorization: (0, registry_1.oauth1Header)('GET', url, { apiKey, apiSecret, accessToken, accessTokenSecret }) },
                    timeout: 10000,
                });
                const username = data?.data?.username;
                return success(`X connected as @${username ?? 'user'}.`);
            }
            catch (error) {
                return fail(`X validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'slack') {
            // Slack incoming webhooks only accept POST and any POST posts a real message, so we can't
            // round-trip without spamming the channel — config presence is the best non-destructive check.
            const webhookUrl = typeof config.webhookUrl === 'string' ? config.webhookUrl : null;
            if (!webhookUrl)
                return fail('Slack webhook URL is missing.');
            return success('Slack webhook configuration looks valid.');
        }
        if (name === 'custom_api') {
            // Config-only validation (a real POST would publish): endpoint must be present and the
            // headers + body template must render to a valid request with sample data. Catching a broken
            // JSON template here is genuinely useful — it's the most common Custom API mistake.
            const endpoint = typeof config.endpointUrl === 'string' ? config.endpointUrl.trim() : '';
            if (!endpoint)
                return fail('Custom API endpoint URL is required.');
            if (!/^https?:\/\//i.test(endpoint))
                return fail('Endpoint URL must start with http:// or https://.');
            const token = typeof secret?.secret === 'string' ? secret.secret : '';
            try {
                const values = (0, customApiTemplate_1.sampleTemplateValues)(token, new Date().toISOString());
                const request = (0, customApiTemplate_1.renderRequest)({
                    method: typeof config.method === 'string' ? config.method : null,
                    headersTemplate: typeof config.headersTemplate === 'string' ? config.headersTemplate : null,
                    bodyTemplate: typeof config.bodyTemplate === 'string' ? config.bodyTemplate : null,
                }, values);
                return success(`Template valid — ${request.method} to ${endpoint} is ready. A real request is sent on publish.`);
            }
            catch (error) {
                return fail(error instanceof Error ? error.message : 'Template validation failed.');
            }
        }
        if (name === 'discord') {
            // A GET on the webhook URL returns the webhook object (no message posted) and 401/404s when
            // the URL is revoked or malformed — a real validation, unlike Slack's POST-only webhooks.
            const webhookUrl = assertConfigValue(config, 'webhookUrl');
            if (!webhookUrl)
                return fail('Discord webhook URL is missing.');
            try {
                const { data } = await axios_1.default.get(webhookUrl, { timeout: 10000 });
                const hookName = data?.name;
                return success(`Discord webhook valid${hookName ? ` (${hookName})` : ''}.`);
            }
            catch (error) {
                return fail(`Discord webhook validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'mastodon') {
            const instance = assertConfigValue(config, 'instanceUrl');
            const token = typeof secret?.accessToken === 'string' ? secret.accessToken : null;
            if (!instance)
                return fail('Mastodon instance URL is missing.');
            if (!token)
                return fail('Mastodon access token is missing.');
            try {
                const { data } = await axios_1.default.get(`${instance.replace(/\/$/, '')}/api/v1/accounts/verify_credentials`, {
                    headers: { Authorization: `Bearer ${token}` },
                    timeout: 10000,
                });
                const username = data?.username;
                return success(`Mastodon connected as @${username ?? 'user'}.`);
            }
            catch (error) {
                return fail(`Mastodon validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'bluesky') {
            // Real createSession round-trip — the same call publish() makes, so a bad handle/app password
            // is caught here at Test time instead of slipping through to first publish.
            const service = (assertConfigValue(config, 'service') ?? 'https://bsky.social').replace(/\/$/, '');
            const identifier = typeof secret?.identifier === 'string' ? secret.identifier : null;
            const password = typeof secret?.appPassword === 'string' ? secret.appPassword : null;
            if (!identifier || !password)
                return fail('Bluesky handle and app password are required.');
            try {
                const { data } = await axios_1.default.post(`${service}/xrpc/com.atproto.server.createSession`, { identifier, password }, { timeout: 10000 });
                const handle = data?.handle;
                return success(`Bluesky connected as @${handle ?? identifier}.`);
            }
            catch (error) {
                return fail(`Bluesky validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'ghost') {
            const siteUrl = assertConfigValue(config, 'siteUrl');
            if (!siteUrl)
                return fail('Ghost site URL is required.');
            const ok = await ping(`${siteUrl.replace(/\/$/, '')}/ghost/api/content/posts/`);
            return ok ? success('Ghost endpoint reachable.') : fail('Ghost endpoint did not respond.');
        }
        if (name === 'wordpress') {
            const siteUrl = assertConfigValue(config, 'siteUrl');
            if (!siteUrl)
                return fail('WordPress site URL is required.');
            const ok = await ping(`${siteUrl.replace(/\/$/, '')}/wp-json`);
            return ok ? success('WordPress REST API reachable.') : fail('WordPress API endpoint not reachable.');
        }
        if (name === 'devto') {
            const apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey : null;
            if (!apiKey)
                return fail('Dev.to API key is missing.');
            try {
                const { data } = await axios_1.default.get('https://dev.to/api/users/me', {
                    headers: { 'api-key': apiKey },
                    timeout: 10000,
                });
                const username = data?.username;
                return success(`Dev.to connected as @${username ?? 'user'}.`);
            }
            catch (error) {
                return fail(`Dev.to validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'hashnode') {
            const token = typeof secret?.apiKey === 'string' ? secret.apiKey : null;
            if (!token)
                return fail('Hashnode Personal Access Token is missing.');
            // Hashnode retired free GraphQL API access on 2026-05-13 — every query/mutation now needs a
            // Pro plan, and gql.hashnode.com 301-redirects non-Pro publications to an announcement page.
            const proRequired = 'Hashnode retired its free GraphQL API on May 13, 2026 — the API now requires a Pro plan on ' +
                'your publication (dashboard → Billing → Upgrade to Pro).';
            try {
                const res = await axios_1.default.post('https://gql.hashnode.com/', { query: 'query { me { username } }' }, {
                    headers: { Authorization: token, 'Content-Type': 'application/json' },
                    timeout: 10000,
                    // Don't follow the deprecation 301 to a 200 HTML page (which has no errors[] and would
                    // be reported as a false success). Resolve 3xx so we can detect it explicitly.
                    maxRedirects: 0,
                    validateStatus: (status) => status >= 200 && status < 400,
                });
                if (res.status >= 300)
                    return fail(`Hashnode validation failed: ${proRequired}`);
                const payload = res.data;
                if (!payload || typeof payload !== 'object')
                    return fail(`Hashnode validation failed: ${proRequired}`);
                if (payload.errors?.length) {
                    return fail(`Hashnode validation failed: ${payload.errors.map((e) => e.message ?? 'error').join('; ')}`);
                }
                const username = payload.data?.me?.username;
                if (!username)
                    return fail(`Hashnode validation failed: ${proRequired}`);
                return success(`Hashnode connected as @${username}.`);
            }
            catch (error) {
                return fail(`Hashnode validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'google_search_console') {
            const store = normalizeGoogleSecretStore(secret, config);
            const selection = resolveGoogleSelection(config, store, input);
            const isOAuth = selection.authMode === 'oauth';
            const range = resolvePerformanceWindow(input);
            const dateRangeDays = range.days;
            if (!isOAuth && !selection.credentials)
                return fail('Google service account JSON key is missing.');
            // Best-effort: resolve the signed-in user's email so the OAuth account shows a real name.
            const oauthEmail = isOAuth ? await this.fetchGoogleOAuthEmail() : '';
            const client = buildGoogleClient(selection, oauthEmail);
            let nextConfig;
            if (isOAuth) {
                nextConfig = upsertGoogleOAuthSummary(config, { email: oauthEmail });
            }
            else {
                const existingAccount = readGoogleServiceAccounts(config).find((account) => account.id === selection.accountId);
                nextConfig = upsertGoogleAccountSummary({
                    ...config,
                    defaultServiceAccountId: readString(config, 'defaultServiceAccountId') || store.defaultAccountId || selection.accountId,
                }, accountSummaryFromCredentials(selection.accountId, selection.credentials, existingAccount));
            }
            nextConfig = {
                ...config,
                ...nextConfig,
                authMode: isOAuth ? 'oauth' : 'service_account',
                defaultServiceAccountId: readString(nextConfig, 'defaultServiceAccountId') || selection.accountId,
                serviceAccountEmail: isOAuth ? oauthEmail || readString(nextConfig, 'serviceAccountEmail') : client.serviceAccountEmail,
                activeServiceAccountId: selection.accountId,
                performanceDateRangeDays: dateRangeDays,
                performanceDateRange: performanceRangeConfig(range),
            };
            if (selection.requiresProjectMapping) {
                const message = 'No Google property is mapped for this project. Choose a Search Console or GA4 property in Google data setup before syncing.';
                this.recordGoogleSyncLog([message], 0, 0, input?.productId ?? null);
                return attention(message, nextConfig);
            }
            if (selection.inferredMapping && input?.productId) {
                nextConfig = upsertGoogleProjectMapping(nextConfig, {
                    productId: input.productId,
                    serviceAccountId: selection.mapping?.serviceAccountId || selection.accountId,
                    propertyUrl: selection.propertyUrl,
                    ga4Property: selection.ga4Property,
                    updatedAt: Date.now(),
                });
            }
            nextConfig = {
                ...nextConfig,
                lastSyncedProductId: input?.productId ?? null,
                lastResourceSyncAt: Date.now(),
                propertyUrl: selection.propertyUrl,
                ga4Property: selection.ga4Property,
            };
            const messages = [];
            let successfulApiCalls = 0;
            let resourceCount = 0;
            let searchConsoleAvailable = false;
            try {
                const sites = await client.listSearchConsoleSites();
                successfulApiCalls += 1;
                resourceCount += sites.length;
                searchConsoleAvailable = true;
                nextConfig.searchConsoleSites = sites;
                nextConfig = setGoogleAccountResourceState(nextConfig, selection.accountId, {
                    lastSyncedAt: Date.now(),
                    searchConsoleSites: sites,
                    searchConsoleError: undefined,
                });
                delete nextConfig.searchConsoleError;
                messages.push(`GSC: ${sites.length} site(s) accessible`);
            }
            catch (error) {
                nextConfig.searchConsoleError = (0, GoogleServiceAccountClient_1.formatGoogleApiError)(error);
                nextConfig = setGoogleAccountResourceState(nextConfig, selection.accountId, {
                    lastSyncedAt: Date.now(),
                    searchConsoleSites: undefined,
                    searchConsoleError: String(nextConfig.searchConsoleError),
                });
                delete nextConfig.searchConsoleSites;
                nextConfig = clearLatestIfSourceMatches(nextConfig, 'searchConsolePreview', 'siteUrl', selection.propertyUrl);
                nextConfig = clearLatestIfSourceMatches(nextConfig, 'searchPerformanceReport', 'siteUrl', selection.propertyUrl);
                nextConfig = removeRangeCacheEntry(nextConfig, 'searchConsolePreviewsByRange', range.rangeKey, {
                    key: 'siteUrl',
                    value: selection.propertyUrl,
                });
                nextConfig = removeRangeCacheEntry(nextConfig, 'searchPerformanceReportsByRange', range.rangeKey, {
                    key: 'siteUrl',
                    value: selection.propertyUrl,
                });
                messages.push(`GSC unavailable: ${nextConfig.searchConsoleError}`);
            }
            const configuredSite = selection.propertyUrl;
            if (searchConsoleAvailable && configuredSite) {
                try {
                    const preview = await client.querySearchConsolePreview(configuredSite, range);
                    nextConfig.searchConsolePreview = preview;
                    nextConfig = upsertRangeCache(nextConfig, 'searchConsolePreviewsByRange', range.rangeKey, preview, {
                        key: 'siteUrl',
                        value: preview.siteUrl,
                    });
                    messages.push(`GSC preview: ${preview.rowCount} row(s), ${preview.totalClicks.toLocaleString()} click(s), ${preview.totalImpressions.toLocaleString()} impression(s)`);
                }
                catch (error) {
                    nextConfig.searchConsoleError = `Preview for ${configuredSite}: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`;
                    nextConfig = clearLatestIfSourceMatches(nextConfig, 'searchConsolePreview', 'siteUrl', configuredSite);
                    nextConfig = removeRangeCacheEntry(nextConfig, 'searchConsolePreviewsByRange', range.rangeKey, {
                        key: 'siteUrl',
                        value: configuredSite,
                    });
                    nextConfig = upsertRangeCache(nextConfig, 'searchConsoleErrorsByRange', range.rangeKey, {
                        siteUrl: configuredSite,
                        rangeKey: range.rangeKey,
                        message: String(nextConfig.searchConsoleError),
                    }, {
                        key: 'siteUrl',
                        value: configuredSite,
                    });
                    messages.push(`GSC preview unavailable: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`);
                }
                try {
                    const report = await client.querySearchConsolePerformanceReport(configuredSite, range);
                    nextConfig.searchPerformanceReport = report;
                    nextConfig = upsertRangeCache(nextConfig, 'searchPerformanceReportsByRange', range.rangeKey, report, {
                        key: 'siteUrl',
                        value: report.siteUrl,
                    });
                    nextConfig = removeRangeCacheEntry(nextConfig, 'searchConsoleErrorsByRange', range.rangeKey, {
                        key: 'siteUrl',
                        value: report.siteUrl,
                    });
                    delete nextConfig.searchConsoleError;
                    messages.push(`GSC performance ${dateRangeDays}d: ${report.summary.clicks.toLocaleString()} click(s), ${report.summary.impressions.toLocaleString()} impression(s)`);
                }
                catch (error) {
                    nextConfig.searchConsoleError = `Performance for ${configuredSite}: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`;
                    nextConfig = clearLatestIfSourceMatches(nextConfig, 'searchPerformanceReport', 'siteUrl', configuredSite);
                    nextConfig = removeRangeCacheEntry(nextConfig, 'searchPerformanceReportsByRange', range.rangeKey, {
                        key: 'siteUrl',
                        value: configuredSite,
                    });
                    nextConfig = upsertRangeCache(nextConfig, 'searchConsoleErrorsByRange', range.rangeKey, {
                        siteUrl: configuredSite,
                        rangeKey: range.rangeKey,
                        message: String(nextConfig.searchConsoleError),
                    }, {
                        key: 'siteUrl',
                        value: configuredSite,
                    });
                    messages.push(`GSC performance unavailable: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`);
                }
            }
            let configuredProperty = selection.ga4Property;
            try {
                const properties = await client.listAnalyticsProperties();
                successfulApiCalls += 1;
                resourceCount += properties.length;
                nextConfig.analyticsProperties = properties;
                nextConfig = setGoogleAccountResourceState(nextConfig, selection.accountId, {
                    lastSyncedAt: Date.now(),
                    analyticsProperties: properties,
                    analyticsError: undefined,
                });
                delete nextConfig.analyticsError;
                messages.push(`GA4: ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} accessible`);
                if (!configuredProperty && input?.productId) {
                    const inferredProperty = inferAnalyticsPropertyForProject(input.productId, properties);
                    const inferredPropertyName = (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(inferredProperty?.property ?? '');
                    if (inferredPropertyName) {
                        configuredProperty = inferredPropertyName;
                        nextConfig = upsertGoogleProjectMapping(nextConfig, {
                            productId: input.productId,
                            serviceAccountId: selection.mapping?.serviceAccountId || selection.accountId,
                            propertyUrl: selection.propertyUrl,
                            ga4Property: inferredPropertyName,
                            updatedAt: Date.now(),
                        });
                        nextConfig.ga4Property = inferredPropertyName;
                        messages.push(`GA4 matched ${inferredProperty?.propertyDisplayName || inferredPropertyName} to this project`);
                    }
                }
            }
            catch (error) {
                const discoveryError = (0, GoogleServiceAccountClient_1.formatGoogleApiError)(error);
                const normalizedConfiguredProperty = (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty);
                nextConfig.analyticsError = configuredProperty
                    ? `Property discovery: ${discoveryError}. Reports will still sync for ${normalizedConfiguredProperty}.`
                    : discoveryError;
                nextConfig = setGoogleAccountResourceState(nextConfig, selection.accountId, {
                    lastSyncedAt: Date.now(),
                    analyticsProperties: undefined,
                    analyticsError: String(nextConfig.analyticsError),
                });
                delete nextConfig.analyticsProperties;
                if (!configuredProperty) {
                    nextConfig = clearLatestIfSourceMatches(nextConfig, 'analyticsPreview', 'property', normalizedConfiguredProperty);
                    nextConfig = clearLatestIfSourceMatches(nextConfig, 'analyticsReport', 'property', normalizedConfiguredProperty);
                    nextConfig = removeRangeCacheEntry(nextConfig, 'analyticsPreviewsByRange', range.rangeKey, {
                        key: 'property',
                        value: normalizedConfiguredProperty,
                    });
                    nextConfig = removeRangeCacheEntry(nextConfig, 'analyticsReportsByRange', range.rangeKey, {
                        key: 'property',
                        value: normalizedConfiguredProperty,
                    });
                }
                messages.push(`GA4 property discovery unavailable: ${discoveryError}`);
            }
            if (configuredProperty) {
                try {
                    const preview = await client.queryAnalyticsOrganicPreview((0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty), range);
                    nextConfig.analyticsPreview = preview;
                    nextConfig = upsertRangeCache(nextConfig, 'analyticsPreviewsByRange', range.rangeKey, preview, {
                        key: 'property',
                        value: preview.property,
                    });
                    messages.push(`GA4 preview: ${preview.rowCount} row(s), ${preview.totalSessions.toLocaleString()} organic session(s), ${preview.totalUsers.toLocaleString()} user(s)`);
                }
                catch (error) {
                    nextConfig.analyticsError = `Preview for ${(0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty)}: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`;
                    nextConfig = clearLatestIfSourceMatches(nextConfig, 'analyticsPreview', 'property', (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty));
                    nextConfig = removeRangeCacheEntry(nextConfig, 'analyticsPreviewsByRange', range.rangeKey, {
                        key: 'property',
                        value: (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty),
                    });
                    nextConfig = upsertRangeCache(nextConfig, 'analyticsErrorsByRange', range.rangeKey, {
                        property: (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty),
                        rangeKey: range.rangeKey,
                        message: String(nextConfig.analyticsError),
                    }, {
                        key: 'property',
                        value: (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty),
                    });
                    messages.push(`GA4 preview unavailable: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`);
                }
                try {
                    const report = await client.queryAnalyticsReport((0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty), range);
                    successfulApiCalls += 1;
                    resourceCount += 1;
                    nextConfig.analyticsReport = report;
                    nextConfig = upsertRangeCache(nextConfig, 'analyticsReportsByRange', range.rangeKey, report, {
                        key: 'property',
                        value: report.property,
                    });
                    nextConfig = removeRangeCacheEntry(nextConfig, 'analyticsErrorsByRange', range.rangeKey, {
                        key: 'property',
                        value: report.property,
                    });
                    delete nextConfig.analyticsError;
                    messages.push(`GA4 analytics ${dateRangeDays}d: ${report.summary.activeUsers.toLocaleString()} active user(s), ${report.summary.eventCount.toLocaleString()} event(s)`);
                }
                catch (error) {
                    nextConfig.analyticsError = `Analytics for ${(0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty)}: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`;
                    nextConfig = clearLatestIfSourceMatches(nextConfig, 'analyticsReport', 'property', (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty));
                    nextConfig = removeRangeCacheEntry(nextConfig, 'analyticsReportsByRange', range.rangeKey, {
                        key: 'property',
                        value: (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty),
                    });
                    nextConfig = upsertRangeCache(nextConfig, 'analyticsErrorsByRange', range.rangeKey, {
                        property: (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty),
                        rangeKey: range.rangeKey,
                        message: String(nextConfig.analyticsError),
                    }, {
                        key: 'property',
                        value: (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(configuredProperty),
                    });
                    messages.push(`GA4 analytics unavailable: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`);
                }
            }
            this.recordGoogleSyncLog(messages, successfulApiCalls, resourceCount, input?.productId ?? null);
            if (successfulApiCalls === 0) {
                return fail(messages.join(' | ') || 'Google service account validation failed.');
            }
            if (resourceCount === 0) {
                return attention(`${messages.join(' | ')}. The key is valid, but no GSC sites or GA4 properties were found. Grant ${client.serviceAccountEmail} access in Google Search Console or GA4, then test again.`, nextConfig);
            }
            return success(`Google service account connected for ${client.serviceAccountEmail}. ${messages.join(' | ')}.`, nextConfig);
        }
        if (name === 'reddit') {
            return fail('Reddit publishing is coming soon. The hosted Devvit relay is not available yet.');
        }
        if (name === 'linkedin') {
            try {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('linkedin');
                const { data } = await axios_1.default.get('https://api.linkedin.com/v2/userinfo', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeout: 10000,
                });
                const displayName = data?.name;
                return success(`LinkedIn connected as ${displayName ?? 'member'}.`);
            }
            catch (error) {
                return fail(`LinkedIn validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'pinterest') {
            try {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('pinterest');
                const { data } = await axios_1.default.get('https://api.pinterest.com/v5/user_account', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeout: 10000,
                });
                const username = data?.username;
                return success(`Pinterest connected as @${username ?? 'user'}.`);
            }
            catch (error) {
                return fail(`Pinterest validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'youtube') {
            try {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('youtube');
                const { data } = await axios_1.default.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeout: 10000,
                });
                const accountName = data?.name;
                return success(`YouTube connected as ${accountName ?? 'your Google account'}.`);
            }
            catch (error) {
                return fail(`YouTube validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'tiktok') {
            try {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('tiktok');
                const { data } = await axios_1.default.get('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
                    headers: { Authorization: `Bearer ${accessToken}` },
                    timeout: 10000,
                });
                const displayName = data?.data?.user?.display_name;
                return success(`TikTok connected as ${displayName ?? 'your account'}.`);
            }
            catch (error) {
                return fail(`TikTok validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'facebook') {
            try {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('facebook');
                const { data } = await axios_1.default.get('https://graph.facebook.com/v23.0/me/accounts', {
                    params: { access_token: accessToken, fields: 'id,name' },
                    timeout: 10000,
                });
                const pages = data?.data ?? [];
                if (!pages.length)
                    return fail('Connected, but no Facebook Page found — you must be an admin of at least one Page.');
                return success(`Facebook connected — can post to ${pages[0].name ?? 'your Page'}.`);
            }
            catch (error) {
                return fail(`Facebook validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'instagram') {
            try {
                // Instagram-login flow: the token is the IG user token — read the account directly from
                // graph.instagram.com (no Facebook Page traversal).
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('instagram');
                const { data } = await axios_1.default.get('https://graph.instagram.com/v23.0/me', {
                    params: { access_token: accessToken, fields: 'user_id,username,account_type' },
                    timeout: 10000,
                });
                const username = data?.username;
                if (!username) {
                    return fail('Connected, but could not read your Instagram account — it must be a Professional (Business/Creator) account. Reconnect and try again.');
                }
                return success(`Instagram connected as @${username}.`);
            }
            catch (error) {
                return fail(`Instagram validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'threads') {
            try {
                const accessToken = await OAuthService_1.oauthService.ensureFreshToken('threads');
                const { data } = await axios_1.default.get('https://graph.threads.net/v1.0/me', {
                    params: { fields: 'username', access_token: accessToken },
                    timeout: 10000,
                });
                const username = data?.username;
                return success(`Threads connected as @${username ?? 'your account'}.`);
            }
            catch (error) {
                return fail(`Threads validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'dataforseo') {
            const credentials = (0, DataForSeoClient_1.normalizeDataForSeoCredentials)(secret);
            if (!credentials)
                return fail('DataForSEO username/password are required.');
            try {
                const account = await new DataForSeoClient_1.DataForSeoClient({ credentials }).getAccount();
                if (secret?.username !== credentials.username || secret?.password !== credentials.password) {
                    await CredentialVault_1.credentialVault.setSecret('dataforseo', credentials);
                }
                const balance = account.balance == null
                    ? ''
                    : ` Balance: $${account.balance.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    })}.`;
                return success(`DataForSEO credentials are valid.${balance}`);
            }
            catch (error) {
                return fail(error instanceof Error ? error.message : 'DataForSEO validation failed.');
            }
        }
        if (name === 'github' || name === 'gitlab') {
            const token = typeof secret?.token === 'string' ? secret.token : null;
            if (!token)
                return fail(`${name} access token is missing.`);
            const apiUrl = name === 'github' ? 'https://api.github.com/user' : 'https://gitlab.com/api/v4/user';
            try {
                await axios_1.default.get(apiUrl, {
                    headers: name === 'github' ? { Authorization: `token ${token}` } : { Authorization: `Bearer ${token}` },
                    timeout: 10000,
                });
                return success(`${name} token is valid.`);
            }
            catch (error) {
                return fail(`${name} validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
        if (name === 'smtp') {
            const host = assertConfigValue(config, 'host');
            const port = config.port;
            if (!host || typeof port !== 'number') {
                return fail('SMTP host and port are required.');
            }
            return success('SMTP configuration saved. Connection is validated on first send.');
        }
        return success('Connector configuration looks valid.');
    }
    /**
     * Inspect the property's URLs through the Search Console URL Inspection API and store a
     * structured Page Indexing report (real coverage reasons + the affected URLs) on the
     * connector config. This is a separate, opt-in action because it consumes inspection quota.
     */
    async analyzePageIndex(input, onProgress) {
        const name = 'google_search_console';
        const connector = AppRepository_1.repository.getConnector(name);
        if (!connector) {
            return { ok: false, status: 'error', message: 'Google connector not found.' };
        }
        const persistError = (message, status = 'attention') => {
            AppRepository_1.repository.updateConnector({ name, status, lastError: message, lastTestedAt: Date.now() });
            return { ok: false, status, message };
        };
        const secret = await CredentialVault_1.credentialVault.getSecret(name);
        const config = connector.config;
        const store = normalizeGoogleSecretStore(secret, config);
        const selection = resolveGoogleSelection(config, store, input);
        if (selection.authMode !== 'oauth' && !selection.credentials) {
            this.recordSyncLog({
                source: 'page_index',
                label: 'Page indexing analysis',
                status: 'error',
                productId: input?.productId ?? null,
                summary: 'Google service account JSON key is missing.',
                details: { errors: ['Google service account JSON key is missing.'] },
            });
            return persistError('Google service account JSON key is missing.', 'error');
        }
        if (!selection.propertyUrl) {
            this.recordSyncLog({
                source: 'page_index',
                label: 'Page indexing analysis',
                status: 'error',
                productId: input?.productId ?? null,
                summary: 'No Search Console property URL is configured.',
                details: { errors: ['Configure the Search Console property URL before analyzing indexing.'] },
            });
            return persistError('Configure the Search Console property URL before analyzing indexing.', 'error');
        }
        const client = buildGoogleClient(selection);
        const startedAt = Date.now();
        try {
            const report = await client.buildPageIndexReport(selection.propertyUrl, {
                maxUrls: input?.maxUrls,
                onProgress: (progress) => {
                    onProgress?.(progress);
                    this.emitPageIndexProgress(progress);
                },
            });
            const nextConfig = { ...config, pageIndexReport: report };
            AppRepository_1.repository.updateConnector({
                name,
                status: 'connected',
                config: nextConfig,
                lastError: null,
                lastTestedAt: Date.now(),
            });
            const sampledNote = report.sampled ? ` (sampled from ${report.totalKnownUrls.toLocaleString()} known URLs)` : '';
            const summary = `Inspected ${report.inspectedCount.toLocaleString()} URL(s): ${report.indexedCount.toLocaleString()} indexed, ${report.notIndexedCount.toLocaleString()} not indexed${sampledNote}.`;
            this.recordSyncLog({
                source: 'page_index',
                label: 'Page indexing analysis',
                status: report.partialErrors.length > 0 ? 'partial' : 'success',
                productId: input?.productId ?? null,
                summary,
                itemsSucceeded: report.inspectedCount,
                itemsFailed: report.partialErrors.length,
                durationMs: Date.now() - startedAt,
                details: {
                    succeeded: [
                        `Inspected ${report.inspectedCount} of ${report.totalKnownUrls} known URLs via ${report.urlSource}`,
                        `${report.indexedCount} indexed, ${report.notIndexedCount} not indexed`,
                        ...report.reasons.map((reason) => `${reason.reason} (${reason.source}): ${reason.count}`),
                    ],
                    failed: report.partialErrors,
                    errors: report.partialErrors,
                },
            });
            return { ok: true, status: 'connected', message: summary };
        }
        catch (error) {
            const message = `Page indexing analysis failed: ${(0, GoogleServiceAccountClient_1.formatGoogleApiError)(error)}`;
            this.recordSyncLog({
                source: 'page_index',
                label: 'Page indexing analysis',
                status: 'error',
                productId: input?.productId ?? null,
                summary: message,
                durationMs: Date.now() - startedAt,
                details: { errors: [message] },
            });
            return persistError(message);
        }
    }
    /**
     * Read cached URL Inspection results for a property without touching the Google API — a pure
     * local lookup that costs no inspection quota. The Request-history "Index status" column calls
     * this first to hydrate already-known rows instantly, then inspects only the URLs it misses.
     */
    getIndexStatusCache(input) {
        const urls = Array.from(new Set((input.urls ?? []).map((url) => url.trim()).filter(Boolean)));
        const propertyUrl = input.propertyUrl?.trim() ?? '';
        if (!propertyUrl || urls.length === 0)
            return [];
        const cached = AppRepository_1.repository.getGoogleIndexInspections(propertyUrl, urls);
        return urls.map((url) => cached.get(url)).filter((entry) => Boolean(entry));
    }
    /**
     * Inspect a batch of URLs through the Search Console URL Inspection API and return each one's
     * live index status (verdict + coverage state). Unlike {@link analyzePageIndex}, this writes no
     * sync log — it powers the Request-history "Index status" column, which inspects only the visible
     * page of rows on demand to stay within the ~2k/day inspection quota.
     *
     * Results are cached per (property, URL): a URL already in the cache is returned from it for free
     * and is NOT re-inspected unless `force` is set (the row's "re-check" button). So an already-known
     * page — indexed or not — never spends quota again until the user explicitly asks. A URL that
     * can't be inspected comes back with an `error` string instead of throwing (and is not cached),
     * so one bad row never sinks the page; a 429/403 aborts the rest early since those repeat for
     * every remaining URL.
     */
    async inspectIndexStatus(input) {
        const urls = Array.from(new Set((input.urls ?? []).map((url) => url.trim()).filter(Boolean)));
        if (urls.length === 0)
            return [];
        const name = 'google_search_console';
        const connector = AppRepository_1.repository.getConnector(name);
        if (!connector)
            throw new Error('Google connector not found.');
        const secret = await CredentialVault_1.credentialVault.getSecret(name);
        const config = connector.config;
        const store = normalizeGoogleSecretStore(secret, config);
        const selection = resolveGoogleSelection(config, store, input);
        if (selection.authMode !== 'oauth' && !selection.credentials) {
            throw new Error('Google service account JSON key is missing.');
        }
        const propertyUrl = input.propertyUrl?.trim() || selection.propertyUrl;
        if (!propertyUrl) {
            throw new Error('Configure the Search Console property URL before checking index status.');
        }
        // Serve from cache unless the caller forces a refresh; only the misses cost inspection quota.
        const cached = input.force ? new Map() : AppRepository_1.repository.getGoogleIndexInspections(propertyUrl, urls);
        const toFetch = urls.filter((url) => !cached.has(url));
        const fetched = new Map();
        if (toFetch.length > 0) {
            const client = buildGoogleClient(selection);
            const checkedAt = Date.now();
            let cursor = 0;
            let aborted = false;
            const worker = async () => {
                while (!aborted && cursor < toFetch.length) {
                    const target = toFetch[cursor];
                    cursor += 1;
                    try {
                        const entry = await client.inspectUrl(propertyUrl, target);
                        fetched.set(target, {
                            url: entry.url,
                            verdict: entry.verdict,
                            coverageState: entry.coverageState,
                            indexingState: entry.indexingState,
                            lastCrawlTime: entry.lastCrawlTime,
                            inspectionLink: entry.inspectionLink,
                            checkedAt,
                            cached: false,
                        });
                    }
                    catch (error) {
                        if (axios_1.default.isAxiosError(error) && (error.response?.status === 429 || error.response?.status === 403)) {
                            aborted = true;
                        }
                        fetched.set(target, {
                            url: target,
                            verdict: 'VERDICT_UNSPECIFIED',
                            coverageState: '',
                            indexingState: '',
                            lastCrawlTime: null,
                            inspectionLink: '',
                            checkedAt,
                            cached: false,
                            error: (0, GoogleServiceAccountClient_1.formatGoogleApiError)(error),
                        });
                    }
                }
            };
            await Promise.all(Array.from({ length: Math.min(4, toFetch.length) }, () => worker()));
            // Persist only the successful inspections (failures are skipped inside the repository).
            AppRepository_1.repository.upsertGoogleIndexInspections(propertyUrl, input.productId ?? null, Array.from(fetched.values()));
        }
        return urls.map((url) => fetched.get(url) ??
            cached.get(url) ?? {
            url,
            verdict: 'VERDICT_UNSPECIFIED',
            coverageState: '',
            indexingState: '',
            lastCrawlTime: null,
            inspectionLink: '',
            checkedAt: Date.now(),
            cached: false,
            error: 'Inspection stopped early — daily quota or property permission limit reached.',
        });
    }
    /**
     * Resolve the signed-in Google user's email from the OAuth userinfo endpoint, using the current
     * access token. Best-effort — returns '' on any failure so the connect flow still completes.
     */
    async fetchGoogleOAuthEmail() {
        try {
            const token = await OAuthService_1.oauthService.ensureFreshToken('google_search_console');
            const { data } = await axios_1.default.get('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 10_000,
            });
            return typeof data.email === 'string' ? data.email : '';
        }
        catch {
            return '';
        }
    }
    /**
     * Submit eligible URLs to Google's Indexing API through the configured service account.
     * This runs as a background task because each URL is a separate publish request and quota failures
     * should stop the remaining queue cleanly.
     */
    async requestGoogleIndex(input, onProgress) {
        const name = 'google_search_console';
        const connector = AppRepository_1.repository.getConnector(name);
        if (!connector) {
            throw new Error('Google connector not found.');
        }
        const secret = await CredentialVault_1.credentialVault.getSecret(name);
        const store = normalizeGoogleSecretStore(secret, connector.config);
        const selection = resolveGoogleSelection(connector.config, store, input);
        // Hard server-side gate: the Indexing API only accepts a service-account identity. "Sign in with
        // Google" (hosted OAuth) is read-only and can never submit indexing requests, so reject it up front
        // — regardless of what the renderer sent — with actionable guidance. resolveGoogleSelection already
        // yields null credentials for an OAuth selection; this makes the intent explicit and future-proof.
        if (selection.authMode === 'oauth') {
            throw new Error('Requesting indexing needs your own Google service account — “Sign in with Google” is read-only and can’t submit indexing requests. Add a service account under Settings → Google Account → Advanced, then map it to this project.');
        }
        if (!selection.credentials) {
            throw new Error('Google service account JSON key is missing — re-add your service account under Settings → Google Account → Advanced.');
        }
        if (!selection.propertyUrl) {
            throw new Error('Configure the Search Console property URL before requesting indexing.');
        }
        const parsedProperty = (0, gscProperty_1.parseGscSiteUrl)(selection.propertyUrl);
        if (!parsedProperty) {
            throw new Error('The mapped Search Console property URL is invalid.');
        }
        const requestType = input.requestType === 'URL_DELETED' ? 'URL_DELETED' : 'URL_UPDATED';
        const urls = dedupeGoogleIndexUrls(input.urls ?? []);
        if (urls.length === 0) {
            throw new Error('Add at least one URL to request indexing.');
        }
        const client = new GoogleServiceAccountClient_1.GoogleServiceAccountClient(selection.credentials);
        const startedAt = Date.now();
        const batchId = (0, id_1.createId)();
        const records = [];
        let submitted = 0;
        let skipped = 0;
        let failed = 0;
        onProgress?.({
            phase: 'start',
            done: 0,
            total: urls.length,
            currentUrl: '',
            status: 'queued',
            message: `Preparing ${urls.length} URL${urls.length === 1 ? '' : 's'} for Google indexing.`,
        });
        for (let index = 0; index < urls.length; index += 1) {
            const rawUrl = urls[index];
            const normalizedUrl = normalizeGoogleIndexUrl(rawUrl);
            const done = index + 1;
            if (!normalizedUrl) {
                skipped += 1;
                records.push({ url: rawUrl, status: 'skipped', error: 'Invalid URL.' });
                onProgress?.({
                    phase: 'submit',
                    done,
                    total: urls.length,
                    currentUrl: rawUrl,
                    status: 'skipped',
                    message: 'Skipped invalid URL.',
                });
                continue;
            }
            if (!urlBelongsToGscProperty(normalizedUrl, parsedProperty)) {
                skipped += 1;
                records.push({ url: normalizedUrl, status: 'skipped', error: `URL is outside ${selection.propertyUrl}.` });
                onProgress?.({
                    phase: 'submit',
                    done,
                    total: urls.length,
                    currentUrl: normalizedUrl,
                    status: 'skipped',
                    message: 'Skipped URL outside the mapped Search Console property.',
                });
                continue;
            }
            try {
                const result = await client.publishUrlNotification({ url: normalizedUrl, type: requestType });
                const metadata = result.urlNotificationMetadata;
                const notifyTime = requestType === 'URL_DELETED'
                    ? metadata?.latestRemove?.notifyTime ?? null
                    : metadata?.latestUpdate?.notifyTime ?? null;
                submitted += 1;
                records.push({ url: normalizedUrl, status: 'submitted', notifyTime });
                onProgress?.({
                    phase: 'submit',
                    done,
                    total: urls.length,
                    currentUrl: normalizedUrl,
                    status: 'submitted',
                    message: `Submitted ${done}/${urls.length} to Google's Indexing API.`,
                });
            }
            catch (error) {
                failed += 1;
                const message = (0, GoogleServiceAccountClient_1.formatGoogleApiError)(error);
                records.push({ url: normalizedUrl, status: 'error', error: message });
                onProgress?.({
                    phase: 'submit',
                    done,
                    total: urls.length,
                    currentUrl: normalizedUrl,
                    status: 'error',
                    message,
                });
                if (axios_1.default.isAxiosError(error) && error.response?.status === 429) {
                    break;
                }
            }
        }
        const summary = `Google indexing request finished: ${submitted} submitted, ${skipped} skipped, ${failed} failed.`;
        onProgress?.({
            phase: 'done',
            done: records.length,
            total: urls.length,
            currentUrl: '',
            status: failed > 0 ? 'error' : 'submitted',
            message: summary,
        });
        AppRepository_1.repository.recordGoogleIndexRequests({
            batchId,
            productId: input.productId ?? null,
            propertyUrl: selection.propertyUrl,
            requestType,
            submittedAt: startedAt,
            entries: records.map((record) => ({
                url: record.url,
                submitStatus: record.status,
                notifyTime: record.notifyTime ?? null,
                error: record.error ?? null,
            })),
        });
        this.recordSyncLog({
            source: 'google_indexing',
            label: 'Google request indexing',
            status: failed > 0 ? (submitted > 0 || skipped > 0 ? 'partial' : 'error') : 'success',
            productId: input.productId ?? null,
            summary,
            itemsSucceeded: submitted,
            itemsFailed: failed + skipped,
            durationMs: Date.now() - startedAt,
            details: {
                succeeded: records.filter((record) => record.status === 'submitted').map((record) => record.url),
                failed: records.filter((record) => record.status !== 'submitted').map((record) => `${record.url}: ${record.error ?? record.status}`),
                errors: records.filter((record) => record.error).map((record) => `${record.url}: ${record.error}`),
            },
        });
        return {
            propertyUrl: selection.propertyUrl,
            submitted,
            skipped,
            failed,
            records,
            message: summary,
        };
    }
    recordSyncLog(input) {
        try {
            AppRepository_1.repository.createSyncLog(input);
        }
        catch {
            // Logging must never break a sync.
        }
    }
    recordGoogleSyncLog(messages, successfulApiCalls, resourceCount, productId) {
        const failed = messages.filter((message) => /unavailable|failed|error|missing|not found/i.test(message));
        const succeeded = messages.filter((message) => !failed.includes(message));
        const status = successfulApiCalls === 0 ? 'error' : failed.length > 0 || resourceCount === 0 ? 'partial' : 'success';
        this.recordSyncLog({
            source: 'google_search_console',
            label: 'Google data sync',
            status,
            productId,
            summary: messages.join(' | ') || 'Google sync completed.',
            itemsSucceeded: succeeded.length,
            itemsFailed: failed.length,
            details: { succeeded, failed, errors: failed },
        });
    }
    emitPageIndexProgress(progress) {
        try {
            for (const win of electron_1.BrowserWindow.getAllWindows()) {
                win.webContents.send(channels_1.CHANNELS.CONNECTORS_PAGE_INDEX_PROGRESS, progress);
            }
        }
        catch {
            // Non-fatal: progress is best-effort UI feedback.
        }
    }
}
exports.ConnectorService = ConnectorService;
exports.connectorService = new ConnectorService();
//# sourceMappingURL=ConnectorService.js.map