"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serpScrapeService = exports.SerpScrapeService = void 0;
const zod_1 = require("zod");
const domain_1 = require("../../utils/domain");
const providerFactory_1 = require("../browser/providerFactory");
const AiPageExtractor_1 = require("../ai/AiPageExtractor");
const DEFAULT_LOCATION = 'United States';
/** Cap on how many ranking pages we visit for deep heading extraction (bounds time + bot exposure). */
const MAX_DEEP_PAGES = 6;
const MAX_HEADINGS = 60;
/** How long to wait for an AI Overview to render before snapshotting (0 disables; env-tunable). */
const DEFAULT_AIO_WAIT_MS = 8_000;
/** The visible label Google renders above an AI Overview (forced English via hl=en). */
const AIO_SIGNAL = /\bAI Overview\b/i;
/** Bot-check / consent-wall phrases that mean there is no overview coming. */
const BLOCK_SIGNAL = /unusual traffic|are you a robot|recaptcha|verify (it'?s )?you|before you continue to google|consent\.google|accept all|reject all/i;
/**
 * In-page poll (Electron `evaluate` fast-path): waits for the AI Overview block
 * to appear, clicks its "Show more" expander once so we capture the full answer
 * (not just the collapsed preview), then resolves when its text stops growing.
 * Returns early on a bot/consent wall or when `maxMs` elapses. It only gates
 * *when* we snapshot — the snapshot's LLM extractor remains the source of truth
 * for what the overview actually says.
 */
const AIO_WAIT_SCRIPT = `async function (maxMs) {
  var deadline = Date.now() + maxMs;
  var sleep = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };

  function blocked() {
    var text = (document.body && document.body.innerText || '').toLowerCase();
    return /unusual traffic|are you a robot|recaptcha|verify (it'?s )?you|before you continue to google|consent\\.google/.test(text);
  }

  // The AI Overview container (climbed from its label), or null if absent so far.
  function overviewRoot() {
    var nodes = document.querySelectorAll('h1, h2, h3, span, div[role="heading"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.children.length > 4) continue;
      if (!/^ai overview\\b/i.test((el.textContent || '').trim())) continue;
      var node = el;
      for (var up = 0; up < 6 && node.parentElement; up++) node = node.parentElement;
      if ((node.innerText || '').trim().length > 60) return node;
    }
    return null;
  }

  // Click the overview's own "Show more" expander, scoped to its container so we
  // don't trip other SERP modules' expanders. Returns true once it clicks.
  function expand(root) {
    var clickables = root.querySelectorAll('[role="button"], button, [aria-expanded]');
    for (var i = 0; i < clickables.length; i++) {
      var node = clickables[i];
      var label = (node.textContent || node.getAttribute('aria-label') || '').trim();
      if (/^show (more|all)\\b/i.test(label)) { node.click(); return true; }
    }
    return false;
  }

  var lastLen = -1;
  var stable = 0;
  var expanded = false;
  while (Date.now() < deadline) {
    if (blocked()) return;
    var root = overviewRoot();
    if (root) {
      if (!expanded) expanded = expand(root);
      var len = (root.innerText || '').trim().length;
      if (len === lastLen) {
        if (++stable >= 2) return;
      } else {
        stable = 0;
      }
      lastLen = len;
    }
    await sleep(500);
  }
}`;
/**
 * Deterministic in-page extractor for Google organic results. Each organic
 * result is an <a> wrapping an <h3>; we unwrap Google redirect links and drop
 * Google's own properties. Runs via BrowserProvider.evaluate on the Electron
 * engine; the AI-snapshot path is the fallback for engines without evaluate.
 */
const SERP_EXTRACT_SCRIPT = `(() => {
  const out = [];
  const seen = new Set();
  for (const a of Array.from(document.querySelectorAll('a'))) {
    const h3 = a.querySelector('h3');
    if (!h3) continue;
    let href = a.href || '';
    if (!href) continue;
    try {
      const u = new URL(href, location.href);
      if (u.pathname === '/url') href = u.searchParams.get('q') || u.searchParams.get('url') || href;
    } catch (e) { continue; }
    if (!/^https?:\\/\\//i.test(href)) continue;
    let host = '';
    try { host = new URL(href).hostname.replace(/^www\\./, ''); } catch (e) { continue; }
    if (/(^|\\.)google\\.|gstatic\\.com|googleusercontent\\.com|youtube\\.com\\/redirect/i.test(host)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ title: (h3.textContent || '').trim(), url: href, domain: host });
    if (out.length >= 30) break;
  }
  return out;
})()`;
/** Deterministic on-page outline extractor: title, meta description, and the H1/H2/H3 tree. */
const OUTLINE_EXTRACT_SCRIPT = `(() => {
  const meta = document.querySelector('meta[name="description"]');
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .map((h) => ({ level: h.tagName.toLowerCase(), text: (h.textContent || '').replace(/\\s+/g, ' ').trim() }))
    .filter((h) => h.text);
  return {
    title: document.title || null,
    metaDescription: meta ? meta.getAttribute('content') : null,
    headings,
  };
})()`;
const SerpAiSchema = zod_1.z.object({
    results: zod_1.z.array(zod_1.z.object({
        title: zod_1.z.string().nullable(),
        url: zod_1.z.string(),
        domain: zod_1.z.string().nullable(),
    })),
});
const AiOverviewAiSchema = zod_1.z.object({
    found: zod_1.z.boolean(),
    text: zod_1.z.string(),
    citations: zod_1.z.array(zod_1.z.object({
        url: zod_1.z.string(),
        domain: zod_1.z.string().nullable(),
        title: zod_1.z.string().nullable(),
    })),
});
const OutlineAiSchema = zod_1.z.object({
    title: zod_1.z.string().nullable(),
    metaDescription: zod_1.z.string().nullable(),
    headings: zod_1.z.array(zod_1.z.object({
        level: zod_1.z.enum(['h1', 'h2', 'h3']),
        text: zod_1.z.string(),
    })),
});
function resolveLocation(location) {
    return (location ?? '').trim() || DEFAULT_LOCATION;
}
function sanitizeHeadings(headings) {
    return headings
        .map((heading) => ({ level: heading.level, text: heading.text.replace(/\s+/g, ' ').trim() }))
        .filter((heading) => heading.text && heading.text.length <= 180)
        .slice(0, MAX_HEADINGS);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Debug aid: set ONE_MARKETING_TOOL_SCRAPE_VISIBLE=1 to show the scrape window so
 * you can watch what Google serves it (e.g. a consent/CAPTCHA wall). Off by
 * default, so normal runs stay in the background.
 */
function scrapeWindowVisible() {
    return process.env.ONE_MARKETING_TOOL_SCRAPE_VISIBLE === '1';
}
/**
 * How long to wait for an AI Overview to render. Override with
 * ONE_MARKETING_TOOL_AIO_WAIT_MS (set 0 to snapshot immediately, e.g. to
 * reproduce the old behavior when comparing detection rates).
 */
function aiOverviewWaitMs() {
    const raw = Number(process.env.ONE_MARKETING_TOOL_AIO_WAIT_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_AIO_WAIT_MS;
}
/**
 * Scrapes Google's SERP (and, for content briefs, the ranking pages themselves)
 * in a fresh, non-persistent Electron browser session — a private window with no
 * saved login or cookies. This is the free, BYO-IP alternative to the DataForSEO
 * SERP API. It never attempts to solve CAPTCHAs: if Google serves a bot check or
 * consent wall, the scrape fails with a clear message so callers can fall back.
 */
class SerpScrapeService {
    /** Scrape the organic results for a keyword. */
    async scrapeSerp(keyword, location, depth = 20, engine) {
        const provider = this.createProvider(engine);
        try {
            const items = await this.openAndExtractSerp(provider, keyword, depth);
            return this.toSerpResponse(keyword, location, items, depth);
        }
        finally {
            await provider.close().catch(() => undefined);
        }
    }
    /**
     * Deep mode for content briefs: scrape the SERP, then visit the top pages and
     * capture their real H1/H2/H3 outlines — context DataForSEO's SERP endpoint
     * can't provide. All in one reused browser session.
     */
    async scrapeBriefSources(keyword, location, depth = 10, engine) {
        const provider = this.createProvider(engine);
        try {
            const items = await this.openAndExtractSerp(provider, keyword, depth);
            const serp = this.toSerpResponse(keyword, location, items, depth);
            const outlines = [];
            for (const result of serp.results.slice(0, MAX_DEEP_PAGES)) {
                if (!result.url)
                    continue;
                const outline = await this.scrapePageOutline(provider, result.url).catch(() => null);
                if (outline && outline.headings.length > 0)
                    outlines.push(outline);
            }
            return { serp, outlines };
        }
        finally {
            await provider.close().catch(() => undefined);
        }
    }
    /**
     * Scrape Google's AI Overview panel for a term (the free, no-key fetch source
     * for AI Visibility). Opens a cookieless window, snapshots the SERP, and uses
     * the AI page extractor to pull the AI Overview answer text + its cited links.
     * AI Mode is not reachable this way (gated/sign-in) — callers fall back to
     * DataForSEO for that engine. Returns found=false when no AI Overview renders.
     */
    async scrapeAiOverview(term, location) {
        const cleanTerm = term.trim();
        if (!cleanTerm)
            throw new Error('Search term is required.');
        const provider = this.createProvider();
        try {
            void location; // geo follows the machine IP for scrape; reserved for future proxy support
            const url = `https://www.google.com/search?q=${encodeURIComponent(cleanTerm)}&num=10&hl=en&gl=us&pws=0`;
            const visible = scrapeWindowVisible();
            await provider.open(url, { visible, waitForBodyMs: 30_000 });
            // AI Overviews are injected after the SERP body loads, then stream their
            // text in. Snapshotting immediately (the old headless behavior) caught the
            // page before the overview rendered, so it was misreported as "no AI
            // Overview". Wait for it to appear, expand "Show more", and settle first.
            await this.waitForAiOverview(provider, aiOverviewWaitMs());
            if (visible)
                await sleep(1500); // extra dwell so the final state is watchable
            const snapshot = await provider.snapshot({ maxChars: 20_000, maxLinks: 100 });
            this.assertNotBlocked(snapshot);
            const extracted = await AiPageExtractor_1.aiPageExtractor.extract({
                snapshot,
                schema: AiOverviewAiSchema,
                instructions: [
                    'This is a Google search results page. Find the AI Overview (AI-generated answer summary) block, usually at the very top.',
                    'Return its full answer text and the list of source/reference links it cites (the destination URLs, not google.com redirects).',
                    'If there is no AI Overview block on the page, return found=false with empty text and citations.',
                ].join(' '),
                schemaHint: '{ "found": boolean, "text": string, "citations": [{ "url": string, "domain": string|null, "title": string|null }] }',
            });
            const text = (extracted.text ?? '').trim();
            const citations = (extracted.citations ?? [])
                .filter((citation) => typeof citation.url === 'string' && /^https?:\/\//i.test(citation.url))
                .map((citation) => ({
                url: citation.url,
                domain: citation.domain?.trim() || (0, domain_1.extractDomain)(citation.url),
                title: citation.title?.trim() || null,
            }));
            return {
                engine: 'ai_overview',
                term: cleanTerm,
                found: Boolean(extracted.found) && text.length > 0,
                text,
                citations,
                source: 'browser',
                cost: 0,
            };
        }
        finally {
            await provider.close().catch(() => undefined);
        }
    }
    /**
     * Wait for Google's AI Overview to render and settle before we snapshot.
     *
     * The overview is injected after the SERP body loads and then streams its text
     * in, so the old path (snapshot immediately, dwell only when the window is
     * visible) frequently captured the page before it appeared and logged a false
     * "no AI Overview". This polls for the overview to show up and stop growing,
     * bounded by `maxMs` so queries that genuinely have none — or a bot/consent
     * wall — fall through quickly. Prefers the cheap in-page poll on Electron and
     * falls back to snapshot polling for providers without `evaluate` (BrowserMCP).
     */
    async waitForAiOverview(provider, maxMs) {
        if (maxMs <= 0)
            return;
        const evaluate = provider.evaluate?.bind(provider);
        if (evaluate) {
            await evaluate(`(${AIO_WAIT_SCRIPT})(${maxMs})`).catch(() => undefined);
            return;
        }
        const deadline = Date.now() + maxMs;
        let expanded = false;
        while (Date.now() < deadline) {
            const snapshot = await provider.snapshot({ maxChars: 6_000, maxLinks: 0, includeControls: true }).catch(() => null);
            const text = snapshot?.text ?? '';
            if (BLOCK_SIGNAL.test(text))
                return; // bot/consent wall — assertNotBlocked will report it
            if (AIO_SIGNAL.test(text)) {
                // Best-effort expand: no container scoping over the flat button list, so
                // match the exact label and take the first "Show more"/"Show all".
                const expander = expanded ? undefined : snapshot?.buttons.find((button) => /^show (more|all)\b/i.test(button.text.trim()));
                if (expander) {
                    await provider.act([{ action: 'click', selector: expander.selector }]).catch(() => undefined);
                    expanded = true;
                    await sleep(1_200); // let the expanded answer render before re-checking
                    continue;
                }
                await sleep(1_200); // let the streamed answer fill in before snapshotting
                return;
            }
            await sleep(700);
        }
    }
    createProvider(engine) {
        // A partition without the `persist:` prefix is an in-memory session, and a
        // unique value per run guarantees a clean (cookieless, logged-out) window.
        // `engine` forces a specific provider (Electron window vs BrowserMCP) for the
        // run; when omitted it follows the user's global browser-engine setting.
        return (0, providerFactory_1.createBrowserProvider)({
            partition: `serp-scrape:${Date.now()}:${Math.random().toString(36).slice(2)}`,
            title: '1MarketingTool - SERP scrape',
        }, engine);
    }
    toSerpResponse(keyword, location, items, depth) {
        const results = items.slice(0, depth).map((item, index) => ({
            rank: index + 1,
            title: item.title,
            url: item.url,
            domain: item.domain ?? (item.url ? (0, domain_1.extractDomain)(item.url) : null),
            description: null,
        }));
        return {
            keyword: keyword.trim(),
            location: resolveLocation(location),
            results,
            peopleAlsoAsk: [],
            relatedSearches: [],
            source: 'browser',
        };
    }
    async openAndExtractSerp(provider, keyword, depth) {
        const cleanKeyword = keyword.trim();
        if (!cleanKeyword)
            throw new Error('Keyword is required.');
        const num = Math.min(Math.max(depth, 10), 30);
        const url = `https://www.google.com/search?q=${encodeURIComponent(cleanKeyword)}&num=${num}&hl=en&gl=us&pws=0`;
        const visible = scrapeWindowVisible();
        await provider.open(url, { visible, waitForBodyMs: 30_000 });
        if (visible)
            await sleep(2500); // dwell so you can see the loaded SERP before extraction/close
        const evaluate = provider.evaluate?.bind(provider);
        if (evaluate) {
            const raw = await evaluate(SERP_EXTRACT_SCRIPT).catch(() => null);
            if (raw && raw.length > 0)
                return this.dedupe(raw);
        }
        // No evaluate (or it found nothing): inspect the page, then AI-extract from the snapshot.
        const snapshot = await provider.snapshot({ maxChars: 18_000, maxLinks: 140 });
        this.assertNotBlocked(snapshot);
        const extracted = await AiPageExtractor_1.aiPageExtractor.extract({
            snapshot,
            schema: SerpAiSchema,
            instructions: [
                'This is a Google search results page. Extract the ORGANIC (non-ad) results in their ranked order.',
                'Use the destination website URL, not a google.com redirect. Skip ads, Google’s own links, and "People also ask".',
            ].join(' '),
            schemaHint: '{ "results": [{ "title": string|null, "url": string, "domain": string|null }] }',
        });
        return this.dedupe(extracted.results ?? []);
    }
    async scrapePageOutline(provider, url) {
        const visible = scrapeWindowVisible();
        await provider.open(url, { visible, waitForBodyMs: 20_000 });
        if (visible)
            await sleep(1500); // dwell so each visited competitor page is watchable
        const evaluate = provider.evaluate?.bind(provider);
        if (evaluate) {
            const data = await evaluate(OUTLINE_EXTRACT_SCRIPT).catch(() => null);
            if (data) {
                return {
                    url,
                    title: data.title?.trim() || null,
                    metaDescription: data.metaDescription?.trim() || null,
                    headings: sanitizeHeadings(data.headings ?? []),
                };
            }
        }
        const snapshot = await provider.snapshot({ maxChars: 16_000, maxLinks: 0 });
        const extracted = await AiPageExtractor_1.aiPageExtractor.extract({
            snapshot,
            schema: OutlineAiSchema,
            instructions: [
                'Extract this article’s structure: its title, meta description, and the section headings in document order.',
                'Classify each heading as h1, h2, or h3 based on its prominence. Do not invent headings.',
            ].join(' '),
            schemaHint: '{ "title": string|null, "metaDescription": string|null, "headings": [{ "level": "h1"|"h2"|"h3", "text": string }] }',
        });
        return {
            url,
            title: extracted.title,
            metaDescription: extracted.metaDescription,
            headings: sanitizeHeadings(extracted.headings ?? []),
        };
    }
    dedupe(items) {
        const seen = new Set();
        const out = [];
        for (const item of items) {
            const url = typeof item.url === 'string' ? item.url.trim() : '';
            if (!/^https?:\/\//i.test(url) || seen.has(url))
                continue;
            const domain = item.domain?.trim() || (0, domain_1.extractDomain)(url);
            if (!domain || /(^|\.)google\./i.test(domain))
                continue;
            seen.add(url);
            out.push({ title: item.title?.trim() || null, url, domain });
        }
        return out;
    }
    assertNotBlocked(snapshot) {
        const text = `${snapshot.title} ${snapshot.text}`.toLowerCase();
        if (/unusual traffic|are you a robot|recaptcha|verify (it'?s )?you|detected unusual/.test(text)) {
            throw new Error('Google served a CAPTCHA / bot check for this scrape. Switch the source to DataForSEO, or try again later.');
        }
        if (/before you continue to google|consent\.google|accept all|reject all/.test(text)) {
            throw new Error('Google showed a cookie-consent wall that blocked scraping. Switch the source to DataForSEO.');
        }
    }
}
exports.SerpScrapeService = SerpScrapeService;
exports.serpScrapeService = new SerpScrapeService();
//# sourceMappingURL=SerpScrapeService.js.map