"use strict";
/**
 * AiLogService — records a persistent entry for every AI tool / MCP / ACP call.
 *
 * Capture points wire into this service:
 *  - agent-bridge `runLocalChatAgent` (CLI/ACP agent runs) via an injected recorder.
 *  - the MCP bridge handlers, wrapped with `instrumentMcpHandlers` (agent `marketing-mcp`).
 *  - AIService direct BYOK provider calls.
 *
 * Recording is best-effort and never throws into the caller: a failed write must
 * not break an AI run.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiLogService = void 0;
exports.instrumentMcpHandlers = instrumentMcpHandlers;
const AppRepository_1 = require("./AppRepository");
const MAX_DETAIL_CHARS = 4000;
function truncate(value) {
    if (!value)
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    return trimmed.length > MAX_DETAIL_CHARS ? `${trimmed.slice(0, MAX_DETAIL_CHARS)}…` : trimmed;
}
class AiLogService {
    /** Persist a single AI/MCP/ACP log entry. Swallows errors. */
    record(input) {
        try {
            const normalized = normalizeAiLogInput(input);
            return AppRepository_1.repository.createAiLog({
                ...normalized,
                summary: normalized.summary.slice(0, 280),
                detail: truncate(normalized.detail),
            });
        }
        catch (error) {
            console.error('[ai-log] failed to record entry', error);
            return null;
        }
    }
}
function normalizeAiLogInput(input) {
    const transport = input.transport === 'byok' || input.agent.startsWith('byok:') ? 'byok' : input.transport ?? null;
    return {
        ...input,
        transport,
        agent: transport === 'byok' && input.agent.startsWith('byok:') ? 'BYOK' : input.agent,
    };
}
exports.aiLogService = new AiLogService();
/**
 * Wrap a bridge handler map so each MCP tool call is timed and recorded. The
 * returned object has the same shape and behaviour as the input; recording is a
 * transparent side effect that never alters the result or rethrows differently.
 *
 * Pass the handler interface as the type argument (e.g.
 * `instrumentMcpHandlers<MarketingBridgeHandlers>('marketing', { ... })`) so the handler
 * callbacks keep their contextual parameter types.
 */
function instrumentMcpHandlers(server, handlers) {
    const agent = `${server}-mcp`;
    const source = handlers;
    const wrapped = {};
    for (const tool of Object.keys(source)) {
        const fn = source[tool];
        wrapped[tool] = async (...args) => {
            const started = Date.now();
            try {
                const result = await fn(...args);
                exports.aiLogService.record({
                    kind: 'mcp',
                    agent,
                    tool,
                    transport: 'http',
                    status: 'success',
                    summary: `${agent} · ${tool}`,
                    durationMs: Date.now() - started,
                });
                return result;
            }
            catch (error) {
                exports.aiLogService.record({
                    kind: 'mcp',
                    agent,
                    tool,
                    transport: 'http',
                    status: 'error',
                    summary: `${agent} · ${tool} failed`,
                    detail: error instanceof Error ? error.message : String(error),
                    durationMs: Date.now() - started,
                });
                throw error;
            }
        };
    }
    return wrapped;
}
//# sourceMappingURL=AiLogService.js.map