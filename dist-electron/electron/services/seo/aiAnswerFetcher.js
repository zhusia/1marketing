"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAiAnswer = fetchAiAnswer;
const ConnectorService_1 = require("../ConnectorService");
const DataForSeoClient_1 = require("./DataForSeoClient");
const SerpScrapeService_1 = require("./SerpScrapeService");
/** A DataForSEO client bound to the stored credentials, or null when not connected/enabled. */
function dataForSeoClientOrNull() {
    const connector = ConnectorService_1.connectorService.listConnectors().find((entry) => entry.name === 'dataforseo');
    if (connector?.enabled && connector.hasSecret) {
        return new DataForSeoClient_1.DataForSeoClient({ getSecret: () => ConnectorService_1.connectorService.getSecret('dataforseo') });
    }
    return null;
}
/**
 * Fetch one AI answer from the requested source, with the documented fallbacks:
 * - Browser scrape can only read AI Overview; AI Mode always routes to DataForSEO.
 * - The same `AiAnswer` shape is returned regardless of source, so everything
 *   downstream (extraction, metrics, dashboards) is source-agnostic.
 */
async function fetchAiAnswer(options) {
    const { term, engine, source, location, language } = options;
    if (source === 'browser' && engine === 'ai_overview') {
        return SerpScrapeService_1.serpScrapeService.scrapeAiOverview(term, location);
    }
    const client = dataForSeoClientOrNull();
    if (!client) {
        throw new Error(engine === 'ai_mode'
            ? 'Google AI Mode requires DataForSEO. Connect and enable DataForSEO in Settings > Connectors (browser scrape can only read AI Overview).'
            : 'Connect and enable DataForSEO in Settings > Connectors, or set the tracker source to Browser scrape.');
    }
    return engine === 'ai_mode'
        ? client.aiMode(term, location, language)
        : client.aiOverview(term, location, language);
}
//# sourceMappingURL=aiAnswerFetcher.js.map