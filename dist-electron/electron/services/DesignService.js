"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.designService = exports.DesignService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const axios_1 = __importDefault(require("axios"));
const AppRepository_1 = require("./AppRepository");
const AssetService_1 = require("./AssetService");
const RenderService_1 = require("./RenderService");
const ImageGenService_1 = require("./ImageGenService");
const AIService_1 = require("./AIService");
const AiProviderService_1 = require("./AiProviderService");
const templates_1 = require("./design/templates");
const fonts_1 = require("./design/fonts");
const artDirection_1 = require("./design/artDirection");
const designSystems_1 = require("./design/designSystems");
const VideoRenderService_1 = require("./design/VideoRenderService");
const contentLanguage_1 = require("../utils/contentLanguage");
const IMAGE_MIME_BY_EXT = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
};
const TREATMENTS = ['mesh', 'aurora', 'spotlight', 'geometric', 'gridlines', 'linear'];
const DECORATIONS = ['glow', 'ring', 'dots', 'corner-marks', 'noise'];
const DENSITIES = ['airy', 'balanced', 'compact'];
/** Distinct background/decoration recipes so multi-variant output reads as *designed*, not random. */
const VARIANT_RECIPES = [
    { treatment: 'mesh', decoration: ['glow'] },
    { treatment: 'spotlight', decoration: [] },
    { treatment: 'aurora', decoration: ['noise'] },
    { treatment: 'geometric', decoration: ['dots'] },
    { treatment: 'gridlines', decoration: [] },
];
class DesignService {
    listFormats() {
        return templates_1.DESIGN_FORMATS;
    }
    listTemplates(format) {
        return (0, templates_1.listTemplates)(format);
    }
    /** Bundled brand/aesthetic design systems used as selectable style presets. */
    listDesignSystems() {
        return (0, designSystems_1.listDesignSystems)();
    }
    listDocuments(options = {}) {
        return AppRepository_1.repository.listDesignDocuments(options);
    }
    getDocument(id) {
        return AppRepository_1.repository.getDesignDocument(id);
    }
    deleteDocument(id) {
        return AppRepository_1.repository.deleteDesignDocument(id);
    }
    /** Render a spec to PNG bytes without persisting anything (used for live preview). */
    async renderPng(spec) {
        const ctx = await this.buildContext(spec);
        const html = (0, templates_1.renderTemplate)(spec.templateId, ctx);
        return RenderService_1.renderService.renderHtmlToPng(html, { width: ctx.width, height: ctx.height });
    }
    /** Render a spec to a data URL (cheap transport for the renderer preview). */
    async renderPreview(spec) {
        const info = (0, templates_1.formatInfo)(spec.format);
        const png = await this.renderPng(spec);
        return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: info.width, height: info.height };
    }
    /**
     * Render a spec to its raw HTML (no Chromium round-trip). The renderer shows this
     * in a sandboxed `srcdoc` iframe for an instant, live preview while editing; the
     * PNG path above stays the source of truth for export.
     */
    async renderHtml(spec) {
        const ctx = await this.buildContext(spec);
        const html = (0, templates_1.renderTemplate)(spec.templateId, ctx);
        return { html, width: ctx.width, height: ctx.height };
    }
    /**
     * HyperFrames: render the design as a short animated MP4 (offscreen Chromium frame
     * capture + FFmpeg), save it as a managed video asset, and return a data URL so the
     * renderer can preview it immediately.
     */
    async renderVideo(spec, options = {}, onProgress) {
        const durationMs = Math.max(1000, Math.min(15000, options.durationMs ?? 4000));
        const ctx = await this.buildContext(spec);
        const html = (0, templates_1.renderTemplate)(spec.templateId, { ...ctx, animate: true, durationMs });
        onProgress?.('Rendering frames…');
        const mp4 = await VideoRenderService_1.videoRenderService.renderHtmlToMp4(html, {
            width: ctx.width,
            height: ctx.height,
            fps: options.fps,
            durationMs,
            onProgress,
            signal: options.signal,
        });
        const title = spec.title?.trim() || this.defaultTitle(spec);
        const asset = await AssetService_1.assetService.importBytes(mp4, {
            originalName: `${slug(title)}-${spec.format}.mp4`,
            mimeType: 'video/mp4',
            productId: spec.productId ?? null,
            title: `${title} (video)`,
            tags: ['design', 'video', ...(options.assetTags ?? [])],
            metadata: {
                source: 'design-studio-video',
                templateId: spec.templateId,
                format: spec.format,
                durationMs,
                ...sourceCampaignMetadata(spec),
            },
        });
        // Hand back a streaming URL (mt-local-file serves byte ranges) instead of a base64
        // payload: encoding + IPC-shipping a multi-MB MP4 string was slow and pinned the
        // whole video in renderer memory just to preview it.
        const { url } = AssetService_1.assetService.previewUrl(asset.id);
        return { asset, url: url ?? `data:video/mp4;base64,${mp4.toString('base64')}` };
    }
    /**
     * Render a spec to a PNG and import it as a standalone managed asset WITHOUT creating a
     * design document. Used for per-scene video key visuals: they need a preview asset but must
     * not clutter the Design Studio document history. Callers pass a tag (e.g. 'video-scene') so
     * `listAssets` can hide them from default library/picker views.
     */
    async renderSceneAsset(spec, tags) {
        const png = await this.renderPng(spec);
        const title = spec.title?.trim() || this.defaultTitle(spec);
        return AssetService_1.assetService.importBytes(png, {
            originalName: `${slug(title)}-${spec.format}.png`,
            mimeType: 'image/png',
            productId: spec.productId ?? null,
            title,
            tags,
            metadata: {
                source: 'video-scene',
                templateId: spec.templateId,
                format: spec.format,
                ...sourceCampaignMetadata(spec),
            },
        });
    }
    /** Render, save the PNG as a managed image asset, and upsert the design document. */
    async save(spec) {
        const png = await this.renderPng(spec);
        const saved = await this.persistRenderedDesign(spec, png, { source: 'design-studio', tags: ['design'] });
        return { doc: saved.doc, asset: saved.asset };
    }
    /**
     * AI pass: write copy (and optionally generate a background image), returning the
     * enriched inputs. Composition/rendering is a separate step the caller drives.
     */
    async generate(spec, onProgress) {
        const product = spec.productId ? AppRepository_1.repository.getProduct(spec.productId) : null;
        let inputs = { ...spec.inputs };
        onProgress?.('Writing copy…');
        inputs = await this.writeCopy(spec, product, inputs);
        if (inputs.background === 'generated' && inputs.backgroundPrompt?.trim()) {
            onProgress?.('Generating image…');
            try {
                const info = (0, templates_1.formatInfo)(spec.format);
                const result = await ImageGenService_1.imageGenService.generate(inputs.backgroundPrompt.trim(), {
                    width: info.width,
                    height: info.height,
                });
                const asset = await AssetService_1.assetService.importBytes(result.data, {
                    originalName: `${slug(inputs.backgroundPrompt).slice(0, 40) || 'background'}.png`,
                    mimeType: result.mimeType,
                    productId: spec.productId ?? null,
                    title: 'AI background',
                    tags: ['design', 'ai-generated'],
                    metadata: { source: 'design-image-gen', prompt: inputs.backgroundPrompt, provider: result.provider },
                });
                inputs.backgroundAssetId = asset.id;
            }
            catch (error) {
                onProgress?.(error instanceof Error ? error.message : 'Image generation failed.');
                // Fall back to a gradient so the design still renders.
                inputs.background = 'gradient';
            }
        }
        return inputs;
    }
    /**
     * Generate one art-directed social graphic and return the saved asset. Used to auto-illustrate
     * posts that require an image (e.g. Instagram) straight from a caption/brief. Campaign images
     * deliberately use the same freeform-layout + visual-review path as Design Studio instead of
     * quietly falling back to the lower-fidelity deterministic template path.
     */
    async generateSocialImage(input) {
        const [variant] = await this.designFromPrompt({
            productId: input.productId ?? null,
            prompt: input.prompt,
            fallbackHeadline: input.fallbackHeadline,
            format: input.format ?? 'social_square',
            style: input.style ?? null,
            agentId: input.agentId ?? null,
            count: 1,
            autoSave: true,
            authorMode: true,
            refine: true,
        });
        if (!variant)
            throw new Error('Image generation returned no result.');
        const docId = variant.spec.docId ?? null;
        const assetId = docId ? AppRepository_1.repository.getDesignDocument(docId)?.previewAssetId ?? null : null;
        const asset = assetId ? AppRepository_1.repository.getAssetById(assetId) : null;
        if (!asset)
            throw new Error('Generated image was not saved to Assets.');
        return { asset, dataUrl: variant.dataUrl };
    }
    /** Standalone text-to-image: returns a managed image asset. */
    async generateImage(prompt, options) {
        const result = await ImageGenService_1.imageGenService.generate(prompt, {
            width: options.width ?? 1024,
            height: options.height ?? 1024,
        });
        return AssetService_1.assetService.importBytes(result.data, {
            originalName: `${slug(prompt).slice(0, 40) || 'image'}.png`,
            mimeType: result.mimeType,
            productId: options.productId ?? null,
            title: prompt.slice(0, 80),
            tags: ['ai-generated'],
            metadata: { source: 'design-image-gen', prompt, provider: result.provider },
        });
    }
    imageGenAvailable() {
        return ImageGenService_1.imageGenService.isConfigured();
    }
    /**
     * "Design anything" — a free-form brief (plus an optional reference image) is sent to a
     * vision-capable local CLI agent, which returns a structured design that our engine
     * renders. Returns `count` rendered variants the user can pick from and refine.
     */
    async designFromPrompt(input, onProgress) {
        const count = Math.min(Math.max(input.count ?? 1, 1), 4);
        const product = input.productId ? AppRepository_1.repository.getProduct(input.productId) : null;
        const archetypes = (0, templates_1.templateIds)(input.format);
        const hasLogo = Boolean(product?.logoUrl);
        const designSystemId = input.style ?? null;
        const designSystem = (0, designSystems_1.getDesignSystem)(designSystemId);
        const tokens = (0, designSystems_1.getDesignTokens)(designSystemId);
        const seedAccent = /^#[0-9a-fA-F]{6}$/.test(tokens.palette.accent) && tokens.palette.accent.toLowerCase() !== '#111111'
            ? tokens.palette.accent
            : designSystem?.accentColor && /^#[0-9a-fA-F]{6}$/.test(designSystem.accentColor)
                ? designSystem.accentColor
                : '#6750a4';
        if (designSystem) {
            onProgress?.({ kind: 'log', message: `Applying the ${designSystem.name} design system`, tone: 'info' });
            if (designSystem.referenceImagePath) {
                onProgress?.({ kind: 'log', message: 'Using the captured website as a visual brand reference', tone: 'info' });
            }
        }
        // Accept multiple attached references; the first doubles as the optional full-bleed background.
        const refPaths = (input.referenceImagePaths?.filter((path) => Boolean(path)) ?? []).length
            ? (input.referenceImagePaths.filter((path) => Boolean(path)))
            : input.referenceImagePath
                ? [input.referenceImagePath]
                : [];
        const sourceImageAssetIds = uniqueStrings(input.sourceImageAssetIds ?? []);
        const assetReferences = new Set(sourceImageAssetIds.flatMap((assetId) => {
            const asset = AppRepository_1.repository.getAssetById(assetId);
            return [asset?.localPath, asset?.publicUrl].filter((value) => Boolean(value));
        }));
        const primaryRef = input.referenceImagePath ?? refPaths[0] ?? null;
        const useRefAsBg = Boolean(input.useReferenceAsBackground && primaryRef);
        const sourceImageRefs = refPaths.filter((ref) => !assetReferences.has(ref) && !(useRefAsBg && ref === primaryRef));
        const hasSourceMedia = sourceImageAssetIds.length > 0 || sourceImageRefs.length > 0 || useRefAsBg;
        const needsVisionAgent = hasSourceMedia || Boolean(designSystem?.referenceImagePath);
        onProgress?.({ kind: 'stage', stage: 'analyze', message: 'Selecting a design agent…', tone: 'info' });
        // Plain briefs can use any active route, including BYOK. Local source images
        // require a CLI that can open files, so only that capability-specific path
        // resolves a vision agent automatically.
        const agentId = needsVisionAgent
            ? await this.pickVisionAgentId(input.agentId)
            : input.agentId ?? null;
        onProgress?.({
            kind: 'log',
            message: agentId ? `Briefing ${agentId}` : 'Briefing the current AI route',
            tone: 'info',
        });
        if (refPaths.length) {
            onProgress?.({ kind: 'log', message: refPaths.length > 1 ? `Analyzing your ${refPaths.length} reference images…` : 'Analyzing your reference image…', tone: 'info' });
        }
        const promptText = this.buildDesignPrompt({
            input,
            product,
            designSystem,
            archetypes,
            useRefAsBg,
            count,
            refPaths,
            hasSourceMedia,
        });
        const fallback = this.fallbackBrief(input.fallbackHeadline ?? input.prompt, archetypes, seedAccent);
        let briefs = [fallback];
        onProgress?.({ kind: 'stage', stage: 'design', message: 'Designing layout and copy…', tone: 'info' });
        try {
            const { content } = await AIService_1.aiService.complete(promptText, {
                conversationId: `design-prompt:${input.productId ?? 'none'}`,
                agentId,
                // A free-form design brief is a pure text task. Running the CLI inside the
                // product's code repo makes a coding agent explore the repo and parrot the
                // product back, ignoring the brief — keep it out of any repo so the user's
                // brief stays authoritative.
                cwd: null,
                onLog: (message) => onProgress?.({ kind: 'log', message, tone: 'info' }),
                onToken: (text) => onProgress?.({ kind: 'token', text }),
            });
            briefs = this.parseBriefs(content, {
                fallback,
                archetypes,
                seedAccent,
                authorMode: input.authorMode && !hasSourceMedia,
                count,
            });
        }
        catch {
            // keep the prompt-derived fallback so we always return something renderable
        }
        const primaryBrief = briefs[0] ?? fallback;
        // Use the attached reference as the actual full-bleed background, not just a style cue.
        let backgroundAssetId = null;
        if (useRefAsBg && primaryRef) {
            onProgress?.({ kind: 'stage', stage: 'background', message: 'Placing your reference as the background…', tone: 'info' });
            try {
                const [asset] = await AssetService_1.assetService.importFiles([primaryRef], {
                    productId: input.productId ?? null,
                    managed: true,
                    tags: ['design', 'reference'],
                });
                if (asset)
                    backgroundAssetId = asset.id;
            }
            catch {
                // fall back to the AI-chosen background if the import fails
            }
        }
        // Hand the renderer the resolved design so it can animate the build with real values.
        onProgress?.({
            kind: 'plan',
            plan: {
                templateId: !hasSourceMedia && primaryBrief.authoredHtml ? 'authored' : primaryBrief.archetype,
                accentColor: primaryBrief.accentColor,
                background: backgroundAssetId ? 'asset' : primaryBrief.background,
                backgroundTreatment: primaryBrief.treatment,
                eyebrow: primaryBrief.eyebrow,
                headline: primaryBrief.headline,
                subhead: primaryBrief.subhead,
                cta: primaryBrief.cta,
                hasLogo: hasSourceMedia ? false : hasLogo,
            },
        });
        onProgress?.({ kind: 'stage', stage: 'palette', message: `Applying palette ${primaryBrief.accentColor}`, tone: 'info' });
        onProgress?.({ kind: 'stage', stage: 'text', message: 'Placing headline, subhead and CTA…', tone: 'info' });
        const order = [primaryBrief.archetype, ...archetypes.filter((id) => id !== primaryBrief.archetype)];
        // Saving a rendered variant (asset import + DB upsert) runs in the background so it
        // overlaps the next variant's Chromium render; results are collected in order below.
        const pendingVariants = [];
        // When the user asked for multiple variants and hasn't pinned a design system (the "Auto"
        // path, where sameness was worst), give each variant its own design system + accent +
        // density + fonts so the set reads as genuinely different directions, not one recolored card.
        const diversify = count > 1 && !designSystemId;
        const laneSystems = diversify
            ? DesignService.DIVERSE_SYSTEM_ORDER.filter((id) => Boolean((0, designSystems_1.getDesignSystem)(id)))
            : [];
        const seed = simpleSeed(input.prompt);
        for (let i = 0; i < count; i += 1) {
            onProgress?.({ kind: 'stage', stage: 'render', index: i + 1, total: count, message: `Rendering variant ${i + 1} of ${count}…`, tone: 'info' });
            // Prefer agent-authored per-variant briefs; when an agent returns a single brief,
            // rotate deterministic recipes so "4x" still reads as four alternatives.
            const variantBrief = briefs[i] ?? primaryBrief;
            const recipe = briefs[i]
                ? { treatment: variantBrief.treatment, decoration: variantBrief.decoration }
                : i === 0
                    ? { treatment: primaryBrief.treatment, decoration: primaryBrief.decoration }
                    : VARIANT_RECIPES[(i - 1) % VARIANT_RECIPES.length];
            const archetype = briefs[i] ? variantBrief.archetype : order[i % order.length] ?? primaryBrief.archetype;
            const authored = !hasSourceMedia && i === 0 && variantBrief.authoredHtml ? variantBrief.authoredHtml : null;
            // Per-variant divergence: a distinct system gives each variant its own palette (incl.
            // light vs dark), accent, density and fonts. Authored HTML opts out — it owns its own look.
            const laneSystemId = diversify && laneSystems.length && !authored ? laneSystems[(seed + i) % laneSystems.length] : designSystemId;
            // Honour the system's identity (palette accent + fonts) whenever one applies — both the
            // rotated Auto systems AND an explicitly pinned system — so "I picked Claymorphism" actually
            // renders in that system's clay palette/type instead of an agent-chosen blue. Without this,
            // a pinned system only set the light/dark background, leaving accent + fonts to the agent.
            // Authored HTML opts out (it owns its full look).
            const laneBrief = laneSystemId && !authored
                ? {
                    ...variantBrief,
                    accentColor: this.accentForSystem(laneSystemId, seed + i),
                    density: diversify ? DENSITIES[(seed + i) % DENSITIES.length] : variantBrief.density,
                    display: null,
                    body: null,
                }
                : variantBrief;
            let spec = this.briefToSpec(laneBrief, {
                input,
                designSystemId: laneSystemId,
                archetype,
                treatment: recipe.treatment,
                decoration: recipe.decoration,
                backgroundAssetId,
                authoredHtml: authored,
            });
            if (hasSourceMedia) {
                spec = {
                    ...spec,
                    inputs: {
                        ...spec.inputs,
                        extra: {
                            ...(spec.inputs.extra ?? {}),
                            sourceImageAssetIds,
                            sourceImageRefs,
                            preferSourceMedia: true,
                        },
                    },
                };
            }
            // Vision critique → refine, on the primary variant only, to bound latency.
            if (input.refine && i === 0) {
                spec = await this.critiqueAndRefine(spec, { agentId, brief: variantBrief, input, onProgress });
            }
            if (input.sourceCampaignRunId) {
                spec = {
                    ...spec,
                    inputs: {
                        ...spec.inputs,
                        extra: {
                            ...(spec.inputs.extra ?? {}),
                            sourceCampaignRunId: input.sourceCampaignRunId,
                            sourceCampaignName: input.sourceCampaignName ?? null,
                        },
                    },
                };
            }
            const png = await this.renderPng(spec);
            const variantIndex = i + 1;
            const saving = input.autoSave !== false
                ? this.persistRenderedDesign(spec, png, {
                    source: 'design-prompt',
                    tags: ['design', 'ai-generated'],
                    fileNameSuffix: count > 1 ? `variant-${variantIndex}` : undefined,
                    metadata: {
                        agentId,
                        designSystemId: laneSystemId,
                        variantIndex,
                        variantCount: count,
                    },
                })
                    .then((saved) => saved.spec)
                    .catch((error) => {
                    onProgress?.({
                        kind: 'log',
                        message: error instanceof Error ? `Rendered variant ${variantIndex}, but could not save it to Assets: ${error.message}` : `Rendered variant ${variantIndex}, but could not save it to Assets.`,
                        tone: 'error',
                    });
                    return spec;
                })
                : Promise.resolve(spec);
            pendingVariants.push(saving.then((savedSpec) => ({ spec: savedSpec, dataUrl: `data:image/png;base64,${png.toString('base64')}` })));
        }
        const out = await Promise.all(pendingVariants);
        onProgress?.({ kind: 'stage', stage: 'done', message: `Done — ${out.length} variant${out.length === 1 ? '' : 's'} ready`, tone: 'success' });
        return out;
    }
    /**
     * Conversational refine: take an already-rendered design plus a free-form instruction
     * ("make it darker", "use the screenshot as the background", "bigger headline"), show the
     * current PNG to a vision agent, and re-render the SAME design with the requested changes
     * applied. Preserves the design's system, background source and identity (docId) so an
     * auto-saved refine updates the existing asset/document in place.
     */
    async refineDesign(input, onProgress) {
        const spec = input.spec;
        const instruction = input.instruction.trim();
        if (!instruction)
            throw new Error('Describe the change you want.');
        const info = (0, templates_1.formatInfo)(spec.format);
        const archetypes = (0, templates_1.templateIds)(spec.format);
        const authorMode = spec.templateId === 'authored';
        const seedAccent = /^#[0-9a-fA-F]{6}$/.test(spec.inputs.accentColor ?? '') ? spec.inputs.accentColor : '#6750a4';
        onProgress?.({ kind: 'stage', stage: 'analyze', message: 'Selecting a vision design agent…', tone: 'info' });
        const agentId = await this.pickVisionAgentId(input.agentId);
        // A DesignBrief snapshot of the current design — both the agent's context and the fallback
        // when the model omits a field (so untouched aspects stay exactly as they were).
        const fallback = {
            archetype: archetypes.includes(spec.templateId) ? spec.templateId : archetypes[0] ?? 'gradient-bold',
            treatment: spec.inputs.backgroundTreatment ?? 'mesh',
            decoration: spec.inputs.decoration ?? [],
            density: spec.inputs.density ?? 'balanced',
            accentColor: seedAccent,
            background: spec.inputs.background === 'solid' ? 'solid' : 'gradient',
            eyebrow: spec.inputs.eyebrow ?? '',
            headline: spec.inputs.headline ?? '',
            subhead: spec.inputs.subhead ?? '',
            cta: spec.inputs.cta ?? '',
            display: spec.inputs.typePairing?.display ?? null,
            body: spec.inputs.typePairing?.body ?? null,
            authoredHtml: authorMode ? spec.inputs.authoredHtml ?? null : null,
        };
        onProgress?.({ kind: 'stage', stage: 'critique', message: 'Looking at the current design…', tone: 'info' });
        let improved = fallback;
        try {
            // Render the current design to a file the agent can open and see.
            const html = (0, templates_1.renderTemplate)(spec.templateId, await this.buildContext(spec));
            const { path: imagePath } = await RenderService_1.renderService.renderHtmlToPngFile(html, { width: info.width, height: info.height });
            const currentBrief = {
                archetype: fallback.archetype,
                backgroundTreatment: fallback.treatment,
                accentColor: fallback.accentColor,
                decoration: fallback.decoration,
                density: fallback.density,
                typePairing: { display: fallback.display, body: fallback.body },
                eyebrow: fallback.eyebrow,
                headline: fallback.headline,
                subhead: fallback.subhead,
                cta: fallback.cta,
            };
            const authoredLine = authorMode
                ? `This design is authored HTML. You may return an updated "html": a single self-contained fragment (inline styles + data: URIs only; no external URL/@import/<script>/<link>/remote font) laying out the whole ${info.width}x${info.height}px canvas. Omit "html" to fall back to a template archetype.`
                : '';
            const prompt = [
                'You are a senior brand/marketing graphic designer revising a graphic at the client\'s request.',
                `Open and look at the current rendered PNG first: ${imagePath}`,
                `Current design (JSON): ${JSON.stringify(currentBrief)}`,
                `Client's change request: "${instruction}"`,
                'Apply EXACTLY what they ask and keep everything else the same. Reply with the FULL updated design as STRICT JSON only — no prose, no code fences — using the same shape.',
                `archetype ∈ {${archetypes.join(', ')}}; backgroundTreatment ∈ {${TREATMENTS.join(', ')}}; decoration ⊆ {${DECORATIONS.join(', ')}}; density ∈ {${DENSITIES.join(', ')}}.`,
                `typePairing: { "display": one of ${fonts_1.DISPLAY_FONT_IDS.join(' | ')}, "body": one of ${fonts_1.BODY_FONT_IDS.join(' | ')} }.`,
                authoredLine,
                `JSON shape: {"archetype": string, "backgroundTreatment": string, "accentColor": "#RRGGBB", "decoration": string[], "density": string, "typePairing": {"display": string, "body": string}, "eyebrow": string, "headline": string, "subhead": string, "cta": string${authorMode ? ', "html": string (optional)' : ''}}`,
            ]
                .filter(Boolean)
                .join('\n');
            const { content } = await AIService_1.aiService.complete(prompt, {
                conversationId: `design-refine:${spec.productId ?? 'none'}:${spec.docId ?? 'new'}`,
                agentId,
                cwd: null,
                onLog: (message) => onProgress?.({ kind: 'log', message, tone: 'info' }),
                onToken: (text) => onProgress?.({ kind: 'token', text }),
            });
            improved = this.parseBrief(content, { fallback, archetypes, seedAccent, authorMode });
        }
        catch (error) {
            onProgress?.({ kind: 'log', message: error instanceof Error ? error.message : 'Could not reach the design agent; re-rendering unchanged.', tone: 'error' });
        }
        onProgress?.({ kind: 'stage', stage: 'refine', message: 'Applying your change…', tone: 'success' });
        const refinedSpec = this.briefToSpec(improved, {
            input: { productId: spec.productId ?? null, format: spec.format },
            designSystemId: spec.inputs.designSystemId ?? null,
            archetype: improved.archetype,
            treatment: improved.treatment,
            decoration: improved.decoration,
            backgroundAssetId: spec.inputs.backgroundAssetId ?? null,
            authoredHtml: authorMode ? improved.authoredHtml ?? spec.inputs.authoredHtml ?? null : null,
        });
        // Keep the same document/title so an auto-saved refine updates in place, not a duplicate.
        refinedSpec.docId = spec.docId ?? null;
        refinedSpec.title = spec.title?.trim() || improved.headline || refinedSpec.title;
        refinedSpec.inputs.extra = spec.inputs.extra ? { ...spec.inputs.extra } : undefined;
        onProgress?.({ kind: 'stage', stage: 'render', index: 1, total: 1, message: 'Re-rendering…', tone: 'info' });
        const png = await this.renderPng(refinedSpec);
        let savedSpec = refinedSpec;
        if (input.autoSave !== false) {
            try {
                const saved = await this.persistRenderedDesign(refinedSpec, png, {
                    source: 'design-refine',
                    tags: ['design', 'ai-generated'],
                    metadata: { agentId, refinedFrom: spec.docId ?? null, instruction },
                });
                savedSpec = saved.spec;
            }
            catch (error) {
                onProgress?.({ kind: 'log', message: error instanceof Error ? `Refined, but could not save: ${error.message}` : 'Refined, but could not save.', tone: 'error' });
            }
        }
        onProgress?.({ kind: 'stage', stage: 'done', message: 'Refined design ready', tone: 'success' });
        return { spec: savedSpec, dataUrl: `data:image/png;base64,${png.toString('base64')}` };
    }
    /** Compose the structured-design prompt (with optional authored-HTML instructions). */
    buildDesignPrompt(args) {
        const { input, product, designSystem, archetypes, useRefAsBg, count, refPaths, hasSourceMedia } = args;
        const info = (0, templates_1.formatInfo)(input.format);
        const brandBrief = product ? productBrandBrief(product) : '';
        const authorMode = Boolean(input.authorMode && !hasSourceMedia);
        const briefShape = '{"archetype": string, "backgroundTreatment": string, "accentColor": "#RRGGBB", "decoration": string[], "density": string, "typePairing": {"display": string, "body": string}, "eyebrow": string (<=4 words, optional), "headline": string (<=8 words), "subhead": string (<=16 words), "cta": string (<=4 words)' +
            (authorMode ? `, "html": string (${count > 1 ? 'required on the first variant only' : 'required'})` : '') +
            '}';
        const authoredLine = authorMode
            ? `${count > 1 ? 'For the FIRST variant only, also return' : 'Also return'} "html": one self-contained HTML fragment with exactly one root element that fills the WHOLE ${info.width}x${info.height}px canvas.${count > 1 ? ' Omit html on later variants so they stay concise.' : ''} Author the composition yourself for maximum craft; use inline styles only and the CSS variables --accent, --ink, --ink-soft, --hair, --font-display, --font-body, --radius-lg and --card. Use CSS gradients and shapes for artwork — do not use url(), data URIs, external resources, @import, <script>, <style>, <link> or remote fonts. Keep all intended content inside a 6% safe area. The fragment must render as final artwork: no code, CSS, markup, debug copy, overflow or clipped text may be visible.`
            : '';
        return [
            count > 1
                ? `You are an award-winning brand/marketing graphic designer. Design ${count} materially different marketing graphic variants and reply with STRICT JSON only — no prose, no code fences.`
                : 'You are an award-winning brand/marketing graphic designer. Design ONE marketing graphic and reply with STRICT JSON only — no prose, no code fences.',
            'The brief below is the single source of truth for the subject and message. Design exactly what it asks for, even if it names a different company, product or website than any other context here.',
            `Brief: ${input.prompt}`,
            designSystem
                ? `Apply this design system — it governs HOW the graphic looks (palette, type mood, spacing, voice), not WHAT it says. Honour its colours and pick an accentColor consistent with it:\n${designSystem.spec}`
                : '',
            designSystem?.referenceImagePath
                ? `Website style reference: open and inspect this captured website screenshot before designing: ${designSystem.referenceImagePath}\nBorrow its palette roles, typography mood, density, shapes, spacing rhythm, and image treatment. Create new artwork; do not reproduce the page layout or copy.`
                : '',
            refPaths.length === 1
                ? `A source image is attached at this path or URL — open and analyze it, then design around it as actual visual content rather than replacing it with a company screenshot: ${refPaths[0]}`
                : refPaths.length > 1
                    ? `${refPaths.length} source images are attached at these paths or URLs — open and analyze EACH, then compose the design around them as actual visual content rather than replacing them with company screenshots:\n${refPaths.map((path, index) => `  ${index + 1}. ${path}`).join('\n')}`
                    : '',
            hasSourceMedia
                ? 'Source-media rule: the attached/campaign images are the post visuals. Do not use the company logo or company screenshot as substitute artwork.'
                : '',
            useRefAsBg
                ? 'The reference image will be the full-bleed background, so keep the headline + CTA legible over it and pick an accentColor that contrasts well.'
                : '',
            brandBrief,
            `Output format/size: ${input.format} (${info.width}x${info.height}px).`,
            count > 1
                ? `Every variant must be a TRUE alternative, not a minor recolor. Across the ${count}, deliberately vary: layout archetype (no two the same), background treatment, density, type pairing, visual metaphor, AND accentColor (give each a distinct hue family — do not reuse one accent). Mix light and dark: at least one variant should read light/airy and at least one dark/bold. Do not return ${count} centered gradient hero cards.`
                : 'Make the direction specific to the brief; do not default to a generic centered gradient hero card.',
            'Professional art-direction bar:',
            '- Build one unmistakable focal idea and a deliberate grid. The hierarchy must still read at 25% size.',
            '- Prefer one short headline (2–8 words), one supporting line, and only a CTA the brief actually needs.',
            '- Use contrast, scale, alignment, crop and negative space intentionally. Avoid decorative filler, fake microcopy, repetitive glass cards and generic gradient blobs.',
            '- Keep important text and marks in the safe area. Never crop copy, expose implementation text, or place low-contrast type over artwork.',
            'Choose every field intentionally for the message and audience:',
            `- archetype (layout): one of ${archetypes.join(', ')}.`,
            `- backgroundTreatment (generated art): one of ${TREATMENTS.join(', ')}.`,
            `- decoration: 0–2 of ${DECORATIONS.join(', ')} (subtle; omit if it would add noise).`,
            `- density: one of ${DENSITIES.join(', ')}.`,
            `- typePairing: { "display": one of ${fonts_1.DISPLAY_FONT_IDS.join(' | ')}, "body": one of ${fonts_1.BODY_FONT_IDS.join(' | ')} }.`,
            'Write crisp, specific copy that speaks to the brief — never generic filler, never about any other project.',
            authoredLine,
            count > 1 ? `JSON shape: {"variants":[${briefShape}, ...]} with exactly ${count} items.` : `JSON shape: ${briefShape}`,
        ]
            .filter(Boolean)
            .join('\n');
    }
    /** Deterministic brief used before/without a model response, so we always render something. */
    fallbackBrief(prompt, archetypes, seedAccent) {
        const headline = prompt
            .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
            .replace(/^[#>*\-\s]+/gm, '')
            .replace(/\s+/g, ' ')
            .trim();
        return {
            archetype: archetypes[0] ?? 'gradient-bold',
            treatment: 'mesh',
            decoration: ['glow'],
            density: 'balanced',
            accentColor: seedAccent,
            background: 'gradient',
            eyebrow: '',
            headline: headline.slice(0, 60),
            subhead: '',
            cta: '',
            display: null,
            body: null,
            authoredHtml: null,
        };
    }
    /** Validate + normalize the model's JSON into a DesignBrief, falling back per-field. */
    parseBrief(content, opts) {
        const parsed = extractJson(content);
        if (!parsed)
            return opts.fallback;
        return this.parseBriefObject(parsed, opts);
    }
    /** Parse one or more model-authored variants. Supports the old single-object shape. */
    parseBriefs(content, opts) {
        const parsed = extractJson(content);
        if (!parsed)
            return [opts.fallback];
        const variants = Array.isArray(parsed.variants)
            ? parsed.variants
            : Array.isArray(parsed.designs)
                ? parsed.designs
                : Array.isArray(parsed.options)
                    ? parsed.options
                    : [parsed];
        return variants
            .slice(0, opts.count)
            .map((entry) => this.parseBriefObject(isRecord(entry) ? entry : {}, opts))
            .filter((brief) => Boolean(brief.headline));
    }
    parseBriefObject(parsed, opts) {
        const pick = (value, allowed, fallback) => {
            const v = str(value);
            return allowed.includes(v) ? v : fallback;
        };
        const accent = str(parsed.accentColor);
        const decoration = Array.isArray(parsed.decoration)
            ? parsed.decoration.map((d) => str(d)).filter((d) => DECORATIONS.includes(d)).slice(0, 2)
            : opts.fallback.decoration;
        const pairing = (parsed.typePairing && typeof parsed.typePairing === 'object' ? parsed.typePairing : {});
        const authoredHtml = opts.authorMode ? (0, templates_1.sanitizeAuthoredHtml)(str(parsed.html)) : null;
        return {
            archetype: opts.archetypes.includes(str(parsed.archetype)) ? str(parsed.archetype) : opts.fallback.archetype,
            treatment: pick(parsed.backgroundTreatment, TREATMENTS, 'mesh'),
            decoration,
            density: pick(parsed.density, DENSITIES, 'balanced'),
            accentColor: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : opts.seedAccent,
            background: str(parsed.background) === 'solid' ? 'solid' : 'gradient',
            eyebrow: str(parsed.eyebrow).split(/\s+/).slice(0, 5).join(' '),
            headline: str(parsed.headline) || opts.fallback.headline,
            subhead: str(parsed.subhead),
            cta: str(parsed.cta),
            display: getDisplayFontId(str(pairing.display)),
            body: getBodyFontId(str(pairing.body)),
            authoredHtml,
        };
    }
    /** Turn a brief + per-variant overrides into a renderable DesignSpec. */
    briefToSpec(brief, opts) {
        const inputs = {
            headline: brief.headline,
            subhead: brief.subhead,
            cta: brief.cta,
            eyebrow: brief.eyebrow,
            accentColor: brief.accentColor,
            background: opts.backgroundAssetId ? 'asset' : brief.background,
            backgroundAssetId: opts.backgroundAssetId,
            backgroundTreatment: opts.treatment,
            decoration: opts.decoration,
            density: brief.density,
            designSystemId: opts.designSystemId,
            typePairing: { display: brief.display, body: brief.body },
            authoredHtml: opts.authoredHtml,
        };
        return {
            productId: opts.input.productId ?? null,
            title: brief.headline,
            templateId: opts.authoredHtml ? 'authored' : opts.archetype,
            format: opts.input.format,
            inputs,
        };
    }
    /**
     * Vision critique loop: render the variant to a PNG file, let the same agent see it and
     * return an improved design (same JSON shape), then re-spec it. One round, best-effort —
     * any failure returns the original spec unchanged.
     */
    async critiqueAndRefine(spec, ctx) {
        const { onProgress } = ctx;
        onProgress?.({ kind: 'stage', stage: 'critique', message: 'Reviewing the render like an art director…', tone: 'info' });
        try {
            const info = (0, templates_1.formatInfo)(ctx.input.format);
            const html = (0, templates_1.renderTemplate)(spec.templateId, await this.buildContext(spec));
            const { path: imagePath } = await RenderService_1.renderService.renderHtmlToPngFile(html, { width: info.width, height: info.height });
            const archetypes = (0, templates_1.templateIds)(ctx.input.format);
            const authoredMode = spec.templateId === 'authored' && Boolean(spec.inputs.authoredHtml);
            const critiquePrompt = [
                'You are a senior art director reviewing a marketing graphic you just designed.',
                `The rendered PNG is at this local path — open and look at it: ${imagePath}`,
                'Inspect it at full size and thumbnail size. Check contrast, hierarchy, balance, whitespace, alignment, safe margins, clipped text, visible CSS/markup, and whether the result feels intentional rather than template-generated.',
                authoredMode
                    ? 'This is a freeform authored layout. Return a complete revised "html" fragment that fixes every issue you see while preserving the message. Use one full-canvas root element, inline styles, CSS gradients/shapes and the supplied CSS variables only. Do not use url(), data URIs, external resources, scripts, style/link tags, or remote fonts.'
                    : 'Return an improved structured design using the same message/copy. Change only visual decisions that materially improve the render.',
                'Reply with STRICT JSON only — no critique prose and no code fences. The next step renders your response directly as final artwork.',
                `archetype ∈ {${archetypes.join(', ')}}; backgroundTreatment ∈ {${TREATMENTS.join(', ')}}; decoration ⊆ {${DECORATIONS.join(', ')}}; density ∈ {${DENSITIES.join(', ')}}.`,
                authoredMode ? `Current authored fragment:\n${spec.inputs.authoredHtml?.slice(0, 24_000) ?? ''}` : '',
                `JSON shape: {"archetype": string, "backgroundTreatment": string, "accentColor": "#RRGGBB", "decoration": string[], "density": string, "typePairing": {"display": string, "body": string}, "eyebrow": string, "headline": string, "subhead": string, "cta": string${authoredMode ? ', "html": string' : ''}}`,
            ]
                .filter(Boolean)
                .join('\n');
            const { content } = await AIService_1.aiService.complete(critiquePrompt, {
                conversationId: `design-critique:${ctx.input.productId ?? 'none'}`,
                agentId: ctx.agentId,
                cwd: null,
                onLog: (message) => onProgress?.({ kind: 'log', message, tone: 'info' }),
                onToken: (text) => onProgress?.({ kind: 'token', text }),
            });
            const improved = this.parseBrief(content, {
                fallback: ctx.brief,
                archetypes,
                seedAccent: ctx.brief.accentColor,
                authorMode: authoredMode,
            });
            onProgress?.({ kind: 'stage', stage: 'refine', message: 'Applying the art-director notes…', tone: 'success' });
            // Re-spec with the improved visual choices; keep the variant's own design system (so a
            // refined variant 0 stays on its diversified palette) and background source + authored body.
            const improvedSpec = this.briefToSpec(improved, {
                input: ctx.input,
                designSystemId: spec.inputs.designSystemId ?? ctx.input.style ?? null,
                archetype: improved.archetype,
                treatment: improved.treatment,
                decoration: improved.decoration,
                backgroundAssetId: spec.inputs.backgroundAssetId ?? null,
                authoredHtml: authoredMode ? improved.authoredHtml ?? spec.inputs.authoredHtml ?? null : null,
            });
            improvedSpec.inputs.extra = spec.inputs.extra ? { ...spec.inputs.extra } : undefined;
            return improvedSpec;
        }
        catch {
            return spec;
        }
    }
    /**
     * Generate images for an article. With a reference asset this is deliberately two-pass:
     * a vision agent reverse-engineers the source into a rebuildable blueprint first, then a
     * separate design pass combines that blueprint with the project profile, article, and
     * operator direction to author original alternatives.
     *
     * Whenever the operator supplies art direction (a reference image or a written direction)
     * the design pass authors full HTML/CSS per image instead of filling a fixed archetype —
     * the archetypes cannot express badge rows, fact chips or two-tone headlines, which is what
     * "make it look like this reference" almost always means. Each image degrades to an
     * archetype on its own if its markup comes back unusable.
     */
    async generateArticleImages(input) {
        const count = Math.min(Math.max(Math.round(input.count) || 1, 1), 8);
        const scope = input.scope ?? 'both';
        const product = input.productId ? AppRepository_1.repository.getProduct(input.productId) : null;
        const sourceContent = input.contentId ? AppRepository_1.repository.getContentById(input.contentId) : null;
        const body = input.content.length > 6000 ? `${input.content.slice(0, 6000)}\n…[truncated]` : input.content;
        const userPrompt = input.userPrompt?.trim().slice(0, 2000) ?? '';
        // The panel has no size picker, so the direction field is the only place an operator can
        // ask for one ("size là og:image", "make it a story").
        const format = input.format ?? (0, artDirection_1.formatFromDirection)(userPrompt) ?? 'feature_image';
        const info = (0, templates_1.formatInfo)(format);
        const templateIds = (0, templates_1.listTemplates)(format).map((entry) => entry.id);
        const agentId = input.referenceAssetId ? await this.pickVisionAgentId(input.agentId) : input.agentId ?? null;
        const referenceAnalysis = input.referenceAssetId
            ? await this.analyzeArticleImageReference({
                assetId: input.referenceAssetId,
                productId: input.productId ?? null,
                agentId,
            })
            : null;
        const authorMode = Boolean(referenceAnalysis || userPrompt);
        const languageLine = (0, contentLanguage_1.contentLanguageInstruction)({
            code: sourceContent?.metadata.language,
            name: sourceContent?.metadata.languageName,
            outputLabel: 'headlines, support copy, CTAs, and image captions',
        });
        const plural = count === 1 ? '' : 's';
        const scopeLine = scope === 'feature'
            ? `Design exactly ${count} FEATURE / hero image option${plural} for this post — each a strong standalone cover that captures the whole article.`
            : scope === 'body'
                ? `Design exactly ${count} in-article SECTION image${plural} that illustrate specific points or steps in the body. Vary the headlines so each highlights a different section.`
                : `Design exactly ${count} images: the first is the FEATURE / hero image, the rest are section images placed through the body. Vary the headlines so each highlights a different point.`;
        const briefShape = '{"role":"feature"|"section","templateId":string,"accentColor":"#RRGGBB","background":"gradient"|"solid",' +
            `"typePairing":{"display":one of ${fonts_1.DISPLAY_FONT_IDS.join(' | ')},"body":one of ${fonts_1.BODY_FONT_IDS.join(' | ')}},` +
            '"eyebrow":string (<=4 words, omit when it would be filler),"headline":string (<=8 words),"subhead":string (<=16 words),' +
            '"cta":string (<=4 words, omit when the post needs no CTA),"caption":string (where in the article this image fits)' +
            (authorMode ? ',"html":string (the authored fragment for THIS image)' : '') +
            '}';
        const promptText = [
            `You are an award-winning brand and marketing designer. ${scopeLine}`,
            'Reply with STRICT JSON only — no prose, no code fences.',
            `Canvas: ${format} — ${info.width}x${info.height}px, rendered once at exactly that size.`,
            `Post title: ${input.title}`,
            userPrompt
                ? `Operator direction (mandatory — it outranks every other instruction here except the language contract): ${userPrompt}`
                : '',
            referenceAnalysis
                ? [
                    'An art director inspected the operator\'s reference image and reverse-engineered it. Rebuild this design language with new content:',
                    JSON.stringify({
                        description: referenceAnalysis.description,
                        subject: referenceAnalysis.subject,
                        composition: referenceAnalysis.composition,
                        layoutBlueprint: referenceAnalysis.layoutBlueprint,
                        typeScale: referenceAnalysis.typeScale,
                        surfaceTreatment: referenceAnalysis.surfaceTreatment,
                        palette: referenceAnalysis.palette,
                        visualStyle: referenceAnalysis.visualStyle,
                        typography: referenceAnalysis.typography,
                        mood: referenceAnalysis.mood,
                        reusableCues: referenceAnalysis.reusableCues,
                        avoidCopying: referenceAnalysis.avoidCopying,
                    }, null, 2),
                    ...artDirection_1.REFERENCE_FIDELITY_RULES,
                ].join('\n')
                : '',
            product ? productBrandBrief(product) : '',
            product
                ? 'Project-match rule: the current project profile governs the audience, claims, brand voice, and final visual fit. The operator direction governs how this specific alternative should differ.'
                : '',
            languageLine ?? '',
            userPrompt
                ? 'Write every visible string in the language of the operator direction unless the language contract above says otherwise.'
                : '',
            'Draft the images must illustrate:',
            body,
            ...artDirection_1.ART_DIRECTION_RULES,
            `Fallback layout archetype — always set templateId to one of exactly: ${templateIds.join(', ')}.`,
            ...(authorMode ? (0, artDirection_1.authoredHtmlContract)(format) : []),
            ...artDirection_1.SELF_CHECK_RULES,
            count > 1
                ? `JSON shape: {"images":[${briefShape}, ...]} with exactly ${count} items. Every image must be a genuinely different composition, not a recolour.`
                : `JSON shape: {"images":[${briefShape}]} with exactly 1 item.`,
        ]
            .filter(Boolean)
            .join('\n');
        let briefs = [];
        try {
            const { content } = await AIService_1.aiService.complete(promptText, {
                conversationId: `article-images:${input.contentId ?? input.productId ?? 'none'}`,
                agentId,
                // Pure text task — keep it out of any repo so the article stays authoritative.
                cwd: null,
            });
            const parsed = extractJson(content);
            const images = parsed?.images;
            if (Array.isArray(images))
                briefs = images.filter((entry) => Boolean(entry) && typeof entry === 'object');
            // A long authored fragment is the most common reason the JSON comes back malformed.
            // Rather than throw the whole design away, keep any fenced fragments it did emit.
            if (!briefs.length && authorMode)
                briefs = salvageHtmlBriefs(content);
        }
        catch {
            // fall through to a title-derived fallback so we always return something
        }
        if (!briefs.length) {
            const fallbackRole = scope === 'body' ? 'section' : 'feature';
            const fallbackHeadline = userPrompt ||
                body
                    .split(/\r?\n/)
                    .map((line) => line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^[#>*\-\s\d.)]+/, '').trim())
                    .find(Boolean);
            briefs = [{
                    role: fallbackRole,
                    headline: fallbackHeadline?.slice(0, 80) || input.title,
                    caption: scope === 'body' ? 'Section image' : 'Feature image',
                }];
        }
        const referenceAccents = referenceAnalysis?.palette.filter((color) => /^#[0-9a-fA-F]{6}$/.test(color)) ?? [];
        const accents = [...referenceAccents, '#2563eb', '#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899'];
        const out = [];
        for (let i = 0; i < Math.min(briefs.length, count); i += 1) {
            const brief = briefs[i];
            const authoredHtml = authorMode ? (0, templates_1.sanitizeAuthoredHtml)(str(brief.html)) : null;
            const candidate = str(brief.templateId);
            const archetype = templateIds.includes(candidate) ? candidate : templateIds[i % templateIds.length] ?? templateIds[0];
            const templateId = authoredHtml ? 'authored' : archetype;
            const accent = str(brief.accentColor);
            // The scope decides the role; only "both" defers to the model / position.
            const role = scope === 'feature' ? 'feature' : scope === 'body' ? 'section' : str(brief.role) || (i === 0 ? 'feature' : 'section');
            const recipe = VARIANT_RECIPES[i % VARIANT_RECIPES.length];
            // Type is half the reference match — a heavy display face is unreachable without this.
            const pairing = isRecord(brief.typePairing) ? brief.typePairing : {};
            const inputs = {
                headline: str(brief.headline) || input.title,
                subhead: str(brief.subhead),
                cta: str(brief.cta),
                eyebrow: str(brief.eyebrow),
                typePairing: {
                    display: getDisplayFontId(str(pairing.display)),
                    body: getBodyFontId(str(pairing.body)),
                },
                accentColor: /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : accents[i % accents.length],
                background: brief.background === 'solid' ? 'solid' : 'gradient',
                backgroundTreatment: recipe.treatment,
                decoration: recipe.decoration,
                density: 'balanced',
                authoredHtml,
            };
            let spec = { productId: input.productId ?? null, title: inputs.headline, templateId, format, inputs };
            // One art-director pass on the hero only — it catches the defects a model cannot predict
            // from markup alone (a clipped descender, type that collides with the artwork) and is
            // bounded to a single extra round-trip.
            if (authoredHtml && i === 0 && referenceAnalysis) {
                spec = await this.polishAuthoredImage(spec, { agentId, direction: userPrompt, analysis: referenceAnalysis });
            }
            const png = await this.renderPng(spec);
            const asset = await AssetService_1.assetService.importBytes(png, {
                originalName: `${slug(inputs.headline).slice(0, 40) || 'article-image'}-${role}.png`,
                mimeType: 'image/png',
                productId: input.productId ?? null,
                title: inputs.headline.slice(0, 80),
                tags: ['design', 'blog-image', role],
                metadata: {
                    source: 'article-images',
                    contentId: input.contentId ?? null,
                    role,
                    caption: str(brief.caption),
                    templateId: spec.templateId,
                    archetype,
                    authored: Boolean(spec.inputs.authoredHtml),
                    format,
                    userPrompt: userPrompt || null,
                    referenceAssetId: input.referenceAssetId ?? null,
                    referenceAnalysis,
                },
            });
            out.push({ assetId: asset.id, dataUrl: `data:image/png;base64,${png.toString('base64')}`, caption: str(brief.caption), role });
        }
        return { images: out, referenceAnalysis };
    }
    /**
     * Render the authored image, show the PNG to the agent, and let it return corrected markup.
     * Authoring is blind — the model never sees what its CSS produced — so this is where clipped
     * text, collisions and dead space actually get caught. Any failure keeps the original spec.
     */
    async polishAuthoredImage(spec, ctx) {
        try {
            const info = (0, templates_1.formatInfo)(spec.format);
            const html = (0, templates_1.renderTemplate)(spec.templateId, await this.buildContext(spec));
            const { path: imagePath } = await RenderService_1.renderService.renderHtmlToPngFile(html, {
                width: info.width,
                height: info.height,
            });
            const prompt = [
                'You are the art director reviewing a rendered marketing graphic before it ships.',
                `Open and look at the render: ${imagePath}`,
                `Target canvas: ${info.width}x${info.height}px.`,
                ctx.direction ? `The operator asked for: ${ctx.direction}` : '',
                ctx.analysis.layoutBlueprint ? `The reference it should feel like: ${ctx.analysis.layoutBlueprint}` : '',
                'Judge only what you can see. Look for: clipped or overflowing text, cut diacritics, lines that collide or crowd the edges, weak hierarchy, an accent used more than once, low-contrast copy over artwork, awkward gaps, and any placeholder that slipped through.',
                'Here is the markup that produced it:',
                spec.inputs.authoredHtml ?? '',
                'Fix every defect you found and return the CORRECTED fragment only — raw HTML, no JSON, no prose, no code fence commentary. Keep the same design intent, copy and constraints (one root element, inline styles only, no url()/img/script/style/link/external font, fonts via var(--font-display) and var(--font-body)).',
                'If the render is already clean, return the markup unchanged.',
            ]
                .filter(Boolean)
                .join('\n');
            const { content } = await AIService_1.aiService.complete(prompt, {
                conversationId: `article-image-polish:${spec.productId ?? 'none'}`,
                agentId: ctx.agentId,
                cwd: null,
            });
            const fixed = (0, templates_1.sanitizeAuthoredHtml)(content);
            if (!fixed)
                return spec;
            return { ...spec, inputs: { ...spec.inputs, authoredHtml: fixed } };
        }
        catch {
            return spec;
        }
    }
    async analyzeArticleImageReference(input) {
        const asset = AppRepository_1.repository.getAssetById(input.assetId);
        if (!asset || asset.kind !== 'image')
            throw new Error('The selected AI reference image is unavailable.');
        if (input.productId && asset.productId && asset.productId !== input.productId) {
            throw new Error('The selected AI reference image belongs to another project.');
        }
        if (!input.agentId) {
            throw new Error('Analyzing a reference image requires a detected local vision-capable AI CLI.');
        }
        const reference = asset.localPath && fs_1.default.existsSync(asset.localPath) ? asset.localPath : asset.publicUrl;
        if (!reference)
            throw new Error('The selected AI reference image has no readable local file or public URL.');
        // Reverse-engineer the reference into something rebuildable. A mood-board answer ("dark,
        // modern, tech") is what made the old alternatives look nothing like the source — the design
        // pass needs the grid, the type ratios and the surface construction, in that order.
        const prompt = [
            'You are a senior art director reverse-engineering a graphic so another designer can rebuild its design language from your notes alone.',
            `Open and inspect this image before answering: ${JSON.stringify(reference)}`,
            'Report only what is visibly present — never what the filename or context implies.',
            'Be specific and measurable. Prefer numbers and ratios over adjectives: "headline ~13% of canvas height, weight 800, tracking tight" beats "big bold headline".',
            'layoutBlueprint: walk the canvas zone by zone in reading order. For each zone give its position (which margin/edge it aligns to), its rough size as a percentage of the canvas, its alignment, and what sits in it. State the outer margin as a percentage and whether the composition is left-aligned, centred or split.',
            'typeScale: for each text role (label/eyebrow, headline, support line, body, chips) give the size as a percentage of canvas height, the weight, the case, the tracking and the line-height. Note any single word or span that is coloured differently from the rest of its line.',
            'surfaceTreatment: how the background is built (base colour, gradient or glow and where its origin sits, any texture and its strength), plus border weights, corner radii, pill/chip shapes, shadows and dividers.',
            'palette: the actual colours sampled from the image as #RRGGBB, ordered background → ink → accent.',
            'avoidCopying: logos, brand marks, source text, photography and any composition detail that would make a new design look like a duplicate.',
            'If you cannot open the image, return {"error":"reason"}. Never invent an analysis without viewing it.',
            'Reply with STRICT JSON only — no prose or code fences.',
            'JSON shape: {"description":string,"subject":string,"composition":string,"layoutBlueprint":string,"typeScale":string,"surfaceTreatment":string,"palette":["#RRGGBB"],"visualStyle":string,"typography":string,"mood":string,"reusableCues":[string],"avoidCopying":[string]}.',
        ].join('\n');
        const { content, provider } = await AIService_1.aiService.complete(prompt, {
            conversationId: `article-image-reference:${input.assetId}`,
            agentId: input.agentId,
            cwd: null,
        });
        const parsed = extractJson(content);
        const raw = parsed && isRecord(parsed.analysis) ? parsed.analysis : parsed;
        if (!raw || str(raw.error)) {
            throw new Error(str(raw?.error) || 'The vision agent could not analyze the selected reference image.');
        }
        const subject = str(raw.subject);
        const composition = str(raw.composition);
        const layoutBlueprint = str(raw.layoutBlueprint ?? raw.layout);
        const typeScale = str(raw.typeScale ?? raw.typographyScale);
        const surfaceTreatment = str(raw.surfaceTreatment ?? raw.background);
        const visualStyle = str(raw.visualStyle ?? raw.style);
        const typography = str(raw.typography);
        const mood = str(raw.mood);
        const palette = stringList(raw.palette).slice(0, 8);
        const reusableCues = stringList(raw.reusableCues).slice(0, 8);
        const avoidCopying = stringList(raw.avoidCopying).slice(0, 8);
        const description = str(raw.description) ||
            [subject, composition, visualStyle, mood].filter(Boolean).join('. ');
        if (!description)
            throw new Error('The vision agent returned an empty reference-image analysis.');
        return {
            assetId: asset.id,
            description,
            subject,
            composition,
            palette,
            visualStyle,
            typography,
            mood,
            reusableCues,
            avoidCopying,
            provider,
            layoutBlueprint,
            typeScale,
            surfaceTreatment,
        };
    }
    // --- internals -----------------------------------------------------------
    static VISION_AGENT_ORDER = ['codex', 'gemini', 'claude', 'grok', 'qwen', 'opencode', 'amp', 'aider'];
    /**
     * Visually-distinct bundled design systems, interleaved so consecutive picks alternate
     * light/dark, hue and mood. When the user hasn't pinned a system, each "4×" variant is
     * rendered through a different one of these — the single biggest fix for "every variant
     * looks the same" (without it, all variants share one accent over the same dark gradient).
     */
    static DIVERSE_SYSTEM_ORDER = ['agentic', 'colorful', 'bento', 'brutalism', 'clean', 'claymorphism', 'artistic', 'bold'];
    /** Vivid fallback accents (rotated) when a system's own accent is unusable for its mode. */
    static DIVERSE_ACCENTS = ['#2563eb', '#7c3aed', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#ef4444', '#6750a4'];
    /** Pick a readable accent for a system: its own if usable for its light/dark mode, else a vivid fallback. */
    accentForSystem(systemId, fallbackIndex) {
        const tokens = (0, designSystems_1.getDesignTokens)(systemId);
        const lightSystem = hexLuminance(tokens.palette.bg) > 0.62;
        const candidates = [tokens.palette.accent, (0, designSystems_1.getDesignSystem)(systemId)?.accentColor].filter((color) => typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color));
        for (const color of candidates) {
            const lum = hexLuminance(color);
            // On light paper a near-white accent vanishes; on dark a near-black accent vanishes.
            if (lightSystem ? lum < 0.82 : lum > 0.16)
                return color;
        }
        return DesignService.DIVERSE_ACCENTS[fallbackIndex % DesignService.DIVERSE_ACCENTS.length];
    }
    /** Prefer a detected, vision-capable CLI agent so the reference image is actually understood. */
    async pickVisionAgentId(preferred) {
        const status = await AIService_1.aiService.getLocalStatus();
        if (preferred) {
            const match = status.agents.find((agent) => agent.id === preferred && agent.state === 'detected');
            if (match)
                return match.id;
            throw new Error(`Selected local CLI "${preferred}" is not detected.`);
        }
        const activeRoute = AiProviderService_1.aiProviderService.getActiveRoute();
        if (activeRoute.mode === 'local-cli' && activeRoute.localAgentId) {
            const active = status.agents.find((agent) => agent.id === activeRoute.localAgentId && agent.state === 'detected');
            if (active)
                return active.id;
            throw new Error(`Selected local CLI "${activeRoute.localAgentId}" is not detected.`);
        }
        for (const id of DesignService.VISION_AGENT_ORDER) {
            const agent = status.agents.find((entry) => entry.id === id && entry.state === 'detected');
            if (agent)
                return agent.id;
        }
        return status.selectedAgentId ?? null;
    }
    async writeCopy(spec, product, inputs) {
        if (!product)
            return inputs;
        const prompt = [
            'You are a senior brand designer writing copy for a marketing graphic.',
            `Format: ${spec.format}. Keep it punchy and visual — this is a poster, not a paragraph.`,
            `Product: ${product.name}`,
            `Tagline: ${product.tagline}`,
            `Target user: ${product.targetUser || 'indie founders'}`,
            `Pain solved: ${product.painSolved || ''}`,
            'Return ONLY JSON: {"headline": string (<=8 words), "subhead": string (<=14 words), "cta": string (<=4 words)}.',
        ].join('\n');
        try {
            const { content } = await AIService_1.aiService.complete(prompt, { conversationId: `design:${product.id}:${spec.format}` });
            const parsed = extractJson(content);
            if (parsed) {
                return {
                    ...inputs,
                    headline: str(parsed.headline) || inputs.headline || product.tagline || product.name,
                    subhead: str(parsed.subhead) || inputs.subhead,
                    cta: str(parsed.cta) || inputs.cta,
                };
            }
        }
        catch {
            // fall through to product-derived defaults
        }
        return {
            ...inputs,
            headline: inputs.headline || product.tagline || product.name,
            subhead: inputs.subhead || product.painSolved || product.shortDescription || '',
            cta: inputs.cta || 'Get started',
        };
    }
    async buildContext(spec) {
        const info = (0, templates_1.formatInfo)(spec.format);
        const product = spec.productId ? AppRepository_1.repository.getProduct(spec.productId) : null;
        const inputs = spec.inputs;
        const sourceImageAssetIds = uniqueStrings([
            ...stringList(inputs.sourceImageAssetIds),
            ...stringList(inputs.extra?.sourceImageAssetIds),
        ]).slice(0, 4);
        const sourceImageRefs = uniqueStrings(stringList(inputs.extra?.sourceImageRefs)).slice(0, 4);
        const preferSourceMedia = inputs.extra?.preferSourceMedia === true;
        // All render inputs are independent reads — load them concurrently.
        const [backgroundDataUri, logoDataUri, productShotDataUri, sourceAssetResults, sourceRefResults] = await Promise.all([
            (inputs.background === 'asset' || inputs.background === 'generated') && inputs.backgroundAssetId
                ? this.assetDataUri(inputs.backgroundAssetId)
                : Promise.resolve(null),
            inputs.logoAssetId
                ? this.assetDataUri(inputs.logoAssetId)
                : !preferSourceMedia && product?.logoUrl
                    ? this.refDataUri(product.logoUrl)
                    : Promise.resolve(null),
            inputs.productShotAssetId
                ? this.assetDataUri(inputs.productShotAssetId)
                : !preferSourceMedia && product?.screenshotUrls?.[0]
                    ? this.refDataUri(product.screenshotUrls[0])
                    : Promise.resolve(null),
            Promise.all(sourceImageAssetIds.map((assetId) => this.assetDataUri(assetId).catch(() => null))),
            Promise.all(sourceImageRefs.map((ref) => this.refDataUri(ref).catch(() => null))),
        ]);
        const sourceImageDataUris = uniqueStrings([...sourceAssetResults, ...sourceRefResults].filter((uri) => Boolean(uri))).slice(0, 4);
        return {
            width: info.width,
            height: info.height,
            headline: inputs.headline || product?.tagline || product?.name || 'Your headline here',
            subhead: inputs.subhead || '',
            cta: inputs.cta || '',
            eyebrow: inputs.eyebrow || '',
            accentColor: inputs.accentColor || '#6750a4',
            background: inputs.background,
            backgroundTreatment: inputs.backgroundTreatment || 'mesh',
            decoration: inputs.decoration ?? [],
            density: inputs.density || 'balanced',
            backgroundDataUri,
            logoDataUri,
            productShotDataUri,
            sourceImageDataUris,
            brandName: product?.name || '',
            tokens: (0, designSystems_1.getDesignTokens)(inputs.designSystemId ?? null),
            displayFamily: inputs.typePairing?.display ?? null,
            bodyFamily: inputs.typePairing?.body ?? null,
            authoredHtml: inputs.authoredHtml ?? null,
        };
    }
    /**
     * Short-lived data-URI cache for render inputs. A multi-variant run (and the live
     * preview while editing) re-renders with the same logo/background/product shot many
     * times; without this every render re-reads — or re-downloads — and re-base64-encodes
     * each of them. The short TTL bounds staleness if an asset's bytes change on disk.
     */
    dataUriCache = new Map();
    static DATA_URI_TTL_MS = 60_000;
    static DATA_URI_CACHE_MAX = 32;
    async cachedDataUri(key, load) {
        const now = Date.now();
        const hit = this.dataUriCache.get(key);
        if (hit && now - hit.at < DesignService.DATA_URI_TTL_MS)
            return hit.uri;
        const uri = await load();
        this.dataUriCache.delete(key);
        if (this.dataUriCache.size >= DesignService.DATA_URI_CACHE_MAX) {
            const oldest = this.dataUriCache.keys().next().value;
            if (oldest !== undefined)
                this.dataUriCache.delete(oldest);
        }
        this.dataUriCache.set(key, { at: now, uri });
        return uri;
    }
    assetDataUri(assetId) {
        return this.cachedDataUri(`asset:${assetId}`, async () => {
            const bytes = await AssetService_1.assetService.readBytes(assetId);
            if (bytes)
                return `data:${bytes.mimeType};base64,${bytes.data.toString('base64')}`;
            const asset = AppRepository_1.repository.getAssetById(assetId);
            return asset?.publicUrl ? this.refDataUri(asset.publicUrl) : null;
        });
    }
    refDataUri(ref) {
        if (!ref)
            return Promise.resolve(null);
        if (ref.startsWith('data:'))
            return Promise.resolve(ref);
        return this.cachedDataUri(`ref:${ref}`, async () => {
            try {
                if (/^https?:/i.test(ref)) {
                    const response = await axios_1.default.get(ref, { responseType: 'arraybuffer', timeout: 20000 });
                    const mime = response.headers['content-type'] ?? 'image/png';
                    return `data:${mime};base64,${Buffer.from(response.data).toString('base64')}`;
                }
                let filePath = ref;
                if (filePath.startsWith('file://'))
                    filePath = (0, url_1.fileURLToPath)(filePath);
                else if (filePath.startsWith('mt-local-file://'))
                    filePath = (0, url_1.fileURLToPath)(filePath.replace(/^mt-local-file:/i, 'file:'));
                if (!fs_1.default.existsSync(filePath))
                    return null;
                const data = await fs_1.default.promises.readFile(filePath);
                const mime = IMAGE_MIME_BY_EXT[path_1.default.extname(filePath).toLowerCase()] ?? 'image/png';
                return `data:${mime};base64,${data.toString('base64')}`;
            }
            catch {
                return null;
            }
        });
    }
    async persistRenderedDesign(spec, png, options) {
        const info = (0, templates_1.formatInfo)(spec.format);
        const title = spec.title?.trim() || this.defaultTitle(spec);
        const suffix = options.fileNameSuffix ? `-${options.fileNameSuffix}` : '';
        const asset = await AssetService_1.assetService.importBytes(png, {
            originalName: `${slug(title)}-${spec.format}${suffix}.png`,
            mimeType: 'image/png',
            productId: spec.productId ?? null,
            title,
            tags: options.tags ?? ['design'],
            metadata: {
                source: options.source,
                templateId: spec.templateId,
                format: spec.format,
                ...sourceCampaignMetadata(spec),
                ...(options.metadata ?? {}),
            },
        });
        const doc = AppRepository_1.repository.upsertDesignDocument({
            id: spec.docId ?? null,
            productId: spec.productId ?? null,
            title,
            format: spec.format,
            templateId: spec.templateId,
            width: info.width,
            height: info.height,
            inputs: spec.inputs,
            previewAssetId: asset.id,
        });
        return { doc, asset, spec: { ...spec, docId: doc.id, title: doc.title } };
    }
    defaultTitle(spec) {
        const head = spec.inputs.headline?.trim();
        if (head)
            return head.slice(0, 60);
        const product = spec.productId ? AppRepository_1.repository.getProduct(spec.productId) : null;
        return `${product?.name ?? 'Untitled'} design`;
    }
}
exports.DesignService = DesignService;
function str(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function sourceCampaignMetadata(spec) {
    const runId = str(spec.inputs.extra?.sourceCampaignRunId);
    const name = str(spec.inputs.extra?.sourceCampaignName);
    const storyboardId = str(spec.inputs.extra?.videoStoryboardId);
    const sceneId = str(spec.inputs.extra?.videoSceneId);
    const sceneRole = str(spec.inputs.extra?.videoSceneRole);
    return {
        ...(runId ? { sourceCampaignRunId: runId } : {}),
        ...(name ? { sourceCampaignName: name } : {}),
        ...(storyboardId ? { videoStoryboardId: storyboardId } : {}),
        ...(sceneId ? { videoSceneId: sceneId } : {}),
        ...(sceneRole ? { videoSceneRole: sceneRole } : {}),
    };
}
function listText(values, limit) {
    return values.map((value) => value.trim()).filter(Boolean).slice(0, limit).join(', ');
}
function dialLabel(value, left, middle, right) {
    if (value <= 35)
        return left;
    if (value >= 65)
        return right;
    return middle;
}
function productBrandBrief(product) {
    const voice = product.brandVoice;
    const voiceLines = [
        `Tone: ${dialLabel(voice.casualFormal, 'casual', 'balanced casual/formal', 'formal')}`,
        `Energy: ${dialLabel(voice.understatedHype, 'understated', 'measured', 'high-energy')}`,
        `Language: ${dialLabel(voice.plainTechnical, 'plain', 'clear with some technical detail', 'technical')}`,
        `Length: ${dialLabel(voice.terseExpansive, 'terse', 'moderately concise', 'expansive')}`,
        voice.attributes.length ? `Voice attributes: ${listText(voice.attributes, 8)}` : '',
        voice.notes.trim() ? `Voice notes: ${voice.notes.trim().slice(0, 800)}` : '',
        voice.samplePosts.length
            ? `Sample phrasing to emulate:\n${voice.samplePosts
                .slice(0, 2)
                .map((sample) => `- ${sample.trim().slice(0, 500)}`)
                .join('\n')}`
            : '',
    ].filter(Boolean);
    return [
        'Project/company profile for factual grounding, audience, differentiation, palette/tone cues, and brand voice:',
        `Product: ${product.name}`,
        product.url ? `Website: ${product.url}` : '',
        product.tagline ? `Tagline: ${product.tagline}` : '',
        product.shortDescription ? `Short description: ${product.shortDescription}` : '',
        product.longDescription ? `Long description: ${product.longDescription.slice(0, 1600)}` : '',
        product.targetUser ? `Target users: ${product.targetUser}` : '',
        product.painSolved ? `Pain solved: ${product.painSolved}` : '',
        product.categories.length ? `Categories: ${listText(product.categories, 4)}` : '',
        product.tags.length ? `Tags: ${listText(product.tags, 10)}` : '',
        product.platforms.length ? `Platforms: ${listText(product.platforms, 6)}` : '',
        product.pricingModel ? `Pricing: ${product.pricingModel}` : '',
        product.competitors.length ? `Competitors to differentiate from: ${listText(product.competitors, 6)}` : '',
        product.changelogSummary ? `Recent changelog summary: ${product.changelogSummary.slice(0, 1000)}` : '',
        voiceLines.length ? `Brand voice:\n${voiceLines.join('\n')}` : '',
        'Use this profile when it matches the brief. If the brief explicitly names a different source/company, do not override that subject; only borrow tone and visual direction.',
    ]
        .filter(Boolean)
        .join('\n');
}
/**
 * Last-ditch recovery when a design reply carries authored fragments but is not valid JSON
 * (an unescaped newline inside a long `html` string is the usual culprit). Fenced HTML blocks
 * are enough to render from — the copy fields fall back to the article title downstream.
 */
function salvageHtmlBriefs(content) {
    const fenced = [...content.matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)].map((match) => match[1]);
    const blocks = fenced.length ? fenced : content.includes('<div') ? [content] : [];
    return blocks
        .map((html) => (0, templates_1.sanitizeAuthoredHtml)(html))
        .filter((html) => Boolean(html))
        .map((html) => ({ html }));
}
function stringList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter(Boolean);
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        if (seen.has(value))
            continue;
        seen.add(value);
        out.push(value);
    }
    return out;
}
function getDisplayFontId(value) {
    return fonts_1.DISPLAY_FONT_IDS.includes(value) ? value : null;
}
function getBodyFontId(value) {
    return fonts_1.BODY_FONT_IDS.includes(value) ? value : null;
}
function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'design';
}
/** Relative luminance (0–1) of a #rrggbb color, for readability/light-vs-dark checks. */
function hexLuminance(hex) {
    const value = hex.replace('#', '');
    if (value.length !== 6)
        return 0.5;
    const int = parseInt(value, 16);
    if (Number.isNaN(int))
        return 0.5;
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
/** Tiny stable hash so the same brief seeds the same (but brief-specific) variant rotation. */
function simpleSeed(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i += 1)
        hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    return hash;
}
function extractJson(raw) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fenced ? fenced[1] : raw;
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start)
        return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    }
    catch {
        return null;
    }
}
exports.designService = new DesignService();
//# sourceMappingURL=DesignService.js.map