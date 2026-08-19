"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectAiResponseFailure = detectAiResponseFailure;
const ANSI_ESCAPE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g;
const MAX_FAILURE_MESSAGE_LENGTH = 600;
/**
 * Some local CLIs report a provider failure as their final stdout message and
 * still exit with code 0. Without a content-level guard, that error text looks
 * like a successful model answer and can be persisted as campaign content.
 *
 * These patterns are deliberately anchored and provider-specific. A real post
 * may discuss an API error anywhere in its body; only a response whose entire
 * answer starts like a terminal provider failure is rejected.
 */
const FAILURE_PATTERNS = [
    /^API call failed after \d+ retr(?:y|ies)\s*:/i,
    /^API failed after \d+ retr(?:y|ies)\b/i,
    /^Invalid API response after \d+ retr(?:y|ies)(?:\s*[:.]|$)/i,
    /^Billing or credits exhausted\s*:/i,
    /^(?:Provider|Gateway)\s+error\s*:/i,
    /^(?:The\s+)?model returned no content after all retries\b/i,
    /^(?:Fatal\s+)?Error\s*:\s*(?:API|provider|gateway|authentication|authorization|billing|quota|rate limit|connection|request)\b/i,
    /^❌\s*(?:API|Provider|Gateway|Model)\b.*\b(?:failed|error|no content)\b/i,
];
function withoutAnsi(value) {
    return value.replace(ANSI_ESCAPE, '').trim();
}
function compactFailure(value) {
    const title = value.match(/["']title["']\s*:\s*["']([^"'\r\n]{1,200})["']/i)?.[1]?.trim() ?? null;
    let compact = value.replace(/\s+/g, ' ').trim();
    // Hermes may append a large Python-style Cloudflare error dictionary. Keep
    // the actionable prefix and title instead of flooding a toast or progress log.
    const structuredDetailIndex = compact.search(/\s+-\s+\{["'](?:type|title|status|detail)["']\s*:/i);
    if (structuredDetailIndex >= 0)
        compact = compact.slice(0, structuredDetailIndex).trim();
    if (title && !compact.toLowerCase().includes(title.toLowerCase())) {
        compact = `${compact} — ${title}`;
    }
    return compact.length > MAX_FAILURE_MESSAGE_LENGTH
        ? `${compact.slice(0, MAX_FAILURE_MESSAGE_LENGTH - 1).trimEnd()}…`
        : compact;
}
/** Return a user-displayable failure when stdout is actually an error response. */
function detectAiResponseFailure(raw) {
    const text = withoutAnsi(raw);
    if (!text || !FAILURE_PATTERNS.some((pattern) => pattern.test(text)))
        return null;
    return compactFailure(text);
}
//# sourceMappingURL=aiResponse.js.map