"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaGenerationCatalog = mediaGenerationCatalog;
const OPENAI_VIDEO_RETIREMENT = Date.parse('2026-09-24T00:00:00Z');
const BASE_MODELS = [
    {
        id: 'gpt-image-2',
        label: 'GPT Image 2',
        kind: 'image',
        adapterIds: ['openai', 'openai-compatible'],
        operations: ['text-to-image', 'image-to-image'],
        lifecycle: 'active',
        sizes: ['1024x1024', '1536x1024', '1024x1536'],
        qualities: ['low', 'medium', 'high'],
        durationsSeconds: [],
        maxOutputs: 4,
        supportsReference: true,
        warning: null,
        retirementAt: null,
    },
    {
        id: 'sora-2',
        label: 'Sora 2 (experimental)',
        kind: 'video',
        adapterIds: ['openai'],
        operations: ['text-to-video', 'image-to-video'],
        lifecycle: 'retiring',
        sizes: ['1280x720', '720x1280'],
        qualities: [],
        durationsSeconds: [4, 8, 12],
        maxOutputs: 1,
        supportsReference: true,
        warning: 'Experimental provider path. OpenAI has announced retirement of the current Videos API on September 24, 2026.',
        retirementAt: OPENAI_VIDEO_RETIREMENT,
    },
    {
        id: 'sora-2-pro',
        label: 'Sora 2 Pro (experimental)',
        kind: 'video',
        adapterIds: ['openai'],
        operations: ['text-to-video', 'image-to-video'],
        lifecycle: 'retiring',
        sizes: ['1280x720', '720x1280', '1920x1080', '1080x1920'],
        qualities: [],
        durationsSeconds: [4, 8, 12],
        maxOutputs: 1,
        supportsReference: true,
        warning: 'Experimental provider path. OpenAI has announced retirement of the current Videos API on September 24, 2026.',
        retirementAt: OPENAI_VIDEO_RETIREMENT,
    },
];
function customModel(id, kind, adapterId) {
    return {
        id,
        label: id,
        kind,
        adapterIds: [adapterId],
        operations: kind === 'image' ? ['text-to-image', 'image-to-image'] : ['text-to-video', 'image-to-video'],
        lifecycle: adapterId === 'openai-compatible' ? 'experimental' : 'active',
        sizes: kind === 'image' ? ['1024x1024', '1536x1024', '1024x1536'] : ['1280x720', '720x1280'],
        qualities: kind === 'image' ? ['low', 'medium', 'high'] : [],
        durationsSeconds: kind === 'video' ? [4, 8, 12] : [],
        maxOutputs: kind === 'image' ? 4 : 1,
        supportsReference: true,
        warning: adapterId === 'openai-compatible' ? 'Compatibility depends on the selected gateway and model.' : null,
        retirementAt: null,
    };
}
function mediaGenerationCatalog(profiles = []) {
    const now = Date.now();
    const models = BASE_MODELS.map((model) => model.retirementAt && now >= model.retirementAt ? { ...model, lifecycle: 'retired' } : { ...model });
    const seen = new Set(models.map((model) => `${model.kind}:${model.id}`));
    for (const profile of profiles) {
        const candidates = [
            ['image', profile.defaultImageModel],
            ['video', profile.defaultVideoModel],
        ];
        for (const [kind, id] of candidates) {
            const normalized = id?.trim();
            if (!normalized || seen.has(`${kind}:${normalized}`))
                continue;
            models.push(customModel(normalized, kind, profile.adapterId));
            seen.add(`${kind}:${normalized}`);
        }
    }
    return { models, generatedAt: now };
}
//# sourceMappingURL=catalog.js.map