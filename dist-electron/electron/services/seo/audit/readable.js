"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decodeEntities = decodeEntities;
exports.extractReadableText = extractReadableText;
exports.fetchReadablePage = fetchReadablePage;
/**
 * Dependency-free readable-text extraction for a fetched HTML page.
 *
 * The site-audit crawler (crawl.ts / pageAnalyzer.ts) only pulls SEO *signals*
 * (title, meta, counts) — it never keeps the prose. Writing-style mimicry needs
 * the actual body text, so this module fetches a URL with the same axios setup
 * the crawler uses and strips the HTML down to human-readable paragraphs.
 */
const axios_1 = __importDefault(require("axios"));
const USER_AGENT = '1MarketingTool/WritingStyle';
const FETCH_TIMEOUT_MS = 20_000;
/** Cap per page so one huge article can't dominate the whole style sample. */
const MAX_TEXT_CHARS = 12_000;
function decodeEntities(value) {
    return value
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_match, code) => {
        const num = Number(code);
        return Number.isFinite(num) ? String.fromCodePoint(num) : ' ';
    });
}
/** Grab the innermost <article>/<main> when present so we skip nav/footer chrome. */
function preferMainContent(html) {
    const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html);
    if (article && article[1].trim().length > 400)
        return article[1];
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
    if (main && main[1].trim().length > 400)
        return main[1];
    return html;
}
/** Strip HTML to readable paragraphs: drop noise tags, turn blocks into line breaks. */
function extractReadableText(html) {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch ? decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : '';
    const body = preferMainContent(html)
        // Remove elements that never contain reading prose.
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<head[\s\S]*?<\/head>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<header[\s\S]*?<\/header>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<form[\s\S]*?<\/form>/gi, ' ')
        // Block-level tags become paragraph breaks so sentences don't run together.
        .replace(/<\/(p|div|section|li|h[1-6]|blockquote|br|tr|figcaption)[^>]*>/gi, '\n')
        .replace(/<br\b[^>]*>/gi, '\n')
        // Everything else: drop the tag, keep the text.
        .replace(/<[^>]+>/g, ' ');
    const text = decodeEntities(body)
        .replace(/[ \t\f\v]+/g, ' ')
        .replace(/\n\s*\n\s*/g, '\n\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')
        .trim();
    return { title, text: text.slice(0, MAX_TEXT_CHARS) };
}
/** Fetch a single URL and return its readable prose (mirrors crawl.ts's axios setup). */
async function fetchReadablePage(url) {
    try {
        const response = await axios_1.default.get(url, {
            timeout: FETCH_TIMEOUT_MS,
            responseType: 'text',
            transformResponse: (raw) => raw,
            maxRedirects: 5,
            decompress: true,
            validateStatus: () => true,
            headers: { Accept: 'text/html,application/xhtml+xml,*/*', 'User-Agent': USER_AGENT },
        });
        if (response.status < 200 || response.status >= 300) {
            return { url, ok: false, title: '', text: '', charCount: 0, error: `HTTP ${response.status}` };
        }
        const contentType = String(response.headers?.['content-type'] ?? '').toLowerCase();
        if (contentType && !contentType.includes('html') && !contentType.includes('text')) {
            return { url, ok: false, title: '', text: '', charCount: 0, error: `Unsupported content type (${contentType})` };
        }
        const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
        const { title, text } = extractReadableText(html);
        if (!text.trim()) {
            return { url, ok: false, title, text: '', charCount: 0, error: 'No readable text found on the page.' };
        }
        return { url, ok: true, title, text, charCount: text.length, error: null };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch the page.';
        return { url, ok: false, title: '', text: '', charCount: 0, error: message };
    }
}
//# sourceMappingURL=readable.js.map