"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.siteAuditService = exports.SiteAuditService = void 0;
/**
 * Site Audit orchestration. `start` records a run and returns its id immediately,
 * then crawls in the background, broadcasting progress to all windows (the same
 * sink pattern as RankAutomationService). Pages and issues are persisted when the
 * crawl finishes (or is canceled), so results survive an app restart.
 */
const electron_1 = require("electron");
const channels_1 = require("../../ipc/channels");
const id_1 = require("../../utils/id");
const BackgroundTaskService_1 = require("../BackgroundTaskService");
const crawl_1 = require("./audit/crawl");
const discovery_1 = require("./audit/discovery");
const issues_1 = require("./audit/issues");
const readable_1 = require("./audit/readable");
const repository_1 = require("./audit/repository");
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function resolveConfig(input) {
    const raw = input?.maxPages;
    const maxPages = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 100;
    return {
        maxPages: clamp(maxPages, 5, 500),
        respectRobots: input?.respectRobots ?? true,
        useSitemap: input?.useSitemap ?? true,
    };
}
function normalizeRoot(raw) {
    const trimmed = (raw ?? '').trim();
    if (!trimmed)
        return null;
    try {
        const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        if (url.protocol !== 'http:' && url.protocol !== 'https:')
            return null;
        url.hash = '';
        return { rootUrl: url.toString(), host: url.host, origin: url.origin };
    }
    catch {
        return null;
    }
}
function toSiteAuditPage(crawled) {
    const analysis = crawled.analysis;
    const robotsMeta = analysis?.robotsMeta ?? null;
    // Indexable = a 200 HTML page that isn't excluded by a robots noindex directive.
    const isIndexable = crawled.statusCode === 200 && !!analysis && !/noindex/i.test(robotsMeta ?? '');
    return {
        id: (0, id_1.createId)(),
        url: crawled.url,
        statusCode: crawled.statusCode,
        redirectUrl: crawled.redirectUrl,
        title: analysis?.title ?? '',
        metaDescription: analysis?.metaDescription ?? '',
        canonical: analysis?.canonical ?? null,
        robotsMeta,
        h1Count: analysis?.h1Count ?? 0,
        h2Count: analysis?.h2Count ?? 0,
        wordCount: analysis?.wordCount ?? 0,
        imagesTotal: analysis?.imagesTotal ?? 0,
        imagesMissingAlt: analysis?.imagesMissingAlt ?? 0,
        internalLinks: analysis?.internalLinks.length ?? 0,
        externalLinks: analysis?.externalLinks.length ?? 0,
        hasStructuredData: analysis?.hasStructuredData ?? false,
        hasViewport: analysis?.hasViewport ?? false,
        isIndexable,
        responseTimeMs: crawled.responseTimeMs,
        issueCount: 0,
    };
}
function siteAuditTaskProgress(progress) {
    return {
        done: progress.pagesCrawled,
        total: progress.pagesTotal,
        label: progress.currentUrl ?? progress.phase,
        message: progress.message,
        raw: progress,
    };
}
function isActiveBackgroundTask(task) {
    return task?.status === 'queued' || task?.status === 'running';
}
class SiteAuditService {
    canceled = new Set();
    running = new Set();
    taskIds = new Map();
    dedupeRunIds = new Map();
    start(input) {
        const { runId, taskId } = this.startTask(input);
        return { runId, taskId };
    }
    startTask(input, options) {
        const dedupeKey = options?.dedupeKey?.trim();
        if (dedupeKey) {
            const existingRunId = this.dedupeRunIds.get(dedupeKey);
            const existingTaskId = existingRunId ? this.taskIds.get(existingRunId) : null;
            const existingTask = existingTaskId ? BackgroundTaskService_1.backgroundTaskService.get(existingTaskId) : null;
            if (existingRunId && isActiveBackgroundTask(existingTask)) {
                return { runId: existingRunId, taskId: existingTask.id, task: existingTask };
            }
            this.dedupeRunIds.delete(dedupeKey);
        }
        const prepared = this.prepareRun(input);
        const { run } = prepared;
        const task = BackgroundTaskService_1.backgroundTaskService.run({
            kind: 'audit.start',
            title: options?.title?.trim() || `Audit ${run.host}`,
            input: {
                runId: run.id,
                productId: run.productId,
                rootUrl: run.rootUrl,
                config: run.config,
            },
            scope: options?.scope ?? { productId: run.productId },
            dedupeKey,
        }, (context) => this.runAudit(prepared, context));
        this.taskIds.set(run.id, task.id);
        if (dedupeKey)
            this.dedupeRunIds.set(dedupeKey, run.id);
        return { runId: run.id, taskId: task.id, task };
    }
    prepareRun(input) {
        const target = normalizeRoot(input?.rootUrl ?? '');
        if (!target) {
            throw new Error('A valid http(s) URL is required to start a site audit.');
        }
        const config = resolveConfig(input?.config);
        const run = {
            id: (0, id_1.createId)(),
            productId: input?.productId ?? null,
            rootUrl: target.rootUrl,
            host: target.host,
            status: 'running',
            config,
            pagesCrawled: 0,
            pagesTotal: config.maxPages,
            issuesHigh: 0,
            issuesMedium: 0,
            issuesLow: 0,
            healthScore: null,
            error: null,
            startedAt: Date.now(),
            completedAt: null,
        };
        repository_1.siteAuditRepository.createRun(run);
        this.running.add(run.id);
        return { run, origin: target.origin };
    }
    cancel(runId) {
        if (!this.running.has(runId))
            return { canceled: false };
        this.canceled.add(runId);
        const taskId = this.taskIds.get(runId);
        if (taskId)
            BackgroundTaskService_1.backgroundTaskService.cancel(taskId);
        return { canceled: true };
    }
    getRunDetail(runId) {
        return repository_1.siteAuditRepository.getRunDetail(runId);
    }
    /**
     * Fetch the readable prose of a set of URLs (deduped, same fetch machinery as the
     * crawler). Used by the Writing Style Mimic feature to gather writing samples —
     * not part of an audit run, so nothing is persisted. Runs with a small pool to
     * stay polite to the target site.
     */
    async fetchReadableContent(urls, concurrency = 4) {
        const seen = new Set();
        const targets = [];
        for (const raw of urls) {
            const target = normalizeRoot(raw ?? '');
            if (!target)
                continue;
            if (seen.has(target.rootUrl))
                continue;
            seen.add(target.rootUrl);
            targets.push(target.rootUrl);
        }
        const results = [];
        for (let i = 0; i < targets.length; i += concurrency) {
            const batch = targets.slice(i, i + concurrency);
            const pages = await Promise.all(batch.map((url) => (0, readable_1.fetchReadablePage)(url)));
            results.push(...pages);
        }
        return results;
    }
    listRuns(input) {
        return repository_1.siteAuditRepository.listRuns(input);
    }
    deleteRun(runId) {
        return { removed: repository_1.siteAuditRepository.deleteRun(runId) };
    }
    async runAudit({ run, origin }, context) {
        const pages = [];
        const htmlPageIds = new Set();
        const isCanceled = () => this.canceled.has(run.id) || context.signal.aborted;
        try {
            this.emitProgress({
                runId: run.id,
                status: 'running',
                phase: 'discovering',
                pagesCrawled: 0,
                pagesTotal: run.config.maxPages,
                currentUrl: null,
                message: 'Reading robots.txt and sitemaps…',
            }, context);
            const robots = await (0, discovery_1.fetchRobots)(origin);
            const isAllowed = run.config.respectRobots ? (0, discovery_1.buildIsAllowed)(robots) : () => true;
            const seeds = run.config.useSitemap
                ? await (0, discovery_1.collectSitemapUrls)(origin, robots.sitemapUrls, run.host, run.config.maxPages)
                : [];
            this.emitProgress({
                runId: run.id,
                status: 'running',
                phase: 'crawling',
                pagesCrawled: 0,
                pagesTotal: run.config.maxPages,
                currentUrl: run.rootUrl,
                message: seeds.length > 0 ? `Crawling — ${seeds.length} sitemap URLs queued…` : 'Crawling…',
            }, context);
            await (0, crawl_1.crawlSite)({
                rootUrl: run.rootUrl,
                host: run.host,
                maxPages: run.config.maxPages,
                seeds,
                isAllowed,
                shouldCancel: isCanceled,
                onPage: (crawled) => {
                    const page = toSiteAuditPage(crawled);
                    pages.push(page);
                    if (crawled.analysis)
                        htmlPageIds.add(page.id);
                    this.emitProgress({
                        runId: run.id,
                        status: 'running',
                        phase: 'crawling',
                        pagesCrawled: pages.length,
                        pagesTotal: run.config.maxPages,
                        currentUrl: crawled.url,
                        message: `Crawled ${pages.length} page${pages.length === 1 ? '' : 's'}…`,
                    }, context);
                },
            });
            const wasCanceled = isCanceled();
            this.emitProgress({
                runId: run.id,
                status: 'running',
                phase: 'analyzing',
                pagesCrawled: pages.length,
                pagesTotal: run.config.maxPages,
                currentUrl: null,
                message: 'Analyzing pages for issues…',
            }, context);
            const { groups, issuesHigh, issuesMedium, issuesLow, healthScore } = (0, issues_1.computeIssues)(pages, htmlPageIds);
            repository_1.siteAuditRepository.replacePages(run.id, pages);
            repository_1.siteAuditRepository.replaceIssues(run.id, groups);
            const status = wasCanceled ? 'canceled' : 'completed';
            const completedAt = Date.now();
            repository_1.siteAuditRepository.finalizeRun(run.id, {
                status,
                pagesCrawled: pages.length,
                pagesTotal: pages.length,
                issuesHigh,
                issuesMedium,
                issuesLow,
                healthScore,
                error: null,
                completedAt,
            });
            this.emitProgress({
                runId: run.id,
                status,
                phase: 'done',
                pagesCrawled: pages.length,
                pagesTotal: pages.length,
                currentUrl: null,
                healthScore,
                message: wasCanceled
                    ? `Canceled — ${pages.length} pages crawled, ${issuesHigh + issuesMedium + issuesLow} issues found.`
                    : `Done — ${pages.length} pages, ${issuesHigh + issuesMedium + issuesLow} issues, health ${healthScore}/100.`,
            }, context);
            return {
                runId: run.id,
                status,
                pagesCrawled: pages.length,
                issuesFound: issuesHigh + issuesMedium + issuesLow,
                healthScore,
            };
        }
        catch (error) {
            const wasCanceled = isCanceled();
            const message = error instanceof Error ? error.message : 'Site audit failed.';
            repository_1.siteAuditRepository.finalizeRun(run.id, {
                status: wasCanceled ? 'canceled' : 'failed',
                pagesCrawled: pages.length,
                pagesTotal: pages.length,
                issuesHigh: 0,
                issuesMedium: 0,
                issuesLow: 0,
                healthScore: null,
                error: wasCanceled ? null : message,
                completedAt: Date.now(),
            });
            this.emitProgress({
                runId: run.id,
                status: wasCanceled ? 'canceled' : 'failed',
                phase: 'done',
                pagesCrawled: pages.length,
                pagesTotal: run.config.maxPages,
                currentUrl: null,
                message: wasCanceled ? 'Canceled' : message,
            }, context);
            if (wasCanceled) {
                return {
                    runId: run.id,
                    status: 'canceled',
                    pagesCrawled: pages.length,
                    issuesFound: 0,
                    healthScore: null,
                };
            }
            throw error;
        }
        finally {
            this.running.delete(run.id);
            this.canceled.delete(run.id);
            this.taskIds.delete(run.id);
            for (const [dedupeKey, runId] of this.dedupeRunIds.entries()) {
                if (runId === run.id)
                    this.dedupeRunIds.delete(dedupeKey);
            }
        }
    }
    emitProgress(progress, context) {
        this.emit(progress);
        context.update(siteAuditTaskProgress(progress));
    }
    emit(progress) {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send(channels_1.CHANNELS.AUDIT_PROGRESS, progress);
            }
        }
    }
}
exports.SiteAuditService = SiteAuditService;
exports.siteAuditService = new SiteAuditService();
//# sourceMappingURL=SiteAuditService.js.map