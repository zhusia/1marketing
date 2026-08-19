"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGoogleSearchConsoleLinks = parseGoogleSearchConsoleLinks;
exports.buildBacklinkProfileFromCapture = buildBacklinkProfileFromCapture;
const SECTION_HEADINGS = [
    'top linking sites',
    'top linking text',
    'top linked pages',
    'top target pages',
];
// Lines that mark the end of a section's rows.
const STOP_TERMS = new Set([
    'more',
    'show more',
    'export',
    'internal links',
    'external links',
    'who links the most',
    'your most linked content',
    'how your data is linked',
    ...SECTION_HEADINGS,
]);
function parseCount(value) {
    const cleaned = value.replace(/[,\s]/g, '');
    if (!/^\d+$/.test(cleaned))
        return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
}
function isStop(line) {
    return STOP_TERMS.has(line.trim().toLowerCase());
}
/** Collect (label, count) rows that follow a section heading until the next stop term. */
function extractSection(lines, heading) {
    const start = lines.findIndex((line) => line.trim().toLowerCase() === heading);
    if (start === -1)
        return [];
    const rows = [];
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line)
            continue;
        if (isStop(line))
            break;
        if (rows.length >= 1000)
            break;
        // One-line layout: "niviki.com 621" (label, then a trailing number).
        const inline = line.match(/^(.+?)\s+([\d,]+)$/);
        if (inline && parseCount(line) === null) {
            const count = parseCount(inline[2]);
            const label = inline[1].trim();
            if (count !== null && label && !isStop(label)) {
                rows.push({ label, count });
                continue;
            }
        }
        // Two-line layout: a label line immediately followed by a count line.
        if (parseCount(line) === null) {
            const count = parseCount(lines[index + 1] ?? '');
            if (count !== null) {
                rows.push({ label: line, count });
                index += 1; // consume the count line
            }
        }
    }
    return rows;
}
function parseGoogleSearchConsoleLinks(pageText) {
    const lines = (pageText ?? '').split('\n');
    const sites = extractSection(lines, 'top linking sites');
    const texts = extractSection(lines, 'top linking text');
    return {
        referringDomains: sites.map((row) => ({
            domain: row.label,
            backlinks: row.count,
            domainRank: null,
        })),
        anchors: texts.map((row) => ({
            anchor: row.label,
            backlinks: row.count,
            referringDomains: 0,
        })),
    };
}
/** Build a backlink profile from a captured GSC Links page, or null if nothing parseable was found. */
function buildBacklinkProfileFromCapture(capture, domain) {
    const { referringDomains, anchors } = parseGoogleSearchConsoleLinks(capture.pageText ?? '');
    if (referringDomains.length === 0 && anchors.length === 0)
        return null;
    return {
        domain,
        referringDomains,
        anchors,
        source: 'google_search_console',
    };
}
//# sourceMappingURL=googleSearchConsoleLinks.js.map