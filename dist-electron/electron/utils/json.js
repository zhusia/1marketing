"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeParseJson = safeParseJson;
exports.safeStringify = safeStringify;
function safeParseJson(value, fallback) {
    if (!value)
        return fallback;
    try {
        return JSON.parse(value);
    }
    catch {
        return fallback;
    }
}
function safeStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return '{}';
    }
}
//# sourceMappingURL=json.js.map