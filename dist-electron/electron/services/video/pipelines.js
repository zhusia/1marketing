"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listVideoPipelines = listVideoPipelines;
exports.getVideoPipeline = getVideoPipeline;
const PIPELINES = [
    {
        id: 'launch',
        label: 'Launch',
        description: 'Introduce the product, land one clear benefit, and close with a direct action.',
        sceneBlueprint: ['hook', 'message', 'cta'],
        defaultDurationMs: 12000,
        defaultFormat: 'story',
        wantsAudio: false,
        wantsCaptions: false,
        gates: ['script', 'scene-plan', 'assets', 'publish'],
        authorGuidance: 'Open with a sharp product launch hook, establish the positioning, and end with a confident CTA.',
    },
    {
        id: 'feature',
        label: 'Feature',
        description: 'Lead with the customer outcome, introduce the feature, prove it, then ask for action.',
        sceneBlueprint: ['hook', 'feature', 'proof', 'cta'],
        defaultDurationMs: 12000,
        defaultFormat: 'story',
        wantsAudio: false,
        wantsCaptions: false,
        gates: ['script', 'scene-plan', 'assets', 'publish'],
        authorGuidance: 'Show the benefit first, name the feature second, add one concrete proof point, then a concise CTA.',
    },
    {
        id: 'changelog',
        label: 'Changelog',
        description: 'Turn a release note into a factual, customer-facing product update.',
        sceneBlueprint: ['hook', 'message', 'cta'],
        defaultDurationMs: 12000,
        defaultFormat: 'story',
        wantsAudio: false,
        wantsCaptions: false,
        gates: ['script', 'scene-plan', 'assets', 'publish'],
        authorGuidance: 'State what changed, explain the user-facing benefit without inventing claims, and close with where to try it.',
    },
    {
        id: 'teaser',
        label: 'Teaser',
        description: 'A compact social cut with minimal copy and deliberate curiosity.',
        sceneBlueprint: ['hook', 'message', 'cta'],
        defaultDurationMs: 8000,
        defaultFormat: 'story',
        wantsAudio: false,
        wantsCaptions: false,
        gates: ['script', 'publish'],
        authorGuidance: 'Use very little copy, create curiosity immediately, reveal one useful detail, and finish with a short CTA.',
    },
];
function listVideoPipelines() {
    return PIPELINES.map((pipeline) => ({ ...pipeline, sceneBlueprint: [...pipeline.sceneBlueprint], gates: [...pipeline.gates] }));
}
function getVideoPipeline(id) {
    const pipeline = PIPELINES.find((candidate) => candidate.id === id);
    if (!pipeline)
        throw new Error(`Unknown video pipeline: ${id}`);
    return { ...pipeline, sceneBlueprint: [...pipeline.sceneBlueprint], gates: [...pipeline.gates] };
}
//# sourceMappingURL=pipelines.js.map