"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractDomain = extractDomain;
function extractDomain(url) {
    try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        return parsed.hostname.replace(/^www\./, '');
    }
    catch {
        return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}
//# sourceMappingURL=domain.js.map