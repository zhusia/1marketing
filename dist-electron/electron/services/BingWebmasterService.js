"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bingWebmasterService = exports.BingWebmasterService = void 0;
const axios_1 = __importDefault(require("axios"));
const CredentialVault_1 = require("./CredentialVault");
const domain_1 = require("../utils/domain");
const BING_ENDPOINT = 'https://ssl.bing.com/webmaster/api.svc/json';
/** Vault account the Bing Webmaster API key is stored under. */
const VAULT_ACCOUNT = 'bing_webmaster';
/**
 * Thin client for Bing Webmaster Tools. IndexNow itself never reports indexing, so we poll
 * Bing's `GetUrlInfo` endpoint to learn whether a submitted URL made it into Bing's index.
 * Requires a Bing Webmaster API key and the site to be verified in Bing Webmaster Tools.
 */
class BingWebmasterService {
    async getApiKey() {
        const secret = await CredentialVault_1.credentialVault.getSecret(VAULT_ACCOUNT);
        const key = typeof secret?.apiKey === 'string' ? secret.apiKey.trim() : '';
        return key || null;
    }
    async hasApiKey() {
        return (await this.getApiKey()) !== null;
    }
    /** Save (or clear, when empty) the Bing Webmaster API key in the OS keychain. */
    async setApiKey(apiKey) {
        const trimmed = (apiKey ?? '').trim();
        if (!trimmed) {
            await CredentialVault_1.credentialVault.removeSecret(VAULT_ACCOUNT);
            return { hasKey: false };
        }
        await CredentialVault_1.credentialVault.setSecret(VAULT_ACCOUNT, { apiKey: trimmed });
        return { hasKey: true };
    }
    /**
     * Ask Bing what it knows about a URL. Auth failures throw (so the UI can prompt for a key);
     * per-URL anomalies resolve to an `error`/`not_indexed` status so one bad URL never kills a batch.
     */
    async inspectUrl(input) {
        const params = new URLSearchParams({ apikey: input.apiKey, siteUrl: input.siteUrl, url: input.url });
        const response = await axios_1.default.get(`${BING_ENDPOINT}/GetUrlInfo?${params.toString()}`, {
            timeout: 20000,
            validateStatus: () => true,
            headers: { Accept: 'application/json' },
        });
        const raw = response.data;
        const body = (typeof raw === 'string' ? safeJson(raw) : raw);
        const message = cleanMessage(body?.Message);
        if (response.status !== 200) {
            // ErrorCode 14 / "NotAuthorized" means the site isn't verified for this key — a per-site
            // failure that will repeat for every URL, so throw to abort the run with a clear message.
            if (response.status === 400 && (body?.ErrorCode === 14 || /not\s*author/i.test(body?.Message ?? ''))) {
                throw new Error(`Bing hasn’t authorized ${input.siteUrl} for this API key. Add and verify the site in Bing Webmaster Tools, then retry.`);
            }
            if (response.status === 401 || response.status === 403) {
                throw new Error('Bing rejected the API key. Check the key and that the site is verified in Bing Webmaster Tools.');
            }
            return { status: 'error', indexedAt: null, detail: `Bing: ${message ?? `HTTP ${response.status}`}` };
        }
        // Some auth/quota faults arrive as HTTP 200 with a Message and no `d`.
        if (message && !body?.d) {
            if (/auth/i.test(message)) {
                throw new Error(`Bing hasn’t authorized ${input.siteUrl} for this API key. Verify the site in Bing Webmaster Tools.`);
            }
            return { status: 'error', indexedAt: null, detail: `Bing: ${message}` };
        }
        const info = body?.d ?? null;
        if (!info) {
            return { status: 'not_indexed', indexedAt: null, detail: 'Not found in Bing’s index yet.' };
        }
        // GetUrlInfo returns HttpStatus 0 and IsPage true even for unknown URLs, so neither is a
        // reliable "indexed" signal. A real LastCrawledDate (positive epoch) plus a non-zero
        // DocumentSize is what distinguishes a crawled/indexed page from a never-seen one.
        const lastCrawled = parseAspNetDate(info.LastCrawledDate);
        const discovered = parseAspNetDate(info.DiscoveryDate);
        const documentSize = typeof info.DocumentSize === 'number' ? info.DocumentSize : 0;
        const httpError = typeof info.HttpStatus === 'number' && info.HttpStatus >= 400;
        if (!httpError && lastCrawled !== null && documentSize > 0) {
            const discoveredLabel = discovered ? `, discovered ${new Date(discovered).toISOString().slice(0, 10)}` : '';
            return { status: 'indexed', indexedAt: lastCrawled, detail: `Crawled by Bing (${documentSize.toLocaleString()} bytes${discoveredLabel}).` };
        }
        if (httpError) {
            return { status: 'not_indexed', indexedAt: null, detail: `Bing saw HTTP ${info.HttpStatus} for this URL.` };
        }
        return { status: 'not_indexed', indexedAt: null, detail: 'Known to Bing but not crawled yet.' };
    }
    async getLinkCounts(input) {
        const body = await this.requestBing('GetLinkCounts', {
            apikey: input.apiKey,
            siteUrl: input.siteUrl,
            page: String(input.page),
        });
        return {
            links: (body?.Links ?? [])
                .map((row) => ({
                url: typeof row.Url === 'string' ? row.Url : '',
                count: typeof row.Count === 'number' ? row.Count : 0,
            }))
                .filter((row) => row.url.length > 0),
            totalPages: positiveInteger(body?.TotalPages) ?? 0,
        };
    }
    async getUrlLinks(input) {
        const quotedBody = await this.requestBing('GetUrlLinks', {
            apikey: input.apiKey,
            siteUrl: input.siteUrl,
            link: bingLinkParameter(input.link),
            page: String(input.page),
        });
        const quotedDetails = normalizeLinkDetails(quotedBody);
        if (quotedDetails.details.length > 0 || input.page > 0)
            return quotedDetails;
        // Older samples show a JSON-quoted link parameter, but some accounts accept the plain URL.
        const plainBody = await this.requestBing('GetUrlLinks', {
            apikey: input.apiKey,
            siteUrl: input.siteUrl,
            link: input.link,
            page: String(input.page),
        });
        const plainDetails = normalizeLinkDetails(plainBody);
        return plainDetails.details.length > 0 ? plainDetails : quotedDetails;
    }
    async getUserSites(apiKey) {
        const resolvedApiKey = apiKey ?? (await this.getApiKey());
        if (!resolvedApiKey) {
            throw new Error('Add your Bing Webmaster API key before loading Bing sites.');
        }
        const body = await this.requestBing('GetUserSites', { apikey: resolvedApiKey });
        return (body ?? [])
            .map((site) => ({
            url: typeof site.Url === 'string' ? site.Url : '',
            isVerified: site.IsVerified === true,
        }))
            .filter((site) => site.url.length > 0);
    }
    async resolveVerifiedSiteUrl(input) {
        const targetUrl = normalizeSiteUrl(input.siteUrl);
        const targetHost = (0, domain_1.extractDomain)(targetUrl);
        const sites = await this.getUserSites(input.apiKey);
        const verifiedSites = sites.filter((site) => site.isVerified);
        const exact = verifiedSites.find((site) => normalizeSiteUrl(site.url) === targetUrl);
        if (exact)
            return exact.url;
        const hostMatch = verifiedSites.find((site) => (0, domain_1.extractDomain)(site.url) === targetHost);
        if (hostMatch)
            return hostMatch.url;
        const available = verifiedSites.slice(0, 5).map((site) => site.url).join(', ');
        throw new Error(available
            ? `Bing Webmaster API key is saved, but ${targetHost} is not one of its verified sites. Verified sites: ${available}.`
            : `Bing Webmaster API key is saved, but it has no verified sites. Verify ${targetHost} in Bing Webmaster Tools first.`);
    }
    async getBacklinkProfile(input) {
        const apiKey = input.apiKey ?? (await this.getApiKey());
        if (!apiKey) {
            throw new Error('Add your Bing Webmaster API key before loading Bing backlinks.');
        }
        const siteUrl = await this.resolveVerifiedSiteUrl({ apiKey, siteUrl: input.siteUrl });
        const limit = Math.min(Math.max(Math.round(input.limit ?? 50), 1), 1000);
        const maxLinkCountPages = Math.min(Math.max(Math.round(input.maxLinkCountPages ?? 20), 1), 50);
        const maxLinkedPages = Math.min(Math.max(Math.round(input.maxLinkedPages ?? limit), 1), 100);
        const maxDetailPagesPerLink = Math.min(Math.max(Math.round(input.maxDetailPagesPerLink ?? 5), 1), 20);
        const targetPages = [];
        for (let page = 0; page < maxLinkCountPages; page += 1) {
            const result = await this.getLinkCounts({ apiKey, siteUrl, page });
            targetPages.push(...result.links);
            if (page + 1 >= result.totalPages)
                break;
        }
        targetPages.sort((a, b) => b.count - a.count);
        const domainCounts = new Map();
        const anchorCounts = new Map();
        for (const target of targetPages.slice(0, maxLinkedPages)) {
            for (let page = 0; page < maxDetailPagesPerLink; page += 1) {
                const result = await this.getUrlLinks({ apiKey, siteUrl, link: target.url, page });
                for (const detail of result.details) {
                    const sourceDomain = (0, domain_1.extractDomain)(detail.url);
                    if (!sourceDomain)
                        continue;
                    domainCounts.set(sourceDomain, (domainCounts.get(sourceDomain) ?? 0) + 1);
                    const anchor = detail.anchorText.trim() || 'No anchor text';
                    const existing = anchorCounts.get(anchor) ?? { backlinks: 0, domains: new Set() };
                    existing.backlinks += 1;
                    existing.domains.add(sourceDomain);
                    anchorCounts.set(anchor, existing);
                }
                if (page + 1 >= result.totalPages)
                    break;
            }
            await wait(50);
        }
        return {
            domain: siteUrl,
            referringDomains: Array.from(domainCounts.entries())
                .map(([domain, backlinks]) => ({ domain, backlinks, domainRank: null }))
                .sort((a, b) => b.backlinks - a.backlinks)
                .slice(0, limit),
            anchors: Array.from(anchorCounts.entries())
                .map(([anchor, row]) => ({
                anchor,
                backlinks: row.backlinks,
                referringDomains: row.domains.size,
            }))
                .sort((a, b) => b.backlinks - a.backlinks)
                .slice(0, limit),
            source: 'bing_webmaster',
        };
    }
    async requestBing(method, params) {
        const query = new URLSearchParams(params);
        const response = await axios_1.default.get(`${BING_ENDPOINT}/${method}?${query.toString()}`, {
            timeout: 30000,
            validateStatus: () => true,
            headers: { Accept: 'application/json' },
        });
        const raw = response.data;
        const body = (typeof raw === 'string' ? safeJson(raw) : raw);
        const message = cleanMessage(body?.Message);
        const siteUrl = params.siteUrl ?? 'this site';
        if (response.status !== 200) {
            if (response.status === 400 && (body?.ErrorCode === 14 || /not\s*author/i.test(body?.Message ?? ''))) {
                throw new Error(`Bing hasn’t authorized ${siteUrl} for this API key. Add and verify the site in Bing Webmaster Tools, then retry.`);
            }
            if (response.status === 401 || response.status === 403) {
                throw new Error('Bing rejected the API key. Check the key and that the site is verified in Bing Webmaster Tools.');
            }
            throw new Error(`Bing: ${message ?? `HTTP ${response.status}`}`);
        }
        if (message && !body?.d) {
            if (/auth/i.test(message)) {
                throw new Error(`Bing hasn’t authorized ${siteUrl} for this API key. Verify the site in Bing Webmaster Tools.`);
            }
            throw new Error(`Bing: ${message}`);
        }
        return body?.d ?? null;
    }
}
exports.BingWebmasterService = BingWebmasterService;
function safeJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
/** Bing error messages arrive like "ERROR!!! NotAuthorized" — strip the shouting prefix. */
function cleanMessage(value) {
    if (typeof value !== 'string')
        return null;
    const cleaned = value.replace(/^ERROR!+\s*/i, '').trim();
    return cleaned || null;
}
/**
 * Parse Bing's ASP.NET `/Date(ms)/` (or `/Date(ms-0700)/`) timestamps. Returns null for the
 * .NET min-date sentinel (year 0001, a large negative value) that marks "never crawled".
 */
function parseAspNetDate(value) {
    if (typeof value !== 'string')
        return null;
    const match = value.match(/\/Date\((-?\d+)/);
    if (match) {
        const ms = Number(match[1]);
        return Number.isFinite(ms) && ms > 0 ? ms : null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function normalizeSiteUrl(value) {
    try {
        const parsed = new URL(value.startsWith('http') ? value : `https://${value}`);
        return `${parsed.origin}/`;
    }
    catch {
        return value;
    }
}
function bingLinkParameter(value) {
    return JSON.stringify(value).replace(/\//g, '\\/');
}
function positiveInteger(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}
function normalizeLinkDetails(body) {
    return {
        details: (body?.Details ?? [])
            .map((row) => ({
            anchorText: typeof row.AnchorText === 'string' ? row.AnchorText : '',
            url: typeof row.Url === 'string' ? row.Url : '',
        }))
            .filter((row) => row.url.length > 0),
        totalPages: positiveInteger(body?.TotalPages) ?? 0,
    };
}
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.bingWebmasterService = new BingWebmasterService();
//# sourceMappingURL=BingWebmasterService.js.map