"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEMPLATE_TOKENS = exports.DEFAULT_HEADERS_TEMPLATE = exports.DEFAULT_BODY_TEMPLATE = void 0;
exports.buildTemplateValues = buildTemplateValues;
exports.sampleTemplateValues = sampleTemplateValues;
exports.renderTemplate = renderTemplate;
exports.parseHeaders = parseHeaders;
exports.isJsonContentType = isJsonContentType;
exports.pickResponsePath = pickResponsePath;
exports.renderRequest = renderRequest;
/**
 * Generic templating for the **Custom API** channel — lets a user point 1MarketingTool at any
 * HTTP endpoint (their blog / CMS / internal system) and map a post's content into that system's
 * request shape via `{{placeholder}}` tokens in a headers + body template. Shared by the publisher
 * (registry.ts) and the connection test (ConnectorService) so both render identically.
 */
/** Default JSON body — a sensible starting point the user edits to match their API. */
exports.DEFAULT_BODY_TEMPLATE = [
    '{',
    '  "title": "{{title}}",',
    '  "content": "{{content}}",',
    '  "url": "{{productUrl}}",',
    '  "published_at": "{{date}}"',
    '}',
].join('\n');
exports.DEFAULT_HEADERS_TEMPLATE = 'Authorization: Bearer {{secret}}';
/** Tokens the user can reference; surfaced in the setup guide. */
exports.TEMPLATE_TOKENS = [
    'content',
    'title',
    'secret',
    'productName',
    'productUrl',
    'productTagline',
    'firstComment',
    'date',
];
/** Resolve every `{{token}}` to its concrete value for a given post. */
function buildTemplateValues(input, secret, nowIso) {
    const body = input.body ?? '';
    const firstBreak = body.indexOf('\n');
    const title = firstBreak === -1 ? body : body.slice(0, firstBreak).trim();
    return {
        content: body,
        body,
        text: body,
        title,
        summary: title,
        secret,
        productname: input.product?.name ?? '',
        producturl: input.product?.url ?? '',
        producttagline: input.product?.tagline ?? '',
        firstcomment: input.firstComment ?? '',
        date: nowIso,
        isodate: nowIso,
    };
}
/** Sample values so the connection test can render the templates without a real post. */
function sampleTemplateValues(secret, nowIso) {
    return buildTemplateValues({
        body: 'Sample post title\nThis is a sample body sent by the connection test.',
        firstComment: null,
        product: { name: 'Sample Product', url: 'https://example.com', tagline: 'A sample tagline' },
    }, secret, nowIso);
}
/**
 * Replace `{{token}}` occurrences (case-insensitive, whitespace-tolerant). When `jsonContext` is
 * true, values are JSON-string-escaped so quotes/newlines in content don't break a JSON body.
 * Unknown tokens render as empty string.
 */
function renderTemplate(template, values, jsonContext) {
    return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, rawKey) => {
        const value = values[rawKey.toLowerCase()] ?? '';
        if (!jsonContext)
            return value;
        // Strip the surrounding quotes JSON.stringify adds — the template already supplies them.
        const json = JSON.stringify(value);
        return json.slice(1, -1);
    });
}
/** Parse a newline-separated `Header-Name: value` template into a header map (after token substitution). */
function parseHeaders(template, values) {
    const headers = {};
    if (!template)
        return headers;
    for (const line of template.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const colon = trimmed.indexOf(':');
        if (colon === -1)
            continue;
        const name = trimmed.slice(0, colon).trim();
        const rawValue = trimmed.slice(colon + 1).trim();
        if (!name)
            continue;
        headers[name] = renderTemplate(rawValue, values, false);
    }
    return headers;
}
/** True when an explicit Content-Type header is absent or declares JSON. */
function isJsonContentType(headers) {
    const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type');
    if (!entry)
        return true; // default to JSON
    return /json/i.test(entry[1]);
}
/** Walk a dot/bracket path (`data.url`, `result[0].link`) into a response object; null when absent. */
function pickResponsePath(source, path) {
    if (!path)
        return null;
    const parts = path
        .replace(/\[(\w+)\]/g, '.$1')
        .split('.')
        .map((p) => p.trim())
        .filter(Boolean);
    let current = source;
    for (const part of parts) {
        if (current && typeof current === 'object') {
            current = current[part];
        }
        else {
            return null;
        }
    }
    return typeof current === 'string' ? current : current == null ? null : String(current);
}
const ALLOWED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/**
 * Render method + headers + body for a request, validating method and (for JSON) that the body
 * parses. Throws an Error with an actionable message on bad input — callers turn it into a fail().
 */
function renderRequest(config, values) {
    const method = (config.method?.trim() || 'POST').toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
        throw new Error(`Unsupported HTTP method "${method}" — use POST, PUT, PATCH, or DELETE.`);
    }
    const headers = parseHeaders(config.headersTemplate, values);
    const isJson = isJsonContentType(headers);
    if (isJson && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
    }
    const template = config.bodyTemplate?.trim() ? config.bodyTemplate : exports.DEFAULT_BODY_TEMPLATE;
    const rendered = renderTemplate(template, values, isJson);
    if (isJson) {
        try {
            return { method, headers, data: JSON.parse(rendered), isJson };
        }
        catch (error) {
            throw new Error(`Body template did not produce valid JSON: ${error instanceof Error ? error.message : 'parse error'}. ` +
                'Check quoting around your {{tokens}} or set a non-JSON Content-Type header.');
        }
    }
    return { method, headers, data: rendered, isJson };
}
//# sourceMappingURL=customApiTemplate.js.map