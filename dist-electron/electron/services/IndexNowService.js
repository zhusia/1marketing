"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexNowService = exports.IndexNowService = void 0;
const axios_1 = __importDefault(require("axios"));
const AppRepository_1 = require("./AppRepository");
const BingWebmasterService_1 = require("./BingWebmasterService");
const id_1 = require("../utils/id");
/** Largest key-file body we will download — the file should be a single short hex line. */
const MAX_BODY_BYTES = 64 * 1024;
/** IndexNow accepts at most 10,000 URLs per submission. */
const MAX_URLS = 10000;
/** Shared endpoint that fans out to every participating engine (Bing, Yandex, Naver, Seznam, Yep). */
const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** Cap on child sitemaps fetched from a sitemap index, to bound work on large sites. */
const MAX_CHILD_SITEMAPS = 25;
/** Child sitemaps fetched at once — a burst makes many hosts stall and time out. */
const SITEMAP_CONCURRENCY = 3;
/** One retry per sitemap, since most read failures are a transient stall rather than a broken URL. */
const SITEMAP_FETCH_RETRIES = 1;
const SITEMAP_RETRY_DELAY_MS = 1500;
class IndexNowService {
    /**
     * Fetch the hosted IndexNow key file and confirm it resolves and contains the expected key.
     * Runs in the main process so the cross-origin request is not blocked by the renderer's CORS policy.
     */
    async verifyKeyFile(input) {
        const url = (input?.url ?? '').trim();
        const key = (input?.key ?? '').trim();
        const checkedAt = Date.now();
        if (!url) {
            throw new Error('A key file URL is required.');
        }
        if (!key) {
            throw new Error('A key is required.');
        }
        try {
            const response = await axios_1.default.get(url, {
                timeout: 15000,
                responseType: 'text',
                transformResponse: (raw) => raw,
                maxContentLength: MAX_BODY_BYTES,
                maxRedirects: 5,
                validateStatus: () => true,
                headers: { Accept: 'text/plain', 'User-Agent': '1MarketingTool/IndexNow-Verify' },
            });
            const status = response.status;
            const contentType = headerValue(response.headers?.['content-type']);
            const body = typeof response.data === 'string' ? response.data : String(response.data ?? '');
            const contentMatches = body.trim().toLowerCase() === key.toLowerCase();
            const ok = status === 200 && contentMatches;
            return {
                url,
                ok,
                reachable: true,
                status,
                contentMatches,
                contentType,
                message: buildMessage({ ok, status, contentMatches }),
                checkedAt,
            };
        }
        catch (error) {
            return {
                url,
                ok: false,
                reachable: false,
                status: null,
                contentMatches: false,
                contentType: null,
                message: `Could not reach the key file: ${describeError(error)}`,
                checkedAt,
            };
        }
    }
    /**
     * Submit URLs to the IndexNow protocol. URLs that do not belong to the host are dropped and
     * reported in `skipped`. Runs in the main process to avoid the renderer's CORS restrictions.
     */
    async submitUrls(input) {
        const host = normalizeHost(input?.host);
        const key = (input?.key ?? '').trim();
        const endpoint = (input?.endpoint ?? '').trim() || DEFAULT_ENDPOINT;
        const submittedAt = Date.now();
        if (!host)
            throw new Error('A project host is required.');
        if (!key)
            throw new Error('A key is required.');
        const { valid, skipped } = partitionUrlsByHost(input?.urls ?? [], host);
        if (valid.length === 0) {
            throw new Error(skipped.length > 0
                ? `None of the URLs belong to ${host}. Every URL must be on the project host.`
                : 'Add at least one URL to submit.');
        }
        const urlList = valid.slice(0, MAX_URLS);
        const keyLocation = (input?.keyLocation ?? '').trim() || `https://${host}/${key}.txt`;
        const batchId = (0, id_1.createId)();
        const persist = (status) => {
            try {
                AppRepository_1.repository.recordIndexNowSubmissions({
                    batchId,
                    productId: input?.productId ?? null,
                    host,
                    endpoint,
                    submittedAt,
                    entries: urlList.map((url) => ({ url, submitStatus: submitStatusFor(status), httpStatus: status })),
                });
            }
            catch {
                /* history is best-effort; never fail a submission because logging failed */
            }
        };
        try {
            const response = await axios_1.default.post(endpoint, { host, key, keyLocation, urlList }, {
                timeout: 30000,
                maxRedirects: 5,
                validateStatus: () => true,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
            });
            const status = response.status;
            const ok = status === 200 || status === 202;
            persist(status);
            return {
                ok,
                status,
                endpoint,
                submittedCount: ok ? urlList.length : 0,
                skipped,
                message: buildSubmitMessage({ status, count: urlList.length }),
                submittedAt,
            };
        }
        catch (error) {
            persist(null);
            return {
                ok: false,
                status: null,
                endpoint,
                submittedCount: 0,
                skipped,
                message: `Could not reach the IndexNow endpoint: ${describeError(error)}`,
                submittedAt,
            };
        }
    }
    /** Past submissions for the history table, newest first. */
    getHistory(input) {
        return AppRepository_1.repository.listIndexNowSubmissions({ productId: input?.productId, limit: input?.limit });
    }
    clearHistory(input) {
        return AppRepository_1.repository.clearIndexNowSubmissions(input?.productId);
    }
    /** The IndexNow key is public project config (not a secret), so it lives in the settings store. */
    getStoredKey(productId) {
        if (!productId)
            return null;
        const record = AppRepository_1.repository.getSetting(keySettingId(productId));
        return typeof record?.value === 'string' && record.value.trim() ? record.value.trim() : null;
    }
    setStoredKey(input) {
        const productId = input?.productId ?? '';
        const key = (input?.key ?? '').trim();
        if (!productId)
            throw new Error('A project is required.');
        if (!key)
            throw new Error('A key is required.');
        AppRepository_1.repository.setSetting(keySettingId(productId), key);
        return { key };
    }
    /**
     * The folder URL where the key file is hosted, when the user can't (or won't) write to the site
     * root. Null means "use the root". Stored as project config alongside the key.
     */
    getStoredKeyLocation(productId) {
        if (!productId)
            return null;
        const record = AppRepository_1.repository.getSetting(keyLocationSettingId(productId));
        return typeof record?.value === 'string' && record.value.trim() ? record.value.trim() : null;
    }
    /** Persist (or clear, with an empty string) the custom key-file folder for a project. */
    setStoredKeyLocation(input) {
        const productId = input?.productId ?? '';
        if (!productId)
            throw new Error('A project is required.');
        const location = (input?.location ?? '').trim();
        AppRepository_1.repository.setSetting(keyLocationSettingId(productId), location);
        return { location: location || null };
    }
    async getBingKeyStatus() {
        return { hasKey: await BingWebmasterService_1.bingWebmasterService.hasApiKey() };
    }
    async getBingKey() {
        return { apiKey: await BingWebmasterService_1.bingWebmasterService.getApiKey() };
    }
    async setBingKey(apiKey) {
        return BingWebmasterService_1.bingWebmasterService.setApiKey(apiKey);
    }
    async checkBingKey() {
        const apiKey = await BingWebmasterService_1.bingWebmasterService.getApiKey();
        const checkedAt = Date.now();
        if (!apiKey) {
            return {
                ok: false,
                message: 'Add your Bing Webmaster API key before checking it.',
                siteCount: 0,
                verifiedSiteCount: 0,
                checkedAt,
            };
        }
        const sites = await BingWebmasterService_1.bingWebmasterService.getUserSites(apiKey);
        const verifiedSiteCount = sites.filter((site) => site.isVerified).length;
        const siteCount = sites.length;
        if (verifiedSiteCount === 0) {
            return {
                ok: false,
                message: siteCount > 0
                    ? `Bing accepted the key, but none of its ${siteCount} site${siteCount === 1 ? '' : 's'} are verified yet. Verify a site in Bing Webmaster Tools, then retry.`
                    : 'Bing accepted the key, but no sites were found. Add and verify a site in Bing Webmaster Tools, then retry.',
                siteCount,
                verifiedSiteCount,
                checkedAt,
            };
        }
        return {
            ok: true,
            message: `Bing key is valid. Found ${verifiedSiteCount} verified site${verifiedSiteCount === 1 ? '' : 's'}.`,
            siteCount,
            verifiedSiteCount,
            checkedAt,
        };
    }
    /**
     * Poll Bing for the index status of submitted URLs and write the results back to history.
     * Only re-checks rows that aren't already confirmed indexed (unless explicit ids are given).
     */
    async checkIndexStatus(input, onProgress) {
        const apiKey = await BingWebmasterService_1.bingWebmasterService.getApiKey();
        if (!apiKey) {
            throw new Error('Add your Bing Webmaster API key first (IndexNow → Configure).');
        }
        const all = AppRepository_1.repository.listIndexNowSubmissions({ productId: input?.productId, limit: input?.limit ?? 200 });
        const idSet = input?.ids && input.ids.length > 0 ? new Set(input.ids) : null;
        // De-dupe by URL so a URL submitted several times is only inspected once per run.
        const seen = new Set();
        const targets = all.filter((record) => {
            if (idSet)
                return idSet.has(record.id);
            if (record.indexStatus === 'indexed')
                return false;
            if (seen.has(record.url))
                return false;
            seen.add(record.url);
            return true;
        });
        const total = targets.length;
        onProgress?.({
            kind: 'start',
            total,
            done: 0,
            url: null,
            status: null,
            message: total === 0 ? 'Nothing new to check — all URLs already indexed.' : `Checking ${total} URL${total === 1 ? '' : 's'} against Bing…`,
        });
        let checked = 0;
        let indexed = 0;
        for (const record of targets) {
            const checkedAt = Date.now();
            let result;
            try {
                result = await BingWebmasterService_1.bingWebmasterService.inspectUrl({
                    apiKey,
                    siteUrl: `https://${record.host}/`,
                    url: record.url,
                });
            }
            catch (error) {
                // An auth-level failure aborts the run — re-checking every URL would just repeat it.
                const message = error instanceof Error ? error.message : 'Bing index check failed.';
                onProgress?.({ kind: 'done', total, done: checked, url: null, status: 'error', message });
                throw error instanceof Error ? error : new Error(message);
            }
            AppRepository_1.repository.updateIndexNowIndexStatus(record.id, {
                indexStatus: result.status,
                indexedAt: result.indexedAt,
                indexCheckedAt: checkedAt,
                indexDetail: result.detail,
            });
            checked += 1;
            if (result.status === 'indexed')
                indexed += 1;
            onProgress?.({
                kind: 'item',
                total,
                done: checked,
                url: record.url,
                status: result.status,
                message: `${shortPathOf(record.url)} — ${result.detail}`,
            });
        }
        onProgress?.({
            kind: 'done',
            total,
            done: checked,
            url: null,
            status: null,
            message: total === 0 ? 'Nothing to check.' : `Done — ${indexed} indexed, ${checked - indexed} not indexed.`,
        });
        return { checked, records: AppRepository_1.repository.listIndexNowSubmissions({ productId: input?.productId, limit: input?.limit ?? 200 }) };
    }
    /**
     * Read a sitemap (or sitemap index) and return the URLs it lists that belong to the host.
     * Recurses one level into a sitemap index, bounded by MAX_CHILD_SITEMAPS.
     */
    async fetchSitemapUrls(input) {
        const host = normalizeHost(input?.host);
        if (!host)
            throw new Error('A project host is required.');
        const sitemapUrl = (input?.sitemapUrl ?? '').trim() || `https://${host}/sitemap.xml`;
        const xml = await fetchText(sitemapUrl);
        const locs = extractLocs(xml);
        const failed = [];
        let truncated = false;
        let pageUrls;
        if (isSitemapIndex(xml)) {
            const children = locs.slice(0, MAX_CHILD_SITEMAPS);
            truncated = locs.length > children.length;
            const nested = await mapWithLimit(children, SITEMAP_CONCURRENCY, async (child) => {
                try {
                    const childLocs = extractLocs(await fetchText(child));
                    // A 200 that carries no <loc> is usually a soft-404 or an HTML error page — worth
                    // naming, because it contributes nothing and the user can't tell from the count.
                    if (childLocs.length === 0)
                        failed.push({ url: child, reason: 'No <loc> entries — not a sitemap?' });
                    return childLocs;
                }
                catch (error) {
                    failed.push({ url: child, reason: sitemapFailureReason(error, child) });
                    return [];
                }
            });
            pageUrls = nested.flat();
        }
        else {
            pageUrls = locs;
        }
        const { valid } = partitionUrlsByHost(pageUrls, host);
        const urls = valid.slice(0, MAX_URLS);
        return { sitemapUrl, urls, count: urls.length, failed, truncated };
    }
}
exports.IndexNowService = IndexNowService;
/**
 * Fetch one sitemap. Retried once on a transient failure (timeout, 429, 5xx): shared hosts and WP
 * sitemap generators routinely stall under a burst, and a single stall used to surface as a
 * permanent "could not be read".
 */
async function fetchText(url, attempt = 0) {
    try {
        const response = await axios_1.default.get(url, {
            timeout: 20000,
            responseType: 'text',
            transformResponse: (raw) => raw,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: { Accept: 'application/xml,text/xml,*/*', 'User-Agent': '1MarketingTool/IndexNow' },
        });
        if (response.status !== 200) {
            if (attempt < SITEMAP_FETCH_RETRIES && (response.status === 429 || response.status >= 500)) {
                await delay(SITEMAP_RETRY_DELAY_MS);
                return fetchText(url, attempt + 1);
            }
            throw new Error(`HTTP ${response.status} from ${url}`);
        }
        return typeof response.data === 'string' ? response.data : String(response.data ?? '');
    }
    catch (error) {
        if (attempt < SITEMAP_FETCH_RETRIES && isTransientFetchError(error)) {
            await delay(SITEMAP_RETRY_DELAY_MS);
            return fetchText(url, attempt + 1);
        }
        throw error;
    }
}
function isTransientFetchError(error) {
    if (!axios_1.default.isAxiosError(error))
        return false;
    return error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET';
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Run `task` over `items` with at most `limit` in flight. Firing every child sitemap at once makes
 * many hosts stall past the timeout, which reads as "16 sitemaps are broken" when the sitemaps are
 * fine and the burst was the problem.
 */
async function mapWithLimit(items, limit, task) {
    const results = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await task(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}
/**
 * Short label for why one sitemap URL could not be read, for the "which ones failed" list. Keeps
 * the transport detail (status / DNS / timeout) but drops the ` from <url>` suffix, since the list
 * already shows the URL next to the reason.
 */
function sitemapFailureReason(error, url) {
    if (axios_1.default.isAxiosError(error)) {
        const described = describeError(error).replace(/\.$/, '');
        return described.charAt(0).toUpperCase() + described.slice(1);
    }
    const message = error instanceof Error ? error.message : '';
    return message.replace(` from ${url}`, '').trim() || 'Could not be read';
}
function extractLocs(xml) {
    const locs = [];
    const regex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let match;
    while ((match = regex.exec(xml)) !== null) {
        const value = decodeXmlEntities(match[1].trim());
        if (value)
            locs.push(value);
    }
    return locs;
}
function isSitemapIndex(xml) {
    return /<sitemapindex[\s>]/i.test(xml);
}
function decodeXmlEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
function normalizeHost(raw) {
    const value = (raw ?? '').trim();
    if (!value)
        return '';
    try {
        return new URL(value.includes('://') ? value : `https://${value}`).host;
    }
    catch {
        return '';
    }
}
function partitionUrlsByHost(urls, host) {
    const valid = [];
    const skipped = [];
    const seen = new Set();
    for (const raw of urls) {
        const trimmed = (raw ?? '').trim();
        if (!trimmed || seen.has(trimmed))
            continue;
        seen.add(trimmed);
        let parsed;
        try {
            parsed = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        }
        catch {
            skipped.push(trimmed);
            continue;
        }
        if (parsed.host.toLowerCase() === host.toLowerCase()) {
            valid.push(parsed.toString());
        }
        else {
            skipped.push(trimmed);
        }
    }
    return { valid, skipped };
}
function keySettingId(productId) {
    return `indexnow:key:${productId}`;
}
function keyLocationSettingId(productId) {
    return `indexnow:keyloc:${productId}`;
}
function shortPathOf(rawUrl) {
    try {
        const url = new URL(rawUrl);
        return `${url.pathname}${url.search}` || '/';
    }
    catch {
        return rawUrl;
    }
}
function submitStatusFor(status) {
    if (status === null)
        return 'error';
    if (status === 200)
        return 'accepted';
    if (status === 202)
        return 'pending';
    return 'rejected';
}
function buildSubmitMessage(args) {
    switch (args.status) {
        case 200:
            return `Submitted ${args.count} URL${args.count === 1 ? '' : 's'} — accepted by IndexNow.`;
        case 202:
            return `Submitted ${args.count} URL${args.count === 1 ? '' : 's'} — accepted, key validation pending.`;
        case 400:
            return 'Rejected (400): the request was malformed.';
        case 403:
            return 'Rejected (403): the key could not be verified. Host the key file and run Verify first.';
        case 422:
            return 'Rejected (422): a URL did not belong to the host or the key did not match.';
        case 429:
            return 'Rejected (429): too many requests. Wait a moment and try again.';
        default:
            return `IndexNow returned HTTP ${args.status}.`;
    }
}
function buildMessage(args) {
    if (args.ok) {
        return 'Verified — the key file is live and its contents match. Search engines can confirm you own this host.';
    }
    if (args.status !== 200) {
        return `The key file returned HTTP ${args.status}. Upload it to your site root so it resolves with a 200.`;
    }
    if (!args.contentMatches) {
        return 'The file is reachable but its contents do not match. It must contain exactly the key and nothing else.';
    }
    return 'The key file could not be verified.';
}
function headerValue(value) {
    if (typeof value === 'string')
        return value.split(';')[0]?.trim() || null;
    if (Array.isArray(value) && typeof value[0] === 'string')
        return value[0].split(';')[0]?.trim() || null;
    return null;
}
function describeError(error) {
    if (axios_1.default.isAxiosError(error)) {
        if (error.code === 'ECONNABORTED')
            return 'the request timed out.';
        if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN')
            return 'the host could not be resolved.';
        if (error.code === 'ECONNREFUSED')
            return 'the connection was refused.';
        return error.message;
    }
    return error instanceof Error ? error.message : 'unknown error.';
}
exports.indexNowService = new IndexNowService();
//# sourceMappingURL=IndexNowService.js.map