"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const stream_1 = require("stream");
const url_1 = require("url");
const electron_1 = require("electron");
const db_1 = require("./db");
const registerHandlers_1 = require("./ipc/registerHandlers");
const menu_1 = require("./menu");
const updater_1 = require("./updater");
const SchedulerService_1 = require("./services/SchedulerService");
const SyncLifecycleService_1 = require("./services/sync/SyncLifecycleService");
const NotificationService_1 = require("./services/NotificationService");
const bridge_1 = require("./mcp/bridge");
const setup_1 = require("./mcp/setup");
const RankAutomationService_1 = require("./services/RankAutomationService");
const AppRepository_1 = require("./services/AppRepository");
const BrowserExtensionService_1 = require("./services/BrowserExtensionService");
const GoogleWebmasterService_1 = require("./services/GoogleWebmasterService");
const ProductInfoService_1 = require("./services/ProductInfoService");
const WebsiteBrandService_1 = require("./services/design/WebsiteBrandService");
const PipelineService_1 = require("./services/PipelineService");
const AIService_1 = require("./services/AIService");
const VideoOrchestratorService_1 = require("./services/VideoOrchestratorService");
const MediaGenerationService_1 = require("./services/media-generation/MediaGenerationService");
const SeoDataService_1 = require("./services/seo/SeoDataService");
const agent_bridge_1 = require("./agent-bridge");
const AiLogService_1 = require("./services/AiLogService");
const analytics_1 = require("./analytics");
const LicenseService_1 = require("./services/LicenseService");
const entitlementGate_1 = require("./services/entitlement/entitlementGate");
const shadow_1 = require("./services/entitlement/shadow");
const userDataPath_1 = require("./utils/userDataPath");
let mainWindow = null;
let mcpBridge = null;
let entitlementGate = null;
let entitlementShadow = null;
let stopEntitlementShadow = null;
const APP_NAME = '1MarketingTool';
// Keep this in sync with build.appId in package.json. The NSIS installer assigns
// the same AUMID to its shortcuts so Windows can resolve the branded name and icon
// for native notifications instead of falling back to Electron's default identity.
const WINDOWS_APP_USER_MODEL_ID = 'com.stoicsoft.1marketingtool';
const isDev = !electron_1.app.isPackaged && process.env.NODE_ENV !== 'production';
const DEV_SERVER_CANDIDATES = ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175'];
const LOCAL_FILE_SCHEME = 'mt-local-file';
// Asset-library file types the local protocol may serve for in-app preview.
const LOCAL_FILE_MIME = {
    '.apng': 'image/apng', '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
    '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.pdf': 'application/pdf', '.md': 'text/markdown', '.mdx': 'text/markdown', '.txt': 'text/plain',
    '.csv': 'text/csv', '.json': 'application/json', '.rtf': 'application/rtf',
};
// Kinds that benefit from byte-range requests (seekable players).
const RANGE_EXTENSIONS = new Set([
    '.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
]);
const userDataArg = process.argv.find((value) => value.startsWith('--user-data-dir='));
const userDataDirOverride = process.env.ONE_MARKETING_TOOL_USER_DATA_DIR?.trim() ||
    userDataArg?.slice('--user-data-dir='.length).trim();
if (userDataDirOverride) {
    const userDataDir = path_1.default.resolve(userDataDirOverride);
    process.env.ONE_MARKETING_TOOL_USER_DATA_DIR = userDataDir;
    fs_1.default.mkdirSync(userDataDir, { recursive: true });
    electron_1.app.setPath('userData', userDataDir);
    console.log(`[main] Using userData override: ${userDataDir}`);
}
electron_1.app.setName(APP_NAME);
if (process.platform === 'win32') {
    electron_1.app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
}
(0, analytics_1.initAnalytics)();
electron_1.protocol.registerSchemesAsPrivileged([
    {
        scheme: LOCAL_FILE_SCHEME,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
        },
    },
]);
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function resolveAppIconPath() {
    const appPath = electron_1.app.getAppPath();
    const candidates = [
        path_1.default.join(appPath, 'public', 'logo.png'),
        path_1.default.join(appPath, 'dist-renderer', 'logo.png'),
        path_1.default.join(process.resourcesPath, 'dist-renderer', 'logo.png'),
        path_1.default.join(appPath, 'resources', 'icons', 'logo.png'),
        path_1.default.join(process.resourcesPath, 'resources', 'icons', 'logo.png'),
    ];
    return candidates.find((candidate) => fs_1.default.existsSync(candidate)) ?? candidates[0];
}
async function isUrlReachable(url) {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok || response.status < 500;
    }
    catch {
        return false;
    }
}
async function resolveRendererEntry() {
    if (isDev) {
        if (process.env.VITE_DEV_SERVER_URL) {
            return process.env.VITE_DEV_SERVER_URL;
        }
        for (let attempt = 0; attempt < 30; attempt += 1) {
            for (const candidate of DEV_SERVER_CANDIDATES) {
                if (await isUrlReachable(candidate)) {
                    return candidate;
                }
            }
            await wait(250);
        }
        return DEV_SERVER_CANDIDATES[0];
    }
    const appPath = electron_1.app.getAppPath();
    const candidates = [
        path_1.default.resolve(__dirname, '..', '..', 'dist-renderer', 'index.html'),
        path_1.default.join(appPath, 'dist-renderer', 'index.html'),
        path_1.default.join(process.resourcesPath, 'dist-renderer', 'index.html'),
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate)) {
            return candidate;
        }
    }
    return candidates[0];
}
async function createMainWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1500,
        height: 980,
        minWidth: 1180,
        minHeight: 760,
        title: APP_NAME,
        icon: resolveAppIconPath(),
        backgroundColor: '#0f1117',
        webPreferences: {
            preload: path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            devTools: true,
        },
    });
    const entry = await resolveRendererEntry();
    applyWindowSecurity(mainWindow, entry);
    if (entry.startsWith('http')) {
        await mainWindow.loadURL(entry);
    }
    else {
        await mainWindow.loadFile(entry);
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
/**
 * Lock the main window's trust boundary (security audit finding). The preload exposes `window.api`, so
 * if the privileged window ever navigated to attacker-controlled content, that page would inherit
 * IPC access to connector secrets and privileged actions. We keep the renderer pinned to the app's own
 * origin: block off-origin navigation, deny popups (links open in the OS browser instead), and — in
 * packaged builds — apply a Content-Security-Policy. SPA history navigation does not trigger these, so
 * the in-app router is unaffected.
 */
function applyWindowSecurity(win, entry) {
    const appOrigin = entry.startsWith('http') ? new URL(entry).origin : 'file://';
    const isAppUrl = (target) => {
        try {
            const u = new URL(target);
            if (u.protocol === 'file:' || u.protocol === `${LOCAL_FILE_SCHEME}:`)
                return true;
            return u.origin === appOrigin;
        }
        catch {
            return false;
        }
    };
    const openExternal = (target) => {
        if (/^https?:\/\//i.test(target))
            void electron_1.shell.openExternal(target);
    };
    win.webContents.on('will-navigate', (event, target) => {
        if (!isAppUrl(target)) {
            event.preventDefault();
            openExternal(target);
        }
    });
    win.webContents.on('will-redirect', (event, target) => {
        if (!isAppUrl(target))
            event.preventDefault();
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: 'deny' };
    });
    // CSP only in packaged builds — the Vite dev server needs inline/eval for HMR. 'unsafe-inline' stays
    // on script-src so the bundle's inline module-preload shim isn't blocked (a strict nonce would need a
    // build change); the high-value directives below (no remote script src, no plugins, no framing, no
    // base-tag hijack) still hold, and navigation is already pinned to the app origin above.
    if (electron_1.app.isPackaged) {
        win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': [
                        [
                            `default-src 'self' ${LOCAL_FILE_SCHEME}:`,
                            `script-src 'self' 'unsafe-inline'`,
                            `style-src 'self' 'unsafe-inline'`,
                            `img-src 'self' data: blob: https: ${LOCAL_FILE_SCHEME}:`,
                            `media-src 'self' data: blob: https: ${LOCAL_FILE_SCHEME}:`,
                            `font-src 'self' data:`,
                            `connect-src 'self' https: ${LOCAL_FILE_SCHEME}:`,
                            `object-src 'none'`,
                            `base-uri 'self'`,
                            `form-action 'self'`,
                            `frame-ancestors 'none'`,
                        ].join('; '),
                    ],
                },
            });
        });
    }
}
function registerLocalFileProtocol() {
    electron_1.protocol.handle(LOCAL_FILE_SCHEME, async (request) => {
        try {
            const schemePrefix = `${LOCAL_FILE_SCHEME}:`;
            const requestUrl = new URL(request.url);
            if (requestUrl.protocol !== schemePrefix) {
                return new Response('Unsupported local file scheme.', { status: 400 });
            }
            const fileUrl = new URL(`file:${request.url.slice(schemePrefix.length)}`);
            const filePath = (0, url_1.fileURLToPath)(fileUrl);
            const extension = path_1.default.extname(filePath).toLowerCase();
            const contentType = LOCAL_FILE_MIME[extension];
            if (!contentType) {
                return new Response('Unsupported local file type.', { status: 403 });
            }
            const stats = await fs_1.default.promises.stat(filePath);
            if (!stats.isFile()) {
                return new Response('Local file not found.', { status: 404 });
            }
            const total = stats.size;
            const rangeHeader = request.headers.get('Range');
            // Serve a byte range for seekable media (video/audio scrubbing requires 206 support).
            if (rangeHeader && RANGE_EXTENSIONS.has(extension)) {
                const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
                if (match) {
                    let start = match[1] ? Number(match[1]) : 0;
                    let end = match[2] ? Number(match[2]) : total - 1;
                    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
                        return new Response('Requested range not satisfiable.', {
                            status: 416,
                            headers: { 'Content-Range': `bytes */${total}` },
                        });
                    }
                    end = Math.min(end, total - 1);
                    start = Math.max(start, 0);
                    const stream = fs_1.default.createReadStream(filePath, { start, end });
                    return new Response(stream_1.Readable.toWeb(stream), {
                        status: 206,
                        headers: {
                            'Content-Type': contentType,
                            'Content-Length': String(end - start + 1),
                            'Content-Range': `bytes ${start}-${end}/${total}`,
                            'Accept-Ranges': 'bytes',
                        },
                    });
                }
            }
            // Stream the whole file (no buffering into memory) with an explicit content type.
            const stream = fs_1.default.createReadStream(filePath);
            return new Response(stream_1.Readable.toWeb(stream), {
                status: 200,
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': String(total),
                    'Accept-Ranges': RANGE_EXTENSIONS.has(extension) ? 'bytes' : 'none',
                },
            });
        }
        catch {
            return new Response('Local file unavailable.', { status: 404 });
        }
    });
}
function isClaudeMcpEnabledFromSettings() {
    const setting = AppRepository_1.repository.getSetting('mcpCliIntegrations');
    if (!setting || !setting.value || typeof setting.value !== 'object') {
        return true;
    }
    const value = setting.value.claudeCodeCli;
    return typeof value === 'boolean' ? value : true;
}
const CONTENT_TYPES = [
    'changelog',
    'blog',
    'tweet_thread',
    'linkedin',
    'reddit',
    'video_short',
    'video_long',
];
const CONTENT_STATUSES = ['pending', 'approved', 'scheduled', 'published', 'archived'];
function isContentType(value) {
    return typeof value === 'string' && CONTENT_TYPES.includes(value);
}
function contentStatus(value) {
    return typeof value === 'string' && CONTENT_STATUSES.includes(value)
        ? value
        : undefined;
}
function normalizeContentTypeList(value) {
    const source = Array.isArray(value) ? value : [];
    return Array.from(new Set(source.filter(isContentType)));
}
function normalizeLanguageList(value) {
    const source = Array.isArray(value) ? value : [];
    const languages = source
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => /^[a-z]{2}(?:-[a-z]{2})?$/.test(item));
    return Array.from(new Set(languages)).slice(0, 4);
}
function normalizeAgentId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function boundedLimit(value, fallback = 25) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(1, Math.min(100, Math.floor(value)))
        : fallback;
}
let servicesCleanedUp = false;
let cleanupPromise = null;
function cleanupServices() {
    if (cleanupPromise)
        return cleanupPromise;
    servicesCleanedUp = true;
    cleanupPromise = (async () => {
        try {
            (0, agent_bridge_1.disposeChatAgentSessions)();
            stopEntitlementShadow?.();
            stopEntitlementShadow = null;
            mcpBridge?.stop();
            BrowserExtensionService_1.browserExtensionService.stop();
            NotificationService_1.notificationService.stop();
            SchedulerService_1.schedulerService.stop();
            await SyncLifecycleService_1.syncLifecycleService.stop();
        }
        finally {
            MediaGenerationService_1.mediaGenerationService.dispose();
            (0, db_1.closeDatabase)();
        }
    })();
    return cleanupPromise;
}
const singleInstance = process.env.ONE_MARKETING_TOOL_DISABLE_SINGLE_INSTANCE === '1' || electron_1.app.requestSingleInstanceLock();
if (!singleInstance) {
    electron_1.app.quit();
}
electron_1.app.whenReady().then(() => {
    (0, db_1.initDatabase)();
    const recoveredMediaJobs = MediaGenerationService_1.mediaGenerationService.recoverInterruptedJobs();
    if (recoveredMediaJobs)
        console.warn(`[media-generation] Resumed ${recoveredMediaJobs} interrupted job(s).`);
    const recoveredVideoRuns = VideoOrchestratorService_1.videoOrchestratorService.recoverInterruptedRuns();
    if (recoveredVideoRuns)
        console.warn(`[video] Marked ${recoveredVideoRuns} interrupted run(s) as failed.`);
    (0, analytics_1.setAnalyticsConsentReader)(() => (AppRepository_1.repository.getSetting('telemetryConsentShown')?.value === true &&
        AppRepository_1.repository.getSetting('telemetryOptIn')?.value === true));
    registerLocalFileProtocol();
    (0, agent_bridge_1.configureAcpRuntime)({
        mcpServers: (agentId) => (0, setup_1.getAcpMcpServerSpecs)(agentId),
    });
    (0, agent_bridge_1.configureAgentRunRecorder)(({ input, result }) => {
        const agentName = result.metadata.agentId ?? (input.agentId === 'auto' ? 'auto' : input.agentId);
        const tool = input.runId ? input.runId.split(':')[0] : null;
        AiLogService_1.aiLogService.record({
            kind: 'agent',
            agent: String(agentName),
            tool,
            transport: result.metadata.transport ?? null,
            status: result.ok ? 'success' : 'error',
            summary: result.ok
                ? `${agentName} returned ${result.output.length.toLocaleString()} chars`
                : `${agentName} run failed`,
            detail: result.ok ? null : result.error ?? result.metadata.stderr,
            durationMs: result.metadata.durationMs,
            exitCode: result.metadata.exitCode,
            tokens: result.metadata.tokensTotal ?? null,
            tokensInput: result.metadata.tokensInput ?? null,
            tokensOutput: result.metadata.tokensOutput ?? null,
        });
    });
    (0, registerHandlers_1.registerHandlers)();
    // Entitlement GATE (vendored from 1DevTool, docs/improve_cheat_key.md §6 P2 + §8):
    // when the flip (ENTITLEMENT_GATE_ENABLED) is on, the cryptographic verdict
    // overrides the legacy `isLicensed` boolean for Pro. Currently DORMANT
    // (shadow-first) — the gate evaluates but returns the legacy boolean verbatim.
    // Fail-safe (any error → legacy boolean), session-latched (never downgrades a
    // running session), 14-day migration grace. Kill-switch:
    // ONEMARKETINGTOOL_DISABLE_ENTITLEMENT_GATE=1.
    if (!entitlementGate) {
        entitlementGate = (0, entitlementGate_1.createEntitlementGate)({
            // Same dir as license.json (resolveUserDataPath honors the dev/test
            // override, unlike a raw app.getPath('userData') read).
            userDataDir: (0, userDataPath_1.resolveUserDataPath)(),
            getRawLicense: () => LicenseService_1.licenseService.getRawLicenseSnapshot(),
        });
        LicenseService_1.licenseService.setEntitlementEvaluator(() => entitlementGate.getDecision(), 
        // License-mutation refresh: activation re-evaluates immediately (fresh Pro
        // must not hide behind the boot latch); deactivation also drops the latch.
        (opts) => {
            try {
                if (opts?.resetLatch)
                    entitlementGate.resetLatch();
                else
                    entitlementGate.evaluate();
            }
            catch (error) {
                console.warn('[entitlement] gate refresh on license mutation failed', error);
            }
        });
        // Latch the boot verdict from the cached entitlement before any renderer read.
        entitlementGate.evaluate();
    }
    // Entitlement SHADOW runner: exchanges the stored license for a signed
    // entitlement, verifies with the embedded public key, caches, and logs — while
    // the gate is dormant its verdict is observe-only telemetry. Each pass
    // re-evaluates the gate so that once the flip lands, a successful migration
    // exchange upgrades free→Pro live; the latch blocks any downgrade until next
    // boot. Kill-switch: ONEMARKETINGTOOL_DISABLE_ENTITLEMENT_SHADOW=1.
    if (!entitlementShadow) {
        entitlementShadow = (0, shadow_1.createEntitlementShadow)({
            userDataDir: (0, userDataPath_1.resolveUserDataPath)(),
            getLicense: () => LicenseService_1.licenseService.getRawLicenseSnapshot(),
            onPass: () => {
                try {
                    entitlementGate?.evaluate();
                    LicenseService_1.licenseService.notifyLicenseChanged();
                }
                catch (error) {
                    console.warn('[entitlement] gate re-eval after pass failed', error);
                }
            },
        });
        stopEntitlementShadow = entitlementShadow.start();
    }
    (0, updater_1.setupUpdater)({
        // Read fresh on every update event so an activation/expiry or a settings
        // change gates the background auto-download with no restart (§12.4/§12.5).
        getLicenseInfo: () => LicenseService_1.licenseService.getLicenseInfo(),
        getUpdatePreferences: () => {
            const raw = AppRepository_1.repository.getSetting('updates.preferences')?.value;
            return {
                autoDownload: typeof raw?.autoDownload === 'boolean' ? raw.autoDownload : true,
                autoInstallOnQuit: typeof raw?.autoInstallOnQuit === 'boolean' ? raw.autoInstallOnQuit : true,
            };
        },
    });
    (0, updater_1.setupUpdaterIpcHandlers)();
    BrowserExtensionService_1.browserExtensionService.start();
    // Subscribe the alert inbox to its sinks before the scheduler can run anything worth alerting on.
    NotificationService_1.notificationService.start();
    SchedulerService_1.schedulerService.start();
    SyncLifecycleService_1.syncLifecycleService.start();
    electron_1.app.on('browser-window-focus', () => SyncLifecycleService_1.syncLifecycleService.onAppFocus());
    // Start the MCP bridge used by the standalone MCP server process.
    mcpBridge = new bridge_1.MarketingMcpBridge((0, AiLogService_1.instrumentMcpHandlers)('marketing', {
        getProducts: () => Promise.resolve(AppRepository_1.repository.listProducts()),
        checkDomain: (params) => RankAutomationService_1.rankAutomationService.checkSingleDomain(params.domain),
        listSnapshots: (params) => Promise.resolve(AppRepository_1.repository.listDomainAuthority(params.productId, params.limit ?? 100)),
        listAlerts: (params) => Promise.resolve(AppRepository_1.repository.listRankAlerts(params.productId)),
        runAutomation: async (params) => {
            RankAutomationService_1.rankAutomationService.start(params.productId);
            return { started: true };
        },
        keywordOverview: (params) => SeoDataService_1.seoDataService.keywordOverview(params.keywords ?? [], params.location),
        keywordIdeas: (params) => SeoDataService_1.seoDataService.keywordIdeas(params.seed ?? '', params.location),
        rankedKeywords: (params) => SeoDataService_1.seoDataService.rankedKeywords(params.domain ?? '', params.location),
        serpPosition: (params) => SeoDataService_1.seoDataService.serpPosition(params.keyword ?? '', params.domain ?? '', params.location),
        fetchProductInfo: (params) => ProductInfoService_1.productInfoService.fetchInfo(params.url),
        getWebsiteBrand: (params) => WebsiteBrandService_1.websiteBrandService.capture(params.url, { agentId: params.agentId ?? null }),
        getGoogleAccount: () => Promise.resolve(GoogleWebmasterService_1.googleWebmasterService.getSavedAccount()),
        listCaptures: (params) => Promise.resolve(BrowserExtensionService_1.browserExtensionService.listCaptures(params.productId, params.limit ?? 20)),
        runGoogleWebmasterAutomation: async (params) => {
            await BrowserExtensionService_1.browserExtensionService.runGoogleWebmasterAutomation(params.productId, params.mode ?? 'headed');
            return { started: true };
        },
        listContent: (params) => Promise.resolve(AppRepository_1.repository
            .listContent({ productId: params.productId, status: contentStatus(params.status) })
            .slice(0, boundedLimit(params.limit))),
        generateCampaign: async (params) => {
            if (!params.productId || !params.sourceText?.trim()) {
                throw new Error('productId and sourceText are required.');
            }
            const requestedContentTypes = normalizeContentTypeList(params.contentTypes);
            const contentTypes = requestedContentTypes.length ? requestedContentTypes : normalizeContentTypeList(params.channels);
            const languages = normalizeLanguageList(params.languages);
            const agentId = normalizeAgentId(params.agentId) ?? normalizeAgentId(params.localAgentId);
            const payload = {
                sourceMode: params.sourceMode ?? 'paste',
                sourceChannel: params.sourceChannel,
                sourceTitle: params.sourceTitle?.trim() || 'MCP campaign source',
                sourceText: params.sourceText.trim(),
                detectedType: params.detectedType ?? 'campaign brief',
                contentTypes: contentTypes.length ? contentTypes : undefined,
                channels: contentTypes.length ? contentTypes : undefined,
                languages: languages.length ? languages : ['en'],
                agentId,
                featureSummary: params.sourceText.trim(),
            };
            const result = await PipelineService_1.pipelineService.runPipeline('P1', {
                productId: params.productId,
                trigger: 'content_mcp',
                payload,
            });
            const contentItems = AppRepository_1.repository.listContent({ productId: params.productId }).filter((item) => item.runId === result.run.id);
            return { ...result, contentItems };
        },
        writePiece: async (params) => {
            if (!params.productId || !isContentType(params.type) || !params.title?.trim() || !params.content?.trim()) {
                throw new Error('productId, valid type, title, and content are required.');
            }
            const product = AppRepository_1.repository.getProduct(params.productId);
            if (!product)
                throw new Error('Product not found.');
            const run = AppRepository_1.repository.createPipelineRun({
                productId: params.productId,
                pipelineType: 'P1',
                trigger: 'content_mcp_write',
                input: {
                    type: params.type,
                    title: params.title,
                    language: params.language,
                    sourceTitle: params.sourceTitle,
                },
            });
            const contentItem = AppRepository_1.repository.createContent({
                productId: params.productId,
                runId: run.id,
                type: params.type,
                title: params.title.trim(),
                content: params.content.trim(),
                status: 'pending',
                metadata: {
                    provider: 'mcp',
                    language: params.language,
                    sourceTitle: params.sourceTitle,
                    trigger: 'content_mcp_write',
                },
            });
            const completedRun = AppRepository_1.repository.completePipelineRun({
                runId: run.id,
                status: 'completed',
                output: {
                    createdContentItems: 1,
                    contentId: contentItem.id,
                    notes: ['Content piece written by MCP client.'],
                },
            });
            return { run: completedRun ?? run, contentItem };
        },
        localAiStatus: () => AIService_1.aiService.getLocalStatus(),
        listPipelines: () => Promise.resolve(VideoOrchestratorService_1.videoOrchestratorService.listPipelines()),
        getRun: async (params) => {
            const run = params.runId
                ? VideoOrchestratorService_1.videoOrchestratorService.getRun(params.runId)
                : params.storyboardId
                    ? VideoOrchestratorService_1.videoOrchestratorService.getRunForStoryboard(params.storyboardId)
                    : null;
            if (!run)
                throw new Error('Video run not found.');
            if (!params.productId || run.storyboard.productId !== params.productId) {
                throw new Error('The video run is outside the requested project scope.');
            }
            return run;
        },
        writeStoryboard: async (params) => {
            const input = params;
            if (!input.productId || !AppRepository_1.repository.getProduct(input.productId))
                throw new Error('A valid productId is required.');
            return VideoOrchestratorService_1.videoOrchestratorService.writeStoryboard({ ...input, autoRun: false });
        },
        applyCommand: (params) => VideoOrchestratorService_1.videoOrchestratorService.applyCommand({
            productId: params.productId,
            storyboardId: params.storyboardId,
            revision: params.revision,
            command: params.command,
        }),
        compose: async (params) => {
            const run = VideoOrchestratorService_1.videoOrchestratorService.getRun(params.runId);
            if (!run)
                throw new Error('Video run not found.');
            if (run.storyboard.productId !== params.productId)
                throw new Error('The video run is outside the requested project scope.');
            if (run.pendingGate !== 'assets')
                throw new Error('Human approval must advance this run to the Assets gate before MCP compose.');
            return VideoOrchestratorService_1.videoOrchestratorService.resolveGate({
                runId: params.runId,
                gate: 'assets',
                revision: params.revision,
                action: 'approve',
            });
        },
    }));
    mcpBridge
        .start()
        .then((port) => {
        console.log(`[mcp] Bridge started on port ${port}`);
        if (!isClaudeMcpEnabledFromSettings()) {
            (0, setup_1.removeMarketingMcp)();
            console.log('[mcp] Claude Code MCP auto-setup skipped (disabled in settings).');
            return;
        }
        const result = (0, setup_1.setupMarketingMcp)();
        if (!result.ok)
            console.warn(`[mcp] Auto-setup failed: ${result.error}`);
    })
        .catch((error) => {
        console.warn('[mcp] Bridge start failed:', error);
    });
    (0, menu_1.createApplicationMenu)();
    void createMainWindow();
    // Auto-check for updates shortly after launch (packaged builds only). Any available
    // update is pushed to the renderer over the updater status channel.
    if (electron_1.app.isPackaged) {
        setTimeout(() => (0, updater_1.checkForUpdatesInBackground)(), 8000);
    }
    (0, analytics_1.trackEvent)('app_started', {
        version: electron_1.app.getVersion(),
        platform: process.platform,
        arch: process.arch,
    });
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            void createMainWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', (event) => {
    if (servicesCleanedUp)
        return;
    event.preventDefault();
    (0, analytics_1.trackEvent)('app_quit');
    void cleanupServices().finally(() => electron_1.app.quit());
});
process.on('SIGINT', () => {
    void cleanupServices().finally(() => {
        electron_1.app.quit();
        process.exit(0);
    });
});
process.on('SIGTERM', () => {
    void cleanupServices().finally(() => {
        electron_1.app.quit();
        process.exit(0);
    });
});
process.on('exit', () => {
    if (!servicesCleanedUp)
        void cleanupServices();
});
//# sourceMappingURL=main.js.map