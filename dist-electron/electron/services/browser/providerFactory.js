"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BROWSER_ENGINE_SETTING = void 0;
exports.getPreferredBrowserEngine = getPreferredBrowserEngine;
exports.createBrowserProvider = createBrowserProvider;
const AppRepository_1 = require("../AppRepository");
const ElectronWindowProvider_1 = require("./ElectronWindowProvider");
const BrowserMcpProvider_1 = require("./BrowserMcpProvider");
exports.BROWSER_ENGINE_SETTING = 'automation.browserEngine';
/** Reads the user's preferred browser engine; defaults to the self-contained Electron window. */
function getPreferredBrowserEngine() {
    const envEngine = process.env.ONE_MARKETING_TOOL_BROWSER_ENGINE?.trim();
    if (envEngine === 'browser-mcp' || envEngine === 'electron-window') {
        return envEngine;
    }
    const setting = AppRepository_1.repository.getSetting(exports.BROWSER_ENGINE_SETTING);
    return setting?.value === 'browser-mcp' ? 'browser-mcp' : 'electron-window';
}
/**
 * Build a BrowserProvider for an automation flow. The Electron options describe
 * the self-contained window (session partition, title) used when the
 * electron-window engine is active. Pass `engineOverride` to force a specific
 * engine for this flow (e.g. a per-run SERP source choice) instead of using the
 * user's global browser-engine setting.
 */
function createBrowserProvider(electronOptions, engineOverride) {
    const engine = engineOverride ?? getPreferredBrowserEngine();
    if (engine === 'browser-mcp') {
        return new BrowserMcpProvider_1.BrowserMcpProvider();
    }
    return new ElectronWindowProvider_1.ElectronWindowProvider(electronOptions);
}
//# sourceMappingURL=providerFactory.js.map