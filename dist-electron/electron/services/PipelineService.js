"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineService = exports.PipelineService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const simple_git_1 = __importDefault(require("simple-git"));
const AppRepository_1 = require("./AppRepository");
const AIService_1 = require("./AIService");
const DesignService_1 = require("./DesignService");
const VideoOrchestratorService_1 = require("./VideoOrchestratorService");
const time_1 = require("../utils/time");
const channels_1 = require("../ipc/channels");
const userDataPath_1 = require("../utils/userDataPath");
const contentLanguage_1 = require("../utils/contentLanguage");
const generatedContent_1 = require("../utils/generatedContent");
const registry_1 = require("./publishers/registry");
const shared_1 = require("./pipelines/shared");
function defaultCounters() {
    return {
        createdContentItems: 0,
        createdOpportunities: 0,
        createdSubmissions: 0,
        generatedAlerts: 0,
        notes: [],
    };
}
function deriveKeywords(product) {
    const keywordSeed = [
        product.name,
        ...product.tags,
        ...product.categories,
        ...product.competitors,
    ]
        .map((value) => value.trim())
        .filter(Boolean);
    const set = new Set();
    for (const seed of keywordSeed) {
        set.add(seed.toLowerCase());
        set.add(`${seed.toLowerCase()} tool`);
        set.add(`${seed.toLowerCase()} software`);
    }
    if (!set.size) {
        set.add(`${product.name.toLowerCase()} automation`);
        set.add(`${product.name.toLowerCase()} marketing`);
    }
    return Array.from(set).slice(0, 12);
}
function contentTitle(type, productName) {
    const map = {
        changelog: `${productName} changelog update`,
        blog: `${productName} feature deep dive`,
        tweet_thread: `${productName} X post`,
        linkedin: `${productName} launch update`,
        reddit: `${productName} community post`,
        video_short: `${productName} short demo video`,
        video_long: `${productName} full walkthrough script`,
    };
    return map[type];
}
const ALL_CONTENT_TYPES = [
    'changelog',
    'blog',
    'tweet_thread',
    'linkedin',
    'reddit',
    'video_short',
    'video_long',
];
const ALL_SOCIAL_PLATFORMS = [
    'twitter',
    'linkedin',
    'linkedin_page',
    'reddit',
    'telegram',
    'slack',
    'discord',
    'bluesky',
    'mastodon',
    'wordpress',
    'ghost',
    'devto',
    'hashnode',
    'pinterest',
    'youtube',
    'instagram',
    'facebook',
    'tiktok',
    'threads',
    'custom_api',
];
const PLATFORM_CONTENT_TYPE = {
    linkedin: 'linkedin',
    linkedin_page: 'linkedin',
    facebook: 'linkedin',
    twitter: 'tweet_thread',
    threads: 'tweet_thread',
    bluesky: 'tweet_thread',
    mastodon: 'tweet_thread',
    pinterest: 'tweet_thread',
    reddit: 'reddit',
    telegram: 'tweet_thread',
    slack: 'tweet_thread',
    discord: 'tweet_thread',
    wordpress: 'blog',
    ghost: 'blog',
    devto: 'blog',
    hashnode: 'blog',
    custom_api: 'blog',
    youtube: 'video_short',
    tiktok: 'video_short',
    instagram: 'video_short',
};
const PLATFORM_LABELS = {
    twitter: 'X',
    linkedin: 'LinkedIn',
    linkedin_page: 'LinkedIn Page',
    reddit: 'Reddit',
    telegram: 'Telegram',
    slack: 'Slack',
    discord: 'Discord',
    bluesky: 'Bluesky',
    mastodon: 'Mastodon',
    wordpress: 'WordPress',
    ghost: 'Ghost',
    devto: 'Dev.to',
    hashnode: 'Hashnode',
    pinterest: 'Pinterest',
    youtube: 'YouTube',
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
    threads: 'Threads',
    custom_api: 'Custom API',
};
const MAX_CONTENT_PROGRESS_LOGS = 100;
function generatedXPostLimit(type, platform, value) {
    // `tweet_thread` is the legacy machine name for an X post. Older campaign
    // rows may not have platform metadata, so keep those safe during regeneration.
    if (platform !== 'twitter' && !(platform === null && type === 'tweet_thread'))
        return null;
    return typeof value === 'number' && Number.isFinite(value) && value > 0
        ? Math.floor(value)
        : generatedContent_1.STANDARD_X_POST_LIMIT;
}
function isContentType(value) {
    return typeof value === 'string' && ALL_CONTENT_TYPES.includes(value);
}
function isSocialPlatform(value) {
    return typeof value === 'string' && ALL_SOCIAL_PLATFORMS.includes(value);
}
function uniqueContentTypes(value) {
    const source = Array.isArray(value) ? value : [];
    const selected = source.filter(isContentType);
    return Array.from(new Set(selected));
}
function selectedContentTypes(payload) {
    const fromContentTypes = uniqueContentTypes(payload.contentTypes);
    if (fromContentTypes.length)
        return fromContentTypes;
    const fromChannels = uniqueContentTypes(payload.channels);
    if (fromChannels.length)
        return fromChannels;
    return ALL_CONTENT_TYPES;
}
function selectedPlatforms(payload) {
    const source = Array.isArray(payload.platforms) ? payload.platforms : [];
    return Array.from(new Set(source.filter(isSocialPlatform)));
}
function isCampaignOutputFormat(value) {
    return value === 'markdown' || value === 'plaintext' || value === 'html';
}
function selectedPlatformOutputFormats(payload) {
    const raw = payload.platformOutputFormats;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
        if (isSocialPlatform(key) && isCampaignOutputFormat(value))
            result[key] = value;
    }
    return result;
}
/** Instagram can generate a static image post (caption) or a locally rendered Reel; defaults to image. */
function instagramContentTypeFrom(payload) {
    return payload.instagramContentType === 'video' ? 'video' : 'image';
}
function selectedAccountTargets(payload) {
    const raw = Array.isArray(payload.accountTargets) ? payload.accountTargets : [];
    const selected = new Set(selectedPlatforms(payload));
    const targets = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const record = entry;
        if (!isSocialPlatform(record.platform) || !selected.has(record.platform))
            continue;
        const accountRef = typeof record.accountRef === 'string' ? record.accountRef.trim() : '';
        if (!accountRef)
            continue;
        const accountName = typeof record.accountName === 'string' && record.accountName.trim()
            ? record.accountName.trim().slice(0, 160)
            : accountRef;
        const languages = normalizedLanguages(record.languages);
        if (!languages.length)
            continue;
        const postFormat = record.postFormat === 'image' || record.postFormat === 'text_image' ? record.postFormat : 'text';
        const duplicate = targets.some((target) => target.platform === record.platform && target.accountRef === accountRef);
        if (!duplicate)
            targets.push({ platform: record.platform, accountRef, accountName, languages, postFormat });
    }
    return targets;
}
function selectedCampaignRegenerationSources(payload) {
    const raw = Array.isArray(payload.regenerationSources) ? payload.regenerationSources : [];
    const sources = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const record = entry;
        const rootId = typeof record.rootId === 'string' ? record.rootId.trim() : '';
        const fromId = typeof record.fromId === 'string' ? record.fromId.trim() : '';
        const type = isContentType(record.type) ? record.type : null;
        const platform = isSocialPlatform(record.platform) ? record.platform : null;
        const accountRef = typeof record.accountRef === 'string' && record.accountRef.trim()
            ? record.accountRef.trim()
            : null;
        const language = normalizedLanguages([record.language])[0] ?? null;
        if (!rootId || !fromId || !type || !language)
            continue;
        sources.push({ rootId, fromId, type, platform, accountRef, language });
    }
    return sources;
}
function campaignRegenerationSourceFor(sources, target, language) {
    return sources.find((source) => source.language === language &&
        source.accountRef === target.accountRef &&
        (target.platform
            ? source.platform === target.platform
            : source.platform === null && source.type === target.type)) ?? null;
}
function selectedOutputTargets(payload) {
    const platforms = selectedPlatforms(payload);
    if (platforms.length) {
        // An Instagram image post generates a caption + graphic; a video post renders a short MP4.
        const instagramType = instagramContentTypeFrom(payload) === 'video' ? 'video_short' : 'linkedin';
        const accountTargets = selectedAccountTargets(payload);
        const outputFormats = selectedPlatformOutputFormats(payload);
        return platforms.flatMap((platform) => {
            const outputFormat = outputFormats[platform] ?? (0, registry_1.suggestedOutputFormatForPlatform)(platform);
            const platformAccounts = accountTargets.filter((target) => target.platform === platform);
            if (platformAccounts.length) {
                return platformAccounts.map((account) => ({
                    type: platform === 'instagram' ? instagramType : PLATFORM_CONTENT_TYPE[platform],
                    platform,
                    label: `${PLATFORM_LABELS[platform]} · ${account.accountName}`,
                    accountRef: account.accountRef,
                    accountName: account.accountName,
                    postFormat: account.postFormat,
                    outputFormat,
                    languages: account.languages,
                }));
            }
            return [{
                    type: platform === 'instagram' ? instagramType : PLATFORM_CONTENT_TYPE[platform],
                    platform,
                    label: PLATFORM_LABELS[platform],
                    accountRef: null,
                    accountName: null,
                    postFormat: null,
                    outputFormat,
                    languages: null,
                }];
        });
    }
    return selectedContentTypes(payload).map((type) => ({
        type,
        platform: null,
        label: type,
        accountRef: null,
        accountName: null,
        postFormat: null,
        outputFormat: 'markdown',
        languages: null,
    }));
}
function contentTitleForTarget(target, productName) {
    if (target.platform) {
        const accountSuffix = target.accountName ? ` · ${target.accountName}` : '';
        return `${productName} ${PLATFORM_LABELS[target.platform]} post${accountSuffix}`;
    }
    return contentTitle(target.type, productName);
}
function selectedLanguages(payload) {
    const languages = normalizedLanguages(payload.languages);
    return languages.length ? languages : ['en'];
}
function normalizedLanguages(value) {
    const source = Array.isArray(value) ? value : [];
    const languages = source
        .filter((value) => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim().toLowerCase())
        .filter((value) => /^[a-z]{2}(?:-[a-z]{2})?$/.test(value));
    return Array.from(new Set(languages)).slice(0, 4);
}
function selectedPlatformLanguages(payload) {
    const raw = payload.platformLanguages;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!isSocialPlatform(key))
            continue;
        const languages = normalizedLanguages(value);
        if (languages.length)
            result[key] = languages;
    }
    return result;
}
/** Per-platform detail level (`concise` | `balanced` | `detailed`); falls back to payload.contentDetail. */
function selectedPlatformContentDetails(payload) {
    const raw = payload.platformContentDetails;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return {};
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!isSocialPlatform(key))
            continue;
        if (value === 'concise' || value === 'balanced' || value === 'detailed')
            result[key] = value;
    }
    return result;
}
function selectedAgentId(payload) {
    const value = typeof payload.agentId === 'string' ? payload.agentId : payload.localAgentId;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/** Per-campaign prompt overrides ({ system?, tasks? }) forwarded to AIService.buildPrompt. */
function promptOverrides(payload) {
    const raw = payload.promptOverrides;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}
/** Map of language code -> display name supplied by the renderer (covers custom languages). */
function languageNameMap(payload) {
    const raw = payload.languageNames;
    if (!raw || typeof raw !== 'object')
        return {};
    const out = {};
    for (const [code, value] of Object.entries(raw)) {
        if (typeof value === 'string' && value.trim())
            out[code] = value.trim();
    }
    return out;
}
function languageName(code, overrides) {
    return (0, contentLanguage_1.contentLanguageName)(code, overrides?.[code]);
}
function mediaTypeFromPath(pathValue) {
    const extension = pathValue.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
    const imageTypes = {
        apng: 'image/apng',
        avif: 'image/avif',
        gif: 'image/gif',
        jpeg: 'image/jpeg',
        jpg: 'image/jpeg',
        png: 'image/png',
        svg: 'image/svg+xml',
        webp: 'image/webp',
    };
    const videoTypes = {
        avi: 'video/x-msvideo',
        m4v: 'video/x-m4v',
        mkv: 'video/x-matroska',
        mov: 'video/quicktime',
        mp4: 'video/mp4',
        webm: 'video/webm',
    };
    return imageTypes[extension] ?? videoTypes[extension] ?? 'application/octet-stream';
}
function isPostMediaPath(pathValue) {
    return /\.(apng|avif|gif|jpe?g|png|svg|webp|avi|m4v|mkv|mov|mp4|webm)$/i.test(pathValue);
}
function postMediaFromPayload(payload) {
    const source = Array.isArray(payload.media) ? payload.media : [];
    const result = [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const record = entry;
        const pathValue = typeof record.path === 'string' ? record.path.trim() : '';
        if (!pathValue || !isPostMediaPath(pathValue))
            continue;
        const type = typeof record.type === 'string' && record.type.trim()
            ? record.type.trim()
            : mediaTypeFromPath(pathValue);
        const alt = typeof record.alt === 'string' && record.alt.trim() ? record.alt.trim() : undefined;
        if (!result.some((item) => item.path === pathValue))
            result.push({ path: pathValue, type, alt });
    }
    return result.slice(0, 12);
}
function isImagePostMedia(media) {
    return media.type.startsWith('image/') || /\.(apng|avif|gif|jpe?g|png|svg|webp)$/i.test(media.path);
}
function isVideoPostMedia(media) {
    return media.type.startsWith('video/') || /\.(avi|m4v|mkv|mov|mp4|webm)$/i.test(media.path);
}
async function renderCampaignShortVideo(input) {
    const referenceImage = input.referenceMedia?.find((media) => isImagePostMedia(media) && path_1.default.isAbsolute(media.path) && fs_1.default.existsSync(media.path));
    const run = await VideoOrchestratorService_1.videoOrchestratorService.writeStoryboard({
        productId: input.product.id,
        pipelineId: 'feature',
        format: 'story',
        durationMs: 12_000,
        prompt: [
            `Create a finished short-form marketing video for ${input.targetLabel}.`,
            `Campaign source: ${input.sourceTitle}`,
            input.sourceText.trim() ? `Source excerpt:\n${input.sourceText.trim().slice(0, 8_000)}` : '',
            `Publishable ${input.language.toUpperCase()} copy:\n${input.generatedCopy}`,
            'Use concise on-screen copy and motion-friendly visuals. Spoken narration is optional; the video must work without it.',
        ].filter(Boolean).join('\n\n'),
        agentId: input.agentId ?? null,
        referenceImagePath: referenceImage?.path ?? null,
        autoRun: true,
        wantsAudio: false,
        wantsCaptions: true,
    }, (progress) => {
        if (progress.message)
            input.onProgress?.(progress.message, progress.tone);
    });
    const asset = run.finalAsset;
    const videoPath = asset?.localPath ?? asset?.publicUrl ?? null;
    if (!asset || !videoPath)
        throw new Error('The local video pipeline completed without a usable MP4 asset.');
    return {
        media: { path: videoPath, type: asset.mimeType },
        runId: run.id,
        storyboardId: run.storyboardId,
        assetId: asset.id,
    };
}
function campaignMediaFor(existing) {
    const rootId = typeof existing.metadata.sourceCampaignItemId === 'string'
        ? existing.metadata.sourceCampaignItemId
        : existing.id;
    const campaignItems = AppRepository_1.repository.listContent({ productId: existing.productId }).filter((item) => {
        if (existing.runId && item.runId === existing.runId)
            return true;
        const itemRoot = typeof item.metadata.sourceCampaignItemId === 'string' ? item.metadata.sourceCampaignItemId : item.id;
        return item.id === rootId || itemRoot === rootId;
    });
    const result = [];
    for (const item of campaignItems.length ? campaignItems : [existing]) {
        for (const media of postMediaFromPayload({ media: item.metadata.postMedia ?? item.metadata.media })) {
            if (!result.some((entry) => entry.path === media.path))
                result.push(media);
        }
    }
    return result.slice(0, 12);
}
function currentPostType(existing) {
    const explicit = existing.metadata.postType ?? existing.metadata.instagramContentType;
    if (explicit === 'image' || explicit === 'video')
        return explicit;
    if (existing.type === 'video_short' || existing.type === 'video_long')
        return 'video';
    const media = postMediaFromPayload({ media: existing.metadata.postMedia ?? existing.metadata.media });
    if (media.some(isImagePostMedia))
        return 'image';
    return media.some((item) => item.type.startsWith('video/')) ? 'video' : 'image';
}
function regeneratedContentType(existing, platform, postType) {
    if (postType === 'video')
        return 'video_short';
    if (platform) {
        const platformType = PLATFORM_CONTENT_TYPE[platform];
        return platformType === 'video_short' || platformType === 'video_long' ? 'linkedin' : platformType;
    }
    return existing.type === 'video_short' || existing.type === 'video_long' ? 'linkedin' : existing.type;
}
/** High-fidelity Studio brief for a square social graphic, seeded from the generated caption. */
function socialImagePrompt(caption, languageCode, languageName) {
    const gist = caption.replace(/\s+/g, ' ').trim().slice(0, 500);
    return [
        'Design a premium, scroll-stopping square social feed graphic for this post.',
        gist ? `Post caption: ${gist}` : '',
        'Extract one strong visual idea from the caption. Use a 2–7 word on-image headline, at most one short support line, and no hashtags or caption paragraphs.',
        'Build a deliberate editorial composition with a clear focal point, strong thumbnail legibility and safe margins. Use a CTA only when the caption has a real action.',
        'Avoid generic centered gradient cards, repeated glass tiles, decorative microcopy, and implementation-looking text. The export must contain only intentional campaign copy.',
        (0, contentLanguage_1.contentLanguageInstruction)({ code: languageCode, name: languageName, outputLabel: 'on-image copy' }) ?? '',
    ]
        .filter(Boolean)
        .join('\n');
}
function exportFolder() {
    const folder = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), 'directory-exports');
    fs_1.default.mkdirSync(folder, { recursive: true });
    return folder;
}
class PipelineService {
    contentProgress = {
        status: 'idle',
        runId: null,
        productId: null,
        agentId: null,
        currentType: null,
        currentLanguage: null,
        processedCount: 0,
        totalCount: 0,
        message: '',
        logs: [],
        currentDraft: null,
        generatedItems: [],
    };
    getContentProgress() {
        return {
            ...this.contentProgress,
            logs: [...this.contentProgress.logs],
            currentDraft: this.contentProgress.currentDraft ? { ...this.contentProgress.currentDraft } : null,
            generatedItems: [...this.contentProgress.generatedItems],
        };
    }
    async runPipeline(type, input) {
        const run = AppRepository_1.repository.createPipelineRun({
            productId: input.productId,
            pipelineType: type,
            trigger: input.trigger,
            input: input.payload,
        });
        try {
            const counters = defaultCounters();
            if (type === 'P1') {
                await this.runPipeline1(run.id, input, counters);
            }
            else if (type === 'P2') {
                await this.runPipeline2(run.id, input, counters);
            }
            else if (type === 'P3') {
                await this.runPipeline3(run.id, input, counters);
            }
            else if (type === 'P4') {
                await this.runPipeline4(run.id, input, counters);
            }
            const completed = AppRepository_1.repository.completePipelineRun({
                runId: run.id,
                status: 'completed',
                output: {
                    createdContentItems: counters.createdContentItems,
                    createdOpportunities: counters.createdOpportunities,
                    createdSubmissions: counters.createdSubmissions,
                    generatedAlerts: counters.generatedAlerts,
                    notes: counters.notes,
                },
            });
            return {
                run: completed ?? run,
                createdContentItems: counters.createdContentItems,
                createdOpportunities: counters.createdOpportunities,
                createdSubmissions: counters.createdSubmissions,
                generatedAlerts: counters.generatedAlerts,
                notes: counters.notes,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            if (type === 'P1') {
                this.finishContentProgress('failed', message, 'error');
            }
            const failed = AppRepository_1.repository.completePipelineRun({
                runId: run.id,
                status: 'failed',
                output: { message },
                errorMessage: message,
            });
            return {
                run: failed ?? run,
                createdContentItems: 0,
                createdOpportunities: 0,
                createdSubmissions: 0,
                generatedAlerts: 0,
                notes: [message],
            };
        }
    }
    /**
     * Write a single content piece from a saved keyword cluster using the local AI
     * CLI, persisting it to the content library. Returns the created ContentItem.
     */
    async writeContentForCluster(input) {
        const product = AppRepository_1.repository.getProduct(input.productId);
        if (!product)
            throw new Error('Product not found');
        const cluster = input.cluster;
        const type = input.type ?? 'blog';
        const keywords = cluster.keywords.map((keyword) => keyword.keyword).filter(Boolean);
        const agentId = input.agentId ?? null;
        const run = AppRepository_1.repository.createPipelineRun({
            productId: product.id,
            pipelineType: 'P1',
            trigger: 'keyword-cluster',
            input: { source: 'keyword-cluster', clusterLabel: cluster.label, keywords },
        });
        try {
            const generated = await AIService_1.aiService.generate({
                type,
                product,
                agentId,
                context: {
                    campaignComposer: true,
                    keywordCluster: cluster.label,
                    targetKeywords: keywords,
                    primaryKeyword: keywords[0] ?? cluster.label,
                    searchIntent: cluster.intent,
                    suggestedPillar: cluster.pillar,
                    suggestedFormat: cluster.contentType,
                    rationale: cluster.rationale,
                    brandVoice: product.brandVoice,
                },
            });
            const title = (cluster.pillar && cluster.pillar.trim()) || cluster.label;
            const contentItem = AppRepository_1.repository.createContent({
                productId: product.id,
                runId: run.id,
                type,
                title,
                content: generated.content,
                status: 'pending',
                metadata: {
                    provider: generated.provider,
                    source: 'keyword-cluster',
                    clusterLabel: cluster.label,
                    intent: cluster.intent,
                    pillar: cluster.pillar,
                    suggestedFormat: cluster.contentType,
                    keywords,
                    localAgentId: agentId,
                },
            });
            AppRepository_1.repository.completePipelineRun({
                runId: run.id,
                status: 'completed',
                output: { contentId: contentItem.id, createdContentItems: 1 },
            });
            return contentItem;
        }
        catch (error) {
            AppRepository_1.repository.completePipelineRun({
                runId: run.id,
                status: 'failed',
                errorMessage: error instanceof Error ? error.message : 'Cluster content generation failed.',
            });
            throw error;
        }
    }
    /**
     * Create an empty content draft (no AI generation) from a caller-supplied
     * scaffold — e.g. the content-brief "Write content" action hands over a
     * markdown skeleton, slug, and target keywords for the user to edit. A
     * lightweight pipeline run is recorded so the FK + run history stay
     * consistent with AI-generated pieces.
     */
    createDraft(input) {
        const product = AppRepository_1.repository.getProduct(input.productId);
        if (!product)
            throw new Error('Product not found');
        const type = input.type ?? 'blog';
        const metadata = input.metadata ?? {};
        const run = AppRepository_1.repository.createPipelineRun({
            productId: product.id,
            pipelineType: 'P1',
            trigger: 'manual-draft',
            input: { source: metadata.source ?? 'manual-draft', title: input.title },
        });
        const contentItem = AppRepository_1.repository.createContent({
            productId: product.id,
            runId: run.id,
            type,
            title: input.title.trim() || 'Untitled draft',
            content: input.content,
            status: 'pending',
            metadata,
        });
        AppRepository_1.repository.completePipelineRun({
            runId: run.id,
            status: 'completed',
            output: { contentId: contentItem.id, createdContentItems: 1 },
        });
        return contentItem;
    }
    startContentProgress(runId, productId, agentId, totalCount) {
        this.contentProgress = {
            status: 'running',
            runId,
            productId,
            agentId,
            currentType: null,
            currentLanguage: null,
            processedCount: 0,
            totalCount,
            message: 'Starting campaign generation...',
            logs: [],
            currentDraft: null,
            generatedItems: [],
        };
        this.emitContentProgress();
        this.pushContentLog('Starting campaign generation...');
    }
    setContentProgress(update) {
        this.contentProgress = {
            ...this.contentProgress,
            ...update,
        };
        this.emitContentProgress();
    }
    pushContentLog(message, level = 'info', kind, meta) {
        this.contentProgress = {
            ...this.contentProgress,
            message,
            logs: [
                ...this.contentProgress.logs,
                {
                    time: Date.now(),
                    message,
                    level,
                    ...(kind ? { kind } : {}),
                    ...(meta?.phase ? { phase: meta.phase } : {}),
                    ...(meta?.detail ? { detail: meta.detail } : {}),
                    ...(meta?.sites?.length ? { sites: meta.sites } : {}),
                },
            ].slice(-MAX_CONTENT_PROGRESS_LOGS),
        };
        this.emitContentProgress();
    }
    finishContentProgress(status, message, level) {
        this.contentProgress = {
            ...this.contentProgress,
            status,
            currentType: null,
            currentLanguage: null,
            currentDraft: null,
            message,
            logs: [
                ...this.contentProgress.logs,
                {
                    time: Date.now(),
                    message,
                    level,
                },
            ].slice(-MAX_CONTENT_PROGRESS_LOGS),
        };
        this.emitContentProgress();
    }
    setCurrentDraft(title, type, language, platform = null, accountRef = null, accountName = null, postFormat = null, outputFormat = null, content = '') {
        this.contentProgress = {
            ...this.contentProgress,
            currentDraft: {
                title,
                type,
                platform,
                accountRef,
                accountName,
                postFormat,
                outputFormat,
                language,
                content,
                updatedAt: Date.now(),
            },
        };
        this.emitContentProgress();
    }
    appendCurrentDraft(chunk) {
        if (!this.contentProgress.currentDraft || !chunk)
            return;
        const content = (0, generatedContent_1.sanitizeGeneratedContent)(`${this.contentProgress.currentDraft.content}${chunk}`);
        this.contentProgress = {
            ...this.contentProgress,
            currentDraft: {
                ...this.contentProgress.currentDraft,
                content,
                updatedAt: Date.now(),
            },
        };
        this.emitContentProgress();
    }
    addGeneratedItem(item) {
        this.contentProgress = {
            ...this.contentProgress,
            currentDraft: null,
            generatedItems: [...this.contentProgress.generatedItems, item],
        };
        this.emitContentProgress();
    }
    emitContentProgress() {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send(channels_1.CHANNELS.CONTENT_GENERATION_PROGRESS, this.getContentProgress());
            }
        }
    }
    async runPipeline1(runId, input, counters) {
        const product = AppRepository_1.repository.getProduct(input.productId);
        if (!product)
            throw new Error('Product not found');
        const payload = input.payload ?? {};
        // When the user adds channels to an existing campaign, new pieces are tagged with the
        // original campaign's runId so they surface in the same results view, while this pipeline
        // run still records its own id for the activity log.
        const appendToRunId = typeof payload.appendToRunId === 'string' && payload.appendToRunId.trim() ? payload.appendToRunId.trim() : null;
        const contentRunId = appendToRunId ?? runId;
        const sourceText = typeof payload.sourceText === 'string' ? payload.sourceText.trim() : '';
        const sourceTitle = typeof payload.sourceTitle === 'string' && payload.sourceTitle.trim()
            ? payload.sourceTitle.trim()
            : 'Campaign source';
        // Repurpose mode: the source is a finished post the user wrote for one channel,
        // and every generated piece must faithfully adapt it for its own channel.
        const sourceChannel = isSocialPlatform(payload.sourceChannel) ? payload.sourceChannel : null;
        const sourceChannelLabel = sourceChannel ? PLATFORM_LABELS[sourceChannel] : null;
        const featureSummary = sourceText || (typeof payload.featureSummary === 'string' && payload.featureSummary.trim()
            ? payload.featureSummary.trim()
            : 'Improved core automation workflows for faster content publishing.');
        const outputTargets = selectedOutputTargets(payload);
        const contentTypes = Array.from(new Set(outputTargets.map((target) => target.type)));
        const platformTargets = Array.from(new Set(outputTargets
            .map((target) => target.platform)
            .filter((platform) => Boolean(platform))));
        const defaultLanguages = selectedLanguages(payload);
        const platformLanguages = selectedPlatformLanguages(payload);
        const outputPlan = outputTargets.map((target) => ({
            target,
            languages: target.languages ??
                (target.platform ? platformLanguages[target.platform] ?? defaultLanguages : defaultLanguages),
        }));
        const regenerationSources = selectedCampaignRegenerationSources(payload);
        const campaignLanguages = Array.from(new Set(outputPlan.flatMap((entry) => entry.languages)));
        const agentId = selectedAgentId(payload);
        const webSearch = payload.webSearch === true;
        const overrides = promptOverrides(payload);
        const languageNames = languageNameMap(payload);
        const platformContentDetails = selectedPlatformContentDetails(payload);
        const postMedia = postMediaFromPayload(payload);
        // Instagram can be a static image post or a locally rendered Reel (default: image).
        const instagramContentType = instagramContentTypeFrom(payload);
        // For an image post, 'generate' designs a branded square graphic per piece; anything else reuses
        // whatever media is attached to the campaign (the default). Ignored for video posts.
        const instagramImageMode = payload.instagramImageMode === 'generate' ? 'generate' : 'reuse';
        const totalOutputs = outputPlan.reduce((total, entry) => total + entry.languages.length, 0);
        this.startContentProgress(runId, product.id, agentId, totalOutputs);
        this.pushContentLog(`Prepared ${totalOutputs} output${totalOutputs === 1 ? '' : 's'} from ` +
            `${outputTargets.length} destination${outputTargets.length === 1 ? '' : 's'} and ` +
            `${campaignLanguages.length} assigned language${campaignLanguages.length === 1 ? '' : 's'}.`);
        this.pushContentLog(agentId ? `Selected local CLI: ${agentId}.` : 'Using the current AI route.');
        this.pushContentLog(webSearch
            ? 'Web search is ON — the model may look up live sources while writing.'
            : 'Web search is OFF — generation stays on the campaign brief and model knowledge.', 'info', webSearch ? 'websearch' : 'message');
        if (postMedia.length) {
            this.pushContentLog(`Attached ${postMedia.length} media file${postMedia.length === 1 ? '' : 's'} to generated pieces.`);
        }
        let gitDiff = typeof payload.gitDiff === 'string' ? payload.gitDiff : '';
        if (!gitDiff && product.repoPath) {
            try {
                const git = (0, simple_git_1.default)(product.repoPath);
                gitDiff = await git.diff(['HEAD~1..HEAD']);
                counters.notes.push('Read latest git diff from repository context.');
            }
            catch {
                counters.notes.push('Could not read git diff from repository, used feature summary only.');
            }
        }
        for (const { target, languages } of outputPlan) {
            const { type, platform, accountRef, accountName, postFormat, outputFormat } = target;
            // A destination can carry its own detail level; otherwise the campaign-wide one applies.
            const contentDetail = (platform ? platformContentDetails[platform] : undefined) ?? payload.contentDetail;
            for (const language of languages) {
                (0, shared_1.assertPipelineRunCurrent)(payload.repurposePipelineId, payload.repurposePipelineRevision);
                const title = languages.length > 1
                    ? `${contentTitleForTarget(target, product.name)} / ${language.toUpperCase()}`
                    : contentTitleForTarget(target, product.name);
                this.setContentProgress({
                    currentType: type,
                    currentLanguage: language,
                    message: `Generating ${target.label} / ${language.toUpperCase()}...`,
                });
                this.setCurrentDraft(title, type, language, platform, accountRef, accountName, postFormat, outputFormat);
                this.pushContentLog(`Generating ${target.label} in ${languageName(language, languageNames)} (${counters.createdContentItems + 1}/${totalOutputs}).`);
                let generated = await AIService_1.aiService.generate({
                    type,
                    product,
                    agentId,
                    webSearch,
                    onLog: (message, level, kind, meta) => this.pushContentLog(message, level, kind, meta),
                    onToken: (chunk) => this.appendCurrentDraft(chunk),
                    context: {
                        featureSummary,
                        sourceText,
                        sourceTitle,
                        sourceMode: payload.sourceMode,
                        sourceChannel,
                        sourceChannelLabel,
                        contentDetail,
                        repurposePipelineId: payload.repurposePipelineId,
                        repurposeSourceId: payload.repurposeSourceId,
                        repurposeSourceUrl: payload.repurposeSourceUrl,
                        detectedType: payload.detectedType,
                        gitDiff,
                        trigger: input.trigger,
                        campaignComposer: true,
                        language,
                        languageName: languageName(language, languageNames),
                        targetPlatform: platform,
                        targetPlatformLabel: platform ? PLATFORM_LABELS[platform] : target.label,
                        targetAccountRef: accountRef,
                        targetAccountName: accountName,
                        accountPostFormat: postFormat,
                        outputFormat,
                        ...(platform === 'instagram' ? { instagramContentType } : {}),
                        selectedChannels: platformTargets.length ? platformTargets : contentTypes,
                        selectedPlatforms: platformTargets,
                        selectedContentTypes: contentTypes,
                        xPostLimit: typeof payload.xPostLimit === 'number' ? payload.xPostLimit : undefined,
                        selectedLanguages: languages,
                        selectedAgentId: agentId,
                        brandVoice: product.brandVoice,
                        webSearch,
                        ...(overrides ? { promptOverrides: overrides } : {}),
                    },
                });
                const xPostLimit = generatedXPostLimit(type, platform, payload.xPostLimit);
                if (xPostLimit !== null) {
                    const fitted = (0, generatedContent_1.fitGeneratedXPost)(generated.content, xPostLimit);
                    if (fitted.shortened) {
                        generated = { ...generated, content: fitted.content };
                        this.pushContentLog(`Shortened the X post to the ${xPostLimit.toLocaleString()}-character limit.`, 'success');
                    }
                }
                // The pause/delete guard can only fire between await points, and text generation above can
                // run for minutes on a local CLI. Re-check the owning pipeline before committing to the even
                // longer image-design or video-render stages below.
                (0, shared_1.assertPipelineRunCurrent)(payload.repurposePipelineId, payload.repurposePipelineRevision);
                // Account-specific formats own their media independently. Text-only drops campaign media;
                // image formats reuse attached images or generate a branded square when none is attached.
                // Repurpose/watch pipelines often have text-only Facebook posts — never invent media from a
                // profile avatar (filtered upstream); generate a branded graphic instead of publishing bare text.
                let pieceMedia = postMedia;
                let renderedShortVideo = null;
                const isRepurpose = payload.sourceMode === 'repurpose';
                const instagramForceGenerate = platform === 'instagram' && instagramContentType === 'image' && instagramImageMode === 'generate';
                const noUsableSourceMedia = !postMedia.some(isImagePostMedia) && !postMedia.some(isVideoPostMedia);
                const needsDesignedImage = type !== 'video_short'
                    && type !== 'video_long'
                    && (instagramForceGenerate
                        || (noUsableSourceMedia
                            && ((Boolean(accountRef) && (postFormat === 'image' || postFormat === 'text_image'))
                                || (isRepurpose && Boolean(platform) && postFormat !== 'text'))));
                if (accountRef && postFormat === 'text') {
                    pieceMedia = [];
                }
                else if (accountRef && postFormat) {
                    pieceMedia = postMedia.filter(isImagePostMedia);
                }
                if (needsDesignedImage || (accountRef && postFormat && postFormat !== 'text' && !pieceMedia.length)) {
                    const designLabel = accountName ?? target.label;
                    this.setContentProgress({
                        message: `Designing image for ${designLabel} / ${language.toUpperCase()}...`,
                    });
                    this.pushContentLog(`Designing a branded image for ${designLabel} in ${languageName(language, languageNames)}...`);
                    try {
                        const { asset } = await DesignService_1.designService.generateSocialImage({
                            productId: product.id,
                            prompt: socialImagePrompt(generated.content, language, languageName(language, languageNames)),
                            fallbackHeadline: generated.content,
                            format: 'social_square',
                            agentId,
                        });
                        const imagePath = asset.localPath ?? asset.publicUrl;
                        if (!imagePath)
                            throw new Error('The generated image did not return a local path.');
                        pieceMedia = [{ path: imagePath, type: asset.mimeType }];
                        this.pushContentLog(`Attached a branded image for ${designLabel}.`, 'success');
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : 'Image generation failed.';
                        this.pushContentLog(`Image generation failed for ${designLabel}: ${message}`, 'error');
                        // Account image formats require media; repurpose soft-fails to text-only so the run can finish.
                        if (accountRef && (postFormat === 'image' || postFormat === 'text_image')) {
                            throw new Error(`Could not prepare the required image for ${designLabel}: ${message}`);
                        }
                    }
                }
                if (type === 'video_short') {
                    const attachedVideo = postMedia.find(isVideoPostMedia);
                    if (attachedVideo) {
                        pieceMedia = [attachedVideo];
                        this.pushContentLog(`Using the attached video for ${target.label}.`, 'success');
                    }
                    else {
                        this.setContentProgress({
                            message: `Rendering ${target.label} video / ${language.toUpperCase()}...`,
                        });
                        this.pushContentLog(`Storyboarding and rendering a local MP4 for ${target.label} in ` +
                            `${languageName(language, languageNames)}...`);
                        renderedShortVideo = await renderCampaignShortVideo({
                            product,
                            sourceTitle,
                            sourceText: sourceText || featureSummary,
                            generatedCopy: generated.content,
                            targetLabel: target.label,
                            language,
                            agentId,
                            referenceMedia: postMedia,
                            onProgress: (message, level) => this.pushContentLog(message, level),
                        });
                        pieceMedia = [renderedShortVideo.media];
                        this.pushContentLog(`Rendered and attached the ${target.label} MP4.`, 'success');
                    }
                }
                const regenerationSource = campaignRegenerationSourceFor(regenerationSources, target, language);
                // Generation, image design, and video rendering all yield to the event loop. Re-check the
                // owning pipeline immediately before persistence so a concurrent pause/delete leaves no
                // partial campaign that an upstream scheduler could later enqueue.
                (0, shared_1.assertPipelineRunCurrent)(payload.repurposePipelineId, payload.repurposePipelineRevision);
                const contentItem = AppRepository_1.repository.createContent({
                    productId: product.id,
                    runId: contentRunId,
                    type,
                    title,
                    content: generated.content,
                    status: 'pending',
                    metadata: {
                        provider: generated.provider,
                        featureSummary,
                        sourceTitle,
                        sourceMode: payload.sourceMode,
                        ...(sourceChannel ? { sourceChannel, sourceChannelLabel } : {}),
                        ...(typeof contentDetail === 'string' ? { contentDetail } : {}),
                        ...(typeof payload.repurposePipelineId === 'string'
                            ? { repurposePipelineId: payload.repurposePipelineId }
                            : {}),
                        ...(typeof payload.repurposeSourceId === 'string' ? { repurposeSourceId: payload.repurposeSourceId } : {}),
                        ...(typeof payload.repurposeSourceUrl === 'string' ? { repurposeSourceUrl: payload.repurposeSourceUrl } : {}),
                        detectedType: payload.detectedType,
                        language,
                        languageName: languageName(language, languageNames),
                        languages,
                        campaignLanguages,
                        platformLanguages,
                        platform,
                        platformLabel: target.label,
                        targetAccountRef: accountRef,
                        targetAccountName: accountName,
                        accountPostFormat: postFormat,
                        outputFormat,
                        publishText: postFormat !== 'image',
                        selectedChannels: platformTargets.length ? platformTargets : contentTypes,
                        selectedPlatforms: platformTargets,
                        selectedContentTypes: contentTypes,
                        ...(xPostLimit !== null ? { xPostLimit } : {}),
                        postMedia: pieceMedia,
                        ...(renderedShortVideo
                            ? {
                                videoRunId: renderedShortVideo.runId,
                                videoStoryboardId: renderedShortVideo.storyboardId,
                                generatedVideoAssetId: renderedShortVideo.assetId,
                            }
                            : {}),
                        ...(platform === 'instagram' ? { instagramImageMode, instagramContentType } : {}),
                        ...(regenerationSource
                            ? {
                                regeneratedFromId: regenerationSource.fromId,
                                sourceCampaignItemId: regenerationSource.rootId,
                                regeneratedAt: Date.now(),
                            }
                            : {}),
                        localAgentId: agentId,
                        trigger: input.trigger,
                        brandVoiceUpdatedAt: product.brandVoice.updatedAt,
                    },
                });
                this.addGeneratedItem({
                    id: contentItem.id,
                    title: contentItem.title,
                    type: contentItem.type,
                    platform,
                    accountRef,
                    accountName,
                    postFormat,
                    outputFormat,
                    language,
                    status: contentItem.status,
                    provider: generated.provider,
                    content: contentItem.content,
                    media: pieceMedia,
                    createdAt: contentItem.createdAt,
                });
                counters.createdContentItems += 1;
                this.setContentProgress({
                    processedCount: counters.createdContentItems,
                    message: `Saved ${target.label} / ${language.toUpperCase()} via ${generated.provider}.`,
                });
                this.pushContentLog(`Saved ${target.label} / ${language.toUpperCase()} via ${generated.provider}.`, 'success');
            }
        }
        if (product.repoPath) {
            const changelogPath = path_1.default.join(product.repoPath, 'CHANGELOG.md');
            const changelogEntry = AppRepository_1.repository
                .listContent({ productId: product.id, status: 'pending' })
                .find((item) => item.runId === contentRunId && item.type === 'changelog');
            if (changelogEntry) {
                const header = `\n\n## ${new Date().toISOString().slice(0, 10)}\n`;
                const content = `${header}${changelogEntry.content}\n`;
                try {
                    if (fs_1.default.existsSync(changelogPath)) {
                        fs_1.default.appendFileSync(changelogPath, content, 'utf8');
                    }
                    else {
                        fs_1.default.writeFileSync(changelogPath, `# Changelog${content}`, 'utf8');
                    }
                    counters.notes.push('CHANGELOG.md updated in product repository.');
                }
                catch {
                    counters.notes.push('Failed to write CHANGELOG.md in product repository.');
                }
            }
        }
        // Note: `autoPublishEnabled` only governs the calendar's scheduled-posts sweep
        // (SchedulerService). Freshly generated pieces must stay drafts until the user
        // posts or schedules them — the old auto-publish here routed through the legacy
        // local-stub publisher and falsely stamped new drafts as published.
        this.finishContentProgress('completed', `Generated ${counters.createdContentItems} content item${counters.createdContentItems === 1 ? '' : 's'}.`, 'success');
    }
    async runPipeline2(runId, input, counters) {
        const product = AppRepository_1.repository.getProduct(input.productId);
        if (!product)
            throw new Error('Product not found');
        const payload = input.payload ?? {};
        const candidateKeywords = Array.isArray(payload.keywords)
            ? payload.keywords.filter((value) => typeof value === 'string' && value.trim().length > 0)
            : deriveKeywords(product);
        const types = [
            'page_2',
            'high_impression_low_ctr',
            'keyword_gap',
            'content_decay',
            'featured_snippet',
        ];
        const opportunities = candidateKeywords.slice(0, 8).map((keyword, index) => {
            const base = 55 + Math.round(Math.random() * 35);
            const score = Math.min(99, base + (keyword.includes(product.name.toLowerCase()) ? 4 : 0));
            const type = types[index % types.length];
            return { keyword, score, type };
        });
        for (const opportunity of opportunities) {
            const brief = await AIService_1.aiService.generate({
                type: 'seo_brief',
                product,
                context: {
                    keyword: opportunity.keyword,
                    type: opportunity.type,
                    score: opportunity.score,
                },
            });
            AppRepository_1.repository.createSeoOpportunity({
                productId: product.id,
                keyword: opportunity.keyword,
                type: opportunity.type,
                score: opportunity.score,
                brief: brief.content,
                status: 'open',
                metrics: {
                    impressions: 400 + Math.round(Math.random() * 2000),
                    clicks: 10 + Math.round(Math.random() * 300),
                    ctr: Number((Math.random() * 0.12).toFixed(3)),
                    avgPosition: 8 + Math.round(Math.random() * 20),
                },
            });
            counters.createdOpportunities += 1;
        }
        const topForContent = AppRepository_1.repository
            .listSeoOpportunities(product.id)
            .slice(0, 3);
        for (const opportunity of topForContent) {
            const generated = await AIService_1.aiService.generate({
                type: 'blog',
                product,
                context: {
                    keyword: opportunity.keyword,
                    brief: opportunity.brief,
                    trigger: input.trigger,
                    pipeline: 'P2',
                },
            });
            AppRepository_1.repository.createContent({
                productId: product.id,
                runId,
                type: 'blog',
                title: `SEO draft: ${opportunity.keyword}`,
                content: generated.content,
                status: 'pending',
                metadata: {
                    provider: generated.provider,
                    sourceOpportunityId: opportunity.id,
                    keyword: opportunity.keyword,
                },
            });
            counters.createdContentItems += 1;
        }
        counters.notes.push(`Scored ${opportunities.length} SEO opportunities and generated ${topForContent.length} drafts.`);
    }
    async runPipeline3(_runId, input, counters) {
        const product = AppRepository_1.repository.getProduct(input.productId);
        if (!product)
            throw new Error('Product not found');
        const payload = input.payload ?? {};
        const keywords = Array.isArray(payload.keywords)
            ? payload.keywords.filter((value) => typeof value === 'string' && value.trim().length > 0)
            : AppRepository_1.repository.getKeywordsForProduct(product.id);
        const finalKeywords = keywords.length ? keywords.slice(0, 12) : deriveKeywords(product).slice(0, 12);
        const today = (0, time_1.isoDay)();
        for (const keyword of finalKeywords) {
            const previous = AppRepository_1.repository.getLatestSnapshotForKeyword(product.id, keyword);
            const previousPosition = previous?.position ?? (8 + Math.round(Math.random() * 30));
            const drift = Math.round(Math.random() * 8) - 4;
            const nextPosition = Math.max(1, previousPosition + drift);
            const impressions = Math.max(20, Math.round((previous?.impressions ?? 600) * (0.8 + Math.random() * 0.4)));
            const clicks = Math.max(2, Math.round((previous?.clicks ?? 45) * (0.75 + Math.random() * 0.45)));
            const ctr = Number((clicks / impressions).toFixed(4));
            AppRepository_1.repository.createRankSnapshot({
                productId: product.id,
                keyword,
                position: nextPosition,
                clicks,
                impressions,
                ctr,
                source: 'simulated-gsc-dataforseo',
                date: today,
            });
            if (previous) {
                const delta = nextPosition - previous.position;
                if (delta > 3) {
                    const severity = delta >= 7 ? 'critical' : 'warning';
                    AppRepository_1.repository.createRankAlert({
                        productId: product.id,
                        keyword,
                        oldPosition: previous.position,
                        newPosition: nextPosition,
                        delta,
                        severity,
                        message: `${keyword} dropped by ${delta} positions (${previous.position} → ${nextPosition}).`,
                    });
                    counters.generatedAlerts += 1;
                }
                const clickDrop = previous.clicks > 0 ? (previous.clicks - clicks) / previous.clicks : 0;
                if (clickDrop > 0.2) {
                    AppRepository_1.repository.createRankAlert({
                        productId: product.id,
                        keyword,
                        oldPosition: previous.position,
                        newPosition: nextPosition,
                        delta: nextPosition - previous.position,
                        severity: 'warning',
                        message: `${keyword} clicks dropped ${(clickDrop * 100).toFixed(1)}% week-on-week.`,
                    });
                    counters.generatedAlerts += 1;
                }
            }
        }
        counters.notes.push(`Captured ${finalKeywords.length} keyword snapshots for ${today}.`);
    }
    async runPipeline4(runId, input, counters) {
        const product = AppRepository_1.repository.getProduct(input.productId);
        if (!product)
            throw new Error('Product not found');
        const payload = input.payload ?? {};
        const limit = typeof payload.limit === 'number' ? Math.max(1, Math.min(120, payload.limit)) : 50;
        const directories = AppRepository_1.repository.listDirectories(true).slice(0, limit);
        const manualEntries = [];
        for (const directory of directories) {
            const existing = AppRepository_1.repository.findSubmissionByProductAndDirectory(product.id, directory.id);
            if (existing)
                continue;
            let status = directory.method === 'manual_export' ? 'pending' : 'submitted';
            let submittedAt = status === 'submitted' ? Date.now() : null;
            let listedAt = null;
            let listingUrl = null;
            if (status === 'submitted' && Math.random() < 0.14) {
                status = 'pending';
            }
            if (Math.random() < 0.08) {
                status = 'listed';
                listedAt = Date.now();
                listingUrl = `${directory.url.replace(/\/$/, '')}/${encodeURIComponent(product.name.toLowerCase().replace(/\s+/g, '-'))}`;
            }
            const created = AppRepository_1.repository.createDirectorySubmission({
                productId: product.id,
                directoryId: directory.id,
                directoryName: directory.name,
                method: directory.method,
                status,
                submittedAt,
                listedAt,
                listingUrl,
                backlinkScore: directory.da,
                metadata: {
                    trigger: input.trigger,
                    autoSubmitted: directory.method !== 'manual_export',
                    runId,
                },
            });
            counters.createdSubmissions += 1;
            if (directory.method === 'manual_export') {
                manualEntries.push({
                    directory: directory.name,
                    url: directory.url,
                    payload: {
                        productName: product.name,
                        productUrl: product.url,
                        tagline: product.tagline,
                        shortDescription: product.shortDescription,
                        longDescription: product.longDescription,
                        categories: product.categories,
                        tags: product.tags,
                        competitors: product.competitors,
                    },
                    submissionId: created.id,
                });
            }
            if (status === 'listed') {
                AppRepository_1.repository.createContent({
                    productId: product.id,
                    runId,
                    type: 'tweet_thread',
                    title: `Directory listing live: ${directory.name}`,
                    content: `We just went live on ${directory.name}.\n\nListing: ${listingUrl}\n\nThanks for checking out ${product.name}.`,
                    status: 'pending',
                    metadata: {
                        celebration: true,
                        directory: directory.name,
                        listingUrl,
                    },
                });
                counters.createdContentItems += 1;
            }
        }
        if (manualEntries.length) {
            const filePath = path_1.default.join(exportFolder(), `${Date.now()}-${product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-manual-export.json`);
            fs_1.default.writeFileSync(filePath, JSON.stringify({
                product: {
                    id: product.id,
                    name: product.name,
                    url: product.url,
                    tagline: product.tagline,
                },
                generatedAt: new Date().toISOString(),
                entries: manualEntries,
            }, null, 2), 'utf8');
            counters.notes.push(`Manual export written: ${filePath}`);
        }
        counters.notes.push(`Processed ${directories.length} directories.`);
    }
    async regenerateContent(contentId, rawOptions = {}, onProgress) {
        const existing = AppRepository_1.repository.getContentById(contentId);
        if (!existing)
            return null;
        const product = AppRepository_1.repository.getProduct(existing.productId);
        if (!product)
            return null;
        let progress = {
            contentId,
            status: 'running',
            message: 'Preparing content regeneration...',
            logs: [],
            draft: '',
            updatedAt: Date.now(),
        };
        const emitProgress = (update = {}) => {
            progress = { ...progress, ...update, updatedAt: Date.now() };
            onProgress?.({ ...progress, logs: [...progress.logs] });
        };
        const pushLog = (message, level = 'info', kind, meta) => {
            progress = {
                ...progress,
                message,
                logs: [
                    ...progress.logs,
                    {
                        time: Date.now(),
                        message,
                        level,
                        ...(kind ? { kind } : {}),
                        ...(meta?.phase ? { phase: meta.phase } : {}),
                        ...(meta?.detail ? { detail: meta.detail } : {}),
                        ...(meta?.sites?.length ? { sites: meta.sites } : {}),
                    },
                ].slice(-60),
                updatedAt: Date.now(),
            };
            onProgress?.({ ...progress, logs: [...progress.logs] });
        };
        emitProgress();
        pushLog('Loaded the current content and campaign context.');
        const options = {
            postType: rawOptions.postType === 'image' || rawOptions.postType === 'video' ? rawOptions.postType : undefined,
            imageMode: rawOptions.imageMode === 'reuse' || rawOptions.imageMode === 'generate' ? rawOptions.imageMode : undefined,
            prompt: typeof rawOptions.prompt === 'string' && rawOptions.prompt.trim()
                ? rawOptions.prompt.trim().slice(0, 4_000)
                : undefined,
            agentId: typeof rawOptions.agentId === 'string'
                ? rawOptions.agentId.trim() || null
                : rawOptions.agentId === null
                    ? null
                    : undefined,
        };
        const storedPlatform = isSocialPlatform(existing.metadata.platform) ? existing.metadata.platform : null;
        const platform = storedPlatform ?? (existing.type === 'tweet_thread' ? 'twitter' : null);
        const accountRef = typeof existing.metadata.targetAccountRef === 'string' ? existing.metadata.targetAccountRef : null;
        const accountName = typeof existing.metadata.targetAccountName === 'string' ? existing.metadata.targetAccountName : null;
        const accountPostFormat = existing.metadata.accountPostFormat;
        const postFormat = accountPostFormat === 'text' || accountPostFormat === 'image' || accountPostFormat === 'text_image'
            ? accountPostFormat
            : null;
        const storedOutputFormat = existing.metadata.outputFormat;
        const outputFormat = isCampaignOutputFormat(storedOutputFormat)
            ? storedOutputFormat
            : platform
                ? (0, registry_1.suggestedOutputFormatForPlatform)(platform)
                : 'markdown';
        const formatRequested = Boolean(options.postType);
        const postType = options.postType ?? currentPostType(existing);
        const type = formatRequested ? regeneratedContentType(existing, platform, postType) : existing.type;
        const xPostLimit = generatedXPostLimit(type, platform, existing.metadata.xPostLimit);
        const target = {
            type,
            platform,
            label: platform ? PLATFORM_LABELS[platform] : type,
            accountRef,
            accountName,
            postFormat,
            outputFormat,
            languages: null,
        };
        const campaignMedia = campaignMediaFor(existing);
        const campaignImages = campaignMedia.filter(isImagePostMedia);
        const imageMode = formatRequested && postType === 'image' && options.imageMode === 'reuse' && campaignImages.length
            ? 'reuse'
            : 'generate';
        // The provider stored on the original piece is generation provenance. A new
        // rewrite follows the current global route unless this request explicitly
        // supplies a per-rewrite override.
        const selectedAgentId = options.agentId ?? null;
        try {
            pushLog(options.prompt ? 'Applying the adjustment prompt to a new version.' : 'Creating a fresh variation.');
            pushLog(selectedAgentId ? `Using the ${selectedAgentId} CLI for this rewrite.` : 'Using automatic AI routing for this rewrite.');
            const webSearch = rawOptions.webSearch === true;
            if (webSearch) {
                pushLog('Web search is ON for this rewrite.', 'info', 'websearch');
            }
            let generated = await AIService_1.aiService.generate({
                type,
                product,
                agentId: selectedAgentId,
                webSearch,
                onLog: (message, level, kind, meta) => pushLog(message, level, kind, meta),
                onToken: (chunk) => emitProgress({
                    draft: (0, generatedContent_1.sanitizeGeneratedContent)(`${progress.draft}${chunk}`),
                    message: 'Writing the new version...',
                }),
                context: {
                    ...existing.metadata,
                    targetPlatform: platform,
                    targetPlatformLabel: target.label,
                    ...(formatRequested ? { postType } : {}),
                    ...(formatRequested && platform === 'instagram' ? { instagramContentType: postType } : {}),
                    previousContent: existing.content,
                    regenerationMode: 'additive',
                    webSearch,
                    ...(xPostLimit !== null ? { xPostLimit } : {}),
                    ...(options.prompt ? { regenerationPrompt: options.prompt } : {}),
                },
            });
            if (xPostLimit !== null) {
                const fitted = (0, generatedContent_1.fitGeneratedXPost)(generated.content, xPostLimit);
                if (fitted.shortened) {
                    generated = { ...generated, content: fitted.content };
                    pushLog(`Shortened the X post to the ${xPostLimit.toLocaleString()}-character limit.`, 'success');
                }
            }
            emitProgress({ draft: generated.content, message: 'AI content is ready.' });
            let pieceMedia = campaignMedia;
            let renderedShortVideo = null;
            if (formatRequested && postType === 'image') {
                pieceMedia = campaignImages;
                if (imageMode === 'generate') {
                    pushLog('Generating a branded image for the new version.');
                    const language = typeof existing.metadata.language === 'string' && existing.metadata.language.trim()
                        ? existing.metadata.language.trim()
                        : 'en';
                    const { asset } = await DesignService_1.designService.generateSocialImage({
                        productId: product.id,
                        prompt: socialImagePrompt(generated.content, language, languageName(language)),
                        fallbackHeadline: generated.content,
                        format: 'social_square',
                        agentId: selectedAgentId,
                    });
                    const imagePath = asset.localPath ?? asset.publicUrl;
                    if (!imagePath)
                        throw new Error('Generated image did not return a local path.');
                    pieceMedia = [{ path: imagePath, type: asset.mimeType }];
                    pushLog('Branded image generated.', 'success');
                }
            }
            if (type === 'video_short') {
                pushLog('Storyboarding and rendering a new local MP4 for this version.');
                const sourceTitle = typeof existing.metadata.sourceTitle === 'string' && existing.metadata.sourceTitle.trim()
                    ? existing.metadata.sourceTitle.trim()
                    : existing.title;
                const sourceText = typeof existing.metadata.sourceText === 'string' && existing.metadata.sourceText.trim()
                    ? existing.metadata.sourceText.trim()
                    : typeof existing.metadata.featureSummary === 'string'
                        ? existing.metadata.featureSummary
                        : existing.content;
                const language = typeof existing.metadata.language === 'string' && existing.metadata.language.trim()
                    ? existing.metadata.language.trim()
                    : 'en';
                renderedShortVideo = await renderCampaignShortVideo({
                    product,
                    sourceTitle,
                    sourceText,
                    generatedCopy: generated.content,
                    targetLabel: target.label,
                    language,
                    agentId: selectedAgentId,
                    referenceMedia: campaignImages,
                    onProgress: (message, level) => pushLog(message, level),
                });
                pieceMedia = [renderedShortVideo.media];
                pushLog('Rendered and attached the new MP4.', 'success');
            }
            pushLog('Saving the new version to this campaign.');
            const rootId = typeof existing.metadata.sourceCampaignItemId === 'string'
                ? existing.metadata.sourceCampaignItemId
                : existing.id;
            const generatedAgentId = generated.provider.startsWith('local-cli:')
                ? generated.provider.slice('local-cli:'.length)
                : selectedAgentId;
            const created = AppRepository_1.repository.createContent({
                productId: existing.productId,
                runId: existing.runId,
                type,
                title: formatRequested && platform
                    ? `${product.name} ${target.label} ${postType} post`
                    : formatRequested
                        ? contentTitle(type, product.name)
                        : existing.title,
                content: generated.content,
                status: 'pending',
                metadata: {
                    ...existing.metadata,
                    provider: generated.provider,
                    localAgentId: generatedAgentId,
                    platform,
                    platformLabel: target.label,
                    ...(xPostLimit !== null ? { xPostLimit } : {}),
                    ...(formatRequested ? { postType } : {}),
                    ...(formatRequested && postType === 'image' ? { imageMode } : {}),
                    postMedia: pieceMedia,
                    ...(renderedShortVideo
                        ? {
                            videoRunId: renderedShortVideo.runId,
                            videoStoryboardId: renderedShortVideo.storyboardId,
                            generatedVideoAssetId: renderedShortVideo.assetId,
                        }
                        : {}),
                    ...(formatRequested && platform === 'instagram'
                        ? { instagramContentType: postType, instagramImageMode: postType === 'image' ? imageMode : undefined }
                        : {}),
                    regeneratedFromId: existing.id,
                    sourceCampaignItemId: rootId,
                    regeneratedAt: Date.now(),
                },
            });
            pushLog('New campaign version saved.', 'success');
            emitProgress({ status: 'completed', message: 'Generation complete.', draft: generated.content });
            return { id: created.id, provider: generated.provider };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Content regeneration failed.';
            pushLog(message, 'error');
            // A headless CLI can stream a provider error before AIService rejects the
            // final response. Keep that text in the error log, never in the draft.
            emitProgress({ status: 'failed', message, draft: '' });
            throw error;
        }
    }
}
exports.PipelineService = PipelineService;
exports.pipelineService = new PipelineService();
//# sourceMappingURL=PipelineService.js.map