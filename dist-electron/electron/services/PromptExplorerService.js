"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptExplorerService = exports.PromptExplorerService = void 0;
const db_1 = require("../db");
const id_1 = require("../utils/id");
const agent_bridge_1 = require("../agent-bridge");
const PER_MODEL_TIMEOUT_SEC = 180;
const DEFAULT_MAX_MODELS = 4;
const MAX_PROGRESS_LOGS = 80;
const MAX_STREAM_PREVIEW_CHARS = 1600;
const STREAM_EMIT_INTERVAL_MS = 90;
function compactLogText(text, max = 220) {
    const compacted = text.replace(/\s+/g, ' ').trim();
    return compacted.length > max ? `${compacted.slice(0, max)}…` : compacted;
}
function isSupportedAgent(id) {
    return Object.prototype.hasOwnProperty.call(agent_bridge_1.CHAT_AGENT_LABELS, id);
}
/** Case-insensitive, boundary-aware occurrence count (handles multi-word/dotted brands). */
function countMentions(text, term) {
    const trimmed = term.trim();
    if (!trimmed)
        return 0;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'gi');
    const matches = text.match(re);
    return matches ? matches.length : 0;
}
function dedupeTerms(terms) {
    const seen = new Set();
    const out = [];
    for (const raw of terms) {
        const value = raw.trim();
        if (!value)
            continue;
        const key = value.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(value);
    }
    return out;
}
function parseJson(raw, fallback) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
function mapRun(row) {
    return {
        id: row.id,
        productId: row.product_id,
        prompt: row.prompt,
        brand: row.brand,
        competitors: parseJson(row.competitors_json, []),
        modelCount: row.model_count,
        brandMentionTotal: row.brand_mention_total,
        createdAt: row.created_at,
    };
}
function mapModel(row) {
    return {
        agentId: row.agent_id,
        modelLabel: row.model_label,
        provider: row.provider,
        status: row.status === 'ok' ? 'ok' : 'error',
        answer: row.answer,
        error: row.error,
        brandMentions: row.brand_mentions,
        competitorMentions: parseJson(row.competitor_mentions_json, {}),
        responseMs: row.response_ms,
    };
}
class PromptExplorerRepository {
    db = (0, db_1.getDb)();
    save(run, share, models) {
        const insertRun = this.db.prepare(`INSERT INTO prompt_explorer_runs
        (id, product_id, prompt, brand, competitors_json, share_json, model_count, brand_mention_total, created_at)
       VALUES (@id, @productId, @prompt, @brand, @competitorsJson, @shareJson, @modelCount, @brandMentionTotal, @createdAt)`);
        const insertModel = this.db.prepare(`INSERT INTO prompt_explorer_models
        (id, run_id, agent_id, model_label, provider, status, answer, error, brand_mentions, competitor_mentions_json, response_ms)
       VALUES (@id, @runId, @agentId, @modelLabel, @provider, @status, @answer, @error, @brandMentions, @competitorMentionsJson, @responseMs)`);
        const tx = this.db.transaction(() => {
            insertRun.run({
                id: run.id,
                productId: run.productId,
                prompt: run.prompt,
                brand: run.brand,
                competitorsJson: JSON.stringify(run.competitors),
                shareJson: JSON.stringify(share),
                modelCount: run.modelCount,
                brandMentionTotal: run.brandMentionTotal,
                createdAt: run.createdAt,
            });
            for (const model of models) {
                insertModel.run({
                    id: (0, id_1.createId)(),
                    runId: run.id,
                    agentId: model.agentId,
                    modelLabel: model.modelLabel,
                    provider: model.provider,
                    status: model.status,
                    answer: model.answer,
                    error: model.error,
                    brandMentions: model.brandMentions,
                    competitorMentionsJson: JSON.stringify(model.competitorMentions),
                    responseMs: model.responseMs,
                });
            }
        });
        tx();
    }
    list(input) {
        const limit = Math.max(1, Math.min(input?.limit ?? 50, 200));
        const rows = input?.productId
            ? this.db
                .prepare('SELECT * FROM prompt_explorer_runs WHERE product_id = ? ORDER BY created_at DESC LIMIT ?')
                .all(input.productId, limit)
            : this.db.prepare('SELECT * FROM prompt_explorer_runs ORDER BY created_at DESC LIMIT ?').all(limit);
        return rows.map(mapRun);
    }
    get(runId) {
        const row = this.db.prepare('SELECT * FROM prompt_explorer_runs WHERE id = ?').get(runId);
        if (!row)
            return null;
        const models = this.db.prepare('SELECT * FROM prompt_explorer_models WHERE run_id = ? ORDER BY rowid ASC').all(runId).map(mapModel);
        return { run: mapRun(row), models, shareOfVoice: parseJson(row.share_json, []) };
    }
    delete(runId) {
        return this.db.prepare('DELETE FROM prompt_explorer_runs WHERE id = ?').run(runId).changes > 0;
    }
}
const repository = new PromptExplorerRepository();
class PromptExplorerService {
    async explore(input, onProgress) {
        const prompt = (input?.prompt ?? '').trim();
        if (!prompt)
            throw new Error('Enter a prompt to explore.');
        const brand = input?.brand?.trim() || null;
        const competitors = dedupeTerms(input?.competitors ?? []).filter((name) => !brand || name.toLowerCase() !== brand.toLowerCase());
        const detectedAgents = (await (0, agent_bridge_1.listLocalChatAgents)()).filter((agent) => agent.state === 'detected' && agent.path && isSupportedAgent(agent.id));
        const detected = detectedAgents.map((agent) => agent.id);
        const detectedById = new Map(detectedAgents.map((agent) => [agent.id, agent]));
        const requested = dedupeTerms(input?.agentIds ?? []).filter(isSupportedAgent);
        const targets = (requested.length > 0 ? requested.filter((id) => detected.includes(id)) : detected).slice(0, requested.length > 0 ? requested.length : DEFAULT_MAX_MODELS);
        if (targets.length === 0) {
            throw new Error('No local CLI agent is available. Install Claude Code, Codex, Gemini CLI, OpenCode, Qwen, Hermes, or Aider, then try again.');
        }
        const runId = (0, id_1.createId)();
        const startedAt = Date.now();
        let lastStreamEmit = 0;
        let progress = onProgress
            ? {
                runId,
                phase: 'starting',
                message: `Preparing ${targets.length} detected CLI agent${targets.length === 1 ? '' : 's'}…`,
                total: targets.length,
                completed: 0,
                models: targets.map((agentId) => ({
                    agentId,
                    modelLabel: agent_bridge_1.CHAT_AGENT_LABELS[agentId] ?? agentId,
                    status: 'queued',
                    startedAt: null,
                    finishedAt: null,
                    responseMs: null,
                    streamedChars: 0,
                    streamPreview: '',
                    error: null,
                    transport: null,
                })),
                logs: [],
                startedAt,
                updatedAt: startedAt,
                error: null,
            }
            : null;
        const emitProgress = (throttled = false) => {
            if (!progress || !onProgress)
                return;
            const now = Date.now();
            if (throttled && now - lastStreamEmit < STREAM_EMIT_INTERVAL_MS)
                return;
            lastStreamEmit = now;
            onProgress({
                ...progress,
                models: progress.models.map((model) => ({ ...model })),
                logs: progress.logs.map((log) => ({ ...log })),
            });
        };
        const setProgress = (patch, throttled = false) => {
            if (!progress)
                return;
            progress = { ...progress, ...patch, updatedAt: Date.now() };
            emitProgress(throttled);
        };
        const pushLog = (message, level = 'info', agentId = null, throttled = false) => {
            if (!progress)
                return;
            const log = {
                id: `${Date.now()}:${progress.logs.length}`,
                time: Date.now(),
                message,
                level,
                agentId,
            };
            progress = {
                ...progress,
                logs: [...progress.logs, log].slice(-MAX_PROGRESS_LOGS),
                updatedAt: Date.now(),
            };
            emitProgress(throttled);
        };
        const setModelProgress = (agentId, patch, throttled = false) => {
            if (!progress)
                return;
            const models = progress.models.map((model) => (model.agentId === agentId ? { ...model, ...patch } : model));
            progress = {
                ...progress,
                models,
                completed: models.filter((model) => model.status === 'done' || model.status === 'error').length,
                updatedAt: Date.now(),
            };
            emitProgress(throttled);
        };
        const handleChunk = (agentId, channel, text) => {
            if (!progress || !text)
                return;
            const current = progress.models.find((model) => model.agentId === agentId);
            const label = current?.modelLabel ?? agent_bridge_1.CHAT_AGENT_LABELS[agentId] ?? agentId;
            if (channel === 'message') {
                const nextPreview = `${current?.streamPreview ?? ''}${text}`.slice(-MAX_STREAM_PREVIEW_CHARS).trimStart();
                setModelProgress(agentId, {
                    status: 'streaming',
                    streamedChars: (current?.streamedChars ?? 0) + text.length,
                    streamPreview: nextPreview,
                }, true);
                return;
            }
            if (channel === 'tool') {
                pushLog(`${label}: ${compactLogText(text)}`, 'info', agentId, true);
            }
        };
        pushLog(`Detected ${detected.length} available local CLI agent${detected.length === 1 ? '' : 's'}.`);
        setProgress({
            phase: 'running',
            message: `Querying ${targets.length} CLI agent${targets.length === 1 ? '' : 's'} in parallel…`,
        });
        const settled = await Promise.allSettled(targets.map(async (agentId) => {
            const agent = detectedById.get(agentId);
            const label = agent_bridge_1.CHAT_AGENT_LABELS[agentId] ?? agentId;
            setModelProgress(agentId, {
                status: 'running',
                startedAt: Date.now(),
                error: null,
                transport: agent?.acp ? 'acp' : 'headless',
            });
            pushLog(`Starting ${label}${agent?.acp ? ' via ACP' : ' headless'}…`, 'info', agentId);
            try {
                const model = await this.runModel(agentId, prompt, brand, competitors, runId, handleChunk);
                setModelProgress(agentId, {
                    status: model.status === 'ok' ? 'done' : 'error',
                    finishedAt: Date.now(),
                    responseMs: model.responseMs,
                    error: model.error,
                    transport: model.transport ?? (agent?.acp ? 'acp' : 'headless'),
                });
                pushLog(model.status === 'ok'
                    ? `${label} returned ${(model.answer ?? '').length.toLocaleString()} characters in ${(model.responseMs / 1000).toFixed(1)}s.`
                    : `${label} failed: ${model.error ?? 'No answer returned.'}`, model.status === 'ok' ? 'success' : 'error', agentId);
                return model;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Run failed.';
                setModelProgress(agentId, {
                    status: 'error',
                    finishedAt: Date.now(),
                    error: message,
                });
                pushLog(`${label} failed: ${message}`, 'error', agentId);
                throw error;
            }
        }));
        const models = settled.map((outcome, index) => outcome.status === 'fulfilled'
            ? outcome.value
            : this.failedModel(targets[index], outcome.reason instanceof Error ? outcome.reason.message : 'Run failed.'));
        const shareOfVoice = brand || competitors.length > 0 ? this.buildShareOfVoice(models, brand, competitors) : [];
        const brandMentionTotal = models.reduce((sum, model) => sum + model.brandMentions, 0);
        const run = {
            id: runId,
            productId: input?.productId ?? null,
            prompt,
            brand,
            competitors,
            modelCount: models.length,
            brandMentionTotal,
            createdAt: Date.now(),
        };
        repository.save(run, shareOfVoice, models);
        const okCount = models.filter((model) => model.status === 'ok').length;
        setProgress({
            phase: 'done',
            completed: models.length,
            message: `Done — ${okCount} of ${models.length} CLI agent${models.length === 1 ? '' : 's'} returned an answer.`,
        });
        return { run, models, shareOfVoice };
    }
    list(input) {
        return repository.list(input);
    }
    get(runId) {
        return repository.get(runId);
    }
    delete(runId) {
        return { removed: repository.delete(runId) };
    }
    async runModel(agentId, prompt, brand, competitors, runId, onChunk) {
        const started = Date.now();
        const result = await (0, agent_bridge_1.runLocalChatAgent)({
            agentId,
            prompt,
            cwd: null,
            timeoutSec: PER_MODEL_TIMEOUT_SEC,
            conversationId: `prompt-explorer:${runId}:${agentId}`,
            runId: `prompt-explorer:${runId}`,
        }, {
            onChunk: (chunk) => onChunk?.(agentId, chunk.channel, chunk.text),
        });
        const responseMs = result.metadata?.durationMs ?? Date.now() - started;
        const answer = result.output.trim();
        const label = agent_bridge_1.CHAT_AGENT_LABELS[agentId] ?? agentId;
        const transport = result.metadata?.transport ?? null;
        if (!result.ok || !answer) {
            return {
                ...this.failedModel(agentId, result.error ?? `${label} returned no answer.`, responseMs),
                transport,
            };
        }
        const competitorMentions = {};
        for (const name of competitors)
            competitorMentions[name] = countMentions(answer, name);
        return {
            agentId,
            modelLabel: label,
            provider: `local-cli:${agentId}`,
            status: 'ok',
            answer,
            error: null,
            brandMentions: brand ? countMentions(answer, brand) : 0,
            competitorMentions,
            responseMs,
            transport,
        };
    }
    failedModel(agentId, error, responseMs = 0) {
        return {
            agentId,
            modelLabel: agent_bridge_1.CHAT_AGENT_LABELS[agentId] ?? agentId,
            provider: `local-cli:${agentId}`,
            status: 'error',
            answer: null,
            error,
            brandMentions: 0,
            competitorMentions: {},
            responseMs,
        };
    }
    /**
     * Sum each brand/competitor's mentions across every model's answer and turn
     * the totals into shares. Every requested term is seeded so a brand nobody
     * mentioned still renders (mentions 0), rather than vanishing from the board.
     */
    buildShareOfVoice(models, brand, competitors) {
        const totals = new Map();
        if (brand)
            totals.set(brand.toLowerCase(), { name: brand, isBrand: true, mentions: 0 });
        for (const name of competitors)
            totals.set(name.toLowerCase(), { name, isBrand: false, mentions: 0 });
        for (const model of models) {
            if (model.status !== 'ok')
                continue;
            if (brand) {
                const entry = totals.get(brand.toLowerCase());
                if (entry)
                    entry.mentions += model.brandMentions;
            }
            for (const [name, count] of Object.entries(model.competitorMentions)) {
                const entry = totals.get(name.toLowerCase());
                if (entry)
                    entry.mentions += count;
            }
        }
        const rows = Array.from(totals.values());
        const denominator = rows.reduce((sum, row) => sum + row.mentions, 0);
        return rows
            .map((row) => ({
            name: row.name,
            isBrand: row.isBrand,
            mentions: row.mentions,
            sharePct: denominator > 0 ? Math.round((row.mentions / denominator) * 1000) / 10 : null,
        }))
            .sort((a, b) => b.mentions - a.mentions);
    }
}
exports.PromptExplorerService = PromptExplorerService;
exports.promptExplorerService = new PromptExplorerService();
//# sourceMappingURL=PromptExplorerService.js.map