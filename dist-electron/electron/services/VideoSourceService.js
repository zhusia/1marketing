"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoSourceService = exports.VideoSourceService = void 0;
const axios_1 = __importDefault(require("axios"));
const path_1 = __importDefault(require("path"));
const AssetService_1 = require("./AssetService");
const IMAGE_MIME_EXT = {
    'image/avif': '.avif',
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/svg+xml': '.svg',
    'image/webp': '.webp',
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
    const url = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Only http and https URLs can be fetched.');
    }
    url.hash = '';
    return url.toString();
}
function absoluteUrl(baseUrl, value) {
    if (!value || /^data:/i.test(value))
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
    const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = pattern.exec(tag))) {
        attrs[match[1].toLowerCase()] = decodeHtml(match[3] ?? match[4] ?? match[5] ?? '');
    }
    return attrs;
}
function uniqueUrls(values, limit) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const normalized = normalizeWhitespace(value ?? '');
        if (!normalized)
            continue;
        const key = normalized.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(normalized);
        if (out.length >= limit)
            break;
    }
    return out;
}
function extractMetaContent(html, key) {
    const wanted = key.toLowerCase();
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attrs = extractAttributes(match[0]);
        const name = (attrs.name ?? attrs.property ?? attrs.itemprop ?? '').toLowerCase();
        if (name === wanted && attrs.content)
            return normalizeWhitespace(attrs.content);
    }
    return '';
}
function extractLinkHref(html, rel) {
    const wanted = rel.toLowerCase();
    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const attrs = extractAttributes(match[0]);
        if ((attrs.rel ?? '').toLowerCase().split(/\s+/).includes(wanted) && attrs.href) {
            return attrs.href.trim();
        }
    }
    return '';
}
function extractTitle(html) {
    const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return match ? normalizeWhitespace(match[1]) : '';
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
function extractBodyText(html) {
    return normalizeWhitespace(html
        .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')).slice(0, 6000);
}
function extractImageUrls(baseUrl, html) {
    const urls = [
        absoluteUrl(baseUrl, extractMetaContent(html, 'og:image')),
        absoluteUrl(baseUrl, extractMetaContent(html, 'og:image:url')),
        absoluteUrl(baseUrl, extractMetaContent(html, 'twitter:image')),
    ];
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
        const attrs = extractAttributes(match[0]);
        urls.push(absoluteUrl(baseUrl, attrs.src));
    }
    return uniqueUrls(urls, 10);
}
function extractVideoUrls(baseUrl, html) {
    const urls = [
        absoluteUrl(baseUrl, extractMetaContent(html, 'og:video')),
        absoluteUrl(baseUrl, extractMetaContent(html, 'og:video:url')),
        absoluteUrl(baseUrl, extractMetaContent(html, 'og:video:secure_url')),
        absoluteUrl(baseUrl, extractMetaContent(html, 'twitter:player')),
    ];
    for (const match of html.matchAll(/<(?:video|source)\b[^>]*>/gi)) {
        const attrs = extractAttributes(match[0]);
        const type = (attrs.type ?? '').toLowerCase();
        if (!type || type.startsWith('video/'))
            urls.push(absoluteUrl(baseUrl, attrs.src));
    }
    return uniqueUrls(urls, 10);
}
function parseGithubReleaseUrl(url) {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'github.com')
        return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || parts[2] !== 'releases' || parts[3] !== 'tag')
        return null;
    return {
        owner: parts[0],
        repo: parts[1],
        tag: decodeURIComponent(parts.slice(4).join('/')),
    };
}
function rawUrls(text) {
    return uniqueUrls(Array.from(text.matchAll(/https?:\/\/[^\s)"'<>]+/g), (match) => match[0].replace(/[.,;:]+$/, '')), 20);
}
function markdownImageUrls(text) {
    return uniqueUrls(Array.from(text.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g), (match) => match[1]), 10);
}
function looksLikeImage(url) {
    return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(url);
}
function looksLikeVideo(url) {
    return /\.(?:m4v|mov|mp4|webm)(?:[?#].*)?$/i.test(url);
}
function cleanMarkdown(markdown) {
    return normalizeWhitespace(markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/[#>*_`~|-]+/g, ' ')).slice(0, 6000);
}
function firstParagraph(value) {
    const [first] = value
        .split(/\n{2,}/)
        .map((part) => cleanMarkdown(part))
        .filter(Boolean);
    return (first ?? cleanMarkdown(value)).slice(0, 700);
}
function mediaItems(imageUrls, videoUrls) {
    return [
        ...imageUrls.map((url) => ({ kind: 'image', url })),
        ...videoUrls.map((url) => ({ kind: 'video', url })),
    ];
}
function imageFileName(imageUrl, mimeType) {
    const ext = IMAGE_MIME_EXT[mimeType.split(';')[0].toLowerCase()] ?? '';
    try {
        const parsed = new URL(imageUrl);
        const name = path_1.default.basename(decodeURIComponent(parsed.pathname)) || 'source-reference';
        const nameExt = path_1.default.extname(name);
        return nameExt ? name : `${name}${ext || '.png'}`;
    }
    catch {
        return `source-reference${ext || '.png'}`;
    }
}
async function fetchHtml(url) {
    const response = await axios_1.default.get(url, {
        headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': '1MarketingTool/0.1 VideoSourceFetcher',
        },
        maxContentLength: 3_000_000,
        responseType: 'text',
        timeout: 18000,
        validateStatus: (status) => status >= 200 && status < 400,
    });
    return String(response.data ?? '');
}
async function fetchHtmlSource(url) {
    const html = await fetchHtml(url);
    return extractHtmlSource(url, html);
}
function extractHtmlSource(url, html) {
    const h1 = extractTagText(html, 'h1', 4);
    const h2 = extractTagText(html, 'h2', 8);
    const title = extractMetaContent(html, 'og:title') || extractMetaContent(html, 'twitter:title') || extractTitle(html);
    const description = extractMetaContent(html, 'og:description') ||
        extractMetaContent(html, 'twitter:description') ||
        extractMetaContent(html, 'description');
    const bodyText = extractBodyText(html);
    return {
        url,
        canonicalUrl: absoluteUrl(url, extractLinkHref(html, 'canonical')),
        title,
        description,
        bodyText: bodyText || [...h1, ...h2].join('. '),
        imageUrls: extractImageUrls(url, html),
        videoUrls: extractVideoUrls(url, html),
    };
}
function extractGithubReleaseBodyHtml(html) {
    const match = html.match(/<div\b[^>]*data-test-selector=["']body-content["'][^>]*class=["'][^"']*markdown-body[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
    return match?.[1] ?? '';
}
class VideoSourceService {
    async fetch(input) {
        const url = normalizeUrl(input.url);
        const githubRelease = parseGithubReleaseUrl(url);
        if (githubRelease) {
            try {
                return await this.fetchGithubRelease(url, githubRelease, input.productId ?? null);
            }
            catch {
                // GitHub's public API can be rate-limited; scrape the public release page as a fallback.
                return this.fetchGithubReleaseHtml(url, githubRelease, input.productId ?? null);
            }
        }
        return this.fetchWebsite(url, input.productId ?? null);
    }
    async fetchWebsite(url, productId) {
        const source = await fetchHtmlSource(url);
        const referenceAssets = await this.importReferenceImages(source.imageUrls, productId, source.title || 'Source reference', source.url);
        const referenceAsset = referenceAssets[0] ?? null;
        const summary = source.description || source.bodyText.slice(0, 700);
        return {
            sourceType: 'website',
            url: source.url,
            canonicalUrl: source.canonicalUrl,
            title: source.title || new URL(source.url).hostname.replace(/^www\./, ''),
            description: source.description,
            summary,
            bodyText: source.bodyText,
            imageUrls: source.imageUrls,
            videoUrls: source.videoUrls,
            media: mediaItems(source.imageUrls, source.videoUrls),
            referenceAsset,
            referenceAssets,
            release: null,
        };
    }
    async fetchGithubRelease(htmlUrl, match, productId) {
        const apiUrl = `https://api.github.com/repos/${encodeURIComponent(match.owner)}/${encodeURIComponent(match.repo)}/releases/tags/${encodeURIComponent(match.tag)}`;
        const response = await axios_1.default.get(apiUrl, {
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': '1MarketingTool/0.1 VideoSourceFetcher',
            },
            maxContentLength: 1_500_000,
            timeout: 18000,
            validateStatus: (status) => status >= 200 && status < 400,
        });
        const data = response.data;
        const body = typeof data.body === 'string' ? data.body : '';
        const title = normalizeWhitespace(String(data.name || match.tag));
        const htmlMetadata = await fetchHtmlSource(htmlUrl).catch(() => null);
        const urls = rawUrls(body);
        const releaseAssets = Array.isArray(data.assets) ? data.assets : [];
        const assetVideos = releaseAssets
            .filter((asset) => Boolean(asset && typeof asset === 'object'))
            .filter((asset) => {
            const contentType = typeof asset.content_type === 'string' ? asset.content_type : '';
            const name = typeof asset.name === 'string' ? asset.name : '';
            return contentType.startsWith('video/') || looksLikeVideo(name);
        })
            .map((asset) => (typeof asset.browser_download_url === 'string' ? asset.browser_download_url : ''));
        const imageUrls = uniqueUrls([
            ...markdownImageUrls(body),
            ...urls.filter(looksLikeImage),
            ...(htmlMetadata?.imageUrls ?? []),
        ], 10);
        const videoUrls = uniqueUrls([...urls.filter(looksLikeVideo), ...assetVideos, ...(htmlMetadata?.videoUrls ?? [])], 10);
        const referenceAssets = await this.importReferenceImages(imageUrls, productId, title || 'Release reference', htmlUrl);
        const referenceAsset = referenceAssets[0] ?? null;
        const release = {
            owner: match.owner,
            repo: match.repo,
            tag: String(data.tag_name || match.tag),
            name: title,
            body,
            publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
            author: data.author && typeof data.author === 'object' && typeof data.author.login === 'string'
                ? data.author.login
                : null,
            assets: releaseAssets
                .filter((asset) => Boolean(asset && typeof asset === 'object'))
                .slice(0, 12)
                .map((asset) => ({
                name: typeof asset.name === 'string' ? asset.name : 'asset',
                downloadUrl: typeof asset.browser_download_url === 'string' ? asset.browser_download_url : '',
                contentType: typeof asset.content_type === 'string' ? asset.content_type : null,
                sizeBytes: typeof asset.size === 'number' ? asset.size : null,
            })),
        };
        return {
            sourceType: 'github_release',
            url: htmlUrl,
            canonicalUrl: typeof data.html_url === 'string' ? data.html_url : htmlUrl,
            title: title || `${match.repo} ${match.tag}`,
            description: firstParagraph(body),
            summary: `${match.owner}/${match.repo} ${release.tag}: ${firstParagraph(body)}`,
            bodyText: cleanMarkdown(body),
            imageUrls,
            videoUrls,
            media: mediaItems(imageUrls, videoUrls),
            referenceAsset,
            referenceAssets,
            release,
        };
    }
    async fetchGithubReleaseHtml(htmlUrl, match, productId) {
        const html = await fetchHtml(htmlUrl);
        const source = extractHtmlSource(htmlUrl, html);
        const bodyHtml = extractGithubReleaseBodyHtml(html);
        const bodyText = bodyHtml ? extractBodyText(bodyHtml) : source.bodyText;
        const imageUrls = uniqueUrls([...(bodyHtml ? extractImageUrls(htmlUrl, bodyHtml) : []), ...source.imageUrls], 10);
        const videoUrls = uniqueUrls([...(bodyHtml ? extractVideoUrls(htmlUrl, bodyHtml) : []), ...source.videoUrls], 10);
        const title = source.title || `${match.repo} ${match.tag}`;
        const description = bodyText.slice(0, 700) || source.description;
        const referenceAssets = await this.importReferenceImages(imageUrls, productId, title, htmlUrl);
        const referenceAsset = referenceAssets[0] ?? null;
        const release = {
            owner: match.owner,
            repo: match.repo,
            tag: match.tag,
            name: title,
            body: bodyText,
            publishedAt: null,
            author: null,
            assets: [],
        };
        return {
            sourceType: 'github_release',
            url: htmlUrl,
            canonicalUrl: source.canonicalUrl ?? htmlUrl,
            title,
            description,
            summary: `${match.owner}/${match.repo} ${match.tag}: ${description}`,
            bodyText,
            imageUrls,
            videoUrls,
            media: mediaItems(imageUrls, videoUrls),
            referenceAsset,
            referenceAssets,
            release,
        };
    }
    async importReferenceImages(imageUrls, productId, title, sourceUrl) {
        const assets = [];
        const seen = new Set();
        for (const imageUrl of imageUrls.slice(0, 8)) {
            const key = imageUrl.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            try {
                const response = await axios_1.default.get(imageUrl, {
                    headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml' },
                    maxContentLength: 6_000_000,
                    responseType: 'arraybuffer',
                    timeout: 15000,
                    validateStatus: (status) => status >= 200 && status < 400,
                });
                const mimeType = String(response.headers['content-type'] ?? '').split(';')[0].toLowerCase();
                if (!mimeType.startsWith('image/'))
                    continue;
                const asset = await AssetService_1.assetService.importBytes(Buffer.from(response.data), {
                    originalName: imageFileName(imageUrl, mimeType),
                    mimeType,
                    productId,
                    title: assets.length ? `${title} source image ${assets.length + 1}` : `${title} reference image`,
                    tags: ['video-source', 'reference'],
                    metadata: { source: 'video-source', sourceUrl, imageUrl },
                });
                assets.push(asset);
                if (assets.length >= 4)
                    break;
            }
            catch {
                // Try the next extracted image.
            }
        }
        return assets;
    }
}
exports.VideoSourceService = VideoSourceService;
exports.videoSourceService = new VideoSourceService();
//# sourceMappingURL=VideoSourceService.js.map