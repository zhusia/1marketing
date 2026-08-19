"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.skillsService = exports.SkillsService = void 0;
/**
 * Installs the agent-skill pack (electron/data/seoSkills.ts) into a CLI
 * agent's skills directory as `<dir>/<name>/SKILL.md` files.
 *
 * The pack is shipped as a TS data module (no asset/asar path resolution), so
 * install is a pure file write triggered explicitly from Settings -> MCP.
 */
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const seoSkills_1 = require("../data/seoSkills");
const agent_bridge_1 = require("../agent-bridge");
const writingStyleStore_1 = require("./seo/writingStyleStore");
const SKILL_TARGET_IDS = ['claude', 'codex', 'gemini', 'opencode', 'amp', 'qwen', 'hermes', 'aider', 'grok'];
const TARGET_DIRS = {
    claude: () => path_1.default.join(os_1.default.homedir(), '.claude', 'skills'),
    codex: () => path_1.default.join((process.env.CODEX_HOME || '').trim() || path_1.default.join(os_1.default.homedir(), '.codex'), 'skills'),
    gemini: () => path_1.default.join((process.env.GEMINI_HOME || '').trim() || path_1.default.join(os_1.default.homedir(), '.gemini'), 'skills'),
    opencode: () => path_1.default.join(os_1.default.homedir(), '.opencode', 'skills'),
    amp: () => path_1.default.join(os_1.default.homedir(), '.amp', 'skills'),
    qwen: () => path_1.default.join(os_1.default.homedir(), '.qwen', 'skills'),
    hermes: () => path_1.default.join((process.env.HERMES_HOME || '').trim() || path_1.default.join(os_1.default.homedir(), '.hermes'), 'skills'),
    aider: () => path_1.default.join(os_1.default.homedir(), '.aider', 'skills'),
    grok: () => path_1.default.join(os_1.default.homedir(), '.grok', 'skills'),
};
function isSkillTargetId(value) {
    return SKILL_TARGET_IDS.includes(value);
}
function targetDir(targetId) {
    return TARGET_DIRS[targetId]();
}
function skillFilePath(dir, name) {
    return path_1.default.join(dir, name, 'SKILL.md');
}
function frontmatterBlock(value) {
    return value.split(/\r?\n/).map((line) => `  ${line}`).join('\n');
}
function renderSkill(skill, targetId) {
    return [
        '---',
        `name: ${skill.name}`,
        'description: |',
        frontmatterBlock(skill.description),
        `tool: ${targetId}`,
        `category: ${skill.type}`,
        'user_invocable: false',
        'metadata:',
        `  source: ${skill.source === 'user' ? '1MarketingTool-user' : '1MarketingTool'}`,
        '  version: 1',
        '---',
        '',
        '<!-- This file is auto-managed by 1MarketingTool. Edits may be overwritten by reinstall. -->',
        '',
        skill.body,
        '',
    ].join('\n');
}
/** Built-in pack plus user-created writing-style skills, surfaced as one unified list. */
function allSkills() {
    const builtin = seoSkills_1.AGENT_SKILLS.map((skill) => ({
        name: skill.name,
        type: skill.type,
        title: skill.title,
        description: skill.description,
        body: skill.body,
        source: 'builtin',
    }));
    const user = writingStyleStore_1.writingStyleStore.list().map((skill) => ({
        id: skill.id,
        name: skill.name,
        type: 'writing',
        title: skill.title,
        description: skill.description,
        body: skill.body,
        source: 'user',
    }));
    return [...user, ...builtin];
}
function installedCount(dir, skills) {
    return skills.filter((skill) => fs_1.default.existsSync(skillFilePath(dir, skill.name))).length;
}
class SkillsService {
    list() {
        return allSkills();
    }
    async status() {
        const skills = allSkills();
        const agents = await (0, agent_bridge_1.listLocalChatAgents)();
        const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
        const targets = SKILL_TARGET_IDS.map((id) => {
            const agent = agentsById.get(id);
            const dir = targetDir(id);
            return {
                id,
                label: agent_bridge_1.CHAT_AGENT_LABELS[id],
                dir,
                detected: agent?.state === 'detected',
                installedCount: installedCount(dir, skills),
                total: skills.length,
                version: agent?.version ?? null,
                path: agent?.path ?? null,
                error: agent?.error ?? null,
            };
        });
        const legacy = targets.find((target) => target.id === 'claude') ?? targets[0];
        return {
            dir: legacy.dir,
            installedCount: legacy.installedCount,
            total: skills.length,
            detectedCount: targets.filter((target) => target.detected).length,
            targets,
        };
    }
    async install(input = {}) {
        const rawTargetIds = Array.isArray(input.targetIds) ? input.targetIds : [];
        const requestedIds = Array.from(new Set(rawTargetIds));
        const invalid = requestedIds.find((id) => !isSkillTargetId(id));
        if (invalid)
            throw new Error(`Unsupported CLI target: ${invalid}`);
        const status = await this.status();
        const targetIds = requestedIds.length > 0
            ? requestedIds
            : status.targets.filter((target) => target.detected).map((target) => target.id);
        const targets = targetIds
            .map((id) => status.targets.find((target) => target.id === id))
            .filter((target) => Boolean(target));
        if (targets.length === 0) {
            throw new Error('No detected CLI targets. Install a supported CLI, rescan, then try again.');
        }
        const missing = targets.filter((target) => !target.detected);
        if (missing.length > 0) {
            throw new Error(`CLI target not detected: ${missing.map((target) => target.label).join(', ')}`);
        }
        const skills = allSkills();
        const results = targets.map((target) => {
            fs_1.default.mkdirSync(target.dir, { recursive: true });
            const installed = [];
            for (const skill of skills) {
                const skillDir = path_1.default.join(target.dir, skill.name);
                fs_1.default.mkdirSync(skillDir, { recursive: true });
                fs_1.default.writeFileSync(skillFilePath(target.dir, skill.name), renderSkill(skill, target.id), 'utf8');
                installed.push(skill.name);
            }
            return {
                id: target.id,
                label: target.label,
                dir: target.dir,
                installed,
            };
        });
        return {
            dir: results[0].dir,
            installed: Array.from(new Set(results.flatMap((result) => result.installed))),
            targets: results,
        };
    }
    reveal(input = {}) {
        const targetId = input.targetId && isSkillTargetId(input.targetId) ? input.targetId : 'claude';
        const dir = targetDir(targetId);
        if (!fs_1.default.existsSync(dir))
            return { revealed: false };
        void electron_1.shell.openPath(dir);
        return { revealed: true };
    }
}
exports.SkillsService = SkillsService;
exports.skillsService = new SkillsService();
//# sourceMappingURL=SkillsService.js.map