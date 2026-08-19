"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateVideoTimeline = calculateVideoTimeline;
exports.normalizeVideoStoryboard = normalizeVideoStoryboard;
exports.preserveFreshSceneAssets = preserveFreshSceneAssets;
exports.applyStoryboardCommand = applyStoryboardCommand;
const id_1 = require("../../utils/id");
const FORMATS = ['feature_image', 'og_card', 'social_square', 'story', 'banner'];
const ROLES = ['hook', 'problem', 'message', 'feature', 'proof', 'cta'];
const TRANSITIONS = ['cut', 'fade', 'slide'];
const FPS = 30;
const MIN_SCENE_FRAMES = FPS;
const MAX_TOTAL_FRAMES = 20 * FPS;
const MAX_SCENES = 6;
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function text(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}
function finite(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function frameMs(frames, fps) {
    return Math.round((frames / fps) * 1000);
}
function cleanSceneId(value, role, index) {
    const candidate = text(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
    return candidate || `${role}-${index + 1}-${(0, id_1.createId)().slice(0, 8)}`;
}
function normalizeInputs(value, fallback) {
    const input = record(value);
    const background = text(input.background);
    const normalized = {
        ...fallback,
        ...input,
        headline: text(input.headline, fallback.headline).slice(0, 120),
        subhead: text(input.subhead, fallback.subhead).slice(0, 240),
        cta: text(input.cta, fallback.cta).slice(0, 80),
        accentColor: /^#[0-9a-f]{6}$/i.test(text(input.accentColor)) ? text(input.accentColor) : fallback.accentColor,
        background: ['gradient', 'solid', 'asset', 'generated'].includes(background)
            ? background
            : fallback.background,
    };
    return normalized;
}
function fallbackSpec(role, format, productId, templateId) {
    const labels = {
        hook: { eyebrow: 'NEW', headline: 'A sharper way to market', subhead: 'Turn the brief into a clear customer outcome.', cta: '' },
        problem: { eyebrow: 'THE PROBLEM', headline: 'Marketing work fragments fast', subhead: 'Context, assets, and distribution drift apart.', cta: '' },
        message: { eyebrow: 'THE MESSAGE', headline: 'One focused marketing engine', subhead: 'Keep the work grounded, local, and ready to ship.', cta: '' },
        feature: { eyebrow: 'FEATURE', headline: 'Show the outcome first', subhead: 'Explain one capability in plain language.', cta: '' },
        proof: { eyebrow: 'WHY IT MATTERS', headline: 'Less handoff. More control.', subhead: 'Use one concrete, supported proof point.', cta: '' },
        cta: { eyebrow: 'NEXT STEP', headline: 'Put it to work', subhead: 'Move from brief to published campaign.', cta: 'Try it now' },
    };
    const copy = labels[role];
    return {
        productId,
        title: copy.headline,
        templateId,
        format,
        inputs: {
            headline: copy.headline,
            subhead: copy.subhead,
            cta: copy.cta,
            eyebrow: copy.eyebrow,
            accentColor: '#2563eb',
            background: 'gradient',
            backgroundTreatment: 'mesh',
            decoration: role === 'cta' ? ['ring'] : ['glow'],
            density: 'airy',
        },
    };
}
function normalizeSpec(value, role, format, productId, defaultTemplateId) {
    const source = record(value);
    const fallback = fallbackSpec(role, format, productId, defaultTemplateId);
    const templateId = text(source.templateId, fallback.templateId);
    return {
        productId,
        title: text(source.title, fallback.title).slice(0, 160),
        templateId,
        format,
        inputs: normalizeInputs(source.inputs, fallback.inputs),
    };
}
function normalizeCaption(value, durationMs) {
    const source = record(value);
    const captionText = text(source.text).slice(0, 180);
    if (!captionText)
        return null;
    const startMs = clamp(Math.round(finite(source.startMs, 0)), 0, Math.max(0, durationMs - 100));
    const endMs = clamp(Math.round(finite(source.endMs, durationMs)), startMs + 100, durationMs);
    return { text: captionText, startMs, endMs };
}
function distributeFrames(weights, target) {
    if (!weights.length)
        return [];
    const safeTarget = Math.max(weights.length * MIN_SCENE_FRAMES, target);
    const totalWeight = weights.reduce((sum, weight) => sum + Math.max(1, weight), 0);
    const frames = weights.map((weight) => Math.max(MIN_SCENE_FRAMES, Math.round((Math.max(1, weight) / totalWeight) * safeTarget)));
    let delta = safeTarget - frames.reduce((sum, value) => sum + value, 0);
    let cursor = frames.length - 1;
    while (delta !== 0) {
        const direction = delta > 0 ? 1 : -1;
        if (direction > 0 || frames[cursor] > MIN_SCENE_FRAMES) {
            frames[cursor] += direction;
            delta -= direction;
        }
        cursor = cursor === 0 ? frames.length - 1 : cursor - 1;
    }
    return frames;
}
function calculateVideoTimeline(storyboard) {
    const fps = clamp(Math.round(storyboard.fps || FPS), 12, 60);
    // Compose runs xfade across EVERY boundary once any non-cut transition exists, and a "cut"
    // in that graph still consumes one overlap frame. Reflect that here so the caption/duration
    // timeline the review and burn-in use matches the actual render (otherwise every cut drifts
    // by a frame). When there are no transitions at all, compose concatenates with zero overlap.
    const hasTransitions = storyboard.scenes.slice(1).some((scene) => scene.transitionIn && scene.transitionIn.type !== 'cut');
    let cursor = 0;
    let prevDurationFrames = 0;
    const scenes = storyboard.scenes.map((scene, index) => {
        const durationFrames = Math.max(1, Math.round((scene.durationMs / 1000) * fps));
        // An overlap can exceed neither the current nor the previous clip.
        const maxOverlap = Math.max(0, Math.min(durationFrames - 1, prevDurationFrames - 1));
        let overlapFrames;
        if (index === 0)
            overlapFrames = 0;
        else if (scene.transitionIn?.type === 'cut')
            overlapFrames = hasTransitions ? Math.min(1, maxOverlap) : 0;
        else
            overlapFrames = clamp(Math.round(((scene.transitionIn?.durationMs ?? 0) / 1000) * fps), Math.min(1, maxOverlap), maxOverlap);
        const startFrame = Math.max(0, cursor - overlapFrames);
        const endFrame = startFrame + durationFrames;
        cursor = endFrame;
        prevDurationFrames = durationFrames;
        return { sceneId: scene.id, startFrame, endFrame, durationFrames, overlapFrames };
    });
    return { fps, totalFrames: cursor, totalDurationMs: frameMs(cursor, fps), scenes };
}
function normalizeVideoStoryboard(value, options) {
    const source = record(value);
    const formatCandidate = text(source.format, options.format ?? options.pipeline.defaultFormat);
    const format = FORMATS.includes(formatCandidate)
        ? formatCandidate
        : options.pipeline.defaultFormat;
    const fps = FPS;
    const rawScenes = Array.isArray(source.scenes) && source.scenes.length
        ? source.scenes.slice(0, MAX_SCENES)
        : options.pipeline.sceneBlueprint.map((role) => ({ role }));
    const seenIds = new Set();
    const sceneDrafts = rawScenes.map((value, index) => {
        const scene = record(value);
        const roleCandidate = text(scene.role, options.pipeline.sceneBlueprint[index] ?? 'message');
        const role = ROLES.includes(roleCandidate) ? roleCandidate : 'message';
        let id = cleanSceneId(scene.id, role, index);
        while (seenIds.has(id))
            id = `${id}-${index + 1}`;
        seenIds.add(id);
        const transitionSource = record(scene.transitionIn);
        const typeCandidate = text(transitionSource.type, index === 0 ? 'cut' : 'fade');
        const type = TRANSITIONS.includes(typeCandidate) ? typeCandidate : 'cut';
        const transitionFrames = index === 0 || type === 'cut'
            ? 0
            : clamp(Math.round((finite(transitionSource.durationMs, 250) / 1000) * fps), 1, Math.round(fps / 2));
        return {
            source: scene,
            id,
            role,
            transition: { type, frames: transitionFrames },
            weight: Math.max(MIN_SCENE_FRAMES, Math.round((finite(scene.durationMs, 3000) / 1000) * fps)),
        };
    });
    const overlapFrames = sceneDrafts.reduce((sum, scene) => sum + scene.transition.frames, 0);
    const authoredFinalFrames = sceneDrafts.reduce((sum, scene) => sum + scene.weight, 0) - overlapFrames;
    const minimumFinalFrames = sceneDrafts.length * MIN_SCENE_FRAMES - overlapFrames;
    const targetFrames = options.forceTargetDuration
        ? clamp(Math.round((finite(source.totalDurationMs, options.durationMs ?? options.pipeline.defaultDurationMs) / 1000) * fps), minimumFinalFrames, MAX_TOTAL_FRAMES)
        : clamp(authoredFinalFrames, minimumFinalFrames, MAX_TOTAL_FRAMES);
    const durations = distributeFrames(sceneDrafts.map((scene) => scene.weight), targetFrames + overlapFrames);
    const productId = options.productId ?? null;
    const scenes = sceneDrafts.map((draft, index) => {
        const durationMs = frameMs(durations[index], fps);
        const captions = Array.isArray(draft.source.captions)
            ? draft.source.captions.map((caption) => normalizeCaption(caption, durationMs)).filter((caption) => Boolean(caption))
            : [];
        return {
            id: draft.id,
            role: draft.role,
            durationMs,
            spec: normalizeSpec(draft.source.spec, draft.role, format, productId, options.defaultTemplateId),
            narration: text(draft.source.narration).slice(0, 500) || undefined,
            captions,
            transitionIn: {
                type: draft.transition.type,
                durationMs: frameMs(draft.transition.frames, fps),
            },
            previewAssetId: text(draft.source.previewAssetId) || null,
            renderedClipAssetId: text(draft.source.renderedClipAssetId) || null,
        };
    });
    const timeline = calculateVideoTimeline({ fps, scenes });
    return { version: 1, pipelineId: options.pipeline.id, format, fps, totalDurationMs: timeline.totalDurationMs, scenes };
}
function sceneFingerprint(scene) {
    const { previewAssetId: _preview, renderedClipAssetId: _clip, ...source } = scene;
    return JSON.stringify(source);
}
function preserveFreshSceneAssets(previous, next) {
    const previousById = new Map(previous.scenes.map((scene) => [scene.id, scene]));
    return {
        ...next,
        scenes: next.scenes.map((scene) => {
            const oldScene = previousById.get(scene.id);
            if (!oldScene || sceneFingerprint(oldScene) !== sceneFingerprint(scene)) {
                return { ...scene, previewAssetId: null, renderedClipAssetId: null };
            }
            return { ...scene, previewAssetId: oldScene.previewAssetId ?? null, renderedClipAssetId: oldScene.renderedClipAssetId ?? null };
        }),
    };
}
function applyStoryboardCommand(storyboard, input) {
    const scenes = storyboard.scenes.map((scene) => ({ ...scene, spec: { ...scene.spec, inputs: { ...scene.spec.inputs } } }));
    if (input.kind === 'add-scene') {
        const role = input.scene?.role ?? 'message';
        const base = scenes[Math.max(0, scenes.length - 1)];
        const scene = {
            ...(base ?? {}),
            ...input.scene,
            id: input.scene?.id ?? `${role}-${(0, id_1.createId)().slice(0, 8)}`,
            role,
            durationMs: input.scene?.durationMs ?? 3000,
            spec: input.scene?.spec ?? base?.spec ?? { format: storyboard.format },
            previewAssetId: null,
            renderedClipAssetId: null,
        };
        const index = input.afterSceneId ? scenes.findIndex((candidate) => candidate.id === input.afterSceneId) + 1 : scenes.length;
        scenes.splice(Math.max(0, index), 0, scene);
    }
    else if (input.kind === 'edit-scene') {
        const index = scenes.findIndex((scene) => scene.id === input.sceneId);
        if (index < 0)
            throw new Error('Scene not found.');
        const rawPatch = input.patch;
        const copyPatch = ['headline', 'subhead', 'cta'].reduce((out, key) => {
            if (typeof rawPatch[key] === 'string')
                out[key] = rawPatch[key];
            return out;
        }, {});
        scenes[index] = {
            ...scenes[index],
            ...input.patch,
            id: scenes[index].id,
            spec: Object.keys(copyPatch).length
                ? {
                    ...scenes[index].spec,
                    inputs: { ...scenes[index].spec.inputs, ...copyPatch },
                }
                : input.patch.spec ?? scenes[index].spec,
        };
    }
    else if (input.kind === 'remove-scene') {
        if (scenes.length <= 1)
            throw new Error('A storyboard must keep at least one scene.');
        const index = scenes.findIndex((scene) => scene.id === input.sceneId);
        if (index < 0)
            throw new Error('Scene not found.');
        scenes.splice(index, 1);
    }
    else if (input.kind === 'reorder-scenes') {
        const byId = new Map(scenes.map((scene) => [scene.id, scene]));
        if (input.sceneIds.length !== scenes.length || input.sceneIds.some((id) => !byId.has(id))) {
            throw new Error('Reorder must contain every scene id exactly once.');
        }
        scenes.splice(0, scenes.length, ...input.sceneIds.map((id) => byId.get(id)));
    }
    else {
        const sceneId = input.sceneId;
        const index = scenes.findIndex((scene) => scene.id === sceneId);
        if (index < 0)
            throw new Error('Scene not found.');
        if (input.kind === 'set-duration')
            scenes[index].durationMs = input.durationMs;
        if (input.kind === 'set-captions')
            scenes[index].captions = input.captions;
        if (input.kind === 'set-narration')
            scenes[index].narration = input.narration;
        if (input.kind === 'set-transition')
            scenes[index].transitionIn = input.transition;
    }
    return { ...storyboard, scenes };
}
//# sourceMappingURL=storyboard.js.map