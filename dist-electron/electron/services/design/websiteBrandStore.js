"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.websiteBrandStore = exports.WebsiteBrandStore = void 0;
exports.normalizeWebsiteBrandUrl = normalizeWebsiteBrandUrl;
exports.websiteBrandId = websiteBrandId;
exports.websiteBrandScreenshotPath = websiteBrandScreenshotPath;
exports.publicWebsiteBrand = publicWebsiteBrand;
/**
 * Local persistence for design systems captured from public websites.
 *
 * The renderer only receives safe metadata. The full design guide, CSS-token map,
 * and screenshot path stay in Electron main and are consumed by DesignService.
 */
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const userDataPath_1 = require("../../utils/userDataPath");
const STORE_FILE = 'website-brand-systems.json';
const SCREENSHOT_DIR = 'website-brands';
const HEX = /^#[0-9a-fA-F]{6}$/;
function storePath() {
    return path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), STORE_FILE);
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function normalizeWebsiteBrandUrl(input) {
    const raw = input.trim();
    const parsed = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Only public HTTP and HTTPS websites can be used as a brand reference.');
    }
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString();
}
function websiteBrandId(sourceUrl) {
    const url = new URL(normalizeWebsiteBrandUrl(sourceUrl));
    const host = url.hostname
        .toLowerCase()
        .replace(/^www\./, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 42) || 'website';
    const originHash = (0, crypto_1.createHash)('sha1').update(url.origin.toLowerCase()).digest('hex').slice(0, 8);
    return `website-${host}-${originHash}`;
}
function websiteBrandScreenshotPath(id) {
    const dir = path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), SCREENSHOT_DIR);
    fs_1.default.mkdirSync(dir, { recursive: true });
    return path_1.default.join(dir, `${id}.png`);
}
function cleanVars(value) {
    if (!isRecord(value))
        return {};
    const vars = {};
    for (const [name, raw] of Object.entries(value)) {
        if (!/^--[a-z0-9-]{1,60}$/i.test(name) || typeof raw !== 'string')
            continue;
        const token = raw.trim();
        if (token && token.length <= 160)
            vars[name] = token;
    }
    return vars;
}
function coerceSystem(value) {
    if (!isRecord(value))
        return null;
    try {
        const sourceUrl = normalizeWebsiteBrandUrl(typeof value.sourceUrl === 'string' ? value.sourceUrl : '');
        const id = typeof value.id === 'string' && value.id.trim()
            ? value.id.trim()
            : websiteBrandId(sourceUrl);
        const accentColor = typeof value.accentColor === 'string' && HEX.test(value.accentColor)
            ? value.accentColor.toLowerCase()
            : '#2563eb';
        const backgroundColor = typeof value.backgroundColor === 'string' && HEX.test(value.backgroundColor)
            ? value.backgroundColor.toLowerCase()
            : '#0b0b10';
        const spec = typeof value.spec === 'string' ? value.spec.trim() : '';
        if (!spec)
            return null;
        const now = Date.now();
        return {
            id,
            name: typeof value.name === 'string' && value.name.trim()
                ? value.name.trim().slice(0, 80)
                : new URL(sourceUrl).hostname,
            category: 'Website brand',
            summary: typeof value.summary === 'string' ? value.summary.trim().slice(0, 240) : '',
            accentColor,
            backgroundColor,
            source: 'website',
            sourceUrl,
            spec,
            vars: cleanVars(value.vars),
            referenceImagePath: typeof value.referenceImagePath === 'string' && value.referenceImagePath.trim()
                ? value.referenceImagePath.trim()
                : null,
            createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
            updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
        };
    }
    catch {
        return null;
    }
}
function publicWebsiteBrand(system) {
    return {
        id: system.id,
        name: system.name,
        category: system.category,
        summary: system.summary,
        accentColor: system.accentColor,
        backgroundColor: system.backgroundColor,
        source: 'website',
        sourceUrl: system.sourceUrl,
    };
}
class WebsiteBrandStore {
    cache = null;
    read() {
        if (this.cache)
            return this.cache;
        try {
            const raw = fs_1.default.readFileSync(storePath(), 'utf8');
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed)
                ? parsed
                : isRecord(parsed) && Array.isArray(parsed.systems)
                    ? parsed.systems
                    : [];
            this.cache = list.map(coerceSystem).filter((system) => Boolean(system));
        }
        catch {
            this.cache = [];
        }
        return this.cache;
    }
    write(systems) {
        this.cache = systems;
        fs_1.default.writeFileSync(storePath(), JSON.stringify({ version: 1, systems }, null, 2), 'utf8');
    }
    list() {
        return this.read().slice().sort((a, b) => b.updatedAt - a.updatedAt);
    }
    get(id) {
        return this.read().find((system) => system.id === id) ?? null;
    }
    getByUrl(sourceUrl) {
        try {
            const id = websiteBrandId(sourceUrl);
            return this.get(id);
        }
        catch {
            return null;
        }
    }
    upsert(input) {
        const sourceUrl = normalizeWebsiteBrandUrl(input.sourceUrl);
        const id = websiteBrandId(sourceUrl);
        const systems = this.read().slice();
        const existingIndex = systems.findIndex((system) => system.id === id);
        const existing = existingIndex >= 0 ? systems[existingIndex] : null;
        const now = Date.now();
        const system = {
            id,
            name: input.name.trim().slice(0, 80) || new URL(sourceUrl).hostname.replace(/^www\./, ''),
            category: 'Website brand',
            summary: input.summary.trim().slice(0, 240),
            accentColor: HEX.test(input.accentColor) ? input.accentColor.toLowerCase() : '#2563eb',
            backgroundColor: HEX.test(input.backgroundColor) ? input.backgroundColor.toLowerCase() : '#0b0b10',
            source: 'website',
            sourceUrl,
            spec: input.spec.trim(),
            vars: cleanVars(input.vars),
            referenceImagePath: input.referenceImagePath,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };
        if (!system.spec)
            throw new Error('The website brand capture did not produce a design guide.');
        if (existingIndex >= 0)
            systems[existingIndex] = system;
        else
            systems.push(system);
        this.write(systems);
        return system;
    }
}
exports.WebsiteBrandStore = WebsiteBrandStore;
exports.websiteBrandStore = new WebsiteBrandStore();
//# sourceMappingURL=websiteBrandStore.js.map