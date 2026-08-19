"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mediaGenerationService = exports.MediaGenerationService = void 0;
const axios_1 = __importDefault(require("axios"));
const electron_1 = require("electron");
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const channels_1 = require("../../ipc/channels");
const AppRepository_1 = require("../AppRepository");
const AssetService_1 = require("../AssetService");
const AiProviderService_1 = require("../AiProviderService");
const BackgroundTaskService_1 = require("../BackgroundTaskService");
const ConnectorService_1 = require("../ConnectorService");
const CredentialVault_1 = require("../CredentialVault");
const AiLogService_1 = require("../AiLogService");
const agent_bridge_1 = require("../../agent-bridge");
const catalog_1 = require("./catalog");
const DEFAULTS_SETTING_KEY = 'media.generation.defaults.v1';
const NINEROUTER_PROFILE_ID = 'legacy-ninerouter-env';
const OPENAI_CONNECTOR_PROFILE_ID = 'legacy-openai-connector';
const POLL_INTERVAL_MS = 10_000;
const MAX_VIDEO_POLLS = 360;
const LOCAL_IMAGE_SIZES = ['1024x1024', '1536x1024', '1024x1536'];
const LOCAL_VIDEO_SIZES = ['1280x720', '720x1280', '1920x1080', '1080x1920'];
const LOCAL_VIDEO_DURATIONS = [4, 8, 12];
const LOCAL_IMAGE_QUALITIES = ['low', 'medium', 'high'];
function mediaSecretAccount(profileId) {
    return `media_provider:${profileId}`;
}
function normalizedDefaults(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const stringOrNull = (key) => typeof record[key] === 'string' && record[key] ? String(record[key]) : null;
    return {
        imageProfileId: stringOrNull('imageProfileId'),
        imageModelId: stringOrNull('imageModelId'),
        videoProfileId: stringOrNull('videoProfileId'),
        videoModelId: stringOrNull('videoModelId'),
    };
}
function joinUrl(baseUrl, suffix) {
    return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}
function isFinal(job) {
    return ['completed', 'failed', 'submission-unknown', 'canceled'].includes(job.status);
}
function extensionForMime(mimeType, kind) {
    if (mimeType.includes('webp'))
        return 'webp';
    if (mimeType.includes('jpeg'))
        return 'jpg';
    if (mimeType.includes('quicktime'))
        return 'mov';
    if (mimeType.includes('webm'))
        return 'webm';
    return kind === 'video' ? 'mp4' : 'png';
}
function validateGeneratedFile(data, kind) {
    const maxBytes = kind === 'image' ? 100 * 1024 * 1024 : 1024 * 1024 * 1024;
    if (!data.length)
        throw new Error(`The provider returned an empty ${kind} file.`);
    if (data.length > maxBytes)
        throw new Error(`The provider returned a ${kind} file larger than the local safety limit.`);
    if (kind === 'image') {
        const png = data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        const jpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
        const webp = data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
        if (png)
            return 'image/png';
        if (jpeg)
            return 'image/jpeg';
        if (webp)
            return 'image/webp';
        throw new Error('The provider response was not a supported PNG, JPEG, or WebP image.');
    }
    const mp4 = data.length >= 12 && data.toString('ascii', 4, 8) === 'ftyp';
    const webm = data.length >= 4 && data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3;
    if (mp4)
        return 'video/mp4';
    if (webm)
        return 'video/webm';
    throw new Error('The provider response was not a supported MP4 or WebM video.');
}
function validateReferenceImage(data) {
    if (data.length > 50 * 1024 * 1024)
        throw new Error('Reference images must be 50 MB or smaller.');
    validateGeneratedFile(data, 'image');
}
function responseSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const record = value;
    const summary = {};
    for (const key of ['id', 'object', 'model', 'status', 'progress', 'created_at', 'completed_at', 'expires_at', 'size', 'seconds']) {
        const item = record[key];
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
            summary[key] = item;
        }
    }
    return summary;
}
function sanitizeProviderHeaders(headers) {
    const blocked = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key']);
    return Object.fromEntries(Object.entries(headers ?? {}).filter(([key, value]) => !blocked.has(key.trim().toLowerCase()) && value.trim()));
}
function apiErrorMessage(error) {
    if (axios_1.default.isAxiosError(error)) {
        const body = error.response?.data;
        const raw = typeof body?.error?.message === 'string'
            ? body.error.message
            : typeof body?.message === 'string'
                ? body.message
                : error.message;
        return `${error.response?.status ? `HTTP ${error.response.status}: ` : ''}${raw}`
            .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-...');
    }
    return error instanceof Error ? error.message : String(error);
}
function abortError() {
    return new Error('Generation canceled.');
}
async function waitForPoll(signal) {
    if (signal.aborted)
        throw abortError();
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', abort);
            resolve();
        }, POLL_INTERVAL_MS);
        const abort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        signal.addEventListener('abort', abort, { once: true });
        timer.unref?.();
    });
}
class MediaGenerationService {
    taskByJobId = new Map();
    async listProfiles() {
        const stored = await Promise.all(AppRepository_1.repository.listMediaProviderProfiles().map((profile) => this.withSecretStatus(profile)));
        const virtual = await this.virtualProfiles();
        return [...stored, ...virtual];
    }
    async saveProfile(input) {
        if (input.id === NINEROUTER_PROFILE_ID || input.id === OPENAI_CONNECTOR_PROFILE_ID) {
            throw new Error('Legacy media profiles are read-only.');
        }
        const profile = AppRepository_1.repository.upsertMediaProviderProfile({ ...input, headers: sanitizeProviderHeaders(input.headers) });
        return this.withSecretStatus(profile);
    }
    async deleteProfile(id) {
        if (id === NINEROUTER_PROFILE_ID || id === OPENAI_CONNECTOR_PROFILE_ID) {
            throw new Error('Legacy media profiles are read-only.');
        }
        const deleted = AppRepository_1.repository.deleteMediaProviderProfile(id);
        await CredentialVault_1.credentialVault.removeSecret(mediaSecretAccount(id));
        const defaults = this.getDefaults();
        if (defaults.imageProfileId === id || defaults.videoProfileId === id) {
            this.setDefaults({
                ...defaults,
                imageProfileId: defaults.imageProfileId === id ? null : defaults.imageProfileId,
                videoProfileId: defaults.videoProfileId === id ? null : defaults.videoProfileId,
            });
        }
        return { deleted };
    }
    async saveSecret(input) {
        const profile = AppRepository_1.repository.getMediaProviderProfile(input.profileId);
        if (!profile)
            throw new Error('Media provider profile not found.');
        const apiKey = input.apiKey.trim();
        if (!apiKey)
            throw new Error('API key is required.');
        await CredentialVault_1.credentialVault.setSecret(mediaSecretAccount(profile.id), { apiKey });
        AppRepository_1.repository.updateMediaProviderProfileStatus(profile.id, { lastError: null });
        return this.withSecretStatus(AppRepository_1.repository.getMediaProviderProfile(profile.id));
    }
    async removeSecret(profileId) {
        const profile = AppRepository_1.repository.getMediaProviderProfile(profileId);
        if (!profile)
            throw new Error('Media provider profile not found.');
        await CredentialVault_1.credentialVault.removeSecret(mediaSecretAccount(profileId));
        AppRepository_1.repository.updateMediaProviderProfileStatus(profileId, { lastTestedAt: null, lastError: null, enabled: false });
        return this.withSecretStatus(AppRepository_1.repository.getMediaProviderProfile(profileId));
    }
    async testProfile(profileId) {
        const profile = await this.getProfile(profileId);
        if (!profile)
            throw new Error('Media provider profile not found.');
        try {
            const credentials = await this.credentials(profile);
            await axios_1.default.get(joinUrl(profile.baseUrl, 'models'), {
                headers: this.requestHeaders(credentials),
                timeout: 30_000,
            });
            const updated = profile.virtual
                ? profile
                : await this.updateProfileStatus(profile.id, null, true);
            return { ok: true, status: 'connected', message: `Connected to ${profile.label}.`, profile: updated };
        }
        catch (error) {
            const message = apiErrorMessage(error);
            const updated = profile.virtual
                ? { ...profile, status: 'error', lastError: message, lastTestedAt: Date.now() }
                : await this.updateProfileStatus(profile.id, message, false);
            return { ok: false, status: 'error', message, profile: updated };
        }
    }
    async catalog() {
        return (0, catalog_1.mediaGenerationCatalog)(await this.listProfiles());
    }
    getDefaults() {
        return normalizedDefaults(AppRepository_1.repository.getSetting(DEFAULTS_SETTING_KEY)?.value);
    }
    setDefaults(input) {
        const normalized = normalizedDefaults(input);
        AppRepository_1.repository.setSetting(DEFAULTS_SETTING_KEY, normalized);
        return normalized;
    }
    listJobs(input = {}) {
        return AppRepository_1.repository.listMediaGenerationJobs(input);
    }
    getJob(id) {
        return AppRepository_1.repository.getMediaGenerationJob(id);
    }
    async createJob(input) {
        const prompt = input.prompt.trim();
        if (!prompt)
            throw new Error('Prompt is required.');
        if (input.source === 'local-agent') {
            const agentId = input.localAgentId?.trim() ?? '';
            if (!(0, agent_bridge_1.isSupportedChatAgent)(agentId))
                throw new Error('Select a supported local CLI agent.');
            const agent = (await (0, agent_bridge_1.listLocalChatAgents)()).find((item) => item.id === agentId);
            if (!agent || agent.state !== 'detected' || !agent.path) {
                throw new Error(`${agent_bridge_1.CHAT_AGENT_LABELS[agentId]} is not detected. Rescan local agents and try again.`);
            }
            const normalized = this.normalizeLocalCreateInput(input, agentId);
            const job = AppRepository_1.repository.createMediaGenerationJob({
                ...normalized,
                profileId: null,
                providerAdapterId: null,
                idempotencyKey: (0, crypto_1.randomUUID)(),
                request: normalized,
            });
            this.startJob(job);
            return AppRepository_1.repository.getMediaGenerationJob(job.id);
        }
        const model = await this.resolveModel(input.kind, input.modelId);
        if (model.lifecycle === 'retired')
            throw new Error(`${model.label} is retired and cannot accept new jobs.`);
        const profile = await this.resolveProfile(input.profileId ?? null, input.kind);
        if (!model.adapterIds.includes(profile.adapterId)) {
            throw new Error(`${model.label} is not available through ${profile.label}.`);
        }
        const normalized = this.normalizeCreateInput(input, model, profile);
        const idempotencyKey = (0, crypto_1.randomUUID)();
        const job = AppRepository_1.repository.createMediaGenerationJob({
            ...normalized,
            profileId: profile.id,
            providerAdapterId: profile.adapterId,
            idempotencyKey,
            request: normalized,
        });
        this.startJob(job);
        return AppRepository_1.repository.getMediaGenerationJob(job.id);
    }
    cancelJob(id) {
        const job = AppRepository_1.repository.getMediaGenerationJob(id);
        if (!job || isFinal(job))
            return job;
        const taskId = this.taskByJobId.get(id);
        if (taskId) {
            (0, agent_bridge_1.stopChatAgentRun)(id);
            BackgroundTaskService_1.backgroundTaskService.cancel(taskId);
        }
        const providerMayContinue = Boolean(job.providerJobId);
        const updated = AppRepository_1.repository.updateMediaGenerationJob(id, {
            status: taskId ? 'cancel-requested' : 'canceled',
            cancelRequestedAt: Date.now(),
            errorCode: providerMayContinue ? 'provider-cancel-unsupported' : null,
            errorMessage: providerMayContinue
                ? 'Cancel requested locally. The provider may continue processing and may still charge for the request.'
                : null,
            completedAt: taskId ? null : Date.now(),
        });
        if (updated)
            this.emit(updated, updated.errorMessage ?? (taskId ? 'Cancel requested.' : 'Generation canceled.'));
        return updated;
    }
    async deleteJob(input) {
        const job = AppRepository_1.repository.getMediaGenerationJob(input.id);
        if (!job)
            return false;
        if (!isFinal(job))
            throw new Error('Cancel this generation before deleting it.');
        if (input.removeAssets) {
            for (const output of job.outputs) {
                if (output.assetId)
                    await AssetService_1.assetService.deleteAsset(output.assetId, true);
            }
        }
        return AppRepository_1.repository.deleteMediaGenerationJob(input.id);
    }
    recoverInterruptedJobs() {
        const jobs = AppRepository_1.repository.listMediaGenerationJobs({ limit: 200 });
        let recovered = 0;
        for (const job of jobs) {
            if (job.status === 'queued') {
                this.startJob(job);
                recovered += 1;
            }
            else if (job.source === 'local-agent' && ['submitting', 'in-progress', 'downloading'].includes(job.status)) {
                const updated = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
                    status: 'failed',
                    errorCode: 'interrupted-local-agent',
                    errorMessage: 'The app closed while the local CLI was generating media. Run the job again to retry.',
                    completedAt: Date.now(),
                });
                if (updated)
                    this.emit(updated, updated.errorMessage ?? 'Local CLI generation was interrupted.');
            }
            else if (job.status === 'submitting' && !job.providerJobId) {
                const updated = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
                    status: 'submission-unknown',
                    errorCode: 'interrupted-during-submit',
                    errorMessage: 'The app closed while the provider submission was in flight. Retry manually to avoid a duplicate paid request.',
                });
                if (updated)
                    this.emit(updated, updated.errorMessage ?? 'Submission state is unknown.');
            }
            else if (['in-progress', 'downloading'].includes(job.status) && job.providerJobId) {
                this.startJob(job);
                recovered += 1;
            }
            else if (job.status === 'cancel-requested') {
                AppRepository_1.repository.updateMediaGenerationJob(job.id, { status: 'canceled', completedAt: Date.now() });
            }
        }
        return recovered;
    }
    dispose() {
        for (const [jobId, taskId] of this.taskByJobId) {
            (0, agent_bridge_1.stopChatAgentRun)(jobId);
            BackgroundTaskService_1.backgroundTaskService.cancel(taskId);
        }
        this.taskByJobId.clear();
    }
    async hasImageProvider() {
        try {
            await this.resolveCompatibilityImageProfile();
            return true;
        }
        catch {
            return false;
        }
    }
    async generateCompatibilityImage(prompt, options) {
        const profile = await this.resolveCompatibilityImageProfile();
        const credentials = await this.credentials(profile);
        const defaults = this.getDefaults();
        const modelId = (defaults.imageProfileId === profile.id ? defaults.imageModelId : null) || profile.defaultImageModel || 'gpt-image-2';
        const result = await this.requestImages(profile, credentials, {
            prompt,
            modelId,
            size: this.pickImageSize(options.width, options.height),
            quality: null,
            count: 1,
            referenceAssetIds: [],
        }, (0, crypto_1.randomUUID)(), new AbortController().signal);
        const first = result[0];
        if (!first)
            throw new Error(`${profile.label} returned no image.`);
        return { data: first.data, mimeType: first.mimeType, provider: profile.label };
    }
    startJob(job) {
        if (this.taskByJobId.has(job.id))
            return;
        const task = BackgroundTaskService_1.backgroundTaskService.run({
            kind: 'media.generate',
            title: `Generate ${job.kind}`,
            input: { jobId: job.id, kind: job.kind },
            scope: { productId: job.productId, view: job.kind === 'image' ? 'design' : 'ai-video-maker' },
            dedupeKey: `media-generation:${job.id}`,
        }, async (context) => {
            context.signal.addEventListener('abort', () => {
                const current = AppRepository_1.repository.getMediaGenerationJob(job.id);
                if (!current || isFinal(current) || current.status === 'cancel-requested')
                    return;
                const updated = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
                    status: 'cancel-requested',
                    cancelRequestedAt: Date.now(),
                    errorCode: current.providerJobId ? 'provider-cancel-unsupported' : null,
                    errorMessage: current.providerJobId
                        ? 'Cancel requested locally. The provider may continue processing and may still charge for the request.'
                        : null,
                });
                if (updated)
                    this.emit(updated, updated.errorMessage ?? 'Cancel requested.');
            }, { once: true });
            try {
                return await this.runJob(job.id, context);
            }
            finally {
                this.taskByJobId.delete(job.id);
            }
        });
        this.taskByJobId.set(job.id, task.id);
    }
    async runJob(jobId, context) {
        let job = AppRepository_1.repository.getMediaGenerationJob(jobId);
        if (!job)
            throw new Error('Media generation job not found.');
        try {
            if (context.signal.aborted)
                throw abortError();
            if (job.source === 'local-agent') {
                job = await this.runLocalAgentJob(job, context);
            }
            else if (job.kind === 'image') {
                const profile = await this.resolveProfile(job.profileId, job.kind);
                if (job.status !== 'queued') {
                    throw new Error('An interrupted image submission cannot be replayed automatically.');
                }
                job = await this.runImageJob(job, profile, context);
            }
            else {
                const profile = await this.resolveProfile(job.profileId, job.kind);
                job = await this.runVideoJob(job, profile, context);
            }
            return job;
        }
        catch (error) {
            const latest = AppRepository_1.repository.getMediaGenerationJob(jobId);
            if (!latest)
                throw error;
            if (context.signal.aborted || latest.status === 'canceled') {
                const providerMayContinue = Boolean(latest.providerJobId);
                const canceled = AppRepository_1.repository.updateMediaGenerationJob(jobId, {
                    status: 'canceled',
                    completedAt: Date.now(),
                    errorCode: providerMayContinue ? 'provider-cancel-unsupported' : latest.errorCode,
                    errorMessage: providerMayContinue
                        ? 'Canceled locally. The provider may continue processing and may still charge for the request.'
                        : latest.errorMessage,
                });
                this.emit(canceled, canceled.errorMessage ?? 'Generation canceled.');
                throw abortError();
            }
            const ambiguous = latest.status === 'submitting' && (!axios_1.default.isAxiosError(error) || error.response === undefined);
            const message = apiErrorMessage(error);
            const failed = AppRepository_1.repository.updateMediaGenerationJob(jobId, {
                status: ambiguous ? 'submission-unknown' : 'failed',
                errorCode: ambiguous
                    ? 'submission-unknown'
                    : latest.source === 'local-agent' ? 'local-agent-error' : 'provider-error',
                errorMessage: ambiguous
                    ? `${message} The provider may have accepted this request; retry manually to avoid duplicate charges.`
                    : message,
                completedAt: ambiguous ? null : Date.now(),
            });
            this.emit(failed, failed.errorMessage ?? 'Generation failed.');
            throw new Error(failed.errorMessage ?? 'Generation failed.');
        }
    }
    async runLocalAgentJob(job, context) {
        const agentId = job.localAgentId ?? '';
        if (!(0, agent_bridge_1.isSupportedChatAgent)(agentId))
            throw new Error('The selected local CLI agent is no longer supported.');
        const agent = (await (0, agent_bridge_1.listLocalChatAgents)()).find((item) => item.id === agentId);
        if (!agent || agent.state !== 'detected' || !agent.path) {
            throw new Error(`${agent_bridge_1.CHAT_AGENT_LABELS[agentId]} is no longer detected. Rescan local agents and run the job again.`);
        }
        const running = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
            status: 'in-progress',
            progress: 8,
            submissionAttempt: job.submissionAttempt + 1,
            submittedAt: Date.now(),
            errorCode: null,
            errorMessage: null,
        });
        this.emit(running, `Starting ${agent.displayName}…`);
        context.update({ done: 8, total: 100, message: `Starting ${agent.displayName}` });
        const workDir = await fs_1.default.promises.mkdtemp(path_1.default.join(os_1.default.tmpdir(), '1marketingtool-media-'));
        try {
            const referencePaths = await this.writeLocalAgentReferences(job, workDir);
            const outputCount = job.kind === 'image'
                ? Math.max(1, Math.min(4, Number(job.request.count ?? 1)))
                : 1;
            const outputPaths = Array.from({ length: outputCount }, (_, index) => path_1.default.join(workDir, `output-${index + 1}.${job.kind === 'image' ? 'png' : 'mp4'}`));
            context.update({ done: 15, total: 100, message: `${agent.displayName} is generating ${job.kind} media` });
            this.emit(AppRepository_1.repository.updateMediaGenerationJob(job.id, { status: 'in-progress', progress: 15 }), `${agent.displayName} is generating ${job.kind} media…`);
            const result = await (0, agent_bridge_1.runLocalChatAgent)({
                agentId,
                prompt: this.localAgentPrompt(job, outputPaths, referencePaths),
                cwd: workDir,
                timeoutSec: job.kind === 'video' ? 1800 : 900,
                conversationId: `media-generation:${job.id}`,
                runId: job.id,
            }, {
                onChunk: (chunk) => {
                    if (chunk.channel !== 'tool' || !chunk.text.trim())
                        return;
                    context.update({ done: 35, total: 100, message: chunk.text.trim().slice(0, 160) });
                },
            });
            if (context.signal.aborted)
                throw abortError();
            if (!result.ok)
                throw new Error(result.error ?? `${agent.displayName} could not generate the requested media.`);
            const entries = await fs_1.default.promises.readdir(workDir, { withFileTypes: true });
            const outputFiles = entries
                .filter((entry) => entry.isFile() && /^output-\d+\.(png|jpe?g|webp|mp4|webm|mov)$/i.test(entry.name))
                .map((entry) => path_1.default.join(workDir, entry.name))
                .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
                .slice(0, outputCount);
            if (!outputFiles.length) {
                const detail = result.output.trim().slice(-500);
                throw new Error(`${agent.displayName} finished without writing a supported ${job.kind} output file.` +
                    (detail ? ` Agent response: ${detail}` : ''));
            }
            context.update({ done: 82, total: 100, message: `Saving ${job.kind} output to Assets` });
            for (let index = 0; index < outputFiles.length; index += 1) {
                const data = await fs_1.default.promises.readFile(outputFiles[index]);
                const mimeType = validateGeneratedFile(data, job.kind);
                const ext = extensionForMime(mimeType, job.kind);
                const asset = await AssetService_1.assetService.importBytes(data, {
                    originalName: `generated-${job.kind}-${job.id.slice(0, 8)}-${index + 1}.${ext}`,
                    mimeType,
                    productId: job.productId,
                    title: job.prompt.slice(0, 80),
                    tags: ['generated', `${job.kind}-generation`, 'local-cli'],
                    metadata: {
                        source: 'media-generation',
                        generationJobId: job.id,
                        generationKind: job.kind,
                        operation: job.operation,
                        localAgentId: agentId,
                        prompt: job.prompt,
                        referenceAssetIds: Array.isArray(job.request.referenceAssetIds) ? job.request.referenceAssetIds : [],
                        generatedAt: Date.now(),
                    },
                });
                AppRepository_1.repository.createMediaGenerationOutput({
                    jobId: job.id,
                    assetId: asset.id,
                    ordinal: index,
                    providerOutputId: null,
                    metadata: { mimeType, sizeBytes: data.length, localAgentId: agentId },
                });
                const progress = Math.round(82 + ((index + 1) / outputFiles.length) * 15);
                context.update({ done: progress, total: 100, message: `Saved output ${index + 1} of ${outputFiles.length}` });
            }
            const completed = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
                status: 'completed',
                progress: 100,
                providerResponse: {
                    agentId,
                    transport: result.metadata.transport ?? null,
                    durationMs: result.metadata.durationMs,
                    outputs: outputFiles.length,
                },
                completedAt: Date.now(),
            });
            this.emit(completed, `${outputFiles.length} ${job.kind} output${outputFiles.length === 1 ? '' : 's'} saved to Assets.`);
            return completed;
        }
        finally {
            await fs_1.default.promises.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
        }
    }
    async writeLocalAgentReferences(job, workDir) {
        const referenceIds = Array.isArray(job.request.referenceAssetIds)
            ? job.request.referenceAssetIds.filter((id) => typeof id === 'string')
            : [];
        const referencePaths = [];
        for (let index = 0; index < referenceIds.length; index += 1) {
            const reference = await AssetService_1.assetService.readBytes(referenceIds[index]);
            if (!reference)
                throw new Error('A selected reference asset could not be read.');
            validateReferenceImage(reference.data);
            const referencePath = path_1.default.join(workDir, `reference-${index + 1}.${extensionForMime(reference.mimeType, 'image')}`);
            await fs_1.default.promises.writeFile(referencePath, reference.data);
            referencePaths.push(referencePath);
        }
        return referencePaths;
    }
    localAgentPrompt(job, outputPaths, referencePaths) {
        const size = typeof job.request.size === 'string' ? job.request.size : job.kind === 'image' ? '1024x1024' : '1280x720';
        const duration = typeof job.request.durationSeconds === 'number' ? job.request.durationSeconds : 4;
        const quality = typeof job.request.quality === 'string' ? job.request.quality : 'medium';
        const requirements = job.kind === 'image'
            ? [
                `Generate ${outputPaths.length} original raster image${outputPaths.length === 1 ? '' : 's'}.`,
                `Requested canvas: ${size}. Requested quality: ${quality}.`,
                'Use a real image-generation capability; do not substitute SVG, HTML, or a text description.',
            ]
            : [
                'Generate one original video clip.',
                `Requested canvas: ${size}. Requested duration: ${duration} seconds.`,
                'Use a real video-generation capability; do not substitute a slideshow, static-image loop, HTML, or a text description.',
            ];
        const references = referencePaths.length
            ? ['Use these local reference images when generating:', ...referencePaths.map((filePath) => `- ${filePath}`)]
            : ['No reference image was provided.'];
        return [
            'You are fulfilling a media-generation job for 1MarketingTool.',
            ...requirements,
            ...references,
            'Write the final binary output files inside the current working directory using these exact paths:',
            ...outputPaths.map((filePath) => `- ${filePath}`),
            'Do not modify files outside the current working directory.',
            'This job succeeds only when the requested output files exist. A text-only response is not an output.',
            '',
            'USER PROMPT',
            job.prompt,
        ].join('\n');
    }
    async runImageJob(job, profile, context) {
        const request = job.request;
        const imageRequest = {
            prompt: job.prompt,
            modelId: job.modelId,
            size: typeof request.size === 'string' ? request.size : '1024x1024',
            quality: typeof request.quality === 'string' ? request.quality : null,
            count: typeof request.count === 'number' ? request.count : 1,
            referenceAssetIds: Array.isArray(request.referenceAssetIds)
                ? request.referenceAssetIds.filter((id) => typeof id === 'string')
                : [],
        };
        const submitting = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
            status: 'submitting',
            progress: 5,
            submissionAttempt: job.submissionAttempt + 1,
            submittedAt: Date.now(),
            errorCode: null,
            errorMessage: null,
        });
        this.emit(submitting, 'Submitting image request…');
        context.update({ done: 5, total: 100, message: 'Submitting image request' });
        const credentials = await this.credentials(profile);
        const generated = await this.requestImages(profile, credentials, imageRequest, job.idempotencyKey, context.signal);
        if (context.signal.aborted)
            throw abortError();
        if (!generated.length)
            throw new Error(`${profile.label} returned no images.`);
        for (let index = 0; index < generated.length; index += 1) {
            const output = generated[index];
            output.mimeType = validateGeneratedFile(output.data, 'image');
            const ext = extensionForMime(output.mimeType, 'image');
            const asset = await AssetService_1.assetService.importBytes(output.data, {
                originalName: `generated-image-${job.id.slice(0, 8)}-${index + 1}.${ext}`,
                mimeType: output.mimeType,
                productId: job.productId,
                title: job.prompt.slice(0, 80),
                tags: ['generated', 'image-generation'],
                metadata: {
                    source: 'media-generation',
                    generationJobId: job.id,
                    generationKind: job.kind,
                    operation: job.operation,
                    providerId: profile.id,
                    modelId: job.modelId,
                    prompt: job.prompt,
                    referenceAssetIds: imageRequest.referenceAssetIds,
                    generatedAt: Date.now(),
                },
            });
            AppRepository_1.repository.createMediaGenerationOutput({
                jobId: job.id,
                assetId: asset.id,
                ordinal: index,
                providerOutputId: output.providerOutputId,
                metadata: { mimeType: output.mimeType, sizeBytes: output.data.length },
            });
            const progress = Math.round(70 + ((index + 1) / generated.length) * 25);
            context.update({ done: progress, total: 100, message: `Saved image ${index + 1} of ${generated.length}` });
        }
        const completed = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
            status: 'completed',
            progress: 100,
            providerResponse: { outputs: generated.length, provider: profile.label },
            completedAt: Date.now(),
        });
        this.logSuccess(completed, profile.label);
        this.emit(completed, `${generated.length} image${generated.length === 1 ? '' : 's'} saved to Assets.`);
        return completed;
    }
    async runVideoJob(job, profile, context) {
        const credentials = await this.credentials(profile);
        let providerJobId = job.providerJobId;
        let providerResponse = job.providerResponse;
        if (!providerJobId) {
            const submitting = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
                status: 'submitting',
                progress: 3,
                submissionAttempt: job.submissionAttempt + 1,
                submittedAt: Date.now(),
                errorCode: null,
                errorMessage: null,
            });
            this.emit(submitting, 'Submitting video request…');
            context.update({ done: 3, total: 100, message: 'Submitting video request' });
            const response = await this.submitVideo(job, profile, credentials, context.signal);
            providerJobId = typeof response.id === 'string' ? response.id : null;
            if (!providerJobId)
                throw new Error(`${profile.label} did not return a video job ID.`);
            providerResponse = responseSummary(response);
            const accepted = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
                providerJobId,
                providerResponse,
                status: 'in-progress',
                progress: typeof response.progress === 'number' ? response.progress : 5,
            });
            this.emit(accepted, 'Video request accepted by provider.');
        }
        let completedResponse = null;
        for (let attempt = 0; attempt < MAX_VIDEO_POLLS; attempt += 1) {
            if (context.signal.aborted)
                throw abortError();
            if (attempt > 0 || job.status !== 'downloading')
                await waitForPoll(context.signal);
            const response = await axios_1.default.get(joinUrl(profile.baseUrl, `videos/${providerJobId}`), {
                headers: this.requestHeaders(credentials),
                timeout: 45_000,
                signal: context.signal,
            });
            const status = String(response.data.status ?? '').toLowerCase();
            const progress = Math.max(5, Math.min(90, Number(response.data.progress ?? 0) || 5));
            providerResponse = responseSummary(response.data);
            if (status === 'failed') {
                const error = response.data.error;
                const message = error && typeof error === 'object' && typeof error.message === 'string'
                    ? String(error.message)
                    : 'Video generation failed at the provider.';
                throw new Error(message);
            }
            if (status === 'completed') {
                completedResponse = response.data;
                break;
            }
            const updated = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
                status: 'in-progress',
                progress,
                providerResponse,
            });
            context.update({ done: progress, total: 100, message: `Provider status: ${status || 'in progress'}` });
            this.emit(updated, `Provider status: ${status || 'in progress'}.`);
        }
        if (!completedResponse)
            throw new Error('Timed out waiting for the video provider.');
        const downloading = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
            status: 'downloading',
            progress: 92,
            providerResponse: responseSummary(completedResponse),
        });
        this.emit(downloading, 'Downloading completed video…');
        context.update({ done: 92, total: 100, message: 'Downloading completed video' });
        const response = await axios_1.default.get(joinUrl(profile.baseUrl, `videos/${providerJobId}/content`), {
            headers: this.requestHeaders(credentials),
            responseType: 'arraybuffer',
            timeout: 180_000,
            signal: context.signal,
        });
        const data = Buffer.from(response.data);
        const mimeType = validateGeneratedFile(data, 'video');
        const ext = extensionForMime(mimeType, 'video');
        const asset = await AssetService_1.assetService.importBytes(data, {
            originalName: `generated-video-${job.id.slice(0, 8)}.${ext}`,
            mimeType,
            productId: job.productId,
            title: job.prompt.slice(0, 80),
            tags: ['generated', 'video-generation'],
            metadata: {
                source: 'media-generation',
                generationJobId: job.id,
                generationKind: job.kind,
                operation: job.operation,
                providerId: profile.id,
                modelId: job.modelId,
                prompt: job.prompt,
                referenceAssetIds: Array.isArray(job.request.referenceAssetIds) ? job.request.referenceAssetIds : [],
                generatedAt: Date.now(),
            },
        });
        AppRepository_1.repository.createMediaGenerationOutput({
            jobId: job.id,
            assetId: asset.id,
            ordinal: 0,
            providerOutputId: providerJobId,
            metadata: { mimeType, sizeBytes: data.length },
        });
        const completed = AppRepository_1.repository.updateMediaGenerationJob(job.id, {
            status: 'completed',
            progress: 100,
            completedAt: Date.now(),
        });
        this.logSuccess(completed, profile.label);
        this.emit(completed, 'Video saved to Assets.');
        return completed;
    }
    async requestImages(profile, credentials, request, idempotencyKey, signal) {
        const headers = { ...this.requestHeaders(credentials), 'Idempotency-Key': idempotencyKey };
        let responseData;
        if (request.referenceAssetIds.length) {
            const form = new FormData();
            form.append('model', request.modelId);
            form.append('prompt', request.prompt);
            form.append('n', String(request.count));
            form.append('size', request.size);
            if (request.quality)
                form.append('quality', request.quality);
            for (const assetId of request.referenceAssetIds) {
                const asset = await AssetService_1.assetService.readBytes(assetId);
                if (!asset)
                    throw new Error('A selected reference asset could not be read.');
                validateReferenceImage(asset.data);
                form.append('image[]', new Blob([new Uint8Array(asset.data)], { type: asset.mimeType }), `${assetId}.png`);
            }
            const response = await axios_1.default.post(joinUrl(profile.baseUrl, 'images/edits'), form, {
                headers,
                timeout: 300_000,
                signal,
            });
            responseData = response.data;
        }
        else {
            const response = await axios_1.default.post(joinUrl(profile.baseUrl, 'images/generations'), {
                model: request.modelId,
                prompt: request.prompt,
                n: request.count,
                size: request.size,
                ...(request.quality ? { quality: request.quality } : {}),
            }, { headers, timeout: 300_000, signal });
            responseData = response.data;
        }
        const record = responseData && typeof responseData === 'object' ? responseData : {};
        const items = Array.isArray(record.data) ? record.data : [];
        const outputs = [];
        for (const item of items) {
            if (!item || typeof item !== 'object')
                continue;
            const value = item;
            const b64 = typeof value.b64_json === 'string' ? value.b64_json : null;
            const url = typeof value.url === 'string' ? value.url : null;
            if (b64) {
                outputs.push({
                    data: Buffer.from(b64, 'base64'),
                    mimeType: 'image/png',
                    providerOutputId: typeof value.id === 'string' ? value.id : null,
                });
            }
            else if (url) {
                const downloaded = await axios_1.default.get(url, { responseType: 'arraybuffer', timeout: 120_000, signal });
                outputs.push({
                    data: Buffer.from(downloaded.data),
                    mimeType: String(downloaded.headers['content-type'] ?? 'image/png').split(';')[0],
                    providerOutputId: typeof value.id === 'string' ? value.id : null,
                });
            }
        }
        return outputs;
    }
    async submitVideo(job, profile, credentials, signal) {
        const request = job.request;
        const size = typeof request.size === 'string' ? request.size : '1280x720';
        const seconds = typeof request.durationSeconds === 'number' ? request.durationSeconds : 4;
        const references = Array.isArray(request.referenceAssetIds)
            ? request.referenceAssetIds.filter((id) => typeof id === 'string')
            : [];
        const headers = { ...this.requestHeaders(credentials), 'Idempotency-Key': job.idempotencyKey };
        if (references.length) {
            const reference = await AssetService_1.assetService.readBytes(references[0]);
            if (!reference)
                throw new Error('The selected start-frame asset could not be read.');
            validateReferenceImage(reference.data);
            const form = new FormData();
            form.append('model', job.modelId);
            form.append('prompt', job.prompt);
            form.append('size', size);
            form.append('seconds', String(seconds));
            form.append('input_reference', new Blob([new Uint8Array(reference.data)], { type: reference.mimeType }), 'reference.png');
            const response = await axios_1.default.post(joinUrl(profile.baseUrl, 'videos'), form, {
                headers,
                timeout: 120_000,
                signal,
            });
            return response.data;
        }
        const response = await axios_1.default.post(joinUrl(profile.baseUrl, 'videos'), { model: job.modelId, prompt: job.prompt, size, seconds }, { headers, timeout: 120_000, signal });
        return response.data;
    }
    normalizeCreateInput(input, model, profile) {
        const references = (input.referenceAssetIds ?? []).filter(Boolean).slice(0, input.kind === 'video' ? 1 : 4);
        const operation = input.kind === 'image'
            ? references.length ? 'image-to-image' : 'text-to-image'
            : references.length ? 'image-to-video' : 'text-to-video';
        if (!model.operations.includes(operation))
            throw new Error(`${model.label} does not support ${operation}.`);
        const count = input.kind === 'image' ? Math.max(1, Math.min(model.maxOutputs, Math.floor(input.count ?? 1))) : 1;
        const size = model.sizes.includes(input.size ?? '') ? input.size : model.sizes[0] ?? null;
        const quality = model.qualities.includes(input.quality ?? '') ? input.quality : model.qualities[1] ?? model.qualities[0] ?? null;
        const durationSeconds = input.kind === 'video'
            ? model.durationsSeconds.includes(input.durationSeconds ?? 0)
                ? input.durationSeconds ?? model.durationsSeconds[0]
                : model.durationsSeconds[0] ?? 4
            : null;
        return {
            ...input,
            prompt: input.prompt.trim(),
            source: 'api-profile',
            profileId: profile.id,
            operation,
            size,
            quality,
            count,
            durationSeconds,
            referenceAssetIds: references,
        };
    }
    normalizeLocalCreateInput(input, agentId) {
        const references = (input.referenceAssetIds ?? []).filter(Boolean).slice(0, input.kind === 'video' ? 1 : 4);
        const operation = input.kind === 'image'
            ? references.length ? 'image-to-image' : 'text-to-image'
            : references.length ? 'image-to-video' : 'text-to-video';
        const imageSize = LOCAL_IMAGE_SIZES.includes(input.size)
            ? input.size
            : LOCAL_IMAGE_SIZES[0];
        const videoSize = LOCAL_VIDEO_SIZES.includes(input.size)
            ? input.size
            : LOCAL_VIDEO_SIZES[0];
        const quality = LOCAL_IMAGE_QUALITIES.includes(input.quality)
            ? input.quality
            : 'medium';
        const durationSeconds = LOCAL_VIDEO_DURATIONS.includes(input.durationSeconds)
            ? input.durationSeconds
            : LOCAL_VIDEO_DURATIONS[0];
        return {
            ...input,
            prompt: input.prompt.trim(),
            source: 'local-agent',
            profileId: null,
            localAgentId: agentId,
            modelId: `local-agent:${agentId}`,
            operation,
            size: input.kind === 'image' ? imageSize : videoSize,
            quality: input.kind === 'image' ? quality : null,
            count: input.kind === 'image' ? Math.max(1, Math.min(4, Math.floor(input.count ?? 1))) : 1,
            durationSeconds: input.kind === 'video' ? durationSeconds : null,
            referenceAssetIds: references,
        };
    }
    async resolveModel(kind, modelId) {
        const catalog = await this.catalog();
        const model = catalog.models.find((item) => item.kind === kind && item.id === modelId);
        if (!model)
            throw new Error(`Unknown ${kind} generation model: ${modelId}.`);
        return model;
    }
    async getProfile(id) {
        const stored = AppRepository_1.repository.getMediaProviderProfile(id);
        if (stored)
            return this.withSecretStatus(stored);
        return (await this.virtualProfiles()).find((profile) => profile.id === id) ?? null;
    }
    async resolveProfile(profileId, kind) {
        const defaults = this.getDefaults();
        const selectedId = profileId || (kind === 'image' ? defaults.imageProfileId : defaults.videoProfileId);
        if (selectedId) {
            const selected = await this.getProfile(selectedId);
            if (!selected)
                throw new Error('The selected media provider is no longer available.');
            this.assertUsableProfile(selected);
            return selected;
        }
        const profiles = await this.listProfiles();
        const fallback = profiles.find((profile) => profile.id === NINEROUTER_PROFILE_ID)
            ?? profiles.find((profile) => profile.id === OPENAI_CONNECTOR_PROFILE_ID)
            ?? profiles.find((profile) => profile.enabled && profile.hasSecret);
        if (!fallback) {
            throw new Error('No media API provider is configured. Add one in Settings → AI → Media generation.');
        }
        this.assertUsableProfile(fallback);
        return fallback;
    }
    async resolveCompatibilityImageProfile() {
        const defaultId = this.getDefaults().imageProfileId;
        if (defaultId) {
            const selected = await this.getProfile(defaultId);
            if (selected) {
                try {
                    this.assertUsableProfile(selected);
                    return selected;
                }
                catch {
                    // A stale saved default must not break the shipped builder fallback path.
                }
            }
        }
        const profiles = await this.listProfiles();
        const fallback = profiles.find((profile) => profile.id === NINEROUTER_PROFILE_ID)
            ?? profiles.find((profile) => profile.id === OPENAI_CONNECTOR_PROFILE_ID)
            ?? profiles.find((profile) => profile.enabled && profile.hasSecret && profile.defaultImageModel);
        if (!fallback) {
            throw new Error('No image generator configured. Add a media provider, enable the OpenAI connector, or set NINEROUTER_URL.');
        }
        this.assertUsableProfile(fallback);
        return fallback;
    }
    assertUsableProfile(profile) {
        if (!profile.enabled)
            throw new Error(`${profile.label} is disabled.`);
        if (!profile.hasSecret && profile.credentialSource !== 'environment') {
            throw new Error(`${profile.label} API key is missing.`);
        }
    }
    async virtualProfiles() {
        const profiles = [];
        const timestamp = 0;
        const ninerouterUrl = process.env.NINEROUTER_URL?.trim().replace(/\/+$/, '');
        if (ninerouterUrl) {
            profiles.push({
                id: NINEROUTER_PROFILE_ID,
                adapterId: 'openai-compatible',
                label: '9Router environment',
                baseUrl: ninerouterUrl.endsWith('/v1') ? ninerouterUrl : joinUrl(ninerouterUrl, 'v1'),
                credentialSource: 'environment',
                aiProviderProfileId: null,
                connectorName: null,
                environmentKey: 'NINEROUTER_API_KEY',
                defaultImageModel: 'gpt-image-2',
                defaultVideoModel: null,
                headers: {},
                enabled: true,
                sortOrder: -20,
                hasSecret: true,
                status: 'connected',
                virtual: true,
                lastTestedAt: null,
                lastError: null,
                createdAt: timestamp,
                updatedAt: timestamp,
            });
        }
        const connector = ConnectorService_1.connectorService.listConnectors().find((item) => item.name === 'openai' && item.enabled);
        if (connector) {
            const secret = await ConnectorService_1.connectorService.getSecret('openai');
            const hasSecret = typeof secret?.apiKey === 'string' && secret.apiKey.trim().length > 0;
            profiles.push({
                id: OPENAI_CONNECTOR_PROFILE_ID,
                adapterId: 'openai',
                label: 'OpenAI connector (legacy)',
                baseUrl: 'https://api.openai.com/v1',
                credentialSource: 'connector',
                aiProviderProfileId: null,
                connectorName: 'openai',
                environmentKey: null,
                defaultImageModel: 'gpt-image-2',
                defaultVideoModel: 'sora-2',
                headers: {},
                enabled: true,
                sortOrder: -10,
                hasSecret,
                status: hasSecret ? 'connected' : 'not_configured',
                virtual: true,
                lastTestedAt: connector.lastTestedAt,
                lastError: connector.lastError,
                createdAt: connector.createdAt,
                updatedAt: connector.updatedAt,
            });
        }
        return profiles;
    }
    async credentials(profile) {
        let apiKey = null;
        if (profile.credentialSource === 'own') {
            const secret = await CredentialVault_1.credentialVault.getSecret(mediaSecretAccount(profile.id));
            apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey.trim() : null;
        }
        else if (profile.credentialSource === 'ai-provider' && profile.aiProviderProfileId) {
            apiKey = await AiProviderService_1.aiProviderService.resolveApiKey(profile.aiProviderProfileId);
        }
        else if (profile.credentialSource === 'connector' && profile.connectorName) {
            const connector = ConnectorService_1.connectorService.listConnectors().find((item) => item.name === profile.connectorName);
            if (!connector?.enabled)
                throw new Error(`${profile.label} linked connector is disabled.`);
            const secret = await ConnectorService_1.connectorService.getSecret(profile.connectorName);
            apiKey = typeof secret?.apiKey === 'string' ? secret.apiKey.trim() : null;
        }
        else if (profile.credentialSource === 'environment') {
            apiKey = profile.environmentKey ? process.env[profile.environmentKey]?.trim() || null : null;
        }
        if (!apiKey && profile.credentialSource !== 'environment')
            throw new Error(`${profile.label} API key is missing.`);
        return { apiKey, headers: profile.headers };
    }
    requestHeaders(credentials) {
        return {
            ...credentials.headers,
            ...(credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {}),
        };
    }
    async withSecretStatus(profile) {
        let hasSecret = false;
        try {
            if (profile.credentialSource === 'environment')
                hasSecret = true;
            else
                hasSecret = Boolean((await this.credentials(profile)).apiKey);
        }
        catch {
            hasSecret = false;
        }
        return {
            ...profile,
            hasSecret,
            status: profile.lastError ? 'error' : hasSecret ? (profile.lastTestedAt ? 'connected' : 'not_configured') : 'not_configured',
        };
    }
    async updateProfileStatus(id, error, ok) {
        const profile = AppRepository_1.repository.updateMediaProviderProfileStatus(id, {
            lastTestedAt: Date.now(),
            lastError: error,
            enabled: ok ? true : undefined,
        });
        if (!profile)
            throw new Error('Media provider profile not found.');
        return this.withSecretStatus(profile);
    }
    emit(job, message) {
        const payload = { jobId: job.id, job, message };
        for (const window of electron_1.BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed())
                window.webContents.send(channels_1.CHANNELS.MEDIA_GENERATION_PROGRESS, payload);
        }
    }
    logSuccess(job, provider) {
        AiLogService_1.aiLogService.record({
            kind: 'ai',
            agent: provider,
            tool: `media:${job.kind}-generation`,
            transport: 'cloud',
            status: 'success',
            summary: `Generated ${job.outputs.length || 1} ${job.kind} output${job.outputs.length === 1 ? '' : 's'}`,
            durationMs: Math.max(0, Date.now() - job.createdAt),
        });
    }
    pickImageSize(width, height) {
        const ratio = width / height;
        if (ratio > 1.2)
            return '1536x1024';
        if (ratio < 0.83)
            return '1024x1536';
        return '1024x1024';
    }
}
exports.MediaGenerationService = MediaGenerationService;
exports.mediaGenerationService = new MediaGenerationService();
//# sourceMappingURL=MediaGenerationService.js.map