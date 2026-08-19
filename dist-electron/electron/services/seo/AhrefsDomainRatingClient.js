"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ahrefsDomainRatingClient = exports.AhrefsDomainRatingClient = void 0;
const domain_1 = require("../../utils/domain");
const ApiLogService_1 = require("../ApiLogService");
const AHREFS_BASE_URL = 'https://api.ahrefs.com';
const DOMAIN_RATING_PATH = '/v3/public/domain-rating-free';
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function readNumber(value) {
    if (typeof value === 'number')
        return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim())
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function parseJsonOrText(value) {
    if (!value.trim())
        return null;
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function ahrefsErrorMessage(status, body) {
    let detail = '';
    if (isRecord(body)) {
        const message = body.message ?? body.error ?? body.detail;
        if (typeof message === 'string' && message.trim())
            detail = `: ${message.trim()}`;
    }
    else if (typeof body === 'string' && body.trim()) {
        detail = `: ${body.trim()}`;
    }
    return status ? `Ahrefs Domain Rating request failed (${status})${detail}.` : `Ahrefs Domain Rating request failed${detail}.`;
}
function readDomainRating(body) {
    if (!isRecord(body))
        return null;
    const domainRating = body.domain_rating;
    if (!isRecord(domainRating))
        return null;
    return readNumber(domainRating.domain_rating);
}
class AhrefsDomainRatingClient {
    name = 'ahrefs';
    async getDomainAuthority(domain) {
        const normalizedDomain = (0, domain_1.extractDomain)(domain);
        if (!normalizedDomain)
            throw new Error('Enter a domain to check Domain Rating.');
        const domainRating = await this.fetchDomainRating(normalizedDomain);
        return {
            domain: normalizedDomain,
            domainRating: Math.round(domainRating),
            urlRating: 0,
            backlinks: 0,
            linkingWebsites: 0,
            source: this.name,
        };
    }
    async bulkDomainAuthority(domains) {
        const targets = Array.from(new Set(domains.map((domain) => (0, domain_1.extractDomain)(domain)).filter(Boolean)));
        const results = [];
        let lastError = null;
        for (const target of targets) {
            try {
                const result = await this.getDomainAuthority(target);
                results.push({
                    domain: result.domain,
                    domainRating: result.domainRating,
                    backlinks: result.backlinks,
                    linkingWebsites: result.linkingWebsites,
                    source: result.source,
                });
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error('Ahrefs Domain Rating request failed.');
            }
        }
        if (results.length === 0 && lastError)
            throw lastError;
        return results;
    }
    async fetchDomainRating(target) {
        const path = `${DOMAIN_RATING_PATH}?target=${encodeURIComponent(target)}`;
        const started = Date.now();
        let statusCode = null;
        let body = null;
        try {
            const response = await fetch(`${AHREFS_BASE_URL}${path}`, {
                method: 'GET',
                headers: {
                    Accept: 'application/json',
                },
            });
            statusCode = response.status;
            body = parseJsonOrText(await response.text());
            if (!response.ok) {
                throw new Error(ahrefsErrorMessage(statusCode, body));
            }
            const domainRating = readDomainRating(body);
            if (domainRating == null) {
                throw new Error(`Ahrefs returned no Domain Rating for ${target}.`);
            }
            this.recordApiCall(path, started, statusCode, body, null);
            return domainRating;
        }
        catch (error) {
            const mapped = error instanceof Error ? error : new Error('Ahrefs Domain Rating request failed.');
            this.recordApiCall(path, started, statusCode, body, mapped);
            throw mapped;
        }
    }
    recordApiCall(path, startedAt, statusCode, body, error) {
        ApiLogService_1.apiLogService.record({
            provider: this.name,
            method: 'GET',
            path,
            status: error ? 'error' : 'success',
            statusCode,
            summary: `GET ${path}`,
            detail: error ? error.message : null,
            requestBody: null,
            responseBody: body,
            cost: null,
            durationMs: Date.now() - startedAt,
        });
    }
}
exports.AhrefsDomainRatingClient = AhrefsDomainRatingClient;
exports.ahrefsDomainRatingClient = new AhrefsDomainRatingClient();
//# sourceMappingURL=AhrefsDomainRatingClient.js.map