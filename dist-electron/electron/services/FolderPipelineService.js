"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.folderPipelineService = exports.FolderPipelineService = void 0;
const path_1 = __importDefault(require("path"));
const AppRepository_1 = require("./AppRepository");
const PipelineService_1 = require("./PipelineService");
const registry_1 = require("./publishers/registry");
const shared_1 = require("./pipelines/shared");
const folderScan_1 = require("./pipelines/folderScan");
/** How many new sources one run turns into campaigns — the rest wait for the next poll. */
const MAX_SOURCES_PER_RUN = 5;
/** Sources listed back to the config UI for the "what will be picked up" preview. */
const PREVIEW_SOURCE_LIMIT = 40;
/** Files listed inside one bundled source in that preview. */
const PREVIEW_BUNDLE_FILES = 8;
function pipelineName(input) {
    const explicit = input.name?.trim();
    if (explicit)
        return explicit.slice(0, 100);
    const first = input.watchFolders[0]?.path;
    if (!first)
        return 'Folder watch';
    const label = path_1.default.basename(first) || first;
    return input.watchFolders.length > 1
        ? `Folder watch · ${label} +${input.watchFolders.length - 1}`
        : `Folder watch · ${label}`;
}
const CONTENT_DETAILS = ['concise', 'balanced', 'detailed'];
const OUTPUT_FORMATS = ['plaintext', 'markdown', 'html'];
/**
 * Keep only overrides that belong to a selected destination and carry a valid value. An override
 * equal to the pipeline default is dropped so the row stays a true diff.
 */
function normalizeChannelOverrides(raw, destinations, defaults) {
    if (!raw || typeof raw !== 'object')
        return {};
    const result = {};
    for (const platform of destinations) {
        const entry = raw[platform];
        if (!entry || typeof entry !== 'object')
            continue;
        const override = {};
        const languages = Array.isArray(entry.languages)
            ? Array.from(new Set(entry.languages
                .map((code) => String(code ?? '').trim().toLowerCase())
                .filter((code) => /^[a-z]{2}(?:-[a-z]{2})?$/.test(code))))
            : [];
        if (languages.length && !(languages.length === 1 && languages[0] === defaults.language)) {
            override.languages = languages;
        }
        if (entry.outputFormat
            && OUTPUT_FORMATS.includes(entry.outputFormat)
            && entry.outputFormat !== defaults.outputFormat) {
            override.outputFormat = entry.outputFormat;
        }
        if (entry.contentDetail
            && CONTENT_DETAILS.includes(entry.contentDetail)
            && entry.contentDetail !== defaults.contentDetail) {
            override.contentDetail = entry.contentDetail;
        }
        if (Object.keys(override).length)
            result[platform] = override;
    }
    return result;
}
function folderSummary(folders) {
    if (!folders.length)
        return null;
    const label = path_1.default.basename(folders[0].path) || folders[0].path;
    return folders.length > 1 ? `${label} +${folders.length - 1} more` : label;
}
/**
 * Watches local folders and turns every new matching file into a campaign.
 *
 * Rows live in `repurpose_pipelines` with `kind = 'folder'`, so scheduling, run bookkeeping,
 * and the shared Logs tab are the same machinery the social pipeline uses. Processed files are
 * remembered by absolute path in `repurpose_pipeline_sources`.
 */
class FolderPipelineService {
    runningPipelineIds = new Set();
    listPipelines(input) {
        return AppRepository_1.repository.listRepurposePipelines(input?.productId, 'folder');
    }
    /** Scan the configured folders without generating anything (config preview + overview counts). */
    scan(input) {
        const { sources, matchedFiles, folders } = (0, folderScan_1.scanWatchedFolders)(input.watchFolders ?? [], input.fileTypes ?? [], { groupMode: input.groupMode });
        const processed = input.pipelineId
            ? new Set(AppRepository_1.repository.listProcessedRepurposeSourceIds(input.pipelineId))
            : new Set();
        const marked = sources.map((source) => ({ ...source, processed: processed.has(source.id) }));
        return {
            folders,
            matchedFiles,
            totalSources: marked.length,
            newSources: marked.filter((source) => !source.processed).length,
            sources: marked
                .slice(0, PREVIEW_SOURCE_LIMIT)
                .map((source) => ({ ...source, files: source.files.slice(0, PREVIEW_BUNDLE_FILES) })),
        };
    }
    savePipeline(input) {
        if (!input || typeof input !== 'object')
            throw new Error('Pipeline configuration is required.');
        if (!AppRepository_1.repository.getProduct(input.productId))
            throw new Error('Select a valid project for this pipeline.');
        const watchFolders = (0, folderScan_1.normalizeWatchFolders)(input.watchFolders);
        if (!watchFolders.length)
            throw new Error('Add at least one folder to watch.');
        const fileTypes = (0, folderScan_1.normalizeFileTypes)(input.fileTypes);
        if (!fileTypes.length)
            throw new Error('Select at least one file type to pick up.');
        const groupMode = input.groupMode === 'subfolder' ? 'subfolder' : 'file';
        const implemented = new Set((0, registry_1.listPlatformDescriptors)().filter((descriptor) => descriptor.implemented).map((descriptor) => descriptor.platform));
        const requestedDestinations = Array.isArray(input.destinationPlatforms) ? input.destinationPlatforms : [];
        const destinations = Array.from(new Set(requestedDestinations)).filter((platform) => implemented.has(platform));
        if (!destinations.length)
            throw new Error('Select at least one supported destination channel.');
        const language = typeof input.language === 'string' ? input.language.trim().toLowerCase() : '';
        if (!/^[a-z]{2}(?:-[a-z]{2})?$/.test(language))
            throw new Error('Choose a valid content language.');
        if (!['concise', 'balanced', 'detailed'].includes(input.contentDetail)) {
            throw new Error('Choose a valid content detail level.');
        }
        if (!['plaintext', 'markdown', 'html'].includes(input.outputFormat)) {
            throw new Error('Choose a valid output format.');
        }
        if (input.scheduleMode !== 'draft' && input.scheduleMode !== 'scheduled') {
            throw new Error('Choose how generated content should be delivered.');
        }
        if (input.status !== 'paused' && input.status !== 'active')
            throw new Error('Choose a valid pipeline status.');
        const pollIntervalHours = Number.isFinite(input.pollIntervalHours)
            ? Math.max(1, Math.min(168, Math.round(input.pollIntervalHours)))
            : 6;
        const scheduleDelayMinutes = Number.isFinite(input.scheduleDelayMinutes)
            ? Math.max(0, Math.min(10_080, Math.round(input.scheduleDelayMinutes)))
            : 60;
        const timezone = typeof input.timezone === 'string' ? input.timezone.trim().slice(0, 100) || 'UTC' : 'UTC';
        const existing = input.id ? AppRepository_1.repository.getRepurposePipeline(input.id) : null;
        if (existing && existing.kind !== 'folder')
            throw new Error('That pipeline is not a folder pipeline.');
        const pipeline = AppRepository_1.repository.upsertRepurposePipeline({
            id: input.id,
            productId: input.productId,
            name: pipelineName({ name: input.name, watchFolders }),
            kind: 'folder',
            sourcePlatform: 'folder',
            sourceMode: 'connected',
            sourceUrl: null,
            sourceAccountId: `folder:${watchFolders.length}`,
            sourceAccountName: folderSummary(watchFolders),
            milestoneSourceId: null,
            watchFolders,
            fileTypes,
            groupMode,
            contextNote: typeof input.contextNote === 'string' ? input.contextNote.trim().slice(0, 800) : null,
            channelOverrides: normalizeChannelOverrides(input.channelOverrides, destinations, {
                language,
                outputFormat: input.outputFormat,
                contentDetail: input.contentDetail,
            }),
            pollIntervalHours,
            destinationPlatforms: destinations,
            language,
            contentDetail: input.contentDetail,
            outputFormat: input.outputFormat,
            scheduleMode: input.scheduleMode,
            scheduleDelayMinutes,
            timezone,
            status: input.status,
        });
        // Files already on disk are treated as handled, so pointing a pipeline at a folder with 400
        // old files does not generate 400 campaigns. On an edit only the *newly* watched folders and
        // newly added file types are baselined — the rest keep their existing history.
        if (input.baselineExistingFiles !== false) {
            const baseline = (folders, types) => {
                if (!folders.length || !types.length)
                    return;
                for (const source of (0, folderScan_1.scanWatchedFolders)(folders, types, { groupMode }).sources) {
                    AppRepository_1.repository.markRepurposeSourceProcessed(pipeline.id, source.id, source.path);
                }
            };
            // Source ids differ between the two grouping modes, so a mode switch has to re-baseline
            // everything — otherwise yesterday's handled files would post again as bundles.
            if (!existing || existing.groupMode !== groupMode) {
                baseline(watchFolders, fileTypes);
            }
            else {
                const known = existing.watchFolders;
                // A folder that just gained `recursive` exposes a subtree that was never scanned before.
                const addedFolders = watchFolders.filter((folder) => {
                    const previous = known.find((candidate) => candidate.path === folder.path);
                    return !previous || (folder.recursive && !previous.recursive);
                });
                const addedTypes = fileTypes.filter((extension) => !existing.fileTypes.includes(extension));
                baseline(addedFolders, fileTypes);
                baseline(watchFolders.filter((folder) => !addedFolders.includes(folder)), addedTypes);
            }
        }
        return pipeline;
    }
    removePipeline(id) {
        const pipeline = AppRepository_1.repository.getRepurposePipeline(id);
        if (!pipeline || pipeline.kind !== 'folder')
            return { removed: false };
        AppRepository_1.repository.deleteRepurposePipeline(id);
        return { removed: true };
    }
    async runPipeline(id, options) {
        const pipeline = AppRepository_1.repository.getRepurposePipeline(id);
        if (!pipeline || pipeline.kind !== 'folder')
            throw new Error('Folder pipeline not found.');
        // The due-pipeline sweep snapshots its list before earlier entries' long runs, so a pipeline
        // paused meanwhile can still reach here — and markRepurposePipelineRunning would mint a fresh
        // revision that defeats the in-run pause guard. Only an explicit manual run may proceed.
        if (pipeline.status !== 'active' && !options?.includeLatest)
            throw new Error('This pipeline is paused.');
        if (this.runningPipelineIds.has(id))
            throw new Error('This pipeline is already scanning its folders.');
        this.runningPipelineIds.add(id);
        const startedAt = Date.now();
        const runningPipeline = AppRepository_1.repository.markRepurposePipelineRunning(id, startedAt);
        if (!runningPipeline) {
            this.runningPipelineIds.delete(id);
            throw new Error('Folder pipeline not found.');
        }
        const pipelineRevision = runningPipeline.updatedAt;
        const runLog = AppRepository_1.repository.createRepurposePipelineLog({
            pipeline,
            trigger: options?.includeLatest ? 'manual' : 'scheduled',
            startedAt,
        });
        let matchedFiles = 0;
        let processedSources = 0;
        let generatedContentItems = 0;
        let scheduledPosts = 0;
        const contentRunIds = [];
        let latestTitle = null;
        let latestPath = null;
        try {
            const { sources, matchedFiles: scannedFiles, folders } = (0, folderScan_1.scanWatchedFolders)(pipeline.watchFolders, pipeline.fileTypes, { groupMode: pipeline.groupMode });
            matchedFiles = scannedFiles;
            const missing = folders.filter((folder) => !folder.exists);
            // Every watched folder gone usually means an unmounted drive — surface it instead of
            // silently reporting "no new files".
            if (missing.length && missing.length === folders.length) {
                throw new Error(`Cannot read the watched folder${missing.length === 1 ? '' : 's'}: ${missing.map((folder) => folder.path).join(', ')}`);
            }
            const unprocessed = sources.filter((source) => !AppRepository_1.repository.hasProcessedRepurposeSource(id, source.id));
            // Oldest first so a backlog is published in the order the files arrived.
            const batch = unprocessed.sort((a, b) => a.modifiedAt - b.modifiedAt).slice(0, MAX_SOURCES_PER_RUN);
            for (const entry of batch) {
                const source = (0, folderScan_1.readFolderSource)(entry, { contextNote: pipeline.contextNote });
                if (!source) {
                    // Unreadable, empty, or oversized — remember it so it is not retried every poll.
                    AppRepository_1.repository.markRepurposeSourceProcessed(id, entry.id, entry.path);
                    continue;
                }
                latestTitle = source.title;
                latestPath = entry.path;
                // Per-channel overrides fall back to the pipeline defaults, channel by channel.
                const overrides = pipeline.channelOverrides ?? {};
                const outputFormats = Object.fromEntries(pipeline.destinationPlatforms.map((platform) => [
                    platform,
                    overrides[platform]?.outputFormat ?? pipeline.outputFormat,
                ]));
                const platformLanguages = Object.fromEntries(pipeline.destinationPlatforms.map((platform) => [
                    platform,
                    overrides[platform]?.languages?.length ? overrides[platform].languages : [pipeline.language],
                ]));
                const platformContentDetails = Object.fromEntries(pipeline.destinationPlatforms.map((platform) => [
                    platform,
                    overrides[platform]?.contentDetail ?? pipeline.contentDetail,
                ]));
                const usedLanguages = Array.from(new Set([pipeline.language, ...Object.values(platformLanguages).flat()]));
                const generation = await PipelineService_1.pipelineService.runPipeline('P1', {
                    productId: pipeline.productId,
                    trigger: 'folder_pipeline',
                    payload: {
                        sourceMode: 'repurpose',
                        sourceTitle: source.title,
                        sourceText: source.text,
                        featureSummary: source.text,
                        detectedType: source.detectedType,
                        platforms: pipeline.destinationPlatforms,
                        languages: [pipeline.language],
                        platformLanguages,
                        languageNames: Object.fromEntries(usedLanguages.map((code) => [code, (0, shared_1.languageName)(code)])),
                        contentDetail: pipeline.contentDetail,
                        platformContentDetails,
                        platformOutputFormats: outputFormats,
                        media: source.media,
                        repurposePipelineId: pipeline.id,
                        repurposePipelineRevision: pipelineRevision,
                        repurposeSourceId: entry.id,
                        folderSourcePath: entry.path,
                        folderSourceKind: entry.kind,
                        folderSourceFileCount: entry.fileCount,
                    },
                });
                const generated = AppRepository_1.repository
                    .listContent({ productId: pipeline.productId })
                    .filter((item) => item.runId === generation.run.id);
                if (generation.run.status === 'failed') {
                    for (const item of generated)
                        AppRepository_1.repository.deleteContent(item.id);
                    throw new Error(generation.notes[0] ?? `Could not generate content from “${entry.title}”.`);
                }
                generatedContentItems += generated.length;
                if (generated.length)
                    contentRunIds.push(generation.run.id);
                if (pipeline.scheduleMode === 'scheduled') {
                    scheduledPosts += (0, shared_1.scheduleGeneratedContent)({
                        pipeline,
                        items: generated,
                        alreadyScheduled: scheduledPosts,
                    });
                }
                AppRepository_1.repository.markRepurposeSourceProcessed(id, entry.id, entry.path);
                processedSources += 1;
            }
            const completedAt = Date.now();
            const current = AppRepository_1.repository.getRepurposePipeline(id) ?? pipeline;
            const updated = AppRepository_1.repository.completeRepurposePipelineRun({
                id,
                status: 'completed',
                completedAt,
                nextRunAt: (0, shared_1.nextRunAt)(current, completedAt),
                sourceTitle: latestTitle,
                sourceUrl: latestPath,
            });
            if (!updated)
                throw new Error('The pipeline was removed while it was running.');
            AppRepository_1.repository.completeRepurposePipelineLog({
                id: runLog.id,
                status: 'completed',
                completedAt,
                fetchedPosts: matchedFiles,
                processedPosts: processedSources,
                generatedContentItems,
                scheduledPosts,
                contentRunIds,
                sourceTitle: latestTitle,
                sourceUrl: latestPath,
            });
            return {
                pipeline: updated,
                fetchedPosts: matchedFiles,
                processedPosts: processedSources,
                generatedContentItems,
                scheduledPosts,
            };
        }
        catch (error) {
            const completedAt = Date.now();
            const current = AppRepository_1.repository.getRepurposePipeline(id) ?? pipeline;
            const errorMessage = error instanceof Error ? error.message : 'Folder pipeline failed.';
            AppRepository_1.repository.completeRepurposePipelineRun({
                id,
                status: 'failed',
                completedAt,
                nextRunAt: (0, shared_1.nextRunAt)(current, completedAt),
                error: errorMessage,
            });
            AppRepository_1.repository.completeRepurposePipelineLog({
                id: runLog.id,
                status: 'failed',
                completedAt,
                fetchedPosts: matchedFiles,
                processedPosts: processedSources,
                generatedContentItems,
                scheduledPosts,
                contentRunIds,
                sourceTitle: latestTitle,
                sourceUrl: latestPath,
                errorMessage,
            });
            throw error;
        }
        finally {
            this.runningPipelineIds.delete(id);
        }
    }
    async runDuePipelines() {
        for (const pipeline of AppRepository_1.repository.listDueRepurposePipelines(Date.now(), 'folder')) {
            if (this.runningPipelineIds.has(pipeline.id))
                continue;
            // The due list is a snapshot — the pipeline may have been paused or deleted while the
            // earlier entries were running.
            if (AppRepository_1.repository.getRepurposePipeline(pipeline.id)?.status !== 'active')
                continue;
            try {
                await this.runPipeline(pipeline.id);
            }
            catch (error) {
                console.error(`[folder-pipeline] ${pipeline.id} failed:`, error);
            }
        }
    }
}
exports.FolderPipelineService = FolderPipelineService;
exports.folderPipelineService = new FolderPipelineService();
//# sourceMappingURL=FolderPipelineService.js.map