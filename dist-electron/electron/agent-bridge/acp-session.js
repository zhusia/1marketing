"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.acpSessions = exports.AcpSessionManager = void 0;
exports.configureAcpRuntime = configureAcpRuntime;
exports.choosePermissionOption = choosePermissionOption;
exports.mergeAcpSpawnArgs = mergeAcpSpawnArgs;
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const agent_specs_1 = require("./agent-specs");
const acp_client_1 = require("./acp-client");
const launcher_1 = require("./launcher");
const SESSION_IDLE_MS = 5 * 60_000;
const REAPER_INTERVAL_MS = 60_000;
const INIT_TIMEOUT_MS = 20_000;
const SESSION_NEW_TIMEOUT_MS = 30_000;
let runtimeConfig = {};
/** Called once from the main process bootstrap; keeps this module electron-free. */
function configureAcpRuntime(config) {
    runtimeConfig = config;
}
/** Prefers a one-shot allow; falls back to a persistent allow; else null. */
function choosePermissionOption(options) {
    return (options.find((option) => option.kind === 'allow_once') ??
        options.find((option) => option.kind === 'allow_always') ??
        null);
}
class AcpSessionManager {
    sessions = new Map();
    reaper = null;
    async prompt(input) {
        const acpArgs = agent_specs_1.ACP_AGENT_ARGS[input.agentId];
        if (!acpArgs) {
            return failure(`${input.agentId} does not support ACP sessions.`, true);
        }
        const cwd = input.cwd && fs_1.default.existsSync(input.cwd) && fs_1.default.statSync(input.cwd).isDirectory()
            ? input.cwd
            : os_1.default.homedir();
        const key = `${input.conversationId ?? 'default'}:${input.agentId}`;
        let entry;
        try {
            entry = await this.ensureSession(key, input, acpArgs, cwd);
        }
        catch (err) {
            return failure(describeStartupError(err, input.agentId), true);
        }
        if (entry.busy) {
            return failure(`${input.agentId} is still answering the previous message in this conversation.`, true);
        }
        entry.busy = true;
        entry.activeRunId = input.runId;
        entry.lastUsedAt = Date.now();
        let output = '';
        /** Merge tool_call + tool_call_update fields by id so query/results arrive across ticks. */
        const toolCalls = new Map();
        const updateListener = (params) => {
            if (params.sessionId !== entry.sessionId)
                return;
            const update = (params.update ?? {});
            const kind = update.sessionUpdate;
            if (kind === 'agent_message_chunk') {
                const text = extractText(update);
                if (text) {
                    output += text;
                    input.onChunk?.({ channel: 'message', text });
                }
            }
            else if (kind === 'agent_thought_chunk') {
                const text = extractText(update);
                if (text)
                    input.onChunk?.({ channel: 'thought', text });
            }
            else if (kind === 'tool_call' || kind === 'tool_call_update') {
                for (const event of formatToolCallEvents(update, kind === 'tool_call' ? 'start' : 'update', toolCalls)) {
                    input.onChunk?.(event);
                }
            }
        };
        entry.updateListeners.add(updateListener);
        let timeoutTimer = null;
        try {
            const turn = entry.client.request('session/prompt', { sessionId: entry.sessionId, prompt: [{ type: 'text', text: input.prompt }] }, 0);
            const timeout = new Promise((_resolve, reject) => {
                timeoutTimer = setTimeout(() => {
                    entry.client.notify('session/cancel', { sessionId: entry.sessionId });
                    reject(new Error(`Timed out after ${Math.round(input.timeoutMs / 1000)} seconds.`));
                }, input.timeoutMs);
            });
            const result = await Promise.race([turn, timeout]);
            const stopReason = result?.stopReason ?? null;
            const usage = extractUsage(result?.usage);
            if (stopReason === 'refusal') {
                return { ok: false, output, stopReason, error: 'The agent refused this request.', usage, startupFailure: false };
            }
            if (stopReason === 'cancelled') {
                return { ok: false, output, stopReason, error: 'Stopped.', usage, startupFailure: false };
            }
            if (!output.trim()) {
                // The turn ended without any assistant text. Some agents (notably
                // opencode) swallow provider-side failures here and still report
                // `end_turn`, so an empty turn is the only signal we get. A 0-token
                // turn means the request was rejected outright — most often a model
                // that disallows a tool/function name we exposed (e.g. Moonshot/Kimi
                // requires names to start with a letter).
                const totalTokens = usage?.total ?? null;
                return {
                    ok: false,
                    output,
                    stopReason,
                    error: totalTokens === 0
                        ? 'The model returned no output and used 0 tokens — the provider rejected the request. This usually means the selected model is incompatible with one of the available tools/skills (e.g. it disallows a tool name). Try a different model.'
                        : 'The model ended its turn without any text response. Try a different model or rephrase your message.',
                    usage,
                    startupFailure: false,
                };
            }
            return { ok: true, output, stopReason, error: null, usage, startupFailure: false };
        }
        catch (err) {
            return {
                ok: false,
                output,
                stopReason: null,
                error: err instanceof Error ? err.message : String(err),
                usage: null,
                startupFailure: false,
            };
        }
        finally {
            if (timeoutTimer)
                clearTimeout(timeoutTimer);
            entry.updateListeners.delete(updateListener);
            entry.busy = false;
            entry.activeRunId = null;
            entry.lastUsedAt = Date.now();
        }
    }
    /** Cancels the in-flight turn that belongs to `runId`. */
    cancelRun(runId) {
        for (const entry of this.sessions.values()) {
            if (entry.activeRunId === runId && entry.busy) {
                entry.client.notify('session/cancel', { sessionId: entry.sessionId });
                return true;
            }
        }
        return false;
    }
    disposeAll() {
        if (this.reaper) {
            clearInterval(this.reaper);
            this.reaper = null;
        }
        for (const entry of this.sessions.values()) {
            this.destroyEntry(entry);
        }
        this.sessions.clear();
    }
    /** Number of live sessions (for tests/diagnostics). */
    get size() {
        return this.sessions.size;
    }
    async ensureSession(key, input, acpArgs, cwd) {
        const modelId = input.modelId ?? null;
        const modelStrategy = agent_specs_1.ACP_MODEL_STRATEGY[input.agentId];
        const existing = this.sessions.get(key);
        if (existing && existing.alive && existing.binaryPath === input.binaryPath && existing.cwd === cwd) {
            if (existing.modelId === modelId || !modelStrategy)
                return existing;
            if (modelStrategy === 'config-option' && modelId) {
                await existing.client.request('session/set_config_option', { sessionId: existing.sessionId, configId: 'model', optionId: 'model', value: modelId }, 15_000);
                existing.modelId = modelId;
                return existing;
            }
            if (modelStrategy === 'config-option' && !modelId) {
                // Back to "default" — keep the session; the agent keeps its current model.
                existing.modelId = modelId;
                return existing;
            }
            // spawn-args agents need a fresh process to change model.
        }
        if (existing) {
            this.destroyEntry(existing);
            this.sessions.delete(key);
        }
        const modelArgs = modelStrategy === 'spawn-args' && modelId
            ? agent_specs_1.AGENT_MODEL_FLAGS[input.agentId]?.(modelId) ?? []
            : [];
        const launch = (0, launcher_1.prepareChatAgentLaunch)({
            binaryPath: input.binaryPath,
            args: mergeAcpSpawnArgs(input.agentId, acpArgs, modelArgs),
            env: input.env,
            platform: process.platform,
            nodeExecutable: process.execPath,
        });
        if (!launch.ok)
            throw new Error(launch.error);
        const child = (0, child_process_1.spawn)(launch.command, launch.args, {
            cwd,
            env: launch.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const updateListeners = new Set();
        const client = new acp_client_1.AcpClient(child, {
            onSessionUpdate: (params) => {
                for (const listener of updateListeners)
                    listener(params);
            },
            onRequest: (method, params) => this.handleAgentRequest(method, params),
            onClose: () => {
                const entry = this.sessions.get(key);
                if (entry && entry.child === child) {
                    entry.alive = false;
                    this.sessions.delete(key);
                }
            },
        });
        const init = await client.request('initialize', {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
        }, INIT_TIMEOUT_MS);
        let sessionResult;
        try {
            sessionResult = await client.request('session/new', {
                cwd,
                mcpServers: runtimeConfig.mcpServers?.(input.agentId) ?? [],
            }, SESSION_NEW_TIMEOUT_MS);
        }
        catch (err) {
            child.kill();
            throw attachAuthHint(err, init.authMethods);
        }
        if (!sessionResult.sessionId) {
            child.kill();
            throw new Error('Agent did not return a session id.');
        }
        if (modelStrategy === 'config-option' && modelId) {
            try {
                await client.request('session/set_config_option', { sessionId: sessionResult.sessionId, configId: 'model', optionId: 'model', value: modelId }, 15_000);
            }
            catch (err) {
                child.kill();
                throw new Error(`Could not select model "${modelId}": ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        const entry = {
            key,
            agentId: input.agentId,
            binaryPath: input.binaryPath,
            child,
            client,
            sessionId: sessionResult.sessionId,
            cwd,
            lastUsedAt: Date.now(),
            busy: false,
            authMethods: init.authMethods,
            activeRunId: null,
            alive: true,
            modelId,
            updateListeners,
        };
        this.sessions.set(key, entry);
        this.startReaper();
        return entry;
    }
    handleAgentRequest(method, params) {
        if (method === 'session/request_permission') {
            const options = Array.isArray(params.options) ? params.options : [];
            const chosen = choosePermissionOption(options);
            if (chosen) {
                return { outcome: { outcome: 'selected', optionId: chosen.optionId } };
            }
            return { outcome: { outcome: 'cancelled' } };
        }
        throw new Error(`Method not supported: ${method}`);
    }
    startReaper() {
        if (this.reaper)
            return;
        this.reaper = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.sessions) {
                if (!entry.busy && now - entry.lastUsedAt > SESSION_IDLE_MS) {
                    this.destroyEntry(entry);
                    this.sessions.delete(key);
                }
            }
            if (this.sessions.size === 0 && this.reaper) {
                clearInterval(this.reaper);
                this.reaper = null;
            }
        }, REAPER_INTERVAL_MS);
        this.reaper.unref?.();
    }
    destroyEntry(entry) {
        entry.alive = false;
        entry.client.dispose();
        try {
            if (process.platform === 'win32' && entry.child.pid) {
                (0, child_process_1.spawn)('taskkill', ['/PID', String(entry.child.pid), '/T', '/F'], {
                    stdio: 'ignore',
                    windowsHide: true,
                }).unref();
            }
            else {
                entry.child.kill('SIGTERM');
            }
        }
        catch {
            // already exited
        }
    }
}
exports.AcpSessionManager = AcpSessionManager;
function extractText(update) {
    const content = update.content;
    return content?.type === 'text' && typeof content.text === 'string' ? content.text : '';
}
const TOOL_QUERY_KEYS = [
    'query',
    'q',
    'search',
    'search_query',
    'searchQuery',
    'keyword',
    'keywords',
    'prompt',
    'text',
    'input',
    'url',
    'urls',
];
/**
 * Turn an ACP tool_call / tool_call_update into one or more stream chunks that
 * surface the search query, result body, and source sites.
 */
function formatToolCallEvents(update, stage, tracked) {
    const toolCallId = typeof update.toolCallId === 'string' && update.toolCallId.trim()
        ? update.toolCallId.trim()
        : `anon:${stage}:${Date.now()}:${Math.random().toString(16).slice(2, 8)}`;
    const prev = tracked.get(toolCallId);
    const merged = {
        toolCallId,
        title: typeof update.title === 'string' && update.title.trim()
            ? update.title.trim()
            : prev?.title ?? null,
        kind: typeof update.kind === 'string' && update.kind.trim()
            ? update.kind.trim()
            : prev?.kind ?? null,
        status: typeof update.status === 'string' && update.status.trim()
            ? update.status.trim()
            : prev?.status ?? null,
        rawInput: update.rawInput !== undefined ? update.rawInput : prev?.rawInput,
        rawOutput: update.rawOutput !== undefined ? update.rawOutput : prev?.rawOutput,
        content: update.content !== undefined ? update.content : prev?.content,
        emittedQuery: prev?.emittedQuery ?? false,
        emittedResultKey: prev?.emittedResultKey ?? null,
    };
    // Also pick common agent aliases that some CLIs put beside the ACP fields.
    for (const key of ['arguments', 'input', 'params', 'args', 'toolInput', 'tool_input']) {
        if (update[key] !== undefined && merged.rawInput === undefined)
            merged.rawInput = update[key];
    }
    for (const key of ['output', 'result', 'response']) {
        if (update[key] !== undefined && merged.rawOutput === undefined)
            merged.rawOutput = update[key];
    }
    const snapshot = {
        title: merged.title ?? '',
        kind: merged.kind,
        status: merged.status,
        rawInput: merged.rawInput,
        rawOutput: merged.rawOutput,
        content: merged.content,
    };
    // Preserve title/kind/status as top-level for extractors that read update.title.
    if (merged.title)
        snapshot.title = merged.title;
    if (merged.kind)
        snapshot.kind = merged.kind;
    if (merged.status)
        snapshot.status = merged.status;
    const title = merged.title ?? '';
    const status = merged.status;
    const toolKind = merged.kind;
    const query = extractToolQuery(snapshot);
    const resultText = extractToolResultText(snapshot);
    const sites = extractToolSites(snapshot, resultText);
    const isWebSearch = looksLikeWebSearchTool(title, toolKind, query, resultText, sites);
    const label = title || (isWebSearch ? 'Web search' : 'Tool');
    const events = [];
    if (query && !merged.emittedQuery) {
        merged.emittedQuery = true;
        events.push({
            channel: 'tool',
            text: isWebSearch ? `Search: ${query}` : `${label} · input: ${query}`,
            toolMeta: {
                isWebSearch,
                phase: 'query',
                detail: query,
            },
        });
    }
    const resultKey = buildResultKey(resultText, sites);
    if (resultKey && resultKey !== merged.emittedResultKey) {
        merged.emittedResultKey = resultKey;
        const siteSummary = sites.length
            ? sites
                .slice(0, 8)
                .map((site) => formatSiteLine(site))
                .join('\n')
            : null;
        const preview = siteSummary ||
            (resultText ? truncateToolText(resultText, isWebSearch ? 720 : 320) : null);
        if (preview) {
            events.push({
                channel: 'tool',
                text: isWebSearch
                    ? sites.length
                        ? `Results: ${sites.length} site${sites.length === 1 ? '' : 's'}`
                        : `Results: ${truncateToolText(preview, 480)}`
                    : `${label} · result: ${truncateToolText(preview, 320)}`,
                toolMeta: {
                    isWebSearch,
                    phase: 'result',
                    detail: preview,
                    sites: sites.length ? sites : undefined,
                },
            });
        }
    }
    // Status-only events when we still have nothing useful (typical early in_progress).
    if (!events.length) {
        const interesting = stage === 'start' ||
            status === 'completed' ||
            status === 'failed' ||
            status === 'pending';
        if (!interesting) {
            tracked.set(toolCallId, merged);
            return [];
        }
        // Skip bare "Web search: (in_progress)" spam — wait for query/results.
        if (isWebSearch && status === 'in_progress') {
            tracked.set(toolCallId, merged);
            return [];
        }
        const statusLabel = status ? status.replace(/_/g, ' ') : stage === 'start' ? 'started' : 'updated';
        events.push({
            channel: 'tool',
            text: isWebSearch ? `Web search · ${statusLabel}` : `${label} · ${statusLabel}`,
            toolMeta: {
                isWebSearch,
                phase: isWebSearch ? 'status' : 'call',
                detail: status ?? undefined,
            },
        });
    }
    tracked.set(toolCallId, merged);
    return events;
}
function buildResultKey(resultText, sites) {
    if (sites.length) {
        return `sites:${sites.map((site) => site.url).join('|')}`;
    }
    if (resultText?.trim())
        return `text:${resultText.trim().slice(0, 240)}`;
    return null;
}
function formatSiteLine(site) {
    const host = siteHost(site.url);
    if (site.title && host)
        return `${host} — ${site.title}`;
    if (site.title)
        return site.title;
    return host || site.url;
}
function siteHost(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    }
    catch {
        return null;
    }
}
function looksLikeWebSearchTool(title, toolKind, query, resultText, sites = []) {
    if (toolKind === 'search' || toolKind === 'fetch')
        return true;
    if (sites.length > 0)
        return true;
    const haystack = `${title}\n${query ?? ''}\n${resultText ?? ''}`;
    return /\b(web\s*search|websearch|web_search|WebSearch|WebFetch|search_web|search_x|google_search|brave search|search the web|web browse)\b/i.test(haystack);
}
/** Pull concrete site/source entries from tool payloads (arrays, markdown, bare URLs). */
function extractToolSites(update, resultText) {
    const sites = [];
    const seen = new Set();
    const push = (site) => {
        if (!site?.url)
            return;
        const normalized = normalizeSiteUrl(site.url);
        if (!normalized || seen.has(normalized))
            return;
        seen.add(normalized);
        sites.push({
            url: normalized,
            ...(site.title?.trim() ? { title: site.title.trim() } : {}),
            ...(site.snippet?.trim() ? { snippet: site.snippet.trim().slice(0, 220) } : {}),
        });
    };
    collectSitesFromValue(update.rawOutput, push, 0);
    collectSitesFromValue(update.content, push, 0);
    collectSitesFromValue(update.rawInput, push, 0);
    for (const key of ['output', 'result', 'response', 'results', 'sources', 'citations']) {
        if (key in update)
            collectSitesFromValue(update[key], push, 0);
    }
    if (resultText) {
        for (const site of extractSitesFromText(resultText))
            push(site);
    }
    return sites.slice(0, 12);
}
function normalizeSiteUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    try {
        const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        const url = new URL(withProtocol);
        if (!url.hostname || !url.hostname.includes('.'))
            return null;
        // Drop tracking fragments for cleaner logs.
        url.hash = '';
        return url.toString();
    }
    catch {
        return null;
    }
}
function collectSitesFromValue(value, push, depth) {
    if (value == null || depth > 6)
        return;
    if (typeof value === 'string') {
        for (const site of extractSitesFromText(value))
            push(site);
        // JSON blob?
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                collectSitesFromValue(JSON.parse(trimmed), push, depth + 1);
            }
            catch {
                // ignore
            }
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const entry of value)
            collectSitesFromValue(entry, push, depth + 1);
        return;
    }
    if (typeof value !== 'object')
        return;
    const record = value;
    const type = typeof record.type === 'string' ? record.type : '';
    // ACP content wrapper: { type: 'content', content: { type: 'text', text } }
    if (type === 'content' && record.content) {
        collectSitesFromValue(record.content, push, depth + 1);
    }
    if (type === 'resource_link' || type === 'resource') {
        const url = typeof record.uri === 'string'
            ? record.uri
            : typeof record.url === 'string'
                ? record.url
                : null;
        const title = typeof record.title === 'string'
            ? record.title
            : typeof record.name === 'string'
                ? record.name
                : undefined;
        if (url)
            push({ url, title });
    }
    const url = typeof record.url === 'string'
        ? record.url
        : typeof record.uri === 'string'
            ? record.uri
            : typeof record.link === 'string'
                ? record.link
                : typeof record.href === 'string'
                    ? record.href
                    : typeof record.source_url === 'string'
                        ? record.source_url
                        : typeof record.sourceUrl === 'string'
                            ? record.sourceUrl
                            : null;
    const title = typeof record.title === 'string'
        ? record.title
        : typeof record.name === 'string'
            ? record.name
            : typeof record.page_title === 'string'
                ? record.page_title
                : undefined;
    const snippet = typeof record.snippet === 'string'
        ? record.snippet
        : typeof record.description === 'string'
            ? record.description
            : typeof record.summary === 'string'
                ? record.summary
                : typeof record.text === 'string' && record.text.length < 280
                    ? record.text
                    : undefined;
    if (url)
        push({ url, title, snippet });
    // Nested lists of sources.
    for (const key of [
        'results',
        'sources',
        'citations',
        'items',
        'pages',
        'links',
        'web',
        'organic',
        'data',
        'output',
        'content',
    ]) {
        if (key in record)
            collectSitesFromValue(record[key], push, depth + 1);
    }
}
function extractSitesFromText(text) {
    const sites = [];
    const seen = new Set();
    // Markdown links: [Title](https://example.com)
    const md = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
    let match;
    while ((match = md.exec(text)) !== null) {
        const url = normalizeSiteUrl(match[2]);
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        sites.push({ url, title: match[1].trim() || undefined });
    }
    // Bare URLs
    const bare = /https?:\/\/[^\s<>"')\]]+/gi;
    while ((match = bare.exec(text)) !== null) {
        const cleaned = match[0].replace(/[.,;:!?]+$/, '');
        const url = normalizeSiteUrl(cleaned);
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        sites.push({ url });
    }
    // domain-only lines like "example.com — Some Title"
    const domainLine = /^(?:[-*•]\s*)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\s*[—–:-]\s*(.+))?$/gim;
    while ((match = domainLine.exec(text)) !== null) {
        const url = normalizeSiteUrl(match[1]);
        if (!url || seen.has(url))
            continue;
        seen.add(url);
        sites.push({ url, title: match[2]?.trim() || undefined });
    }
    return sites;
}
function extractToolQuery(update) {
    const fromRaw = extractQueryFromValue(update.rawInput);
    if (fromRaw)
        return fromRaw;
    // Some agents put args under `arguments` / `input` / `params`.
    for (const key of ['arguments', 'input', 'params', 'args']) {
        if (key in update) {
            const found = extractQueryFromValue(update[key]);
            if (found)
                return found;
        }
    }
    // Title sometimes embeds the query: "Web search: latest AI tools"
    if (typeof update.title === 'string') {
        const match = update.title.match(/^(?:web\s*search|search|webfetch)\s*[:\-–]\s*(.+)$/i);
        const tail = match?.[1]?.trim();
        if (tail && !/^(in[_\s-]?progress|pending|completed|failed|started)$/i.test(tail)) {
            return tail;
        }
    }
    return null;
}
function extractQueryFromValue(value, depth = 0) {
    if (value == null || depth > 4)
        return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed)
            return null;
        // JSON-encoded args blob
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                return extractQueryFromValue(JSON.parse(trimmed), depth + 1);
            }
            catch {
                return trimmed.length <= 280 ? trimmed : `${trimmed.slice(0, 277)}…`;
            }
        }
        return trimmed.length <= 280 ? trimmed : `${trimmed.slice(0, 277)}…`;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = extractQueryFromValue(entry, depth + 1);
            if (found)
                return found;
        }
        return null;
    }
    if (typeof value !== 'object')
        return null;
    const record = value;
    for (const key of TOOL_QUERY_KEYS) {
        const raw = record[key];
        if (typeof raw === 'string' && raw.trim()) {
            const text = raw.trim();
            return text.length <= 280 ? text : `${text.slice(0, 277)}…`;
        }
        if (Array.isArray(raw)) {
            const parts = raw.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
            if (parts.length) {
                const joined = parts.join('; ');
                return joined.length <= 280 ? joined : `${joined.slice(0, 277)}…`;
            }
        }
    }
    // Nested common wrappers
    for (const key of ['toolInput', 'tool_input', 'parameters', 'data']) {
        if (key in record) {
            const found = extractQueryFromValue(record[key], depth + 1);
            if (found)
                return found;
        }
    }
    return null;
}
function extractToolResultText(update) {
    const fromContent = extractTextFromToolContent(update.content);
    if (fromContent)
        return fromContent;
    const fromRaw = extractTextFromUnknown(update.rawOutput);
    if (fromRaw)
        return fromRaw;
    // Occasional aliases used by agents
    for (const key of ['output', 'result', 'response']) {
        if (key in update) {
            const found = extractTextFromUnknown(update[key]);
            if (found)
                return found;
        }
    }
    return null;
}
function extractTextFromToolContent(content) {
    if (!Array.isArray(content)) {
        // Some agents send a single content block object
        if (content && typeof content === 'object') {
            return extractTextFromUnknown(content);
        }
        return null;
    }
    const parts = [];
    for (const item of content) {
        if (!item || typeof item !== 'object')
            continue;
        const block = item;
        const type = typeof block.type === 'string' ? block.type : '';
        if (type === 'content' && block.content && typeof block.content === 'object') {
            const inner = block.content;
            if (typeof inner.text === 'string' && inner.text.trim())
                parts.push(inner.text.trim());
            continue;
        }
        if (type === 'text' && typeof block.text === 'string' && block.text.trim()) {
            parts.push(block.text.trim());
            continue;
        }
        // Resource / link style results
        if (type === 'resource_link' || type === 'resource') {
            const name = typeof block.name === 'string' ? block.name : typeof block.title === 'string' ? block.title : null;
            const uri = typeof block.uri === 'string' ? block.uri : typeof block.url === 'string' ? block.url : null;
            if (name && uri)
                parts.push(`${name} — ${uri}`);
            else if (uri)
                parts.push(uri);
            else if (name)
                parts.push(name);
            continue;
        }
        const nested = extractTextFromUnknown(block);
        if (nested)
            parts.push(nested);
    }
    if (!parts.length)
        return null;
    return parts.join('\n');
}
function extractTextFromUnknown(value, depth = 0) {
    if (value == null || depth > 4)
        return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (typeof value === 'number' || typeof value === 'boolean')
        return String(value);
    if (Array.isArray(value)) {
        const parts = value
            .map((entry) => extractTextFromUnknown(entry, depth + 1))
            .filter((entry) => Boolean(entry));
        return parts.length ? parts.join('\n') : null;
    }
    if (typeof value !== 'object')
        return null;
    const record = value;
    if (typeof record.text === 'string' && record.text.trim())
        return record.text.trim();
    if (typeof record.output === 'string' && record.output.trim())
        return record.output.trim();
    if (typeof record.result === 'string' && record.result.trim())
        return record.result.trim();
    if (typeof record.content === 'string' && record.content.trim())
        return record.content.trim();
    // OpenAI/Anthropic-ish search results list
    if (Array.isArray(record.results) || Array.isArray(record.sources) || Array.isArray(record.citations)) {
        const list = (record.results ?? record.sources ?? record.citations);
        const lines = list
            .map((entry) => {
            if (!entry || typeof entry !== 'object')
                return typeof entry === 'string' ? entry : null;
            const item = entry;
            const title = typeof item.title === 'string'
                ? item.title
                : typeof item.name === 'string'
                    ? item.name
                    : null;
            const url = typeof item.url === 'string'
                ? item.url
                : typeof item.uri === 'string'
                    ? item.uri
                    : typeof item.link === 'string'
                        ? item.link
                        : null;
            const snippet = typeof item.snippet === 'string'
                ? item.snippet
                : typeof item.description === 'string'
                    ? item.description
                    : null;
            if (title && url)
                return snippet ? `${title} — ${url}\n${snippet}` : `${title} — ${url}`;
            if (url)
                return url;
            if (title)
                return title;
            return extractTextFromUnknown(entry, depth + 1);
        })
            .filter((entry) => Boolean(entry));
        if (lines.length)
            return lines.join('\n');
    }
    // Prefer pretty JSON for small objects so the user can still read the payload
    try {
        const json = JSON.stringify(record);
        if (json && json !== '{}' && json.length <= 600)
            return json;
    }
    catch {
        // ignore
    }
    return null;
}
function truncateToolText(text, max) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, Math.max(0, max - 1))}…`;
}
function describeStartupError(err, agentId) {
    const message = err instanceof Error ? err.message : String(err);
    return `Could not start an ACP session with ${agentId}: ${message}`;
}
/** Merge ACP mode args with model flags (Grok needs model before the final subcommand). */
function mergeAcpSpawnArgs(agentId, acpArgs, modelArgs) {
    if (modelArgs.length === 0)
        return acpArgs;
    if (agent_specs_1.ACP_MODEL_FLAG_POSITION[agentId] === 'before-last' && acpArgs.length > 0) {
        return [...acpArgs.slice(0, -1), ...modelArgs, acpArgs[acpArgs.length - 1]];
    }
    return [...acpArgs, ...modelArgs];
}
function attachAuthHint(err, authMethods) {
    const base = err instanceof Error ? err.message : String(err);
    const code = err?.code;
    const hint = authMethods?.[0]?.description;
    if (hint && (code === 401 || /auth/i.test(base))) {
        return new Error(`${base} — ${hint}`);
    }
    return err instanceof Error ? err : new Error(base);
}
function failure(error, startupFailure) {
    return { ok: false, output: '', stopReason: null, error, usage: null, startupFailure };
}
/**
 * Normalize the ACP `usage` object into our {@link AcpTokenUsage}. Agents are
 * inconsistent about field names (camelCase vs snake_case, input vs prompt), so
 * read every known alias. Returns null when no token counts are present.
 */
function extractUsage(usage) {
    if (!usage || typeof usage !== 'object')
        return null;
    const record = usage;
    const num = (...keys) => {
        for (const key of keys) {
            const value = record[key];
            if (typeof value === 'number' && Number.isFinite(value))
                return value;
        }
        return null;
    };
    const input = num('inputTokens', 'input_tokens', 'promptTokens', 'prompt_tokens');
    const output = num('outputTokens', 'output_tokens', 'completionTokens', 'completion_tokens');
    let total = num('totalTokens', 'total_tokens');
    if (total == null && (input != null || output != null)) {
        total = (input ?? 0) + (output ?? 0);
    }
    if (input == null && output == null && total == null)
        return null;
    return { input, output, total };
}
exports.acpSessions = new AcpSessionManager();
//# sourceMappingURL=acp-session.js.map