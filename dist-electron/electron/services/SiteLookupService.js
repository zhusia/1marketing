"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.siteLookupService = void 0;
const axios_1 = __importDefault(require("axios"));
/**
 * Business name -> website candidates for the zero-key first run
 * (docs/onboarding_v2.md §3.1). Scrapes DuckDuckGo's HTML endpoint — no API
 * key, no browser session — and returns a small confirm list; the user always
 * confirms before anything is scanned. Failures degrade to an empty list and
 * the UI falls back to "paste your URL".
 */
const LOOKUP_ENDPOINT = 'https://html.duckduckgo.com/html/';
const LOOKUP_TIMEOUT_MS = 8000;
const MAX_CANDIDATES = 5;
/** Hosts that are almost never the business's own website. */
const AGGREGATOR_HOSTS = new Set([
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'twitter.com',
    'x.com',
    'youtube.com',
    'tiktok.com',
    'pinterest.com',
    'reddit.com',
    'wikipedia.org',
    'yelp.com',
    'tripadvisor.com',
    'amazon.com',
    'medium.com',
    'crunchbase.com',
    'play.google.com',
    'apps.apple.com',
    'g2.com',
    'capterra.com',
    'trustpilot.com',
]);
function stripTags(value) {
    return value
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/\s+/g, ' ')
        .trim();
}
/** DuckDuckGo result links are redirect URLs carrying the real target in `uddg`. */
function resolveResultUrl(href) {
    const uddgMatch = href.match(/[?&]uddg=([^&]+)/);
    if (uddgMatch) {
        try {
            const decoded = decodeURIComponent(uddgMatch[1]);
            return /^https?:\/\//i.test(decoded) ? decoded : null;
        }
        catch {
            return null;
        }
    }
    if (/^https?:\/\//i.test(href))
        return href;
    return null;
}
function hostOf(url) {
    try {
        return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
    }
    catch {
        return null;
    }
}
class SiteLookupService {
    async lookupBusinessSites(query) {
        const trimmed = query.trim();
        if (!trimmed)
            return [];
        let html;
        try {
            const response = await axios_1.default.get(LOOKUP_ENDPOINT, {
                params: { q: `${trimmed} official website` },
                timeout: LOOKUP_TIMEOUT_MS,
                responseType: 'text',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
                    Accept: 'text/html',
                },
            });
            html = typeof response.data === 'string' ? response.data : '';
        }
        catch {
            return [];
        }
        const candidates = [];
        const seenHosts = new Set();
        const linkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        for (const match of html.matchAll(linkPattern)) {
            const [, rawHref, rawTitle] = match;
            // Skip ad redirects — they route through DuckDuckGo's ad click endpoint.
            if (rawHref.includes('y.js') || rawHref.includes('ad_domain'))
                continue;
            const url = resolveResultUrl(rawHref);
            if (!url)
                continue;
            const host = hostOf(url);
            if (!host || seenHosts.has(host) || AGGREGATOR_HOSTS.has(host))
                continue;
            seenHosts.add(host);
            candidates.push({ url, host, title: stripTags(rawTitle) });
            if (candidates.length >= MAX_CANDIDATES)
                break;
        }
        return candidates;
    }
}
exports.siteLookupService = new SiteLookupService();
//# sourceMappingURL=SiteLookupService.js.map