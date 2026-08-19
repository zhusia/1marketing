"use strict";
/**
 * Auto-configure the bundled MCP server in AI CLI tools.
 * On app startup, writes the MCP config so Claude Code / Codex / Gemini can discover and
 * use 1MarketingTool's tools. Writing also removes every legacy per-group entry, so an
 * upgrade collapses the old four-server layout into the single `onemarketingtool` entry.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMcpServerScriptPath = getMcpServerScriptPath;
exports.getMcpRuntimeCommand = getMcpRuntimeCommand;
exports.getMcpNodeModulesPath = getMcpNodeModulesPath;
exports.setupMarketingMcp = setupMarketingMcp;
exports.getMarketingMcpConfigJson = getMarketingMcpConfigJson;
exports.getAcpMcpServerSpecs = getAcpMcpServerSpecs;
exports.removeMarketingMcp = removeMarketingMcp;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const electron_1 = require("electron");
const mcp_names_1 = require("../mcp-names");
function getHomeDir() {
    return os_1.default.homedir();
}
function getMcpServerScriptPath() {
    if (electron_1.app.isPackaged) {
        return path_1.default.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron', 'electron', 'mcp', 'server.js');
    }
    return path_1.default.join(electron_1.app.getAppPath(), 'dist-electron', 'electron', 'mcp', 'server.js');
}
function getMcpRuntimeCommand() {
    if (electron_1.app.isPackaged && process.platform === 'linux' && process.env.APPIMAGE) {
        return process.env.APPIMAGE;
    }
    return process.execPath;
}
function getMcpNodeModulesPath() {
    if (electron_1.app.isPackaged) {
        return path_1.default.join(process.resourcesPath, 'app.asar', 'node_modules');
    }
    return path_1.default.join(electron_1.app.getAppPath(), 'node_modules');
}
function buildMarketingMcpConfig() {
    return {
        command: getMcpRuntimeCommand(),
        args: [getMcpServerScriptPath()],
        env: {
            ELECTRON_RUN_AS_NODE: '1',
            NODE_PATH: getMcpNodeModulesPath(),
            NODE_OPTIONS: '--max-old-space-size=64',
        },
    };
}
function getClaudeConfigPath() {
    return path_1.default.join(getHomeDir(), '.claude.json');
}
function setupMarketingMcp() {
    const serverPath = getMcpServerScriptPath();
    const configPath = getClaudeConfigPath();
    const homeDir = getHomeDir();
    const diagnostics = {
        platform: process.platform,
        homeDir,
        configPath,
        serverPath,
        serverExists: false,
        configExists: false,
        configWritable: false,
        nodeVersion: process.version,
        isPackaged: electron_1.app.isPackaged,
    };
    try {
        diagnostics.serverExists = fs_1.default.existsSync(serverPath);
        diagnostics.configExists = fs_1.default.existsSync(configPath);
        try {
            fs_1.default.accessSync(path_1.default.dirname(configPath), fs_1.default.constants.W_OK);
            diagnostics.configWritable = true;
        }
        catch {
            diagnostics.configWritable = false;
        }
        if (!diagnostics.serverExists) {
            const error = `MCP server script not found at: ${serverPath}`;
            console.error(`[mcp-setup] ${error}`);
            return { ok: false, error, diagnostics };
        }
        if (!diagnostics.configWritable) {
            const error = `No write permission to config directory: ${path_1.default.dirname(configPath)}`;
            console.error(`[mcp-setup] ${error}`);
            return { ok: false, error, diagnostics };
        }
        let config = {};
        if (diagnostics.configExists) {
            const raw = fs_1.default.readFileSync(configPath, 'utf-8');
            try {
                config = JSON.parse(raw);
            }
            catch (parseErr) {
                const error = `Failed to parse ${configPath}: ${parseErr instanceof Error ? parseErr.message : parseErr}`;
                console.error(`[mcp-setup] ${error}`);
                return { ok: false, error, diagnostics };
            }
        }
        const mcpServers = (config.mcpServers ?? {});
        (0, mcp_names_1.deleteManagedMarketingMcpEntries)(mcpServers);
        mcpServers[mcp_names_1.MARKETING_MCP_SERVER_NAME] = buildMarketingMcpConfig();
        config.mcpServers = mcpServers;
        fs_1.default.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        console.log(`[mcp-setup] Configured Claude Code MCP → ${serverPath}`);
        return { ok: true, diagnostics };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn('[mcp-setup] Failed to configure Claude Code:', error);
        return { ok: false, error: message, diagnostics };
    }
}
function getMarketingMcpConfigJson() {
    return JSON.stringify({ [mcp_names_1.MARKETING_MCP_SERVER_NAME]: buildMarketingMcpConfig() }, null, 2);
}
function getAcpMcpServerSpecs(_agentId) {
    return [
        {
            name: mcp_names_1.MARKETING_MCP_SERVER_NAME,
            command: getMcpRuntimeCommand(),
            args: [getMcpServerScriptPath()],
            env: [
                { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
                { name: 'NODE_PATH', value: getMcpNodeModulesPath() },
                { name: 'NODE_OPTIONS', value: '--max-old-space-size=64' },
            ],
        },
    ];
}
function removeMarketingMcp() {
    try {
        const configPath = getClaudeConfigPath();
        if (!fs_1.default.existsSync(configPath))
            return;
        const config = JSON.parse(fs_1.default.readFileSync(configPath, 'utf-8'));
        const mcpServers = config.mcpServers;
        if (mcpServers) {
            (0, mcp_names_1.deleteManagedMarketingMcpEntries)(mcpServers);
            config.mcpServers = mcpServers;
            fs_1.default.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
        }
    }
    catch {
        // Non-fatal
    }
}
//# sourceMappingURL=setup.js.map