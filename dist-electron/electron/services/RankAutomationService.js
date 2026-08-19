"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankAutomationService = void 0;
const electron_1 = require("electron");
const channels_1 = require("../ipc/channels");
const AppRepository_1 = require("./AppRepository");
const SeoDataService_1 = require("./seo/SeoDataService");
const domain_1 = require("../utils/domain");
const DELAY_BETWEEN_SAVES_MS = 500;
const DOMAIN_RATING_SOURCE = 'ahrefs';
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
class RankAutomationService {
    running = false;
    progress = {
        status: 'idle',
        currentDomain: null,
        processedCount: 0,
        totalCount: 0,
        message: '',
        results: [],
        errors: [],
        logs: [],
    };
    isRunning() {
        return this.running;
    }
    getProgress() {
        return { ...this.progress };
    }
    async start(productId) {
        const products = productId
            ? [AppRepository_1.repository.getProduct(productId)].filter(Boolean)
            : AppRepository_1.repository.listProducts();
        if (products.length === 0) {
            throw new Error('No products found to check.');
        }
        const targets = products.map((product) => ({
            productId: product.id,
            domain: (0, domain_1.extractDomain)(product.url),
        }));
        await this.runTargets(targets, 'Starting Ahrefs Domain Rating check...');
    }
    async startBatch(targets) {
        const cleaned = targets
            .map((target) => ({
            productId: target.productId,
            domain: (0, domain_1.extractDomain)(target.domain.trim()),
        }))
            .filter((target) => target.productId && target.domain.length > 0);
        if (cleaned.length === 0) {
            throw new Error('No valid domains provided.');
        }
        await this.runTargets(cleaned, `Starting Ahrefs Domain Rating check for ${cleaned.length} domain(s)...`);
    }
    async checkSingleDomain(domain) {
        if (this.running) {
            throw new Error('Rank automation is already running.');
        }
        return SeoDataService_1.seoDataService.getDomainAuthority((0, domain_1.extractDomain)(domain));
    }
    async runTargets(targets, startMessage) {
        if (this.running) {
            throw new Error('Rank automation is already running.');
        }
        this.running = true;
        this.progress = {
            status: 'running',
            currentDomain: null,
            processedCount: 0,
            totalCount: targets.length,
            message: startMessage,
            results: [],
            errors: [],
            logs: [],
        };
        this.log('info', startMessage);
        this.emitProgress();
        try {
            this.log('info', 'Using Ahrefs public Domain Rating endpoint. Domain Rating is stored on a 0-100 scale.');
            for (let index = 0; index < targets.length; index += 1) {
                const target = targets[index];
                this.progress.currentDomain = target.domain;
                this.log('info', `Checking ${target.domain} (${index + 1}/${targets.length})...`);
                try {
                    const previous = AppRepository_1.repository.getLatestDomainAuthority(target.productId, target.domain, DOMAIN_RATING_SOURCE);
                    const latestAnySource = AppRepository_1.repository.getLatestDomainAuthority(target.productId, target.domain);
                    const result = await SeoDataService_1.seoDataService.getDomainAuthority(target.domain);
                    const saved = AppRepository_1.repository.createDomainAuthority({
                        productId: target.productId,
                        domain: target.domain,
                        domainRating: result.domainRating,
                        urlRating: latestAnySource?.urlRating ?? result.urlRating,
                        backlinks: latestAnySource?.backlinks ?? result.backlinks,
                        linkingWebsites: latestAnySource?.linkingWebsites ?? result.linkingWebsites,
                        source: result.source,
                    });
                    this.progress.results.push(saved);
                    this.generateAlerts(target.productId, target.domain, result.domainRating, previous);
                    this.log('success', `${target.domain}: Domain Rating ${result.domainRating}/100.`);
                }
                catch (error) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    console.error(`[rank-automation] Error checking ${target.domain}:`, errorMsg);
                    this.progress.errors.push({ domain: target.domain, error: errorMsg });
                    this.log('error', `${target.domain}: ${errorMsg}`);
                }
                this.progress.processedCount += 1;
                this.emitProgress();
                if (index < targets.length - 1) {
                    await sleep(DELAY_BETWEEN_SAVES_MS);
                }
            }
            this.progress.status = this.progress.errors.length === targets.length ? 'failed' : 'completed';
            this.progress.currentDomain = null;
            const summary = `Completed. Checked ${this.progress.processedCount} domain(s), ${this.progress.errors.length} error(s).`;
            this.progress.message = summary;
            this.log(this.progress.errors.length > 0 ? 'warning' : 'success', summary);
        }
        catch (error) {
            this.progress.status = 'failed';
            this.progress.currentDomain = null;
            const errorMessage = error instanceof Error ? error.message : 'Rank automation failed.';
            this.progress.message = errorMessage;
            this.log('error', errorMessage);
        }
        finally {
            this.running = false;
            this.recordSyncLog(targets);
            this.emitProgress();
        }
    }
    recordSyncLog(targets) {
        try {
            const productIds = new Set(targets.map((target) => target.productId));
            const succeeded = this.progress.results.map((result) => `${result.domain}: Domain Rating ${result.domainRating}/100`);
            const failed = this.progress.errors.map((entry) => `${entry.domain}: ${entry.error}`);
            const status = this.progress.status === 'failed' ? 'error' : this.progress.errors.length > 0 ? 'partial' : 'success';
            AppRepository_1.repository.createSyncLog({
                source: 'rank_automation',
                label: 'Rank automation',
                status,
                productId: productIds.size === 1 ? targets[0]?.productId ?? null : null,
                summary: this.progress.message || 'Rank automation finished.',
                itemsSucceeded: this.progress.results.length,
                itemsFailed: this.progress.errors.length,
                details: { succeeded, failed, errors: failed },
            });
        }
        catch {
            // Logging must never break automation.
        }
    }
    generateAlerts(productId, domain, newRank, previous) {
        if (!previous)
            return;
        const delta = newRank - previous.domainRating;
        if (Math.abs(delta) < 5)
            return;
        let severity;
        let message;
        if (delta > 0) {
            severity = 'info';
            message = `Domain Rating for ${domain} improved from ${previous.domainRating} to ${newRank} (+${delta})`;
        }
        else if (delta <= -10) {
            severity = 'critical';
            message = `Domain Rating for ${domain} dropped from ${previous.domainRating} to ${newRank} (${delta})`;
        }
        else {
            severity = 'warning';
            message = `Domain Rating for ${domain} dropped from ${previous.domainRating} to ${newRank} (${delta})`;
        }
        AppRepository_1.repository.createRankAlert({
            productId,
            keyword: domain,
            oldPosition: previous.domainRating,
            newPosition: newRank,
            delta,
            severity,
            message,
        });
    }
    log(level, message) {
        this.progress.logs.push({ time: Date.now(), level, message });
        this.progress.message = message;
        if (this.progress.logs.length > 200) {
            this.progress.logs.splice(0, this.progress.logs.length - 200);
        }
        this.emitProgress();
    }
    emitProgress() {
        try {
            for (const win of electron_1.BrowserWindow.getAllWindows()) {
                win.webContents.send(channels_1.CHANNELS.RANK_AUTOMATION_PROGRESS, this.progress);
            }
        }
        catch {
            // Non-fatal
        }
    }
}
exports.rankAutomationService = new RankAutomationService();
//# sourceMappingURL=RankAutomationService.js.map