"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.productInfoService = exports.ProductInfoService = void 0;
const axios_1 = __importDefault(require("axios"));
const ConnectorService_1 = require("./ConnectorService");
const PRODUCT_INFO_SCHEMA = {
    name: '',
    tagline: '',
    shortDescription: '',
    mediumDescription: '',
    longDescription: '',
    categories: [],
    tags: [],
    pricingModel: '',
    platforms: [],
    targetUser: '',
    painSolved: '',
    competitors: [],
    seedKeywords: [],
};
function decodeHtml(value) {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}
function normalizeWhitespace(value) {
    return decodeHtml(value).replace(/\s+/g, ' ').trim();
}
function normalizeUrl(input) {
    const trimmed = input.trim();
    if (!trimmed)
        throw new Error('URL is required.');
    const withProtocol = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only http and https URLs can be fetched.');
    }
    parsed.hash = '';
    return parsed.toString();
}
function absoluteUrl(baseUrl, value) {
    if (!value)
        return null;
    try {
        return new URL(value, baseUrl).toString();
    }
    catch {
        return null;
    }
}
function extractAttributes(tag) {
    const attrs = {};
    const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = attrPattern.exec(tag))) {
        attrs[match[1].toLowerCase()] = decodeHtml(match[3] ?? match[4] ?? match[5] ?? '');
    }
    return attrs;
}
function extractMetaContent(html, key) {
    const wanted = key.toLowerCase();
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attrs = extractAttributes(match[0]);
        const name = (attrs.name ?? attrs.property ?? attrs.itemprop ?? '').toLowerCase();
        if (name === wanted && attrs.content) {
            return normalizeWhitespace(attrs.content);
        }
    }
    return '';
}
function extractLinkHref(html, rel) {
    const wanted = rel.toLowerCase();
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const attrs = extractAttributes(match[0]);
        const relValue = (attrs.rel ?? '').toLowerCase();
        if (relValue.split(/\s+/).includes(wanted) && attrs.href) {
            return attrs.href.trim();
        }
    }
    return '';
}
function extractTagText(html, tagName, limit) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
    const values = [];
    let match;
    while ((match = pattern.exec(html)) && values.length < limit) {
        const text = normalizeWhitespace(match[1].replace(/<[^>]+>/g, ' '));
        if (text)
            values.push(text);
    }
    return values;
}
function extractTitle(html) {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return match ? normalizeWhitespace(match[1]) : '';
}
function parseList(value) {
    return value
        .split(/[,;|]/)
        .map((part) => normalizeWhitespace(part))
        .filter(Boolean);
}
function unique(values, limit) {
    const seen = new Set();
    const next = [];
    for (const value of values) {
        const normalized = normalizeWhitespace(value ?? '');
        if (!normalized)
            continue;
        const key = normalized.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        next.push(normalized);
        if (next.length >= limit)
            break;
    }
    return next;
}
function extractJsonLd(html) {
    const values = [];
    const pattern = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = pattern.exec(html)) && values.length < 8) {
        try {
            const parsed = JSON.parse(decodeHtml(match[1]).trim());
            if (Array.isArray(parsed)) {
                values.push(...parsed.slice(0, 8 - values.length));
            }
            else {
                values.push(parsed);
            }
        }
        catch {
            // Ignore invalid embedded structured data.
        }
    }
    return values;
}
function flattenStructuredData(values) {
    const output = [];
    function visit(value) {
        if (!value || typeof value !== 'object')
            return;
        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }
        const record = value;
        output.push(record);
        const graph = record['@graph'];
        if (Array.isArray(graph))
            graph.forEach(visit);
    }
    values.forEach(visit);
    return output;
}
function readStructuredString(records, keys) {
    for (const record of records) {
        for (const key of keys) {
            const value = record[key];
            if (typeof value === 'string' && normalizeWhitespace(value)) {
                return normalizeWhitespace(value);
            }
        }
    }
    return '';
}
function readStructuredImage(records) {
    for (const record of records) {
        const value = record.image ?? record.logo;
        if (typeof value === 'string')
            return value;
        if (Array.isArray(value)) {
            const first = value.find((item) => typeof item === 'string');
            if (typeof first === 'string')
                return first;
        }
        if (value && typeof value === 'object') {
            const url = value.url;
            if (typeof url === 'string')
                return url;
        }
    }
    return '';
}
function extractBodyText(html) {
    const cleaned = html
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ');
    return normalizeWhitespace(cleaned).slice(0, 6000);
}
function titleToProductName(title, hostname) {
    const cleanTitle = normalizeWhitespace(title);
    if (!cleanTitle) {
        return hostname.replace(/^www\./, '').split('.')[0].replace(/[-_]+/g, ' ');
    }
    const [candidate] = cleanTitle.split(/\s+[|–—-]\s+/);
    return normalizeWhitespace(candidate || cleanTitle).slice(0, 45);
}
function sentence(value, maxLength) {
    const normalized = normalizeWhitespace(value);
    if (normalized.length <= maxLength)
        return normalized;
    const boundary = normalized.slice(0, maxLength + 1).lastIndexOf(' ');
    return `${normalized.slice(0, boundary > 40 ? boundary : maxLength).trim()}...`;
}
function extractMetadata(url, html) {
    const parsedUrl = new URL(url);
    const structuredData = extractJsonLd(html);
    const records = flattenStructuredData(structuredData);
    const title = extractMetaContent(html, 'og:title') || extractMetaContent(html, 'twitter:title') || extractTitle(html);
    const description = extractMetaContent(html, 'og:description') ||
        extractMetaContent(html, 'twitter:description') ||
        extractMetaContent(html, 'description') ||
        readStructuredString(records, ['description']);
    const canonicalUrl = absoluteUrl(url, extractLinkHref(html, 'canonical'));
    const structuredImage = absoluteUrl(url, readStructuredImage(records));
    const logoUrl = absoluteUrl(url, extractMetaContent(html, 'og:logo')) ||
        absoluteUrl(url, extractLinkHref(html, 'apple-touch-icon')) ||
        absoluteUrl(url, extractLinkHref(html, 'icon')) ||
        structuredImage;
    const imageUrls = unique([
        absoluteUrl(url, extractMetaContent(html, 'og:image')),
        absoluteUrl(url, extractMetaContent(html, 'twitter:image')),
        structuredImage,
    ], 4);
    return {
        url,
        canonicalUrl,
        hostname: parsedUrl.hostname.replace(/^www\./, ''),
        title,
        description,
        keywords: parseList(extractMetaContent(html, 'keywords')),
        h1: extractTagText(html, 'h1', 5),
        h2: extractTagText(html, 'h2', 8),
        logoUrl,
        imageUrls,
        structuredData,
        textSample: extractBodyText(html),
    };
}
function fallbackDraft(metadata) {
    const name = readStructuredString(flattenStructuredData(metadata.structuredData), ['name']) ||
        metadata.h1[0] ||
        titleToProductName(metadata.title, metadata.hostname);
    const description = metadata.description || metadata.textSample;
    const tags = unique([...metadata.keywords, ...metadata.h2], 10);
    const categories = unique(metadata.keywords.slice(0, 3), 3);
    return {
        url: metadata.canonicalUrl ?? metadata.url,
        name: sentence(name, 45),
        tagline: sentence(description || `${name} product profile`, 60),
        shortDescription: sentence(description || `${name} product profile`, 240),
        mediumDescription: sentence(description || `${name} product profile`, 700),
        longDescription: description || `${name} product profile.`,
        logoUrl: metadata.logoUrl,
        screenshotUrls: metadata.imageUrls,
        demoVideoUrl: null,
        categories,
        tags,
        pricingModel: 'subscription',
        platforms: ['web'],
        targetUser: '',
        painSolved: '',
        competitors: [],
        seedKeywords: unique(metadata.keywords, 12),
    };
}
function buildPrompt(metadata, fallback) {
    return [
        'You extract product profile data for a marketing automation desktop app.',
        'Return strict JSON only. Do not include markdown, commentary, or unknown fields.',
        'Use the source URL and page text. Keep claims factual and do not invent unavailable features.',
        'Schema:',
        JSON.stringify(PRODUCT_INFO_SCHEMA, null, 2),
        'Field rules:',
        '- name: product/app name, max 45 characters.',
        '- tagline: concise launch tagline, max 60 characters.',
        '- shortDescription: clear 1-2 sentence product summary.',
        '- mediumDescription and longDescription: useful directory/listing copy.',
        '- categories: up to 3 broad categories.',
        '- tags: up to 10 technologies, integrations, audience tags, or feature tags.',
        '- platforms: platform labels such as web, mac, windows, ios, android, api.',
        '- pricingModel: one of free, freemium, subscription, one-time, enterprise, unknown.',
        '- targetUser: likely buyer/user.',
        '- painSolved: concrete problem the product solves.',
        '- competitors: only if explicitly suggested by source content.',
        '- seedKeywords: 8-12 lowercase SEO seed keywords/phrases a buyer would search to find this product. Mix head and long-tail terms; no brand-only words.',
        'Fetched metadata JSON:',
        JSON.stringify({
            url: metadata.url,
            canonicalUrl: metadata.canonicalUrl,
            hostname: metadata.hostname,
            title: metadata.title,
            description: metadata.description,
            keywords: metadata.keywords,
            h1: metadata.h1,
            h2: metadata.h2,
            fallback,
            textSample: metadata.textSample,
        }, null, 2),
    ].join('\n\n');
}
function extractJsonObject(text) {
    const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    }
    catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start === -1 || end <= start)
            return null;
        try {
            const parsed = JSON.parse(trimmed.slice(start, end + 1));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        }
        catch {
            return null;
        }
    }
}
function readString(value) {
    return typeof value === 'string' ? normalizeWhitespace(value) : '';
}
function readStringList(value, limit) {
    if (Array.isArray(value)) {
        return unique(value.map((item) => (typeof item === 'string' ? item : '')), limit);
    }
    if (typeof value === 'string') {
        return unique(parseList(value), limit);
    }
    return [];
}
function mergeDraft(fallback, aiDraft) {
    if (!aiDraft)
        return fallback;
    return {
        url: fallback.url,
        name: sentence(readString(aiDraft.name) || fallback.name, 45),
        tagline: sentence(readString(aiDraft.tagline) || fallback.tagline, 60),
        shortDescription: readString(aiDraft.shortDescription) || fallback.shortDescription,
        mediumDescription: readString(aiDraft.mediumDescription) || fallback.mediumDescription,
        longDescription: readString(aiDraft.longDescription) || fallback.longDescription,
        logoUrl: fallback.logoUrl,
        screenshotUrls: fallback.screenshotUrls,
        demoVideoUrl: fallback.demoVideoUrl,
        categories: readStringList(aiDraft.categories, 3).length ? readStringList(aiDraft.categories, 3) : fallback.categories,
        tags: readStringList(aiDraft.tags, 10).length ? readStringList(aiDraft.tags, 10) : fallback.tags,
        pricingModel: readString(aiDraft.pricingModel) || fallback.pricingModel,
        platforms: readStringList(aiDraft.platforms, 8).length ? readStringList(aiDraft.platforms, 8) : fallback.platforms,
        targetUser: readString(aiDraft.targetUser) || fallback.targetUser,
        painSolved: readString(aiDraft.painSolved) || fallback.painSolved,
        competitors: readStringList(aiDraft.competitors, 6),
        seedKeywords: readStringList(aiDraft.seedKeywords, 12).length
            ? readStringList(aiDraft.seedKeywords, 12)
            : fallback.seedKeywords,
    };
}
function toSuggestion(draft, source, confidence) {
    return {
        url: draft.url,
        name: draft.name || 'Untitled product',
        tagline: draft.tagline || `${draft.name || 'Product'} profile`,
        shortDescription: draft.shortDescription || draft.tagline || `${draft.name || 'Product'} profile.`,
        mediumDescription: draft.mediumDescription || draft.shortDescription || draft.tagline,
        longDescription: draft.longDescription || draft.mediumDescription || draft.shortDescription || draft.tagline,
        logoUrl: draft.logoUrl,
        screenshotUrls: draft.screenshotUrls,
        demoVideoUrl: draft.demoVideoUrl,
        categories: unique(draft.categories, 3),
        tags: unique(draft.tags, 10),
        pricingModel: draft.pricingModel || 'subscription',
        platforms: unique(draft.platforms.length ? draft.platforms : ['web'], 8),
        targetUser: draft.targetUser,
        painSolved: draft.painSolved,
        competitors: unique(draft.competitors, 6),
        seedKeywords: unique(draft.seedKeywords, 12),
        source,
        confidence,
    };
}
class ProductInfoService {
    async fetchInfo(inputUrl) {
        const url = normalizeUrl(inputUrl);
        const response = await axios_1.default.get(url, {
            headers: {
                Accept: 'text/html,application/xhtml+xml',
                'User-Agent': '1MarketingTool/0.1 ProductInfoFetcher',
            },
            maxContentLength: 2_500_000,
            responseType: 'text',
            timeout: 18000,
            validateStatus: (status) => status >= 200 && status < 400,
        });
        const html = String(response.data ?? '');
        const metadata = extractMetadata(url, html);
        const fallback = fallbackDraft(metadata);
        const aiResult = await this.generateWithAi(metadata, fallback);
        if (aiResult) {
            return toSuggestion(aiResult.draft, aiResult.provider, 0.84);
        }
        return toSuggestion(fallback, 'metadata', 0.56);
    }
    async generateWithAi(metadata, fallback) {
        const prompt = buildPrompt(metadata, fallback);
        const openAiConnector = ConnectorService_1.connectorService.listConnectors().find((connector) => connector.name === 'openai' && connector.enabled);
        if (openAiConnector) {
            const secret = await ConnectorService_1.connectorService.getSecret('openai');
            const apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey : null;
            if (apiKey) {
                try {
                    const response = await axios_1.default.post('https://api.openai.com/v1/responses', {
                        model: 'gpt-4.1-mini',
                        input: prompt,
                        temperature: 0.2,
                    }, {
                        headers: {
                            Authorization: `Bearer ${apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 30000,
                    });
                    const outputText = response.data?.output_text ??
                        (Array.isArray(response.data?.output)
                            ? response.data.output
                                .flatMap((item) => item.content ?? [])
                                .map((part) => (typeof part.text === 'string' ? part.text : ''))
                                .join('\n')
                            : '');
                    const parsed = extractJsonObject(outputText);
                    if (parsed) {
                        return { provider: 'openai', draft: mergeDraft(fallback, parsed) };
                    }
                }
                catch {
                    // Fall through to Claude or metadata fallback.
                }
            }
        }
        const claudeConnector = ConnectorService_1.connectorService.listConnectors().find((connector) => connector.name === 'claude' && connector.enabled);
        if (claudeConnector) {
            const secret = await ConnectorService_1.connectorService.getSecret('claude');
            const apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey : null;
            if (apiKey) {
                try {
                    const response = await axios_1.default.post('https://api.anthropic.com/v1/messages', {
                        model: 'claude-3-5-haiku-latest',
                        max_tokens: 1200,
                        messages: [{ role: 'user', content: prompt }],
                    }, {
                        headers: {
                            'x-api-key': apiKey,
                            'anthropic-version': '2023-06-01',
                            'content-type': 'application/json',
                        },
                        timeout: 30000,
                    });
                    const text = Array.isArray(response.data?.content)
                        ? response.data.content
                            .map((part) => (part.type === 'text' ? part.text ?? '' : ''))
                            .join('\n')
                            .trim()
                        : '';
                    const parsed = extractJsonObject(text);
                    if (parsed) {
                        return { provider: 'claude', draft: mergeDraft(fallback, parsed) };
                    }
                }
                catch {
                    // Fall through to metadata fallback.
                }
            }
        }
        return null;
    }
}
exports.ProductInfoService = ProductInfoService;
exports.productInfoService = new ProductInfoService();
//# sourceMappingURL=ProductInfoService.js.map