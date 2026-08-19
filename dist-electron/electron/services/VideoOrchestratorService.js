"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoOrchestratorService = exports.VideoOrchestratorService = void 0;
const AIService_1 = require("./AIService");
const AiProviderService_1 = require("./AiProviderService");
const AssetService_1 = require("./AssetService");
const DesignService_1 = require("./DesignService");
const AppRepository_1 = require("./AppRepository");
const VideoComposeService_1 = require("./video/VideoComposeService");
const pipelines_1 = require("./video/pipelines");
const storyboard_1 = require("./video/storyboard");
const VideoRepository_1 = require("./video/VideoRepository");
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function extractJson(raw) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    const candidate = fenced ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    if (!candidate.trim())
        return null;
    try {
        const parsed = JSON.parse(candidate);
        return record(parsed);
    }
    catch {
        return null;
    }
}
function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'marketing-video';
}
function scoreLocalAgent(agent, preferred) {
    const qualityByAgent = {
        codex: 0.96,
        claude: 0.94,
        grok: 0.93,
        gemini: 0.91,
        opencode: 0.84,
        qwen: 0.82,
        amp: 0.8,
        aider: 0.72,
    };
    const taskFit = qualityByAgent[agent.id] ?? 0.75;
    const quality = qualityByAgent[agent.id] ?? 0.75;
    const control = agent.acp ? 1 : 0.72;
    const reliability = agent.state === 'detected' ? 0.95 : 0;
    const cost = 1;
    const latency = agent.acp ? 0.82 : 0.7;
    const continuity = preferred === agent.id ? 1 : 0.65;
    const score = taskFit * 0.3 + quality * 0.2 + control * 0.15 + reliability * 0.15 + cost * 0.1 + latency * 0.05 + continuity * 0.05;
    return {
        id: agent.id,
        label: agent.displayName,
        kind: 'local-agent',
        score: Number(score.toFixed(3)),
        reason: `${agent.displayName} scored highest for structured writing${agent.acp ? ', ACP control,' : ','} and local cost.`,
        estimatedCostUsd: 0,
    };
}
function scoreByok(profile) {
    const quality = profile.provider === 'anthropic' || profile.provider === 'openai' ? 0.92 : 0.86;
    const score = 0.92 * 0.3 + quality * 0.2 + 0.9 * 0.15 + 0.88 * 0.15 + 0.45 * 0.1 + 0.72 * 0.05 + 0.65 * 0.05;
    return {
        id: profile.id,
        label: profile.label,
        kind: 'byok',
        score: Number(score.toFixed(3)),
        reason: `${profile.label} is enabled with credentials and scores well for structured JSON output.`,
        estimatedCostUsd: 0.01,
    };
}
class VideoOrchestratorService {
    activeRuns = new Map();
    listPipelines() {
        return (0, pipelines_1.listVideoPipelines)();
    }
    recoverInterruptedRuns() {
        return VideoRepository_1.videoRepository.recoverInterruptedRuns();
    }
    async writeStoryboard(input, onProgress) {
        const pipeline = (0, pipelines_1.getVideoPipeline)(input.pipelineId);
        const prompt = input.prompt.trim();
        if (!prompt)
            throw new Error('Describe the video you want to create.');
        const providerSelection = await this.selectAuthor(input.agentId ?? null);
        onProgress?.({ kind: 'log', message: providerSelection.reason, tone: 'info' });
        const budgetCap = this.videoBudgetCap();
        if (budgetCap !== null && providerSelection.estimatedCostUsd > budgetCap) {
            throw new Error(`Estimated authoring cost $${providerSelection.estimatedCostUsd.toFixed(2)} exceeds the configured $${budgetCap.toFixed(2)} video cap.`);
        }
        const context = {
            prompt,
            agentId: input.agentId ?? (providerSelection.kind === 'local-agent' ? providerSelection.id : null),
            style: input.style ?? null,
            referenceImagePath: input.referenceImagePath ?? null,
            useReferenceAsBackground: Boolean(input.useReferenceAsBackground),
            sourceImageAssetIds: Array.from(new Set(input.sourceImageAssetIds ?? [])).slice(0, 4),
            autoRun: Boolean(input.autoRun),
            wantsAudio: Boolean(input.wantsAudio ?? pipeline.wantsAudio),
            wantsCaptions: Boolean(input.wantsCaptions ?? pipeline.wantsCaptions),
        };
        onProgress?.({ kind: 'stage', stage: 'author', message: 'Writing a multi-scene storyboard…', tone: 'info' });
        const storyboard = await this.authorStoryboard({
            pipeline,
            input,
            context,
            providerSelection,
            onProgress,
        });
        let run = VideoRepository_1.videoRepository.create({
            productId: input.productId ?? null,
            storyboard,
            context,
            providerSelection,
        });
        onProgress?.({ kind: 'log', runId: run.id, message: `Created ${storyboard.scenes.length} real scenes.`, tone: 'success' });
        if (!context.autoRun && pipeline.gates.includes('script')) {
            run = VideoRepository_1.videoRepository.save({
                runId: run.id,
                expectedRevision: run.revision,
                stage: 'author',
                pendingGate: 'script',
            });
            this.emitGate(run, 'script', onProgress);
            return this.toPublicRun(run);
        }
        return this.toPublicRun(await this.produceScenePlan(run, onProgress));
    }
    getRun(id) {
        const run = VideoRepository_1.videoRepository.getRun(id);
        return run ? this.toPublicRun(run) : null;
    }
    getRunForStoryboard(storyboardId) {
        const run = VideoRepository_1.videoRepository.getRunForStoryboard(storyboardId);
        return run ? this.toPublicRun(run) : null;
    }
    listRuns(productId) {
        return VideoRepository_1.videoRepository.listRuns(productId).map((run) => this.toPublicRun(run));
    }
    async updateStoryboard(input, onProgress) {
        const run = VideoRepository_1.videoRepository.getRunForStoryboard(input.storyboardId);
        if (!run)
            throw new Error('Video storyboard not found.');
        const pipeline = (0, pipelines_1.getVideoPipeline)(input.storyboard.pipelineId || run.storyboard.pipelineId);
        const defaultTemplateId = this.defaultTemplate(input.storyboard.format || run.storyboard.format);
        const normalized = (0, storyboard_1.normalizeVideoStoryboard)(input.storyboard, {
            pipeline,
            format: input.storyboard.format,
            durationMs: input.storyboard.totalDurationMs,
            productId: run.storyboard.productId,
            defaultTemplateId,
        });
        const storyboard = (0, storyboard_1.preserveFreshSceneAssets)(run.storyboard.storyboard, normalized);
        const saved = VideoRepository_1.videoRepository.save({
            runId: run.id,
            expectedRevision: input.revision,
            storyboard,
            stage: 'author',
            pendingGate: 'script',
            review: null,
            assetId: null,
            error: null,
        });
        onProgress?.({ kind: 'gate', runId: saved.id, gate: 'script', message: 'Storyboard changed — approve the script again.', tone: 'info' });
        return this.toPublicRun(saved);
    }
    async applyCommand(input, onProgress) {
        const run = VideoRepository_1.videoRepository.getRunForStoryboard(input.storyboardId);
        if (!run)
            throw new Error('Video storyboard not found.');
        if (input.productId !== undefined && run.storyboard.productId !== (input.productId ?? null)) {
            throw new Error('This storyboard is outside the requested project scope.');
        }
        const source = (0, storyboard_1.applyStoryboardCommand)(run.storyboard.storyboard, input.command);
        return this.updateStoryboard({
            storyboardId: input.storyboardId,
            revision: input.revision,
            storyboard: source,
        }, onProgress);
    }
    async resolveGate(input, onProgress) {
        let run = VideoRepository_1.videoRepository.getRun(input.runId);
        if (!run)
            throw new Error('Video run not found.');
        if (run.revision !== input.revision && run.pendingGate !== input.gate) {
            return this.toPublicRun(run);
        }
        if (run.revision !== input.revision) {
            throw new Error(`Video changed in another editor. Reload revision ${run.revision} and try again.`);
        }
        if (run.pendingGate !== input.gate)
            throw new Error(`The video is not waiting at the ${input.gate} gate.`);
        if (input.action === 'reroll') {
            if (input.gate === 'script') {
                const pipeline = (0, pipelines_1.getVideoPipeline)(run.storyboard.pipelineId);
                const providerSelection = run.providerSelection ?? await this.selectAuthor(run.context.agentId);
                const storyboard = await this.authorStoryboard({
                    pipeline,
                    input: {
                        productId: run.storyboard.productId,
                        pipelineId: pipeline.id,
                        format: run.storyboard.format,
                        durationMs: run.storyboard.storyboard.totalDurationMs,
                        prompt: run.context.prompt,
                    },
                    context: run.context,
                    providerSelection,
                    onProgress,
                });
                run = VideoRepository_1.videoRepository.save({
                    runId: run.id,
                    expectedRevision: run.revision,
                    storyboard,
                    stage: 'author',
                    pendingGate: 'script',
                    review: null,
                    assetId: null,
                });
                this.emitGate(run, 'script', onProgress);
                return this.toPublicRun(run);
            }
            if (input.gate === 'scene-plan')
                return this.toPublicRun(await this.produceScenePlan(run, onProgress, true));
            if (input.gate === 'assets')
                return this.toPublicRun(await this.produceAssets(run, onProgress, true));
            return this.toPublicRun(await this.compose(run, onProgress, true));
        }
        if (input.gate === 'script')
            return this.toPublicRun(await this.produceScenePlan(run, onProgress));
        if (input.gate === 'scene-plan')
            return this.toPublicRun(await this.produceAssets(run, onProgress));
        if (input.gate === 'assets')
            return this.toPublicRun(await this.compose(run, onProgress));
        run = VideoRepository_1.videoRepository.save({
            runId: run.id,
            expectedRevision: run.revision,
            stage: 'done',
            pendingGate: null,
            error: null,
        });
        onProgress?.({ kind: 'stage', runId: run.id, stage: 'done', message: 'Video approved and saved to Assets.', tone: 'success' });
        return this.toPublicRun(run);
    }
    cancel(runId) {
        this.activeRuns.get(runId)?.abort();
        const run = VideoRepository_1.videoRepository.getRun(runId);
        if (!run)
            return null;
        const saved = VideoRepository_1.videoRepository.save({
            runId,
            expectedRevision: run.revision,
            stage: 'failed',
            pendingGate: null,
            error: 'Video run canceled.',
        });
        return this.toPublicRun(saved);
    }
    discardRun(runId) {
        // Stop any in-flight generation before removing the run and its storyboard/revisions.
        this.activeRuns.get(runId)?.abort();
        this.activeRuns.delete(runId);
        return VideoRepository_1.videoRepository.deleteRun(runId);
    }
    restoreRevision(runId, revision, targetRevision) {
        return this.toPublicRun(VideoRepository_1.videoRepository.restoreRevision(runId, revision, targetRevision));
    }
    async selectAuthor(preferred) {
        const [status, profiles] = await Promise.all([
            AIService_1.aiService.getLocalStatus(),
            AiProviderService_1.aiProviderService.listProfiles().catch(() => []),
        ]);
        const activeRoute = AiProviderService_1.aiProviderService.getActiveRoute();
        const detected = status.agents.filter((agent) => agent.state === 'detected');
        const requestedAgentId = preferred ?? (activeRoute.mode === 'local-cli' ? activeRoute.localAgentId ?? null : null);
        const explicit = requestedAgentId ? detected.find((agent) => agent.id === requestedAgentId) : null;
        if (requestedAgentId && !explicit)
            throw new Error(`Selected local CLI "${requestedAgentId}" is not detected.`);
        if (!preferred && activeRoute.mode === 'byok') {
            const profile = profiles.find((candidate) => candidate.id === activeRoute.providerProfileId) ?? null;
            if (!profile || !profile.enabled || !profile.hasSecret) {
                throw new Error('The selected BYOK AI provider is unavailable for video authoring.');
            }
            return scoreByok(profile);
        }
        const continuityAgentId = requestedAgentId ?? status.selectedAgentId;
        const candidates = explicit
            ? [scoreLocalAgent(explicit, requestedAgentId)]
            : [
                ...detected.map((agent) => scoreLocalAgent(agent, continuityAgentId)),
                ...profiles.filter((profile) => profile.enabled && profile.hasSecret).map(scoreByok),
            ];
        const selected = candidates.sort((left, right) => right.score - left.score)[0];
        if (!selected)
            throw new Error('No local CLI agent or enabled BYOK provider is available for video authoring.');
        return selected;
    }
    videoBudgetCap() {
        const value = AppRepository_1.repository.getSetting('video.budgetCapUsd')?.value;
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    }
    defaultTemplate(format) {
        const template = DesignService_1.designService.listTemplates(format)[0];
        if (!template)
            throw new Error(`No design template is available for ${format}.`);
        return template.id;
    }
    async authorStoryboard(options) {
        const format = options.input.format ?? options.pipeline.defaultFormat;
        const durationMs = Math.max(4000, Math.min(20000, options.input.durationMs ?? options.pipeline.defaultDurationMs));
        const product = options.input.productId ? AppRepository_1.repository.getProduct(options.input.productId) : null;
        const templates = DesignService_1.designService.listTemplates(format).map((template) => template.id);
        const defaultTemplateId = templates[0] ?? this.defaultTemplate(format);
        const prompt = [
            'Write a versioned multi-scene marketing video storyboard as strict JSON. Do not return markdown or runnable code.',
            `Pipeline: ${options.pipeline.label}. Scene roles in this exact order: ${options.pipeline.sceneBlueprint.join(', ')}.`,
            `Target final duration: ${durationMs}ms at 30fps. Keep each scene concise and between 1000ms and 8000ms.`,
            `Format: ${format}. Allowed templateId values: ${templates.join(', ')}.`,
            `Direction: ${options.pipeline.authorGuidance}`,
            product ? `Product: ${product.name}\nTagline: ${product.tagline}\nAudience: ${product.targetUser}\nProblem solved: ${product.painSolved}` : '',
            `Brief: ${options.context.prompt}`,
            options.context.wantsCaptions ? 'Include short captions for each scene with scene-relative startMs/endMs.' : 'Use an empty captions array.',
            options.context.wantsAudio ? 'Include a narration string that can be spoken comfortably within each scene.' : 'Narration may be empty.',
            'Do not invent facts, metrics, testimonials, or product capabilities not present in the brief.',
            'Return: {"version":1,"scenes":[{"id":"stable-kebab-id","role":"hook|problem|message|feature|proof|cta","durationMs":number,"narration":string,"captions":[{"text":string,"startMs":number,"endMs":number}],"transitionIn":{"type":"cut|fade|slide","durationMs":number},"spec":{"templateId":string,"title":string,"inputs":{"eyebrow":string,"headline":string,"subhead":string,"cta":string,"accentColor":"#RRGGBB","background":"gradient"}}}]}',
        ].filter(Boolean).join('\n\n');
        let parsed = null;
        let lastOutput = '';
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const request = attempt === 0
                ? prompt
                : `${prompt}\n\nYour previous response was invalid. Repair it into the exact JSON contract. Previous response:\n${lastOutput.slice(0, 6000)}`;
            try {
                const result = options.providerSelection.kind === 'byok'
                    ? await AiProviderService_1.aiProviderService.complete({ prompt: request, profileId: options.providerSelection.id })
                    : await AIService_1.aiService.complete(request, {
                        conversationId: `video-storyboard:${options.input.productId ?? 'none'}:${Date.now()}`,
                        agentId: options.providerSelection.id,
                        cwd: null,
                        onLog: (message, tone) => options.onProgress?.({ kind: 'log', message, tone: tone ?? 'info' }),
                        onToken: (token) => options.onProgress?.({ kind: 'token', text: token }),
                    });
                lastOutput = result.content;
                parsed = extractJson(result.content);
                if (Array.isArray(parsed?.scenes) && parsed.scenes.length)
                    break;
                parsed = null;
                options.onProgress?.({ kind: 'log', message: 'Storyboard JSON was invalid; running one bounded repair pass.', tone: 'error' });
            }
            catch (error) {
                options.onProgress?.({
                    kind: 'log',
                    message: error instanceof Error ? error.message : 'Storyboard authoring failed.',
                    tone: 'error',
                });
            }
        }
        const fallbackScenes = options.pipeline.sceneBlueprint.map((role, index) => ({
            id: `${role}-${index + 1}`,
            role,
            durationMs: Math.round(durationMs / options.pipeline.sceneBlueprint.length),
            transitionIn: { type: index === 0 ? 'cut' : 'fade', durationMs: index === 0 ? 0 : 250 },
            narration: '',
            captions: [],
            spec: {
                templateId: defaultTemplateId,
                title: role,
                inputs: {
                    eyebrow: role.toUpperCase(),
                    headline: index === 0 ? options.context.prompt.split(/[.!?]/)[0].slice(0, 90) : `${product?.name ?? 'The product'} — ${role}`,
                    subhead: options.context.prompt.slice(0, 180),
                    cta: role === 'cta' ? 'Learn more' : '',
                    accentColor: '#2563eb',
                    background: 'gradient',
                },
            },
        }));
        const source = parsed ?? { scenes: fallbackScenes };
        const storyboard = (0, storyboard_1.normalizeVideoStoryboard)({ ...source, pipelineId: options.pipeline.id, format, totalDurationMs: durationMs }, {
            pipeline: options.pipeline,
            format,
            durationMs,
            productId: options.input.productId ?? null,
            defaultTemplateId,
            forceTargetDuration: true,
        });
        if (!options.context.wantsCaptions)
            return storyboard;
        return {
            ...storyboard,
            scenes: storyboard.scenes.map((scene) => ({
                ...scene,
                captions: scene.captions?.length
                    ? scene.captions
                    : [{ text: scene.spec.inputs.headline, startMs: 0, endMs: scene.durationMs }],
            })),
        };
    }
    async produceScenePlan(run, onProgress, force = false) {
        const controller = this.controller(run.id);
        try {
            const pipeline = (0, pipelines_1.getVideoPipeline)(run.storyboard.pipelineId);
            onProgress?.({ kind: 'stage', runId: run.id, stage: 'scene-plan', message: 'Planning each scene visual…', tone: 'info' });
            const scenes = [];
            for (let index = 0; index < run.storyboard.storyboard.scenes.length; index += 1) {
                if (controller.signal.aborted)
                    throw new Error('Video run canceled.');
                const scene = run.storyboard.storyboard.scenes[index];
                if (!force && scene.previewAssetId) {
                    scenes.push(scene);
                    continue;
                }
                onProgress?.({
                    kind: 'scene', runId: run.id, stage: 'scene-plan', sceneId: scene.id, index: index + 1,
                    total: run.storyboard.storyboard.scenes.length, message: `Designing scene ${index + 1}: ${scene.role}`, tone: 'info',
                });
                const result = await DesignService_1.designService.designFromPrompt({
                    productId: run.storyboard.productId,
                    prompt: [
                        `Design the ${scene.role} scene for a ${pipeline.label.toLowerCase()} video.`,
                        `Headline: ${scene.spec.inputs.headline}`,
                        `Supporting line: ${scene.spec.inputs.subhead}`,
                        scene.spec.inputs.cta ? `CTA: ${scene.spec.inputs.cta}` : '',
                        `Full brief: ${run.context.prompt}`,
                        'Keep the supplied copy concise. Build one motion-friendly key visual with strong negative space and no tiny text.',
                    ].filter(Boolean).join('\n'),
                    format: run.storyboard.format,
                    referenceImagePath: run.context.referenceImagePath,
                    sourceImageAssetIds: run.context.sourceImageAssetIds,
                    useReferenceAsBackground: run.context.useReferenceAsBackground,
                    style: run.context.style,
                    count: 1,
                    agentId: run.context.agentId,
                    autoSave: false,
                    authorMode: false,
                    refine: false,
                }, (progress) => {
                    if (progress.kind === 'token' && progress.text)
                        onProgress?.({ kind: 'token', runId: run.id, text: progress.text });
                    if (progress.message)
                        onProgress?.({ kind: 'log', runId: run.id, message: progress.message, tone: progress.tone ?? 'info' });
                });
                const designed = result[0]?.spec ?? scene.spec;
                const sceneSpec = {
                    ...designed,
                    title: designed.title || `${pipeline.label} — ${scene.role}`,
                    inputs: {
                        ...designed.inputs,
                        extra: {
                            ...(designed.inputs.extra ?? {}),
                            videoStoryboardId: run.storyboardId,
                            videoSceneId: scene.id,
                            videoSceneRole: scene.role,
                        },
                    },
                };
                // Import the scene key visual as a tagged intermediate asset (no design document) so
                // it stays out of the Design Studio history and the default asset library.
                const previewAsset = await DesignService_1.designService.renderSceneAsset(sceneSpec, ['video-scene']);
                scenes.push({
                    ...scene,
                    spec: sceneSpec,
                    previewAssetId: previewAsset.id,
                    renderedClipAssetId: null,
                });
            }
            run = VideoRepository_1.videoRepository.save({
                runId: run.id,
                expectedRevision: run.revision,
                storyboard: { ...run.storyboard.storyboard, scenes },
                stage: 'scene-plan',
                pendingGate: null,
                review: null,
                assetId: null,
                error: null,
            });
            if (!run.context.autoRun && pipeline.gates.includes('scene-plan')) {
                run = VideoRepository_1.videoRepository.save({ runId: run.id, expectedRevision: run.revision, pendingGate: 'scene-plan' });
                this.emitGate(run, 'scene-plan', onProgress);
                return run;
            }
            return await this.produceAssets(run, onProgress);
        }
        catch (error) {
            throw this.failRun(run, error, onProgress, 'script');
        }
        finally {
            this.releaseController(run.id, controller);
        }
    }
    async produceAssets(run, onProgress, force = false) {
        const controller = this.controller(run.id);
        try {
            const pipeline = (0, pipelines_1.getVideoPipeline)(run.storyboard.pipelineId);
            onProgress?.({ kind: 'stage', runId: run.id, stage: 'assets', message: 'Rendering scene clips serially…', tone: 'info' });
            const scenes = [];
            for (let index = 0; index < run.storyboard.storyboard.scenes.length; index += 1) {
                const scene = run.storyboard.storyboard.scenes[index];
                if (!force && scene.renderedClipAssetId) {
                    scenes.push(scene);
                    continue;
                }
                onProgress?.({
                    kind: 'scene', runId: run.id, stage: 'assets', sceneId: scene.id, index: index + 1,
                    total: run.storyboard.storyboard.scenes.length, message: `Rendering scene ${index + 1} of ${run.storyboard.storyboard.scenes.length}`, tone: 'info',
                });
                const rendered = await DesignService_1.designService.renderVideo(scene.spec, {
                    durationMs: scene.durationMs,
                    fps: run.storyboard.storyboard.fps,
                    signal: controller.signal,
                    assetTags: ['video-scene'],
                }, (message) => onProgress?.({ kind: 'log', runId: run.id, message: `${scene.role}: ${message}`, tone: 'info' }));
                scenes.push({ ...scene, renderedClipAssetId: rendered.asset.id });
            }
            run = VideoRepository_1.videoRepository.save({
                runId: run.id,
                expectedRevision: run.revision,
                storyboard: { ...run.storyboard.storyboard, scenes },
                stage: 'assets',
                pendingGate: null,
                review: null,
                assetId: null,
                error: null,
            });
            if (!run.context.autoRun && pipeline.gates.includes('assets')) {
                run = VideoRepository_1.videoRepository.save({ runId: run.id, expectedRevision: run.revision, pendingGate: 'assets' });
                this.emitGate(run, 'assets', onProgress);
                return run;
            }
            return await this.compose(run, onProgress);
        }
        catch (error) {
            throw this.failRun(run, error, onProgress, 'scene-plan');
        }
        finally {
            this.releaseController(run.id, controller);
        }
    }
    async compose(run, onProgress, force = false) {
        const controller = this.controller(run.id);
        try {
            if (!force && run.storyboard.assetId && run.storyboard.review) {
                return run;
            }
            run = VideoRepository_1.videoRepository.save({
                runId: run.id,
                expectedRevision: run.revision,
                stage: 'compose',
                pendingGate: null,
                review: null,
                assetId: null,
                error: null,
            });
            onProgress?.({ kind: 'stage', runId: run.id, stage: 'compose', message: 'Composing the final video…', tone: 'info' });
            const clips = run.storyboard.storyboard.scenes.map((scene) => {
                const asset = scene.renderedClipAssetId ? AppRepository_1.repository.getAssetById(scene.renderedClipAssetId) : null;
                if (!asset)
                    throw new Error(`Rendered clip is missing for scene ${scene.id}.`);
                return { sceneId: scene.id, asset };
            });
            const result = await VideoComposeService_1.videoComposeService.compose({
                storyboard: run.storyboard.storyboard,
                clips,
                wantsAudio: run.context.wantsAudio,
                wantsCaptions: run.context.wantsCaptions,
                signal: controller.signal,
                onProgress: (message) => onProgress?.({ kind: 'log', runId: run.id, message, tone: 'info' }),
            });
            const pipelineLabel = (0, pipelines_1.getVideoPipeline)(run.storyboard.pipelineId).label;
            const hookHeadline = run.storyboard.storyboard.scenes[0]?.spec.inputs.headline.trim();
            const title = hookHeadline ? `${pipelineLabel} — ${hookHeadline}` : `${pipelineLabel} video`;
            const asset = await AssetService_1.assetService.importBytes(result.bytes, {
                originalName: `${slug(title)}.mp4`,
                mimeType: 'video/mp4',
                productId: run.storyboard.productId,
                title,
                tags: ['video', 'ai-video', 'storyboard'],
                metadata: {
                    source: 'video-orchestrator',
                    storyboardId: run.storyboardId,
                    runId: run.id,
                    pipelineId: run.storyboard.pipelineId,
                    durationMs: run.storyboard.storyboard.totalDurationMs,
                    sceneCount: run.storyboard.storyboard.scenes.length,
                    review: result.review,
                    providerSelection: run.providerSelection,
                },
            });
            run = VideoRepository_1.videoRepository.save({
                runId: run.id,
                expectedRevision: run.revision,
                stage: 'review',
                pendingGate: null,
                review: result.review,
                assetId: asset.id,
                error: null,
            });
            onProgress?.({ kind: 'review', runId: run.id, stage: 'review', review: result.review, message: result.review.passed ? 'Review passed.' : 'Review found issues.', tone: result.review.passed ? 'success' : 'error' });
            const pipeline = (0, pipelines_1.getVideoPipeline)(run.storyboard.pipelineId);
            if (!run.context.autoRun && pipeline.gates.includes('publish')) {
                run = VideoRepository_1.videoRepository.save({ runId: run.id, expectedRevision: run.revision, pendingGate: 'publish' });
                this.emitGate(run, 'publish', onProgress);
                return run;
            }
            return VideoRepository_1.videoRepository.save({ runId: run.id, expectedRevision: run.revision, stage: 'done', pendingGate: null });
        }
        catch (error) {
            throw this.failRun(run, error, onProgress, 'assets');
        }
        finally {
            this.releaseController(run.id, controller);
        }
    }
    emitGate(run, gate, onProgress) {
        const messages = {
            script: 'Review the scene script before visual planning.',
            'scene-plan': 'Review the scene visuals before clip rendering.',
            assets: 'Review the rendered scene clips before final compose.',
            publish: 'Review the final MP4 and quality report before approval.',
        };
        onProgress?.({ kind: 'gate', runId: run.id, gate, message: messages[gate], tone: 'info' });
    }
    controller(runId) {
        const current = this.activeRuns.get(runId);
        if (current)
            return current;
        const controller = new AbortController();
        this.activeRuns.set(runId, controller);
        return controller;
    }
    releaseController(runId, controller) {
        if (this.activeRuns.get(runId) === controller)
            this.activeRuns.delete(runId);
    }
    failRun(run, error, onProgress, retryGate = null) {
        const message = error instanceof Error ? error.message : 'Video run failed.';
        const latest = VideoRepository_1.videoRepository.getRun(run.id);
        if (latest && latest.stage !== 'failed') {
            try {
                VideoRepository_1.videoRepository.save({
                    runId: latest.id,
                    expectedRevision: latest.revision,
                    stage: 'failed',
                    pendingGate: retryGate,
                    error: message,
                });
            }
            catch {
                // Preserve the original render failure when a concurrent editor moved the run.
            }
        }
        onProgress?.({ kind: 'stage', runId: run.id, stage: 'failed', message, tone: 'error' });
        return error instanceof Error ? error : new Error(message);
    }
    toPublicRun(run) {
        const finalAsset = run.storyboard.assetId ? AppRepository_1.repository.getAssetById(run.storyboard.assetId) : null;
        const previewUrl = finalAsset ? AssetService_1.assetService.previewUrl(finalAsset.id).url : null;
        return {
            id: run.id,
            storyboardId: run.storyboardId,
            stage: run.stage,
            pendingGate: run.pendingGate,
            revision: run.revision,
            error: run.error,
            providerSelection: run.providerSelection,
            storyboard: run.storyboard,
            finalAsset,
            previewUrl,
            createdAt: run.createdAt,
            updatedAt: run.updatedAt,
        };
    }
}
exports.VideoOrchestratorService = VideoOrchestratorService;
exports.videoOrchestratorService = new VideoOrchestratorService();
//# sourceMappingURL=VideoOrchestratorService.js.map