"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.directorySubmissionService = void 0;
const electron_1 = require("electron");
const zod_1 = require("zod");
const channels_1 = require("../ipc/channels");
const AppRepository_1 = require("./AppRepository");
const ElectronWindowProvider_1 = require("./browser/ElectronWindowProvider");
const providerFactory_1 = require("./browser/providerFactory");
const AiPageExtractor_1 = require("./ai/AiPageExtractor");
const DIRECTORY_PARTITION = 'persist:1marketingtool-directories';
const FillPlanSchema = zod_1.z.object({
    fields: zod_1.z.array(zod_1.z.object({
        selector: zod_1.z.string().min(1),
        label: zod_1.z.string().nullable().optional(),
        value: zod_1.z.string(),
    })),
    submitSelector: zod_1.z.string().nullable().optional(),
    notes: zod_1.z.string().nullable().optional(),
});
function emptyProgress() {
    return {
        status: 'idle',
        currentDirectoryId: null,
        currentDirectoryName: null,
        currentUrl: null,
        processedCount: 0,
        totalCount: 0,
        message: '',
        plan: null,
        results: [],
        errors: [],
    };
}
function productProfile(product) {
    return {
        name: product.name,
        website: product.url,
        tagline: product.tagline,
        shortDescription: product.shortDescription,
        description: product.mediumDescription || product.longDescription || product.shortDescription,
        category: product.categories[0] ?? '',
        categories: product.categories.join(', '),
        tags: product.tags.join(', '),
        pricing: product.pricingModel,
        platforms: product.platforms.join(', '),
        targetUser: product.targetUser,
    };
}
/**
 * AI-assisted directory submission with a human confirm-gate. For each selected
 * directory it opens the page, has the AI map the product profile onto the form
 * controls, fills them, then PAUSES (status: awaiting_confirmation) so the user
 * can review before the final submit. Confirm submits and records status; skip
 * moves on. The manual checklist/export path remains untouched as a fallback.
 */
class DirectorySubmissionService {
    running = false;
    provider = null;
    productId = null;
    queue = [];
    index = 0;
    mode = 'headed';
    progress = emptyProgress();
    isRunning() {
        return this.running;
    }
    getProgress() {
        return { ...this.progress };
    }
    async startAssisted(productId, directoryIds, mode = 'headed') {
        if (this.running) {
            throw new Error('Directory submission is already running.');
        }
        const product = AppRepository_1.repository.getProduct(productId);
        if (!product) {
            throw new Error('Product not found.');
        }
        const ids = Array.from(new Set(directoryIds.filter(Boolean)));
        if (ids.length === 0) {
            throw new Error('No directories selected.');
        }
        this.running = true;
        this.productId = productId;
        this.queue = ids;
        this.index = 0;
        this.mode = mode;
        this.provider = (0, providerFactory_1.createBrowserProvider)({
            partition: DIRECTORY_PARTITION,
            title: '1MarketingTool - Directory Submit',
        });
        this.progress = {
            ...emptyProgress(),
            status: 'running',
            totalCount: ids.length,
            message: 'Starting AI-assisted directory submission...',
        };
        this.emitProgress();
        void this.processCurrent().catch((error) => this.failRun(error));
        return { started: true };
    }
    async confirmCurrent(approve) {
        if (!this.running || this.progress.status !== 'awaiting_confirmation') {
            throw new Error('No directory is awaiting confirmation.');
        }
        const plan = this.progress.plan;
        const directoryId = this.progress.currentDirectoryId;
        if (!plan || !directoryId || !this.productId) {
            throw new Error('Nothing to confirm.');
        }
        try {
            if (approve) {
                if (plan.submitSelector && this.provider) {
                    await this.provider.act([
                        { action: 'click', selector: plan.submitSelector },
                        { action: 'wait', ms: 1500 },
                    ]);
                }
                AppRepository_1.repository.upsertDirectorySubmissionStatus({ productId: this.productId, directoryId, status: 'submitted' });
                this.progress.results.push({
                    directoryId,
                    directoryName: plan.directoryName,
                    status: 'submitted',
                    message: plan.submitSelector ? 'Submitted.' : 'Marked submitted (submit manually in the window if needed).',
                });
            }
            else {
                this.progress.results.push({
                    directoryId,
                    directoryName: plan.directoryName,
                    status: 'skipped',
                    message: 'Skipped.',
                });
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            this.progress.errors.push({ directoryId, error: message });
            this.progress.results.push({ directoryId, directoryName: plan.directoryName, status: 'error', message });
        }
        this.progress.processedCount += 1;
        this.progress.plan = null;
        this.index += 1;
        this.emitProgress();
        void this.processCurrent().catch((error) => this.failRun(error));
        return { ok: true };
    }
    async stop() {
        await this.finish('idle', 'Directory submission stopped.');
        return { stopped: true };
    }
    async processCurrent() {
        if (this.index >= this.queue.length) {
            await this.finish('completed', `Completed. ${this.summary()}.`);
            return;
        }
        const directoryId = this.queue[this.index];
        const directory = AppRepository_1.repository.getDirectory(directoryId);
        const product = this.productId ? AppRepository_1.repository.getProduct(this.productId) : null;
        if (!directory || !product || !this.provider) {
            this.progress.errors.push({ directoryId, error: 'Directory or product unavailable.' });
            this.advanceAfterAutoSkip();
            await this.processCurrent();
            return;
        }
        this.progress.status = 'running';
        this.progress.currentDirectoryId = directoryId;
        this.progress.currentDirectoryName = directory.name;
        this.progress.currentUrl = directory.url;
        this.progress.message = `Opening ${directory.name} (${this.index + 1}/${this.queue.length})...`;
        this.emitProgress();
        await this.provider.open(directory.url, { visible: this.mode === 'headed' });
        const snapshot = await this.provider.snapshot({ includeControls: true, maxChars: 16_000 });
        if (snapshot.controls.length === 0) {
            this.progress.results.push({
                directoryId,
                directoryName: directory.name,
                status: 'skipped',
                message: 'No form fields detected on the page.',
            });
            this.advanceAfterAutoSkip();
            await this.processCurrent();
            return;
        }
        this.progress.message = `Reading ${directory.name} submission form...`;
        this.emitProgress();
        const plan = await AiPageExtractor_1.aiPageExtractor.extract({
            snapshot,
            schema: FillPlanSchema,
            instructions: [
                'You are filling a product/startup submission form on a directory website.',
                'Map the available form controls to this product profile. Only fill fields you are confident about',
                '(typically name, website URL, tagline, description, category). Do not fill email/password/captcha fields.',
                'Use the provided selectors exactly. For submitSelector, choose the button that submits THIS form',
                '(text like "Submit", "Add", "Save", "Continue"), or null if unclear.',
                `Product profile JSON: ${JSON.stringify(productProfile(product))}`,
            ].join('\n'),
            schemaHint: '{"fields":[{"selector":"#name","label":"Name","value":"Acme"}],"submitSelector":"#submit","notes":null}',
        });
        const fields = plan.fields
            .filter((field) => typeof field.value === 'string' && field.value.trim().length > 0)
            .map((field) => ({ selector: field.selector, label: field.label ?? '', value: field.value }));
        if (fields.length > 0) {
            await this.provider.act(fields.map((field) => ({ action: 'fill', selector: field.selector, value: field.value })));
        }
        const fillPlan = {
            directoryId,
            directoryName: directory.name,
            url: directory.url,
            fields,
            submitSelector: plan.submitSelector ?? null,
            notes: plan.notes ?? null,
        };
        this.provider.show();
        this.progress.status = 'awaiting_confirmation';
        this.progress.plan = fillPlan;
        this.progress.message =
            fields.length > 0
                ? `Filled ${fields.length} field(s) on ${directory.name}. Review in the browser window, then confirm or skip.`
                : `Opened ${directory.name} but could not auto-fill any fields. Fill manually, then confirm or skip.`;
        this.emitProgress();
    }
    advanceAfterAutoSkip() {
        this.index += 1;
        this.progress.processedCount += 1;
        this.progress.plan = null;
        this.emitProgress();
    }
    summary() {
        const submitted = this.progress.results.filter((result) => result.status === 'submitted').length;
        const skipped = this.progress.results.filter((result) => result.status === 'skipped').length;
        const errored = this.progress.results.filter((result) => result.status === 'error').length;
        return `${submitted} submitted, ${skipped} skipped, ${errored} error(s)`;
    }
    failRun(error) {
        const message = error instanceof Error ? error.message : 'Directory submission failed.';
        if (this.progress.currentDirectoryId) {
            this.progress.errors.push({ directoryId: this.progress.currentDirectoryId, error: message });
        }
        void this.finish('failed', message);
    }
    async finish(status, message) {
        this.progress.status = status;
        this.progress.message = message;
        this.progress.plan = null;
        this.progress.currentDirectoryId = null;
        this.progress.currentDirectoryName = null;
        this.progress.currentUrl = null;
        this.running = false;
        this.queue = [];
        this.index = 0;
        if (this.provider) {
            await this.provider.close().catch(() => undefined);
            this.provider = null;
        }
        this.recordSyncLog(status);
        this.emitProgress();
    }
    recordSyncLog(status) {
        try {
            const submitted = this.progress.results.filter((result) => result.status === 'submitted');
            const skipped = this.progress.results.filter((result) => result.status === 'skipped');
            const errored = this.progress.results.filter((result) => result.status === 'error');
            const succeeded = [
                ...submitted.map((result) => `${result.directoryName}: submitted`),
                ...skipped.map((result) => `${result.directoryName}: skipped`),
            ];
            const failed = errored.map((result) => `${result.directoryName}: ${result.message || 'error'}`);
            const logStatus = status === 'failed' ? 'error' : errored.length > 0 ? 'partial' : 'success';
            AppRepository_1.repository.createSyncLog({
                source: 'directory_automation',
                label: 'Directory automation',
                status: logStatus,
                productId: this.productId,
                summary: this.progress.message || 'Directory automation finished.',
                itemsSucceeded: submitted.length,
                itemsFailed: errored.length,
                details: { succeeded, failed, errors: this.progress.errors.map((entry) => entry.error) },
            });
        }
        catch {
            // Logging must never break automation.
        }
    }
    emitProgress() {
        try {
            const providerWebContentsId = this.provider instanceof ElectronWindowProvider_1.ElectronWindowProvider ? this.provider.getWebContentsId() : null;
            for (const win of electron_1.BrowserWindow.getAllWindows()) {
                if (win.webContents.id === providerWebContentsId)
                    continue;
                win.webContents.send(channels_1.CHANNELS.DIRECTORIES_AUTOMATION_PROGRESS, this.progress);
            }
        }
        catch {
            // Non-fatal
        }
    }
}
exports.directorySubmissionService = new DirectorySubmissionService();
//# sourceMappingURL=DirectorySubmissionService.js.map