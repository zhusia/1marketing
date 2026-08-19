"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repository = exports.AppRepository = void 0;
const db_1 = require("../db");
const generatedContent_1 = require("../utils/generatedContent");
const json_1 = require("../utils/json");
const id_1 = require("../utils/id");
const time_1 = require("../utils/time");
const domain_1 = require("../utils/domain");
function clampVoiceDial(value) {
    return Math.max(0, Math.min(100, typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 50));
}
function stringList(value) {
    return Array.isArray(value)
        ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : [];
}
function normalizeBrandVoice(value) {
    const input = value && typeof value === 'object' ? value : {};
    return {
        casualFormal: input.casualFormal === undefined ? 55 : clampVoiceDial(input.casualFormal),
        understatedHype: input.understatedHype === undefined ? 35 : clampVoiceDial(input.understatedHype),
        plainTechnical: input.plainTechnical === undefined ? 62 : clampVoiceDial(input.plainTechnical),
        terseExpansive: input.terseExpansive === undefined ? 48 : clampVoiceDial(input.terseExpansive),
        samplePosts: stringList(input.samplePosts),
        attributes: stringList(input.attributes),
        notes: typeof input.notes === 'string' ? input.notes : '',
        updatedAt: typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) ? input.updatedAt : null,
    };
}
function mapProduct(row) {
    return {
        id: row.id,
        name: row.name,
        url: row.url,
        tagline: row.tagline,
        shortDescription: row.short_description,
        mediumDescription: row.medium_description,
        longDescription: row.long_description,
        logoUrl: row.logo_url,
        screenshotUrls: (0, json_1.safeParseJson)(row.screenshot_urls_json, []),
        demoVideoUrl: row.demo_video_url,
        categories: (0, json_1.safeParseJson)(row.categories_json, []),
        tags: (0, json_1.safeParseJson)(row.tags_json, []),
        pricingModel: row.pricing_model,
        platforms: (0, json_1.safeParseJson)(row.platforms_json, []),
        targetUser: row.target_user,
        painSolved: row.pain_solved,
        competitors: (0, json_1.safeParseJson)(row.competitors_json, []),
        seedKeywords: (0, json_1.safeParseJson)(row.seed_keywords_json, []),
        repoPath: row.repo_path,
        sourceCode: row.source_code ?? '',
        brandVoice: normalizeBrandVoice((0, json_1.safeParseJson)(row.brand_voice_json, {})),
        changelogSummary: row.changelog_summary,
        workspaceId: row.workspace_id ?? db_1.DEFAULT_WORKSPACE_ID,
        latestDomain: null,
        latestDomainRating: null,
        latestDomainUrlRating: null,
        latestDomainBacklinks: null,
        latestDomainLinkingWebsites: null,
        latestDomainSource: null,
        latestDomainCheckedAt: null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapWorkspace(row) {
    return {
        id: row.id,
        name: row.name,
        color: row.color,
        isDefault: !!row.is_default,
        sortOrder: row.sort_order,
        projectCount: row.project_count ?? 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapConnector(row) {
    return {
        id: row.id,
        name: row.name,
        enabled: !!row.enabled,
        status: row.status,
        config: (0, json_1.safeParseJson)(row.config_json, {}),
        hasSecret: !!row.has_secret,
        lastTestedAt: row.last_tested_at,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapAiProviderProfile(row) {
    return {
        id: row.id,
        provider: row.provider,
        label: row.label,
        gatewayPreset: row.gateway_preset,
        baseUrl: row.base_url,
        defaultModel: row.default_model,
        memoryModel: row.memory_model,
        maxTokens: row.max_tokens,
        headers: (0, json_1.safeParseJson)(row.headers_json, {}),
        enabled: !!row.enabled,
        useWithOpenCode: !!row.use_with_opencode,
        sortOrder: row.sort_order,
        hasSecret: false,
        status: row.last_error ? 'error' : row.last_tested_at ? 'connected' : 'not_configured',
        lastTestedAt: row.last_tested_at,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapMediaProviderProfile(row) {
    return {
        id: row.id,
        adapterId: row.adapter_id,
        label: row.label,
        baseUrl: row.base_url,
        credentialSource: row.credential_source,
        aiProviderProfileId: row.ai_provider_profile_id,
        connectorName: row.connector_name,
        environmentKey: row.environment_key,
        defaultImageModel: row.default_image_model,
        defaultVideoModel: row.default_video_model,
        headers: (0, json_1.safeParseJson)(row.headers_json, {}),
        enabled: !!row.enabled,
        sortOrder: row.sort_order,
        hasSecret: false,
        status: row.last_error ? 'error' : row.last_tested_at ? 'connected' : 'not_configured',
        virtual: false,
        lastTestedAt: row.last_tested_at,
        lastError: row.last_error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapMediaGenerationJob(row) {
    return {
        id: row.id,
        kind: row.kind,
        productId: row.product_id,
        source: row.source,
        profileId: row.profile_id,
        localAgentId: row.local_agent_id,
        providerAdapterId: row.provider_adapter_id,
        providerJobId: row.provider_job_id,
        idempotencyKey: row.idempotency_key,
        submissionAttempt: row.submission_attempt,
        parentJobId: row.parent_job_id,
        operation: row.operation,
        modelId: row.model_id,
        prompt: row.prompt,
        status: row.status,
        progress: row.progress,
        request: (0, json_1.safeParseJson)(row.request_json, {}),
        providerResponse: (0, json_1.safeParseJson)(row.provider_response_json, {}),
        errorCode: row.error_code,
        errorMessage: row.error_message,
        cancelRequestedAt: row.cancel_requested_at,
        submittedAt: row.submitted_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        outputs: [],
    };
}
function mapPipelineRun(row) {
    return {
        id: row.id,
        productId: row.product_id,
        pipelineType: row.pipeline_type,
        trigger: row.trigger,
        status: row.status,
        input: (0, json_1.safeParseJson)(row.input_json, {}),
        output: (0, json_1.safeParseJson)(row.output_json, {}),
        startedAt: row.started_at,
        completedAt: row.completed_at,
        errorMessage: row.error_message,
    };
}
function mapRepurposePipeline(row) {
    return {
        id: row.id,
        productId: row.product_id,
        name: row.name,
        kind: row.kind === 'folder' ? 'folder' : 'social',
        sourcePlatform: row.source_platform,
        sourceMode: row.source_mode === 'url' ? 'url' : 'connected',
        sourceUrl: row.source_url ?? null,
        sourceAccountId: row.source_account_id,
        sourceAccountName: row.source_account_name,
        milestoneSourceId: row.milestone_source_id ?? null,
        watchFolders: (0, json_1.safeParseJson)(row.watch_folders_json ?? '[]', []),
        fileTypes: (0, json_1.safeParseJson)(row.file_types_json ?? '[]', []),
        groupMode: row.group_mode === 'subfolder' ? 'subfolder' : 'file',
        contextNote: row.context_note ?? null,
        channelOverrides: (0, json_1.safeParseJson)(row.channel_overrides_json ?? '{}', {}),
        pollIntervalHours: row.poll_interval_hours,
        destinationPlatforms: (0, json_1.safeParseJson)(row.destination_platforms_json, []),
        language: row.language,
        contentDetail: row.content_detail,
        outputFormat: row.output_format,
        scheduleMode: row.schedule_mode,
        scheduleDelayMinutes: row.schedule_delay_minutes,
        timezone: row.timezone,
        status: row.status,
        lastRunAt: row.last_run_at,
        nextRunAt: row.next_run_at,
        lastRunStatus: row.last_run_status,
        lastError: row.last_error,
        lastSourceTitle: row.last_source_title,
        lastSourceUrl: row.last_source_url,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapRepurposePipelineLog(row) {
    return {
        id: row.id,
        pipelineId: row.pipeline_id,
        productId: row.product_id,
        pipelineName: row.pipeline_name,
        kind: row.kind === 'folder' ? 'folder' : 'social',
        sourcePlatform: row.source_platform,
        sourceAccountId: row.source_account_id,
        sourceAccountName: row.source_account_name,
        trigger: row.trigger,
        status: row.status,
        fetchedPosts: row.fetched_posts,
        processedPosts: row.processed_posts,
        generatedContentItems: row.generated_content_items,
        scheduledPosts: row.scheduled_posts,
        sourceTitle: row.source_title,
        sourceUrl: row.source_url,
        contentRunIds: (0, json_1.safeParseJson)(row.content_run_ids_json ?? '[]', []),
        errorMessage: row.error_message,
        startedAt: row.started_at,
        completedAt: row.completed_at,
    };
}
function mapAsset(row) {
    return {
        id: row.id,
        productId: row.product_id,
        collectionId: row.collection_id,
        kind: row.kind,
        mimeType: row.mime_type,
        originalName: row.original_name,
        title: row.title,
        description: row.description,
        storage: row.storage,
        managed: !!row.managed,
        localPath: row.local_path,
        profileId: row.profile_id,
        remoteBucket: row.remote_bucket,
        remoteKey: row.remote_key,
        publicUrl: row.public_url,
        sizeBytes: row.size_bytes,
        width: row.width,
        height: row.height,
        durationMs: row.duration_ms,
        checksum: row.checksum,
        syncStatus: row.sync_status,
        syncError: row.sync_error,
        tags: (0, json_1.safeParseJson)(row.tags_json, []),
        metadata: (0, json_1.safeParseJson)(row.metadata_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapAssetCollection(row) {
    return {
        id: row.id,
        productId: row.product_id,
        parentId: row.parent_id,
        name: row.name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapStorageProfile(row) {
    return {
        id: row.id,
        name: row.name,
        provider: row.provider,
        endpoint: row.endpoint,
        region: row.region,
        bucket: row.bucket,
        prefix: row.prefix,
        publicBaseUrl: row.public_base_url,
        forcePathStyle: !!row.force_path_style,
        hasSecret: !!row.has_secret,
        enabled: !!row.enabled,
        isDefault: !!row.is_default,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
const DEFAULT_DESIGN_INPUTS = {
    headline: '',
    subhead: '',
    cta: '',
    accentColor: '#6750a4',
    background: 'gradient',
};
function mapDesignDocument(row) {
    const parsed = (0, json_1.safeParseJson)(row.inputs_json, {});
    return {
        id: row.id,
        productId: row.product_id,
        title: row.title,
        format: row.format,
        templateId: row.template_id,
        width: row.width,
        height: row.height,
        inputs: { ...DEFAULT_DESIGN_INPUTS, ...parsed },
        previewAssetId: row.preview_asset_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapContent(row) {
    return {
        id: row.id,
        productId: row.product_id,
        runId: row.run_id,
        type: row.type,
        title: row.title,
        content: (0, generatedContent_1.sanitizeGeneratedContent)(row.content),
        status: row.status,
        scheduledAt: row.scheduled_at,
        publishedAt: row.published_at,
        metadata: (0, json_1.safeParseJson)(row.metadata_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapPublishHistory(row) {
    return {
        id: row.id,
        contentId: row.content_id,
        channel: row.channel,
        publishedUrl: row.published_url,
        publishedAt: row.published_at,
        response: (0, json_1.safeParseJson)(row.response_json, {}),
    };
}
function mapPostTarget(row) {
    return {
        id: row.id,
        postId: row.post_id,
        connectorName: row.connector_name,
        accountRef: row.account_ref,
        bodyOverride: row.body_override,
        firstComment: row.first_comment,
        options: (0, json_1.safeParseJson)(row.options_json, {}),
        status: row.status,
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at,
        publishedUrl: row.published_url,
        error: row.error,
        updatedAt: row.updated_at,
    };
}
const DEFAULT_TRIGGER = { kind: 'immediate' };
function mapPostComment(row) {
    return {
        id: row.id,
        targetId: row.target_id,
        postId: row.post_id,
        position: row.position,
        body: row.body,
        media: (0, json_1.safeParseJson)(row.media_json, []),
        trigger: (0, json_1.safeParseJson)(row.trigger_json, DEFAULT_TRIGGER),
        status: row.status,
        origin: row.origin,
        sourceSnippetId: row.source_snippet_id,
        artifactId: row.artifact_id,
        remoteCommentId: row.remote_comment_id,
        remoteParentId: row.remote_parent_id,
        providerMetadata: (0, json_1.safeParseJson)(row.provider_metadata_json, {}),
        publishedUrl: row.published_url,
        publishedAt: row.published_at,
        attempts: row.attempts,
        nextCheckAt: row.next_check_at,
        armedAt: row.armed_at,
        error: row.error,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapCommentSnippet(row) {
    return {
        id: row.id,
        productId: row.product_id,
        name: row.name,
        body: row.body,
        media: (0, json_1.safeParseJson)(row.media_json, []),
        trigger: (0, json_1.safeParseJson)(row.trigger_json, DEFAULT_TRIGGER),
        autoAttach: (0, json_1.safeParseJson)(row.auto_attach_json, []),
        autoPosition: row.auto_position,
        useCount: row.use_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapScheduledPost(row, targets) {
    return {
        id: row.id,
        productId: row.product_id,
        contentId: row.content_id,
        body: row.body,
        media: (0, json_1.safeParseJson)(row.media_json, []),
        scheduledAt: row.scheduled_at,
        timezone: row.timezone,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        targets,
    };
}
function mapDistributionEvent(row) {
    return {
        id: row.id,
        productId: row.product_id,
        connectorName: row.connector_name,
        eventType: row.event_type,
        status: row.status,
        postId: row.post_id,
        targetId: row.target_id,
        message: row.message,
        publishedUrl: row.published_url,
        error: row.error,
        metadata: (0, json_1.safeParseJson)(row.metadata_json, {}),
        createdAt: row.created_at,
    };
}
function mapRankSnapshot(row) {
    return {
        id: row.id,
        productId: row.product_id,
        keyword: row.keyword,
        position: row.position,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        source: row.source,
        date: row.date,
    };
}
function mapRankAlert(row) {
    return {
        id: row.id,
        productId: row.product_id,
        keyword: row.keyword,
        oldPosition: row.old_position,
        newPosition: row.new_position,
        delta: row.delta,
        severity: row.severity,
        message: row.message,
        acknowledged: !!row.acknowledged,
        createdAt: row.created_at,
    };
}
function mapDomainAuthority(row) {
    return {
        id: row.id,
        productId: row.product_id,
        domain: row.domain,
        domainRating: row.domain_rating,
        urlRating: row.url_rating,
        backlinks: row.backlinks,
        linkingWebsites: row.linking_websites,
        source: row.source,
        checkedAt: row.checked_at,
    };
}
function mapSeoOpportunity(row) {
    return {
        id: row.id,
        productId: row.product_id,
        keyword: row.keyword,
        type: row.type,
        score: row.score,
        brief: row.brief,
        status: row.status,
        metrics: (0, json_1.safeParseJson)(row.metrics_json, {}),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapDirectory(row) {
    return {
        id: row.id,
        name: row.name,
        url: row.url,
        da: row.da,
        method: row.method,
        niche: row.niche,
        category: row.category || row.niche,
        description: row.description,
        domainRating: row.domain_rating,
        urlRating: row.url_rating,
        backlinks: row.backlinks,
        backlinksDofollowPct: row.backlinks_dofollow_pct,
        referringDomains: row.referring_domains,
        referringDomainsDofollowPct: row.referring_domains_dofollow_pct,
        free: !!row.free,
        active: !!row.active,
    };
}
function mapDirectorySubmission(row) {
    return {
        id: row.id,
        productId: row.product_id,
        directoryId: row.directory_id,
        directoryName: row.directory_name,
        status: row.status,
        method: row.method,
        submittedAt: row.submitted_at,
        listedAt: row.listed_at,
        listingUrl: row.listing_url,
        rejectionReason: row.rejection_reason,
        backlinkScore: row.backlink_score,
        metadata: (0, json_1.safeParseJson)(row.metadata_json, {}),
    };
}
function mapSetting(row) {
    return {
        key: row.key,
        value: (0, json_1.safeParseJson)(row.value_json, null),
        updatedAt: row.updated_at,
    };
}
function mapNotification(row) {
    return {
        id: row.id,
        kind: row.kind,
        severity: row.severity,
        title: row.title,
        body: row.body,
        productId: row.product_id,
        workspaceId: row.workspace_id,
        route: row.route_json ? (0, json_1.safeParseJson)(row.route_json, null) : null,
        meta: (0, json_1.safeParseJson)(row.meta_json, {}),
        dedupeKey: row.dedupe_key,
        readAt: row.read_at,
        createdAt: row.created_at,
    };
}
function mapAutomationAccount(row) {
    return {
        provider: row.provider,
        email: row.email,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        profileUrl: row.profile_url,
        sessionPartition: row.session_partition,
        status: row.status,
        metadata: (0, json_1.safeParseJson)(row.metadata_json, {}),
        lastSyncedAt: row.last_synced_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapBrowserCapture(row) {
    return {
        id: row.id,
        matchedProductId: row.matched_product_id,
        source: row.source,
        hostname: row.hostname,
        url: row.url,
        title: row.title,
        pageText: row.page_text,
        metadata: (0, json_1.safeParseJson)(row.metadata_json, {}),
        createdAt: row.created_at,
    };
}
function mapSyncLog(row) {
    const details = (0, json_1.safeParseJson)(row.details_json, {});
    return {
        id: row.id,
        source: row.source,
        label: row.label,
        status: row.status ?? 'success',
        productId: row.product_id,
        summary: row.summary,
        itemsSucceeded: row.items_succeeded,
        itemsFailed: row.items_failed,
        details: {
            succeeded: Array.isArray(details.succeeded) ? details.succeeded : [],
            failed: Array.isArray(details.failed) ? details.failed : [],
            errors: Array.isArray(details.errors) ? details.errors : [],
        },
        durationMs: row.duration_ms,
        createdAt: row.created_at,
    };
}
function mapIndexNowSubmission(row) {
    return {
        id: row.id,
        batchId: row.batch_id,
        productId: row.product_id,
        host: row.host,
        url: row.url,
        endpoint: row.endpoint,
        submitStatus: row.submit_status ?? 'accepted',
        httpStatus: row.http_status,
        submittedAt: row.submitted_at,
        indexStatus: row.index_status ?? 'unknown',
        indexedAt: row.indexed_at,
        indexCheckedAt: row.index_checked_at,
        indexDetail: row.index_detail,
    };
}
function mapGoogleIndexRequest(row) {
    return {
        id: row.id,
        batchId: row.batch_id,
        productId: row.product_id,
        propertyUrl: row.property_url,
        url: row.url,
        requestType: row.request_type ?? 'URL_UPDATED',
        submitStatus: row.submit_status ?? 'submitted',
        notifyTime: row.notify_time,
        submittedAt: row.submitted_at,
        error: row.error,
    };
}
function mapGoogleIndexInspection(row) {
    return {
        url: row.url,
        verdict: row.verdict,
        coverageState: row.coverage_state,
        indexingState: row.indexing_state,
        lastCrawlTime: row.last_crawl_time,
        inspectionLink: row.inspection_link,
        checkedAt: row.checked_at,
        error: row.error ?? undefined,
        cached: true,
    };
}
function mapAiLog(row) {
    return {
        id: row.id,
        kind: row.kind ?? 'ai',
        agent: row.agent,
        tool: row.tool,
        transport: row.transport,
        status: row.status ?? 'success',
        summary: row.summary,
        detail: row.detail,
        productId: row.product_id,
        durationMs: row.duration_ms,
        exitCode: row.exit_code,
        tokens: row.tokens,
        tokensInput: row.tokens_input,
        tokensOutput: row.tokens_output,
        createdAt: row.created_at,
    };
}
function mapChatConversation(row) {
    return {
        id: row.id,
        projectId: row.project_id,
        title: row.title,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
function mapChatMessage(row) {
    return {
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        content: row.content,
        mentions: (0, json_1.safeParseJson)(row.mentions_json, []),
        actions: (0, json_1.safeParseJson)(row.actions_json, []),
        toolCalls: (0, json_1.safeParseJson)(row.tool_calls_json ?? '[]', []),
        provider: row.provider,
        createdAt: row.created_at,
    };
}
function mapApiLog(row) {
    return {
        id: row.id,
        provider: row.provider,
        method: row.method,
        path: row.path,
        status: row.status ?? 'success',
        statusCode: row.status_code,
        summary: row.summary,
        detail: row.detail,
        requestBody: row.request_body,
        responseBody: row.response_body,
        cost: row.cost,
        durationMs: row.duration_ms,
        createdAt: row.created_at,
    };
}
function mapAiTracker(row, termCount, snapshotCount) {
    return {
        id: row.id,
        productId: row.product_id,
        name: row.name,
        brandVariants: (0, json_1.safeParseJson)(row.brand_variants_json, []),
        engines: (0, json_1.safeParseJson)(row.engines_json, ['ai_overview']),
        source: row.source ?? 'dataforseo',
        location: row.location,
        language: row.language,
        geoTarget: row.geo_target,
        scheduleDays: row.schedule_days,
        lastRunAt: row.last_run_at,
        nextRunAt: row.next_run_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        termCount,
        snapshotCount,
    };
}
function mapAiTrackerTerm(row) {
    return {
        id: row.id,
        trackerId: row.tracker_id,
        term: row.term,
        tags: (0, json_1.safeParseJson)(row.tags_json, []),
        createdAt: row.created_at,
    };
}
function defaultAiProviderLabel(provider) {
    if (provider === 'anthropic')
        return 'Anthropic';
    if (provider === 'google_gemini')
        return 'Google Gemini';
    if (provider === 'azure_openai')
        return 'Azure OpenAI';
    if (provider === 'openai_compatible')
        return 'OpenAI-compatible';
    return 'OpenAI';
}
function defaultAiProviderBaseUrl(provider) {
    if (provider === 'anthropic')
        return 'https://api.anthropic.com';
    if (provider === 'google_gemini')
        return 'https://generativelanguage.googleapis.com/v1beta';
    if (provider === 'azure_openai')
        return '';
    if (provider === 'openai_compatible')
        return 'https://api.openai.com/v1';
    return 'https://api.openai.com/v1';
}
function defaultAiProviderModel(provider) {
    if (provider === 'anthropic')
        return 'claude-3-5-haiku-latest';
    if (provider === 'google_gemini')
        return 'gemini-2.5-flash';
    if (provider === 'azure_openai')
        return '';
    if (provider === 'openai_compatible')
        return 'gpt-4o-mini';
    return 'gpt-4.1-mini';
}
class AppRepository {
    db = (0, db_1.getDb)();
    listProducts(includeArchived = false) {
        const sql = includeArchived
            ? 'SELECT * FROM products ORDER BY updated_at DESC'
            : 'SELECT * FROM products WHERE archived = 0 ORDER BY updated_at DESC';
        return this.db.prepare(sql).all().map((row) => this.attachLatestDomainAuthority(mapProduct(row)));
    }
    getProduct(id) {
        const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
        return row ? this.attachLatestDomainAuthority(mapProduct(row)) : null;
    }
    createProduct(input) {
        const id = (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO products (
          id, name, url, tagline, short_description, medium_description, long_description,
          logo_url, screenshot_urls_json, demo_video_url, categories_json, tags_json,
          pricing_model, platforms_json, target_user, pain_solved, competitors_json, seed_keywords_json,
          repo_path, source_code, brand_voice_json, changelog_summary, workspace_id, created_at, updated_at
        ) VALUES (
          @id, @name, @url, @tagline, @shortDescription, @mediumDescription, @longDescription,
          @logoUrl, @screenshotUrlsJson, @demoVideoUrl, @categoriesJson, @tagsJson,
          @pricingModel, @platformsJson, @targetUser, @painSolved, @competitorsJson, @seedKeywordsJson,
          @repoPath, @sourceCode, @brandVoiceJson, @changelogSummary, @workspaceId, @createdAt, @updatedAt
        )
      `)
            .run({
            id,
            name: input.name,
            url: input.url,
            tagline: input.tagline,
            shortDescription: input.shortDescription,
            mediumDescription: input.mediumDescription,
            longDescription: input.longDescription,
            logoUrl: input.logoUrl ?? null,
            screenshotUrlsJson: (0, json_1.safeStringify)(input.screenshotUrls ?? []),
            demoVideoUrl: input.demoVideoUrl ?? null,
            categoriesJson: (0, json_1.safeStringify)(input.categories ?? []),
            tagsJson: (0, json_1.safeStringify)(input.tags ?? []),
            pricingModel: input.pricingModel ?? 'subscription',
            platformsJson: (0, json_1.safeStringify)(input.platforms ?? ['web']),
            targetUser: input.targetUser ?? '',
            painSolved: input.painSolved ?? '',
            competitorsJson: (0, json_1.safeStringify)(input.competitors ?? []),
            seedKeywordsJson: (0, json_1.safeStringify)(input.seedKeywords ?? []),
            repoPath: input.repoPath ?? null,
            sourceCode: input.sourceCode ?? '',
            brandVoiceJson: (0, json_1.safeStringify)(normalizeBrandVoice(input.brandVoice)),
            changelogSummary: input.changelogSummary ?? null,
            workspaceId: input.workspaceId ?? db_1.DEFAULT_WORKSPACE_ID,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        return this.getProduct(id);
    }
    updateProduct(input) {
        const existing = this.getProduct(input.id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            name: input.name ?? existing.name,
            url: input.url ?? existing.url,
            tagline: input.tagline ?? existing.tagline,
            shortDescription: input.shortDescription ?? existing.shortDescription,
            mediumDescription: input.mediumDescription ?? existing.mediumDescription,
            longDescription: input.longDescription ?? existing.longDescription,
            logoUrl: input.logoUrl ?? existing.logoUrl,
            screenshotUrls: input.screenshotUrls ?? existing.screenshotUrls,
            demoVideoUrl: input.demoVideoUrl ?? existing.demoVideoUrl,
            categories: input.categories ?? existing.categories,
            tags: input.tags ?? existing.tags,
            pricingModel: input.pricingModel ?? existing.pricingModel,
            platforms: input.platforms ?? existing.platforms,
            targetUser: input.targetUser ?? existing.targetUser,
            painSolved: input.painSolved ?? existing.painSolved,
            competitors: input.competitors ?? existing.competitors,
            seedKeywords: input.seedKeywords ?? existing.seedKeywords,
            repoPath: input.repoPath ?? existing.repoPath,
            sourceCode: input.sourceCode ?? existing.sourceCode,
            brandVoice: input.brandVoice ? normalizeBrandVoice(input.brandVoice) : existing.brandVoice,
            changelogSummary: input.changelogSummary ?? existing.changelogSummary,
            workspaceId: input.workspaceId ?? existing.workspaceId,
            updatedAt: (0, time_1.now)(),
        };
        this.db
            .prepare(`
        UPDATE products
        SET
          name = @name,
          url = @url,
          tagline = @tagline,
          short_description = @shortDescription,
          medium_description = @mediumDescription,
          long_description = @longDescription,
          logo_url = @logoUrl,
          screenshot_urls_json = @screenshotUrlsJson,
          demo_video_url = @demoVideoUrl,
          categories_json = @categoriesJson,
          tags_json = @tagsJson,
          pricing_model = @pricingModel,
          platforms_json = @platformsJson,
          target_user = @targetUser,
          pain_solved = @painSolved,
          competitors_json = @competitorsJson,
          seed_keywords_json = @seedKeywordsJson,
          repo_path = @repoPath,
          source_code = @sourceCode,
          brand_voice_json = @brandVoiceJson,
          changelog_summary = @changelogSummary,
          workspace_id = @workspaceId,
          updated_at = @updatedAt
        WHERE id = @id
      `)
            .run({
            id: input.id,
            name: updated.name,
            url: updated.url,
            tagline: updated.tagline,
            shortDescription: updated.shortDescription,
            mediumDescription: updated.mediumDescription,
            longDescription: updated.longDescription,
            logoUrl: updated.logoUrl,
            screenshotUrlsJson: (0, json_1.safeStringify)(updated.screenshotUrls),
            demoVideoUrl: updated.demoVideoUrl,
            categoriesJson: (0, json_1.safeStringify)(updated.categories),
            tagsJson: (0, json_1.safeStringify)(updated.tags),
            pricingModel: updated.pricingModel,
            platformsJson: (0, json_1.safeStringify)(updated.platforms),
            targetUser: updated.targetUser,
            painSolved: updated.painSolved,
            competitorsJson: (0, json_1.safeStringify)(updated.competitors),
            seedKeywordsJson: (0, json_1.safeStringify)(updated.seedKeywords),
            repoPath: updated.repoPath,
            sourceCode: updated.sourceCode,
            brandVoiceJson: (0, json_1.safeStringify)(updated.brandVoice),
            changelogSummary: updated.changelogSummary,
            workspaceId: updated.workspaceId,
            updatedAt: updated.updatedAt,
        });
        return this.getProduct(input.id);
    }
    archiveProduct(id) {
        const result = this.db
            .prepare('UPDATE products SET archived = 1, updated_at = ? WHERE id = ?')
            .run((0, time_1.now)(), id);
        return result.changes > 0;
    }
    ensureDefaultWorkspace() {
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO workspaces (id, name, color, is_default, sort_order, created_at, updated_at)
        VALUES (@id, 'Unnamed', NULL, 1, 0, @timestamp, @timestamp)
        ON CONFLICT(id) DO NOTHING
      `)
            .run({ id: db_1.DEFAULT_WORKSPACE_ID, timestamp });
        return this.getWorkspace(db_1.DEFAULT_WORKSPACE_ID);
    }
    getWorkspace(id) {
        const row = this.db
            .prepare(`
        SELECT w.*, (SELECT COUNT(*) FROM products p WHERE p.workspace_id = w.id AND p.archived = 0) AS project_count
        FROM workspaces w
        WHERE w.id = ?
      `)
            .get(id);
        return row ? mapWorkspace(row) : null;
    }
    listWorkspaces() {
        this.ensureDefaultWorkspace();
        const rows = this.db
            .prepare(`
        SELECT w.*, (SELECT COUNT(*) FROM products p WHERE p.workspace_id = w.id AND p.archived = 0) AS project_count
        FROM workspaces w
        ORDER BY w.is_default DESC, w.sort_order ASC, w.created_at ASC
      `)
            .all();
        return rows.map(mapWorkspace);
    }
    createWorkspace(input) {
        const id = (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        const maxOrder = this.db.prepare('SELECT MAX(sort_order) AS max FROM workspaces').get();
        const sortOrder = (maxOrder.max ?? 0) + 1;
        this.db
            .prepare(`
        INSERT INTO workspaces (id, name, color, is_default, sort_order, created_at, updated_at)
        VALUES (@id, @name, @color, 0, @sortOrder, @timestamp, @timestamp)
      `)
            .run({ id, name: input.name.trim() || 'Untitled workspace', color: input.color ?? null, sortOrder, timestamp });
        return this.getWorkspace(id);
    }
    updateWorkspace(input) {
        const existing = this.getWorkspace(input.id);
        if (!existing)
            return null;
        // The default workspace can be renamed too; its stable id/is_default flag keep
        // it the permanent fallback regardless of the display name.
        const name = input.name?.trim() || existing.name;
        const color = input.color === undefined ? existing.color : input.color;
        const sortOrder = input.sortOrder ?? existing.sortOrder;
        this.db
            .prepare(`
        UPDATE workspaces
        SET name = @name, color = @color, sort_order = @sortOrder, updated_at = @updatedAt
        WHERE id = @id
      `)
            .run({ id: input.id, name, color: color ?? null, sortOrder, updatedAt: (0, time_1.now)() });
        return this.getWorkspace(input.id);
    }
    deleteWorkspace(id) {
        const existing = this.getWorkspace(id);
        if (!existing || existing.isDefault)
            return { reassigned: 0 };
        this.ensureDefaultWorkspace();
        const tx = this.db.transaction(() => {
            const moved = this.db
                .prepare('UPDATE products SET workspace_id = @target, updated_at = @updatedAt WHERE workspace_id = @id')
                .run({ target: db_1.DEFAULT_WORKSPACE_ID, updatedAt: (0, time_1.now)(), id });
            this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
            return moved.changes;
        });
        return { reassigned: tx() };
    }
    moveProductsToWorkspace(productIds, workspaceId) {
        const ids = Array.from(new Set(productIds)).filter(Boolean);
        if (!ids.length)
            return 0;
        const target = this.getWorkspace(workspaceId) ? workspaceId : db_1.DEFAULT_WORKSPACE_ID;
        const stmt = this.db.prepare('UPDATE products SET workspace_id = @target, updated_at = @updatedAt WHERE id = @id');
        const tx = this.db.transaction(() => {
            let moved = 0;
            const updatedAt = (0, time_1.now)();
            for (const id of ids) {
                moved += stmt.run({ target, updatedAt, id }).changes;
            }
            return moved;
        });
        return tx();
    }
    listConnectors() {
        return this.db.prepare('SELECT * FROM connectors ORDER BY name ASC').all().map(mapConnector);
    }
    getConnector(name) {
        const row = this.db.prepare('SELECT * FROM connectors WHERE name = ?').get(name);
        return row ? mapConnector(row) : null;
    }
    updateConnector(input) {
        const existing = this.getConnector(input.name);
        if (!existing)
            return null;
        const merged = {
            ...existing,
            enabled: input.enabled ?? existing.enabled,
            status: input.status ?? existing.status,
            config: input.config ?? existing.config,
            hasSecret: input.hasSecret ?? existing.hasSecret,
            lastTestedAt: input.lastTestedAt !== undefined ? input.lastTestedAt : existing.lastTestedAt,
            lastError: input.lastError !== undefined ? input.lastError : existing.lastError,
            updatedAt: (0, time_1.now)(),
        };
        this.db
            .prepare(`
        UPDATE connectors
        SET enabled = @enabled,
            status = @status,
            config_json = @configJson,
            has_secret = @hasSecret,
            last_tested_at = @lastTestedAt,
            last_error = @lastError,
            updated_at = @updatedAt
        WHERE name = @name
      `)
            .run({
            name: input.name,
            enabled: merged.enabled ? 1 : 0,
            status: merged.status,
            configJson: (0, json_1.safeStringify)(merged.config),
            hasSecret: merged.hasSecret ? 1 : 0,
            lastTestedAt: merged.lastTestedAt,
            lastError: merged.lastError,
            updatedAt: merged.updatedAt,
        });
        return this.getConnector(input.name);
    }
    createPipelineRun(input) {
        const id = (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO pipeline_runs
          (id, product_id, pipeline_type, trigger, status, input_json, output_json, started_at, completed_at, error_message)
        VALUES
          (@id, @productId, @pipelineType, @trigger, 'running', @inputJson, '{}', @startedAt, NULL, NULL)
      `)
            .run({
            id,
            productId: input.productId,
            pipelineType: input.pipelineType,
            trigger: input.trigger,
            inputJson: (0, json_1.safeStringify)(input.input ?? {}),
            startedAt: timestamp,
        });
        return this.getPipelineRun(id);
    }
    completePipelineRun(input) {
        this.db
            .prepare(`
        UPDATE pipeline_runs
        SET status = @status,
            output_json = @outputJson,
            completed_at = @completedAt,
            error_message = @errorMessage
        WHERE id = @runId
      `)
            .run({
            runId: input.runId,
            status: input.status,
            outputJson: (0, json_1.safeStringify)(input.output ?? {}),
            completedAt: (0, time_1.now)(),
            errorMessage: input.errorMessage ?? null,
        });
        return this.getPipelineRun(input.runId);
    }
    /**
     * Runs left in 'running' by a previous process can never complete — without repair they read as
     * "still running" forever in the activity feed and pipeline logs, even after the pipeline is
     * paused or deleted. Only rows started before the current process booted are touched, so
     * repeated calls never clip an in-flight run.
     */
    failInterruptedPipelineRuns(bootTime) {
        const message = 'Interrupted: the app quit while this run was in progress.';
        const completedAt = (0, time_1.now)();
        this.db
            .prepare(`UPDATE pipeline_runs
         SET status = 'failed', completed_at = ?, error_message = ?
         WHERE status = 'running' AND started_at < ?`)
            .run(completedAt, message, bootTime);
        this.db
            .prepare(`UPDATE repurpose_pipeline_runs
         SET status = 'failed', completed_at = ?, error_message = ?
         WHERE status = 'running' AND started_at < ?`)
            .run(completedAt, message, bootTime);
        this.db
            .prepare(`UPDATE repurpose_pipelines
         SET last_run_status = 'failed', last_error = ?
         WHERE last_run_status = 'running' AND last_run_at < ?`)
            .run(message, bootTime);
    }
    getPipelineRun(id) {
        const row = this.db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(id);
        return row ? mapPipelineRun(row) : null;
    }
    listPipelineRuns(productId, limit = 50) {
        if (productId) {
            return this.db
                .prepare('SELECT * FROM pipeline_runs WHERE product_id = ? ORDER BY started_at DESC LIMIT ?')
                .all(productId, limit).map(mapPipelineRun);
        }
        return this.db.prepare('SELECT * FROM pipeline_runs ORDER BY started_at DESC LIMIT ?').all(limit).map(mapPipelineRun);
    }
    getRepurposePipeline(id) {
        const row = this.db.prepare('SELECT * FROM repurpose_pipelines WHERE id = ?').get(id);
        return row ? mapRepurposePipeline(row) : null;
    }
    listRepurposePipelines(productId, kind) {
        const rows = productId
            ? this.db
                .prepare('SELECT * FROM repurpose_pipelines WHERE product_id = ? ORDER BY updated_at DESC')
                .all(productId)
            : this.db.prepare('SELECT * FROM repurpose_pipelines ORDER BY updated_at DESC').all();
        const pipelines = rows.map(mapRepurposePipeline);
        return kind ? pipelines.filter((pipeline) => pipeline.kind === kind) : pipelines;
    }
    listDueRepurposePipelines(asOf, kind) {
        const due = this.db
            .prepare(`SELECT * FROM repurpose_pipelines
           WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= ?
           ORDER BY next_run_at ASC`)
            .all(asOf).map(mapRepurposePipeline);
        return kind ? due.filter((pipeline) => pipeline.kind === kind) : due;
    }
    upsertRepurposePipeline(input) {
        const id = input.id ?? (0, id_1.createId)();
        const existing = input.id ? this.getRepurposePipeline(input.id) : null;
        // `updatedAt` doubles as the revision held by an in-flight automated run. Keep it strictly
        // monotonic so a pause/edit in the same millisecond still invalidates that run's stale snapshot.
        const timestamp = Math.max((0, time_1.now)(), (existing?.updatedAt ?? 0) + 1);
        const intervalMs = input.pollIntervalHours * 60 * 60 * 1000;
        const nextRunAt = input.status === 'active'
            ? existing?.status === 'active' && existing.pollIntervalHours === input.pollIntervalHours && existing.nextRunAt
                ? existing.nextRunAt
                : timestamp + intervalMs
            : null;
        const sourceMode = input.sourceMode === 'url' ? 'url' : 'connected';
        const sourceUrl = sourceMode === 'url'
            ? (typeof input.sourceUrl === 'string' ? input.sourceUrl.trim() : '') || null
            : null;
        const milestoneSourceId = typeof input.milestoneSourceId === 'string' && input.milestoneSourceId.trim()
            ? input.milestoneSourceId.trim()
            : input.milestoneSourceId === null
                ? null
                : existing?.milestoneSourceId ?? null;
        const kind = input.kind === 'folder' ? 'folder' : existing?.kind ?? 'social';
        const params = {
            id,
            productId: input.productId,
            name: input.name?.trim() || 'Repurpose Content',
            kind,
            sourcePlatform: input.sourcePlatform,
            sourceMode,
            sourceUrl,
            sourceAccountId: input.sourceAccountId,
            sourceAccountName: input.sourceAccountName,
            milestoneSourceId,
            watchFoldersJson: (0, json_1.safeStringify)(input.watchFolders ?? existing?.watchFolders ?? []),
            fileTypesJson: (0, json_1.safeStringify)(input.fileTypes ?? existing?.fileTypes ?? []),
            groupMode: input.groupMode ?? existing?.groupMode ?? 'file',
            contextNote: input.contextNote === undefined ? existing?.contextNote ?? null : input.contextNote?.trim() || null,
            channelOverridesJson: (0, json_1.safeStringify)(input.channelOverrides ?? existing?.channelOverrides ?? {}),
            pollIntervalHours: input.pollIntervalHours,
            destinationPlatformsJson: (0, json_1.safeStringify)(input.destinationPlatforms),
            language: input.language,
            contentDetail: input.contentDetail,
            outputFormat: input.outputFormat,
            scheduleMode: input.scheduleMode,
            scheduleDelayMinutes: input.scheduleDelayMinutes,
            timezone: input.timezone,
            status: input.status,
            nextRunAt,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        };
        if (existing) {
            this.db
                .prepare(`UPDATE repurpose_pipelines
           SET product_id = @productId, name = @name, kind = @kind, source_platform = @sourcePlatform,
               source_mode = @sourceMode, source_url = @sourceUrl,
               source_account_id = @sourceAccountId, source_account_name = @sourceAccountName,
               milestone_source_id = @milestoneSourceId,
               watch_folders_json = @watchFoldersJson, file_types_json = @fileTypesJson,
               group_mode = @groupMode,
               context_note = @contextNote, channel_overrides_json = @channelOverridesJson,
               poll_interval_hours = @pollIntervalHours,
               destination_platforms_json = @destinationPlatformsJson, language = @language,
               content_detail = @contentDetail, output_format = @outputFormat,
               schedule_mode = @scheduleMode, schedule_delay_minutes = @scheduleDelayMinutes,
               timezone = @timezone, status = @status, next_run_at = @nextRunAt, updated_at = @updatedAt
           WHERE id = @id`)
                .run(params);
        }
        else {
            this.db
                .prepare(`INSERT INTO repurpose_pipelines
             (id, product_id, name, kind, source_platform, source_mode, source_url,
              source_account_id, source_account_name, milestone_source_id,
              watch_folders_json, file_types_json, group_mode, context_note, channel_overrides_json,
              poll_interval_hours, destination_platforms_json,
              language, content_detail, output_format, schedule_mode, schedule_delay_minutes, timezone,
              status, last_run_at, next_run_at, last_run_status, last_error, last_source_title,
              last_source_url, created_at, updated_at)
           VALUES
             (@id, @productId, @name, @kind, @sourcePlatform, @sourceMode, @sourceUrl,
              @sourceAccountId, @sourceAccountName, @milestoneSourceId,
              @watchFoldersJson, @fileTypesJson, @groupMode, @contextNote, @channelOverridesJson,
              @pollIntervalHours, @destinationPlatformsJson,
              @language, @contentDetail, @outputFormat, @scheduleMode, @scheduleDelayMinutes, @timezone,
              @status, NULL, @nextRunAt, NULL, NULL, NULL, NULL, @createdAt, @updatedAt)`)
                .run(params);
        }
        if (input.status === 'paused') {
            this.cancelRepurposePipelineScheduledPosts(id);
        }
        return this.getRepurposePipeline(id);
    }
    pauseRepurposePipeline(id) {
        this.db
            .prepare(`UPDATE repurpose_pipelines
         SET status = 'paused', next_run_at = NULL, updated_at = MAX(updated_at + 1, ?)
         WHERE id = ?`)
            .run((0, time_1.now)(), id);
        this.cancelRepurposePipelineScheduledPosts(id);
        return this.getRepurposePipeline(id);
    }
    markRepurposePipelineRunning(id, startedAt) {
        this.db
            .prepare(`UPDATE repurpose_pipelines
         SET last_run_at = ?, last_run_status = 'running', last_error = NULL,
             updated_at = MAX(updated_at + 1, ?)
         WHERE id = ?`)
            .run(startedAt, startedAt, id);
        return this.getRepurposePipeline(id);
    }
    completeRepurposePipelineRun(input) {
        this.db
            .prepare(`UPDATE repurpose_pipelines
         SET last_run_at = @completedAt, next_run_at = @nextRunAt, last_run_status = @status,
             last_error = @error,
             last_source_title = COALESCE(@sourceTitle, last_source_title),
             last_source_url = COALESCE(@sourceUrl, last_source_url),
             updated_at = @completedAt
         WHERE id = @id`)
            .run({
            id: input.id,
            status: input.status,
            completedAt: input.completedAt,
            nextRunAt: input.nextRunAt,
            error: input.error ?? null,
            sourceTitle: input.sourceTitle ?? null,
            sourceUrl: input.sourceUrl ?? null,
        });
        return this.getRepurposePipeline(input.id);
    }
    createRepurposePipelineLog(input) {
        const id = (0, id_1.createId)();
        this.db
            .prepare(`INSERT INTO repurpose_pipeline_runs
           (id, pipeline_id, product_id, pipeline_name, kind, source_platform, source_account_id,
            source_account_name, trigger, status,
            fetched_posts, processed_posts, generated_content_items, scheduled_posts,
            source_title, source_url, error_message, started_at, completed_at)
         VALUES
           (@id, @pipelineId, @productId, @pipelineName, @kind, @sourcePlatform, @sourceAccountId,
            @sourceAccountName, @trigger, 'running',
            0, 0, 0, 0, NULL, NULL, NULL, @startedAt, NULL)`)
            .run({
            id,
            pipelineId: input.pipeline.id,
            productId: input.pipeline.productId,
            pipelineName: input.pipeline.name,
            kind: input.pipeline.kind,
            sourcePlatform: input.pipeline.sourcePlatform,
            sourceAccountId: input.pipeline.sourceAccountId,
            sourceAccountName: input.pipeline.sourceAccountName,
            trigger: input.trigger,
            startedAt: input.startedAt,
        });
        return this.getRepurposePipelineLog(id);
    }
    completeRepurposePipelineLog(input) {
        this.db
            .prepare(`UPDATE repurpose_pipeline_runs
         SET status = @status, fetched_posts = @fetchedPosts, processed_posts = @processedPosts,
             generated_content_items = @generatedContentItems, scheduled_posts = @scheduledPosts,
             source_title = @sourceTitle, source_url = @sourceUrl,
             content_run_ids_json = @contentRunIdsJson, error_message = @errorMessage,
             completed_at = @completedAt
         WHERE id = @id`)
            .run({
            id: input.id,
            status: input.status,
            fetchedPosts: input.fetchedPosts ?? 0,
            processedPosts: input.processedPosts ?? 0,
            generatedContentItems: input.generatedContentItems ?? 0,
            scheduledPosts: input.scheduledPosts ?? 0,
            sourceTitle: input.sourceTitle ?? null,
            sourceUrl: input.sourceUrl ?? null,
            contentRunIdsJson: (0, json_1.safeStringify)(input.contentRunIds ?? []),
            errorMessage: input.errorMessage ?? null,
            completedAt: input.completedAt,
        });
        return this.getRepurposePipelineLog(input.id);
    }
    getRepurposePipelineLog(id) {
        const row = this.db.prepare('SELECT * FROM repurpose_pipeline_runs WHERE id = ?').get(id);
        return row ? mapRepurposePipelineLog(row) : null;
    }
    listRepurposePipelineLogs(input) {
        const limit = Math.max(1, Math.min(500, input?.limit ?? 100));
        if (input?.pipelineId && input.productId) {
            return this.db
                .prepare('SELECT * FROM repurpose_pipeline_runs WHERE product_id = ? AND pipeline_id = ? ORDER BY started_at DESC LIMIT ?')
                .all(input.productId, input.pipelineId, limit).map(mapRepurposePipelineLog);
        }
        if (input?.productId) {
            return this.db
                .prepare('SELECT * FROM repurpose_pipeline_runs WHERE product_id = ? ORDER BY started_at DESC LIMIT ?')
                .all(input.productId, limit).map(mapRepurposePipelineLog);
        }
        if (input?.pipelineId) {
            return this.db
                .prepare('SELECT * FROM repurpose_pipeline_runs WHERE pipeline_id = ? ORDER BY started_at DESC LIMIT ?')
                .all(input.pipelineId, limit).map(mapRepurposePipelineLog);
        }
        return this.db.prepare('SELECT * FROM repurpose_pipeline_runs ORDER BY started_at DESC LIMIT ?').all(limit).map(mapRepurposePipelineLog);
    }
    hasProcessedRepurposeSource(pipelineId, sourceId) {
        return Boolean(this.db
            .prepare('SELECT 1 FROM repurpose_pipeline_sources WHERE pipeline_id = ? AND source_id = ?')
            .get(pipelineId, sourceId));
    }
    countProcessedRepurposeSources(pipelineId) {
        const row = this.db
            .prepare('SELECT COUNT(*) AS count FROM repurpose_pipeline_sources WHERE pipeline_id = ?')
            .get(pipelineId);
        return Number(row?.count ?? 0);
    }
    listProcessedRepurposeSourceIds(pipelineId) {
        return this.db
            .prepare('SELECT source_id FROM repurpose_pipeline_sources WHERE pipeline_id = ?')
            .all(pipelineId).map((row) => row.source_id);
    }
    markRepurposeSourceProcessed(pipelineId, sourceId, sourceUrl) {
        this.db
            .prepare(`INSERT OR IGNORE INTO repurpose_pipeline_sources (pipeline_id, source_id, source_url, processed_at)
         VALUES (?, ?, ?, ?)`)
            .run(pipelineId, sourceId, sourceUrl ?? null, (0, time_1.now)());
    }
    /**
     * Cancel calendar work created by a repurpose/folder pipeline without deleting the generated
     * content. Both queues must be updated: `scheduled_posts` drives real channel publishing while
     * `content_queue.status = scheduled` is still swept by the legacy publisher.
     */
    cancelRepurposePipelineScheduledPosts(pipelineId) {
        const contentIds = this.db.prepare('SELECT id, metadata_json FROM content_queue').all()
            .filter((row) => (0, json_1.safeParseJson)(row.metadata_json, {}).repurposePipelineId === pipelineId)
            .map((row) => row.id);
        if (!contentIds.length)
            return 0;
        const timestamp = (0, time_1.now)();
        const cancelPost = this.db.prepare(`UPDATE scheduled_posts
       SET status = 'canceled', updated_at = ?
       WHERE content_id = ? AND status IN ('scheduled', 'publishing')`);
        const resetContent = this.db.prepare(`UPDATE content_queue
       SET status = 'pending', scheduled_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'scheduled'`);
        let canceled = 0;
        const tx = this.db.transaction(() => {
            for (const contentId of contentIds) {
                canceled += cancelPost.run(timestamp, contentId).changes;
                resetContent.run(timestamp, contentId);
            }
        });
        tx();
        return canceled;
    }
    deleteRepurposePipeline(id) {
        this.cancelRepurposePipelineScheduledPosts(id);
        const tx = this.db.transaction(() => {
            this.db.prepare('DELETE FROM repurpose_pipeline_sources WHERE pipeline_id = ?').run(id);
            this.db.prepare('DELETE FROM repurpose_pipelines WHERE id = ?').run(id);
        });
        tx();
        return true;
    }
    createContent(input) {
        const id = (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO content_queue
          (id, product_id, run_id, type, title, content, status, scheduled_at, published_at, metadata_json, created_at, updated_at)
        VALUES
          (@id, @productId, @runId, @type, @title, @content, @status, NULL, NULL, @metadataJson, @createdAt, @updatedAt)
      `)
            .run({
            id,
            productId: input.productId,
            runId: input.runId,
            type: input.type,
            title: input.title,
            content: input.content,
            status: input.status ?? 'pending',
            metadataJson: (0, json_1.safeStringify)(input.metadata ?? {}),
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        return this.getContentById(id);
    }
    getContentById(id) {
        const row = this.db.prepare('SELECT * FROM content_queue WHERE id = ?').get(id);
        return row ? mapContent(row) : null;
    }
    listContent(options = {}) {
        const where = [];
        const args = [];
        if (options.productId) {
            where.push('product_id = ?');
            args.push(options.productId);
        }
        if (options.status) {
            where.push('status = ?');
            args.push(options.status);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const sql = `SELECT * FROM content_queue ${whereSql} ORDER BY created_at DESC`;
        return this.db.prepare(sql).all(...args).map(mapContent);
    }
    updateContent(input) {
        const existing = this.getContentById(input.id);
        if (!existing)
            return null;
        const merged = {
            ...existing,
            title: input.title ?? existing.title,
            content: input.content ?? existing.content,
            status: input.status ?? existing.status,
            scheduledAt: input.scheduledAt ?? existing.scheduledAt,
            publishedAt: input.publishedAt ?? existing.publishedAt,
            metadata: input.metadata ?? existing.metadata,
            updatedAt: (0, time_1.now)(),
        };
        this.db
            .prepare(`
        UPDATE content_queue
        SET title = @title,
            content = @content,
            status = @status,
            scheduled_at = @scheduledAt,
            published_at = @publishedAt,
            metadata_json = @metadataJson,
            updated_at = @updatedAt
        WHERE id = @id
      `)
            .run({
            id: input.id,
            title: merged.title,
            content: merged.content,
            status: merged.status,
            scheduledAt: merged.scheduledAt,
            publishedAt: merged.publishedAt,
            metadataJson: (0, json_1.safeStringify)(merged.metadata),
            updatedAt: merged.updatedAt,
        });
        return this.getContentById(input.id);
    }
    duplicateContent(id) {
        const existing = this.getContentById(id);
        if (!existing)
            return null;
        return this.createContent({
            productId: existing.productId,
            runId: existing.runId,
            type: existing.type,
            title: `${existing.title} (Variant)`,
            content: existing.content,
            status: 'pending',
            metadata: {
                ...existing.metadata,
                duplicatedFrom: existing.id,
            },
        });
    }
    deleteContent(id) {
        const existing = this.getContentById(id);
        if (!existing)
            return false;
        const deleteHistory = this.db.prepare('DELETE FROM publish_history WHERE content_id = ?');
        const deleteItem = this.db.prepare('DELETE FROM content_queue WHERE id = ?');
        const transaction = this.db.transaction(() => {
            deleteHistory.run(id);
            deleteItem.run(id);
        });
        transaction();
        return true;
    }
    bulkDeleteContent(ids) {
        if (!ids.length)
            return 0;
        const deleteHistory = this.db.prepare('DELETE FROM publish_history WHERE content_id = ?');
        const deleteItem = this.db.prepare('DELETE FROM content_queue WHERE id = ?');
        const transaction = this.db.transaction(() => {
            for (const id of ids) {
                deleteHistory.run(id);
                deleteItem.run(id);
            }
        });
        transaction();
        return ids.length;
    }
    bulkUpdateContentStatus(ids, status) {
        if (!ids.length)
            return 0;
        const stmt = this.db.prepare(`
      UPDATE content_queue
      SET status = @status, updated_at = @updatedAt
      WHERE id = @id
    `);
        const timestamp = (0, time_1.now)();
        const transaction = this.db.transaction(() => {
            for (const id of ids) {
                stmt.run({ id, status, updatedAt: timestamp });
            }
        });
        transaction();
        return ids.length;
    }
    // --- Assets ---------------------------------------------------------------
    createAsset(input) {
        const id = (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO assets
          (id, product_id, collection_id, kind, mime_type, original_name, title, description,
           storage, managed, local_path, profile_id, remote_bucket, remote_key, public_url,
           size_bytes, width, height, duration_ms, checksum, sync_status, sync_error,
           tags_json, metadata_json, created_at, updated_at)
        VALUES
          (@id, @productId, @collectionId, @kind, @mimeType, @originalName, @title, NULL,
           @storage, @managed, @localPath, NULL, NULL, NULL, NULL,
           @sizeBytes, NULL, NULL, NULL, @checksum, @syncStatus, NULL,
           @tagsJson, @metadataJson, @createdAt, @updatedAt)
      `)
            .run({
            id,
            productId: input.productId ?? null,
            collectionId: input.collectionId ?? null,
            kind: input.kind,
            mimeType: input.mimeType,
            originalName: input.originalName,
            title: input.title ?? null,
            storage: input.storage ?? 'local',
            managed: input.managed ? 1 : 0,
            localPath: input.localPath ?? null,
            sizeBytes: input.sizeBytes ?? null,
            checksum: input.checksum ?? null,
            syncStatus: input.storage === 'remote' ? 'remote_only' : 'local_only',
            tagsJson: (0, json_1.safeStringify)(input.tags ?? []),
            metadataJson: (0, json_1.safeStringify)(input.metadata ?? {}),
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        return this.getAssetById(id);
    }
    getAssetById(id) {
        const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
        return row ? mapAsset(row) : null;
    }
    listAssets(options = {}) {
        const where = [];
        const args = [];
        // Per-scene video intermediates (scene key visuals + scene clips) are tagged 'video-scene'
        // and hidden from the library/pickers by default; the video maker keeps them as provenance.
        if (!options.includeIntermediate) {
            where.push("(tags_json IS NULL OR tags_json NOT LIKE '%\"video-scene\"%')");
        }
        if (options.productId) {
            where.push('product_id = ?');
            args.push(options.productId);
        }
        if (options.kind) {
            where.push('kind = ?');
            args.push(options.kind);
        }
        if (options.collectionId !== undefined) {
            if (options.collectionId === null) {
                where.push('collection_id IS NULL');
            }
            else {
                where.push('collection_id = ?');
                args.push(options.collectionId);
            }
        }
        if (options.search) {
            where.push('(LOWER(original_name) LIKE ? OR LOWER(IFNULL(title, \'\')) LIKE ? OR LOWER(tags_json) LIKE ?)');
            const needle = `%${options.search.toLowerCase()}%`;
            args.push(needle, needle, needle);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const sql = `SELECT * FROM assets ${whereSql} ORDER BY created_at DESC`;
        return this.db.prepare(sql).all(...args).map(mapAsset);
    }
    listManagedAssetPaths() {
        return this.db
            .prepare('SELECT id, local_path, size_bytes FROM assets WHERE managed = 1 AND local_path IS NOT NULL')
            .all().map((row) => ({ id: row.id, localPath: row.local_path, sizeBytes: row.size_bytes }));
    }
    clearMissingManagedAssets(existingPaths) {
        const rows = this.listManagedAssetPaths();
        const ids = rows.filter((row) => !existingPaths.has(row.localPath)).map((row) => row.id);
        if (ids.length === 0)
            return 0;
        const detachDesignPreview = this.db.prepare('UPDATE design_documents SET preview_asset_id = NULL, updated_at = ? WHERE preview_asset_id = ?');
        const remove = this.db.prepare('DELETE FROM assets WHERE id = ? AND managed = 1');
        const tx = this.db.transaction((assetIds) => {
            const timestamp = (0, time_1.now)();
            for (const id of assetIds) {
                detachDesignPreview.run(timestamp, id);
                remove.run(id);
            }
        });
        tx(ids);
        return ids.length;
    }
    updateAsset(input) {
        const existing = this.getAssetById(input.id);
        if (!existing)
            return null;
        const merged = {
            ...existing,
            title: input.title !== undefined ? input.title : existing.title,
            description: input.description !== undefined ? input.description : existing.description,
            collectionId: input.collectionId !== undefined ? input.collectionId : existing.collectionId,
            tags: input.tags ?? existing.tags,
            updatedAt: (0, time_1.now)(),
        };
        this.db
            .prepare(`
        UPDATE assets
        SET title = @title,
            description = @description,
            collection_id = @collectionId,
            tags_json = @tagsJson,
            updated_at = @updatedAt
        WHERE id = @id
      `)
            .run({
            id: merged.id,
            title: merged.title,
            description: merged.description,
            collectionId: merged.collectionId,
            tagsJson: (0, json_1.safeStringify)(merged.tags),
            updatedAt: merged.updatedAt,
        });
        return this.getAssetById(merged.id);
    }
    deleteAsset(id) {
        const result = this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
        return result.changes > 0;
    }
    listAssetCollections(productId) {
        const where = [];
        const args = [];
        if (productId) {
            where.push('(product_id = ? OR product_id IS NULL)');
            args.push(productId);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const sql = `SELECT * FROM asset_collections ${whereSql} ORDER BY name ASC`;
        return this.db.prepare(sql).all(...args).map(mapAssetCollection);
    }
    upsertAssetCollection(input) {
        const timestamp = (0, time_1.now)();
        if (input.id) {
            this.db
                .prepare(`UPDATE asset_collections SET name = @name, parent_id = @parentId, updated_at = @updatedAt WHERE id = @id`)
                .run({ id: input.id, name: input.name, parentId: input.parentId ?? null, updatedAt: timestamp });
            const row = this.db.prepare('SELECT * FROM asset_collections WHERE id = ?').get(input.id);
            if (row)
                return mapAssetCollection(row);
        }
        const id = input.id ?? (0, id_1.createId)();
        this.db
            .prepare(`INSERT INTO asset_collections (id, product_id, parent_id, name, created_at, updated_at)
         VALUES (@id, @productId, @parentId, @name, @createdAt, @updatedAt)`)
            .run({
            id,
            productId: input.productId ?? null,
            parentId: input.parentId ?? null,
            name: input.name,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        return mapAssetCollection(this.db.prepare('SELECT * FROM asset_collections WHERE id = ?').get(id));
    }
    deleteAssetCollection(id) {
        const transaction = this.db.transaction(() => {
            this.db.prepare('UPDATE assets SET collection_id = NULL WHERE collection_id = ?').run(id);
            this.db.prepare('UPDATE asset_collections SET parent_id = NULL WHERE parent_id = ?').run(id);
            this.db.prepare('DELETE FROM asset_collections WHERE id = ?').run(id);
        });
        transaction();
        return true;
    }
    listStorageProfiles() {
        return this.db
            .prepare(`
          SELECT * FROM storage_profiles
          ORDER BY is_default DESC, enabled DESC, name COLLATE NOCASE ASC
        `)
            .all().map(mapStorageProfile);
    }
    getStorageProfile(id) {
        const row = this.db.prepare('SELECT * FROM storage_profiles WHERE id = ?').get(id);
        return row ? mapStorageProfile(row) : null;
    }
    upsertStorageProfile(input) {
        const existing = input.id ? this.getStorageProfile(input.id) : null;
        const id = existing?.id ?? (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        const isFirst = this.listStorageProfiles().length === 0;
        const otherDefault = existing
            ? this.db
                .prepare('SELECT COUNT(*) AS count FROM storage_profiles WHERE is_default = 1 AND id != ?')
                .get(existing.id)
            : null;
        const next = {
            id,
            name: input.name,
            provider: input.provider,
            endpoint: input.endpoint ?? null,
            region: input.region,
            bucket: input.bucket,
            prefix: input.prefix ?? null,
            publicBaseUrl: input.publicBaseUrl ?? null,
            forcePathStyle: input.forcePathStyle ? 1 : 0,
            hasSecret: input.hasSecret !== undefined ? (input.hasSecret ? 1 : 0) : existing?.hasSecret ? 1 : 0,
            enabled: input.enabled ? 1 : 0,
            isDefault: input.isDefault || isFirst || (existing?.isDefault && !otherDefault?.count) ? 1 : 0,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        };
        const transaction = this.db.transaction(() => {
            if (next.isDefault) {
                this.db.prepare('UPDATE storage_profiles SET is_default = 0').run();
            }
            if (existing) {
                this.db
                    .prepare(`
            UPDATE storage_profiles
            SET name = @name,
                provider = @provider,
                endpoint = @endpoint,
                region = @region,
                bucket = @bucket,
                prefix = @prefix,
                public_base_url = @publicBaseUrl,
                force_path_style = @forcePathStyle,
                has_secret = @hasSecret,
                enabled = @enabled,
                is_default = @isDefault,
                updated_at = @updatedAt
            WHERE id = @id
          `)
                    .run(next);
                return;
            }
            this.db
                .prepare(`
          INSERT INTO storage_profiles
            (id, name, provider, endpoint, region, bucket, prefix, public_base_url,
             force_path_style, has_secret, enabled, is_default, created_at, updated_at)
          VALUES
            (@id, @name, @provider, @endpoint, @region, @bucket, @prefix, @publicBaseUrl,
             @forcePathStyle, @hasSecret, @enabled, @isDefault, @createdAt, @updatedAt)
        `)
                .run(next);
        });
        transaction();
        return this.getStorageProfile(id);
    }
    setStorageProfileHasSecret(id, hasSecret) {
        this.db
            .prepare('UPDATE storage_profiles SET has_secret = @hasSecret, updated_at = @updatedAt WHERE id = @id')
            .run({ id, hasSecret: hasSecret ? 1 : 0, updatedAt: (0, time_1.now)() });
        return this.getStorageProfile(id);
    }
    storageProfileAssetCount(id) {
        const row = this.db.prepare('SELECT COUNT(*) AS count FROM assets WHERE profile_id = ?').get(id);
        return row?.count ?? 0;
    }
    deleteStorageProfile(id) {
        const existing = this.getStorageProfile(id);
        if (!existing || this.storageProfileAssetCount(id) > 0)
            return false;
        const result = this.db.prepare('DELETE FROM storage_profiles WHERE id = ?').run(id);
        if (result.changes > 0 && existing.isDefault) {
            const nextDefault = this.listStorageProfiles()[0];
            if (nextDefault) {
                this.db.prepare('UPDATE storage_profiles SET is_default = 1 WHERE id = ?').run(nextDefault.id);
            }
        }
        return result.changes > 0;
    }
    // --- Design documents ----------------------------------------------------
    upsertDesignDocument(input) {
        const timestamp = (0, time_1.now)();
        const existing = input.id ? this.getDesignDocument(input.id) : null;
        const id = existing?.id ?? (0, id_1.createId)();
        this.db
            .prepare(`
        INSERT INTO design_documents
          (id, product_id, title, format, template_id, width, height, inputs_json, preview_asset_id, created_at, updated_at)
        VALUES
          (@id, @productId, @title, @format, @templateId, @width, @height, @inputsJson, @previewAssetId, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          product_id = excluded.product_id,
          title = excluded.title,
          format = excluded.format,
          template_id = excluded.template_id,
          width = excluded.width,
          height = excluded.height,
          inputs_json = excluded.inputs_json,
          preview_asset_id = COALESCE(excluded.preview_asset_id, design_documents.preview_asset_id),
          updated_at = excluded.updated_at
      `)
            .run({
            id,
            productId: input.productId ?? null,
            title: input.title,
            format: input.format,
            templateId: input.templateId,
            width: input.width,
            height: input.height,
            inputsJson: (0, json_1.safeStringify)(input.inputs),
            previewAssetId: input.previewAssetId ?? null,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        });
        return this.getDesignDocument(id);
    }
    getDesignDocument(id) {
        const row = this.db.prepare('SELECT * FROM design_documents WHERE id = ?').get(id);
        return row ? mapDesignDocument(row) : null;
    }
    listDesignDocuments(options = {}) {
        const where = [];
        const args = [];
        if (options.productId) {
            where.push('(product_id = ? OR product_id IS NULL)');
            args.push(options.productId);
        }
        if (options.format) {
            where.push('format = ?');
            args.push(options.format);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const sql = `SELECT * FROM design_documents ${whereSql} ORDER BY updated_at DESC`;
        return this.db.prepare(sql).all(...args).map(mapDesignDocument);
    }
    setDesignPreviewAsset(id, previewAssetId) {
        this.db
            .prepare('UPDATE design_documents SET preview_asset_id = @previewAssetId, updated_at = @updatedAt WHERE id = @id')
            .run({ id, previewAssetId, updatedAt: (0, time_1.now)() });
    }
    deleteDesignDocument(id) {
        this.db.prepare('DELETE FROM design_documents WHERE id = ?').run(id);
        return true;
    }
    createPublishHistory(contentId, channel, publishedUrl, response) {
        const id = (0, id_1.createId)();
        this.db
            .prepare(`
        INSERT INTO publish_history (id, content_id, channel, published_url, published_at, response_json)
        VALUES (@id, @contentId, @channel, @publishedUrl, @publishedAt, @responseJson)
      `)
            .run({
            id,
            contentId,
            channel,
            publishedUrl,
            publishedAt: (0, time_1.now)(),
            responseJson: (0, json_1.safeStringify)(response),
        });
        return this.getPublishHistoryById(id);
    }
    getPublishHistoryById(id) {
        const row = this.db.prepare('SELECT * FROM publish_history WHERE id = ?').get(id);
        return row ? mapPublishHistory(row) : null;
    }
    listPublishHistory(contentId) {
        if (contentId) {
            return this.db
                .prepare('SELECT * FROM publish_history WHERE content_id = ? ORDER BY published_at DESC')
                .all(contentId).map(mapPublishHistory);
        }
        return this.db.prepare('SELECT * FROM publish_history ORDER BY published_at DESC').all().map(mapPublishHistory);
    }
    getPostTargets(postId) {
        return this.db
            .prepare('SELECT * FROM post_targets WHERE post_id = ? ORDER BY connector_name ASC')
            .all(postId).map(mapPostTarget);
    }
    getScheduledPost(id) {
        const row = this.db.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id);
        return row ? mapScheduledPost(row, this.getPostTargets(id)) : null;
    }
    // ---------------------------------------------------------------------------
    // Follow-up comments
    // ---------------------------------------------------------------------------
    getPostTargetById(targetId) {
        const row = this.db.prepare('SELECT * FROM post_targets WHERE id = ?').get(targetId);
        return row ? mapPostTarget(row) : null;
    }
    getPostComments(postId) {
        return this.db
            .prepare('SELECT * FROM post_comments WHERE post_id = ? ORDER BY target_id ASC, position ASC')
            .all(postId).map(mapPostComment);
    }
    getTargetComments(targetId) {
        return this.db
            .prepare('SELECT * FROM post_comments WHERE target_id = ? ORDER BY position ASC')
            .all(targetId).map(mapPostComment);
    }
    getPostComment(id) {
        const row = this.db.prepare('SELECT * FROM post_comments WHERE id = ?').get(id);
        return row ? mapPostComment(row) : null;
    }
    /**
     * A comment plus its post/channel context. Target and post columns are aliased because `status`,
     * `body` and `published_url` exist on more than one of the joined tables.
     */
    queryCommentQueue(where, args) {
        const rows = this.db
            .prepare(`SELECT c.*,
                t.connector_name AS q_connector_name,
                t.status AS q_target_status,
                t.published_url AS q_target_published_url,
                p.body AS q_post_body,
                p.status AS q_post_status,
                p.scheduled_at AS q_post_scheduled_at
           FROM post_comments c
           JOIN post_targets t ON t.id = c.target_id
           JOIN scheduled_posts p ON p.id = c.post_id
          ${where}`)
            .all(...args);
        return rows.map((row) => ({
            ...mapPostComment(row),
            connectorName: row.q_connector_name,
            targetStatus: row.q_target_status,
            targetPublishedUrl: row.q_target_published_url,
            postBody: row.q_post_body,
            postStatus: row.q_post_status,
            postScheduledAt: row.q_post_scheduled_at,
        }));
    }
    /** Every follow-up for a project, newest post first — the Calendar's Comments tab. */
    listProductComments(productId, limit = 200) {
        return this.queryCommentQueue('WHERE p.product_id = ? ORDER BY c.created_at DESC, c.position ASC LIMIT ?', [
            productId,
            Math.max(1, limit),
        ]);
    }
    getCommentQueueEntry(id) {
        return this.queryCommentQueue('WHERE c.id = ?', [id])[0] ?? null;
    }
    /** Everything the sweep might act on: not yet finished, and not blocked behind a future re-check. */
    listActionableComments(asOf) {
        return this.db
            .prepare(`SELECT * FROM post_comments
           WHERE status IN ('pending','armed')
             AND (next_check_at IS NULL OR next_check_at <= ?)
           ORDER BY post_id ASC, target_id ASC, position ASC`)
            .all(asOf).map(mapPostComment);
    }
    /** How many of OUR follow-ups are already live on a target — subtracted from the comment metric (§8.2). */
    countPublishedComments(targetId) {
        const row = this.db
            .prepare(`SELECT COUNT(*) AS n FROM post_comments WHERE target_id = ? AND status = 'published'`)
            .get(targetId);
        return row?.n ?? 0;
    }
    replaceTargetComments(targetId, postId, comments) {
        const timestamp = (0, time_1.now)();
        const insert = this.db.prepare(`
      INSERT INTO post_comments
        (id, target_id, post_id, position, body, media_json, trigger_json, status, origin,
         source_snippet_id, provider_metadata_json, attempts, created_at, updated_at)
      VALUES
        (@id, @targetId, @postId, @position, @body, @mediaJson, @triggerJson, 'pending', @origin,
         @sourceSnippetId, '{}', 0, @createdAt, @updatedAt)
    `);
        const tx = this.db.transaction(() => {
            // Only unfired comments are replaceable — a published comment is a public artifact and its row
            // is the audit record, so editing a post must never delete it.
            this.db
                .prepare(`DELETE FROM post_comments WHERE target_id = ? AND status IN ('pending','armed')`)
                .run(targetId);
            comments.forEach((comment, index) => {
                insert.run({
                    id: (0, id_1.createId)(),
                    targetId,
                    postId,
                    position: comment.position ?? index,
                    body: comment.body,
                    mediaJson: (0, json_1.safeStringify)(comment.media ?? []),
                    triggerJson: (0, json_1.safeStringify)(comment.trigger ?? DEFAULT_TRIGGER),
                    origin: comment.origin ?? 'composed',
                    sourceSnippetId: comment.sourceSnippetId ?? null,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                });
            });
        });
        tx();
        return this.getTargetComments(targetId);
    }
    appendPostComment(input) {
        const timestamp = (0, time_1.now)();
        const id = (0, id_1.createId)();
        const next = this.db
            .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM post_comments WHERE target_id = ?')
            .get(input.targetId);
        this.db
            .prepare(`INSERT INTO post_comments
           (id, target_id, post_id, position, body, media_json, trigger_json, status, origin,
            source_snippet_id, provider_metadata_json, attempts, armed_at, created_at, updated_at)
         VALUES
           (@id, @targetId, @postId, @position, @body, @mediaJson, @triggerJson, 'pending', @origin,
            @sourceSnippetId, '{}', 0, @armedAt, @createdAt, @updatedAt)`)
            .run({
            id,
            targetId: input.targetId,
            postId: input.postId,
            position: input.position ?? next.n,
            body: input.body,
            mediaJson: (0, json_1.safeStringify)(input.media ?? []),
            triggerJson: (0, json_1.safeStringify)(input.trigger ?? DEFAULT_TRIGGER),
            origin: input.origin ?? 'composed',
            sourceSnippetId: input.sourceSnippetId ?? null,
            // Retro-comments start their delay clock now, not at the post's publish time (§7.2).
            armedAt: input.armedAt ?? null,
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        return this.getPostComment(id);
    }
    updatePostComment(id, patch) {
        const existing = this.getPostComment(id);
        if (!existing)
            return null;
        const merged = { ...existing, ...patch, updatedAt: (0, time_1.now)() };
        this.db
            .prepare(`UPDATE post_comments
         SET position = @position, body = @body, media_json = @mediaJson, trigger_json = @triggerJson,
             status = @status, origin = @origin, source_snippet_id = @sourceSnippetId, artifact_id = @artifactId,
             remote_comment_id = @remoteCommentId, remote_parent_id = @remoteParentId,
             provider_metadata_json = @providerMetadataJson, published_url = @publishedUrl,
             published_at = @publishedAt, attempts = @attempts, next_check_at = @nextCheckAt,
             armed_at = @armedAt, error = @error, updated_at = @updatedAt
         WHERE id = @id`)
            .run({
            id,
            position: merged.position,
            body: merged.body,
            mediaJson: (0, json_1.safeStringify)(merged.media),
            triggerJson: (0, json_1.safeStringify)(merged.trigger),
            status: merged.status,
            origin: merged.origin,
            sourceSnippetId: merged.sourceSnippetId,
            artifactId: merged.artifactId,
            remoteCommentId: merged.remoteCommentId,
            remoteParentId: merged.remoteParentId,
            providerMetadataJson: (0, json_1.safeStringify)(merged.providerMetadata),
            publishedUrl: merged.publishedUrl,
            publishedAt: merged.publishedAt,
            attempts: merged.attempts,
            nextCheckAt: merged.nextCheckAt,
            armedAt: merged.armedAt,
            error: merged.error,
            updatedAt: merged.updatedAt,
        });
        return this.getPostComment(id);
    }
    deletePostComment(id) {
        this.db.prepare('DELETE FROM post_comments WHERE id = ?').run(id);
    }
    // ---------------------------------------------------------------------------
    // Saved comments (snippets)
    // ---------------------------------------------------------------------------
    listCommentSnippets(productId) {
        return this.db
            .prepare('SELECT * FROM comment_snippets WHERE product_id = ? ORDER BY use_count DESC, updated_at DESC')
            .all(productId).map(mapCommentSnippet);
    }
    getCommentSnippet(id) {
        const row = this.db.prepare('SELECT * FROM comment_snippets WHERE id = ?').get(id);
        return row ? mapCommentSnippet(row) : null;
    }
    upsertCommentSnippet(input) {
        const timestamp = (0, time_1.now)();
        const id = input.id ?? (0, id_1.createId)();
        const exists = input.id ? !!this.getCommentSnippet(input.id) : false;
        const params = {
            id,
            productId: input.productId,
            name: input.name,
            body: input.body,
            mediaJson: (0, json_1.safeStringify)(input.media ?? []),
            triggerJson: (0, json_1.safeStringify)(input.trigger ?? DEFAULT_TRIGGER),
            autoAttachJson: (0, json_1.safeStringify)(input.autoAttach ?? []),
            autoPosition: input.autoPosition ?? 0,
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        if (exists) {
            this.db
                .prepare(`UPDATE comment_snippets
           SET name = @name, body = @body, media_json = @mediaJson, trigger_json = @triggerJson,
               auto_attach_json = @autoAttachJson, auto_position = @autoPosition, updated_at = @updatedAt
           WHERE id = @id`)
                .run(params);
        }
        else {
            this.db
                .prepare(`INSERT INTO comment_snippets
             (id, product_id, name, body, media_json, trigger_json, auto_attach_json, auto_position,
              use_count, created_at, updated_at)
           VALUES
             (@id, @productId, @name, @body, @mediaJson, @triggerJson, @autoAttachJson, @autoPosition,
              0, @createdAt, @updatedAt)`)
                .run(params);
        }
        return this.getCommentSnippet(id);
    }
    deleteCommentSnippet(id) {
        this.db.prepare('DELETE FROM comment_snippets WHERE id = ?').run(id);
    }
    bumpCommentSnippetUse(id) {
        this.db.prepare('UPDATE comment_snippets SET use_count = use_count + 1 WHERE id = ?').run(id);
    }
    listScheduledPosts(options = {}) {
        const where = [];
        const args = [];
        if (options.productId) {
            where.push('product_id = ?');
            args.push(options.productId);
        }
        if (options.status) {
            where.push('status = ?');
            args.push(options.status);
        }
        if (typeof options.from === 'number') {
            where.push('scheduled_at >= ?');
            args.push(options.from);
        }
        if (typeof options.to === 'number') {
            where.push('scheduled_at <= ?');
            args.push(options.to);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const rows = this.db
            .prepare(`SELECT * FROM scheduled_posts ${whereSql} ORDER BY COALESCE(scheduled_at, created_at) DESC`)
            .all(...args);
        return rows.map((row) => mapScheduledPost(row, this.getPostTargets(row.id)));
    }
    listDueScheduledPosts(asOf) {
        const rows = this.db
            .prepare(`SELECT * FROM scheduled_posts
         WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?
         ORDER BY scheduled_at ASC`)
            .all(asOf);
        return rows.map((row) => mapScheduledPost(row, this.getPostTargets(row.id)));
    }
    upsertScheduledPost(input) {
        const timestamp = (0, time_1.now)();
        const id = input.id ?? (0, id_1.createId)();
        const exists = input.id ? !!this.getScheduledPost(input.id) : false;
        const status = input.status ?? (typeof input.scheduledAt === 'number' ? 'scheduled' : 'draft');
        const insertTarget = this.db.prepare(`
      INSERT INTO post_targets
        (id, post_id, connector_name, account_ref, body_override, first_comment, options_json, status, attempts, next_attempt_at, published_url, error, updated_at)
      VALUES
        (@id, @postId, @connectorName, @accountRef, @bodyOverride, @firstComment, @optionsJson, 'pending', 0, NULL, NULL, NULL, @updatedAt)
    `);
        // Targets are torn down and rebuilt on every edit, and post_comments cascades off target_id — so
        // without this snapshot, editing a scheduled post would silently delete its follow-up comments.
        // Re-key by connector so comments land back on the rebuilt target for the same channel.
        const carriedComments = new Map();
        if (exists) {
            const rows = this.db
                .prepare(`SELECT c.* FROM post_comments c
           JOIN post_targets t ON t.id = c.target_id
           WHERE c.post_id = ? ORDER BY c.position ASC`)
                .all(id);
            const connectorOf = new Map(this.db.prepare('SELECT id, connector_name FROM post_targets WHERE post_id = ?').all(id).map((row) => [row.id, row.connector_name]));
            for (const row of rows) {
                const connector = connectorOf.get(row.target_id);
                if (!connector)
                    continue;
                const bucket = carriedComments.get(connector) ?? [];
                bucket.push(row);
                carriedComments.set(connector, bucket);
            }
        }
        const restoreComment = this.db.prepare(`
      INSERT INTO post_comments
        (id, target_id, post_id, position, body, media_json, trigger_json, status, origin, source_snippet_id,
         artifact_id, remote_comment_id, remote_parent_id, provider_metadata_json, published_url, published_at,
         attempts, next_check_at, armed_at, error, created_at, updated_at)
      VALUES
        (@id, @target_id, @post_id, @position, @body, @media_json, @trigger_json, @status, @origin, @source_snippet_id,
         @artifact_id, @remote_comment_id, @remote_parent_id, @provider_metadata_json, @published_url, @published_at,
         @attempts, @next_check_at, @armed_at, @error, @created_at, @updated_at)
    `);
        const tx = this.db.transaction(() => {
            if (exists) {
                this.db
                    .prepare(`UPDATE scheduled_posts
             SET content_id = @contentId, body = @body, media_json = @mediaJson,
                 scheduled_at = @scheduledAt, timezone = @timezone, status = @status, updated_at = @updatedAt
             WHERE id = @id`)
                    .run({
                    id,
                    contentId: input.contentId ?? null,
                    body: input.body,
                    mediaJson: (0, json_1.safeStringify)(input.media ?? []),
                    scheduledAt: input.scheduledAt ?? null,
                    timezone: input.timezone ?? 'UTC',
                    status,
                    updatedAt: timestamp,
                });
                this.db.prepare('DELETE FROM post_targets WHERE post_id = ?').run(id);
            }
            else {
                this.db
                    .prepare(`INSERT INTO scheduled_posts
               (id, product_id, content_id, body, media_json, scheduled_at, timezone, status, created_at, updated_at)
             VALUES
               (@id, @productId, @contentId, @body, @mediaJson, @scheduledAt, @timezone, @status, @createdAt, @updatedAt)`)
                    .run({
                    id,
                    productId: input.productId,
                    contentId: input.contentId ?? null,
                    body: input.body,
                    mediaJson: (0, json_1.safeStringify)(input.media ?? []),
                    scheduledAt: input.scheduledAt ?? null,
                    timezone: input.timezone ?? 'UTC',
                    status,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                });
            }
            for (const target of input.targets) {
                const targetId = (0, id_1.createId)();
                insertTarget.run({
                    id: targetId,
                    postId: id,
                    connectorName: target.connectorName,
                    accountRef: target.accountRef ?? null,
                    bodyOverride: target.bodyOverride ?? null,
                    firstComment: target.firstComment ?? null,
                    optionsJson: (0, json_1.safeStringify)(target.options ?? {}),
                    updatedAt: timestamp,
                });
                for (const comment of carriedComments.get(target.connectorName) ?? []) {
                    restoreComment.run({ ...comment, target_id: targetId, post_id: id });
                }
            }
        });
        tx();
        return this.getScheduledPost(id);
    }
    updateScheduledPost(input) {
        const existing = this.getScheduledPost(input.id);
        if (!existing)
            return null;
        const merged = {
            body: input.body ?? existing.body,
            media: input.media ?? existing.media,
            scheduledAt: input.scheduledAt !== undefined ? input.scheduledAt : existing.scheduledAt,
            timezone: input.timezone ?? existing.timezone,
            status: input.status ?? existing.status,
        };
        this.db
            .prepare(`UPDATE scheduled_posts
         SET body = @body, media_json = @mediaJson, scheduled_at = @scheduledAt,
             timezone = @timezone, status = @status, updated_at = @updatedAt
         WHERE id = @id`)
            .run({
            id: input.id,
            body: merged.body,
            mediaJson: (0, json_1.safeStringify)(merged.media),
            scheduledAt: merged.scheduledAt,
            timezone: merged.timezone,
            status: merged.status,
            updatedAt: (0, time_1.now)(),
        });
        return this.getScheduledPost(input.id);
    }
    setScheduledPostStatus(id, status) {
        this.db.prepare('UPDATE scheduled_posts SET status = ?, updated_at = ? WHERE id = ?').run(status, (0, time_1.now)(), id);
        return this.getScheduledPost(id);
    }
    deleteScheduledPost(id) {
        const tx = this.db.transaction(() => {
            this.db.prepare('DELETE FROM post_publish_history WHERE post_id = ?').run(id);
            this.db.prepare('DELETE FROM post_targets WHERE post_id = ?').run(id);
            this.db.prepare('DELETE FROM scheduled_posts WHERE id = ?').run(id);
        });
        tx();
        return true;
    }
    updatePostTarget(id, patch) {
        const existing = this.db.prepare('SELECT * FROM post_targets WHERE id = ?').get(id);
        if (!existing)
            return;
        this.db
            .prepare(`UPDATE post_targets
         SET status = @status, attempts = @attempts, next_attempt_at = @nextAttemptAt,
             published_url = @publishedUrl, error = @error, updated_at = @updatedAt
         WHERE id = @id`)
            .run({
            id,
            status: patch.status ?? existing.status,
            attempts: patch.attempts ?? existing.attempts,
            nextAttemptAt: patch.nextAttemptAt !== undefined ? patch.nextAttemptAt : existing.next_attempt_at,
            publishedUrl: patch.publishedUrl !== undefined ? patch.publishedUrl : existing.published_url,
            error: patch.error !== undefined ? patch.error : existing.error,
            updatedAt: (0, time_1.now)(),
        });
    }
    createPostPublishHistory(input) {
        const id = (0, id_1.createId)();
        const publishedAt = (0, time_1.now)();
        this.db
            .prepare(`INSERT INTO post_publish_history (id, target_id, post_id, connector_name, published_url, published_at, response_json)
         VALUES (@id, @targetId, @postId, @connectorName, @publishedUrl, @publishedAt, @responseJson)`)
            .run({
            id,
            targetId: input.targetId,
            postId: input.postId,
            connectorName: input.connectorName,
            publishedUrl: input.publishedUrl,
            publishedAt,
            responseJson: (0, json_1.safeStringify)(input.response),
        });
        return {
            id,
            targetId: input.targetId,
            postId: input.postId,
            connectorName: input.connectorName,
            publishedUrl: input.publishedUrl,
            publishedAt,
            response: input.response,
        };
    }
    createDistributionEvent(input) {
        const id = (0, id_1.createId)();
        const createdAt = (0, time_1.now)();
        this.db
            .prepare(`INSERT INTO distribution_events
           (id, product_id, connector_name, event_type, status, post_id, target_id,
            message, published_url, error, metadata_json, created_at)
         VALUES
           (@id, @productId, @connectorName, @eventType, @status, @postId, @targetId,
            @message, @publishedUrl, @error, @metadataJson, @createdAt)`)
            .run({
            id,
            productId: input.productId ?? null,
            connectorName: input.connectorName,
            eventType: input.eventType,
            status: input.status,
            postId: input.postId ?? null,
            targetId: input.targetId ?? null,
            message: input.message,
            publishedUrl: input.publishedUrl ?? null,
            error: input.error ?? null,
            metadataJson: (0, json_1.safeStringify)(input.metadata ?? {}),
            createdAt,
        });
        const row = this.db.prepare('SELECT * FROM distribution_events WHERE id = ?').get(id);
        return mapDistributionEvent(row);
    }
    listDistributionEvents(options = {}) {
        const where = [];
        const args = [];
        if (options.productId) {
            where.push('product_id = ?');
            args.push(options.productId);
        }
        if (options.postId) {
            where.push('post_id = ?');
            args.push(options.postId);
        }
        if (options.targetId) {
            where.push('target_id = ?');
            args.push(options.targetId);
        }
        if (options.connectorName && options.connectorName !== 'all') {
            where.push('connector_name = ?');
            args.push(options.connectorName);
        }
        if (options.eventType && options.eventType !== 'all') {
            where.push('event_type = ?');
            args.push(options.eventType);
        }
        if (options.status && options.status !== 'all') {
            where.push('status = ?');
            args.push(options.status);
        }
        if (typeof options.from === 'number') {
            where.push('created_at >= ?');
            args.push(options.from);
        }
        if (typeof options.to === 'number') {
            where.push('created_at <= ?');
            args.push(options.to);
        }
        const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        return this.db
            .prepare(`SELECT * FROM distribution_events ${whereSql} ORDER BY created_at DESC LIMIT ?`)
            .all(...args, limit).map(mapDistributionEvent);
    }
    createSeoOpportunity(input) {
        const id = (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO seo_opportunities
          (id, product_id, keyword, type, score, brief, status, metrics_json, created_at, updated_at)
        VALUES
          (@id, @productId, @keyword, @type, @score, @brief, @status, @metricsJson, @createdAt, @updatedAt)
      `)
            .run({
            id,
            productId: input.productId,
            keyword: input.keyword,
            type: input.type,
            score: input.score,
            brief: input.brief,
            status: input.status ?? 'open',
            metricsJson: (0, json_1.safeStringify)(input.metrics ?? {}),
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        return this.getSeoOpportunity(id);
    }
    getSeoOpportunity(id) {
        const row = this.db.prepare('SELECT * FROM seo_opportunities WHERE id = ?').get(id);
        return row ? mapSeoOpportunity(row) : null;
    }
    listSeoOpportunities(productId) {
        if (productId) {
            return this.db
                .prepare('SELECT * FROM seo_opportunities WHERE product_id = ? ORDER BY score DESC, created_at DESC')
                .all(productId).map(mapSeoOpportunity);
        }
        return this.db.prepare('SELECT * FROM seo_opportunities ORDER BY score DESC, created_at DESC').all().map(mapSeoOpportunity);
    }
    updateSeoOpportunityStatus(id, status) {
        this.db
            .prepare('UPDATE seo_opportunities SET status = ?, updated_at = ? WHERE id = ?')
            .run(status, (0, time_1.now)(), id);
        return this.getSeoOpportunity(id);
    }
    createRankSnapshot(input) {
        const id = (0, id_1.createId)();
        this.db
            .prepare(`
        INSERT INTO rank_snapshots
          (id, product_id, keyword, position, clicks, impressions, ctr, source, date)
        VALUES
          (@id, @productId, @keyword, @position, @clicks, @impressions, @ctr, @source, @date)
      `)
            .run({
            id,
            productId: input.productId,
            keyword: input.keyword,
            position: input.position,
            clicks: input.clicks,
            impressions: input.impressions,
            ctr: input.ctr,
            source: input.source,
            date: input.date,
        });
        return this.getRankSnapshot(id);
    }
    getRankSnapshot(id) {
        const row = this.db.prepare('SELECT * FROM rank_snapshots WHERE id = ?').get(id);
        return row ? mapRankSnapshot(row) : null;
    }
    listRankSnapshots(productId, limit = 250) {
        if (productId) {
            return this.db
                .prepare('SELECT * FROM rank_snapshots WHERE product_id = ? ORDER BY date DESC LIMIT ?')
                .all(productId, limit).map(mapRankSnapshot);
        }
        return this.db.prepare('SELECT * FROM rank_snapshots ORDER BY date DESC LIMIT ?').all(limit).map(mapRankSnapshot);
    }
    getLatestSnapshotForKeyword(productId, keyword) {
        const row = this.db
            .prepare(`
        SELECT * FROM rank_snapshots
        WHERE product_id = ? AND keyword = ?
        ORDER BY date DESC
        LIMIT 1
      `)
            .get(productId, keyword);
        return row ? mapRankSnapshot(row) : null;
    }
    createRankAlert(input) {
        const id = (0, id_1.createId)();
        this.db
            .prepare(`
        INSERT INTO rank_alerts
          (id, product_id, keyword, old_position, new_position, delta, severity, message, acknowledged, created_at)
        VALUES
          (@id, @productId, @keyword, @oldPosition, @newPosition, @delta, @severity, @message, 0, @createdAt)
      `)
            .run({
            id,
            productId: input.productId,
            keyword: input.keyword,
            oldPosition: input.oldPosition,
            newPosition: input.newPosition,
            delta: input.delta,
            severity: input.severity,
            message: input.message,
            createdAt: (0, time_1.now)(),
        });
        return this.getRankAlert(id);
    }
    getRankAlert(id) {
        const row = this.db.prepare('SELECT * FROM rank_alerts WHERE id = ?').get(id);
        return row ? mapRankAlert(row) : null;
    }
    listRankAlerts(productId, includeAcknowledged = true) {
        if (productId) {
            const base = includeAcknowledged
                ? 'SELECT * FROM rank_alerts WHERE product_id = ? ORDER BY created_at DESC'
                : 'SELECT * FROM rank_alerts WHERE product_id = ? AND acknowledged = 0 ORDER BY created_at DESC';
            return this.db.prepare(base).all(productId).map(mapRankAlert);
        }
        const base = includeAcknowledged
            ? 'SELECT * FROM rank_alerts ORDER BY created_at DESC'
            : 'SELECT * FROM rank_alerts WHERE acknowledged = 0 ORDER BY created_at DESC';
        return this.db.prepare(base).all().map(mapRankAlert);
    }
    acknowledgeRankAlert(id) {
        this.db.prepare('UPDATE rank_alerts SET acknowledged = 1 WHERE id = ?').run(id);
        return this.getRankAlert(id);
    }
    createDomainAuthority(input) {
        const id = (0, id_1.createId)();
        const checkedAt = (0, time_1.now)();
        this.db
            .prepare(`INSERT INTO domain_authority
         (id, product_id, domain, domain_rating, url_rating, backlinks, linking_websites, source, checked_at)
         VALUES (@id, @productId, @domain, @domainRating, @urlRating, @backlinks, @linkingWebsites, @source, @checkedAt)`)
            .run({
            id,
            productId: input.productId,
            domain: input.domain,
            domainRating: input.domainRating,
            urlRating: input.urlRating,
            backlinks: input.backlinks,
            linkingWebsites: input.linkingWebsites,
            source: input.source ?? 'ahrefs',
            checkedAt,
        });
        return this.getDomainAuthority(id);
    }
    getDomainAuthority(id) {
        const row = this.db.prepare('SELECT * FROM domain_authority WHERE id = ?').get(id);
        return row ? mapDomainAuthority(row) : null;
    }
    listDomainAuthority(productId, limit = 100) {
        if (productId) {
            return this.db
                .prepare('SELECT * FROM domain_authority WHERE product_id = ? ORDER BY checked_at DESC LIMIT ?')
                .all(productId, limit).map(mapDomainAuthority);
        }
        return this.db.prepare('SELECT * FROM domain_authority ORDER BY checked_at DESC LIMIT ?').all(limit).map(mapDomainAuthority);
    }
    getLatestDomainAuthority(productId, domain, source) {
        const row = source
            ? this.db
                .prepare(`SELECT * FROM domain_authority
             WHERE product_id = ? AND domain = ? AND source = ?
             ORDER BY checked_at DESC
             LIMIT 1`)
                .get(productId, domain, source)
            : this.db
                .prepare(`SELECT * FROM domain_authority
             WHERE product_id = ? AND domain = ?
             ORDER BY checked_at DESC
             LIMIT 1`)
                .get(productId, domain);
        return row ? mapDomainAuthority(row) : null;
    }
    getAutomationAccount(provider) {
        const row = this.db
            .prepare('SELECT * FROM automation_accounts WHERE provider = ?')
            .get(provider);
        return row ? mapAutomationAccount(row) : null;
    }
    upsertAutomationAccount(input) {
        const existing = this.getAutomationAccount(input.provider);
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO automation_accounts (
          provider, email, display_name, avatar_url, profile_url, session_partition, status, metadata_json, last_synced_at, created_at, updated_at
        ) VALUES (
          @provider, @email, @displayName, @avatarUrl, @profileUrl, @sessionPartition, @status, @metadataJson, @lastSyncedAt, @createdAt, @updatedAt
        )
        ON CONFLICT(provider) DO UPDATE SET
          email = excluded.email,
          display_name = excluded.display_name,
          avatar_url = excluded.avatar_url,
          profile_url = excluded.profile_url,
          session_partition = excluded.session_partition,
          status = excluded.status,
          metadata_json = excluded.metadata_json,
          last_synced_at = excluded.last_synced_at,
          updated_at = excluded.updated_at
      `)
            .run({
            provider: input.provider,
            email: input.email ?? null,
            displayName: input.displayName ?? null,
            avatarUrl: input.avatarUrl ?? null,
            profileUrl: input.profileUrl ?? null,
            sessionPartition: input.sessionPartition,
            status: input.status,
            metadataJson: (0, json_1.safeStringify)(input.metadata ?? {}),
            lastSyncedAt: input.lastSyncedAt ?? null,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        });
        return this.getAutomationAccount(input.provider);
    }
    deleteAutomationAccount(provider) {
        const result = this.db.prepare('DELETE FROM automation_accounts WHERE provider = ?').run(provider);
        return result.changes > 0;
    }
    createBrowserCapture(input) {
        const id = (0, id_1.createId)();
        const createdAt = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO browser_captures
          (id, matched_product_id, source, hostname, url, title, page_text, metadata_json, created_at)
        VALUES
          (@id, @matchedProductId, @source, @hostname, @url, @title, @pageText, @metadataJson, @createdAt)
      `)
            .run({
            id,
            matchedProductId: input.matchedProductId ?? null,
            source: input.source,
            hostname: input.hostname,
            url: input.url,
            title: input.title,
            pageText: input.pageText,
            metadataJson: (0, json_1.safeStringify)(input.metadata ?? {}),
            createdAt,
        });
        return this.getBrowserCapture(id);
    }
    getBrowserCapture(id) {
        const row = this.db.prepare('SELECT * FROM browser_captures WHERE id = ?').get(id);
        return row ? mapBrowserCapture(row) : null;
    }
    listBrowserCaptures(productId, limit = 20) {
        if (productId) {
            return this.db
                .prepare('SELECT * FROM browser_captures WHERE matched_product_id = ? ORDER BY created_at DESC LIMIT ?')
                .all(productId, limit).map(mapBrowserCapture);
        }
        return this.db.prepare('SELECT * FROM browser_captures ORDER BY created_at DESC LIMIT ?').all(limit).map(mapBrowserCapture);
    }
    createSyncLog(input) {
        const id = (0, id_1.createId)();
        const createdAt = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO sync_logs
          (id, source, label, status, product_id, summary, items_succeeded, items_failed, details_json, duration_ms, created_at)
        VALUES
          (@id, @source, @label, @status, @productId, @summary, @itemsSucceeded, @itemsFailed, @detailsJson, @durationMs, @createdAt)
      `)
            .run({
            id,
            source: input.source,
            label: input.label,
            status: input.status,
            productId: input.productId ?? null,
            summary: input.summary,
            itemsSucceeded: input.itemsSucceeded ?? 0,
            itemsFailed: input.itemsFailed ?? 0,
            detailsJson: (0, json_1.safeStringify)({
                succeeded: input.details?.succeeded ?? [],
                failed: input.details?.failed ?? [],
                errors: input.details?.errors ?? [],
            }),
            durationMs: input.durationMs ?? null,
            createdAt,
        });
        const row = this.db.prepare('SELECT * FROM sync_logs WHERE id = ?').get(id);
        return mapSyncLog(row);
    }
    listSyncLogs(options) {
        const limit = options?.limit ?? 100;
        if (options?.source) {
            return this.db
                .prepare('SELECT * FROM sync_logs WHERE source = ? ORDER BY created_at DESC LIMIT ?')
                .all(options.source, limit).map(mapSyncLog);
        }
        return this.db.prepare('SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT ?').all(limit).map(mapSyncLog);
    }
    clearSyncLogs(source) {
        const result = source
            ? this.db.prepare('DELETE FROM sync_logs WHERE source = ?').run(source)
            : this.db.prepare('DELETE FROM sync_logs').run();
        return result.changes;
    }
    clearSyncLogsBefore(cutoff) {
        return this.db.prepare('DELETE FROM sync_logs WHERE created_at < ?').run(cutoff).changes;
    }
    recordIndexNowSubmissions(input) {
        const insert = this.db.prepare(`
      INSERT INTO indexnow_submissions
        (id, batch_id, product_id, host, url, endpoint, submit_status, http_status, submitted_at, index_status, indexed_at, index_checked_at, index_detail)
      VALUES
        (@id, @batchId, @productId, @host, @url, @endpoint, @submitStatus, @httpStatus, @submittedAt, 'unknown', NULL, NULL, NULL)
    `);
        const ids = [];
        const tx = this.db.transaction((entries) => {
            for (const entry of entries) {
                const id = (0, id_1.createId)();
                ids.push(id);
                insert.run({
                    id,
                    batchId: input.batchId,
                    productId: input.productId ?? null,
                    host: input.host,
                    url: entry.url,
                    endpoint: input.endpoint,
                    submitStatus: entry.submitStatus,
                    httpStatus: entry.httpStatus ?? null,
                    submittedAt: input.submittedAt,
                });
            }
        });
        tx(input.entries);
        return ids
            .map((id) => this.getIndexNowSubmission(id))
            .filter((record) => record !== null);
    }
    getIndexNowSubmission(id) {
        const row = this.db.prepare('SELECT * FROM indexnow_submissions WHERE id = ?').get(id);
        return row ? mapIndexNowSubmission(row) : null;
    }
    listIndexNowSubmissions(options) {
        const limit = options?.limit ?? 200;
        const rows = options?.productId
            ? this.db
                .prepare('SELECT * FROM indexnow_submissions WHERE product_id = ? ORDER BY submitted_at DESC, rowid DESC LIMIT ?')
                .all(options.productId, limit)
            : this.db
                .prepare('SELECT * FROM indexnow_submissions ORDER BY submitted_at DESC, rowid DESC LIMIT ?')
                .all(limit);
        return rows.map(mapIndexNowSubmission);
    }
    updateIndexNowIndexStatus(id, update) {
        const existing = this.getIndexNowSubmission(id);
        if (!existing)
            return null;
        // Stamp the indexed date once, the first time we observe it indexed.
        const indexedAt = update.indexStatus === 'indexed'
            ? existing.indexedAt ?? update.indexedAt ?? update.indexCheckedAt
            : update.indexedAt === undefined
                ? existing.indexedAt
                : update.indexedAt;
        this.db
            .prepare(`
        UPDATE indexnow_submissions
        SET index_status = @indexStatus, indexed_at = @indexedAt, index_checked_at = @indexCheckedAt, index_detail = @indexDetail
        WHERE id = @id
      `)
            .run({
            id,
            indexStatus: update.indexStatus,
            indexedAt: indexedAt ?? null,
            indexCheckedAt: update.indexCheckedAt,
            indexDetail: update.indexDetail ?? existing.indexDetail ?? null,
        });
        return this.getIndexNowSubmission(id);
    }
    clearIndexNowSubmissions(productId) {
        const result = productId
            ? this.db.prepare('DELETE FROM indexnow_submissions WHERE product_id = ?').run(productId)
            : this.db.prepare('DELETE FROM indexnow_submissions').run();
        return result.changes;
    }
    recordGoogleIndexRequests(input) {
        const insert = this.db.prepare(`
      INSERT INTO google_index_requests
        (id, batch_id, product_id, property_url, url, request_type, submit_status, notify_time, submitted_at, error)
      VALUES
        (@id, @batchId, @productId, @propertyUrl, @url, @requestType, @submitStatus, @notifyTime, @submittedAt, @error)
    `);
        const ids = [];
        const tx = this.db.transaction((entries) => {
            for (const entry of entries) {
                const id = (0, id_1.createId)();
                ids.push(id);
                insert.run({
                    id,
                    batchId: input.batchId,
                    productId: input.productId ?? null,
                    propertyUrl: input.propertyUrl,
                    url: entry.url,
                    requestType: input.requestType,
                    submitStatus: entry.submitStatus,
                    notifyTime: entry.notifyTime ?? null,
                    submittedAt: input.submittedAt,
                    error: entry.error ?? null,
                });
            }
        });
        tx(input.entries);
        return ids
            .map((id) => this.getGoogleIndexRequest(id))
            .filter((record) => record !== null);
    }
    getGoogleIndexRequest(id) {
        const row = this.db.prepare('SELECT * FROM google_index_requests WHERE id = ?').get(id);
        return row ? mapGoogleIndexRequest(row) : null;
    }
    listGoogleIndexRequests(options) {
        const limit = options?.limit ?? 200;
        const rows = options?.productId
            ? this.db
                .prepare('SELECT * FROM google_index_requests WHERE product_id = ? ORDER BY submitted_at DESC, rowid DESC LIMIT ?')
                .all(options.productId, limit)
            : this.db
                .prepare('SELECT * FROM google_index_requests ORDER BY submitted_at DESC, rowid DESC LIMIT ?')
                .all(limit);
        return rows.map(mapGoogleIndexRequest);
    }
    clearGoogleIndexRequests(productId) {
        const result = productId
            ? this.db.prepare('DELETE FROM google_index_requests WHERE product_id = ?').run(productId)
            : this.db.prepare('DELETE FROM google_index_requests').run();
        return result.changes;
    }
    /** Cached URL Inspection results for a property, keyed by URL, for the requested URLs only. */
    getGoogleIndexInspections(propertyUrl, urls) {
        const result = new Map();
        const unique = Array.from(new Set(urls.filter(Boolean)));
        if (!propertyUrl || unique.length === 0)
            return result;
        // Chunk to stay well under SQLite's bound-parameter limit for very large pages.
        for (let i = 0; i < unique.length; i += 400) {
            const chunk = unique.slice(i, i + 400);
            const placeholders = chunk.map(() => '?').join(', ');
            const rows = this.db
                .prepare(`SELECT * FROM google_index_inspections WHERE property_url = ? AND url IN (${placeholders})`)
                .all(propertyUrl, ...chunk);
            for (const row of rows)
                result.set(row.url, mapGoogleIndexInspection(row));
        }
        return result;
    }
    /** Insert or refresh cached URL Inspection results (skips entries that failed to inspect). */
    upsertGoogleIndexInspections(propertyUrl, productId, entries) {
        const insert = this.db.prepare(`
      INSERT INTO google_index_inspections
        (property_url, url, product_id, verdict, coverage_state, indexing_state, last_crawl_time, inspection_link, error, checked_at)
      VALUES
        (@propertyUrl, @url, @productId, @verdict, @coverageState, @indexingState, @lastCrawlTime, @inspectionLink, @error, @checkedAt)
      ON CONFLICT(property_url, url) DO UPDATE SET
        product_id = excluded.product_id,
        verdict = excluded.verdict,
        coverage_state = excluded.coverage_state,
        indexing_state = excluded.indexing_state,
        last_crawl_time = excluded.last_crawl_time,
        inspection_link = excluded.inspection_link,
        error = excluded.error,
        checked_at = excluded.checked_at
    `);
        const tx = this.db.transaction((rows) => {
            for (const entry of rows) {
                // Don't cache failures — a transient error should be retried, not remembered.
                if (entry.error)
                    continue;
                insert.run({
                    propertyUrl,
                    url: entry.url,
                    productId,
                    verdict: entry.verdict,
                    coverageState: entry.coverageState,
                    indexingState: entry.indexingState,
                    lastCrawlTime: entry.lastCrawlTime,
                    inspectionLink: entry.inspectionLink,
                    error: null,
                    checkedAt: entry.checkedAt,
                });
            }
        });
        tx(entries);
    }
    clearGoogleIndexInspections(productId) {
        const result = productId
            ? this.db.prepare('DELETE FROM google_index_inspections WHERE product_id = ?').run(productId)
            : this.db.prepare('DELETE FROM google_index_inspections').run();
        return result.changes;
    }
    createAiLog(input) {
        const id = (0, id_1.createId)();
        const createdAt = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO ai_logs
          (id, kind, agent, tool, transport, status, summary, detail, product_id, duration_ms, exit_code, tokens, tokens_input, tokens_output, created_at)
        VALUES
          (@id, @kind, @agent, @tool, @transport, @status, @summary, @detail, @productId, @durationMs, @exitCode, @tokens, @tokensInput, @tokensOutput, @createdAt)
      `)
            .run({
            id,
            kind: input.kind,
            agent: input.agent,
            tool: input.tool ?? null,
            transport: input.transport ?? null,
            status: input.status,
            summary: input.summary,
            detail: input.detail ?? null,
            productId: input.productId ?? null,
            durationMs: input.durationMs ?? null,
            exitCode: input.exitCode ?? null,
            tokens: input.tokens ?? null,
            tokensInput: input.tokensInput ?? null,
            tokensOutput: input.tokensOutput ?? null,
            createdAt,
        });
        const row = this.db.prepare('SELECT * FROM ai_logs WHERE id = ?').get(id);
        return mapAiLog(row);
    }
    listAiLogs(options) {
        const limit = options?.limit ?? 100;
        if (options?.kind) {
            return this.db
                .prepare('SELECT * FROM ai_logs WHERE kind = ? ORDER BY created_at DESC LIMIT ?')
                .all(options.kind, limit).map(mapAiLog);
        }
        return this.db.prepare('SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT ?').all(limit).map(mapAiLog);
    }
    clearAiLogs(kind) {
        const result = kind
            ? this.db.prepare('DELETE FROM ai_logs WHERE kind = ?').run(kind)
            : this.db.prepare('DELETE FROM ai_logs').run();
        return result.changes;
    }
    clearAiLogsBefore(cutoff) {
        return this.db.prepare('DELETE FROM ai_logs WHERE created_at < ?').run(cutoff).changes;
    }
    createApiLog(input) {
        const id = (0, id_1.createId)();
        const createdAt = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO api_logs
          (id, provider, method, path, status, status_code, summary, detail, request_body, response_body, cost, duration_ms, created_at)
        VALUES
          (@id, @provider, @method, @path, @status, @statusCode, @summary, @detail, @requestBody, @responseBody, @cost, @durationMs, @createdAt)
      `)
            .run({
            id,
            provider: input.provider,
            method: input.method,
            path: input.path,
            status: input.status,
            statusCode: input.statusCode ?? null,
            summary: input.summary,
            detail: input.detail ?? null,
            requestBody: input.requestBody ?? null,
            responseBody: input.responseBody ?? null,
            cost: input.cost ?? null,
            durationMs: input.durationMs ?? null,
            createdAt,
        });
        const row = this.db.prepare('SELECT * FROM api_logs WHERE id = ?').get(id);
        return mapApiLog(row);
    }
    listApiLogs(options) {
        const limit = options?.limit ?? 200;
        if (options?.provider) {
            return this.db
                .prepare('SELECT * FROM api_logs WHERE provider = ? ORDER BY created_at DESC LIMIT ?')
                .all(options.provider, limit).map(mapApiLog);
        }
        return this.db.prepare('SELECT * FROM api_logs ORDER BY created_at DESC LIMIT ?').all(limit).map(mapApiLog);
    }
    /** Count a provider's API calls since `since` (epoch ms). Uses the (provider, created_at) index. */
    countApiLogsSince(provider, since) {
        const row = this.db
            .prepare('SELECT COUNT(*) AS count FROM api_logs WHERE provider = ? AND created_at >= ?')
            .get(provider, since);
        return row?.count ?? 0;
    }
    clearApiLogs(provider) {
        const result = provider
            ? this.db.prepare('DELETE FROM api_logs WHERE provider = ?').run(provider)
            : this.db.prepare('DELETE FROM api_logs').run();
        return result.changes;
    }
    clearApiLogsBefore(cutoff) {
        return this.db.prepare('DELETE FROM api_logs WHERE created_at < ?').run(cutoff).changes;
    }
    clearKeywordPlannerCacheBefore(cutoff) {
        return this.db.prepare('DELETE FROM keyword_planner_cache WHERE fetched_at < ?').run(cutoff).changes;
    }
    clearKeywordPlannerCache() {
        return this.db.prepare('DELETE FROM keyword_planner_cache').run().changes;
    }
    getKeywordPlannerCache(cacheKey) {
        const row = this.db.prepare('SELECT * FROM keyword_planner_cache WHERE cache_key = ?').get(cacheKey);
        if (!row)
            return null;
        return {
            location: row.location,
            currency: row.currency,
            keywords: (0, json_1.safeParseJson)(row.keywords_json, []),
            results: (0, json_1.safeParseJson)(row.results_json, []),
            fetchedAt: row.fetched_at,
        };
    }
    saveKeywordPlannerCache(cacheKey, entry) {
        this.db
            .prepare(`
        INSERT INTO keyword_planner_cache (cache_key, location, currency, keywords_json, results_json, fetched_at)
        VALUES (@cacheKey, @location, @currency, @keywordsJson, @resultsJson, @fetchedAt)
        ON CONFLICT(cache_key) DO UPDATE SET
          location = excluded.location,
          currency = excluded.currency,
          keywords_json = excluded.keywords_json,
          results_json = excluded.results_json,
          fetched_at = excluded.fetched_at
      `)
            .run({
            cacheKey,
            location: entry.location,
            currency: entry.currency,
            keywordsJson: (0, json_1.safeStringify)(entry.keywords),
            resultsJson: (0, json_1.safeStringify)(entry.results),
            fetchedAt: entry.fetchedAt,
        });
    }
    attachLatestDomainAuthority(product) {
        const latest = this.getLatestDomainAuthority(product.id, (0, domain_1.extractDomain)(product.url));
        return {
            ...product,
            latestDomain: latest?.domain ?? null,
            latestDomainRating: latest?.domainRating ?? null,
            latestDomainUrlRating: latest?.urlRating ?? null,
            latestDomainBacklinks: latest?.backlinks ?? null,
            latestDomainLinkingWebsites: latest?.linkingWebsites ?? null,
            latestDomainSource: latest?.source ?? null,
            latestDomainCheckedAt: latest?.checkedAt ?? null,
        };
    }
    listDirectories(activeOnly = false) {
        const sql = activeOnly
            ? 'SELECT * FROM directories WHERE active = 1 ORDER BY da DESC'
            : 'SELECT * FROM directories ORDER BY da DESC';
        return this.db.prepare(sql).all().map(mapDirectory);
    }
    getDirectory(id) {
        const row = this.db.prepare('SELECT * FROM directories WHERE id = ?').get(id);
        return row ? mapDirectory(row) : null;
    }
    createDirectorySubmission(input) {
        const id = (0, id_1.createId)();
        this.db
            .prepare(`
        INSERT INTO directory_submissions
          (id, product_id, directory_id, directory_name, status, method, submitted_at, listed_at, listing_url, rejection_reason, backlink_score, metadata_json)
        VALUES
          (@id, @productId, @directoryId, @directoryName, @status, @method, @submittedAt, @listedAt, @listingUrl, @rejectionReason, @backlinkScore, @metadataJson)
      `)
            .run({
            id,
            productId: input.productId,
            directoryId: input.directoryId,
            directoryName: input.directoryName,
            status: input.status,
            method: input.method,
            submittedAt: input.submittedAt ?? null,
            listedAt: input.listedAt ?? null,
            listingUrl: input.listingUrl ?? null,
            rejectionReason: input.rejectionReason ?? null,
            backlinkScore: input.backlinkScore,
            metadataJson: (0, json_1.safeStringify)(input.metadata ?? {}),
        });
        return this.getDirectorySubmission(id);
    }
    getDirectorySubmission(id) {
        const row = this.db.prepare('SELECT * FROM directory_submissions WHERE id = ?').get(id);
        return row ? mapDirectorySubmission(row) : null;
    }
    findSubmissionByProductAndDirectory(productId, directoryId) {
        const row = this.db
            .prepare('SELECT * FROM directory_submissions WHERE product_id = ? AND directory_id = ? LIMIT 1')
            .get(productId, directoryId);
        return row ? mapDirectorySubmission(row) : null;
    }
    updateDirectorySubmission(id, update) {
        const existing = this.getDirectorySubmission(id);
        if (!existing)
            return null;
        const merged = {
            ...existing,
            status: update.status ?? existing.status,
            submittedAt: Object.prototype.hasOwnProperty.call(update, 'submittedAt')
                ? update.submittedAt ?? null
                : existing.submittedAt,
            listedAt: Object.prototype.hasOwnProperty.call(update, 'listedAt') ? update.listedAt ?? null : existing.listedAt,
            listingUrl: Object.prototype.hasOwnProperty.call(update, 'listingUrl') ? update.listingUrl ?? null : existing.listingUrl,
            rejectionReason: Object.prototype.hasOwnProperty.call(update, 'rejectionReason')
                ? update.rejectionReason ?? null
                : existing.rejectionReason,
            metadata: update.metadata ?? existing.metadata,
        };
        this.db
            .prepare(`
        UPDATE directory_submissions
        SET status = @status,
            submitted_at = @submittedAt,
            listed_at = @listedAt,
            listing_url = @listingUrl,
            rejection_reason = @rejectionReason,
            metadata_json = @metadataJson
        WHERE id = @id
      `)
            .run({
            id,
            status: merged.status,
            submittedAt: merged.submittedAt,
            listedAt: merged.listedAt,
            listingUrl: merged.listingUrl,
            rejectionReason: merged.rejectionReason,
            metadataJson: (0, json_1.safeStringify)(merged.metadata),
        });
        return this.getDirectorySubmission(id);
    }
    upsertDirectorySubmissionStatus(input) {
        const directory = this.getDirectory(input.directoryId);
        if (!directory) {
            throw new Error('Directory not found.');
        }
        const existing = this.findSubmissionByProductAndDirectory(input.productId, input.directoryId);
        const timestamp = Date.now();
        const submittedAt = input.status === 'not_submitted' ? null : existing?.submittedAt ?? timestamp;
        const listedAt = input.status === 'listed' ? existing?.listedAt ?? timestamp : null;
        if (existing) {
            return this.updateDirectorySubmission(existing.id, {
                status: input.status,
                submittedAt,
                listedAt,
                listingUrl: input.status === 'not_submitted' ? null : existing.listingUrl,
                rejectionReason: input.status === 'not_submitted' ? null : existing.rejectionReason,
                metadata: {
                    ...existing.metadata,
                    ...(input.metadata ?? {}),
                    manualTracked: true,
                    manuallyUpdatedAt: timestamp,
                },
            });
        }
        return this.createDirectorySubmission({
            productId: input.productId,
            directoryId: directory.id,
            directoryName: directory.name,
            method: directory.method,
            status: input.status,
            submittedAt,
            listedAt,
            backlinkScore: directory.domainRating ?? directory.da,
            metadata: {
                ...(input.metadata ?? {}),
                manualTracked: true,
                manuallyUpdatedAt: timestamp,
            },
        });
    }
    listDirectorySubmissions(productId) {
        if (productId) {
            return this.db
                .prepare('SELECT * FROM directory_submissions WHERE product_id = ? ORDER BY COALESCE(submitted_at, 0) DESC')
                .all(productId).map(mapDirectorySubmission);
        }
        return this.db
            .prepare('SELECT * FROM directory_submissions ORDER BY COALESCE(submitted_at, 0) DESC')
            .all().map(mapDirectorySubmission);
    }
    createNotification(input) {
        const id = (0, id_1.createId)();
        this.db
            .prepare(`
        INSERT INTO notifications
          (id, kind, severity, title, body, product_id, workspace_id, route_json, meta_json, dedupe_key, read_at, created_at)
        VALUES
          (@id, @kind, @severity, @title, @body, @productId, @workspaceId, @routeJson, @metaJson, @dedupeKey, NULL, @createdAt)
      `)
            .run({
            id,
            kind: input.kind,
            severity: input.severity,
            title: input.title,
            body: input.body,
            productId: input.productId,
            workspaceId: input.workspaceId,
            routeJson: input.route ? (0, json_1.safeStringify)(input.route) : null,
            metaJson: (0, json_1.safeStringify)(input.meta ?? {}),
            dedupeKey: input.dedupeKey,
            createdAt: (0, time_1.now)(),
        });
        return this.getNotification(id);
    }
    getNotification(id) {
        const row = this.db.prepare('SELECT * FROM notifications WHERE id = ?').get(id);
        return row ? mapNotification(row) : null;
    }
    listNotifications(options = {}) {
        const clauses = [];
        const params = [];
        if (options.unreadOnly)
            clauses.push('read_at IS NULL');
        if (options.productId) {
            clauses.push('product_id = ?');
            params.push(options.productId);
        }
        const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
        params.push(Math.max(1, Math.min(options.limit ?? 100, 500)));
        return this.db
            .prepare(`SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT ?`)
            .all(...params).map(mapNotification);
    }
    /** Most recent alert carrying `dedupeKey` that is newer than `since`, used to suppress repeats. */
    findRecentNotificationByDedupeKey(dedupeKey, since) {
        const row = this.db
            .prepare('SELECT * FROM notifications WHERE dedupe_key = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1')
            .get(dedupeKey, since);
        return row ? mapNotification(row) : null;
    }
    countUnreadNotifications() {
        const row = this.db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NULL').get();
        return row?.count ?? 0;
    }
    markNotificationRead(id, read = true) {
        this.db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(read ? (0, time_1.now)() : null, id);
        return this.getNotification(id);
    }
    markAllNotificationsRead() {
        return this.db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run((0, time_1.now)()).changes;
    }
    deleteNotification(id) {
        return this.db.prepare('DELETE FROM notifications WHERE id = ?').run(id).changes > 0;
    }
    clearNotifications() {
        return this.db.prepare('DELETE FROM notifications').run().changes;
    }
    /** Keep the inbox bounded; the newest `keep` rows survive. */
    trimNotifications(keep) {
        return this.db
            .prepare(`DELETE FROM notifications WHERE id NOT IN (
           SELECT id FROM notifications ORDER BY created_at DESC LIMIT ?
         )`)
            .run(Math.max(1, keep)).changes;
    }
    listSettings() {
        return this.db.prepare('SELECT * FROM settings ORDER BY key ASC').all().map(mapSetting);
    }
    getSetting(key) {
        const row = this.db.prepare('SELECT * FROM settings WHERE key = ?').get(key);
        return row ? mapSetting(row) : null;
    }
    setSetting(key, value) {
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`
        INSERT INTO settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `)
            .run(key, (0, json_1.safeStringify)(value), timestamp);
        return this.getSetting(key);
    }
    listAiProviderProfiles() {
        return this.db
            .prepare('SELECT * FROM ai_provider_profiles ORDER BY sort_order ASC, updated_at DESC')
            .all().map(mapAiProviderProfile);
    }
    getAiProviderProfile(id) {
        const row = this.db.prepare('SELECT * FROM ai_provider_profiles WHERE id = ?').get(id);
        return row ? mapAiProviderProfile(row) : null;
    }
    upsertAiProviderProfile(input) {
        const id = input.id?.trim() || (0, id_1.createId)();
        const existing = this.getAiProviderProfile(id);
        const timestamp = (0, time_1.now)();
        const label = (input.label ?? existing?.label ?? '').trim() || defaultAiProviderLabel(input.provider);
        const baseUrl = (input.baseUrl ?? existing?.baseUrl ?? defaultAiProviderBaseUrl(input.provider)).trim();
        const defaultModel = (input.defaultModel ?? existing?.defaultModel ?? defaultAiProviderModel(input.provider)).trim();
        const enabled = input.enabled ?? existing?.enabled ?? false;
        const useWithOpenCode = input.useWithOpenCode ?? existing?.useWithOpenCode ?? false;
        if (!defaultModel)
            throw new Error('Model is required.');
        this.db
            .prepare(`
        INSERT INTO ai_provider_profiles (
          id, provider, label, gateway_preset, base_url, default_model, memory_model,
          max_tokens, headers_json, enabled, use_with_opencode, sort_order,
          last_tested_at, last_error, created_at, updated_at
        )
        VALUES (
          @id, @provider, @label, @gatewayPreset, @baseUrl, @defaultModel, @memoryModel,
          @maxTokens, @headersJson, @enabled, @useWithOpenCode, @sortOrder,
          @lastTestedAt, @lastError, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          provider = excluded.provider,
          label = excluded.label,
          gateway_preset = excluded.gateway_preset,
          base_url = excluded.base_url,
          default_model = excluded.default_model,
          memory_model = excluded.memory_model,
          max_tokens = excluded.max_tokens,
          headers_json = excluded.headers_json,
          enabled = excluded.enabled,
          use_with_opencode = excluded.use_with_opencode,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at
      `)
            .run({
            id,
            provider: input.provider,
            label,
            gatewayPreset: input.gatewayPreset !== undefined ? input.gatewayPreset : existing?.gatewayPreset ?? null,
            baseUrl,
            defaultModel,
            memoryModel: input.memoryModel !== undefined ? input.memoryModel?.trim() || null : existing?.memoryModel ?? null,
            maxTokens: input.maxTokens !== undefined ? input.maxTokens : existing?.maxTokens ?? null,
            headersJson: (0, json_1.safeStringify)(input.headers ?? existing?.headers ?? {}),
            enabled: enabled ? 1 : 0,
            useWithOpenCode: useWithOpenCode ? 1 : 0,
            sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
            lastTestedAt: existing?.lastTestedAt ?? null,
            lastError: existing?.lastError ?? null,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        });
        return this.getAiProviderProfile(id);
    }
    updateAiProviderProfileStatus(id, input) {
        const existing = this.getAiProviderProfile(id);
        if (!existing)
            return null;
        this.db
            .prepare(`
        UPDATE ai_provider_profiles
        SET last_tested_at = @lastTestedAt,
            last_error = @lastError,
            enabled = @enabled,
            updated_at = @updatedAt
        WHERE id = @id
      `)
            .run({
            id,
            lastTestedAt: input.lastTestedAt !== undefined ? input.lastTestedAt : existing.lastTestedAt,
            lastError: input.lastError !== undefined ? input.lastError : existing.lastError,
            enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
            updatedAt: (0, time_1.now)(),
        });
        return this.getAiProviderProfile(id);
    }
    deleteAiProviderProfile(id) {
        return this.db.prepare('DELETE FROM ai_provider_profiles WHERE id = ?').run(id).changes > 0;
    }
    // --- Media generation ---------------------------------------------------
    listMediaProviderProfiles() {
        return this.db
            .prepare('SELECT * FROM media_provider_profiles ORDER BY enabled DESC, sort_order ASC, updated_at DESC')
            .all().map(mapMediaProviderProfile);
    }
    getMediaProviderProfile(id) {
        const row = this.db.prepare('SELECT * FROM media_provider_profiles WHERE id = ?').get(id);
        return row ? mapMediaProviderProfile(row) : null;
    }
    upsertMediaProviderProfile(input) {
        const id = input.id?.trim() || (0, id_1.createId)();
        const existing = this.getMediaProviderProfile(id);
        const timestamp = (0, time_1.now)();
        const label = input.label?.trim() || existing?.label || (input.adapterId === 'openai' ? 'OpenAI Media' : 'Media API');
        const baseUrl = (input.baseUrl ?? existing?.baseUrl ?? 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
        if (!baseUrl)
            throw new Error('Media provider base URL is required.');
        this.db
            .prepare(`
        INSERT INTO media_provider_profiles (
          id, adapter_id, label, base_url, credential_source, ai_provider_profile_id,
          connector_name, environment_key, default_image_model, default_video_model,
          headers_json, enabled, sort_order, last_tested_at, last_error, created_at, updated_at
        ) VALUES (
          @id, @adapterId, @label, @baseUrl, @credentialSource, @aiProviderProfileId,
          @connectorName, @environmentKey, @defaultImageModel, @defaultVideoModel,
          @headersJson, @enabled, @sortOrder, @lastTestedAt, @lastError, @createdAt, @updatedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          adapter_id = excluded.adapter_id,
          label = excluded.label,
          base_url = excluded.base_url,
          credential_source = excluded.credential_source,
          ai_provider_profile_id = excluded.ai_provider_profile_id,
          connector_name = excluded.connector_name,
          environment_key = excluded.environment_key,
          default_image_model = excluded.default_image_model,
          default_video_model = excluded.default_video_model,
          headers_json = excluded.headers_json,
          enabled = excluded.enabled,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at
      `)
            .run({
            id,
            adapterId: input.adapterId,
            label,
            baseUrl,
            credentialSource: input.credentialSource ?? existing?.credentialSource ?? 'own',
            aiProviderProfileId: input.aiProviderProfileId !== undefined ? input.aiProviderProfileId || null : existing?.aiProviderProfileId ?? null,
            connectorName: input.connectorName !== undefined ? input.connectorName || null : existing?.connectorName ?? null,
            environmentKey: input.environmentKey !== undefined ? input.environmentKey || null : existing?.environmentKey ?? null,
            defaultImageModel: input.defaultImageModel !== undefined
                ? input.defaultImageModel?.trim() || null
                : existing?.defaultImageModel ?? (input.adapterId === 'openai' ? 'gpt-image-2' : null),
            defaultVideoModel: input.defaultVideoModel !== undefined ? input.defaultVideoModel?.trim() || null : existing?.defaultVideoModel ?? null,
            headersJson: (0, json_1.safeStringify)(input.headers ?? existing?.headers ?? {}),
            enabled: (input.enabled ?? existing?.enabled ?? false) ? 1 : 0,
            sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
            lastTestedAt: existing?.lastTestedAt ?? null,
            lastError: existing?.lastError ?? null,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        });
        return this.getMediaProviderProfile(id);
    }
    updateMediaProviderProfileStatus(id, input) {
        const existing = this.getMediaProviderProfile(id);
        if (!existing)
            return null;
        this.db
            .prepare(`UPDATE media_provider_profiles
         SET last_tested_at = @lastTestedAt, last_error = @lastError,
             enabled = @enabled, updated_at = @updatedAt
         WHERE id = @id`)
            .run({
            id,
            lastTestedAt: input.lastTestedAt !== undefined ? input.lastTestedAt : existing.lastTestedAt,
            lastError: input.lastError !== undefined ? input.lastError : existing.lastError,
            enabled: input.enabled !== undefined ? (input.enabled ? 1 : 0) : existing.enabled ? 1 : 0,
            updatedAt: (0, time_1.now)(),
        });
        return this.getMediaProviderProfile(id);
    }
    deleteMediaProviderProfile(id) {
        return this.db.prepare('DELETE FROM media_provider_profiles WHERE id = ?').run(id).changes > 0;
    }
    createMediaGenerationJob(input) {
        const id = (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        const operation = input.operation ??
            (input.kind === 'image'
                ? input.referenceAssetIds?.length ? 'image-to-image' : 'text-to-image'
                : input.referenceAssetIds?.length ? 'image-to-video' : 'text-to-video');
        this.db
            .prepare(`INSERT INTO media_generation_jobs (
          id, kind, product_id, source, profile_id, local_agent_id, provider_adapter_id,
          provider_job_id, idempotency_key, submission_attempt, parent_job_id, operation, model_id, prompt, status, progress,
          request_json, provider_response_json, created_at, updated_at
        ) VALUES (
          @id, @kind, @productId, @source, @profileId, @localAgentId, @providerAdapterId,
          NULL, @idempotencyKey, 0, @parentJobId, @operation, @modelId, @prompt, 'queued', 0,
          @requestJson, '{}', @createdAt, @updatedAt
        )`)
            .run({
            id,
            kind: input.kind,
            productId: input.productId ?? null,
            source: input.source ?? 'api-profile',
            profileId: input.profileId ?? null,
            localAgentId: input.localAgentId ?? null,
            providerAdapterId: input.providerAdapterId ?? null,
            idempotencyKey: input.idempotencyKey,
            parentJobId: input.parentJobId ?? null,
            operation,
            modelId: input.modelId,
            prompt: input.prompt,
            requestJson: (0, json_1.safeStringify)(input.request ?? input),
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        return this.getMediaGenerationJob(id);
    }
    getMediaGenerationJob(id) {
        const row = this.db.prepare('SELECT * FROM media_generation_jobs WHERE id = ?').get(id);
        if (!row)
            return null;
        return { ...mapMediaGenerationJob(row), outputs: this.listMediaGenerationOutputs(id) };
    }
    listMediaGenerationJobs(input = {}) {
        const where = [];
        const values = [];
        if (Object.prototype.hasOwnProperty.call(input, 'productId')) {
            if (input.productId) {
                where.push('product_id = ?');
                values.push(input.productId);
            }
            else {
                where.push('product_id IS NULL');
            }
        }
        if (input.kind) {
            where.push('kind = ?');
            values.push(input.kind);
        }
        if (input.status) {
            where.push('status = ?');
            values.push(input.status);
        }
        const limit = Math.max(1, Math.min(200, input.limit ?? 50));
        values.push(limit);
        const rows = this.db
            .prepare(`SELECT * FROM media_generation_jobs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`)
            .all(...values);
        return rows.map((row) => ({ ...mapMediaGenerationJob(row), outputs: this.listMediaGenerationOutputs(row.id) }));
    }
    updateMediaGenerationJob(id, patch) {
        const existing = this.getMediaGenerationJob(id);
        if (!existing)
            return null;
        this.db
            .prepare(`UPDATE media_generation_jobs SET
          provider_adapter_id = @providerAdapterId,
          provider_job_id = @providerJobId,
          submission_attempt = @submissionAttempt,
          status = @status,
          progress = @progress,
          provider_response_json = @providerResponseJson,
          error_code = @errorCode,
          error_message = @errorMessage,
          cancel_requested_at = @cancelRequestedAt,
          submitted_at = @submittedAt,
          completed_at = @completedAt,
          updated_at = @updatedAt
         WHERE id = @id`)
            .run({
            id,
            providerAdapterId: patch.providerAdapterId !== undefined ? patch.providerAdapterId : existing.providerAdapterId,
            providerJobId: patch.providerJobId !== undefined ? patch.providerJobId : existing.providerJobId,
            submissionAttempt: patch.submissionAttempt ?? existing.submissionAttempt,
            status: patch.status ?? existing.status,
            progress: patch.progress ?? existing.progress,
            providerResponseJson: (0, json_1.safeStringify)(patch.providerResponse ?? existing.providerResponse),
            errorCode: patch.errorCode !== undefined ? patch.errorCode : existing.errorCode,
            errorMessage: patch.errorMessage !== undefined ? patch.errorMessage : existing.errorMessage,
            cancelRequestedAt: patch.cancelRequestedAt !== undefined ? patch.cancelRequestedAt : existing.cancelRequestedAt,
            submittedAt: patch.submittedAt !== undefined ? patch.submittedAt : existing.submittedAt,
            completedAt: patch.completedAt !== undefined ? patch.completedAt : existing.completedAt,
            updatedAt: (0, time_1.now)(),
        });
        return this.getMediaGenerationJob(id);
    }
    createMediaGenerationOutput(input) {
        const id = (0, id_1.createId)();
        const createdAt = (0, time_1.now)();
        this.db
            .prepare(`INSERT INTO media_generation_outputs
          (id, job_id, asset_id, ordinal, provider_output_id, metadata_json, created_at)
         VALUES (@id, @jobId, @assetId, @ordinal, @providerOutputId, @metadataJson, @createdAt)`)
            .run({
            id,
            jobId: input.jobId,
            assetId: input.assetId,
            ordinal: input.ordinal,
            providerOutputId: input.providerOutputId ?? null,
            metadataJson: (0, json_1.safeStringify)(input.metadata ?? {}),
            createdAt,
        });
        return {
            id,
            jobId: input.jobId,
            assetId: input.assetId,
            ordinal: input.ordinal,
            providerOutputId: input.providerOutputId ?? null,
            metadata: input.metadata ?? {},
            createdAt,
            asset: this.getAssetById(input.assetId),
        };
    }
    listMediaGenerationOutputs(jobId) {
        const rows = this.db
            .prepare('SELECT * FROM media_generation_outputs WHERE job_id = ? ORDER BY ordinal ASC')
            .all(jobId);
        return rows.map((row) => ({
            id: row.id,
            jobId: row.job_id,
            assetId: row.asset_id,
            ordinal: row.ordinal,
            providerOutputId: row.provider_output_id,
            metadata: (0, json_1.safeParseJson)(row.metadata_json, {}),
            createdAt: row.created_at,
            asset: row.asset_id ? this.getAssetById(row.asset_id) : null,
        }));
    }
    deleteMediaGenerationJob(id) {
        return this.db.prepare('DELETE FROM media_generation_jobs WHERE id = ?').run(id).changes > 0;
    }
    getStorageTableStats() {
        const read = (sql) => {
            const row = this.db.prepare(sql).get();
            return { count: Number(row?.count ?? 0), estimatedBytes: Number(row?.estimated_bytes ?? 0) };
        };
        const syncLogs = read(`
      SELECT COUNT(*) AS count,
        COALESCE(SUM(
          length(COALESCE(source, '')) +
          length(COALESCE(label, '')) +
          length(COALESCE(status, '')) +
          length(COALESCE(product_id, '')) +
          length(COALESCE(summary, '')) +
          length(COALESCE(details_json, ''))
        ), 0) AS estimated_bytes
      FROM sync_logs
    `);
        const aiLogs = read(`
      SELECT COUNT(*) AS count,
        COALESCE(SUM(
          length(COALESCE(kind, '')) +
          length(COALESCE(agent, '')) +
          length(COALESCE(tool, '')) +
          length(COALESCE(transport, '')) +
          length(COALESCE(status, '')) +
          length(COALESCE(summary, '')) +
          length(COALESCE(detail, ''))
        ), 0) AS estimated_bytes
      FROM ai_logs
    `);
        const apiLogs = read(`
      SELECT COUNT(*) AS count,
        COALESCE(SUM(
          length(COALESCE(provider, '')) +
          length(COALESCE(method, '')) +
          length(COALESCE(path, '')) +
          length(COALESCE(status, '')) +
          length(COALESCE(summary, '')) +
          length(COALESCE(detail, '')) +
          length(COALESCE(request_body, '')) +
          length(COALESCE(response_body, ''))
        ), 0) AS estimated_bytes
      FROM api_logs
    `);
        const keywordPlannerCache = read(`
      SELECT COUNT(*) AS count,
        COALESCE(SUM(
          length(COALESCE(cache_key, '')) +
          length(COALESCE(location, '')) +
          length(COALESCE(currency, '')) +
          length(COALESCE(keywords_json, '')) +
          length(COALESCE(results_json, ''))
        ), 0) AS estimated_bytes
      FROM keyword_planner_cache
    `);
        const dashboardSetting = this.getSetting('dashboard.siteCache');
        const dashboardBytes = dashboardSetting?.value === null || dashboardSetting?.value === undefined
            ? 0
            : (0, json_1.safeStringify)(dashboardSetting.value).length;
        return {
            syncLogs,
            aiLogs,
            apiLogs,
            keywordPlannerCache,
            dashboardCache: { count: dashboardBytes > 0 ? 1 : 0, estimatedBytes: dashboardBytes },
        };
    }
    runStorageMaintenance() {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        this.db.exec('VACUUM');
    }
    getKeywordsForProduct(productId) {
        const fromSeo = this.db
            .prepare('SELECT DISTINCT keyword FROM seo_opportunities WHERE product_id = ?')
            .all(productId);
        const fromSnapshots = this.db
            .prepare('SELECT DISTINCT keyword FROM rank_snapshots WHERE product_id = ?')
            .all(productId);
        const merged = new Set();
        for (const entry of fromSeo)
            merged.add(entry.keyword);
        for (const entry of fromSnapshots)
            merged.add(entry.keyword);
        return Array.from(merged);
    }
    getOverview(productId) {
        const productSqlFilter = productId ? ' WHERE product_id = ?' : '';
        const queryArg = productId ? [productId] : [];
        const products = this.db
            .prepare(productId ? 'SELECT COUNT(*) as count FROM products WHERE id = ? AND archived = 0' : 'SELECT COUNT(*) as count FROM products WHERE archived = 0')
            .get(...queryArg);
        const queuePending = this.db
            .prepare(`SELECT COUNT(*) as count FROM content_queue${productSqlFilter ? `${productSqlFilter} AND status = 'pending'` : " WHERE status = 'pending'"}`)
            .get(...queryArg);
        const queueScheduled = this.db
            .prepare(`SELECT COUNT(*) as count FROM content_queue${productSqlFilter ? `${productSqlFilter} AND status = 'scheduled'` : " WHERE status = 'scheduled'"}`)
            .get(...queryArg);
        const queuePublished = this.db
            .prepare(`SELECT COUNT(*) as count FROM content_queue${productSqlFilter ? `${productSqlFilter} AND status = 'published'` : " WHERE status = 'published'"}`)
            .get(...queryArg);
        const seoOpen = this.db
            .prepare(`SELECT COUNT(*) as count FROM seo_opportunities${productSqlFilter ? `${productSqlFilter} AND status != 'done'` : " WHERE status != 'done'"}`)
            .get(...queryArg);
        const rankAlerts = this.db
            .prepare(`SELECT COUNT(*) as count FROM rank_alerts${productSqlFilter ? `${productSqlFilter} AND acknowledged = 0` : ' WHERE acknowledged = 0'}`)
            .get(...queryArg);
        const listedDirectories = this.db
            .prepare(`SELECT COUNT(*) as count FROM directory_submissions${productSqlFilter ? `${productSqlFilter} AND status = 'listed'` : " WHERE status = 'listed'"}`)
            .get(...queryArg);
        const connectedConnectors = this.db
            .prepare("SELECT COUNT(*) as count FROM connectors WHERE enabled = 1 AND status = 'connected'")
            .get();
        const pipelineRunsLast7Days = this.db
            .prepare(`SELECT COUNT(*) as count FROM pipeline_runs${productSqlFilter ? `${productSqlFilter} AND started_at >= ?` : ' WHERE started_at >= ?'}`)
            .get(...queryArg, (0, time_1.daysAgo)(7));
        return {
            products: products.count,
            queuePending: queuePending.count,
            queueScheduled: queueScheduled.count,
            queuePublished: queuePublished.count,
            openSeoOpportunities: seoOpen.count,
            rankAlerts: rankAlerts.count,
            listedDirectories: listedDirectories.count,
            connectedConnectors: connectedConnectors.count,
            pipelineRunsLast7Days: pipelineRunsLast7Days.count,
        };
    }
    // ===== AI Visibility (AI Search Optimization) =====
    countAiTrackerTerms(trackerId) {
        const row = this.db
            .prepare('SELECT COUNT(*) AS count FROM ai_tracker_terms WHERE tracker_id = ?')
            .get(trackerId);
        return row.count;
    }
    countAiTrackerSnapshots(trackerId) {
        const row = this.db
            .prepare('SELECT COUNT(*) AS count FROM ai_tracker_snapshots WHERE tracker_id = ?')
            .get(trackerId);
        return row.count;
    }
    listAiTrackers(productId) {
        const rows = (productId
            ? this.db.prepare('SELECT * FROM ai_trackers WHERE product_id = ? ORDER BY updated_at DESC').all(productId)
            : this.db.prepare('SELECT * FROM ai_trackers ORDER BY updated_at DESC').all());
        return rows.map((row) => mapAiTracker(row, this.countAiTrackerTerms(row.id), this.countAiTrackerSnapshots(row.id)));
    }
    getAiTracker(id) {
        const row = this.db.prepare('SELECT * FROM ai_trackers WHERE id = ?').get(id);
        if (!row)
            return null;
        return mapAiTracker(row, this.countAiTrackerTerms(id), this.countAiTrackerSnapshots(id));
    }
    getAiTrackerTerms(trackerId) {
        const rows = this.db
            .prepare('SELECT * FROM ai_tracker_terms WHERE tracker_id = ? ORDER BY created_at ASC')
            .all(trackerId);
        return rows.map(mapAiTrackerTerm);
    }
    listDueAiTrackers(asOf) {
        const rows = this.db
            .prepare('SELECT * FROM ai_trackers WHERE schedule_days > 0 AND next_run_at IS NOT NULL AND next_run_at <= ?')
            .all(asOf);
        return rows.map((row) => mapAiTracker(row, this.countAiTrackerTerms(row.id), this.countAiTrackerSnapshots(row.id)));
    }
    upsertAiTracker(input) {
        const timestamp = (0, time_1.now)();
        const id = input.id ?? (0, id_1.createId)();
        const exists = input.id ? !!this.db.prepare('SELECT id FROM ai_trackers WHERE id = ?').get(input.id) : false;
        const name = (input.name ?? input.brandVariants[0] ?? 'Untitled tracker').trim() || 'Untitled tracker';
        const scheduleDays = input.scheduleDays ?? 0;
        const nextRunAt = scheduleDays > 0 ? timestamp : null;
        const insertTerm = this.db.prepare(`INSERT INTO ai_tracker_terms (id, tracker_id, term, tags_json, created_at) VALUES (@id, @trackerId, @term, '[]', @createdAt)`);
        const tx = this.db.transaction(() => {
            if (exists) {
                this.db
                    .prepare(`UPDATE ai_trackers
             SET name = @name, brand_variants_json = @brandVariants, engines_json = @engines, source = @source,
                 location = @location, language = @language, geo_target = @geoTarget, schedule_days = @scheduleDays,
                 next_run_at = @nextRunAt, updated_at = @updatedAt
             WHERE id = @id`)
                    .run({
                    id,
                    name,
                    brandVariants: (0, json_1.safeStringify)(input.brandVariants),
                    engines: (0, json_1.safeStringify)(input.engines),
                    source: input.source,
                    location: input.location ?? 'United States',
                    language: input.language ?? 'English',
                    geoTarget: input.geoTarget ?? null,
                    scheduleDays,
                    nextRunAt,
                    updatedAt: timestamp,
                });
                this.db.prepare('DELETE FROM ai_tracker_terms WHERE tracker_id = ?').run(id);
            }
            else {
                this.db
                    .prepare(`INSERT INTO ai_trackers
               (id, product_id, name, brand_variants_json, engines_json, source, location, language, geo_target,
                schedule_days, last_run_at, next_run_at, created_at, updated_at)
             VALUES
               (@id, @productId, @name, @brandVariants, @engines, @source, @location, @language, @geoTarget,
                @scheduleDays, NULL, @nextRunAt, @createdAt, @updatedAt)`)
                    .run({
                    id,
                    productId: input.productId,
                    name,
                    brandVariants: (0, json_1.safeStringify)(input.brandVariants),
                    engines: (0, json_1.safeStringify)(input.engines),
                    source: input.source,
                    location: input.location ?? 'United States',
                    language: input.language ?? 'English',
                    geoTarget: input.geoTarget ?? null,
                    scheduleDays,
                    nextRunAt,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                });
            }
            const seen = new Set();
            for (const raw of input.terms) {
                const term = raw.trim();
                const key = term.toLowerCase();
                if (!term || seen.has(key))
                    continue;
                seen.add(key);
                insertTerm.run({ id: (0, id_1.createId)(), trackerId: id, term, createdAt: timestamp });
            }
        });
        tx();
        return this.getAiTracker(id);
    }
    deleteAiTracker(id) {
        return this.db.prepare('DELETE FROM ai_trackers WHERE id = ?').run(id).changes > 0;
    }
    setAiTrackerRunTimes(id, lastRunAt, nextRunAt) {
        this.db
            .prepare('UPDATE ai_trackers SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?')
            .run(lastRunAt, nextRunAt, (0, time_1.now)(), id);
    }
    /** Create (or reset) today's snapshot, clearing any prior results for an in-day re-run. */
    startAiTrackerSnapshot(trackerId, snapshotDate) {
        const timestamp = (0, time_1.now)();
        const existing = this.db
            .prepare('SELECT id FROM ai_tracker_snapshots WHERE tracker_id = ? AND snapshot_date = ?')
            .get(trackerId, snapshotDate);
        if (existing) {
            this.db.prepare('DELETE FROM ai_tracker_results WHERE snapshot_id = ?').run(existing.id);
            this.db
                .prepare("UPDATE ai_tracker_snapshots SET status = 'running', cost = NULL, updated_at = ? WHERE id = ?")
                .run(timestamp, existing.id);
            return existing.id;
        }
        const id = (0, id_1.createId)();
        this.db
            .prepare(`INSERT INTO ai_tracker_snapshots (id, tracker_id, snapshot_date, cost, status, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 'running', ?, ?)`)
            .run(id, trackerId, snapshotDate, timestamp, timestamp);
        return id;
    }
    finalizeAiTrackerSnapshot(snapshotId, cost, status) {
        this.db
            .prepare('UPDATE ai_tracker_snapshots SET cost = ?, status = ?, updated_at = ? WHERE id = ?')
            .run(cost, status, (0, time_1.now)(), snapshotId);
    }
    insertAiTrackerResult(input) {
        const id = (0, id_1.createId)();
        this.db
            .prepare(`INSERT INTO ai_tracker_results
           (id, snapshot_id, term_id, term, engine, fetch_source, response_text, response_hash, found, created_at)
         VALUES (@id, @snapshotId, @termId, @term, @engine, @fetchSource, @responseText, @responseHash, @found, @createdAt)`)
            .run({
            id,
            snapshotId: input.snapshotId,
            termId: input.termId,
            term: input.term,
            engine: input.engine,
            fetchSource: input.fetchSource,
            responseText: input.responseText,
            responseHash: input.responseHash,
            found: input.found ? 1 : 0,
            createdAt: (0, time_1.now)(),
        });
        return id;
    }
    insertAiTrackerMention(input) {
        this.db
            .prepare(`INSERT INTO ai_tracker_mentions (id, result_id, brand, is_self, position, snippet, sentiment)
         VALUES (@id, @resultId, @brand, @isSelf, @position, @snippet, @sentiment)`)
            .run({
            id: (0, id_1.createId)(),
            resultId: input.resultId,
            brand: input.brand,
            isSelf: input.isSelf ? 1 : 0,
            position: input.position,
            snippet: input.snippet,
            sentiment: input.sentiment,
        });
    }
    insertAiTrackerCitation(input) {
        this.db
            .prepare(`INSERT INTO ai_tracker_citations (id, result_id, url, domain, title, brands_json)
         VALUES (@id, @resultId, @url, @domain, @title, @brandsJson)`)
            .run({
            id: (0, id_1.createId)(),
            resultId: input.resultId,
            url: input.url,
            domain: input.domain,
            title: input.title,
            brandsJson: (0, json_1.safeStringify)(input.brands),
        });
    }
    listAiTrackerSnapshots(trackerId) {
        const rows = this.db
            .prepare('SELECT * FROM ai_tracker_snapshots WHERE tracker_id = ? ORDER BY snapshot_date DESC')
            .all(trackerId);
        return rows.map((row) => ({
            id: row.id,
            trackerId: row.tracker_id,
            snapshotDate: row.snapshot_date,
            cost: row.cost,
            status: row.status,
            resultCount: this.db.prepare('SELECT COUNT(*) AS count FROM ai_tracker_results WHERE snapshot_id = ?').get(row.id).count,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }));
    }
    deleteAiTrackerSnapshot(id) {
        return this.db.prepare('DELETE FROM ai_tracker_snapshots WHERE id = ?').run(id).changes > 0;
    }
    getLatestAiTrackerSnapshot(trackerId) {
        const row = this.db
            .prepare("SELECT * FROM ai_tracker_snapshots WHERE tracker_id = ? AND status != 'running' ORDER BY snapshot_date DESC LIMIT 1")
            .get(trackerId);
        return row ?? null;
    }
    getAiTrackerSnapshot(id) {
        const row = this.db.prepare('SELECT * FROM ai_tracker_snapshots WHERE id = ?').get(id);
        return row ?? null;
    }
    /** Completed snapshots within [startDate, endDate] (inclusive, YYYY-MM-DD), oldest first. */
    getAiTrackerSnapshotsInRange(trackerId, startDate, endDate) {
        return this.db
            .prepare(`SELECT * FROM ai_tracker_snapshots
         WHERE tracker_id = ? AND status != 'running' AND snapshot_date >= ? AND snapshot_date <= ?
         ORDER BY snapshot_date ASC`)
            .all(trackerId, startDate, endDate);
    }
    getAiTrackerResults(snapshotId) {
        return this.db
            .prepare('SELECT * FROM ai_tracker_results WHERE snapshot_id = ? ORDER BY created_at ASC')
            .all(snapshotId);
    }
    getAiTrackerMentionsForSnapshot(snapshotId) {
        return this.db
            .prepare(`SELECT m.result_id AS resultId, r.term AS term, r.engine AS engine, m.brand AS brand,
                m.is_self AS isSelf, m.position AS position, m.sentiment AS sentiment
         FROM ai_tracker_mentions m
         JOIN ai_tracker_results r ON r.id = m.result_id
         WHERE r.snapshot_id = ?`)
            .all(snapshotId);
    }
    getAiTrackerCitationsForSnapshot(snapshotId) {
        const rows = this.db
            .prepare(`SELECT c.result_id AS resultId, r.term AS term, r.engine AS engine, c.url AS url,
                c.domain AS domain, c.title AS title, c.brands_json AS brandsJson
         FROM ai_tracker_citations c
         JOIN ai_tracker_results r ON r.id = c.result_id
         WHERE r.snapshot_id = ?`)
            .all(snapshotId);
        return rows.map((row) => ({
            resultId: row.resultId,
            term: row.term,
            engine: row.engine,
            url: row.url,
            domain: row.domain,
            title: row.title,
            brands: (0, json_1.safeParseJson)(row.brandsJson, []),
        }));
    }
    getAiTrackerMentionsForResult(resultId) {
        return this.db
            .prepare('SELECT * FROM ai_tracker_mentions WHERE result_id = ? ORDER BY COALESCE(position, 999)')
            .all(resultId);
    }
    getAiTrackerCitationsForResult(resultId) {
        return this.db
            .prepare('SELECT * FROM ai_tracker_citations WHERE result_id = ?')
            .all(resultId);
    }
    // --- AI Assistant chat ------------------------------------------------
    listChatConversations(projectId) {
        const rows = projectId === undefined
            ? this.db.prepare('SELECT * FROM chat_conversations ORDER BY updated_at DESC').all()
            : this.db
                .prepare('SELECT * FROM chat_conversations WHERE project_id IS ? ORDER BY updated_at DESC')
                .all(projectId ?? null);
        return rows.map(mapChatConversation);
    }
    getChatConversation(id) {
        const row = this.db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id);
        if (!row)
            return null;
        const messages = this.db.prepare('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at').all(id).map(mapChatMessage);
        return { ...mapChatConversation(row), messages };
    }
    createChatConversation(input) {
        const id = (0, id_1.createId)();
        const timestamp = (0, time_1.now)();
        this.db
            .prepare(`INSERT INTO chat_conversations (id, project_id, title, created_at, updated_at)
         VALUES (@id, @projectId, @title, @createdAt, @updatedAt)`)
            .run({
            id,
            projectId: input.projectId ?? null,
            title: input.title?.trim() || 'New chat',
            createdAt: timestamp,
            updatedAt: timestamp,
        });
        return { id, projectId: input.projectId ?? null, title: input.title?.trim() || 'New chat', createdAt: timestamp, updatedAt: timestamp };
    }
    renameChatConversation(id, title) {
        this.db.prepare('UPDATE chat_conversations SET title = ?, updated_at = ? WHERE id = ?').run(title.trim() || 'New chat', (0, time_1.now)(), id);
        const row = this.db.prepare('SELECT * FROM chat_conversations WHERE id = ?').get(id);
        return row ? mapChatConversation(row) : null;
    }
    deleteChatConversation(id) {
        return this.db.prepare('DELETE FROM chat_conversations WHERE id = ?').run(id).changes > 0;
    }
    /** Delete every message in a conversation but keep the (now-empty) conversation. */
    clearChatMessages(conversationId) {
        const changes = this.db.prepare('DELETE FROM chat_messages WHERE conversation_id = ?').run(conversationId).changes;
        this.db.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run((0, time_1.now)(), conversationId);
        return changes > 0;
    }
    appendChatMessage(input) {
        const id = (0, id_1.createId)();
        const createdAt = (0, time_1.now)();
        this.db
            .prepare(`INSERT INTO chat_messages (id, conversation_id, role, content, mentions_json, actions_json, tool_calls_json, provider, created_at)
         VALUES (@id, @conversationId, @role, @content, @mentionsJson, @actionsJson, @toolCallsJson, @provider, @createdAt)`)
            .run({
            id,
            conversationId: input.conversationId,
            role: input.role,
            content: input.content,
            mentionsJson: (0, json_1.safeStringify)(input.mentions ?? []),
            actionsJson: (0, json_1.safeStringify)(input.actions ?? []),
            toolCallsJson: (0, json_1.safeStringify)(input.toolCalls ?? []),
            provider: input.provider ?? null,
            createdAt,
        });
        this.db.prepare('UPDATE chat_conversations SET updated_at = ? WHERE id = ?').run(createdAt, input.conversationId);
        return {
            id,
            conversationId: input.conversationId,
            role: input.role,
            content: input.content,
            mentions: input.mentions ?? [],
            actions: input.actions ?? [],
            toolCalls: input.toolCalls ?? [],
            provider: input.provider ?? null,
            createdAt,
        };
    }
    getChatMessage(id) {
        const row = this.db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id);
        return row ? mapChatMessage(row) : null;
    }
    updateChatMessageToolCalls(id, toolCalls) {
        this.db.prepare('UPDATE chat_messages SET tool_calls_json = ? WHERE id = ?').run((0, json_1.safeStringify)(toolCalls), id);
        return this.getChatMessage(id);
    }
}
exports.AppRepository = AppRepository;
exports.repository = new AppRepository();
//# sourceMappingURL=AppRepository.js.map