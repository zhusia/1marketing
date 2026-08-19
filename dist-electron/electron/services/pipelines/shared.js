"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LANGUAGE_NAMES = exports.SCHEDULE_STAGGER_MS = void 0;
exports.languageName = languageName;
exports.nextRunAt = nextRunAt;
exports.assertPipelineRunCurrent = assertPipelineRunCurrent;
exports.mediaFromContentMetadata = mediaFromContentMetadata;
exports.scheduleGeneratedContent = scheduleGeneratedContent;
const AppRepository_1 = require("../AppRepository");
/** Destinations are staggered so a pipeline never publishes everything at the same minute. */
exports.SCHEDULE_STAGGER_MS = 15 * 60 * 1000;
exports.LANGUAGE_NAMES = {
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ja: 'Japanese',
    ko: 'Korean',
    vi: 'Vietnamese',
    zh: 'Chinese',
};
function languageName(code) {
    return exports.LANGUAGE_NAMES[code] ?? code.toUpperCase();
}
/** Next poll for an active pipeline; paused pipelines stop being due. */
function nextRunAt(pipeline, from) {
    return pipeline.status === 'active' ? from + pipeline.pollIntervalHours * 60 * 60 * 1000 : null;
}
/**
 * Automated runs hold the pipeline revision written by `markRepurposePipelineRunning`. A pause,
 * edit, or delete invalidates that revision so generic P1 generation cannot enqueue stale work.
 */
function assertPipelineRunCurrent(pipelineId, revision) {
    if (typeof pipelineId !== 'string' || typeof revision !== 'number')
        return;
    const current = AppRepository_1.repository.getRepurposePipeline(pipelineId);
    if (!current || current.updatedAt !== revision) {
        throw new Error('The pipeline was paused, changed, or deleted while content was being generated.');
    }
}
/** Rebuild PostMedia from the loosely-typed metadata stored on a generated content item. */
function mediaFromContentMetadata(value) {
    if (!Array.isArray(value))
        return [];
    const media = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item))
            continue;
        const record = item;
        const mediaPath = typeof record.path === 'string' ? record.path.trim() : '';
        const type = typeof record.type === 'string' ? record.type.trim() : '';
        if (!mediaPath || !type)
            continue;
        const alt = typeof record.alt === 'string' && record.alt.trim() ? record.alt.trim() : undefined;
        media.push({ path: mediaPath, type, alt });
    }
    return media;
}
/**
 * Place generated pieces on the local content calendar, one target per piece.
 * `alreadyScheduled` keeps the stagger continuous across several sources in one run.
 */
function scheduleGeneratedContent(input) {
    const { pipeline, items } = input;
    const scheduleBase = Date.now() + pipeline.scheduleDelayMinutes * 60 * 1000;
    let scheduled = 0;
    for (const item of items) {
        const platform = item.metadata.platform;
        if (typeof platform !== 'string' || !pipeline.destinationPlatforms.includes(platform)) {
            continue;
        }
        const scheduledAt = scheduleBase + (input.alreadyScheduled + scheduled) * exports.SCHEDULE_STAGGER_MS;
        const accountRef = typeof item.metadata.targetAccountRef === 'string' ? item.metadata.targetAccountRef : null;
        AppRepository_1.repository.upsertScheduledPost({
            productId: pipeline.productId,
            contentId: item.id,
            body: item.content,
            media: mediaFromContentMetadata(item.metadata.postMedia),
            scheduledAt,
            timezone: pipeline.timezone,
            status: 'scheduled',
            targets: [{ connectorName: platform, accountRef }],
        });
        AppRepository_1.repository.updateContent({ id: item.id, status: 'scheduled', scheduledAt });
        scheduled += 1;
    }
    return scheduled;
}
//# sourceMappingURL=shared.js.map