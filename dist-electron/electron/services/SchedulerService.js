"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.schedulerService = exports.SchedulerService = void 0;
const electron_1 = require("electron");
const node_cron_1 = __importDefault(require("node-cron"));
const AppRepository_1 = require("./AppRepository");
const PipelineService_1 = require("./PipelineService");
const PublisherService_1 = require("./PublisherService");
const AiVisibilityService_1 = require("./AiVisibilityService");
const NotificationService_1 = require("./NotificationService");
const StorageService_1 = require("./StorageService");
const DistributionPerformanceService_1 = require("./distribution-performance/DistributionPerformanceService");
const CommentService_1 = require("./CommentService");
const RepurposeSourceService_1 = require("./RepurposeSourceService");
const FolderPipelineService_1 = require("./FolderPipelineService");
const SyncLifecycleService_1 = require("./sync/SyncLifecycleService");
// Boot marker for the interrupted-run repair: runs started before this instant belong to a
// previous process and can never complete. start() re-runs on reload, so the fixed marker keeps
// the repair from clipping runs that are genuinely in flight.
const PROCESS_STARTED_AT = Date.now();
class SchedulerService {
    jobs = new Map();
    resumeHandler = null;
    start() {
        this.stop();
        this.registerPipelineJobs();
        this.registerPublishSweep();
        this.registerScheduledPostsSweep();
        this.registerAiTrackerSweep();
        this.registerStorageCleanup();
        this.registerDistributionPerformanceSync();
        this.registerRepurposePipelineSweep();
        AppRepository_1.repository.failInterruptedPipelineRuns(PROCESS_STARTED_AT);
        // Catch-up: anything that came due while the app was closed runs on next launch / wake.
        // (Best-effort timing — a desktop app cannot guarantee exact-minute delivery; see docs/channel_implementation/schedule_feature.md §4.1.)
        void this.runDueScheduledPosts();
        void this.runDueAiTrackers();
        void this.runStorageCleanup();
        void this.runDistributionPerformanceSync();
        if (SyncLifecycleService_1.syncLifecycleService.isAutomationOwner()) {
            void RepurposeSourceService_1.repurposeSourceService.runDuePipelines();
            void FolderPipelineService_1.folderPipelineService.runDuePipelines();
        }
        this.resumeHandler = () => {
            void this.runDueScheduledPosts();
            void this.runDueAiTrackers();
            void this.runDistributionPerformanceSync();
            if (SyncLifecycleService_1.syncLifecycleService.isAutomationOwner()) {
                void RepurposeSourceService_1.repurposeSourceService.runDuePipelines();
                void FolderPipelineService_1.folderPipelineService.runDuePipelines();
            }
        };
        electron_1.powerMonitor.on('resume', this.resumeHandler);
    }
    stop() {
        for (const job of this.jobs.values()) {
            job.stop();
            job.destroy();
        }
        this.jobs.clear();
        // Short-delay comment timers live outside cron — drop them so a restart doesn't double-fire.
        CommentService_1.commentService.shutdown();
        if (this.resumeHandler) {
            electron_1.powerMonitor.removeListener('resume', this.resumeHandler);
            this.resumeHandler = null;
        }
    }
    reload() {
        this.start();
    }
    registerPipelineJobs() {
        const p2Cron = String(AppRepository_1.repository.getSetting('pipeline2Cron')?.value ?? '0 9 * * 1');
        const p3Cron = String(AppRepository_1.repository.getSetting('pipeline3Cron')?.value ?? '0 9 * * *');
        const p2Job = node_cron_1.default.schedule(p2Cron, async () => {
            const products = AppRepository_1.repository.listProducts();
            for (const product of products) {
                if (!SyncLifecycleService_1.syncLifecycleService.isAutomationOwner(product.workspaceId ?? '*'))
                    continue;
                await PipelineService_1.pipelineService.runPipeline('P2', {
                    productId: product.id,
                    trigger: 'scheduled_weekly',
                });
            }
        });
        const p3Job = node_cron_1.default.schedule(p3Cron, async () => {
            const products = AppRepository_1.repository.listProducts();
            for (const product of products) {
                if (!SyncLifecycleService_1.syncLifecycleService.isAutomationOwner(product.workspaceId ?? '*'))
                    continue;
                await PipelineService_1.pipelineService.runPipeline('P3', {
                    productId: product.id,
                    trigger: 'scheduled_daily',
                });
            }
        });
        this.jobs.set('pipeline2', p2Job);
        this.jobs.set('pipeline3', p3Job);
    }
    registerPublishSweep() {
        const publishJob = node_cron_1.default.schedule('*/5 * * * *', async () => {
            if (!SyncLifecycleService_1.syncLifecycleService.isAutomationOwner())
                return;
            await PublisherService_1.publisherService.publishScheduledDueContent();
        });
        this.jobs.set('publishSweep', publishJob);
    }
    /** Second sweep over scheduled_posts, alongside the legacy content_queue sweep above. */
    registerScheduledPostsSweep() {
        const job = node_cron_1.default.schedule('*/2 * * * *', async () => {
            await this.runDueScheduledPosts();
        });
        this.jobs.set('scheduledPostsSweep', job);
    }
    /** Sweep AI Visibility trackers whose per-tracker schedule has come due. */
    registerAiTrackerSweep() {
        const job = node_cron_1.default.schedule('*/30 * * * *', async () => {
            await this.runDueAiTrackers();
        });
        this.jobs.set('aiTrackerSweep', job);
    }
    registerStorageCleanup() {
        const job = node_cron_1.default.schedule('17 3 * * *', async () => {
            await this.runStorageCleanup();
        });
        this.jobs.set('storageCleanup', job);
    }
    registerDistributionPerformanceSync() {
        const job = node_cron_1.default.schedule('23 * * * *', async () => {
            await this.runDistributionPerformanceSync();
        });
        this.jobs.set('distributionPerformanceSync', job);
    }
    registerRepurposePipelineSweep() {
        const job = node_cron_1.default.schedule('*/15 * * * *', async () => {
            if (!SyncLifecycleService_1.syncLifecycleService.isAutomationOwner())
                return;
            await RepurposeSourceService_1.repurposeSourceService.runDuePipelines();
            await FolderPipelineService_1.folderPipelineService.runDuePipelines();
        });
        this.jobs.set('repurposePipelineSweep', job);
    }
    async runDistributionPerformanceSync() {
        if (!SyncLifecycleService_1.syncLifecycleService.isAutomationOwner())
            return;
        try {
            await DistributionPerformanceService_1.distributionPerformanceService.syncStale();
        }
        catch (error) {
            console.error('[scheduler] distribution performance sync failed:', error);
        }
    }
    async runStorageCleanup() {
        try {
            await StorageService_1.storageService.runAutoCleanup();
        }
        catch (error) {
            console.error('[scheduler] storage cleanup failed:', error);
        }
    }
    async runDueAiTrackers() {
        try {
            const due = AppRepository_1.repository.listDueAiTrackers(Date.now());
            for (const tracker of due) {
                const product = AppRepository_1.repository.getProduct(tracker.productId);
                if (!SyncLifecycleService_1.syncLifecycleService.isAutomationOwner(product?.workspaceId ?? '*'))
                    continue;
                try {
                    await AiVisibilityService_1.aiVisibilityService.runTracker(tracker.id);
                }
                catch (error) {
                    console.error(`[scheduler] ai-tracker ${tracker.id} run failed:`, error);
                    // A scheduled run has no UI watching it — surface the failure in the alert inbox.
                    NotificationService_1.notificationService.publish({
                        kind: 'aiVisibility.runFailed',
                        severity: 'warning',
                        title: `${tracker.name}: scheduled run failed`,
                        body: error instanceof Error ? error.message.slice(0, 300) : 'The scheduled tracker run could not complete.',
                        productId: tracker.productId,
                        route: { view: 'ai-visibility', productId: tracker.productId, trackerId: tracker.id },
                        meta: { trackerId: tracker.id, scheduled: true },
                        dedupeKey: `aiVisibility.runFailed:${tracker.id}`,
                    });
                }
            }
        }
        catch (error) {
            console.error('[scheduler] ai-tracker sweep failed:', error);
        }
    }
    async runDueScheduledPosts() {
        if (!SyncLifecycleService_1.syncLifecycleService.isAutomationOwner())
            return;
        // Auto-publish is opt-in. When off, due posts wait in a "Ready to publish" state for a manual fire.
        const autoPublish = AppRepository_1.repository.getSetting('autoPublishEnabled')?.value;
        if (autoPublish !== false) {
            try {
                await PublisherService_1.publisherService.publishDueScheduledPosts();
            }
            catch (error) {
                console.error('[scheduler] scheduled-posts sweep failed:', error);
            }
        }
        // Follow-up comments run even when auto-publish is off, and deliberately so: a comment can only
        // ever fire on a post that is already live, so the user has already taken the publish action.
        // Gating this would make a manually published post's first comment silently never appear.
        try {
            await CommentService_1.commentService.runDueComments();
        }
        catch (error) {
            console.error('[scheduler] follow-up comment sweep failed:', error);
        }
    }
}
exports.SchedulerService = SchedulerService;
exports.schedulerService = new SchedulerService();
//# sourceMappingURL=SchedulerService.js.map