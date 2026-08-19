"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlSite = crawlSite;
/**
 * Breadth-first, same-host crawler for the site audit. Fetches each page with a
 * small concurrency pool, captures status/redirect/timing, analyzes HTML for SEO
 * signals, and grows the frontier from discovered internal links — bounded by
 * maxPages, robots rules, and a cancel check.
 */
const axios_1 = __importDefault(require("axios"));
const pageAnalyzer_1 = require("./pageAnalyzer");
const USER_AGENT = '1MarketingTool/SiteAudit';
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 20_000;
/** Drop the fragment and reject non-HTTP(S) URLs so the frontier stays deduped and safe. */
function normalize(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return null;
        parsed.hash = '';
        return parsed.toString();
    }
    catch {
        return null;
    }
}
function sameHost(url, host) {
    try {
        return new URL(url).host.toLowerCase() === host.toLowerCase();
    }
    catch {
        return false;
    }
}
function headerValue(value) {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value) && typeof value[0] === 'string')
        return value[0];
    return null;
}
async function fetchAndAnalyze(url, host) {
    const started = Date.now();
    try {
        const response = await axios_1.default.get(url, {
            timeout: FETCH_TIMEOUT_MS,
            responseType: 'text',
            transformResponse: (raw) => raw,
            maxRedirects: 0,
            decompress: true,
            validateStatus: () => true,
            headers: { Accept: 'text/html,application/xhtml+xml,*/*', 'User-Agent': USER_AGENT },
        });
        const responseTimeMs = Date.now() - started;
        const status = response.status;
        if (status >= 300 && status < 400) {
            const location = headerValue(response.headers?.location);
            let redirectUrl = null;
            if (location) {
                try {
                    redirectUrl = new URL(location, url).toString();
                }
                catch {
                    redirectUrl = null;
                }
            }
            return { url, statusCode: status, redirectUrl, responseTimeMs, analysis: null };
        }
        const contentType = headerValue(response.headers?.['content-type']) ?? '';
        if (status === 200 && contentType.toLowerCase().includes('html')) {
            const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
            return { url, statusCode: status, redirectUrl: null, responseTimeMs, analysis: (0, pageAnalyzer_1.analyzeHtml)(html, url, host) };
        }
        return { url, statusCode: status, redirectUrl: null, responseTimeMs, analysis: null };
    }
    catch {
        return { url, statusCode: 0, redirectUrl: null, responseTimeMs: Date.now() - started, analysis: null };
    }
}
async function crawlSite(options) {
    const { rootUrl, host, maxPages, seeds, isAllowed, shouldCancel, onPage } = options;
    const visited = new Set();
    const queue = [];
    const enqueue = (candidate) => {
        const normalized = normalize(candidate);
        if (!normalized || visited.has(normalized))
            return;
        if (!sameHost(normalized, host))
            return;
        if (!(0, pageAnalyzer_1.looksLikeHtml)(normalized))
            return;
        if (!isAllowed(normalized))
            return;
        visited.add(normalized);
        queue.push(normalized);
    };
    enqueue(rootUrl);
    for (const seed of seeds)
        enqueue(seed);
    let crawled = 0;
    while (queue.length > 0 && crawled < maxPages && !shouldCancel()) {
        const remaining = maxPages - crawled;
        const batch = queue.splice(0, Math.min(CONCURRENCY, remaining, queue.length));
        const results = await Promise.all(batch.map((url) => fetchAndAnalyze(url, host)));
        for (const result of results) {
            crawled += 1;
            onPage(result);
            if (result.analysis) {
                for (const link of result.analysis.internalLinks)
                    enqueue(link);
            }
            if (result.redirectUrl)
                enqueue(result.redirectUrl);
        }
    }
    return crawled;
}
//# sourceMappingURL=crawl.js.map