"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserMcpProvider = void 0;
const node_crypto_1 = require("node:crypto");
const ws_1 = __importStar(require("ws"));
const DEFAULT_SNAPSHOT_CHARS = 24_000;
const DEFAULT_MAX_LINKS = 150;
const DEFAULT_BROWSER_MCP_PORT = 9009;
const CONNECT_TIMEOUT_MS = 45_000;
const BODY_SETTLE_MS = 1_000;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function browserMcpPort() {
    const raw = process.env.ONE_MARKETING_TOOL_BROWSER_MCP_PORT?.trim();
    const parsed = raw ? Number(raw) : DEFAULT_BROWSER_MCP_PORT;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BROWSER_MCP_PORT;
}
/**
 * Drives a real Chrome tab through the BrowserMCP extension protocol.
 *
 * The app hosts the same WebSocket bridge that BrowserMCP's MCP server uses
 * (default port 9009). The user installs BrowserMCP in Chrome, clicks the
 * extension icon, and connects the active tab to this app. All fill/click/type
 * actions then happen in Chrome via the extension, which avoids the Electron
 * BrowserWindow fingerprint that commonly traps Ahrefs Turnstile.
 */
class BrowserMcpProvider {
    id = 'browser-mcp';
    port = browserMcpPort();
    server = null;
    socket = null;
    url = null;
    refDescriptions = new Map();
    async open(url, _options) {
        this.url = url;
        await this.ensureServer();
        await this.waitForConnection(CONNECT_TIMEOUT_MS);
        await this.sendSocketMessage('browser_navigate', { url }, 45_000);
        await sleep(BODY_SETTLE_MS);
        this.url = await this.readCurrentUrl().catch(() => url);
    }
    async snapshot(options) {
        await this.ensureServer();
        await this.waitForConnection(CONNECT_TIMEOUT_MS);
        const maxChars = options?.maxChars ?? DEFAULT_SNAPSHOT_CHARS;
        const maxLinks = options?.maxLinks ?? DEFAULT_MAX_LINKS;
        const [url, title, rawSnapshot] = await Promise.all([
            this.readCurrentUrl().catch(() => this.url ?? ''),
            this.sendSocketMessage('getTitle', undefined, 10_000).catch(() => ''),
            this.sendSocketMessage('browser_snapshot', {}, 20_000),
        ]);
        const parsed = parseBrowserMcpSnapshot(String(rawSnapshot ?? ''), maxChars, maxLinks, Boolean(options?.includeControls));
        this.refDescriptions = parsed.refs;
        this.url = url || this.url;
        const pageSnapshot = {
            url: url || this.url || '',
            title: String(title ?? ''),
            text: parsed.text,
            links: parsed.links,
            controls: parsed.controls,
            buttons: parsed.buttons,
        };
        if (options?.screenshot) {
            const base64 = await this.sendSocketMessage('browser_screenshot', {}, 30_000).catch(() => null);
            if (base64) {
                pageSnapshot.screenshot = Buffer.from(base64.replace(/^data:image\/png;base64,/, ''), 'base64');
            }
        }
        return pageSnapshot;
    }
    async act(steps) {
        await this.ensureServer();
        await this.waitForConnection(CONNECT_TIMEOUT_MS);
        const results = [];
        for (const step of steps) {
            try {
                await this.runStep(step);
                results.push({ step, ok: true });
            }
            catch (error) {
                results.push({ step, ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return { ok: results.every((result) => result.ok), steps: results };
    }
    async isAuthenticated(signedOutSignals) {
        const snapshot = await this.snapshot({ maxChars: 6_000 });
        return !signedOutSignals.some((signal) => signal.test(snapshot.text));
    }
    currentUrl() {
        return this.url;
    }
    show() {
        // The browser window is the user's Chrome tab. BrowserMCP does not expose
        // a focus primitive, so the UI guides the user to keep the tab visible.
    }
    async close() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
            this.socket = null;
        }
        if (this.server) {
            const server = this.server;
            this.server = null;
            await new Promise((resolve) => {
                server.close(() => resolve());
            });
        }
        this.url = null;
        this.refDescriptions.clear();
    }
    async runStep(step) {
        if (step.action === 'wait') {
            await sleep(step.ms);
            return;
        }
        if (step.action === 'waitFor') {
            const deadline = Date.now() + (step.timeoutMs ?? 8_000);
            while (Date.now() < deadline) {
                const snapshot = await this.snapshot({ includeControls: true, maxChars: 10_000 });
                if (snapshot.controls.some((control) => control.selector === step.selector))
                    return;
                if (snapshot.buttons.some((button) => button.selector === step.selector))
                    return;
                await sleep(250);
            }
            throw new Error(`Timed out waiting for ${step.selector}`);
        }
        const ref = parseBrowserMcpRef(step.selector);
        if (!ref) {
            throw new Error(`BrowserMCP can only act on snapshot refs. Refresh the page snapshot before using ${step.selector}.`);
        }
        const element = this.refDescriptions.get(ref) ?? step.selector;
        if (step.action === 'fill') {
            await this.sendSocketMessage('browser_click', { element, ref }, 30_000).catch(() => undefined);
            await this.sendSocketMessage('browser_press_key', { key: 'ControlOrMeta+A' }, 10_000).catch(() => undefined);
            await this.sendSocketMessage('browser_press_key', { key: 'Backspace' }, 10_000).catch(() => undefined);
            await this.sendSocketMessage('browser_type', { element, ref, text: step.value, submit: false }, 30_000);
            return;
        }
        if (step.action === 'click') {
            await this.sendSocketMessage('browser_click', { element, ref }, 30_000);
            return;
        }
        if (step.action === 'select') {
            await this.sendSocketMessage('browser_select_option', { element, ref, values: [step.value] }, 30_000);
            return;
        }
        throw new Error(`Unknown action: ${step.action}`);
    }
    async ensureServer() {
        if (this.server)
            return;
        await new Promise((resolve, reject) => {
            const server = new ws_1.WebSocketServer({ port: this.port });
            const cleanup = () => {
                server.off('listening', onListening);
                server.off('error', onError);
            };
            const onListening = () => {
                cleanup();
                this.server = server;
                server.on('connection', (socket) => this.acceptSocket(socket));
                resolve();
            };
            const onError = (error) => {
                cleanup();
                reject(this.bridgeError(error));
            };
            server.once('listening', onListening);
            server.once('error', onError);
        });
    }
    acceptSocket(socket) {
        if (this.socket && this.socket.readyState === ws_1.default.OPEN) {
            this.socket.close();
        }
        this.socket = socket;
        socket.on('close', () => {
            if (this.socket === socket) {
                this.socket = null;
            }
        });
        socket.on('error', () => {
            if (this.socket === socket) {
                this.socket = null;
            }
        });
    }
    async waitForConnection(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (this.socket?.readyState === ws_1.default.OPEN)
                return;
            await sleep(250);
        }
        throw new Error(`BrowserMCP is not connected. Install the BrowserMCP Chrome extension, open a Chrome tab, click the BrowserMCP toolbar icon, and press Connect. ` +
            `1MarketingTool is listening on ws://127.0.0.1:${this.port}.`);
    }
    async readCurrentUrl() {
        const url = await this.sendSocketMessage('getUrl', undefined, 10_000);
        return String(url ?? '');
    }
    async sendSocketMessage(type, payload, timeoutMs) {
        await this.waitForConnection(1);
        const socket = this.socket;
        if (!socket || socket.readyState !== ws_1.default.OPEN) {
            throw new Error('BrowserMCP socket is not open.');
        }
        const id = (0, node_crypto_1.randomUUID)();
        const message = { id, type, payload };
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout);
                socket.off('message', onMessage);
                socket.off('error', onError);
                socket.off('close', onClose);
            };
            const onMessage = (data) => {
                let response;
                try {
                    response = JSON.parse(data.toString());
                }
                catch {
                    return;
                }
                if (response.type !== 'messageResponse' || response.payload?.requestId !== id)
                    return;
                cleanup();
                if (response.payload.error) {
                    reject(this.browserError(response.payload.error));
                }
                else {
                    resolve(response.payload.result);
                }
            };
            const onError = (error) => {
                cleanup();
                reject(this.browserError(error.message));
            };
            const onClose = () => {
                cleanup();
                reject(this.browserError('BrowserMCP socket closed.'));
            };
            const timeout = setTimeout(() => {
                cleanup();
                reject(this.browserError(`BrowserMCP response timeout after ${timeoutMs}ms.`));
            }, timeoutMs);
            socket.on('message', onMessage);
            socket.once('error', onError);
            socket.once('close', onClose);
            socket.send(JSON.stringify(message));
        });
    }
    bridgeError(error) {
        if (error.code === 'EADDRINUSE') {
            return new Error(`BrowserMCP port ${this.port} is already in use. Stop the other BrowserMCP server, or set ONE_MARKETING_TOOL_BROWSER_MCP_PORT before starting 1MarketingTool.`);
        }
        return error;
    }
    browserError(message) {
        if (/no tab is connected|no connection to browser extension/i.test(message)) {
            return new Error(`BrowserMCP is not connected. In Chrome, click the BrowserMCP extension icon and press Connect, then run Rank Automation again.`);
        }
        return new Error(message);
    }
}
exports.BrowserMcpProvider = BrowserMcpProvider;
function parseBrowserMcpRef(selector) {
    return selector.startsWith('mcp-ref:') ? selector.slice('mcp-ref:'.length) : null;
}
function parseBrowserMcpSnapshot(raw, maxChars, maxLinks, includeControls) {
    const links = [];
    const controls = [];
    const buttons = [];
    const refs = new Map();
    const textLines = [];
    const seenLinks = new Set();
    const seenRefs = new Set();
    for (const line of raw.split(/\r?\n/)) {
        const cleanedLine = cleanSnapshotLine(line);
        if (cleanedLine)
            textLines.push(cleanedLine);
        const refMatch = line.match(/\[ref=([^\]]+)\]/);
        if (!refMatch)
            continue;
        const ref = refMatch[1];
        const beforeRef = line.slice(0, refMatch.index).replace(/^\s*-\s*/, '').trim();
        const role = beforeRef.match(/^([a-z][a-z0-9 -]*)/i)?.[1]?.trim().toLowerCase() ?? '';
        const label = unescapeSnapshotLabel(beforeRef.match(/"((?:\\"|[^"])*)"/)?.[1] ?? '') || role;
        const selector = `mcp-ref:${ref}`;
        refs.set(ref, label);
        if (/^link\b/.test(role)) {
            const href = beforeRef.match(/\b(?:href|url)=["']?([^"'\s\]]+)/i)?.[1] ?? '';
            const key = `${label}|${href}`;
            if (href && !seenLinks.has(key) && links.length < maxLinks) {
                seenLinks.add(key);
                links.push({ text: label.slice(0, 200), href });
            }
            continue;
        }
        if (!includeControls || seenRefs.has(ref))
            continue;
        seenRefs.add(ref);
        if (/^(textbox|searchbox|combobox|spinbutton|textarea)\b/.test(role)) {
            controls.push({
                selector,
                tag: role === 'combobox' ? 'select' : role === 'textarea' ? 'textarea' : 'input',
                type: role === 'searchbox' ? 'search' : role === 'spinbutton' ? 'number' : null,
                name: null,
                id: null,
                placeholder: label || null,
                ariaLabel: label || null,
                label: label || null,
                required: /\brequired\b/i.test(beforeRef),
            });
            continue;
        }
        if (/^button\b/.test(role)) {
            buttons.push({ selector, text: label.slice(0, 120), type: null });
        }
    }
    const text = textLines.join('\n').slice(0, maxChars);
    return { text, links, controls, buttons, refs };
}
function cleanSnapshotLine(line) {
    return line
        .replace(/\[ref=[^\]]+\]/g, '')
        .replace(/^\s*-\s*/, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function unescapeSnapshotLabel(value) {
    return value.replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
}
//# sourceMappingURL=BrowserMcpProvider.js.map