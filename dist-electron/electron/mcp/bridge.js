"use strict";
/**
 * 1MarketingTool MCP Bridge — local HTTP server in the Electron main process.
 *
 * The bundled MCP server process (spawned by a CLI agent over stdio) proxies every tool
 * call here, so tools run against the same service singletons the UI uses. One bridge
 * serves every tool group; before the merge each group had its own bridge and port file.
 *
 * Binds to 127.0.0.1 only — never exposed to the network.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketingMcpBridge = exports.MCP_BRIDGE_PORT_FILE = void 0;
const http_1 = __importDefault(require("http"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
exports.MCP_BRIDGE_PORT_FILE = 'mcp-bridge-port';
/** Port files written by the pre-merge per-group bridges. Removed on start so a stale one
 *  cannot point an old server binary at a port this app no longer listens on. */
const LEGACY_PORT_FILES = [
    'rank-mcp-bridge-port',
    'browser-mcp-bridge-port',
    'content-mcp-bridge-port',
    'video-mcp-bridge-port',
];
class MarketingMcpBridge {
    server = null;
    port = 0;
    routes;
    constructor(handlers) {
        this.routes = {
            '/get-products': () => handlers.getProducts(),
            '/rank/check-domain': (params) => handlers.checkDomain(params),
            '/rank/list-snapshots': (params) => handlers.listSnapshots(params),
            '/rank/list-alerts': (params) => handlers.listAlerts(params),
            '/rank/run-automation': (params) => handlers.runAutomation(params),
            '/keywords/overview': (params) => handlers.keywordOverview(params),
            '/keywords/ideas': (params) => handlers.keywordIdeas(params),
            '/keywords/ranked': (params) => handlers.rankedKeywords(params),
            '/keywords/serp-position': (params) => handlers.serpPosition(params),
            '/content/list': (params) => handlers.listContent(params),
            '/content/generate-campaign': (params) => handlers.generateCampaign(params),
            '/content/write-piece': (params) => handlers.writePiece(params),
            '/content/local-ai-status': () => handlers.localAiStatus(),
            '/video/pipelines': () => handlers.listPipelines(),
            '/video/get': (params) => handlers.getRun(params),
            '/video/write': (params) => handlers.writeStoryboard(params),
            '/video/command': (params) => handlers.applyCommand(params),
            '/video/compose': (params) => handlers.compose(params),
            '/browser/fetch-product-info': (params) => handlers.fetchProductInfo(params),
            '/browser/get-website-brand': (params) => handlers.getWebsiteBrand(params),
            '/browser/google-account': () => handlers.getGoogleAccount(),
            '/browser/list-captures': (params) => handlers.listCaptures(params),
            '/browser/run-google-webmaster-automation': (params) => handlers.runGoogleWebmasterAutomation(params),
        };
    }
    async start() {
        return new Promise((resolve, reject) => {
            this.server = http_1.default.createServer(async (req, res) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/json');
                if (req.method === 'OPTIONS') {
                    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                    res.writeHead(200);
                    res.end();
                    return;
                }
                try {
                    const body = await readBody(req);
                    const params = body ? JSON.parse(body) : {};
                    const url = req.url ?? '/';
                    if (url === '/health') {
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, service: 'onemarketingtool-bridge' }));
                        return;
                    }
                    const route = this.routes[url];
                    if (!route || req.method !== 'POST') {
                        res.writeHead(404);
                        res.end(JSON.stringify({ error: 'Not found' }));
                        return;
                    }
                    const result = await route(params);
                    res.writeHead(200);
                    res.end(JSON.stringify(result));
                }
                catch (error) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }));
                }
            });
            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server.address();
                if (typeof addr === 'object' && addr) {
                    this.port = addr.port;
                    this.writePortFile();
                    console.log(`[mcp-bridge] Listening on http://127.0.0.1:${this.port}`);
                    resolve(this.port);
                }
                else {
                    reject(new Error('Failed to get MCP bridge port'));
                }
            });
            this.server.on('error', reject);
        });
    }
    stop() {
        this.server?.close();
        this.server = null;
        removePortFile(exports.MCP_BRIDGE_PORT_FILE);
    }
    getPort() {
        return this.port;
    }
    writePortFile() {
        try {
            const dir = path_1.default.join(os_1.default.homedir(), '.1marketingtool');
            if (!fs_1.default.existsSync(dir))
                fs_1.default.mkdirSync(dir, { recursive: true });
            fs_1.default.writeFileSync(path_1.default.join(dir, exports.MCP_BRIDGE_PORT_FILE), String(this.port), 'utf-8');
            for (const name of LEGACY_PORT_FILES)
                removePortFile(name);
        }
        catch {
            // Non-fatal
        }
    }
}
exports.MarketingMcpBridge = MarketingMcpBridge;
function removePortFile(name) {
    try {
        fs_1.default.unlinkSync(path_1.default.join(os_1.default.homedir(), '.1marketingtool', name));
    }
    catch {
        // Non-fatal
    }
}
function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', () => resolve(''));
    });
}
//# sourceMappingURL=bridge.js.map