"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TOKEN_VARS = void 0;
exports.listDesignSystems = listDesignSystems;
exports.getDesignSystem = getDesignSystem;
exports.getDesignTokens = getDesignTokens;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const websiteBrandStore_1 = require("./websiteBrandStore");
/**
 * Neutral, premium fallback scaffold used when no design system is selected (Templates mode,
 * or an AI brief without a style). Mirrors the open-design token schema so a real system can
 * override any subset; values not present in a system inherit from here.
 */
exports.DEFAULT_TOKEN_VARS = {
    '--bg': '#0b0b10',
    '--surface': '#15151c',
    '--surface-warm': '#1c1c26',
    '--fg': '#ffffff',
    '--fg-2': '#c7c7d1',
    '--muted': '#8a8a99',
    '--meta': '#6b6b78',
    '--border': '#2a2a38',
    '--border-soft': '#1e1e29',
    '--accent': '#6750a4',
    '--accent-on': '#ffffff',
    '--accent-hover': 'color-mix(in oklab, var(--accent), black 8%)',
    '--accent-active': 'color-mix(in oklab, var(--accent), black 14%)',
    '--success': '#16a34a',
    '--warn': '#d97706',
    '--danger': '#dc2626',
    '--font-display': "'Space Grotesk'",
    '--font-body': "'Inter'",
    '--font-mono': "'JetBrains Mono'",
    '--leading-body': '1.5',
    '--leading-tight': '1.05',
    '--tracking-display': '-0.025em',
    '--radius-sm': '6px',
    '--radius-md': '12px',
    '--radius-lg': '20px',
    '--radius-pill': '9999px',
    '--elev-flat': 'none',
    '--elev-ring': '0 0 0 1px var(--border)',
    '--elev-raised': '0 30px 80px rgba(0,0,0,.45)',
};
let cache = null;
const tokensCache = new Map();
/** Resolve the vendored content dir across dev (repo root) and packaged (asar) layouts. */
function systemsRoot() {
    const candidates = [
        path_1.default.join(electron_1.app.getAppPath(), 'resources', 'design-systems'),
        path_1.default.join(process.resourcesPath ?? '', 'resources', 'design-systems'),
        path_1.default.resolve(process.cwd(), 'resources', 'design-systems'),
    ];
    for (const dir of candidates) {
        if (dir && fs_1.default.existsSync(dir) && fs_1.default.statSync(dir).isDirectory())
            return dir;
    }
    return null;
}
const HEX = /^#[0-9a-fA-F]{6}$/;
function tokenColor(tokens, names, fallback) {
    const list = tokens?.tokens;
    if (!Array.isArray(list))
        return fallback;
    for (const name of names) {
        const hit = list.find((entry) => entry?.name === name);
        const value = typeof hit?.value === 'string' ? hit.value.trim() : '';
        if (HEX.test(value))
            return value;
    }
    return fallback;
}
/** Flatten the token export into a `--name` → value map for :root injection. */
function tokenVars(tokens) {
    const list = tokens?.tokens;
    const out = {};
    if (!Array.isArray(list))
        return out;
    for (const entry of list) {
        const name = typeof entry?.name === 'string' ? entry.name.trim() : '';
        const value = typeof entry?.value === 'string' ? entry.value.trim() : '';
        if (name.startsWith('--') && value)
            out[name] = value;
    }
    return out;
}
/** Parse the DESIGN.md header: `# Design System Inspired by X`, `> Category:`, summary line. */
function parseHeader(id, md) {
    const title = md.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
    const name = (title?.replace(/^Design System Inspired by\s+/i, '') || id).trim();
    const category = md.match(/^>\s*Category:\s*(.+?)\s*$/m)?.[1]?.trim() || 'Aesthetic';
    const quotes = [...md.matchAll(/^>\s*(.+?)\s*$/gm)].map((m) => m[1].trim());
    const summary = quotes.find((line) => !/^Category:/i.test(line)) || '';
    return { name, category, summary };
}
function load() {
    if (cache)
        return cache;
    const root = systemsRoot();
    if (!root) {
        cache = [];
        return cache;
    }
    const out = [];
    for (const id of fs_1.default.readdirSync(root).sort()) {
        const dir = path_1.default.join(root, id);
        const designMd = path_1.default.join(dir, 'DESIGN.md');
        if (!fs_1.default.existsSync(designMd) || !fs_1.default.statSync(dir).isDirectory())
            continue;
        try {
            const spec = fs_1.default.readFileSync(designMd, 'utf8');
            const { name, category, summary } = parseHeader(id, spec);
            let tokens = null;
            const tokensPath = path_1.default.join(dir, 'design-tokens.json');
            if (fs_1.default.existsSync(tokensPath)) {
                tokens = JSON.parse(fs_1.default.readFileSync(tokensPath, 'utf8'));
            }
            const accentRaw = tokenColor(tokens, ['--accent', '--primary'], '#6750a4');
            // Many systems set --accent to near-black; keep it as the seed but it is only
            // a fallback — the agent still picks a vivid accentColor per brief.
            out.push({
                id,
                name,
                category,
                summary,
                accentColor: accentRaw,
                backgroundColor: tokenColor(tokens, ['--bg', '--surface', '--background'], '#0b0b0f'),
                source: 'bundled',
                sourceUrl: null,
                spec,
                vars: tokenVars(tokens),
                referenceImagePath: null,
            });
        }
        catch {
            // skip a malformed system rather than failing the whole list
        }
    }
    cache = out;
    return cache;
}
/** Public, renderer-safe metadata for captured website systems plus bundled presets. */
function listDesignSystems() {
    const website = websiteBrandStore_1.websiteBrandStore.list().map(websiteBrandStore_1.publicWebsiteBrand);
    const bundled = load().map(({ spec: _spec, vars: _vars, referenceImagePath: _referenceImagePath, ...info }) => info);
    return [...website, ...bundled];
}
/** Full record (including prompt spec/tokens/reference) for one system, or null. */
function getDesignSystem(id) {
    if (!id)
        return null;
    const website = websiteBrandStore_1.websiteBrandStore.get(id);
    if (website)
        return website;
    return load().find((system) => system.id === id) ?? null;
}
function v(vars, name, fallback) {
    const value = vars[name];
    return typeof value === 'string' && value ? value : fallback;
}
function hex(vars, name, fallback) {
    const value = vars[name];
    return typeof value === 'string' && HEX.test(value) ? value : fallback;
}
function num(vars, name, fallback) {
    const parsed = Number.parseFloat(vars[name] ?? '');
    return Number.isFinite(parsed) ? parsed : fallback;
}
function normalizeTokens(id, vars) {
    return {
        id,
        vars,
        palette: {
            bg: hex(vars, '--bg', '#0b0b10'),
            surface: hex(vars, '--surface', '#15151c'),
            surfaceWarm: hex(vars, '--surface-warm', '#1c1c26'),
            fg: hex(vars, '--fg', '#ffffff'),
            fg2: hex(vars, '--fg-2', '#c7c7d1'),
            muted: hex(vars, '--muted', '#8a8a99'),
            border: hex(vars, '--border', '#2a2a38'),
            accent: hex(vars, '--accent', '#6750a4'),
            accentOn: hex(vars, '--accent-on', '#ffffff'),
            success: hex(vars, '--success', '#16a34a'),
            warn: hex(vars, '--warn', '#d97706'),
            danger: hex(vars, '--danger', '#dc2626'),
        },
        fonts: {
            display: v(vars, '--font-display', "'Space Grotesk'"),
            body: v(vars, '--font-body', "'Inter'"),
            mono: v(vars, '--font-mono', "'JetBrains Mono'"),
        },
        tracking: v(vars, '--tracking-display', '-0.025em'),
        leading: { body: num(vars, '--leading-body', 1.5), tight: num(vars, '--leading-tight', 1.05) },
        radius: {
            sm: v(vars, '--radius-sm', '6px'),
            md: v(vars, '--radius-md', '12px'),
            lg: v(vars, '--radius-lg', '20px'),
            pill: v(vars, '--radius-pill', '9999px'),
        },
        elevation: {
            flat: v(vars, '--elev-flat', 'none'),
            ring: v(vars, '--elev-ring', '0 0 0 1px var(--border)'),
            raised: v(vars, '--elev-raised', '0 30px 80px rgba(0,0,0,.45)'),
        },
    };
}
/**
 * Resolve the full token scaffold for a design system id (or the neutral default when unset),
 * with any tokens the system omits inherited from {@link DEFAULT_TOKEN_VARS}. The render kit
 * injects `tokens.vars` into `:root` and reasons over the typed roles.
 */
function getDesignTokens(id) {
    const website = id ? websiteBrandStore_1.websiteBrandStore.get(id) : null;
    if (website) {
        return normalizeTokens(website.id, { ...exports.DEFAULT_TOKEN_VARS, ...website.vars });
    }
    const key = id ?? '__default__';
    const cached = tokensCache.get(key);
    if (cached)
        return cached;
    const system = id ? getDesignSystem(id) : null;
    const vars = { ...exports.DEFAULT_TOKEN_VARS, ...(system?.vars ?? {}) };
    const tokens = normalizeTokens(system?.id ?? null, vars);
    tokensCache.set(key, tokens);
    return tokens;
}
//# sourceMappingURL=designSystems.js.map