"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writingStyleStore = exports.WritingStyleStore = void 0;
/**
 * Persistence for user-generated "Writing Style Mimic" skills.
 *
 * Built-in agent skills live in the static electron/data/seoSkills.ts module, but
 * mimic skills are created by the user at runtime, so they need a writable store.
 * They are kept as a single JSON file under userData (survives restarts, easy to
 * inspect/back up) rather than a DB table to keep the feature self-contained.
 * SkillsService merges these into its list()/install() so they behave like any
 * other writing skill in Settings and New Campaign.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const id_1 = require("../../utils/id");
const userDataPath_1 = require("../../utils/userDataPath");
const FILE_NAME = 'writing-style-skills.json';
function storeFilePath() {
    return path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), FILE_NAME);
}
function slugify(value) {
    return value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function coerceSkill(value) {
    if (!isRecord(value))
        return null;
    const id = typeof value.id === 'string' && value.id.trim() ? value.id : (0, id_1.createId)();
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    const body = typeof value.body === 'string' ? value.body.trim() : '';
    if (!name || !body)
        return null;
    const sources = Array.isArray(value.sources)
        ? value.sources.map((entry) => String(entry).trim()).filter(Boolean)
        : [];
    const now = Date.now();
    return {
        id,
        name,
        title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : name,
        description: typeof value.description === 'string' ? value.description.trim() : '',
        body,
        sources,
        sampleChars: typeof value.sampleChars === 'number' && Number.isFinite(value.sampleChars) ? value.sampleChars : 0,
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : now,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : now,
    };
}
class WritingStyleStore {
    cache = null;
    read() {
        if (this.cache)
            return this.cache;
        let skills = [];
        try {
            const raw = fs_1.default.readFileSync(storeFilePath(), 'utf8');
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed)
                ? parsed
                : isRecord(parsed) && Array.isArray(parsed.skills)
                    ? parsed.skills
                    : [];
            skills = list.map(coerceSkill).filter((skill) => Boolean(skill));
        }
        catch {
            // Missing/corrupt file → start empty. Never throw on read.
            skills = [];
        }
        this.cache = skills;
        return skills;
    }
    write(skills) {
        this.cache = skills;
        const filePath = storeFilePath();
        fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
        fs_1.default.writeFileSync(filePath, JSON.stringify(skills, null, 2), 'utf8');
    }
    list() {
        return this.read().slice().sort((a, b) => b.updatedAt - a.updatedAt);
    }
    get(id) {
        return this.read().find((skill) => skill.id === id) ?? null;
    }
    /** Reserved built-in names that a user skill must not collide with. */
    ensureUniqueName(desired, reservedNames, excludeId) {
        const base = slugify(desired) || 'writing-style';
        const taken = new Set(reservedNames);
        for (const skill of this.read()) {
            if (excludeId && skill.id === excludeId)
                continue;
            taken.add(skill.name);
        }
        if (!taken.has(base))
            return base;
        for (let i = 2; i < 1000; i += 1) {
            const candidate = `${base}-${i}`;
            if (!taken.has(candidate))
                return candidate;
        }
        return `${base}-${(0, id_1.createId)().slice(0, 6)}`;
    }
    upsert(input, reservedNames = new Set()) {
        const title = input.title.trim() || input.name.trim() || 'Custom writing style';
        const body = input.body.trim();
        if (!body)
            throw new Error('A writing-style skill needs a non-empty body.');
        const skills = this.read().slice();
        const now = Date.now();
        const existingIndex = input.id ? skills.findIndex((skill) => skill.id === input.id) : -1;
        if (existingIndex >= 0) {
            const existing = skills[existingIndex];
            const nameSource = input.name.trim() || title;
            const name = this.ensureUniqueName(nameSource, reservedNames, existing.id);
            const updated = {
                ...existing,
                name,
                title,
                description: input.description.trim(),
                body,
                sources: input.sources ?? existing.sources,
                sampleChars: input.sampleChars ?? existing.sampleChars,
                updatedAt: now,
            };
            skills[existingIndex] = updated;
            this.write(skills);
            return updated;
        }
        const nameSource = input.name.trim() || title;
        const created = {
            id: (0, id_1.createId)(),
            name: this.ensureUniqueName(nameSource, reservedNames),
            title,
            description: input.description.trim(),
            body,
            sources: input.sources ?? [],
            sampleChars: input.sampleChars ?? 0,
            createdAt: now,
            updatedAt: now,
        };
        skills.push(created);
        this.write(skills);
        return created;
    }
    remove(id) {
        const skills = this.read();
        const target = skills.find((skill) => skill.id === id);
        if (!target)
            return { removed: false, name: null };
        this.write(skills.filter((skill) => skill.id !== id));
        return { removed: true, name: target.name };
    }
}
exports.WritingStyleStore = WritingStyleStore;
exports.writingStyleStore = new WritingStyleStore();
//# sourceMappingURL=writingStyleStore.js.map