"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BODY_FONT_IDS = exports.DISPLAY_FONT_IDS = void 0;
exports.getBundledFont = getBundledFont;
exports.resolveFont = resolveFont;
exports.fontStack = fontStack;
exports.fontFaceCss = fontFaceCss;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const FONTS = [
    { id: 'Inter', file: 'Inter.woff2', weight: '100 900', role: 'body', fallback: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
    { id: 'Space Grotesk', file: 'SpaceGrotesk.woff2', weight: '300 700', role: 'display', fallback: 'system-ui, sans-serif' },
    { id: 'Archivo Black', file: 'ArchivoBlack.woff2', weight: '100 900', role: 'display', fallback: 'Impact, "Arial Black", system-ui, sans-serif' },
    { id: 'Fraunces', file: 'Fraunces.woff2', weight: '100 900', role: 'display', fallback: 'Georgia, Cambria, "Times New Roman", serif' },
    { id: 'JetBrains Mono', file: 'JetBrainsMono.woff2', weight: '100 800', role: 'mono', fallback: 'ui-monospace, Menlo, Consolas, monospace' },
];
const BY_ID = new Map(FONTS.map((font) => [font.id, font]));
/** Family ids the design agent may pick for the display + body slots. */
exports.DISPLAY_FONT_IDS = FONTS.filter((f) => f.role === 'display').map((f) => f.id);
exports.BODY_FONT_IDS = FONTS.filter((f) => f.role !== 'display').map((f) => f.id);
/**
 * Map common (often non-bundleable) family names to the closest bundled face, so a design
 * system's `--font-display: 'Arial Black, Impact'` still resolves to a real, shipped font.
 */
const ALIASES = [
    { match: /archivo black|arial black|impact|anton|haettenschweiler|league gothic|bebas|oswald|black$/i, id: 'Archivo Black' },
    { match: /fraunces|playfair|georgia|times|garamond|merriweather|lora|spectral|dm serif|serif/i, id: 'Fraunces' },
    { match: /jetbrains|sf mono|ui-monospace|menlo|monaco|consolas|courier|roboto mono|plex mono|fira code|source code|mono/i, id: 'JetBrains Mono' },
    { match: /space grotesk|grotesk|satoshi|general sans|clash|cabinet|sora|manrope|poppins|dm sans|outfit|sohne|söhne/i, id: 'Space Grotesk' },
    { match: /inter|geist|system-ui|-apple-system|segoe|helvetica|arial|roboto|sf pro|sans-serif/i, id: 'Inter' },
];
function getBundledFont(id) {
    return id ? BY_ID.get(id) ?? null : null;
}
/** Resolve a CSS font-family token (e.g. `'Arial Black, Impact, sans-serif'`) to a bundled face. */
function resolveFont(familyToken, role) {
    if (!familyToken)
        return null;
    const names = familyToken.split(',').map((part) => part.replace(/["']/g, '').trim()).filter(Boolean);
    for (const name of names) {
        const direct = BY_ID.get(name);
        if (direct && (!role || direct.role === role))
            return direct;
        const alias = ALIASES.find((entry) => entry.match.test(name));
        if (alias) {
            const font = BY_ID.get(alias.id);
            if (!role || font.role === role || role === 'display')
                return font;
        }
    }
    return null;
}
/** Full CSS font stack: bundled family first, then its system fallbacks. */
function fontStack(font, fallback = 'system-ui, sans-serif') {
    if (!font)
        return fallback;
    return `'${font.id}', ${font.fallback}`;
}
// --- inlining --------------------------------------------------------------
let fontsDir;
const dataUriCache = new Map();
function resolveFontsDir() {
    if (fontsDir !== undefined)
        return fontsDir;
    const candidates = [
        path_1.default.join(electron_1.app.getAppPath(), 'resources', 'fonts'),
        path_1.default.join(process.resourcesPath ?? '', 'resources', 'fonts'),
        path_1.default.resolve(process.cwd(), 'resources', 'fonts'),
    ];
    fontsDir = candidates.find((dir) => dir && fs_1.default.existsSync(dir)) ?? null;
    return fontsDir;
}
function dataUri(file) {
    if (dataUriCache.has(file))
        return dataUriCache.get(file);
    const dir = resolveFontsDir();
    let uri = null;
    if (dir) {
        try {
            const bytes = fs_1.default.readFileSync(path_1.default.join(dir, file));
            uri = `data:font/woff2;base64,${bytes.toString('base64')}`;
        }
        catch {
            uri = null;
        }
    }
    dataUriCache.set(file, uri);
    return uri;
}
/** Emit `@font-face` rules (inlined base64) for the given bundled families, de-duplicated. */
function fontFaceCss(fonts) {
    const seen = new Set();
    const rules = [];
    for (const font of fonts) {
        if (!font || seen.has(font.id))
            continue;
        seen.add(font.id);
        const uri = dataUri(font.file);
        if (!uri)
            continue;
        rules.push(`@font-face{font-family:'${font.id}';font-style:normal;font-weight:${font.weight};` +
            `font-display:block;src:url('${uri}') format('woff2');}`);
    }
    return rules.join('\n');
}
//# sourceMappingURL=fonts.js.map