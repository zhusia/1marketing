"use strict";
/**
 * ApiLogService — records a persistent entry for every outbound third-party API
 * call (for example DataForSEO, Ahrefs, or PageSpeed), so the user can audit what was called, whether it
 * succeeded, how long it took, and what it cost.
 *
 * Recording is best-effort and never throws into the caller: a failed log write
 * must not break the API request it is describing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiLogService = void 0;
const AppRepository_1 = require("./AppRepository");
const MAX_DETAIL_CHARS = 4000;
// Request/response payloads are stored for inspection, so they get a far larger
// budget than one-line details — but still capped to keep the DB from bloating.
const MAX_BODY_CHARS = 20000;
function truncate(value, max) {
    if (!value)
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
/** Serialize an arbitrary payload to a pretty JSON string, then truncate. */
function serializeBody(value) {
    if (value == null)
        return null;
    if (typeof value === 'string')
        return truncate(value, MAX_BODY_CHARS);
    try {
        return truncate(JSON.stringify(value, null, 2), MAX_BODY_CHARS);
    }
    catch {
        return null;
    }
}
class ApiLogService {
    record(input) {
        try {
            return AppRepository_1.repository.createApiLog({
                ...input,
                summary: input.summary.slice(0, 280),
                detail: truncate(input.detail, MAX_DETAIL_CHARS),
                requestBody: serializeBody(input.requestBody),
                responseBody: serializeBody(input.responseBody),
            });
        }
        catch (error) {
            console.error('[api-log] failed to record entry', error);
            return null;
        }
    }
}
exports.apiLogService = new ApiLogService();
//# sourceMappingURL=ApiLogService.js.map