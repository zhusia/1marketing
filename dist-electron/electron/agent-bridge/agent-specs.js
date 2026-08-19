"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENCODE_PLATFORM_PACKAGES = exports.WINDOWS_BINARY_EXTENSIONS = exports.AGENT_VERSION_ARGS = exports.STATIC_AGENT_MODELS = exports.ACP_MODEL_FLAG_POSITION = exports.ACP_MODEL_STRATEGY = exports.AGENT_MODEL_FLAGS = exports.IMAGE_CAPABLE_AGENTS = exports.ACP_AGENT_ARGS = exports.HEADLESS_SPECS = exports.AUTO_AGENT_PREFERENCE = exports.CHAT_AGENT_LABELS = exports.CHAT_AGENT_IDS = void 0;
exports.supportsAcp = supportsAcp;
exports.supportsImageGeneration = supportsImageGeneration;
exports.isSupportedChatAgent = isSupportedChatAgent;
exports.commonBinDirs = commonBinDirs;
exports.agentSpecificDirs = agentSpecificDirs;
exports.buildWellKnownCandidates = buildWellKnownCandidates;
exports.opencodeScanRoots = opencodeScanRoots;
const path_1 = __importDefault(require("path"));
exports.CHAT_AGENT_IDS = ['claude', 'codex', 'gemini', 'opencode', 'amp', 'qwen', 'hermes', 'aider', 'grok'];
exports.CHAT_AGENT_LABELS = {
    claude: 'Claude Code',
    codex: 'Codex',
    gemini: 'Gemini',
    opencode: 'OpenCode',
    amp: 'Amp',
    qwen: 'Qwen',
    hermes: 'Hermes Agent',
    aider: 'Aider',
    grok: 'Grok',
};
/** Order used when routing "auto" runs or falling back from an unavailable agent. */
exports.AUTO_AGENT_PREFERENCE = [
    'claude',
    'opencode',
    'codex',
    'gemini',
    'grok',
    'qwen',
    'amp',
    'hermes',
    'aider',
];
exports.HEADLESS_SPECS = {
    claude: { cliId: 'claude', headlessFlag: '-p', promptPosition: 'after-flag' },
    codex: {
        cliId: 'codex',
        headlessFlag: 'exec',
        promptPosition: 'end',
        promptDelivery: 'stdin',
        stdinPromptArg: '-',
        defaultFlags: ['--dangerously-bypass-approvals-and-sandbox', '--ephemeral', '--skip-git-repo-check'],
    },
    gemini: { cliId: 'gemini', headlessFlag: '-p', promptPosition: 'after-flag' },
    opencode: { cliId: 'opencode', headlessFlag: 'run', promptPosition: 'after-flag' },
    amp: { cliId: 'amp', headlessFlag: '-x', promptPosition: 'after-flag' },
    qwen: { cliId: 'qwen', headlessFlag: '-p', promptPosition: 'after-flag' },
    // Hermes' native one-shot mode is intended for parent processes: it loads
    // the user's configured runtime but emits only the final response on stdout.
    hermes: { cliId: 'hermes', headlessFlag: '-z', promptPosition: 'after-flag' },
    aider: { cliId: 'aider', headlessFlag: '--message', promptPosition: 'after-flag' },
    // Grok Build TUI: `-p` / `--single` prints the response and exits. Bypass
    // interactive permission prompts so headless campaign runs complete unattended.
    grok: {
        cliId: 'grok',
        headlessFlag: '-p',
        promptPosition: 'after-flag',
        defaultFlags: ['--permission-mode', 'bypassPermissions', '--always-approve'],
    },
};
/**
 * Args that switch a CLI into ACP mode (JSON-RPC over stdio). Verified
 * against opencode 1.17.3 (`opencode acp`), gemini 0.45.2, qwen 0.14.5
 * (`--acp`), and grok 1.0.0 (`agent stdio`). Agents without an entry run
 * headless one-shots.
 */
exports.ACP_AGENT_ARGS = {
    opencode: ['acp'],
    gemini: ['--acp'],
    qwen: ['--acp'],
    // Grok exposes native ACP over stdio; model flags must land before `stdio`
    // (see ACP_MODEL_FLAG_POSITION).
    grok: ['agent', 'stdio'],
};
function supportsAcp(agentId) {
    return agentId in exports.ACP_AGENT_ARGS;
}
/**
 * Agents whose backing model provider can generate images, so the app can
 * later route content image generation to a detected CLI. Keyed by the
 * provider's first-party image models: Gemini (Imagen / native Gemini image),
 * Codex/OpenAI (gpt-image), and Qwen (Qwen-Image). Anthropic (Claude) has no
 * image generation, and the coding-only wrappers (OpenCode, Amp, Aider) ride
 * whatever model is configured, so none of those are flagged.
 */
exports.IMAGE_CAPABLE_AGENTS = {
    gemini: true,
    codex: true,
    qwen: true,
};
function supportsImageGeneration(agentId) {
    return agentId in exports.IMAGE_CAPABLE_AGENTS;
}
/** CLI flags that select the underlying model (verified against each CLI's --help). */
exports.AGENT_MODEL_FLAGS = {
    claude: (modelId) => ['--model', modelId],
    codex: (modelId) => ['--model', modelId],
    gemini: (modelId) => ['--model', modelId],
    qwen: (modelId) => ['--model', modelId],
    opencode: (modelId) => ['--model', modelId],
    hermes: (modelId) => ['--model', modelId],
    aider: (modelId) => ['--model', modelId],
    grok: (modelId) => ['--model', modelId],
};
/**
 * How a model choice reaches an ACP session: gemini/qwen accept their
 * global --model flag at spawn; opencode acp has no model flag but
 * supports `session/set_config_option` (verified live on 1.17.3).
 * Grok accepts `--model` on `agent` (before the `stdio` subcommand).
 */
exports.ACP_MODEL_STRATEGY = {
    opencode: 'config-option',
    gemini: 'spawn-args',
    qwen: 'spawn-args',
    grok: 'spawn-args',
};
/**
 * Where spawn-args model flags land relative to ACP_AGENT_ARGS.
 * Default is `append` (`gemini --acp --model X`). Grok requires
 * `before-last` so the result is `grok agent --model X stdio`.
 */
exports.ACP_MODEL_FLAG_POSITION = {
    grok: 'before-last',
};
/**
 * Curated model choices for CLIs that cannot enumerate their own models.
 * OpenCode is not listed here — its list comes from `opencode models` at
 * runtime. An empty/missing entry hides the model selector for that agent.
 */
exports.STATIC_AGENT_MODELS = {
    claude: [
        { id: 'opus', label: 'Opus (latest)' },
        { id: 'sonnet', label: 'Sonnet (latest)' },
        { id: 'haiku', label: 'Haiku (latest)' },
    ],
    codex: [
        { id: 'gpt-5.5', label: 'GPT-5.5' },
        { id: 'gpt-5.4', label: 'GPT-5.4' },
        { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini' },
        { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    ],
    gemini: [
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    qwen: [
        { id: 'qwen3-coder-plus', label: 'Qwen3 Coder Plus' },
        { id: 'qwen3-coder-flash', label: 'Qwen3 Coder Flash' },
    ],
    aider: [
        { id: 'sonnet', label: 'Claude Sonnet' },
        { id: 'gpt-5.5', label: 'GPT-5.5' },
    ],
    grok: [
        { id: 'grok-4.5', label: 'Grok 4.5' },
    ],
};
exports.AGENT_VERSION_ARGS = {
    claude: ['--version'],
    codex: ['--version'],
    gemini: ['--version'],
    opencode: ['--version'],
    amp: ['--version'],
    qwen: ['--version'],
    hermes: ['--version'],
    aider: ['--version'],
    grok: ['--version'],
};
function isSupportedChatAgent(id) {
    return exports.CHAT_AGENT_IDS.includes(id);
}
/** Executable extensions our launcher can run on Windows (.bat is rejected by design). */
exports.WINDOWS_BINARY_EXTENSIONS = ['.exe', '.cmd'];
/** opencode-ai's per-platform optionalDependencies that ship the native binary. */
exports.OPENCODE_PLATFORM_PACKAGES = [
    'opencode-windows-x64',
    'opencode-windows-arm64',
    'opencode-windows-x64-baseline',
];
/**
 * Directories where CLI installers commonly place binaries, ordered by
 * how likely a healthy install is to live there. Used for direct
 * filesystem probing so detection works even when the inherited PATH
 * is stale or incomplete (the main Windows failure mode).
 */
function commonBinDirs(ctx) {
    if (ctx.platform === 'win32') {
        const join = path_1.default.win32.join;
        const roaming = ctx.env.APPDATA || join(ctx.home, 'AppData', 'Roaming');
        const local = ctx.env.LOCALAPPDATA || join(ctx.home, 'AppData', 'Local');
        const programData = ctx.env.ProgramData || ctx.env.PROGRAMDATA || 'C:\\ProgramData';
        const programFiles = ctx.env.ProgramFiles || ctx.env.PROGRAMFILES || 'C:\\Program Files';
        const programFilesX86 = ctx.env['ProgramFiles(x86)'] || ctx.env.PROGRAMFILES_X86 || 'C:\\Program Files (x86)';
        const chocolatey = ctx.env.ChocolateyInstall || ctx.env.CHOCOLATEYINSTALL || join(programData, 'chocolatey');
        const dirs = [
            join(roaming, 'npm'),
            join(programFiles, 'nodejs'),
            join(programFilesX86, 'nodejs'),
            join(ctx.home, '.local', 'bin'),
            join(ctx.home, '.bun', 'bin'),
            join(local, 'pnpm'),
            join(ctx.home, 'scoop', 'shims'),
            join(programData, 'scoop', 'shims'),
            join(chocolatey, 'bin'),
            join(local, 'Microsoft', 'WinGet', 'Links'),
            join(local, 'Volta', 'bin'),
            join(local, 'mise', 'shims'),
            join(local, 'Yarn', 'bin'),
            join(ctx.home, 'AppData', 'Local', 'Yarn', 'Data', 'global', 'node_modules', '.bin'),
            join(local, 'Microsoft', 'WindowsApps'),
        ];
        if (ctx.env.PNPM_HOME)
            dirs.unshift(ctx.env.PNPM_HOME);
        if (ctx.env.NVM_SYMLINK)
            dirs.unshift(ctx.env.NVM_SYMLINK);
        return dirs;
    }
    const dirs = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        path_1.default.join(ctx.home, '.local', 'bin'),
        path_1.default.join(ctx.home, '.npm-global', 'bin'),
        path_1.default.join(ctx.home, '.bun', 'bin'),
        path_1.default.join(ctx.home, '.volta', 'bin'),
        path_1.default.join(ctx.home, '.cargo', 'bin'),
        path_1.default.join(ctx.home, 'go', 'bin'),
    ];
    if (ctx.platform === 'darwin')
        dirs.push(path_1.default.join(ctx.home, 'Library', 'pnpm'));
    else
        dirs.push(path_1.default.join(ctx.home, '.local', 'share', 'pnpm'));
    return dirs;
}
/** Install locations specific to one agent's own installer, probed before the common dirs. */
function agentSpecificDirs(agentId, ctx) {
    const join = ctx.platform === 'win32' ? path_1.default.win32.join : path_1.default.join;
    switch (agentId) {
        case 'opencode': {
            if (ctx.platform !== 'win32')
                return [join(ctx.home, '.opencode', 'bin')];
            const roaming = ctx.env.APPDATA || path_1.default.win32.join(ctx.home, 'AppData', 'Roaming');
            const programFiles = ctx.env.ProgramFiles || ctx.env.PROGRAMFILES || 'C:\\Program Files';
            const programFilesX86 = ctx.env['ProgramFiles(x86)'] || ctx.env.PROGRAMFILES_X86 || 'C:\\Program Files (x86)';
            const npmRoots = [
                path_1.default.win32.join(roaming, 'npm'),
                ctx.env.PNPM_HOME,
                ctx.env.NVM_SYMLINK,
                path_1.default.win32.join(programFiles, 'nodejs'),
                path_1.default.win32.join(programFilesX86, 'nodejs'),
            ].filter((dir) => Boolean(dir));
            return [
                join(ctx.home, '.opencode', 'bin'),
                ...npmRoots.flatMap((root) => {
                    const rootModules = path_1.default.win32.join(root, 'node_modules');
                    const npmPackage = path_1.default.win32.join(rootModules, 'opencode-ai');
                    return [
                        join(npmPackage, 'bin'),
                        // The platform binary lives in opencode-ai's optionalDependency.
                        // npm hoists it to the global root; without hoisting it nests under
                        // opencode-ai. (pnpm's .pnpm store is handled by the locator scan.)
                        ...exports.OPENCODE_PLATFORM_PACKAGES.flatMap((pkg) => [
                            join(rootModules, pkg, 'bin'),
                            join(npmPackage, 'node_modules', pkg, 'bin'),
                        ]),
                    ];
                }),
            ];
        }
        case 'codex':
            return [join(ctx.home, '.codex', 'bin')];
        case 'hermes': {
            const configuredHome = (ctx.env.HERMES_HOME || '').trim();
            const configuredInstall = (ctx.env.HERMES_INSTALL_DIR || '').trim();
            if (ctx.platform === 'win32') {
                const local = ctx.env.LOCALAPPDATA || join(ctx.home, 'AppData', 'Local');
                return [
                    configuredInstall ? join(configuredInstall, 'venv', 'Scripts') : '',
                    configuredHome ? join(configuredHome, 'hermes-agent', 'venv', 'Scripts') : '',
                    join(local, 'hermes', 'hermes-agent', 'venv', 'Scripts'),
                    join(local, 'hermes', 'bin'),
                    join(ctx.home, '.hermes', 'hermes-agent', 'venv', 'Scripts'),
                ].filter(Boolean);
            }
            return [
                configuredInstall ? join(configuredInstall, 'venv', 'bin') : '',
                configuredHome ? join(configuredHome, 'hermes-agent', 'venv', 'bin') : '',
                join(ctx.home, '.hermes', 'hermes-agent', 'venv', 'bin'),
            ].filter(Boolean);
        }
        case 'grok':
            // Official installer places the binary at ~/.grok/bin/grok (and may
            // not add that directory to PATH for Electron-spawned processes).
            return [join(ctx.home, '.grok', 'bin')];
        default:
            return [];
    }
}
/**
 * Absolute file candidates for an agent binary, ordered by precedence.
 * Combines agent-specific dirs + common dirs with the platform's
 * launchable extensions.
 */
function buildWellKnownCandidates(agentId, ctx) {
    const join = ctx.platform === 'win32' ? path_1.default.win32.join : path_1.default.join;
    const dirs = [...agentSpecificDirs(agentId, ctx), ...commonBinDirs(ctx)];
    const names = [exports.HEADLESS_SPECS[agentId].cliId];
    const exts = ctx.platform === 'win32' ? exports.WINDOWS_BINARY_EXTENSIONS : [''];
    const candidates = [];
    for (const dir of dirs) {
        for (const name of names) {
            for (const ext of exts) {
                candidates.push(join(dir, `${name}${ext}`));
            }
        }
    }
    return candidates;
}
/**
 * Roots the locator scans recursively (bounded) when OpenCode's binary lives
 * under a layout the static candidate list can't enumerate — pnpm's
 * content-addressable `.pnpm` store, or deep/uncommon hoisting. Returns the
 * global package roots most likely to contain a node_modules tree with the
 * platform binary. Windows only; other platforms rely on PATH + well-known
 * dirs + the managed fallback.
 */
function opencodeScanRoots(ctx) {
    if (ctx.platform !== 'win32')
        return [];
    const join = path_1.default.win32.join;
    const roaming = ctx.env.APPDATA || join(ctx.home, 'AppData', 'Roaming');
    const local = ctx.env.LOCALAPPDATA || join(ctx.home, 'AppData', 'Local');
    const programFiles = ctx.env.ProgramFiles || ctx.env.PROGRAMFILES || 'C:\\Program Files';
    const roots = [
        join(ctx.home, '.opencode'),
        join(roaming, 'npm', 'node_modules'),
        join(local, 'pnpm'),
        join(programFiles, 'nodejs', 'node_modules'),
    ];
    if (ctx.env.PNPM_HOME)
        roots.unshift(ctx.env.PNPM_HOME);
    if (ctx.env.NVM_SYMLINK)
        roots.push(join(ctx.env.NVM_SYMLINK, 'node_modules'));
    return roots;
}
//# sourceMappingURL=agent-specs.js.map