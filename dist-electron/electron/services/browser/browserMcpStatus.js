"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkBrowserMcpConnection = checkBrowserMcpConnection;
const ws_1 = require("ws");
const DEFAULT_BROWSER_MCP_PORT = 9009;
const DEFAULT_WAIT_MS = 3_500;
function browserMcpPort() {
    const raw = process.env.ONE_MARKETING_TOOL_BROWSER_MCP_PORT?.trim();
    const parsed = raw ? Number(raw) : DEFAULT_BROWSER_MCP_PORT;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BROWSER_MCP_PORT;
}
/**
 * Best-effort check for whether the BrowserMCP Chrome extension is connected.
 *
 * The extension connects (as a WebSocket client) to a server on the BrowserMCP
 * port — hosted either by this app's BrowserMcpProvider or by an external
 * `@browsermcp/mcp` server. We can't observe a socket we don't own, so we probe:
 *
 *  - If the port is free, we briefly host a server. The extension auto-reconnects
 *    to any server that appears, so a connection within the window means the
 *    extension is installed and actively looking for a host → "connected".
 *    No connection in the window → "not-connected" (not installed / not pressed
 *    Connect).
 *  - If the port is already in use (EADDRINUSE), a BrowserMCP server is already
 *    running (the extension is talking to it, or the user's CLI started one) →
 *    "server-running"; we can't poke it without stealing its socket, so we report
 *    it as reachable but unverified.
 *
 * The probe server is closed immediately; the extension reconnects to the real
 * host on its own.
 */
function checkBrowserMcpConnection(waitMs = DEFAULT_WAIT_MS) {
    const port = browserMcpPort();
    return new Promise((resolve) => {
        let settled = false;
        const server = new ws_1.WebSocketServer({ port, host: '127.0.0.1' });
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            try {
                server.close();
            }
            catch {
                // already closing
            }
            resolve(result);
        };
        const timer = setTimeout(() => {
            finish({
                connected: false,
                status: 'not-connected',
                port,
                message: `No BrowserMCP extension is connected on port ${port}. In Chrome, open a tab, click the BrowserMCP toolbar icon, and press Connect.`,
            });
        }, waitMs);
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                finish({
                    connected: true,
                    status: 'server-running',
                    port,
                    message: `A BrowserMCP server is already running on port ${port} — the extension (or your CLI's BrowserMCP server) is using it.`,
                });
                return;
            }
            finish({
                connected: false,
                status: 'error',
                port,
                message: `Could not check BrowserMCP on port ${port}: ${error.message}`,
            });
        });
        server.on('connection', (socket) => {
            // The extension just connected to our probe. Close our side; it will
            // reconnect to the real BrowserMCP host on its own.
            try {
                socket.close();
            }
            catch {
                // ignore
            }
            finish({
                connected: true,
                status: 'connected',
                port,
                message: `BrowserMCP extension is connected on port ${port}.`,
            });
        });
    });
}
//# sourceMappingURL=browserMcpStatus.js.map