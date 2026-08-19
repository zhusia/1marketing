"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeIssues = computeIssues;
const TITLE_MIN = 15;
const TITLE_MAX = 60;
const META_MAX = 160;
const THIN_CONTENT_WORDS = 200;
const SLOW_MS = 2000;
const MAX_EXAMPLES = 10;
const RULES = [
    {
        code: 'broken-page',
        label: 'Broken pages (4xx/5xx)',
        severity: 'high',
        description: 'Pages that returned an HTTP error or could not be reached.',
        test: (p) => p.statusCode === 0 || p.statusCode >= 400,
        detail: (p) => (p.statusCode === 0 ? 'Request failed' : `HTTP ${p.statusCode}`),
    },
    {
        code: 'missing-title',
        label: 'Missing <title>',
        severity: 'high',
        description: 'Indexable pages with no title tag.',
        test: (p) => p.isIndexable && !p.title.trim(),
        detail: () => null,
    },
    {
        code: 'missing-h1',
        label: 'Missing H1',
        severity: 'medium',
        description: 'Indexable pages without an H1 heading.',
        test: (p) => p.isIndexable && p.h1Count === 0,
        detail: () => null,
    },
    {
        code: 'missing-meta-description',
        label: 'Missing meta description',
        severity: 'medium',
        description: 'Indexable pages without a meta description.',
        test: (p) => p.isIndexable && !p.metaDescription.trim(),
        detail: () => null,
    },
    {
        code: 'thin-content',
        label: 'Thin content',
        severity: 'medium',
        description: `Indexable pages with fewer than ${THIN_CONTENT_WORDS} words.`,
        test: (p) => p.isIndexable && p.wordCount < THIN_CONTENT_WORDS,
        detail: (p) => `${p.wordCount} words`,
    },
    {
        code: 'title-length',
        label: 'Title length',
        severity: 'low',
        description: `Titles shorter than ${TITLE_MIN} or longer than ${TITLE_MAX} characters.`,
        test: (p) => {
            const len = p.title.trim().length;
            return p.isIndexable && len > 0 && (len < TITLE_MIN || len > TITLE_MAX);
        },
        detail: (p) => `${p.title.trim().length} chars`,
    },
    {
        code: 'meta-description-length',
        label: 'Long meta description',
        severity: 'low',
        description: `Meta descriptions longer than ${META_MAX} characters.`,
        test: (p) => p.metaDescription.trim().length > META_MAX,
        detail: (p) => `${p.metaDescription.trim().length} chars`,
    },
    {
        code: 'multiple-h1',
        label: 'Multiple H1s',
        severity: 'low',
        description: 'Pages with more than one H1 heading.',
        test: (p) => p.h1Count > 1,
        detail: (p) => `${p.h1Count} H1s`,
    },
    {
        code: 'images-missing-alt',
        label: 'Images missing alt text',
        severity: 'low',
        description: 'Pages with one or more images missing alt attributes.',
        test: (p) => p.imagesMissingAlt > 0,
        detail: (p) => `${p.imagesMissingAlt} of ${p.imagesTotal} images`,
    },
    {
        code: 'missing-canonical',
        label: 'Missing canonical',
        severity: 'low',
        description: 'Indexable pages without a canonical link.',
        test: (p) => p.isIndexable && !p.canonical,
        detail: () => null,
    },
    {
        code: 'missing-viewport',
        label: 'Missing viewport meta',
        severity: 'low',
        description: 'HTML pages without a responsive viewport meta tag.',
        test: (p, isHtml) => isHtml && !p.hasViewport,
        detail: () => null,
    },
    {
        code: 'noindex',
        label: 'Noindex pages',
        severity: 'low',
        description: 'Crawled pages excluded from indexing via a robots meta tag.',
        test: (p, isHtml) => isHtml && !p.isIndexable,
        detail: (p) => p.robotsMeta ?? 'noindex',
    },
    {
        code: 'redirect',
        label: 'Redirects',
        severity: 'low',
        description: 'URLs that responded with a 3xx redirect.',
        test: (p) => p.statusCode >= 300 && p.statusCode < 400,
        detail: (p) => (p.redirectUrl ? `→ ${p.redirectUrl}` : `HTTP ${p.statusCode}`),
    },
    {
        code: 'slow-response',
        label: 'Slow responses',
        severity: 'low',
        description: `Pages that took longer than ${SLOW_MS / 1000}s to respond.`,
        test: (p) => p.responseTimeMs > SLOW_MS,
        detail: (p) => `${(p.responseTimeMs / 1000).toFixed(1)}s`,
    },
];
const SEVERITY_WEIGHT = { high: 4, medium: 2, low: 1 };
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
/**
 * Run every rule over the crawled pages. Mutates each page's `issueCount`, and
 * returns the grouped issues, severity totals, and an overall health score.
 */
function computeIssues(pages, htmlPageIds) {
    const groups = new Map();
    let issuesHigh = 0;
    let issuesMedium = 0;
    let issuesLow = 0;
    for (const page of pages) {
        const isHtml = htmlPageIds.has(page.id);
        for (const rule of RULES) {
            if (!rule.test(page, isHtml))
                continue;
            page.issueCount += 1;
            if (rule.severity === 'high')
                issuesHigh += 1;
            else if (rule.severity === 'medium')
                issuesMedium += 1;
            else
                issuesLow += 1;
            let group = groups.get(rule.code);
            if (!group) {
                group = {
                    code: rule.code,
                    label: rule.label,
                    severity: rule.severity,
                    description: rule.description,
                    count: 0,
                    examples: [],
                };
                groups.set(rule.code, group);
            }
            group.count += 1;
            if (group.examples.length < MAX_EXAMPLES) {
                group.examples.push({ url: page.url, detail: rule.detail(page) });
            }
        }
    }
    const severityRank = { high: 0, medium: 1, low: 2 };
    const ordered = Array.from(groups.values()).sort((a, b) => {
        if (severityRank[a.severity] !== severityRank[b.severity]) {
            return severityRank[a.severity] - severityRank[b.severity];
        }
        return b.count - a.count;
    });
    const pageCount = Math.max(pages.length, 1);
    const weighted = issuesHigh * SEVERITY_WEIGHT.high + issuesMedium * SEVERITY_WEIGHT.medium + issuesLow * SEVERITY_WEIGHT.low;
    const healthScore = clamp(Math.round(100 - (weighted / pageCount) * 6), 0, 100);
    return { groups: ordered, issuesHigh, issuesMedium, issuesLow, healthScore };
}
//# sourceMappingURL=issues.js.map