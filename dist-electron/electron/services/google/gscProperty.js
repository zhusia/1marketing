"use strict";
// Main-process counterpart to src/lib/gscSite.ts. The renderer and main process are
// separate TypeScript projects (no shared import path), so the small normalization
// logic is duplicated here for the defensive dedup guard during import.
Object.defineProperty(exports, "__esModule", { value: true });
exports.hostKeyFromUrl = hostKeyFromUrl;
exports.parseGscSiteUrl = parseGscSiteUrl;
function normalizeHost(value) {
    let host = value.trim().toLowerCase();
    if (!host)
        return '';
    host = host.replace(/^https?:\/\//, '');
    host = host.split('/')[0];
    host = host.split('?')[0];
    host = host.split('#')[0];
    host = host.split(':')[0];
    host = host.replace(/^www\./, '');
    return host;
}
/** Normalize any product/site URL to the host key used for matching. */
function hostKeyFromUrl(url) {
    return normalizeHost(url ?? '');
}
function parseGscSiteUrl(siteUrl) {
    const raw = (siteUrl ?? '').trim();
    if (!raw)
        return null;
    if (raw.startsWith('sc-domain:')) {
        const host = normalizeHost(raw.slice('sc-domain:'.length));
        if (!host)
            return null;
        return { raw, type: 'domain', host, canonicalUrl: `https://${host}/`, displayName: host };
    }
    const host = normalizeHost(raw);
    if (!host)
        return null;
    const canonicalUrl = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
    return { raw, type: 'url-prefix', host, canonicalUrl, displayName: host };
}
//# sourceMappingURL=gscProperty.js.map