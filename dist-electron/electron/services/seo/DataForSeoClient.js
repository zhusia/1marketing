"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataForSeoClient = void 0;
exports.normalizeDataForSeoCredentials = normalizeDataForSeoCredentials;
const axios_1 = __importDefault(require("axios"));
const domain_1 = require("../../utils/domain");
const ApiLogService_1 = require("../ApiLogService");
const DATAFORSEO_BASE_URL = 'https://api.dataforseo.com';
const DEFAULT_LOCATION = 'United States';
const DEFAULT_LANGUAGE = 'English';
class DataForSeoClient {
    name = 'dataforseo';
    capabilities = {
        backlinks: true,
        keywords: true,
        serp: true,
    };
    http;
    credentials;
    getSecret;
    constructor(options = {}) {
        this.credentials = normalizeDataForSeoCredentials(options.credentials) ?? undefined;
        this.getSecret = options.getSecret;
        this.http = axios_1.default.create({
            baseURL: options.baseUrl ?? DATAFORSEO_BASE_URL,
            timeout: 30000,
        });
    }
    async getAccount() {
        const response = await this.request('get', '/v3/appendix/user_data');
        const result = firstResult(response);
        return {
            login: typeof result?.login === 'string' ? result.login : null,
            balance: toNullableNumber(result?.money?.balance),
            raw: result ?? null,
        };
    }
    async getDomainAuthority(domain) {
        const normalizedDomain = (0, domain_1.extractDomain)(domain);
        const response = await this.request('post', '/v3/backlinks/summary/live', [
            {
                target: normalizedDomain,
                include_subdomains: true,
            },
        ]);
        const result = firstResult(response);
        if (!result) {
            throw new Error(`DataForSEO returned no backlink summary for ${normalizedDomain}.`);
        }
        return {
            domain: normalizedDomain,
            domainRating: toInteger(result.rank),
            urlRating: 0,
            backlinks: toInteger(result.backlinks),
            linkingWebsites: toInteger(result.referring_main_domains ?? result.referring_domains),
            source: this.name,
        };
    }
    async getBacklinkProfile(domain, limit = 50) {
        const normalizedDomain = (0, domain_1.extractDomain)(domain);
        const safeLimit = Math.min(Math.max(Math.round(limit), 1), 1000);
        const filters = {
            target: normalizedDomain,
            limit: safeLimit,
            order_by: ['backlinks,desc'],
            backlinks_status_type: 'live',
            include_subdomains: true,
        };
        const [domainsResponse, anchorsResponse] = await Promise.all([
            this.request('post', '/v3/backlinks/referring_domains/live', [filters]),
            this.request('post', '/v3/backlinks/anchors/live', [filters]),
        ]);
        const referringDomains = allItems(domainsResponse)
            .map((item) => ({
            domain: toNullableString(item.domain) ?? '',
            backlinks: toInteger(item.backlinks),
            domainRank: toNullableInteger(item.rank),
        }))
            .filter((row) => row.domain.length > 0);
        const anchors = allItems(anchorsResponse)
            .map((item) => ({
            anchor: toNullableString(item.anchor) ?? '',
            backlinks: toInteger(item.backlinks),
            referringDomains: toInteger(item.referring_domains ?? item.referring_main_domains),
        }))
            .filter((row) => row.anchor.length > 0);
        return {
            domain: normalizedDomain,
            referringDomains,
            anchors,
            source: this.name,
        };
    }
    /**
     * Fetch rank + backlinks + referring domains for many domains using the bulk backlinks endpoints.
     * Each endpoint accepts up to 1000 targets per task, so the whole workspace usually costs three
     * billable tasks total instead of one per domain. Rank stays on DataForSEO's raw 0–1000 scale.
     */
    async bulkDomainAuthority(domains) {
        const targets = Array.from(new Set(domains.map((domain) => (0, domain_1.extractDomain)(domain)).filter(Boolean)));
        if (targets.length === 0)
            return [];
        const [ranks, backlinks, referringDomains] = await Promise.all([
            this.bulkMetric('/v3/backlinks/bulk_ranks/live', targets, 'rank'),
            this.bulkMetric('/v3/backlinks/bulk_backlinks/live', targets, 'backlinks'),
            this.bulkMetric('/v3/backlinks/bulk_referring_domains/live', targets, 'referring_domains'),
        ]);
        return targets.map((domain) => ({
            domain,
            domainRating: ranks.get(domain) ?? 0,
            backlinks: backlinks.get(domain) ?? 0,
            linkingWebsites: referringDomains.get(domain) ?? 0,
            source: this.name,
        }));
    }
    /** One bulk backlinks call (chunked to ≤1000 targets), returning `field` keyed by normalized domain. */
    async bulkMetric(path, targets, field) {
        const out = new Map();
        for (let offset = 0; offset < targets.length; offset += 1000) {
            const chunk = targets.slice(offset, offset + 1000);
            const response = await this.request('post', path, [{ targets: chunk }]);
            for (const item of allItems(response)) {
                const domain = (0, domain_1.extractDomain)(toNullableString(item.target) ?? '');
                if (domain)
                    out.set(domain, toInteger(item[field]));
            }
        }
        return out;
    }
    async keywordOverview(keywords, location = DEFAULT_LOCATION) {
        const cleaned = Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)));
        if (cleaned.length === 0)
            return [];
        const response = await this.request('post', '/v3/dataforseo_labs/google/keyword_overview/live', [
            {
                keywords: cleaned,
                location_name: location,
                language_name: DEFAULT_LANGUAGE,
            },
        ]);
        return allItems(response).map((item) => this.mapKeywordMetric(item)).filter((item) => item.keyword.length > 0);
    }
    async keywordIdeas(seed, location = DEFAULT_LOCATION) {
        const keyword = seed.trim();
        if (!keyword)
            return [];
        const response = await this.request('post', '/v3/dataforseo_labs/google/keyword_ideas/live', [
            {
                keyword,
                location_name: location,
                language_name: DEFAULT_LANGUAGE,
                include_seed_keyword: true,
                limit: 100,
            },
        ]);
        return allItems(response).map((item) => this.mapKeywordMetric(item)).filter((item) => item.keyword.length > 0);
    }
    /**
     * Google Ads Keyword Planner metrics (avg. monthly searches, competition, and
     * top-of-page bid range) for the exact keywords provided. Pulls ~14 months of
     * monthly history so three-month and year-over-year change can be derived.
     */
    async keywordPlanner(keywords, location = DEFAULT_LOCATION) {
        const cleaned = Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)));
        if (cleaned.length === 0)
            return [];
        const response = await this.request('post', '/v3/keywords_data/google_ads/search_volume/live', [
            {
                keywords: cleaned,
                location_name: location,
                language_name: DEFAULT_LANGUAGE,
                date_from: monthsAgoDate(14),
            },
        ]);
        return allItems(response).map((item) => this.mapKeywordPlannerMetric(item)).filter((item) => item.keyword.length > 0);
    }
    async rankedKeywords(domain, location = DEFAULT_LOCATION) {
        const target = (0, domain_1.extractDomain)(domain);
        const response = await this.request('post', '/v3/dataforseo_labs/google/ranked_keywords/live', [
            {
                target,
                location_name: location,
                language_name: DEFAULT_LANGUAGE,
                limit: 100,
            },
        ]);
        return allItems(response)
            .map((item) => {
            const metric = this.mapKeywordMetric(item);
            const serpItem = getNestedRecord(item, ['ranked_serp_element', 'serp_item']);
            return {
                ...metric,
                position: toNullableInteger(serpItem?.rank_absolute ?? item.rank_absolute ?? item.position),
                url: toNullableString(serpItem?.url ?? item.url),
            };
        })
            .filter((item) => item.keyword.length > 0);
    }
    async serpPosition(keyword, domain, location = DEFAULT_LOCATION) {
        const normalizedDomain = (0, domain_1.extractDomain)(domain);
        const cleanKeyword = keyword.trim();
        if (!cleanKeyword) {
            throw new Error('Keyword is required.');
        }
        const response = await this.request('post', '/v3/serp/google/organic/live/advanced', [
            {
                keyword: cleanKeyword,
                location_name: location,
                language_name: DEFAULT_LANGUAGE,
            },
        ]);
        const items = allItems(response);
        const match = items.find((item) => {
            const itemDomain = toNullableString(item.domain);
            const itemUrl = toNullableString(item.url);
            return (itemDomain === normalizedDomain ||
                itemDomain?.endsWith(`.${normalizedDomain}`) ||
                Boolean(itemUrl && (0, domain_1.extractDomain)(itemUrl) === normalizedDomain));
        });
        return {
            keyword: cleanKeyword,
            domain: normalizedDomain,
            position: toNullableInteger(match?.rank_absolute),
            url: toNullableString(match?.url),
            title: toNullableString(match?.title),
            source: this.name,
        };
    }
    async serpResults(keyword, location = DEFAULT_LOCATION, depth = 20) {
        const cleanKeyword = keyword.trim();
        if (!cleanKeyword) {
            throw new Error('Keyword is required.');
        }
        const safeDepth = Math.min(Math.max(Math.round(depth) || 20, 1), 100);
        const response = await this.request('post', '/v3/serp/google/organic/live/advanced', [
            {
                keyword: cleanKeyword,
                location_name: location,
                language_name: DEFAULT_LANGUAGE,
                depth: safeDepth,
            },
        ]);
        const results = [];
        const peopleAlsoAsk = [];
        const relatedSearches = [];
        for (const item of allItems(response)) {
            const type = toNullableString(item.type);
            if (type === 'organic') {
                const url = toNullableString(item.url);
                if (!url)
                    continue;
                results.push({
                    rank: toNullableInteger(item.rank_absolute ?? item.rank_group),
                    title: toNullableString(item.title),
                    url,
                    domain: toNullableString(item.domain) ?? (0, domain_1.extractDomain)(url),
                    description: toNullableString(item.description ?? item.snippet),
                });
            }
            else if (type === 'people_also_ask') {
                for (const paa of recordArray(item.items)) {
                    const question = toNullableString(paa.title ?? paa.question);
                    if (question)
                        peopleAlsoAsk.push(question);
                }
            }
            else if (type === 'related_searches') {
                for (const related of Array.isArray(item.items) ? item.items : []) {
                    const term = toNullableString(related);
                    if (term)
                        relatedSearches.push(term);
                }
            }
        }
        return {
            keyword: cleanKeyword,
            location,
            results: results.slice(0, safeDepth),
            peopleAlsoAsk,
            relatedSearches,
            source: this.name,
        };
    }
    /**
     * Google AI Overview answer for a search term. The AI Overview is returned as
     * an `ai_overview` element inside the standard organic SERP advanced response.
     * NOTE: the exact element/field names below are best-effort and tolerant — verify
     * against current DataForSEO SERP API docs (see docs/llm_tracker.md §3.1).
     */
    async aiOverview(term, location = DEFAULT_LOCATION, language = DEFAULT_LANGUAGE) {
        const keyword = term.trim();
        if (!keyword)
            throw new Error('Search term is required.');
        const response = await this.request('post', '/v3/serp/google/organic/live/advanced', [
            { keyword, location_name: location, language_name: language, load_async_ai_overview: true, depth: 10 },
        ]);
        return buildAiAnswer('ai_overview', keyword, response);
    }
    /**
     * Google AI Mode answer for a search term. Served by its own SERP endpoint;
     * requires a non-rented DataForSEO key (queue-mode restrictions). Field parsing
     * is tolerant — verify against current docs before relying on it.
     */
    async aiMode(term, location = DEFAULT_LOCATION, language = DEFAULT_LANGUAGE) {
        const keyword = term.trim();
        if (!keyword)
            throw new Error('Search term is required.');
        const response = await this.request('post', '/v3/serp/google/ai_mode/live/advanced', [
            { keyword, location_name: location, language_name: language },
        ]);
        return buildAiAnswer('ai_mode', keyword, response);
    }
    mapKeywordMetric(item) {
        const keywordData = getNestedRecord(item, ['keyword_data']);
        const keywordInfo = getNestedRecord(item, ['keyword_info']) ?? getNestedRecord(keywordData, ['keyword_info']);
        const keywordProperties = getNestedRecord(item, ['keyword_properties']) ?? getNestedRecord(keywordData, ['keyword_properties']);
        const searchIntent = getNestedRecord(item, ['search_intent_info']) ??
            getNestedRecord(item, ['keyword_intent']) ??
            getNestedRecord(keywordData, ['search_intent_info']);
        return {
            keyword: toNullableString(item.keyword ?? keywordData?.keyword) ?? '',
            searchVolume: toNullableInteger(keywordInfo?.search_volume),
            difficulty: toNullableInteger(keywordProperties?.keyword_difficulty ?? item.keyword_difficulty),
            cpc: toNullableNumber(keywordInfo?.cpc),
            competition: toNullableNumber(keywordInfo?.competition),
            competitionLevel: toNullableString(keywordInfo?.competition_level),
            intent: toNullableString(searchIntent?.main_intent ?? searchIntent?.label ?? searchIntent?.intent),
            source: this.name,
        };
    }
    mapKeywordPlannerMetric(item) {
        const monthlySearches = parseMonthlySearches(item.monthly_searches);
        return {
            keyword: toNullableString(item.keyword) ?? '',
            avgMonthlySearches: toNullableInteger(item.search_volume),
            threeMonthChange: monthlyChange(monthlySearches, 3),
            yoyChange: monthlyChange(monthlySearches, 12),
            competition: toNullableInteger(item.competition_index),
            competitionLevel: toNullableString(item.competition),
            lowTopOfPageBid: toNullableNumber(item.low_top_of_page_bid),
            highTopOfPageBid: toNullableNumber(item.high_top_of_page_bid),
            cpc: toNullableNumber(item.cpc),
            monthlySearches,
            source: this.name,
        };
    }
    async request(method, path, data) {
        const credentials = await this.resolveCredentials();
        const started = Date.now();
        let body = null;
        try {
            const response = await this.http.request({
                method,
                url: path,
                data,
                headers: {
                    Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
            });
            body = response.data;
            assertSuccessfulDataForSeoResponse(body);
            this.recordApiCall(method, path, started, data, body, null);
            return body;
        }
        catch (error) {
            const mapped = mapDataForSeoError(error);
            this.recordApiCall(method, path, started, data, body, mapped);
            throw mapped;
        }
    }
    /** Persist an audit entry for the call (best-effort; never throws). */
    recordApiCall(method, path, startedAt, requestBody, body, error) {
        const statusCode = body?.tasks?.[0]?.status_code ?? body?.status_code ?? null;
        ApiLogService_1.apiLogService.record({
            provider: 'dataforseo',
            method: method.toUpperCase(),
            path,
            status: error ? 'error' : 'success',
            statusCode,
            summary: `${method.toUpperCase()} ${path}`,
            detail: error ? error.message : null,
            requestBody: requestBody ?? null,
            responseBody: body,
            cost: body?.cost ?? null,
            durationMs: Date.now() - startedAt,
        });
    }
    async resolveCredentials() {
        if (this.credentials)
            return this.credentials;
        const secret = await this.getSecret?.();
        const credentials = normalizeDataForSeoCredentials(secret);
        if (!credentials) {
            throw new Error('DataForSEO API login and password are required. Add them in Settings > API.');
        }
        return credentials;
    }
}
exports.DataForSeoClient = DataForSeoClient;
function normalizeDataForSeoCredentials(secret) {
    const username = typeof secret?.username === 'string' ? secret.username.trim() : '';
    const password = typeof secret?.password === 'string' ? secret.password.trim() : '';
    const usernameCombinedCredentials = parseCombinedCredential(username);
    if (usernameCombinedCredentials)
        return usernameCombinedCredentials;
    if (username && password)
        return { username, password };
    const passwordCombinedCredentials = parseCombinedCredential(password);
    if (passwordCombinedCredentials)
        return passwordCombinedCredentials;
    return null;
}
function parseCombinedCredential(value) {
    if (!value)
        return null;
    const basicToken = value.replace(/^Basic\s+/i, '').trim();
    const rawCredentials = parseUsernamePassword(value);
    if (rawCredentials)
        return rawCredentials;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(basicToken) || basicToken.length < 8 || basicToken.length % 4 === 1) {
        return null;
    }
    try {
        const paddedToken = basicToken.padEnd(Math.ceil(basicToken.length / 4) * 4, '=');
        const decoded = Buffer.from(paddedToken, 'base64').toString('utf8');
        if (!decoded || decoded.includes('\uFFFD'))
            return null;
        return parseUsernamePassword(decoded);
    }
    catch {
        return null;
    }
}
function parseUsernamePassword(value) {
    const separator = value.indexOf(':');
    if (separator <= 0 || separator === value.length - 1)
        return null;
    const username = value.slice(0, separator).trim();
    const password = value.slice(separator + 1).trim();
    return username && password ? { username, password } : null;
}
function assertSuccessfulDataForSeoResponse(response) {
    if (response.status_code && response.status_code >= 40000) {
        throw new Error(formatDataForSeoApiError('DataForSEO request failed', response.status_code, response.status_message));
    }
    for (const task of response.tasks ?? []) {
        if (task.status_code && task.status_code >= 40000) {
            throw new Error(formatDataForSeoApiError('DataForSEO task failed', task.status_code, task.status_message));
        }
    }
}
function formatDataForSeoApiError(prefix, code, message) {
    return message ? `${prefix}: ${message} (${code}).` : `${prefix} with code ${code}.`;
}
function firstResult(response) {
    return response.tasks?.flatMap((task) => task.result ?? [])[0] ?? null;
}
function allItems(response) {
    const results = response.tasks?.flatMap((task) => task.result ?? []) ?? [];
    return results.flatMap((result) => {
        const items = result.items;
        return Array.isArray(items) ? items.filter(isRecord) : isRecord(result) ? [result] : [];
    });
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function recordArray(value) {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}
function getNestedRecord(source, path) {
    let current = source;
    for (const part of path) {
        if (!isRecord(current))
            return null;
        current = current[part];
    }
    return isRecord(current) ? current : null;
}
function toNullableString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function toNullableNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim())
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function toNullableInteger(value) {
    const numeric = toNullableNumber(value);
    return numeric == null ? null : Math.round(numeric);
}
function toInteger(value) {
    return toNullableInteger(value) ?? 0;
}
/** First-of-month date `count` months before today, as `YYYY-MM-DD` for DataForSEO. */
function monthsAgoDate(count) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - count, 1);
    const month = String(from.getMonth() + 1).padStart(2, '0');
    return `${from.getFullYear()}-${month}-01`;
}
/** Normalize DataForSEO `monthly_searches` into ascending chronological order. */
function parseMonthlySearches(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter(isRecord)
        .map((entry) => ({
        year: toInteger(entry.year),
        month: toInteger(entry.month),
        searchVolume: toNullableInteger(entry.search_volume),
    }))
        .filter((entry) => entry.year > 0 && entry.month > 0)
        .sort((a, b) => a.year - b.year || a.month - b.month);
}
/**
 * Percent change of the most recent month vs. the month `offset` positions
 * earlier. Returns null when there isn't enough history or the baseline is zero.
 */
function monthlyChange(months, offset) {
    if (months.length <= offset)
        return null;
    const latest = months[months.length - 1]?.searchVolume;
    const baseline = months[months.length - 1 - offset]?.searchVolume;
    if (latest == null || baseline == null || baseline === 0)
        return null;
    return ((latest - baseline) / baseline) * 100;
}
function mapDataForSeoError(error) {
    if (axios_1.default.isAxiosError(error)) {
        const axiosError = error;
        const status = axiosError.response?.status;
        const apiMessage = extractDataForSeoMessage(axiosError.response?.data);
        if (status === 401 || status === 403) {
            return new Error(apiMessage
                ? `DataForSEO authentication failed: ${apiMessage}`
                : 'DataForSEO authentication failed. Check the API login and API password from the DataForSEO API Access page.');
        }
        if (status === 402) {
            return new Error(apiMessage
                ? `DataForSEO account has insufficient balance: ${apiMessage}`
                : 'DataForSEO account has insufficient balance. Top up the account and try again.');
        }
        if (status === 429) {
            return new Error(apiMessage
                ? `DataForSEO rate limit reached: ${apiMessage}`
                : 'DataForSEO rate limit reached. Wait a moment and try again.');
        }
        if (apiMessage)
            return new Error(`DataForSEO request failed: ${apiMessage}`);
        return new Error(`DataForSEO request failed: ${axiosError.message}`);
    }
    if (error instanceof Error)
        return error;
    return new Error('DataForSEO request failed.');
}
function extractDataForSeoMessage(response) {
    if (!response)
        return null;
    if (response.status_message)
        return response.status_message;
    return response.tasks?.find((task) => task.status_message)?.status_message ?? null;
}
/**
 * Walk a SERP advanced response, isolate the AI element (`ai_overview` / `ai_mode`),
 * and collect its answer text + reference links into an `AiAnswer`. Tolerant of
 * shape changes: it only mines text and reference/link arrays from the AI subtree,
 * so it never mistakes organic results for citations.
 */
function buildAiAnswer(engine, keyword, response) {
    const cost = toNullableNumber(response.cost) ?? 0;
    const results = response.tasks?.flatMap((task) => task.result ?? []) ?? [];
    const texts = [];
    const citations = [];
    const seenUrls = new Set();
    const addCitation = (ref) => {
        if (!isRecord(ref))
            return;
        const url = toNullableString(ref.url) ?? toNullableString(ref.link);
        if (!url || !/^https?:\/\//i.test(url) || seenUrls.has(url))
            return;
        seenUrls.add(url);
        citations.push({
            url,
            domain: toNullableString(ref.domain) ?? (0, domain_1.extractDomain)(url),
            title: toNullableString(ref.title) ?? toNullableString(ref.source) ?? toNullableString(ref.text),
        });
    };
    const collect = (node) => {
        if (Array.isArray(node)) {
            node.forEach(collect);
            return;
        }
        if (!isRecord(node))
            return;
        const text = toNullableString(node.markdown) ?? toNullableString(node.text);
        if (text)
            texts.push(text);
        for (const key of ['references', 'links']) {
            if (Array.isArray(node[key]))
                node[key].forEach(addCitation);
        }
        for (const value of Object.values(node)) {
            if (value && typeof value === 'object')
                collect(value);
        }
    };
    for (const result of results) {
        if (!isRecord(result))
            continue;
        const items = Array.isArray(result.items) ? result.items : [];
        for (const item of items) {
            if (isRecord(item) && toNullableString(item.type) === engine)
                collect(item);
        }
        // The AI Mode endpoint may put the answer at the result root rather than in `items`.
        if (engine === 'ai_mode' && texts.length === 0) {
            const text = toNullableString(result.markdown) ?? toNullableString(result.text);
            if (text)
                texts.push(text);
            for (const key of ['references', 'links']) {
                if (Array.isArray(result[key]))
                    result[key].forEach(addCitation);
            }
        }
    }
    const text = Array.from(new Set(texts)).join('\n\n').trim();
    return { engine, term: keyword, found: text.length > 0, text, citations, source: 'dataforseo', cost };
}
//# sourceMappingURL=DataForSeoClient.js.map