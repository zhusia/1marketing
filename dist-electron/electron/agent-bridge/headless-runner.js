"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAgentHeadlessInvocation = buildAgentHeadlessInvocation;
exports.pickAutoAgent = pickAutoAgent;
exports.configureAgentRunRecorder = configureAgentRunRecorder;
exports.runLocalChatAgent = runLocalChatAgent;
exports.stopChatAgentRun = stopChatAgentRun;
exports.disposeChatAgentSessions = disposeChatAgentSessions;
const fs_1 = __importDefault(require("fs"));
const agent_specs_1 = require("./agent-specs");
const launcher_1 = require("./launcher");
const cli_locator_1 = require("./cli-locator");
const acp_session_1 = require("./acp-session");
const aiResponse_1 = require("../utils/aiResponse");
const HEADLESS_MAX_OUTPUT_CHARS = 100_000;
function buildAgentHeadlessInvocation(agentId, prompt, extraFlags = []) {
    const spec = agent_specs_1.HEADLESS_SPECS[agentId];
    const flags = [...(spec.defaultFlags ?? []), ...extraFlags];
    const promptArg = spec.promptDelivery === 'stdin' ? spec.stdinPromptArg ?? '-' : prompt;
    if (spec.promptPosition === 'after-flag') {
        const args = [spec.headlessFlag, promptArg, ...flags];
        return spec.promptDelivery === 'stdin' ? { args, stdin: prompt } : { args };
    }
    const args = [spec.headlessFlag, ...flags, promptArg];
    return spec.promptDelivery === 'stdin' ? { args, stdin: prompt } : { args };
}
/** First detected agent in preference order, skipping `exclude`. */
function pickAutoAgent(agents, exclude) {
    for (const id of agent_specs_1.AUTO_AGENT_PREFERENCE) {
        if (id === exclude)
            continue;
        const agent = agents.find((candidate) => candidate.id === id);
        if (agent?.state === 'detected' && agent.path)
            return agent;
    }
    return null;
}
let agentRunRecorder = null;
/** Inject a recorder invoked after every agent run (used to persist AI logs). */
function configureAgentRunRecorder(recorder) {
    agentRunRecorder = recorder;
}
async function runLocalChatAgent(input, events = {}) {
    const result = normalizeReportedFailure(input, await executeLocalChatAgent(input, events));
    if (agentRunRecorder) {
        try {
            agentRunRecorder({ input, result });
        }
        catch (error) {
            console.error('[agent-bridge] run recorder failed', error);
        }
    }
    return result;
}
/**
 * A CLI process can exit successfully while its final stdout is a provider
 * failure. Normalize that false-success before recording or returning it so all
 * agent consumers (AIService, Prompt Explorer, media generation) see an error.
 */
function normalizeReportedFailure(input, result) {
    if (!result.ok)
        return result;
    const failure = (0, aiResponse_1.detectAiResponseFailure)(result.output);
    if (!failure)
        return result;
    const reportedAgentId = result.metadata.agentId ?? (input.agentId === 'auto' ? null : input.agentId);
    const label = reportedAgentId && (0, agent_specs_1.isSupportedChatAgent)(reportedAgentId)
        ? agent_specs_1.CHAT_AGENT_LABELS[reportedAgentId]
        : 'Local AI';
    return {
        ...result,
        ok: false,
        error: `${label} failed: ${failure}`,
    };
}
async function executeLocalChatAgent(input, events = {}) {
    const started = Date.now();
    if (input.agentId !== 'auto' && !(0, agent_specs_1.isSupportedChatAgent)(input.agentId)) {
        return buildRunFailure(input.agentId, `${input.agentId} is not supported by 1MarketingTool local AI.`, started);
    }
    const agents = await (0, cli_locator_1.locateChatAgents)();
    const requested = input.agentId === 'auto'
        ? null
        : agents.find((agent) => agent.id === input.agentId) ?? null;
    let chosen = requested && requested.state === 'detected' && requested.path ? requested : null;
    if (!chosen)
        chosen = pickAutoAgent(agents, requested?.id);
    if (!chosen) {
        const reason = requested
            ? `${requested.displayName} is unavailable (${requested.error ?? 'not found on this system'}) and no other local CLI was detected.`
            : 'No local CLI agents detected. Install Claude Code, OpenCode, or another supported CLI, then rescan.';
        return buildRunFailure(input.agentId, reason, started);
    }
    const fallbackFrom = requested && chosen.id !== requested.id ? requested.id : null;
    const agentId = chosen.id;
    const binaryPath = chosen.path;
    const timeoutSec = Math.max(30, Math.min(1800, Number(input.timeoutSec ?? 600)));
    const env = await (0, cli_locator_1.getAgentLaunchEnvironment)();
    if ((0, agent_specs_1.supportsAcp)(agentId)) {
        const acp = await acp_session_1.acpSessions.prompt({
            agentId,
            binaryPath,
            conversationId: input.conversationId ?? null,
            runId: input.runId ?? null,
            cwd: input.cwd,
            prompt: input.prompt,
            env,
            timeoutMs: timeoutSec * 1000,
            modelId: input.modelId ?? null,
            onChunk: events.onChunk,
        });
        if (acp.ok || !acp.startupFailure) {
            return {
                ok: acp.ok,
                output: acp.output.slice(0, HEADLESS_MAX_OUTPUT_CHARS),
                error: acp.error,
                metadata: {
                    exitCode: null,
                    signal: null,
                    stderr: acp.error ? `agent=${agentId}\npath=${binaryPath}\ntransport=acp\n${acp.error}` : null,
                    durationMs: Date.now() - started,
                    agentId,
                    fallbackFrom,
                    transport: 'acp',
                    tokensInput: acp.usage?.input ?? null,
                    tokensOutput: acp.usage?.output ?? null,
                    tokensTotal: acp.usage?.total ?? null,
                },
            };
        }
        // The session never started (spawn/init/auth) — try the plain headless
        // path once before reporting failure, and record both legs.
        const headless = await runHeadless(agentId, binaryPath, input, env, timeoutSec, started, events, fallbackFrom);
        headless.metadata.transport = 'headless-fallback';
        if (!headless.ok && acp.error) {
            headless.error = `${acp.error}\nHeadless fallback also failed: ${headless.error}`;
        }
        return headless;
    }
    return runHeadless(agentId, binaryPath, input, env, timeoutSec, started, events, fallbackFrom);
}
async function runHeadless(agentId, binaryPath, input, env, timeoutSec, started, events, fallbackFrom) {
    const cwd = input.cwd && fs_1.default.existsSync(input.cwd) && fs_1.default.statSync(input.cwd).isDirectory()
        ? input.cwd
        : undefined;
    const modelFlags = input.modelId ? agent_specs_1.AGENT_MODEL_FLAGS[agentId]?.(input.modelId) ?? [] : [];
    const invocation = buildAgentHeadlessInvocation(agentId, input.prompt, modelFlags);
    const launch = (0, launcher_1.prepareChatAgentLaunch)({
        binaryPath,
        args: invocation.args,
        env,
        platform: process.platform,
        nodeExecutable: process.execPath,
    });
    if (!launch.ok) {
        const failure = buildRunFailure(agentId, launch.error, started, { agentId, fallbackFrom });
        return { ...failure, metadata: { ...failure.metadata, transport: 'headless' } };
    }
    const result = await (0, launcher_1.spawnCapture)(launch.command, launch.args, {
        input: invocation.stdin,
        cwd,
        timeoutMs: timeoutSec * 1000,
        env: launch.env,
        onStdout: (chunk) => events.onChunk?.({ channel: 'message', text: chunk }),
        onStderr: (chunk) => {
            const text = chunk.trim();
            if (text)
                events.onChunk?.({ channel: 'tool', text });
        },
    });
    const stderr = result.stderr.trim();
    const output = result.stdout.trim();
    const ok = result.exitCode === 0 && !result.signal && !result.timedOut;
    return {
        ok,
        output: output.slice(0, HEADLESS_MAX_OUTPUT_CHARS),
        error: ok
            ? null
            : result.timedOut
                ? `${agent_specs_1.CHAT_AGENT_LABELS[agentId]} timed out after ${timeoutSec} seconds.`
                : stderr || `${agent_specs_1.CHAT_AGENT_LABELS[agentId]} exited with code ${result.exitCode ?? result.signal ?? 'unknown'}.`,
        metadata: {
            exitCode: result.exitCode,
            signal: result.signal,
            stderr: stderr
                ? [
                    `agent=${agentId}`,
                    `path=${binaryPath}`,
                    `launcher=${launch.mode}`,
                    stderr.slice(-2000),
                ].join('\n')
                : null,
            durationMs: Date.now() - started,
            agentId,
            fallbackFrom,
            transport: 'headless',
        },
    };
}
/** Cancels an in-flight ACP run. Headless runs finish or time out on their own. */
function stopChatAgentRun(runId) {
    return acp_session_1.acpSessions.cancelRun(runId);
}
function disposeChatAgentSessions() {
    acp_session_1.acpSessions.disposeAll();
}
function buildRunFailure(agentId, error, started, extra = {}) {
    return {
        ok: false,
        output: '',
        error,
        metadata: {
            exitCode: null,
            signal: null,
            stderr: `agent=${agentId}\n${error}`,
            durationMs: Date.now() - started,
            agentId: extra.agentId ?? null,
            fallbackFrom: extra.fallbackFrom ?? null,
        },
    };
}
//# sourceMappingURL=headless-runner.js.map