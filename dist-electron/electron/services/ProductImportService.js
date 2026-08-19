"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.productImportService = void 0;
const AppRepository_1 = require("./AppRepository");
const ProductInfoService_1 = require("./ProductInfoService");
const ConnectorService_1 = require("./ConnectorService");
const LicenseService_1 = require("./LicenseService");
const SeoDataService_1 = require("./seo/SeoDataService");
const gscProperty_1 = require("./google/gscProperty");
const domain_1 = require("../utils/domain");
function buildCreateInput(parsed, workspaceId, suggestion) {
    if (suggestion) {
        return {
            name: suggestion.name || parsed.displayName,
            url: parsed.canonicalUrl,
            tagline: suggestion.tagline,
            shortDescription: suggestion.shortDescription,
            mediumDescription: suggestion.mediumDescription,
            longDescription: suggestion.longDescription,
            logoUrl: suggestion.logoUrl,
            screenshotUrls: suggestion.screenshotUrls,
            demoVideoUrl: suggestion.demoVideoUrl,
            categories: suggestion.categories,
            tags: suggestion.tags,
            pricingModel: suggestion.pricingModel,
            platforms: suggestion.platforms,
            targetUser: suggestion.targetUser,
            painSolved: suggestion.painSolved,
            competitors: suggestion.competitors,
            seedKeywords: suggestion.seedKeywords,
            workspaceId,
        };
    }
    // Stub fallback: name from the host, descriptions left blank for the user to enrich.
    return {
        name: parsed.displayName,
        url: parsed.canonicalUrl,
        tagline: '',
        shortDescription: '',
        mediumDescription: '',
        longDescription: '',
        workspaceId,
    };
}
class ProductImportService {
    /**
     * Import GSC sites as projects. Runs sequentially: per site we optionally run AI
     * autofill (public-site fetch), create the project in the chosen workspace, and
     * record a GSC property mapping. Autofill failures fall back to a stub so one
     * flaky fetch never blocks the batch. Progress is streamed per site.
     */
    async importGscSites(input, onProgress) {
        const items = Array.isArray(input.items) ? input.items : [];
        const autofill = input.autofill !== false;
        const total = items.length;
        const created = [];
        const failures = [];
        const skipped = [];
        const mappings = [];
        // Defensive dedup against projects that already exist. Mirror the import
        // modal's dedup set (live projects only) — archived/deleted projects are
        // invisible to the user everywhere in the UI, so counting them here would
        // silently skip a re-import as "Already imported" with no project to show.
        const existingHosts = new Set(AppRepository_1.repository.listProducts().map((product) => (0, gscProperty_1.hostKeyFromUrl)(product.url)).filter(Boolean));
        const emit = (progress) => {
            try {
                onProgress?.(progress);
            }
            catch {
                // progress is best-effort; never let a dead renderer abort the import
            }
        };
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            const siteUrl = item?.siteUrl ?? '';
            const parsed = (0, gscProperty_1.parseGscSiteUrl)(siteUrl);
            if (!parsed || !item?.workspaceId) {
                failures.push({ siteUrl, error: 'Unrecognized property or missing workspace.' });
                emit({ siteUrl, index, total, phase: 'failed', message: 'Invalid property' });
                continue;
            }
            if (existingHosts.has(parsed.host)) {
                skipped.push({ siteUrl, reason: 'Already imported' });
                emit({ siteUrl, index, total, phase: 'skipped', message: 'Already imported' });
                continue;
            }
            const projectLimit = LicenseService_1.licenseService.canAddProject(AppRepository_1.repository.listProducts(false).length);
            if (!projectLimit.allowed) {
                const message = projectLimit.reason || 'Project limit reached. Upgrade to Pro for unlimited projects.';
                failures.push({ siteUrl, error: message });
                emit({ siteUrl, index, total, phase: 'failed', message });
                continue;
            }
            let suggestion = null;
            if (autofill) {
                emit({ siteUrl, index, total, phase: 'fetching', message: 'Fetching site details' });
                try {
                    suggestion = await ProductInfoService_1.productInfoService.fetchInfo(parsed.canonicalUrl);
                }
                catch {
                    suggestion = null;
                }
            }
            emit({ siteUrl, index, total, phase: 'creating', message: 'Creating project', autofilled: Boolean(suggestion) });
            try {
                const product = AppRepository_1.repository.createProduct(buildCreateInput(parsed, item.workspaceId, suggestion));
                created.push(product);
                existingHosts.add(parsed.host);
                mappings.push({
                    productId: product.id,
                    serviceAccountId: input.serviceAccountId ?? '',
                    propertyUrl: parsed.raw,
                });
                // Seed an Ahrefs Domain Rating for the new site (same source the dashboard uses) so the
                // project shows authority right away instead of waiting for the next dashboard sync.
                emit({ siteUrl, index, total, phase: 'rank', message: 'Checking domain rating', autofilled: Boolean(suggestion) });
                await this.checkDomainRating(product);
                emit({
                    siteUrl,
                    index,
                    total,
                    phase: 'done',
                    productId: product.id,
                    autofilled: Boolean(suggestion),
                    message: suggestion ? 'Imported' : 'Imported (autofill skipped)',
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to create project';
                failures.push({ siteUrl, error: message });
                emit({ siteUrl, index, total, phase: 'failed', message });
            }
        }
        if (mappings.length > 0) {
            try {
                ConnectorService_1.connectorService.addGoogleProjectMappings(mappings.map((mapping) => ({ ...mapping, ga4Property: '' })));
            }
            catch {
                // mapping is a convenience; a failure here must not fail the import
            }
        }
        return { created, failures, skipped };
    }
    /**
     * Seed a Domain Rating snapshot for a freshly imported site via Ahrefs' public endpoint — the
     * same source {@link DashboardAggregatorService} uses for its rank refresh. Writing it into the
     * `domain_authority` table here means the dashboard shows authority for the new project on first
     * read instead of waiting for the next workspace sync. Best-effort: a provider failure must never
     * fail the import, and the dashboard sync will retry on its own freshness gate.
     */
    async checkDomainRating(product) {
        const domain = (0, domain_1.extractDomain)(product.url);
        if (!domain)
            return;
        try {
            const [metrics] = await SeoDataService_1.seoDataService.bulkDomainAuthority([domain]);
            if (!metrics)
                return;
            AppRepository_1.repository.createDomainAuthority({
                productId: product.id,
                domain,
                domainRating: metrics.domainRating,
                urlRating: 0,
                backlinks: metrics.backlinks,
                linkingWebsites: metrics.linkingWebsites,
                source: metrics.source,
            });
        }
        catch {
            // Domain Rating is a convenience on import; the dashboard refreshes it on its next sync.
        }
    }
}
exports.productImportService = new ProductImportService();
//# sourceMappingURL=ProductImportService.js.map