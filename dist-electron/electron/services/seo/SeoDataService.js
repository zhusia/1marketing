"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seoDataService = exports.SeoDataService = void 0;
const ConnectorService_1 = require("../ConnectorService");
const AppRepository_1 = require("../AppRepository");
const AIService_1 = require("../AIService");
const AhrefsDomainRatingClient_1 = require("./AhrefsDomainRatingClient");
const providerFactory_1 = require("./providerFactory");
const SerpScrapeService_1 = require("./SerpScrapeService");
const currency_1 = require("./currency");
const PLANNER_DEFAULT_LOCATION = 'United States';
const BACKLINK_PROFILE_CACHE_KEY = 'seo.backlinkProfileCache';
/** Stable cache key for a Keyword Planner lookup (case-insensitive, order-independent). */
function plannerCacheKey(keywords, location) {
    const normalized = Array.from(new Set(keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean))).sort();
    return `${location.trim().toLowerCase()}::${normalized.join('|')}`;
}
function normalizeBacklinkDomain(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
        .replace(/\/$/, '');
}
function backlinkProfileCacheKey(domain, limit, source) {
    return `${source}::${normalizeBacklinkDomain(domain)}::${limit}`;
}
function readBacklinkProfileCache() {
    const value = AppRepository_1.repository.getSetting(BACKLINK_PROFILE_CACHE_KEY)?.value;
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function writeBacklinkProfileCache(cache) {
    AppRepository_1.repository.setSetting(BACKLINK_PROFILE_CACHE_KEY, cache);
}
function stripBacklinkCacheMetadata(entry) {
    return {
        domain: entry.domain,
        referringDomains: entry.referringDomains,
        anchors: entry.anchors,
        source: entry.source,
    };
}
function domainRatingForBacklinkSnapshot(previous) {
    if (!previous?.domainRating)
        return 0;
    return previous.source === 'dataforseo' ? previous.domainRating : previous.domainRating * 10;
}
class SeoDataService {
    async getDomainAuthority(domain) {
        return AhrefsDomainRatingClient_1.ahrefsDomainRatingClient.getDomainAuthority(domain);
    }
    async getBacklinkProfile(domain, limit, options) {
        const resolvedLimit = Math.max(1, Math.round(limit ?? 50));
        const dataForSeoCacheKey = backlinkProfileCacheKey(domain, resolvedLimit, 'dataforseo');
        if (!options?.refresh) {
            const cached = readBacklinkProfileCache()[dataForSeoCacheKey];
            if (cached) {
                return stripBacklinkCacheMetadata(cached);
            }
        }
        if (options?.cacheOnly)
            return null;
        let profile;
        try {
            const provider = await (0, providerFactory_1.createSeoProvider)(ConnectorService_1.connectorService, 'backlinks');
            profile = await provider.getBacklinkProfile(domain, resolvedLimit);
            if (options?.productId) {
                const previous = AppRepository_1.repository.getLatestDomainAuthority(options.productId, profile.domain);
                let authority = null;
                try {
                    authority = await provider.getDomainAuthority(domain);
                }
                catch (error) {
                    console.warn('[seo-data] Could not fetch DataForSEO backlink summary:', error);
                }
                const backlinks = authority?.backlinks ?? profile.referringDomains.reduce((sum, row) => sum + row.backlinks, 0);
                const linkingWebsites = authority?.linkingWebsites ?? profile.referringDomains.length;
                AppRepository_1.repository.createDomainAuthority({
                    productId: options.productId,
                    domain: authority?.domain ?? profile.domain,
                    domainRating: authority?.domainRating ?? domainRatingForBacklinkSnapshot(previous),
                    urlRating: previous?.urlRating ?? authority?.urlRating ?? 0,
                    backlinks,
                    linkingWebsites,
                    source: authority?.source ?? profile.source,
                });
            }
        }
        catch {
            throw new Error('Connect and enable DataForSEO in Settings > Connectors to load backlink and linking-website details.');
        }
        writeBacklinkProfileCache({
            ...readBacklinkProfileCache(),
            [dataForSeoCacheKey]: {
                ...profile,
                fetchedAt: Date.now(),
                limit: resolvedLimit,
            },
        });
        return profile;
    }
    /** Domain Rating for many domains via Ahrefs' public free endpoint. */
    async bulkDomainAuthority(domains) {
        return AhrefsDomainRatingClient_1.ahrefsDomainRatingClient.bulkDomainAuthority(domains);
    }
    async keywordOverview(keywords, location) {
        const provider = await (0, providerFactory_1.createSeoProvider)(ConnectorService_1.connectorService, 'keywords');
        return provider.keywordOverview(keywords, location);
    }
    async keywordIdeas(seed, location) {
        const provider = await (0, providerFactory_1.createSeoProvider)(ConnectorService_1.connectorService, 'keywords');
        return provider.keywordIdeas(seed, location);
    }
    /**
     * Keyword Planner lookup with currency resolution and a DB cache. Returns the
     * cached result when available (no paid API call) unless `refresh` is set.
     */
    async keywordPlanner(keywords, location, options) {
        const cleanedKeywords = Array.from(new Set(keywords.map((keyword) => keyword.trim()).filter(Boolean)));
        const resolvedLocation = (location ?? '').trim() || PLANNER_DEFAULT_LOCATION;
        const currency = (0, currency_1.currencyForLocation)(resolvedLocation);
        const cacheKey = plannerCacheKey(cleanedKeywords, resolvedLocation);
        if (!options?.refresh) {
            const cached = AppRepository_1.repository.getKeywordPlannerCache(cacheKey);
            if (cached) {
                return {
                    location: cached.location,
                    currency: cached.currency,
                    keywords: cached.results ?? [],
                    fetchedAt: cached.fetchedAt,
                    cached: true,
                };
            }
        }
        const provider = await (0, providerFactory_1.createSeoProvider)(ConnectorService_1.connectorService, 'keywords');
        const results = await provider.keywordPlanner(cleanedKeywords, resolvedLocation);
        const fetchedAt = Date.now();
        AppRepository_1.repository.saveKeywordPlannerCache(cacheKey, {
            location: resolvedLocation,
            currency,
            keywords: cleanedKeywords,
            results,
            fetchedAt,
        });
        return { location: resolvedLocation, currency, keywords: results, fetchedAt, cached: false };
    }
    async rankedKeywords(domain, location) {
        const provider = await (0, providerFactory_1.createSeoProvider)(ConnectorService_1.connectorService, 'keywords');
        return provider.rankedKeywords(domain, location);
    }
    async serpPosition(keyword, domain, location) {
        const provider = await (0, providerFactory_1.createSeoProvider)(ConnectorService_1.connectorService, 'serp');
        return provider.serpPosition(keyword, domain, location);
    }
    async serpResults(keyword, location, depth) {
        const provider = await (0, providerFactory_1.createSeoProvider)(ConnectorService_1.connectorService, 'serp');
        return provider.serpResults(keyword, location, depth);
    }
    /**
     * Build an AI content brief for a keyword, grounded in the pages currently
     * ranking for it: fetch the live SERP, then ask the AI provider to synthesize
     * a title/meta/outline a writer can use to outrank them.
     */
    async contentBrief(keyword, location, source = 'dataforseo') {
        const cleanKeyword = keyword.trim();
        if (!cleanKeyword)
            throw new Error('Enter a target keyword to build a content brief.');
        // Browser sources scrape the SERP AND the ranking pages' real H1/H2/H3 outlines
        // (via the chosen engine); DataForSEO provides the SERP list (titles + snippets) only.
        const engine = engineForSource(source);
        let serp;
        let outlines = [];
        if (engine) {
            const scraped = await SerpScrapeService_1.serpScrapeService.scrapeBriefSources(cleanKeyword, location, 10, engine);
            serp = scraped.serp;
            outlines = scraped.outlines;
        }
        else {
            serp = await this.serpResults(cleanKeyword, location, 10);
        }
        const competitors = serp.results.slice(0, 10);
        if (competitors.length === 0) {
            const where = engine ? 'The browser scrape' : 'DataForSEO';
            throw new Error(`${where} returned no ranking pages for "${cleanKeyword}".`);
        }
        const prompt = buildContentBriefPrompt(cleanKeyword, serp, competitors, outlines);
        const { content, provider } = await AIService_1.aiService.complete(prompt, {
            conversationId: `content-brief:${cleanKeyword.toLowerCase()}`,
        });
        const parsed = parseBriefResponse(content);
        return {
            keyword: cleanKeyword,
            location: serp.location,
            searchIntent: parsed.searchIntent,
            suggestedTitles: parsed.suggestedTitles,
            metaDescription: parsed.metaDescription,
            targetWordCount: parsed.targetWordCount,
            outline: parsed.outline,
            keyQuestions: parsed.keyQuestions.length ? parsed.keyQuestions : serp.peopleAlsoAsk.slice(0, 8),
            keyTerms: parsed.keyTerms,
            competitors,
            competitorOutlines: outlines,
            source,
            provider,
            generatedAt: Date.now(),
        };
    }
    /**
     * Rank the pages on the SERP for a keyword and enrich each with its domain's
     * authority metric. Domain Rating comes from Ahrefs' public endpoint; backlink
     * profile details are still loaded separately from DataForSEO in the Links view.
     */
    async serpAnalysis(keyword, location, depth, source = 'dataforseo') {
        const cleanKeyword = keyword.trim();
        if (!cleanKeyword)
            throw new Error('Enter a target keyword to analyze the SERP.');
        const requestedDepth = Math.min(Math.max(Math.round(depth ?? 10) || 10, 1), 20);
        // The ranking list can come from the API or a browser scrape (Electron/BrowserMCP),
        // while the authority score comes from Ahrefs Domain Rating.
        const engine = engineForSource(source);
        const serp = engine
            ? await SerpScrapeService_1.serpScrapeService.scrapeSerp(cleanKeyword, location, requestedDepth, engine)
            : await this.serpResults(cleanKeyword, location, requestedDepth);
        const pages = serp.results.slice(0, requestedDepth);
        if (pages.length === 0) {
            const where = engine ? 'The browser scrape' : 'DataForSEO';
            throw new Error(`${where} returned no ranking pages for "${cleanKeyword}".`);
        }
        const authorityByDomain = new Map();
        for (const page of pages) {
            const domain = page.domain;
            if (!domain || authorityByDomain.has(domain))
                continue;
            try {
                authorityByDomain.set(domain, await this.getDomainAuthority(domain));
            }
            catch {
                // A single domain's backlink lookup failing shouldn't sink the whole report.
                authorityByDomain.set(domain, null);
            }
        }
        const competitors = pages.map((page) => {
            const authority = page.domain ? authorityByDomain.get(page.domain) ?? null : null;
            return {
                rank: page.rank,
                title: page.title,
                url: page.url,
                domain: page.domain ?? '',
                domainRating: authority?.domainRating ?? null,
                backlinks: authority?.backlinks ?? null,
                linkingWebsites: authority?.linkingWebsites ?? null,
            };
        });
        return { keyword: cleanKeyword, location: serp.location, competitors, source, generatedAt: Date.now() };
    }
}
exports.SeoDataService = SeoDataService;
/** Map a SERP source to the browser engine to scrape with, or null for the DataForSEO API. */
function engineForSource(source) {
    if (source === 'browser-electron')
        return 'electron-window';
    if (source === 'browser-mcp')
        return 'browser-mcp';
    return null;
}
function buildContentBriefPrompt(keyword, serp, competitors, outlines) {
    const competitorLines = competitors
        .map((c, i) => `${i + 1}. ${c.title ?? '(untitled)'} — ${c.url ?? ''}\n   ${c.description ?? ''}`.trim())
        .join('\n');
    const paa = serp.peopleAlsoAsk.length ? serp.peopleAlsoAsk.map((q) => `- ${q}`).join('\n') : '(none returned)';
    const related = serp.relatedSearches.length ? serp.relatedSearches.map((q) => `- ${q}`).join('\n') : '(none returned)';
    // When the SERP was scraped in a browser we also have each page's real heading
    // structure — far richer grounding than snippets, so hand it to the model.
    const outlineBlock = outlines.length
        ? [
            '',
            'COMPETITOR PAGE OUTLINES (their actual on-page headings — use these to find coverage and gaps):',
            outlines
                .map((outline, index) => {
                const headingLines = outline.headings
                    .map((heading) => `${heading.level === 'h1' ? '' : heading.level === 'h2' ? '  ' : '    '}- ${heading.text}`)
                    .join('\n');
                return `[${index + 1}] ${outline.title ?? outline.url}\n${headingLines}`;
            })
                .join('\n\n'),
        ].join('\n')
        : '';
    return [
        `You are an SEO content strategist. Build a content brief for an article targeting the keyword: "${keyword}".`,
        'Base it on the pages currently ranking on Google for this keyword.',
        '',
        'TOP RANKING PAGES (title — url, then snippet):',
        competitorLines,
        outlineBlock,
        '',
        'PEOPLE ALSO ASK:',
        paa,
        '',
        'RELATED SEARCHES:',
        related,
        '',
        'Produce a brief that would let a writer outrank these pages. Respond with ONLY a JSON object',
        '(no markdown, no commentary) matching exactly this shape:',
        '{',
        '  "searchIntent": "one short sentence on the dominant intent",',
        '  "suggestedTitles": ["3 to 5 compelling, distinct title options"],',
        '  "metaDescription": "a 150-160 character meta description",',
        '  "targetWordCount": 1500,',
        '  "outline": [{ "level": "h2" | "h3", "text": "heading text" }],',
        '  "keyQuestions": ["questions the article must answer"],',
        '  "keyTerms": ["entities, terms, and subtopics to cover for topical depth"]',
        '}',
        'The outline must be comprehensive (cover what competitors cover plus gaps they miss), ordered',
        'logically, with h3 items nested beneath the h2 they belong to.',
    ].join('\n');
}
function parseBriefResponse(content) {
    const json = extractJsonObject(content);
    if (!json) {
        throw new Error('The AI did not return a valid content brief. Try running it again.');
    }
    const stringArray = (value) => Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean) : [];
    const outline = Array.isArray(json.outline)
        ? json.outline
            .map((entry) => {
            if (!entry || typeof entry !== 'object')
                return null;
            const record = entry;
            const text = typeof record.text === 'string' ? record.text.trim() : '';
            if (!text)
                return null;
            return { level: record.level === 'h3' ? 'h3' : 'h2', text };
        })
            .filter((item) => item !== null)
        : [];
    const rawWordCount = json.targetWordCount;
    const targetWordCount = typeof rawWordCount === 'number'
        ? Math.round(rawWordCount)
        : typeof rawWordCount === 'string'
            ? Number.parseInt(rawWordCount, 10) || null
            : null;
    return {
        searchIntent: typeof json.searchIntent === 'string' ? json.searchIntent.trim() : null,
        suggestedTitles: stringArray(json.suggestedTitles),
        metaDescription: typeof json.metaDescription === 'string' ? json.metaDescription.trim() : null,
        targetWordCount,
        outline,
        keyQuestions: stringArray(json.keyQuestions),
        keyTerms: stringArray(json.keyTerms),
    };
}
/** Pull the first JSON object out of a model response, tolerating ```json fences or prose. */
function extractJsonObject(content) {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start)
        return null;
    try {
        const parsed = JSON.parse(content.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        return null;
    }
}
exports.seoDataService = new SeoDataService();
//# sourceMappingURL=SeoDataService.js.map