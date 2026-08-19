"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSeoProvider = createSeoProvider;
const DataForSeoClient_1 = require("./DataForSeoClient");
async function createSeoProvider(connectorService, capability) {
    const dataForSeo = connectorService.listConnectors().find((connector) => connector.name === 'dataforseo');
    if (dataForSeo?.enabled && dataForSeo.hasSecret) {
        const provider = new DataForSeoClient_1.DataForSeoClient({
            getSecret: () => connectorService.getSecret('dataforseo'),
        });
        if (provider.capabilities[capability])
            return provider;
    }
    throw new Error(providerMissingMessage(capability));
}
function providerMissingMessage(capability) {
    if (capability === 'backlinks') {
        return 'Connect and enable DataForSEO in Settings > Connectors to load backlink and linking-website details.';
    }
    if (capability === 'keywords') {
        return 'Connect and enable DataForSEO in Settings > Connectors to use keyword research.';
    }
    return 'Connect and enable DataForSEO in Settings > Connectors to check live SERP positions.';
}
//# sourceMappingURL=providerFactory.js.map