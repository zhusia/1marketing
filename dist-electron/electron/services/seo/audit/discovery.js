"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchRobots = fetchRobots;
exports.buildIsAllowed = buildIsAllowed;
exports.collectSitemapUrls = collectSitemapUrls;
/**
 * robots.txt and sitemap discovery for the site audit crawler.
 *
 * A deliberately small robots parser: it reads the rules that apply to `*` (and
 * our own user-agent) and exposes a prefix-based isAllowed() check, plus any
 * Sitemap: directives. Sitemap reading reuses the same regex/index-recursion
 * approach as IndexNowService.
 */
const axios_1 = __importDefault(require("axios"));
const USER_AGENT = '1MarketingTool/SiteAudit';
const MAX_CHILD_SITEMAPS = 25;
async function fetchText(url, timeout) {
    try {
        const response = await axios_1.default.get(url, {
            timeout,
            responseType: 'text',
            transformResponse: (raw) => raw,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: { Accept: 'text/plain,application/xml,text/xml,*/*', 'User-Agent': USER_AGENT },
        });
        if (response.status !== 200)
            return null;
        return typeof response.data === 'string' ? response.data : String(response.data ?? '');
    }
    catch {
        return null;
    }
}
/** Fetch and parse robots.txt; missing/unreachable robots means "crawl everything". */
async function fetchRobots(origin) {
    const rules = { disallow: [], allow: [], sitemapUrls: [] };
    const text = await fetchText(`${origin}/robots.txt`, 10_000);
    if (!text)
        return rules;
    let applies = false;
    let prevWasAgent = false;
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/#.*$/, '').trim();
        if (!line) {
            prevWasAgent = false;
            continue;
        }
        const idx = line.indexOf(':');
        if (idx === -1)
            continue;
        const field = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (field === 'user-agent') {
            const ua = value.toLowerCase();
            const matches = ua === '*' || USER_AGENT.toLowerCase().includes(ua);
            // Consecutive User-agent lines share the rules that follow them, so OR them.
            applies = prevWasAgent ? applies || matches : matches;
            prevWasAgent = true;
            continue;
        }
        prevWasAgent = false;
        if (field === 'sitemap' && value) {
            rules.sitemapUrls.push(value);
        }
        else if (applies && field === 'disallow' && value) {
            rules.disallow.push(value);
        }
        else if (applies && field === 'allow' && value) {
            rules.allow.push(value);
        }
    }
    return rules;
}
function matchesPrefix(path, pattern) {
    // Support a trailing '*' wildcard; otherwise treat the directive as a prefix.
    const clean = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return path.startsWith(clean);
}
/** Build a path-prefix allow/deny checker from parsed robots rules (longest match wins). */
function buildIsAllowed(rules) {
    if (rules.disallow.length === 0)
        return () => true;
    return (url) => {
        let path;
        try {
            const parsed = new URL(url);
            path = `${parsed.pathname}${parsed.search}`;
        }
        catch {
            return true;
        }
        let denyLen = -1;
        for (const pattern of rules.disallow) {
            if (matchesPrefix(path, pattern) && pattern.length > denyLen)
                denyLen = pattern.length;
        }
        if (denyLen === -1)
            return true;
        for (const pattern of rules.allow) {
            if (matchesPrefix(path, pattern) && pattern.length >= denyLen)
                return true;
        }
        return false;
    };
}
function extractLocs(xml) {
    const locs = [];
    const regex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let match;
    while ((match = regex.exec(xml)) !== null) {
        const value = match[1]
            .trim()
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        if (value)
            locs.push(value);
    }
    return locs;
}
/**
 * Collect page URLs from the site's sitemap(s), recursing one level into a
 * sitemap index. Returns same-host URLs, deduped and capped at `cap`.
 */
async function collectSitemapUrls(origin, robotsSitemaps, host, cap) {
    const roots = robotsSitemaps.length > 0 ? robotsSitemaps : [`${origin}/sitemap.xml`];
    const collected = [];
    const seen = new Set();
    for (const root of roots) {
        const xml = await fetchText(root, 15_000);
        if (!xml)
            continue;
        const locs = extractLocs(xml);
        let pageUrls;
        if (/<sitemapindex[\s>]/i.test(xml)) {
            const children = locs.slice(0, MAX_CHILD_SITEMAPS);
            const nested = await Promise.all(children.map((child) => fetchText(child, 15_000)));
            pageUrls = nested.flatMap((doc) => (doc ? extractLocs(doc) : []));
        }
        else {
            pageUrls = locs;
        }
        for (const raw of pageUrls) {
            let parsed;
            try {
                parsed = new URL(raw);
            }
            catch {
                continue;
            }
            if (parsed.host.toLowerCase() !== host.toLowerCase())
                continue;
            parsed.hash = '';
            const normalized = parsed.toString();
            if (seen.has(normalized))
                continue;
            seen.add(normalized);
            collected.push(normalized);
            if (collected.length >= cap)
                return collected;
        }
    }
    return collected;
}
//# sourceMappingURL=discovery.js.map