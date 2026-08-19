"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.looksLikeHtml = looksLikeHtml;
exports.analyzeHtml = analyzeHtml;
/** File extensions that are never HTML pages — skipped before fetching/enqueuing. */
const NON_HTML_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'tiff',
    'css', 'js', 'mjs', 'cjs', 'json', 'map', 'xml', 'rss', 'atom', 'txt', 'csv',
    'pdf', 'zip', 'gz', 'tar', 'rar', '7z', 'dmg', 'exe', 'pkg',
    'mp4', 'webm', 'mov', 'avi', 'mp3', 'wav', 'ogg', 'm4a',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);
/** True when a URL's path looks like a fetchable HTML page (not an asset/download). */
function looksLikeHtml(url) {
    try {
        const { pathname } = new URL(url);
        const last = pathname.split('/').pop() ?? '';
        const dot = last.lastIndexOf('.');
        if (dot === -1)
            return true;
        const ext = last.slice(dot + 1).toLowerCase();
        return !NON_HTML_EXTENSIONS.has(ext);
    }
    catch {
        return false;
    }
}
/** Extract a single HTML attribute's value from an opening tag (quoted or bare). */
function getAttr(tag, name) {
    const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const match = re.exec(tag);
    if (!match)
        return null;
    return decodeEntities((match[2] ?? match[3] ?? match[4] ?? '').trim());
}
/** Return the `content` of the first <meta> whose name/property equals `key`. */
function metaContent(metaTags, key) {
    const lowerKey = key.toLowerCase();
    for (const tag of metaTags) {
        const name = (getAttr(tag, 'name') ?? getAttr(tag, 'property') ?? '').toLowerCase();
        if (name === lowerKey) {
            return getAttr(tag, 'content');
        }
    }
    return null;
}
function countTag(html, tag) {
    const re = new RegExp(`<${tag}[\\s>]`, 'gi');
    return (html.match(re) ?? []).length;
}
function decodeEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&apos;/g, "'");
}
function wordCountOf(html) {
    const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return text ? text.split(/\s+/).length : 0;
}
/** Analyze a page's HTML and split its links into same-host vs external. */
function analyzeHtml(html, pageUrl, host) {
    const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = titleMatch ? decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim()) : '';
    const canonicalTag = (html.match(/<link\b[^>]*>/gi) ?? []).find((tag) => (getAttr(tag, 'rel') ?? '').toLowerCase() === 'canonical');
    const canonical = canonicalTag ? getAttr(canonicalTag, 'href') : null;
    const images = html.match(/<img\b[^>]*>/gi) ?? [];
    let imagesMissingAlt = 0;
    for (const img of images) {
        const alt = getAttr(img, 'alt');
        if (!alt || !alt.trim())
            imagesMissingAlt += 1;
    }
    const internalLinks = [];
    const externalLinks = [];
    const anchorRe = /<a\b[^>]*\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
    let anchor;
    while ((anchor = anchorRe.exec(html)) !== null) {
        const raw = (anchor[2] ?? anchor[3] ?? anchor[4] ?? '').trim();
        if (!raw || /^(javascript:|mailto:|tel:|#|data:)/i.test(raw))
            continue;
        let resolved;
        try {
            resolved = new URL(decodeEntities(raw), pageUrl);
        }
        catch {
            continue;
        }
        if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:')
            continue;
        resolved.hash = '';
        if (resolved.host.toLowerCase() === host.toLowerCase()) {
            internalLinks.push(resolved.toString());
        }
        else {
            externalLinks.push(resolved.toString());
        }
    }
    return {
        title,
        metaDescription: metaContent(metaTags, 'description') ?? '',
        canonical,
        robotsMeta: metaContent(metaTags, 'robots'),
        h1Count: countTag(html, 'h1'),
        h2Count: countTag(html, 'h2'),
        wordCount: wordCountOf(html),
        imagesTotal: images.length,
        imagesMissingAlt,
        internalLinks,
        externalLinks,
        hasStructuredData: /<script[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html),
        hasViewport: Boolean(metaContent(metaTags, 'viewport')),
    };
}
//# sourceMappingURL=pageAnalyzer.js.map