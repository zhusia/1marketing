"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderService = exports.RenderService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const id_1 = require("../utils/id");
const userDataPath_1 = require("../utils/userDataPath");
/**
 * Renders app-controlled HTML to a PNG using a hidden Chromium window — the same
 * engine the app already ships. No vector engine, no WASM. The window only ever
 * loads HTML we generate (never remote pages); all images are inlined as data URIs
 * by the caller, so `webSecurity` stays on and no external fetches happen.
 */
class RenderService {
    tempRoot() {
        const root = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), '.design-render');
        fs_1.default.mkdirSync(root, { recursive: true });
        return root;
    }
    async renderHtmlToPng(html, options) {
        const { width, height } = options;
        // A hidden, non-offscreen window renders and paints reliably; capturePage()
        // returns the content at the display's scale factor (often 2x on retina),
        // which we then resize down to the exact target — a free supersample.
        const win = new electron_1.BrowserWindow({
            width,
            height,
            useContentSize: true,
            show: false,
            frame: false,
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                backgroundThrottling: false,
            },
        });
        const tempFile = path_1.default.join(this.tempRoot(), `${(0, id_1.createId)()}.html`);
        try {
            await fs_1.default.promises.writeFile(tempFile, html, 'utf8');
            await win.loadFile(tempFile);
            // Let web fonts settle and give layout/paint a beat before capturing.
            await win.webContents
                .executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true')
                .catch(() => undefined);
            await delay(200);
            let image = await win.webContents.capturePage();
            const size = image.getSize();
            if (size.width !== width || size.height !== height) {
                image = image.resize({ width, height, quality: 'best' });
            }
            return image.toPNG();
        }
        finally {
            if (!win.isDestroyed())
                win.destroy();
            await fs_1.default.promises.rm(tempFile, { force: true }).catch(() => undefined);
        }
    }
    /**
     * Render to a PNG written under the design-render temp dir and return its path. Used by the
     * vision critique loop so a local CLI agent can open and look at its own render.
     */
    async renderHtmlToPngFile(html, options) {
        const png = await this.renderHtmlToPng(html, options);
        const file = path_1.default.join(this.tempRoot(), `${(0, id_1.createId)()}.png`);
        await fs_1.default.promises.writeFile(file, png);
        return { path: file };
    }
}
exports.RenderService = RenderService;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.renderService = new RenderService();
//# sourceMappingURL=RenderService.js.map