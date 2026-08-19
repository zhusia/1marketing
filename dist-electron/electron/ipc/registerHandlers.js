"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHandlers = registerHandlers;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const channels_1 = require("./channels");
const zoom_1 = require("../zoom");
const AppRepository_1 = require("../services/AppRepository");
const CommentService_1 = require("../services/CommentService");
const AssetService_1 = require("../services/AssetService");
const DesignService_1 = require("../services/DesignService");
const MediaGenerationService_1 = require("../services/media-generation/MediaGenerationService");
const ConnectorService_1 = require("../services/ConnectorService");
const DashboardAggregatorService_1 = require("../services/DashboardAggregatorService");
const BackgroundTaskService_1 = require("../services/BackgroundTaskService");
const ChatService_1 = require("../services/ChatService");
const PipelineService_1 = require("../services/PipelineService");
const SyncLifecycleService_1 = require("../services/sync/SyncLifecycleService");
const PublisherService_1 = require("../services/PublisherService");
const DistributionPerformanceService_1 = require("../services/distribution-performance/DistributionPerformanceService");
const OAuthService_1 = require("../services/oauth/OAuthService");
const registry_1 = require("../services/publishers/registry");
const mediaValidation_1 = require("../services/publishers/mediaValidation");
const RankAutomationService_1 = require("../services/RankAutomationService");
const DirectorySubmissionService_1 = require("../services/DirectorySubmissionService");
const GoogleWebmasterService_1 = require("../services/GoogleWebmasterService");
const GoogleWebmasterAutomationService_1 = require("../services/GoogleWebmasterAutomationService");
const BrowserExtensionService_1 = require("../services/BrowserExtensionService");
const ProductInfoService_1 = require("../services/ProductInfoService");
const SiteLookupService_1 = require("../services/SiteLookupService");
const FirstRunAdvisorService_1 = require("../services/FirstRunAdvisorService");
const ProductImportService_1 = require("../services/ProductImportService");
const VideoSourceService_1 = require("../services/VideoSourceService");
const VideoOrchestratorService_1 = require("../services/VideoOrchestratorService");
const AIService_1 = require("../services/AIService");
const AiProviderService_1 = require("../services/AiProviderService");
const SeoDataService_1 = require("../services/seo/SeoDataService");
const googleSearchConsoleLinks_1 = require("../services/seo/googleSearchConsoleLinks");
const AiVisibilityService_1 = require("../services/AiVisibilityService");
const KeywordClusterService_1 = require("../services/seo/KeywordClusterService");
const IndexNowService_1 = require("../services/IndexNowService");
const SiteAuditService_1 = require("../services/seo/SiteAuditService");
const PromptExplorerService_1 = require("../services/PromptExplorerService");
const NotificationService_1 = require("../services/NotificationService");
const ReportService_1 = require("../services/ReportService");
const SkillsService_1 = require("../services/SkillsService");
const WritingStyleService_1 = require("../services/seo/WritingStyleService");
const RepurposeSourceService_1 = require("../services/RepurposeSourceService");
const FolderPipelineService_1 = require("../services/FolderPipelineService");
const StorageService_1 = require("../services/StorageService");
const BackupService_1 = require("../services/BackupService");
const LicenseService_1 = require("../services/LicenseService");
const setup_1 = require("../mcp/setup");
const userDataPath_1 = require("../utils/userDataPath");
function ok(data) {
    return { success: true, data };
}
function fail(error) {
    return { success: false, error };
}
async function handle(fn) {
    try {
        const data = await fn();
        return ok(data);
    }
    catch (error) {
        return fail(error instanceof Error ? error.message : 'Unknown error');
    }
}
function zipDownloadName(value) {
    const requested = typeof value === 'string' ? value.trim() : '';
    const fileName = path_1.default.basename(requested || 'campaign-media.zip');
    const withoutExtension = fileName.toLowerCase().endsWith('.zip') ? fileName.slice(0, -4) : fileName;
    const base = withoutExtension
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120)
        .replace(/[.-]+$/g, '') || 'campaign-media';
    return `${base}.zip`;
}
function formatLicenseError(error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (lower.includes('license_key not found') || lower.includes('license key not found')) {
        return 'Your license key is not valid. Please check and try again.';
    }
    if (lower.includes('license key is required')) {
        return 'Please enter a license key to continue.';
    }
    if (lower.includes('activation limit')) {
        return 'This license has reached its device limit. Deactivate it on another device first.';
    }
    if (lower.includes('product mismatch') || lower.includes('variant mismatch') || lower.includes('store mismatch')) {
        return 'This license key is not for 1MarketingTool.';
    }
    if (lower.includes('network') || lower.includes('fetch') || lower.includes('connection')) {
        return 'Unable to connect to the license server. Check your internet connection and try again.';
    }
    if (lower.includes('expired')) {
        return 'Your update eligibility has expired. Pro features remain available in this version.';
    }
    return message;
}
async function handleLicense(fn) {
    try {
        const data = await fn();
        return ok(data);
    }
    catch (error) {
        return fail(formatLicenseError(error));
    }
}
let licenseForwarderRegistered = false;
let syncForwarderRegistered = false;
function exportManualPayload(productId) {
    const product = AppRepository_1.repository.getProduct(productId);
    if (!product) {
        throw new Error('Product not found.');
    }
    const manualDirectories = AppRepository_1.repository.listDirectories(true).filter((dir) => dir.method === 'manual_export');
    const folder = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), 'directory-exports');
    fs_1.default.mkdirSync(folder, { recursive: true });
    const filePath = path_1.default.join(folder, `${Date.now()}-${product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-manual-only-export.json`);
    const payload = {
        product: {
            id: product.id,
            name: product.name,
            url: product.url,
            tagline: product.tagline,
            shortDescription: product.shortDescription,
            mediumDescription: product.mediumDescription,
            longDescription: product.longDescription,
            categories: product.categories,
            tags: product.tags,
            pricingModel: product.pricingModel,
            platforms: product.platforms,
            competitors: product.competitors,
        },
        generatedAt: new Date().toISOString(),
        entries: manualDirectories.map((directory) => ({
            id: directory.id,
            name: directory.name,
            url: directory.url,
            da: directory.da,
            method: directory.method,
        })),
    };
    fs_1.default.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { filePath, count: manualDirectories.length };
}
/** Write a saved site audit's full report to a timestamped JSON file and reveal it. */
function exportSiteAuditReport(runId) {
    const detail = SiteAuditService_1.siteAuditService.getRunDetail(runId);
    if (!detail) {
        throw new Error('Audit not found.');
    }
    const folder = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), 'site-audit-exports');
    fs_1.default.mkdirSync(folder, { recursive: true });
    const startedIso = new Date(detail.run.startedAt).toISOString();
    const stamp = startedIso.replace(/[:.]/g, '-');
    const safeHost = detail.run.host.replace(/[^a-z0-9.-]+/gi, '-') || 'site';
    const filePath = path_1.default.join(folder, `${safeHost}-${stamp}.json`);
    const payload = {
        generatedAt: new Date().toISOString(),
        run: {
            ...detail.run,
            startedAtIso: startedIso,
            completedAtIso: detail.run.completedAt ? new Date(detail.run.completedAt).toISOString() : null,
        },
        issues: detail.issues,
        pages: detail.pages,
    };
    fs_1.default.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    electron_1.shell.showItemInFolder(filePath);
    return { filePath };
}
/** Pull the first balanced JSON object out of a model response (tolerates code fences and prose). */
function extractJsonObject(raw) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fenced ? fenced[1] : raw;
    const start = text.indexOf('{');
    if (start === -1)
        return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"')
            inString = true;
        else if (char === '{')
            depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0)
                return text.slice(start, i + 1);
        }
    }
    return null;
}
function clampScore(value) {
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num))
        return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
}
function toSeverity(value) {
    const normalized = String(value ?? '').toLowerCase();
    if (normalized === 'high' || normalized === 'critical')
        return 'high';
    if (normalized === 'low' || normalized === 'minor')
        return 'low';
    return 'medium';
}
async function runSeoAudit(input, hooks) {
    const title = (input.title ?? '').trim();
    const content = (input.content ?? '').trim();
    if (!content) {
        throw new Error('There is no content to audit yet.');
    }
    const product = input.productId ? AppRepository_1.repository.getProduct(input.productId) : null;
    hooks?.onLog?.('Preparing the draft for analysis...');
    // Cap the content we send so very long drafts stay within local-CLI / API limits.
    const contentForPrompt = content.length > 8000 ? `${content.slice(0, 8000)}\n...[truncated]` : content;
    // The review focus depends on the content type: SEO for indexable articles, platform
    // fit for social posts, and pacing/structure for video scripts. The JSON shape stays
    // identical across all three so the renderer's parsing is unchanged.
    const category = input.type === 'blog' || input.type === 'changelog'
        ? 'article'
        : input.type === 'video_short' || input.type === 'video_long'
            ? 'video'
            : 'social';
    const channelLabel = {
        linkedin: 'LinkedIn post',
        tweet_thread: 'X post',
        reddit: 'Reddit post',
        video_short: 'short-form video script',
        video_long: 'long-form video script',
        blog: 'blog post',
        changelog: 'changelog entry',
    }[input.type ?? ''] ?? 'marketing piece';
    const jsonShape = [
        'JSON shape:',
        '{',
        '  "score": <integer 0-100>,',
        '  "summary": "<one or two sentence verdict>",',
        '  "metaDescription": "<see instructions; use \\"\\" when not applicable>",',
        '  "keywords": ["<keyword or hashtag>", "..."],',
        '  "suggestions": [{ "title": "<short fix>", "detail": "<why + how>", "severity": "high|medium|low" }]',
        '}',
    ].join('\n');
    let head;
    if (category === 'article') {
        head = [
            'You are a meticulous technical SEO editor. Audit the article below and reply with STRICT JSON only.',
            'Do not include any prose outside the JSON. Do not wrap the JSON in code fences.',
            jsonShape,
            'score = overall SEO quality. metaDescription = a compelling 150-160 char meta description. keywords = the primary + secondary keywords the piece should target.',
            'Give 3-6 concrete, prioritized suggestions focused on search intent, keyword coverage, structure (headings), readability, internal linking and meta.',
        ];
    }
    else if (category === 'video') {
        head = [
            `You are an expert video script editor. Audit the ${channelLabel} below and reply with STRICT JSON only.`,
            'Do not include any prose outside the JSON. Do not wrap the JSON in code fences.',
            jsonShape,
            'score = overall quality for spoken video (hook, pacing, structure, clarity). metaDescription = "" (not used). keywords = 3-6 relevant topic tags.',
            'Give 3-6 concrete, prioritized suggestions focused on a hook in the first few seconds, pacing, a clear intro/body/outro structure, spoken-friendly phrasing, and a strong closing call to action.',
        ];
    }
    else {
        head = [
            `You are an expert social media editor. Audit the ${channelLabel} below and reply with STRICT JSON only.`,
            'Do not include any prose outside the JSON. Do not wrap the JSON in code fences.',
            jsonShape,
            `score = overall quality for ${channelLabel} (hook, clarity, engagement potential, platform fit). metaDescription = "" (not used for social). keywords = 3-6 relevant hashtags or keywords without the # symbol.`,
            'Give 3-6 concrete, prioritized suggestions focused on a scroll-stopping hook, concision and clarity, scannability (line breaks), an explicit call to action, sensible hashtag use, and fit within the channel’s length limits.',
            input.type === 'tweet_thread'
                ? 'This is an X post: do NOT treat it as a thread. Stay under 280 characters unless the X channel is configured as Premium / Premium+.'
                : input.type === 'linkedin'
                    ? 'This is a LinkedIn post: stay under ~3000 characters and lead with a strong first line.'
                    : input.type === 'reddit'
                        ? 'This is a Reddit post: stay value-first and non-promotional, and invite discussion.'
                        : '',
        ];
    }
    const prompt = [
        ...head,
        product ? `Product: ${product.name} - ${product.tagline}` : '',
        product?.targetUser ? `Target user: ${product.targetUser}` : '',
        input.keyword ? `Intended target keyword: ${input.keyword}` : '',
        input.type ? `Content type: ${input.type}` : '',
        `Title: ${title || '(untitled)'}`,
        'Content:',
        contentForPrompt,
    ]
        .filter(Boolean)
        .join('\n\n');
    const { content: rawResponse, provider } = await AIService_1.aiService.complete(prompt, {
        conversationId: `seo-audit:${input.productId ?? 'none'}`,
        agentId: input.agentId ?? null,
        cwd: product?.repoPath ?? null,
        onLog: hooks?.onLog,
        onToken: hooks?.onToken,
    });
    hooks?.onLog?.('Parsing the AI report...');
    const jsonText = extractJsonObject(rawResponse);
    if (!jsonText) {
        throw new Error('The AI did not return a parseable SEO report. Try again or switch CLI agent.');
    }
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch {
        throw new Error('The AI returned malformed JSON. Try again or switch CLI agent.');
    }
    const suggestionsRaw = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    const suggestions = suggestionsRaw
        .map((entry) => {
        const record = (entry ?? {});
        return {
            title: String(record.title ?? '').trim(),
            detail: String(record.detail ?? record.description ?? '').trim(),
            severity: toSeverity(record.severity),
        };
    })
        .filter((suggestion) => suggestion.title || suggestion.detail);
    const keywords = Array.isArray(parsed.keywords)
        ? parsed.keywords.map((keyword) => String(keyword).trim()).filter(Boolean).slice(0, 10)
        : [];
    const metaRaw = typeof parsed.metaDescription === 'string' ? parsed.metaDescription.trim() : '';
    hooks?.onLog?.(`Report ready · score ${clampScore(parsed.score)} · ${suggestions.length} suggestion(s)`, 'success');
    return {
        score: clampScore(parsed.score),
        summary: String(parsed.summary ?? '').trim() || 'No summary returned.',
        suggestions,
        keywords,
        metaDescription: metaRaw || null,
        provider,
    };
}
function taskPayload(input) {
    return input.input ?? {};
}
function taskScopeFromPayload(payload) {
    return {
        workspaceId: typeof payload.workspaceId === 'string' ? payload.workspaceId : undefined,
        productId: typeof payload.productId === 'string' ? payload.productId : undefined,
    };
}
function dashboardSyncProgress(progress) {
    const site = progress.productName ? ` · ${progress.productName}` : '';
    let message;
    if (progress.phase === 'done') {
        message = 'Finishing dashboard sync';
    }
    else if (progress.phase === 'rank') {
        message = `Checking Domain Ratings ${progress.done}/${progress.total}`;
    }
    else {
        message = `Syncing ${progress.done}/${progress.total}${site}`;
    }
    return {
        done: progress.done,
        total: progress.total,
        label: progress.productName || undefined,
        message,
        raw: progress,
    };
}
function pageIndexTaskProgress(progress) {
    return {
        done: progress.done,
        total: progress.total,
        label: progress.currentUrl || undefined,
        message: progress.phase === 'collecting'
            ? 'Collecting URLs for page indexing'
            : progress.phase === 'done'
                ? 'Page indexing analysis complete'
                : `Inspecting ${progress.done}/${progress.total} URLs`,
        raw: progress,
    };
}
function googleRequestIndexTaskProgress(progress) {
    return {
        done: progress.done,
        total: progress.total,
        label: progress.currentUrl || undefined,
        message: progress.message,
        raw: progress,
    };
}
function indexNowTaskProgress(progress) {
    return {
        done: progress.done,
        total: progress.total,
        label: progress.url ?? undefined,
        message: progress.message || `Checking ${progress.done}/${progress.total}`,
        raw: progress,
    };
}
function designPromptTaskProgress(progress) {
    return {
        done: progress.index ?? 0,
        total: progress.total ?? 0,
        label: progress.stage,
        message: progress.message ?? progress.text ?? (progress.stage ? `Design stage: ${progress.stage}` : 'Generating design'),
        raw: progress,
    };
}
function videoTaskProgress(progress) {
    return {
        done: progress.index ?? 0,
        total: progress.total ?? 0,
        label: progress.gate ?? progress.stage ?? progress.kind,
        message: progress.message ?? (progress.kind === 'token' ? 'Authoring storyboard…' : undefined),
        raw: progress,
    };
}
function promptExplorerTaskProgress(progress) {
    return {
        done: progress.completed,
        total: progress.total || progress.models.length,
        message: progress.message,
        raw: progress,
    };
}
function writingStyleTaskProgress(progress) {
    return {
        done: progress.done,
        total: progress.total,
        message: progress.message,
        raw: progress,
    };
}
function dashboardSyncDedupeKey(request) {
    return `dashboard.googleSync:${request.workspaceId}:${JSON.stringify(request.range ?? {})}`;
}
function dashboardSyncFailureMessage(dashboard) {
    if (dashboard.totals.syncedSites > 0)
        return null;
    const errorRows = dashboard.rows.filter((row) => row.dataState === 'error');
    if (errorRows.length > 0) {
        const first = errorRows.find((row) => row.error)?.error ?? 'Google data sync failed.';
        return `Dashboard sync failed: 0/${dashboard.totals.sites} site(s) synced. ${errorRows[0].name}: ${first}`;
    }
    if (dashboard.rows.length > 0 && dashboard.unmappedCount === dashboard.rows.length) {
        return 'Dashboard sync failed: no Search Console / GA4 properties are mapped for this workspace.';
    }
    return null;
}
function startDashboardSyncTask(request, options) {
    return BackgroundTaskService_1.backgroundTaskService.run({
        kind: 'dashboard.googleSync',
        title: options?.title ?? 'Sync dashboard Google data',
        input: request,
        scope: { workspaceId: request.workspaceId },
        dedupeKey: dashboardSyncDedupeKey(request),
    }, async (context) => {
        const dashboard = await DashboardAggregatorService_1.dashboardAggregatorService.syncWorkspaceDashboard(request, (progress) => {
            options?.legacyProgress?.(progress);
            context.update(dashboardSyncProgress(progress));
        });
        const failure = dashboardSyncFailureMessage(dashboard);
        if (failure)
            throw new Error(`${failure} Open Logs > Sync for details.`);
        return dashboard;
    });
}
function failedCampaignPublishResult(message) {
    return {
        status: 'failed',
        targets: [],
        message,
    };
}
/**
 * Mirror one authored comment list onto every target of a campaign post that can actually post
 * comments. Same shape as the composer's per-target write (§13.2) — the campaign modal just has no
 * target ids to write to until this task creates them.
 */
function attachCampaignComments(post, comments) {
    const authored = (comments ?? []).filter((comment) => typeof comment?.body === 'string' && comment.body.trim());
    if (!authored.length)
        return;
    for (const target of post.targets) {
        const publisher = (0, registry_1.getPublisher)(target.connectorName);
        if (!publisher?.descriptor.comments?.supported || typeof publisher.comment !== 'function')
            continue;
        try {
            AppRepository_1.repository.replaceTargetComments(target.id, post.id, authored);
        }
        catch {
            /* a comment that cannot be stored must never stop the post itself from going out */
        }
    }
}
async function publishCampaignTaskPost(post) {
    const content = AppRepository_1.repository.getContentById(post.contentId);
    if (!content) {
        return { contentId: post.contentId, result: failedCampaignPublishResult('Content item not found.') };
    }
    const targets = Array.from(new Map(post.targets
        .filter((target) => typeof target.connectorName === 'string' && target.connectorName.trim())
        .map((target) => [target.connectorName, target])).values());
    if (!targets.length) {
        return {
            contentId: content.id,
            result: failedCampaignPublishResult('No connected channel is configured for this campaign piece.'),
        };
    }
    const scheduledPost = AppRepository_1.repository.upsertScheduledPost({
        productId: content.productId,
        contentId: content.id,
        body: post.body,
        media: Array.isArray(post.media) ? post.media : [],
        scheduledAt: null,
        timezone: post.timezone || 'UTC',
        status: 'draft',
        targets,
    });
    // Follow-ups must exist before the post publishes: publishing arms this target's comments, and a
    // row written afterwards would sit unarmed until the next sweep rediscovers it.
    attachCampaignComments(scheduledPost, post.comments);
    const publishedPost = await PublisherService_1.publisherService.publishScheduledPostNow(scheduledPost.id);
    const publishedTargets = publishedPost?.targets.filter((target) => target.status === 'published') ?? [];
    const targetResults = publishedPost?.targets.map((target) => ({
        connectorName: target.connectorName,
        status: target.status,
        publishedUrl: target.publishedUrl,
        error: target.error,
    })) ?? [];
    if (publishedPost && publishedTargets.length > 0) {
        const previousPublishedChannels = Array.isArray(content.metadata.publishedChannels)
            ? content.metadata.publishedChannels.filter((channel) => typeof channel === 'string')
            : [];
        const publishedUrlsByChannel = new Map();
        if (Array.isArray(content.metadata.publishedUrls)) {
            for (const value of content.metadata.publishedUrls) {
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    continue;
                const record = value;
                if (typeof record.connectorName !== 'string' || typeof record.url !== 'string')
                    continue;
                publishedUrlsByChannel.set(record.connectorName, {
                    connectorName: record.connectorName,
                    url: record.url,
                });
            }
        }
        for (const target of publishedTargets) {
            if (!target.publishedUrl)
                continue;
            publishedUrlsByChannel.set(target.connectorName, {
                connectorName: target.connectorName,
                url: target.publishedUrl,
            });
        }
        AppRepository_1.repository.updateContent({
            id: content.id,
            status: publishedPost.status === 'published' ? 'published' : content.status,
            publishedAt: Date.now(),
            metadata: {
                ...content.metadata,
                publishedChannels: Array.from(new Set([...previousPublishedChannels, ...publishedTargets.map((target) => target.connectorName)])),
                publishedUrls: Array.from(publishedUrlsByChannel.values()),
                skippedChannels: targetResults
                    .filter((target) => target.status === 'skipped' || target.status === 'failed')
                    .map((target) => target.connectorName),
                scheduledPostId: publishedPost.id,
            },
        });
    }
    const publishedCount = targetResults.filter((target) => target.status === 'published').length;
    const firstError = targetResults.find((target) => target.error)?.error;
    return {
        contentId: content.id,
        result: {
            status: publishedPost?.status === 'published' ? 'published' : publishedCount > 0 ? 'partial' : 'failed',
            targets: targetResults,
            message: publishedCount
                ? `Posted to ${publishedCount} channel${publishedCount === 1 ? '' : 's'}.`
                : firstError ?? 'Nothing posted. Check the channel result below.',
        },
    };
}
function startBackgroundTask(input) {
    const payload = taskPayload(input);
    const title = input.title?.trim();
    const scope = input.scope ?? taskScopeFromPayload(payload);
    if (input.kind === 'dashboard.googleSync') {
        return startDashboardSyncTask(payload, { title });
    }
    if (input.kind === 'google.performanceSync') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Sync Google performance data', input: payload, scope, dedupeKey: input.dedupeKey }, () => ConnectorService_1.connectorService.testConnector('google_search_console', payload));
    }
    if (input.kind === 'google.pageIndex') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Analyze page indexing', input: payload, scope, dedupeKey: input.dedupeKey }, (context) => ConnectorService_1.connectorService.analyzePageIndex(payload, (progress) => context.update(pageIndexTaskProgress(progress))));
    }
    if (input.kind === 'google.requestIndex') {
        return BackgroundTaskService_1.backgroundTaskService.run({
            kind: input.kind,
            title: title ?? 'Request Google indexing',
            input: payload,
            scope,
            dedupeKey: input.dedupeKey,
        }, (context) => ConnectorService_1.connectorService.requestGoogleIndex(payload, (progress) => context.update(googleRequestIndexTaskProgress(progress))));
    }
    if (input.kind === 'pipeline.run') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Run content pipeline', input: payload, scope, dedupeKey: input.dedupeKey }, () => PipelineService_1.pipelineService.runPipeline(payload.pipelineType, {
            productId: String(payload.productId ?? ''),
            trigger: String(payload.trigger ?? 'manual_dashboard'),
            payload: payload.payload,
        }));
    }
    if (input.kind === 'campaign.postNow') {
        const request = payload;
        if (!Array.isArray(request.posts) || request.posts.length === 0) {
            throw new Error('Select at least one piece to post.');
        }
        return BackgroundTaskService_1.backgroundTaskService.run({
            kind: input.kind,
            title: title ?? `Post ${request.posts.length} campaign piece${request.posts.length === 1 ? '' : 's'} now`,
            input: payload,
            scope,
            dedupeKey: input.dedupeKey,
        }, async (context) => {
            const results = [];
            context.update({ done: 0, total: request.posts.length, message: 'Preparing campaign posts' });
            for (let index = 0; index < request.posts.length; index += 1) {
                if (context.signal.aborted)
                    throw new Error('Task canceled.');
                const post = request.posts[index];
                const content = AppRepository_1.repository.getContentById(post.contentId);
                let itemResult;
                try {
                    itemResult = await publishCampaignTaskPost(post);
                }
                catch (error) {
                    itemResult = {
                        contentId: post.contentId,
                        result: failedCampaignPublishResult(error instanceof Error ? error.message : 'Publishing failed before channel details were returned.'),
                    };
                }
                results.push(itemResult);
                context.update({
                    done: index + 1,
                    total: request.posts.length,
                    label: content?.title ?? post.contentId,
                    message: `Processed ${index + 1}/${request.posts.length} campaign posts`,
                    raw: { results: [...results] },
                });
            }
            return { results };
        });
    }
    if (input.kind === 'campaign.schedule') {
        const request = payload;
        if (!Array.isArray(request.posts) || request.posts.length === 0) {
            throw new Error('Select at least one piece to schedule.');
        }
        return BackgroundTaskService_1.backgroundTaskService.run({
            kind: input.kind,
            title: title ?? `Schedule ${request.posts.length} campaign post${request.posts.length === 1 ? '' : 's'}`,
            input: payload,
            scope,
            dedupeKey: input.dedupeKey,
        }, (context) => {
            const postIds = [];
            context.update({ done: 0, total: request.posts.length, message: 'Preparing campaign schedule' });
            for (let index = 0; index < request.posts.length; index += 1) {
                if (context.signal.aborted)
                    throw new Error('Task canceled.');
                const post = request.posts[index];
                const scheduled = AppRepository_1.repository.upsertScheduledPost({
                    id: post.id,
                    productId: post.productId,
                    contentId: post.contentId,
                    body: post.body,
                    media: Array.isArray(post.media) ? post.media : [],
                    scheduledAt: post.scheduledAt,
                    timezone: post.timezone || 'UTC',
                    status: 'scheduled',
                    targets: post.targets,
                });
                postIds.push(scheduled.id);
                context.update({
                    done: index + 1,
                    total: request.posts.length,
                    label: AppRepository_1.repository.getContentById(post.contentId)?.title ?? post.contentId,
                    message: `Scheduled ${index + 1}/${request.posts.length} campaign posts`,
                });
            }
            return { postIds };
        });
    }
    if (input.kind === 'content.regenerate') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Regenerate content', input: payload, scope, dedupeKey: input.dedupeKey }, (context) => PipelineService_1.pipelineService.regenerateContent(String(payload.id ?? ''), payload.options && typeof payload.options === 'object' && !Array.isArray(payload.options)
            ? payload.options
            : {}, (progress) => context.update({
            done: progress.status === 'completed' ? 1 : 0,
            total: 1,
            label: 'Regenerating content',
            message: progress.message,
            raw: progress,
        })));
    }
    if (input.kind === 'content.writeFromCluster') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Write content from keyword cluster', input: payload, scope, dedupeKey: input.dedupeKey }, () => PipelineService_1.pipelineService.writeContentForCluster(payload));
    }
    if (input.kind === 'design.generate') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Generate design inputs', input: payload, scope, dedupeKey: input.dedupeKey }, () => DesignService_1.designService.generate(payload));
    }
    if (input.kind === 'design.fromPrompt') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Generate design', input: payload, scope, dedupeKey: input.dedupeKey }, (context) => DesignService_1.designService.designFromPrompt(payload, (progress) => context.update(designPromptTaskProgress(progress))));
    }
    if (input.kind === 'design.articleImages') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Generate article images', input: payload, scope, dedupeKey: input.dedupeKey }, () => DesignService_1.designService.generateArticleImages(payload));
    }
    if (input.kind === 'design.imageGenerate') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Generate image', input: payload, scope, dedupeKey: input.dedupeKey }, () => DesignService_1.designService.generateImage(String(payload.prompt ?? ''), {
            productId: typeof payload.productId === 'string' ? payload.productId : null,
            width: typeof payload.width === 'number' ? payload.width : undefined,
            height: typeof payload.height === 'number' ? payload.height : undefined,
        }));
    }
    if (input.kind === 'design.renderVideo') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Render video', input: payload, scope, dedupeKey: input.dedupeKey }, () => DesignService_1.designService.renderVideo(payload.spec, {
            durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : undefined,
            fps: typeof payload.fps === 'number' ? payload.fps : undefined,
        }));
    }
    if (input.kind === 'indexnow.submit') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Submit IndexNow URLs', input: payload, scope, dedupeKey: input.dedupeKey }, () => IndexNowService_1.indexNowService.submitUrls(payload));
    }
    if (input.kind === 'indexnow.checkIndex') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Check IndexNow URLs', input: payload, scope, dedupeKey: input.dedupeKey }, (context) => IndexNowService_1.indexNowService.checkIndexStatus(payload, (progress) => context.update(indexNowTaskProgress(progress))));
    }
    if (input.kind === 'aiVisibility.run') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Run AI visibility tracker', input: payload, scope, dedupeKey: input.dedupeKey }, () => AiVisibilityService_1.aiVisibilityService.runTracker(String(payload.id ?? '')));
    }
    if (input.kind === 'audit.start') {
        return SiteAuditService_1.siteAuditService.startTask({
            productId: typeof payload.productId === 'string' ? payload.productId : null,
            rootUrl: String(payload.rootUrl ?? ''),
            config: payload.config,
        }, { title: title ?? 'Start site audit', scope, dedupeKey: input.dedupeKey }).task;
    }
    if (input.kind === 'promptExplorer.explore') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Explore AI prompt', input: payload, scope, dedupeKey: input.dedupeKey }, (context) => PromptExplorerService_1.promptExplorerService.explore(payload, (progress) => context.update(promptExplorerTaskProgress(progress))));
    }
    if (input.kind === 'keyword.cluster') {
        return BackgroundTaskService_1.backgroundTaskService.run({ kind: input.kind, title: title ?? 'Cluster keywords', input: payload, scope, dedupeKey: input.dedupeKey }, () => KeywordClusterService_1.keywordClusterService.cluster(payload));
    }
    throw new Error(`Unsupported background task kind: ${input.kind}`);
}
async function runTaskAndWait(task) {
    return BackgroundTaskService_1.backgroundTaskService.wait(task.id);
}
function registerHandlers() {
    if (!syncForwarderRegistered) {
        syncForwarderRegistered = true;
        SyncLifecycleService_1.syncLifecycleService.on('progress', (payload) => {
            for (const window of electron_1.BrowserWindow.getAllWindows())
                window.webContents.send(channels_1.CHANNELS.SYNC_PROGRESS, payload);
        });
        SyncLifecycleService_1.syncLifecycleService.on('status', (payload) => {
            for (const window of electron_1.BrowserWindow.getAllWindows())
                window.webContents.send(channels_1.CHANNELS.SYNC_STATUS, payload);
        });
        SyncLifecycleService_1.syncLifecycleService.on('data-changed', (payload) => {
            for (const window of electron_1.BrowserWindow.getAllWindows())
                window.webContents.send(channels_1.CHANNELS.SYNC_DATA_CHANGED, payload);
        });
    }
    if (!licenseForwarderRegistered) {
        licenseForwarderRegistered = true;
        LicenseService_1.licenseService.onChange((snapshot) => {
            for (const window of electron_1.BrowserWindow.getAllWindows()) {
                if (!window.isDestroyed()) {
                    window.webContents.send(channels_1.CHANNELS.LICENSE_CHANGED, snapshot);
                }
            }
        });
    }
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYSTEM_SELECT_FOLDER, async () => handle(async () => {
        const result = await electron_1.dialog.showOpenDialog({
            title: 'Select local repository folder',
            properties: ['openDirectory'],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { canceled: true, path: null };
        }
        return { canceled: false, path: result.filePaths[0] };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYSTEM_SELECT_FILES, async (_event, input) => handle(async () => {
        const result = await electron_1.dialog.showOpenDialog({
            title: input?.title ?? 'Select files',
            filters: input?.filters,
            properties: input?.multiSelections === false ? ['openFile'] : ['openFile', 'multiSelections'],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { canceled: true, files: [] };
        }
        return {
            canceled: false,
            files: result.filePaths.map((filePath) => {
                const stats = fs_1.default.statSync(filePath);
                return {
                    path: filePath,
                    name: path_1.default.basename(filePath),
                    size: stats.size,
                };
            }),
        };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYSTEM_OPEN_EXTERNAL, async (_event, input) => handle(async () => {
        await electron_1.shell.openExternal(input.url);
        return { opened: true };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYSTEM_REVEAL_PATH, async (_event, input) => handle(async () => {
        const target = String(input?.path ?? '').trim();
        if (!target || !path_1.default.isAbsolute(target))
            throw new Error('An absolute path is required.');
        let stats;
        try {
            stats = fs_1.default.statSync(target);
        }
        catch {
            throw new Error('That path no longer exists on this machine.');
        }
        // Only ever *open* a plain directory. Files (and macOS bundles, which are directories) are
        // revealed in the file manager instead, so this can never launch something.
        if (stats.isDirectory() && !/\.(app|bundle|pkg|dmg)$/i.test(target)) {
            const error = await electron_1.shell.openPath(target);
            if (error)
                throw new Error(error);
        }
        else {
            electron_1.shell.showItemInFolder(target);
        }
        return { revealed: true };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYSTEM_GET_ZOOM, async (event) => handle(() => ({ factor: (0, zoom_1.getZoomFactor)(event.sender) })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYSTEM_SET_ZOOM, async (event, input) => handle(() => ({ factor: (0, zoom_1.setZoomFactor)(input.factor, event.sender) })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYSTEM_STEP_ZOOM, async (event, input) => handle(() => ({ factor: (0, zoom_1.stepZoomFactor)(input.delta, event.sender) })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.TASKS_START, async (_event, input) => handle(() => startBackgroundTask(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.TASKS_WAIT, async (_event, input) => handle(() => BackgroundTaskService_1.backgroundTaskService.wait(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.TASKS_LIST, async () => handle(() => BackgroundTaskService_1.backgroundTaskService.list()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.TASKS_GET, async (_event, input) => handle(() => BackgroundTaskService_1.backgroundTaskService.get(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.TASKS_CANCEL, async (_event, input) => handle(() => BackgroundTaskService_1.backgroundTaskService.cancel(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DASHBOARD_OVERVIEW, async (_event, input) => handle(() => AppRepository_1.repository.getOverview(input?.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DASHBOARD_UNIFIED, async (_event, input) => handle(() => DashboardAggregatorService_1.dashboardAggregatorService.getWorkspaceDashboard(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DASHBOARD_UNIFIED_SYNC, async (event, input) => handle(() => runTaskAndWait(startDashboardSyncTask(input, {
        legacyProgress: (progress) => event.sender.send(channels_1.CHANNELS.DASHBOARD_UNIFIED_SYNC_PROGRESS, progress),
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DASHBOARD_REFRESH_RANKS, async (event, input) => handle(() => DashboardAggregatorService_1.dashboardAggregatorService.refreshWorkspaceRanks(input, (progress) => event.sender.send(channels_1.CHANNELS.DASHBOARD_UNIFIED_SYNC_PROGRESS, progress))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DASHBOARD_ASK, async (event, input) => handle(() => DashboardAggregatorService_1.dashboardAggregatorService.askWorkspaceDashboard(input, {
        onLog: (message, level) => event.sender.send(channels_1.CHANNELS.DASHBOARD_ASK_PROGRESS, { kind: 'log', message, tone: level ?? 'info' }),
        onToken: (chunk) => event.sender.send(channels_1.CHANNELS.DASHBOARD_ASK_PROGRESS, { kind: 'token', text: chunk }),
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CHAT_SEND, async (event, input) => handle(() => ChatService_1.chatService.send(input, {
        onLog: (message, level) => event.sender.send(channels_1.CHANNELS.CHAT_PROGRESS, { kind: 'log', message, tone: level ?? 'info' }),
        onToken: (chunk) => event.sender.send(channels_1.CHANNELS.CHAT_PROGRESS, { kind: 'token', text: chunk }),
        onAction: (action) => event.sender.send(channels_1.CHANNELS.CHAT_PROGRESS, { kind: 'action', action }),
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CHAT_RUN_ACTION, async (event, input) => handle(() => ChatService_1.chatService.runAction(input, {
        onLog: (message, level) => event.sender.send(channels_1.CHANNELS.CHAT_PROGRESS, { kind: 'log', message, tone: level ?? 'info' }),
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CHAT_LIST, async (_event, input) => handle(() => ChatService_1.chatService.list(input && 'projectId' in input ? input.projectId : undefined)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CHAT_GET, async (_event, input) => handle(() => ChatService_1.chatService.get(input.conversationId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CHAT_RENAME, async (_event, input) => handle(() => ChatService_1.chatService.rename(input.conversationId, input.title)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CHAT_DELETE, async (_event, input) => handle(() => ChatService_1.chatService.remove(input.conversationId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CHAT_CLEAR, async (_event, input) => handle(() => ChatService_1.chatService.clear(input.conversationId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.NOTIFICATIONS_LIST, async () => handle(() => NotificationService_1.notificationService.snapshot()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.NOTIFICATIONS_MARK_READ, async (_event, input) => handle(() => NotificationService_1.notificationService.markRead(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.NOTIFICATIONS_MARK_ALL_READ, async () => handle(() => NotificationService_1.notificationService.markAllRead()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.NOTIFICATIONS_REMOVE, async (_event, input) => handle(() => NotificationService_1.notificationService.remove(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.NOTIFICATIONS_CLEAR, async () => handle(() => NotificationService_1.notificationService.clear()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.NOTIFICATIONS_SET_PREFERENCES, async (_event, input) => handle(() => NotificationService_1.notificationService.setPreferences(input ?? {})));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPORTS_EXPORT, async (_event, input) => handle(() => ReportService_1.reportService.export(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listProducts(Boolean(input?.includeArchived))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_GET, async (_event, input) => handle(() => AppRepository_1.repository.getProduct(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_FETCH_INFO, async (_event, input) => handle(() => ProductInfoService_1.productInfoService.fetchInfo(input.url)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_LOOKUP_SITES, async (_event, input) => handle(() => SiteLookupService_1.siteLookupService.lookupBusinessSites(input.query)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_FIRST_RUN_RECOMMEND, async (_event, input) => handle(() => FirstRunAdvisorService_1.firstRunAdvisorService.recommend(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_CREATE, async (_event, input) => handle(() => {
        const limit = LicenseService_1.licenseService.canAddProject(AppRepository_1.repository.listProducts(false).length);
        if (!limit.allowed) {
            throw new Error(limit.reason || 'Project limit reached. Upgrade to Pro for unlimited projects.');
        }
        return AppRepository_1.repository.createProduct(input);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_UPDATE, async (_event, input) => handle(() => AppRepository_1.repository.updateProduct(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_ARCHIVE, async (_event, input) => handle(() => AppRepository_1.repository.archiveProduct(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_MOVE, async (_event, input) => handle(() => AppRepository_1.repository.moveProductsToWorkspace(input.productIds, input.workspaceId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PRODUCTS_IMPORT_GSC, async (event, input) => handle(() => {
        return ProductImportService_1.productImportService.importGscSites(input, (progress) => {
            event.sender.send(channels_1.CHANNELS.PRODUCTS_IMPORT_GSC_PROGRESS, progress);
        });
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.WORKSPACES_LIST, async () => handle(() => AppRepository_1.repository.listWorkspaces()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.WORKSPACES_CREATE, async (_event, input) => handle(() => {
        const limit = LicenseService_1.licenseService.canAddWorkspace(AppRepository_1.repository.listWorkspaces().length);
        if (!limit.allowed) {
            throw new Error(limit.reason || 'Workspace limit reached. Upgrade to Pro for unlimited workspaces.');
        }
        return AppRepository_1.repository.createWorkspace(input);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.WORKSPACES_UPDATE, async (_event, input) => handle(() => AppRepository_1.repository.updateWorkspace(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.WORKSPACES_DELETE, async (_event, input) => handle(() => AppRepository_1.repository.deleteWorkspace(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_LIST, async () => handle(() => ConnectorService_1.connectorService.listConnectors()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_UPSERT, async (_event, input) => handle(() => ConnectorService_1.connectorService.saveConnector(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_ENABLE, async (_event, input) => handle(() => ConnectorService_1.connectorService.toggleConnector(input.name, input.enabled)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_TEST, async (_event, input) => handle(() => {
        if (input.name === 'google_search_console') {
            return runTaskAndWait(startBackgroundTask({
                kind: 'google.performanceSync',
                title: 'Sync Google performance data',
                input: input.options ?? {},
                scope: { productId: input.options?.productId ?? null },
            }));
        }
        return ConnectorService_1.connectorService.testConnector(input.name, input.options);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_TEST_POST, async (_event, input) => handle(() => PublisherService_1.publisherService.sendTestPost(input.name, input.productId ?? null)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_DATAFORSEO_ACCOUNT, async () => handle(() => ConnectorService_1.connectorService.getDataForSeoAccountStatus()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_OAUTH_START, async (_event, input) => handle(() => OAuthService_1.oauthService.startAuth(input.name, Array.isArray(input.additionalScopes) ? input.additionalScopes : [])));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_OAUTH_COMPLETE, async (_event, input) => handle(() => OAuthService_1.oauthService.completeAuth(input.name, input.url)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_OAUTH_CANCEL, async (_event, input) => handle(() => OAuthService_1.oauthService.cancelAuth(input.name)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_OAUTH_OPEN, async (_event, input) => handle(() => OAuthService_1.oauthService.openAuthUrl(input.name, input.browserId ?? null)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_BROWSERS, async () => handle(() => OAuthService_1.oauthService.listBrowsers()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_OAUTH_STATUS, async (_event, input) => handle(() => OAuthService_1.oauthService.status(input.name)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_OAUTH_REVOKE, async (_event, input) => handle(() => OAuthService_1.oauthService.revoke(input.name)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_GOOGLE_SA_DELETE, async (_event, input) => handle(() => ConnectorService_1.connectorService.deleteGoogleServiceAccount(input.accountId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_ANALYZE_PAGE_INDEX, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'google.pageIndex',
        title: 'Analyze page indexing',
        input: input ?? {},
        scope: { productId: input?.productId ?? null },
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_SECRET_STATUS, async (_event, input) => handle(() => ConnectorService_1.connectorService.getSecretStatus(input.name)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_SECRET_VALUES, async (_event, input) => handle(() => ConnectorService_1.connectorService.getSecretValues(input.name, input.productId ?? null)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_PAGES, async (_event, input) => handle(() => ConnectorService_1.connectorService.listPages(input.name)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_RESTORE_PROFILE, async (_event, input) => handle(() => ConnectorService_1.connectorService.restoreConnectorProfile(input.name, input.entryId, input.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_SET_PROJECT_MAPPING, async (_event, input) => handle(() => ConnectorService_1.connectorService.setConnectorProjectMapping(input.name, input.productId, input.assigned)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_SET_PROJECT_MUTED, async (_event, input) => handle(() => ConnectorService_1.connectorService.setConnectorProjectMuted(input.name, input.productId, input.muted)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONNECTORS_SET_FACEBOOK_MAPPING, async (_event, input) => handle(() => ConnectorService_1.connectorService.setConnectorFacebookMapping(input.name, input.productId, input.mode)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LOGS_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listSyncLogs(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LOGS_CLEAR, async (_event, input) => handle(() => AppRepository_1.repository.clearSyncLogs(input?.source)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_LOGS_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listAiLogs(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_LOGS_CLEAR, async (_event, input) => handle(() => AppRepository_1.repository.clearAiLogs(input?.kind)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.API_LOGS_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listApiLogs(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.API_LOGS_COUNT, async (_event, input) => handle(() => AppRepository_1.repository.countApiLogsSince(input.provider, input.since)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.API_LOGS_CLEAR, async (_event, input) => handle(() => AppRepository_1.repository.clearApiLogs(input?.provider)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listContent(input ?? {})));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_CREATE, async (_event, input) => handle(() => PipelineService_1.pipelineService.createDraft(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_UPDATE, async (_event, input) => handle(() => AppRepository_1.repository.updateContent(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_APPROVE, async (_event, input) => handle(async () => {
        const updated = AppRepository_1.repository.updateContent({ id: input.id, status: 'approved' });
        return updated;
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_ARCHIVE, async (_event, input) => handle(() => AppRepository_1.repository.updateContent({ id: input.id, status: 'archived' })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_DELETE, async (_event, input) => handle(() => AppRepository_1.repository.deleteContent(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_BULK_DELETE, async (_event, input) => handle(() => AppRepository_1.repository.bulkDeleteContent(input.ids)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_BULK_UPDATE, async (_event, input) => handle(() => AppRepository_1.repository.bulkUpdateContentStatus(input.ids, input.patch.status)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_DUPLICATE, async (_event, input) => handle(() => AppRepository_1.repository.duplicateContent(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_REGENERATE, async (_event, input) => handle(() => {
        const existing = AppRepository_1.repository.getContentById(input.id);
        return runTaskAndWait(startBackgroundTask({
            kind: 'content.regenerate',
            title: 'Regenerate content',
            input,
            scope: { productId: existing?.productId ?? null },
        }));
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_WRITE_FROM_CLUSTER, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'content.writeFromCluster',
        title: 'Write content from keyword cluster',
        input: input,
        scope: { productId: input.productId },
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_SCHEDULE, async (_event, input) => handle(() => AppRepository_1.repository.updateContent({ id: input.id, status: 'scheduled', scheduledAt: input.scheduledAt })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_PUBLISH, async (_event, input) => handle(() => PublisherService_1.publisherService.publishContent(input.id, input.channels)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.CONTENT_PUBLISH_HISTORY, async (_event, input) => handle(() => AppRepository_1.repository.listPublishHistory(input?.contentId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listAssets(input ?? {})));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_GET, async (_event, input) => handle(() => AppRepository_1.repository.getAssetById(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_IMPORT, async (_event, input) => handle(async () => {
        const result = await electron_1.dialog.showOpenDialog({
            title: 'Add assets to library',
            filters: [{ name: 'Assets', extensions: AssetService_1.ASSET_EXTENSIONS }],
            properties: ['openFile', 'multiSelections'],
        });
        if (result.canceled || result.filePaths.length === 0)
            return [];
        return AssetService_1.assetService.importFiles(result.filePaths, input ?? {});
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_IMPORT_URL, async (_event, input) => handle(() => AssetService_1.assetService.importFromUrl(input.url, {
        productId: input.productId ?? null,
        collectionId: input.collectionId ?? null,
        title: input.title ?? null,
        tags: input.tags ?? [],
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_UPDATE, async (_event, input) => handle(() => AppRepository_1.repository.updateAsset(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_DELETE, async (_event, input) => handle(() => AssetService_1.assetService.deleteAsset(input.id, Boolean(input.removeBytes))));
    // Prompt for a save location and copy the source file there, keeping the required extension.
    const saveFileWithDialog = async (sourcePath, defaultName, mimeType) => {
        const extension = path_1.default.extname(defaultName).replace(/^\./, '');
        const result = await electron_1.dialog.showSaveDialog({
            title: 'Download asset',
            defaultPath: path_1.default.join(electron_1.app.getPath('downloads'), defaultName),
            filters: extension
                ? [{ name: mimeType.startsWith('video/') ? 'Video' : 'Asset', extensions: [extension] }]
                : undefined,
        });
        if (result.canceled || !result.filePath) {
            return { canceled: true, filePath: null, sizeBytes: null };
        }
        const selectedExtension = path_1.default.extname(result.filePath).toLowerCase();
        const requiredExtension = extension ? `.${extension.toLowerCase()}` : '';
        const destinationPath = requiredExtension && selectedExtension !== requiredExtension
            ? `${result.filePath}${requiredExtension}`
            : path_1.default.resolve(result.filePath);
        fs_1.default.mkdirSync(path_1.default.dirname(destinationPath), { recursive: true });
        if (path_1.default.resolve(sourcePath) !== destinationPath) {
            await fs_1.default.promises.copyFile(sourcePath, destinationPath);
        }
        const stats = await fs_1.default.promises.stat(destinationPath).catch(() => null);
        return { canceled: false, filePath: destinationPath, sizeBytes: stats?.size ?? null };
    };
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_DOWNLOAD, async (_event, input) => handle(async () => {
        const info = AssetService_1.assetService.downloadInfo(input.id);
        return saveFileWithDialog(info.sourcePath, info.defaultName, info.mimeType);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_DOWNLOAD_PATH, async (_event, input) => handle(async () => {
        const info = AssetService_1.assetService.downloadInfoForPath(input.path, input.defaultName);
        return saveFileWithDialog(info.sourcePath, info.defaultName, info.mimeType);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_DOWNLOAD_PATHS_ZIP, async (_event, input) => handle(async () => {
        if (!input || !Array.isArray(input.items)) {
            throw new Error('The media archive request is invalid.');
        }
        const entries = AssetService_1.assetService.prepareDownloadArchive(input.items);
        const defaultName = zipDownloadName(input.defaultName);
        const result = await electron_1.dialog.showSaveDialog({
            title: 'Download campaign media',
            defaultPath: path_1.default.join(electron_1.app.getPath('downloads'), defaultName),
            filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
        });
        if (result.canceled || !result.filePath) {
            return { canceled: true, filePath: null, sizeBytes: null };
        }
        const requestedPath = path_1.default.resolve(result.filePath);
        const destinationPath = path_1.default.extname(requestedPath).toLowerCase() === '.zip'
            ? requestedPath
            : `${requestedPath}.zip`;
        const saved = await AssetService_1.assetService.writeDownloadArchive(entries, destinationPath);
        return { canceled: false, ...saved };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_VALIDATE_MEDIA, async (_event, input) => handle(() => mediaValidation_1.postMediaValidationService.validate(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_DATA_URL, async (_event, input) => handle(() => AssetService_1.assetService.dataUrl(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSETS_PREVIEW_URL, async (_event, input) => handle(() => AssetService_1.assetService.previewUrl(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSET_COLLECTIONS_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listAssetCollections(input?.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSET_COLLECTIONS_UPSERT, async (_event, input) => handle(() => AppRepository_1.repository.upsertAssetCollection(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.ASSET_COLLECTIONS_DELETE, async (_event, input) => handle(() => AppRepository_1.repository.deleteAssetCollection(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_SOURCE_FETCH, async (_event, input) => handle(() => VideoSourceService_1.videoSourceService.fetch(input)));
    // --- AI Video Maker ------------------------------------------------------
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_PIPELINES_LIST, async () => handle(() => VideoOrchestratorService_1.videoOrchestratorService.listPipelines()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_RUNS_LIST, async (_event, input) => handle(() => VideoOrchestratorService_1.videoOrchestratorService.listRuns(input?.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_RUN_GET, async (_event, input) => handle(() => VideoOrchestratorService_1.videoOrchestratorService.getRun(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_STORYBOARD_WRITE, async (event, input) => handle(() => BackgroundTaskService_1.backgroundTaskService.runAndWait({
        kind: 'video.orchestrate',
        title: 'Author video storyboard',
        input,
        scope: { productId: input.productId ?? null, view: 'ai-video-maker' },
    }, (context) => {
        let runId = null;
        context.signal.addEventListener('abort', () => {
            if (runId)
                VideoOrchestratorService_1.videoOrchestratorService.cancel(runId);
        }, { once: true });
        return VideoOrchestratorService_1.videoOrchestratorService.writeStoryboard(input, (progress) => {
            if (progress.runId)
                runId = progress.runId;
            context.update(videoTaskProgress(progress));
            if (!event.sender.isDestroyed())
                event.sender.send(channels_1.CHANNELS.VIDEO_PROGRESS, progress);
        });
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_STORYBOARD_UPDATE, async (event, input) => handle(() => VideoOrchestratorService_1.videoOrchestratorService.updateStoryboard(input, (progress) => {
        if (!event.sender.isDestroyed())
            event.sender.send(channels_1.CHANNELS.VIDEO_PROGRESS, progress);
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_STORYBOARD_COMMAND, async (event, input) => handle(() => VideoOrchestratorService_1.videoOrchestratorService.applyCommand(input, (progress) => {
        if (!event.sender.isDestroyed())
            event.sender.send(channels_1.CHANNELS.VIDEO_PROGRESS, progress);
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_GATE_RESOLVE, async (event, input) => handle(() => BackgroundTaskService_1.backgroundTaskService.runAndWait({
        kind: 'video.orchestrate',
        title: `${input.action === 'reroll' ? 'Reroll' : 'Continue'} video ${input.gate}`,
        input,
        scope: { view: 'ai-video-maker' },
    }, (context) => {
        context.signal.addEventListener('abort', () => VideoOrchestratorService_1.videoOrchestratorService.cancel(input.runId), { once: true });
        return VideoOrchestratorService_1.videoOrchestratorService.resolveGate(input, (progress) => {
            context.update(videoTaskProgress(progress));
            if (!event.sender.isDestroyed())
                event.sender.send(channels_1.CHANNELS.VIDEO_PROGRESS, progress);
        });
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_COMPOSE_START, async (event, input) => handle(() => BackgroundTaskService_1.backgroundTaskService.runAndWait({
        kind: 'video.orchestrate',
        title: 'Compose video',
        input,
        scope: { view: 'ai-video-maker' },
    }, (context) => {
        context.signal.addEventListener('abort', () => VideoOrchestratorService_1.videoOrchestratorService.cancel(input.runId), { once: true });
        return VideoOrchestratorService_1.videoOrchestratorService.resolveGate({ ...input, gate: 'assets', action: 'approve' }, (progress) => {
            context.update(videoTaskProgress(progress));
            if (!event.sender.isDestroyed())
                event.sender.send(channels_1.CHANNELS.VIDEO_PROGRESS, progress);
        });
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_REVIEW_GET, async (_event, input) => handle(() => VideoOrchestratorService_1.videoOrchestratorService.getRun(input.runId)?.storyboard.review ?? null));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_RUN_CANCEL, async (_event, input) => handle(() => VideoOrchestratorService_1.videoOrchestratorService.cancel(input.runId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_RUN_DISCARD, async (_event, input) => handle(() => VideoOrchestratorService_1.videoOrchestratorService.discardRun(input.runId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.VIDEO_REVISION_RESTORE, async (_event, input) => handle(() => VideoOrchestratorService_1.videoOrchestratorService.restoreRevision(input.runId, input.revision, input.targetRevision)));
    // --- Design Studio -------------------------------------------------------
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_FORMATS, async () => handle(() => DesignService_1.designService.listFormats()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_TEMPLATES_LIST, async (_event, input) => handle(() => DesignService_1.designService.listTemplates(input?.format)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_SYSTEMS_LIST, async () => handle(() => DesignService_1.designService.listDesignSystems()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_DOCS_LIST, async (_event, input) => handle(() => DesignService_1.designService.listDocuments(input ?? {})));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_DOC_GET, async (_event, input) => handle(() => DesignService_1.designService.getDocument(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_DOC_DELETE, async (_event, input) => handle(() => DesignService_1.designService.deleteDocument(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_RENDER_PREVIEW, async (_event, spec) => handle(() => DesignService_1.designService.renderPreview(spec)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_RENDER_HTML, async (_event, spec) => handle(() => DesignService_1.designService.renderHtml(spec)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_RENDER_VIDEO, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'design.renderVideo',
        title: 'Render video',
        input: input,
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_SAVE, async (_event, spec) => handle(() => DesignService_1.designService.save(spec)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_GENERATE, async (_event, spec) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'design.generate',
        title: 'Generate design inputs',
        input: spec,
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_FROM_PROMPT, async (event, input) => handle(() => runTaskAndWait(BackgroundTaskService_1.backgroundTaskService.run({
        kind: 'design.fromPrompt',
        title: 'Generate design',
        input,
        scope: { productId: input.productId ?? null },
    }, (context) => DesignService_1.designService.designFromPrompt(input, (progress) => {
        event.sender.send(channels_1.CHANNELS.DESIGN_PROMPT_PROGRESS, progress);
        context.update(designPromptTaskProgress(progress));
    })))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_REFINE, async (event, input) => handle(() => DesignService_1.designService.refineDesign(input, (progress) => {
        event.sender.send(channels_1.CHANNELS.DESIGN_PROMPT_PROGRESS, progress);
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_ARTICLE_IMAGES, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'design.articleImages',
        title: 'Generate article images',
        input: input,
        scope: { productId: input.productId ?? null },
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_IMAGE_GENERATE, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'design.imageGenerate',
        title: 'Generate image',
        input: input,
        scope: { productId: input.productId ?? null },
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DESIGN_IMAGE_GEN_STATUS, async () => handle(async () => ({ available: await DesignService_1.designService.imageGenAvailable() })));
    // --- Model-native media generation -------------------------------------
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_GENERATION_CATALOG, async () => handle(() => MediaGenerationService_1.mediaGenerationService.catalog()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_PROVIDERS_LIST, async () => handle(() => MediaGenerationService_1.mediaGenerationService.listProfiles()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_PROVIDER_SAVE, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.saveProfile(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_PROVIDER_DELETE, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.deleteProfile(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_PROVIDER_SECRET_SAVE, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.saveSecret(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_PROVIDER_SECRET_REMOVE, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.removeSecret(input.profileId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_PROVIDER_TEST, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.testProfile(input.profileId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_GENERATION_DEFAULTS_GET, async () => handle(() => MediaGenerationService_1.mediaGenerationService.getDefaults()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_GENERATION_DEFAULTS_SET, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.setDefaults(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_GENERATION_JOBS_LIST, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.listJobs(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_GENERATION_JOB_GET, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.getJob(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_GENERATION_CREATE, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.createJob(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_GENERATION_CANCEL, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.cancelJob(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MEDIA_GENERATION_DELETE, async (_event, input) => handle(() => MediaGenerationService_1.mediaGenerationService.deleteJob(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SCHEDULE_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listScheduledPosts(input ?? {})));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SCHEDULE_GET, async (_event, input) => handle(() => AppRepository_1.repository.getScheduledPost(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SCHEDULE_UPSERT, async (_event, input) => handle(() => AppRepository_1.repository.upsertScheduledPost(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SCHEDULE_RESCHEDULE, async (_event, input) => handle(() => AppRepository_1.repository.updateScheduledPost({ id: input.id, scheduledAt: input.scheduledAt, status: 'scheduled' })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENTS_LIST_FOR_POST, async (_event, input) => handle(() => AppRepository_1.repository.getPostComments(input.postId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENTS_LIST_FOR_PRODUCT, async (_event, input) => handle(() => AppRepository_1.repository.listProductComments(input.productId, input.limit ?? 200)));
    // A comment's own log: every event it produced, not the parent post's publish history. Events are
    // tagged with commentId in metadata, so the post scope narrows the scan and the tag does the rest.
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENTS_DETAIL, async (_event, input) => handle(() => {
        const comment = AppRepository_1.repository.getCommentQueueEntry(input.commentId);
        const events = AppRepository_1.repository
            .listDistributionEvents({
            eventType: 'follow_up_comment',
            postId: comment?.postId,
            limit: 500,
        })
            .filter((item) => item.metadata?.commentId === input.commentId);
        return { comment, events };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENTS_REPLACE_FOR_TARGET, async (_event, input) => handle(() => {
        const target = AppRepository_1.repository.getPostTargetById(input.targetId);
        if (!target)
            throw new Error('That channel is no longer part of this post.');
        const postId = target.postId;
        // Any pending fire for a replaced comment must not survive the edit.
        for (const existing of AppRepository_1.repository.getTargetComments(input.targetId)) {
            CommentService_1.commentService.clearTimer(existing.id);
        }
        return AppRepository_1.repository.replaceTargetComments(input.targetId, postId, input.comments ?? []);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENTS_CANCEL, async (_event, input) => handle(() => {
        CommentService_1.commentService.clearTimer(input.id);
        return AppRepository_1.repository.updatePostComment(input.id, { status: 'skipped', nextCheckAt: null });
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENTS_PUBLISH_NOW, async (_event, input) => handle(async () => {
        const comment = AppRepository_1.repository.getPostComment(input.id);
        if (!comment)
            throw new Error('That comment no longer exists.');
        CommentService_1.commentService.clearTimer(input.id);
        // Collapse the trigger to "now" and let the normal fire path run, so ordering, idempotency,
        // and audit logging all behave exactly as they would on a scheduled fire.
        AppRepository_1.repository.updatePostComment(input.id, { trigger: { kind: 'immediate' }, nextCheckAt: null });
        await CommentService_1.commentService.runDueComments();
        return AppRepository_1.repository.getPostComment(input.id);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENTS_CAPABILITY, async (_event, input) => handle(() => CommentService_1.commentService.capability(input.connectorName)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENTS_PERMISSION_DECLINE, async (_event, input) => handle(() => {
        CommentService_1.commentService.declinePermission(input.connectorName, input.scopes ?? []);
        return CommentService_1.commentService.capability(input.connectorName);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENT_SNIPPETS_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listCommentSnippets(input.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENT_SNIPPETS_UPSERT, async (_event, input) => handle(() => AppRepository_1.repository.upsertCommentSnippet(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.COMMENT_SNIPPETS_DELETE, async (_event, input) => handle(() => {
        AppRepository_1.repository.deleteCommentSnippet(input.id);
        return true;
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SCHEDULE_CANCEL, async (_event, input) => handle(() => AppRepository_1.repository.updateScheduledPost({ id: input.id, status: 'canceled' })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SCHEDULE_DELETE, async (_event, input) => handle(() => AppRepository_1.repository.deleteScheduledPost(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SCHEDULE_PUBLISH_NOW, async (_event, input) => handle(() => PublisherService_1.publisherService.publishScheduledPostNow(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SCHEDULE_PLATFORMS, async () => handle(() => (0, registry_1.listPlatformDescriptors)()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DISTRIBUTION_HISTORY_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listDistributionEvents(input ?? {})));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_DASHBOARD, async (_event, input) => handle(() => DistributionPerformanceService_1.distributionPerformanceService.getDashboard(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_CAPABILITIES, async (_event, input) => handle(() => DistributionPerformanceService_1.distributionPerformanceService.listCapabilities({
        productIds: input?.productIds,
        from: 0,
        to: Date.now(),
    }, input?.connectorName ? [input.connectorName] : undefined)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_PERMISSION_DECISION, async (_event, input) => handle(() => DistributionPerformanceService_1.distributionPerformanceService.setPermissionDecision(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_SYNC, async (event, input) => handle(() => DistributionPerformanceService_1.distributionPerformanceService.sync(input, (progress) => {
        if (!event.sender.isDestroyed()) {
            event.sender.send(channels_1.CHANNELS.DISTRIBUTION_PERFORMANCE_SYNC_PROGRESS, progress);
        }
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_LOCAL_STATUS, async (_event, input) => handle(() => AIService_1.aiService.getLocalStatus({ force: Boolean(input?.force) })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_TEST_CONNECTION, async (_event, input) => handle(() => AIService_1.aiService.testConnection({ agentId: input?.agentId ?? null })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_GENERATE_SYSTEM_PROMPT, async (_event, input) => handle(async () => {
        const product = AppRepository_1.repository.getProduct(input.productId);
        if (!product)
            throw new Error('Product not found.');
        const result = await AIService_1.aiService.generateSystemPrompt(product, { agentId: input.agentId ?? null });
        if (!result.content.trim())
            throw new Error('The AI did not return a usable system prompt. Try again.');
        return result.content;
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_SEO_AUDIT, async (event, input) => handle(() => runSeoAudit(input, {
        onLog: (message, level) => event.sender.send(channels_1.CHANNELS.AI_SEO_AUDIT_PROGRESS, {
            kind: 'log',
            message,
            tone: level ?? 'info',
        }),
        onToken: (chunk) => event.sender.send(channels_1.CHANNELS.AI_SEO_AUDIT_PROGRESS, { kind: 'token', text: chunk }),
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_PROVIDERS_LIST, async () => handle(() => AiProviderService_1.aiProviderService.list()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_PROVIDERS_SAVE_PROFILE, async (_event, input) => handle(() => AiProviderService_1.aiProviderService.saveProfile(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_PROVIDERS_DELETE_PROFILE, async (_event, input) => handle(() => AiProviderService_1.aiProviderService.deleteProfile(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_PROVIDERS_SAVE_SECRET, async (_event, input) => handle(() => AiProviderService_1.aiProviderService.saveSecret(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_PROVIDERS_REMOVE_SECRET, async (_event, input) => handle(() => AiProviderService_1.aiProviderService.removeSecret(input.profileId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_PROVIDERS_TEST, async (_event, input) => handle(() => AiProviderService_1.aiProviderService.test(input.profileId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_PROVIDERS_GET_ACTIVE_ROUTE, async () => handle(() => AiProviderService_1.aiProviderService.getActiveRoute()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_PROVIDERS_SET_ACTIVE_ROUTE, async (_event, input) => handle(() => AiProviderService_1.aiProviderService.setActiveRoute(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SEO_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listSeoOpportunities(input?.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SEO_CREATE, async (_event, input) => handle(() => AppRepository_1.repository.createSeoOpportunity(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SEO_UPDATE_STATUS, async (_event, input) => handle(() => AppRepository_1.repository.updateSeoOpportunityStatus(input.id, input.status)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_SNAPSHOTS, async (_event, input) => handle(() => AppRepository_1.repository.listRankSnapshots(input?.productId, input?.limit ?? 250)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_ALERTS, async (_event, input) => handle(() => AppRepository_1.repository.listRankAlerts(input?.productId, input?.includeAcknowledged ?? true)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_ALERT_ACK, async (_event, input) => handle(() => AppRepository_1.repository.acknowledgeRankAlert(input.id)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DIRECTORIES_LIST, async (_event, input) => handle(() => AppRepository_1.repository.listDirectories(Boolean(input?.activeOnly))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DIRECTORIES_SUBMISSIONS, async (_event, input) => handle(() => AppRepository_1.repository.listDirectorySubmissions(input?.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DIRECTORIES_EXPORT_MANUAL, async (_event, input) => handle(() => {
        LicenseService_1.licenseService.requireImportExport('export');
        return exportManualPayload(input.productId);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DIRECTORIES_UPDATE_STATUS, async (_event, input) => handle(() => {
        if (typeof input?.id === 'string') {
            return AppRepository_1.repository.updateDirectorySubmission(input.id, input);
        }
        if (typeof input?.productId === 'string' && typeof input?.directoryId === 'string') {
            return AppRepository_1.repository.upsertDirectorySubmissionStatus(input);
        }
        throw new Error('Submission id or product/directory pair is required.');
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DIRECTORIES_RUN_ASSISTED, async (_event, input) => handle(async () => {
        if (DirectorySubmissionService_1.directorySubmissionService.isRunning()) {
            throw new Error('Directory submission is already running.');
        }
        return DirectorySubmissionService_1.directorySubmissionService.startAssisted(input.productId, input.directoryIds, input.mode ?? 'headed');
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DIRECTORIES_CONFIRM_SUBMIT, async (_event, input) => handle(() => DirectorySubmissionService_1.directorySubmissionService.confirmCurrent(Boolean(input?.approve))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.DIRECTORIES_STOP_ASSISTED, async () => handle(() => DirectorySubmissionService_1.directorySubmissionService.stop()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PIPELINES_RUN, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'pipeline.run',
        title: input.pipelineType === 'P1' ? 'Generate campaign' : 'Run content pipeline',
        input: input,
        scope: { productId: input.productId },
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PIPELINES_LIST_RUNS, async (_event, input) => handle(() => AppRepository_1.repository.listPipelineRuns(input?.productId, input?.limit ?? 50)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_DOMAIN_AUTHORITY, async (_event, input) => handle(() => AppRepository_1.repository.listDomainAuthority(input?.productId, input?.limit ?? 100)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_BULK_DOMAIN_AUTHORITY, async (_event, input) => handle(() => SeoDataService_1.seoDataService.bulkDomainAuthority(input?.domains ?? [])));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_BACKLINK_PROFILE, async (_event, input) => handle(() => SeoDataService_1.seoDataService.getBacklinkProfile(input?.domain ?? '', input?.limit, {
        refresh: input?.refresh,
        cacheOnly: input?.cacheOnly,
        productId: input?.productId,
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_CAPTURE_GSC_LINKS, async (_event, input) => handle(async () => {
        const product = input?.productId ? AppRepository_1.repository.getProduct(input.productId) : null;
        if (!product) {
            throw new Error('Select a property before capturing Search Console links.');
        }
        const capture = await GoogleWebmasterAutomationService_1.googleWebmasterAutomationService.captureProductLinks(product.id);
        const profile = (0, googleSearchConsoleLinks_1.buildBacklinkProfileFromCapture)(capture, product.url);
        if (!profile) {
            throw new Error('Search Console loaded, but no link rows were found in the captured page.');
        }
        return profile;
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_RUN_AUTOMATION, async (_event, input) => handle(async () => {
        if (RankAutomationService_1.rankAutomationService.isRunning()) {
            throw new Error('Rank automation is already running.');
        }
        void RankAutomationService_1.rankAutomationService
            .start(input.productId)
            .catch((error) => {
            console.error('[rank-automation] Run failed:', error);
        });
        return { started: true };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.RANK_RUN_BATCH, async (_event, input) => handle(async () => {
        if (RankAutomationService_1.rankAutomationService.isRunning()) {
            throw new Error('Rank automation is already running.');
        }
        void RankAutomationService_1.rankAutomationService
            .startBatch(input.targets)
            .catch((error) => {
            console.error('[rank-automation] Batch run failed:', error);
        });
        return { started: true };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.KEYWORDS_OVERVIEW, async (_event, input) => handle(() => SeoDataService_1.seoDataService.keywordOverview(input?.keywords ?? [], input?.location)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.KEYWORDS_IDEAS, async (_event, input) => handle(() => SeoDataService_1.seoDataService.keywordIdeas(input?.seed ?? '', input?.location)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.KEYWORDS_PLANNER, async (_event, input) => handle(() => SeoDataService_1.seoDataService.keywordPlanner(input?.keywords ?? [], input?.location, { refresh: input?.refresh })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.KEYWORDS_RANKED, async (_event, input) => handle(() => SeoDataService_1.seoDataService.rankedKeywords(input?.domain ?? '', input?.location)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.KEYWORDS_SERP_POSITION, async (_event, input) => handle(() => SeoDataService_1.seoDataService.serpPosition(input?.keyword ?? '', input?.domain ?? '', input?.location)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.KEYWORDS_CLUSTER, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'keyword.cluster',
        title: 'Cluster keywords',
        input: input,
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SERP_BRIEF, async (_event, input) => handle(() => SeoDataService_1.seoDataService.contentBrief(input?.keyword ?? '', input?.location, input?.source)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SERP_ANALYSIS, async (_event, input) => handle(() => SeoDataService_1.seoDataService.serpAnalysis(input?.keyword ?? '', input?.location, input?.depth, input?.source)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_VISIBILITY_LIST, async (_event, input) => handle(() => AiVisibilityService_1.aiVisibilityService.list(input?.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_VISIBILITY_GET, async (_event, input) => handle(() => AiVisibilityService_1.aiVisibilityService.getDetail(input?.id ?? '', { rangeDays: input?.rangeDays, compare: input?.compare })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_VISIBILITY_UPSERT, async (_event, input) => handle(() => AiVisibilityService_1.aiVisibilityService.upsert({
        id: input?.id,
        productId: input?.productId ?? '',
        name: input?.name,
        brandVariants: input?.brandVariants ?? [],
        engines: input?.engines ?? ['ai_overview'],
        source: input?.source ?? 'dataforseo',
        location: input?.location,
        language: input?.language,
        geoTarget: input?.geoTarget ?? null,
        scheduleDays: input?.scheduleDays,
        terms: input?.terms ?? [],
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_VISIBILITY_DELETE, async (_event, input) => handle(() => AiVisibilityService_1.aiVisibilityService.remove(input?.id ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_VISIBILITY_RUN, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'aiVisibility.run',
        title: 'Run AI visibility tracker',
        input: { id: input?.id ?? '' },
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_VISIBILITY_SNAPSHOTS, async (_event, input) => handle(() => AiVisibilityService_1.aiVisibilityService.snapshots(input?.trackerId ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_VISIBILITY_DELETE_SNAPSHOT, async (_event, input) => handle(() => AiVisibilityService_1.aiVisibilityService.deleteSnapshot(input?.id ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AI_VISIBILITY_RESPONSES, async (_event, input) => handle(() => AiVisibilityService_1.aiVisibilityService.responses(input?.trackerId ?? '', input?.snapshotId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PERFORMANCE_PAGESPEED, async (_event, input) => handle(() => ConnectorService_1.connectorService.runPageSpeed({ url: input?.url ?? '', strategy: input?.strategy, productId: input?.productId })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PERFORMANCE_SEARCH_INSIGHTS, async (_event, input) => handle(() => ConnectorService_1.connectorService.fetchSearchInsights(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_VERIFY_KEY, async (_event, input) => handle(() => IndexNowService_1.indexNowService.verifyKeyFile(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_SUBMIT, async (_event, input) => handle(() => runTaskAndWait(startBackgroundTask({
        kind: 'indexnow.submit',
        title: 'Submit IndexNow URLs',
        input: input,
        scope: { productId: input.productId ?? null },
    }))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_SITEMAP_URLS, async (_event, input) => handle(() => IndexNowService_1.indexNowService.fetchSitemapUrls(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_HISTORY, async (_event, input) => handle(() => IndexNowService_1.indexNowService.getHistory(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_CHECK_INDEX, async (event, input) => handle(() => runTaskAndWait(BackgroundTaskService_1.backgroundTaskService.run({
        kind: 'indexnow.checkIndex',
        title: 'Check IndexNow URLs',
        input: input ?? {},
        scope: { productId: input?.productId ?? null },
    }, (context) => IndexNowService_1.indexNowService.checkIndexStatus(input ?? {}, (progress) => {
        event.sender.send(channels_1.CHANNELS.INDEXNOW_CHECK_INDEX_PROGRESS, progress);
        context.update(indexNowTaskProgress(progress));
    })))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_CLEAR_HISTORY, async (_event, input) => handle(() => IndexNowService_1.indexNowService.clearHistory(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_BING_KEY_STATUS, async () => handle(() => IndexNowService_1.indexNowService.getBingKeyStatus()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_BING_KEY_GET, async () => handle(() => IndexNowService_1.indexNowService.getBingKey()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_BING_KEY_SET, async (_event, input) => handle(() => IndexNowService_1.indexNowService.setBingKey(input?.apiKey ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_BING_KEY_CHECK, async () => handle(() => IndexNowService_1.indexNowService.checkBingKey()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_GET_KEY, async (_event, input) => handle(() => IndexNowService_1.indexNowService.getStoredKey(input?.productId ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_SET_KEY, async (_event, input) => handle(() => IndexNowService_1.indexNowService.setStoredKey(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_GET_KEY_LOCATION, async (_event, input) => handle(() => IndexNowService_1.indexNowService.getStoredKeyLocation(input?.productId ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.INDEXNOW_SET_KEY_LOCATION, async (_event, input) => handle(() => IndexNowService_1.indexNowService.setStoredKeyLocation(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.GOOGLE_INDEX_HISTORY, async (_event, input) => handle(() => AppRepository_1.repository.listGoogleIndexRequests(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.GOOGLE_INDEX_CLEAR_HISTORY, async (_event, input) => handle(() => AppRepository_1.repository.clearGoogleIndexRequests(input?.productId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.GOOGLE_INDEX_INSPECT, async (_event, input) => handle(() => ConnectorService_1.connectorService.inspectIndexStatus(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.GOOGLE_INDEX_INSPECT_CACHE, async (_event, input) => handle(async () => ConnectorService_1.connectorService.getIndexStatusCache(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUDIT_START, async (_event, input) => handle(() => SiteAuditService_1.siteAuditService.start(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUDIT_CANCEL, async (_event, input) => handle(() => SiteAuditService_1.siteAuditService.cancel(input?.runId ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUDIT_GET, async (_event, input) => handle(() => SiteAuditService_1.siteAuditService.getRunDetail(input?.runId ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUDIT_LIST, async (_event, input) => handle(() => SiteAuditService_1.siteAuditService.listRuns(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUDIT_DELETE, async (_event, input) => handle(() => SiteAuditService_1.siteAuditService.deleteRun(input?.runId ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUDIT_EXPORT, async (_event, input) => handle(() => {
        LicenseService_1.licenseService.requireImportExport('export');
        return exportSiteAuditReport(input?.runId ?? '');
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PROMPT_EXPLORER_EXPLORE, async (event, input) => handle(() => runTaskAndWait(BackgroundTaskService_1.backgroundTaskService.run({
        kind: 'promptExplorer.explore',
        title: 'Explore AI prompt',
        input,
        scope: { productId: input.productId ?? null },
    }, (context) => PromptExplorerService_1.promptExplorerService.explore(input, (progress) => {
        event.sender.send(channels_1.CHANNELS.PROMPT_EXPLORER_PROGRESS, progress);
        context.update(promptExplorerTaskProgress(progress));
    })))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PROMPT_EXPLORER_LIST, async (_event, input) => handle(() => PromptExplorerService_1.promptExplorerService.list(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PROMPT_EXPLORER_GET, async (_event, input) => handle(() => PromptExplorerService_1.promptExplorerService.get(input?.runId ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.PROMPT_EXPLORER_DELETE, async (_event, input) => handle(() => PromptExplorerService_1.promptExplorerService.delete(input?.runId ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SKILLS_LIST, async () => handle(() => SkillsService_1.skillsService.list()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SKILLS_STATUS, async () => handle(() => SkillsService_1.skillsService.status()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SKILLS_INSTALL, async (_event, input) => handle(() => SkillsService_1.skillsService.install(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SKILLS_REVEAL, async (_event, input) => handle(() => SkillsService_1.skillsService.reveal(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.WRITING_STYLE_GENERATE, async (_event, input) => handle(() => 
    // Run through the task service so each analysis step streams to the modal as a
    // live log (TASKS_PROGRESS), while this handler still awaits the finished draft.
    runTaskAndWait(BackgroundTaskService_1.backgroundTaskService.run({ kind: 'writingStyle.generate', title: 'Analyze writing style', input: input ?? {} }, (context) => WritingStyleService_1.writingStyleService.generate(input ?? {}, (progress) => context.update(writingStyleTaskProgress(progress)))))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.WRITING_STYLE_SAVE, async (_event, input) => handle(() => WritingStyleService_1.writingStyleService.save(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.WRITING_STYLE_LIST, async () => handle(() => WritingStyleService_1.writingStyleService.list()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.WRITING_STYLE_DELETE, async (_event, input) => handle(() => WritingStyleService_1.writingStyleService.delete(input?.id ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_LIST_ACCOUNTS, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.listSourceAccounts(input ?? { platform: '' })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_LIST_POSTS, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.listChannelPosts(input ?? { platform: '' })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_PROBE_WATCH_URL, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.probeWatchUrl({
        url: input?.url ?? '',
        platform: input?.platform ?? null,
        limit: input?.limit,
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_FETCH_URL, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.fetchFromUrl(input ?? { url: '' })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_IMPORT_MEDIA, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.importMedia(input ?? { urls: [] })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_PIPELINES_LIST, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.listPipelines(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_PIPELINES_LOGS, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.listPipelineLogs(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_PIPELINES_SAVE, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.savePipeline(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_PIPELINES_PAUSE, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.pausePipeline(input?.id ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_PIPELINES_RUN, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.runPipeline(input?.id ?? '', { includeLatest: true })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.REPURPOSE_PIPELINES_DELETE, async (_event, input) => handle(() => RepurposeSourceService_1.repurposeSourceService.removePipeline(input?.id ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.FOLDER_PIPELINES_LIST, async (_event, input) => handle(() => FolderPipelineService_1.folderPipelineService.listPipelines(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.FOLDER_PIPELINES_SCAN, async (_event, input) => handle(() => FolderPipelineService_1.folderPipelineService.scan({
        pipelineId: input?.pipelineId ?? null,
        watchFolders: input?.watchFolders ?? [],
        fileTypes: input?.fileTypes ?? [],
        groupMode: input?.groupMode,
    })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.FOLDER_PIPELINES_SAVE, async (_event, input) => handle(() => FolderPipelineService_1.folderPipelineService.savePipeline(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.FOLDER_PIPELINES_RUN, async (_event, input) => handle(() => FolderPipelineService_1.folderPipelineService.runPipeline(input?.id ?? '', { includeLatest: true })));
    electron_1.ipcMain.handle(channels_1.CHANNELS.FOLDER_PIPELINES_DELETE, async (_event, input) => handle(() => FolderPipelineService_1.folderPipelineService.removePipeline(input?.id ?? '')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MCP_CONFIG, async () => handle(() => (0, setup_1.getMarketingMcpConfigJson)()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.MCP_CONFIGURE, async (_event, input) => handle(() => {
        if (input?.enabled === false) {
            (0, setup_1.removeMarketingMcp)();
            return { ok: true };
        }
        return (0, setup_1.setupMarketingMcp)();
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_GOOGLE_ACCOUNT, async () => handle(() => GoogleWebmasterService_1.googleWebmasterService.getSavedAccount()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_GOOGLE_LOGIN, async () => handle(() => GoogleWebmasterService_1.googleWebmasterService.openLoginWindow()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_GOOGLE_OPEN, async (_event, input) => handle(() => GoogleWebmasterService_1.googleWebmasterService.openSearchConsole(input?.domain)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_GOOGLE_SYNC, async () => handle(() => GoogleWebmasterService_1.googleWebmasterService.syncAccount()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_GOOGLE_RESET, async () => handle(() => GoogleWebmasterService_1.googleWebmasterService.resetSession()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_GOOGLE_WEBMASTER_RUN, async (_event, input) => handle(async () => {
        await BrowserExtensionService_1.browserExtensionService.runGoogleWebmasterAutomation(input.productId, input.mode ?? 'headed');
        return { started: true };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_BROWSER_EXTENSION_INFO, async () => handle(() => BrowserExtensionService_1.browserExtensionService.getInfo()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_BROWSER_EXTENSION_INSTALL, async () => handle(() => BrowserExtensionService_1.browserExtensionService.installOrUpdateExtensionFiles()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_BROWSER_CAPTURES, async (_event, input) => handle(() => BrowserExtensionService_1.browserExtensionService.listCaptures(input?.productId, input?.limit ?? 20)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.AUTOMATION_BROWSER_OPEN_EXTENSIONS, async () => handle(() => BrowserExtensionService_1.browserExtensionService.openExtensionsManager()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SETTINGS_LIST, async () => handle(() => AppRepository_1.repository.listSettings()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SETTINGS_GET, async (_event, input) => handle(() => AppRepository_1.repository.getSetting(input.key)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SETTINGS_SET, async (_event, input) => handle(() => AppRepository_1.repository.setSetting(input.key, input.value)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_GET_STATUS, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.getStatus()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_SUGGEST_FOLDERS, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.suggestFolders()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_PICK_FOLDER, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.pickFolder()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_INSPECT_TARGET, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.inspectTarget(input.targetPath)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_CREATE_FOLDER, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.createFolderSpace(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_JOIN_FOLDER, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.joinFolderSpace(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_TEST_S3, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.testS3(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_CREATE_S3, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.createS3Space(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_JOIN_S3, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.joinS3Space(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_RUN_NOW, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.runCycle('manual')));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_CANCEL, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.cancelCycle()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_SET_PAUSED, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.setPaused(Boolean(input.paused))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_DISCONNECT, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.disconnect()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LIST_TRANSPORTS, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.listTransports()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LIST_DEVICES, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.listDevices()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_RETIRE_DEVICE, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.retireDevice(input.deviceId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LIST_CONFLICTS, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.listConflicts()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_RESOLVE_CONFLICT, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.resolveConflict(input.conflictId, input.selection)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LIST_JOBS, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.listJobs(input?.limit)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_SET_BLOB_POLICY, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.setBlobPolicy(input.policy)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LIST_BLOBS, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.listBlobs()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_DOWNLOAD_BLOB, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.downloadBlob(input.blobId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_GET_DIAGNOSTICS, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.getDiagnostics()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_SET_AUTOMATION_OWNER, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.setAutomationOwner(input.deviceId, input.workspaceId)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LIST_SCOPES, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.listScopes()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_SET_SCOPE, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.setScopeEnabled(input.scopeId, Boolean(input.enabled))));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_SET_MODE, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.setSyncMode(input.mode)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_PREVIEW_CHANGES, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.previewLocalChanges()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_PUSH_CHANGES, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.pushChanges(input.selection)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_FETCH_CHANGES, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.fetchChanges()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_LIST_STAGED, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.listIncomingChanges()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_APPLY_STAGED, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.applyStagedChanges(input.operationIds)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_SKIP_STAGED, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.skipStagedChanges(input.operationIds)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_SET_DEVICE_ROLE, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.setDeviceRole(input.deviceId, input.role)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_START_NEARBY_HOST, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.startNearbyHost(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_JOIN_NEARBY, async (_event, input) => handle(() => SyncLifecycleService_1.syncLifecycleService.joinNearby(input.code)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_GET_NEARBY_PAIRING, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.getNearbyPairing()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_CONFIRM_NEARBY, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.confirmNearby()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.SYNC_CANCEL_NEARBY, async () => handle(() => SyncLifecycleService_1.syncLifecycleService.cancelNearby()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.LICENSE_GET_INFO, async () => handleLicense(() => LicenseService_1.licenseService.getLicenseInfo()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.LICENSE_GET_LIMITS, async () => handleLicense(() => LicenseService_1.licenseService.getUsageLimits()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.LICENSE_ACTIVATE, async (_event, input) => handleLicense(async () => {
        await LicenseService_1.licenseService.activateLicense(input.licenseKey);
        return {
            info: LicenseService_1.licenseService.getLicenseInfo(),
            limits: LicenseService_1.licenseService.getUsageLimits(),
        };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.LICENSE_VALIDATE, async () => handleLicense(async () => {
        const valid = await LicenseService_1.licenseService.validateLicense();
        return {
            valid,
            info: LicenseService_1.licenseService.getLicenseInfo(),
        };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.LICENSE_DEACTIVATE, async () => handleLicense(async () => {
        await LicenseService_1.licenseService.deactivateLicense();
        return {
            info: LicenseService_1.licenseService.getLicenseInfo(),
            limits: LicenseService_1.licenseService.getUsageLimits(),
        };
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.LICENSE_CAN_ADD_WORKSPACE, async (_event, input) => handleLicense(() => LicenseService_1.licenseService.canAddWorkspace(input?.currentCount ?? 0)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.LICENSE_CAN_ADD_PROJECT, async (_event, input) => handleLicense(() => LicenseService_1.licenseService.canAddProject(input?.currentCount ?? 0)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.LICENSE_CAN_USE_IMPORT_EXPORT, async () => handleLicense(() => LicenseService_1.licenseService.canUseImportExport()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.BACKUP_PREVIEW_EXPORT, async (_event, input) => handle(() => BackupService_1.backupService.previewExport(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.BACKUP_EXPORT, async (_event, input) => handle(() => {
        LicenseService_1.licenseService.requireImportExport('export');
        return BackupService_1.backupService.export(input);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.BACKUP_INSPECT_IMPORT, async () => handle(() => {
        LicenseService_1.licenseService.requireImportExport('import');
        return BackupService_1.backupService.inspectImport();
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.BACKUP_IMPORT, async (_event, input) => handle(() => {
        LicenseService_1.licenseService.requireImportExport('import');
        return BackupService_1.backupService.import(input);
    }));
    electron_1.ipcMain.handle(channels_1.CHANNELS.STORAGE_ANALYZE, async () => handle(() => StorageService_1.storageService.analyze()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.STORAGE_CLEAN, async (_event, input) => handle(() => StorageService_1.storageService.clean(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.STORAGE_SAVE_POLICY, async (_event, input) => handle(() => StorageService_1.storageService.savePolicy(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.STORAGE_PROFILES_LIST, async () => handle(() => StorageService_1.storageService.listProfiles()));
    electron_1.ipcMain.handle(channels_1.CHANNELS.STORAGE_PROFILES_UPSERT, async (_event, input) => handle(() => StorageService_1.storageService.upsertProfile(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.STORAGE_PROFILES_SECRET, async (_event, input) => handle(() => StorageService_1.storageService.saveProfileSecret(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.STORAGE_PROFILES_TEST, async (_event, input) => handle(() => StorageService_1.storageService.testProfile(input)));
    electron_1.ipcMain.handle(channels_1.CHANNELS.STORAGE_PROFILES_DELETE, async (_event, input) => handle(() => StorageService_1.storageService.deleteProfile(input)));
}
//# sourceMappingURL=registerHandlers.js.map