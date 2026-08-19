"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureAcpRuntime = exports.stopChatAgentRun = exports.runLocalChatAgent = exports.pickAutoAgent = exports.disposeChatAgentSessions = exports.configureAgentRunRecorder = exports.buildAgentHeadlessInvocation = exports.prepareChatAgentLaunch = exports.parseWindowsShimScriptPath = exports.parseWindowsNpmShim = exports.createChatAgentEnvironment = exports.isSupportedChatAgent = exports.CHAT_AGENT_LABELS = exports.CHAT_AGENT_IDS = exports.AUTO_AGENT_PREFERENCE = void 0;
exports.listLocalChatAgents = listLocalChatAgents;
const cli_locator_1 = require("./cli-locator");
var agent_specs_1 = require("./agent-specs");
Object.defineProperty(exports, "AUTO_AGENT_PREFERENCE", { enumerable: true, get: function () { return agent_specs_1.AUTO_AGENT_PREFERENCE; } });
Object.defineProperty(exports, "CHAT_AGENT_IDS", { enumerable: true, get: function () { return agent_specs_1.CHAT_AGENT_IDS; } });
Object.defineProperty(exports, "CHAT_AGENT_LABELS", { enumerable: true, get: function () { return agent_specs_1.CHAT_AGENT_LABELS; } });
Object.defineProperty(exports, "isSupportedChatAgent", { enumerable: true, get: function () { return agent_specs_1.isSupportedChatAgent; } });
var launcher_1 = require("./launcher");
Object.defineProperty(exports, "createChatAgentEnvironment", { enumerable: true, get: function () { return launcher_1.createChatAgentEnvironment; } });
Object.defineProperty(exports, "parseWindowsNpmShim", { enumerable: true, get: function () { return launcher_1.parseWindowsNpmShim; } });
Object.defineProperty(exports, "parseWindowsShimScriptPath", { enumerable: true, get: function () { return launcher_1.parseWindowsShimScriptPath; } });
Object.defineProperty(exports, "prepareChatAgentLaunch", { enumerable: true, get: function () { return launcher_1.prepareChatAgentLaunch; } });
var headless_runner_1 = require("./headless-runner");
Object.defineProperty(exports, "buildAgentHeadlessInvocation", { enumerable: true, get: function () { return headless_runner_1.buildAgentHeadlessInvocation; } });
Object.defineProperty(exports, "configureAgentRunRecorder", { enumerable: true, get: function () { return headless_runner_1.configureAgentRunRecorder; } });
Object.defineProperty(exports, "disposeChatAgentSessions", { enumerable: true, get: function () { return headless_runner_1.disposeChatAgentSessions; } });
Object.defineProperty(exports, "pickAutoAgent", { enumerable: true, get: function () { return headless_runner_1.pickAutoAgent; } });
Object.defineProperty(exports, "runLocalChatAgent", { enumerable: true, get: function () { return headless_runner_1.runLocalChatAgent; } });
Object.defineProperty(exports, "stopChatAgentRun", { enumerable: true, get: function () { return headless_runner_1.stopChatAgentRun; } });
var acp_session_1 = require("./acp-session");
Object.defineProperty(exports, "configureAcpRuntime", { enumerable: true, get: function () { return acp_session_1.configureAcpRuntime; } });
async function listLocalChatAgents(opts = {}) {
    return (0, cli_locator_1.locateChatAgents)({ force: opts.force });
}
//# sourceMappingURL=index.js.map