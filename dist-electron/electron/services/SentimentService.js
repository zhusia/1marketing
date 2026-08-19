"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sentimentService = void 0;
const axios_1 = __importDefault(require("axios"));
const ConnectorService_1 = require("./ConnectorService");
const ApiLogService_1 = require("./ApiLogService");
const NLP_ENDPOINT = 'https://language.googleapis.com/v1/documents:analyzeSentiment';
/**
 * Optional sentiment scoring via Google's Natural Language API. When the
 * `google_nlp` connector is configured (BYOK), brand-mention snippets are scored
 * on a normalized 0–100 scale; otherwise callers fall back to the AI-estimated
 * sentiment produced during extraction.
 */
class SentimentService {
    /** True when the google_nlp connector is enabled and has a stored key. */
    isConfigured() {
        const connector = ConnectorService_1.connectorService.listConnectors().find((entry) => entry.name === 'google_nlp');
        return Boolean(connector?.enabled && connector.hasSecret);
    }
    async resolveApiKey() {
        const secret = await ConnectorService_1.connectorService.getSecret('google_nlp');
        const key = secret?.apiKey ?? secret?.key ?? secret?.token;
        return typeof key === 'string' && key.trim() ? key.trim() : null;
    }
    /**
     * Score each snippet, returning a 0–100 sentiment (or null when a snippet is
     * empty / the call fails / the API is not configured). Never throws — sentiment
     * is best-effort and must not sink a tracker run.
     */
    async scoreMany(snippets) {
        if (!this.isConfigured())
            return snippets.map(() => null);
        const apiKey = await this.resolveApiKey();
        if (!apiKey)
            return snippets.map(() => null);
        const out = [];
        for (const snippet of snippets) {
            out.push(await this.scoreOne(snippet, apiKey));
        }
        return out;
    }
    async scoreOne(snippet, apiKey) {
        const text = (snippet ?? '').trim();
        if (!text)
            return null;
        const startedAt = Date.now();
        try {
            const response = await axios_1.default.post(`${NLP_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, { document: { type: 'PLAIN_TEXT', content: text.slice(0, 1000) }, encodingType: 'UTF8' }, { headers: { 'Content-Type': 'application/json' }, timeout: 20_000 });
            const score = response.data?.documentSentiment?.score;
            ApiLogService_1.apiLogService.record({
                provider: 'google_nlp',
                method: 'POST',
                path: '/v1/documents:analyzeSentiment',
                status: 'success',
                statusCode: 200,
                summary: 'analyzeSentiment',
                detail: null,
                cost: null,
                durationMs: Date.now() - startedAt,
            });
            if (typeof score !== 'number' || !Number.isFinite(score))
                return null;
            // Google returns -1..1; normalize to 0..100.
            return Math.min(Math.max(Math.round(((score + 1) / 2) * 100), 0), 100);
        }
        catch (error) {
            ApiLogService_1.apiLogService.record({
                provider: 'google_nlp',
                method: 'POST',
                path: '/v1/documents:analyzeSentiment',
                status: 'error',
                statusCode: axios_1.default.isAxiosError(error) ? error.response?.status ?? null : null,
                summary: 'analyzeSentiment',
                detail: error instanceof Error ? error.message : 'sentiment request failed',
                cost: null,
                durationMs: Date.now() - startedAt,
            });
            return null;
        }
    }
}
exports.sentimentService = new SentimentService();
//# sourceMappingURL=SentimentService.js.map