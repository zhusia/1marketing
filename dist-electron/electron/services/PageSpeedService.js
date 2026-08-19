"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pageSpeedService = exports.PageSpeedService = void 0;
const axios_1 = __importDefault(require("axios"));
const ApiLogService_1 = require("./ApiLogService");
const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PAGESPEED_LOG_PATH = '/pagespeedonline/v5/runPagespeed';
const MAX_AUDIT_ITEMS = 8;
/** Lab metrics shown as Core Web Vitals chips, in display order. */
const METRIC_DEFINITIONS = [
    { id: 'first-contentful-paint', label: 'First Contentful Paint' },
    { id: 'largest-contentful-paint', label: 'Largest Contentful Paint' },
    { id: 'total-blocking-time', label: 'Total Blocking Time' },
    { id: 'cumulative-layout-shift', label: 'Cumulative Layout Shift' },
    { id: 'speed-index', label: 'Speed Index' },
    { id: 'interactive', label: 'Time to Interactive' },
];
const MAX_OPPORTUNITIES = 8;
const MAX_DIAGNOSTICS = 8;
class PageSpeedService {
    async run(url, strategy = 'mobile', apiKey) {
        const targetUrl = normalizeUrl(url);
        if (!targetUrl) {
            throw new Error('A project URL is required before running PageSpeed.');
        }
        const params = new URLSearchParams({ url: targetUrl, strategy });
        for (const category of ['performance', 'seo', 'accessibility', 'best-practices']) {
            params.append('category', category);
        }
        const key = apiKey?.trim();
        if (key)
            params.append('key', key);
        // Log every request to api_logs (provider 'pagespeed') so Settings can show daily usage vs. quota.
        const startedAt = Date.now();
        let response;
        try {
            response = await axios_1.default.get(`${PAGESPEED_ENDPOINT}?${params.toString()}`, { timeout: 60000 });
        }
        catch (error) {
            ApiLogService_1.apiLogService.record({
                provider: 'pagespeed',
                method: 'GET',
                path: PAGESPEED_LOG_PATH,
                status: 'error',
                statusCode: axios_1.default.isAxiosError(error) ? error.response?.status ?? null : null,
                summary: `PageSpeed ${strategy} ${targetUrl}`,
                detail: error instanceof Error ? error.message : null,
                durationMs: Date.now() - startedAt,
            });
            throw mapPageSpeedError(error, Boolean(key));
        }
        ApiLogService_1.apiLogService.record({
            provider: 'pagespeed',
            method: 'GET',
            path: PAGESPEED_LOG_PATH,
            status: 'success',
            statusCode: response.status,
            summary: `PageSpeed ${strategy} ${targetUrl}`,
            durationMs: Date.now() - startedAt,
        });
        const lighthouse = response.data.lighthouseResult;
        const categories = lighthouse?.categories ?? {};
        const audits = lighthouse?.audits ?? {};
        const metrics = METRIC_DEFINITIONS.map(({ id, label }) => {
            const found = audits[id];
            return { id, label, value: auditValue(found), score: numberOrNull(found?.score) };
        });
        const opportunities = collectAudits(categories.performance?.auditRefs, audits, 'load-opportunities')
            .filter((audit) => (audit.savingsMs ?? 0) > 0 || (audit.score != null && audit.score < 1))
            .sort((a, b) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
            .slice(0, MAX_OPPORTUNITIES);
        const diagnostics = collectAudits(categories.performance?.auditRefs, audits, 'diagnostics')
            .filter((audit) => audit.score != null && audit.score < 0.9)
            .sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
            .slice(0, MAX_DIAGNOSTICS);
        return {
            url: lighthouse?.finalUrl ?? targetUrl,
            strategy,
            performanceScore: score(categories.performance?.score),
            seoScore: score(categories.seo?.score),
            accessibilityScore: score(categories.accessibility?.score),
            bestPracticesScore: score(categories['best-practices']?.score),
            metrics,
            opportunities,
            diagnostics,
            checkedAt: Date.now(),
        };
    }
}
exports.PageSpeedService = PageSpeedService;
function collectAudits(auditRefs, audits, group) {
    return (auditRefs ?? [])
        .filter((ref) => ref.group === group && ref.id)
        .map((ref) => {
        const audit = audits[ref.id];
        if (!audit)
            return null;
        return {
            id: ref.id,
            title: audit.title ?? ref.id ?? '',
            value: auditValue(audit),
            savingsMs: numberOrNull(audit.details?.overallSavingsMs),
            score: numberOrNull(audit.score),
            description: cleanDescription(audit.description),
            items: extractAuditItems(audit.details),
        };
    })
        .filter((audit) => audit != null);
}
/** Strip Lighthouse markdown (links, code ticks) and collapse whitespace into plain text. */
function cleanDescription(description) {
    if (!description)
        return null;
    const text = description
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [label](url) → label
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    return text || null;
}
/**
 * Pull a readable list of offending rows out of a Lighthouse audit's details table. Each row
 * becomes `{ label, value }` where the label is the resource (url/element) and the value is the
 * most relevant metric heading (bytes/ms/etc.), formatted for display.
 */
function extractAuditItems(details) {
    const headings = details?.headings ?? [];
    const items = details?.items ?? [];
    if (headings.length === 0 || items.length === 0)
        return [];
    const labelHeading = headings.find((heading) => heading.valueType === 'url' || heading.valueType === 'text' || heading.valueType === 'node') ??
        headings[0];
    const numericHeadings = headings.filter((heading) => heading !== labelHeading &&
        (heading.valueType === 'bytes' ||
            heading.valueType === 'ms' ||
            heading.valueType === 'timespanMs' ||
            heading.valueType === 'numeric'));
    // Prefer the savings/duration column over a raw total-size column — it's what the user acts on.
    const valueHeading = numericHeadings.find((heading) => /wasted|saving|duration/i.test(heading.key ?? '')) ?? numericHeadings[0];
    return items
        .slice(0, MAX_AUDIT_ITEMS)
        .map((item) => {
        const label = formatItemLabel(item[labelHeading?.key ?? '']);
        const value = valueHeading ? formatItemValue(item[valueHeading.key ?? ''], valueHeading.valueType) : null;
        return label ? { label, value } : null;
    })
        .filter((item) => item != null);
}
function formatItemLabel(raw) {
    if (typeof raw === 'string')
        return shortenUrlLike(raw);
    if (raw && typeof raw === 'object') {
        const record = raw;
        const candidate = record.url ?? record.nodeLabel ?? record.snippet ?? record.selector ?? record.value ?? record.text;
        if (typeof candidate === 'string')
            return shortenUrlLike(candidate);
    }
    return '';
}
function shortenUrlLike(value) {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            const tail = `${url.pathname}${url.search}`;
            return `${url.host}${tail === '/' ? '' : tail}`;
        }
        catch {
            return trimmed;
        }
    }
    return trimmed.length > 140 ? `${trimmed.slice(0, 137)}…` : trimmed;
}
function formatItemValue(raw, valueType) {
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(num)) {
        if (valueType === 'bytes')
            return formatBytes(num);
        if (valueType === 'ms' || valueType === 'timespanMs')
            return `${Math.round(num).toLocaleString()} ms`;
        return num.toLocaleString();
    }
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}
function formatBytes(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024)
        return `${Math.round(bytes / 1024).toLocaleString()} KiB`;
    return `${Math.round(bytes)} B`;
}
/** Turn raw PageSpeed/axios failures into actionable messages — quota is the common one. */
function mapPageSpeedError(error, hasKey) {
    if (axios_1.default.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 429) {
            return new Error(hasKey
                ? 'PageSpeed quota exceeded for your API key. Wait for the daily reset or use a different key.'
                : 'PageSpeed daily quota exceeded for the shared keyless limit (HTTP 429). Add a free PageSpeed Insights API key below — it raises the limit to 25,000 requests/day.');
        }
        if ((status === 400 || status === 403) && hasKey) {
            return new Error('PageSpeed rejected the API key. Confirm the key is valid and the "PageSpeed Insights API" is enabled for its Google Cloud project.');
        }
    }
    return error instanceof Error ? error : new Error('PageSpeed request failed.');
}
function normalizeUrl(url) {
    const trimmed = url.trim();
    if (!trimmed)
        return '';
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
function score(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;
}
function numberOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function auditValue(audit) {
    const value = audit?.displayValue;
    return typeof value === 'string' && value.trim() ? value : null;
}
exports.pageSpeedService = new PageSpeedService();
//# sourceMappingURL=PageSpeedService.js.map