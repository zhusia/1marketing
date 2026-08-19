"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createChatAgentEnvironment = createChatAgentEnvironment;
exports.dedupePathParts = dedupePathParts;
exports.prepareChatAgentLaunch = prepareChatAgentLaunch;
exports.parseWindowsNpmShim = parseWindowsNpmShim;
exports.parseWindowsShimScriptPath = parseWindowsShimScriptPath;
exports.parseWindowsShimExecutable = parseWindowsShimExecutable;
exports.spawnCapture = spawnCapture;
exports.readPathEnv = readPathEnv;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const agent_specs_1 = require("./agent-specs");
/**
 * Builds the environment agents are spawned with. Prepends the
 * well-known bin dirs so launches succeed even when the GUI-inherited
 * PATH is incomplete. On Windows, `registryPathParts` (read from
 * HKCU/HKLM by the locator) is merged in so CLIs installed after the
 * app started are still reachable.
 */
function createChatAgentEnvironment(home, platform = process.platform, baseEnv = process.env, registryPathParts = []) {
    const extra = (0, agent_specs_1.commonBinDirs)({ home, platform, env: baseEnv });
    const existingPath = readPathEnv(baseEnv);
    const delimiter = platform === 'win32' ? ';' : path_1.default.delimiter;
    const parts = [...extra, ...registryPathParts, existingPath].filter(Boolean);
    const nextPath = dedupePathParts(parts, platform).join(delimiter);
    const env = {};
    for (const [key, value] of Object.entries(baseEnv)) {
        if (platform === 'win32' && key.toLowerCase() === 'path')
            continue;
        env[key] = value;
    }
    env[platform === 'win32' ? 'Path' : 'PATH'] = nextPath;
    env.NO_COLOR = '1';
    env.FORCE_COLOR = '0';
    return env;
}
function dedupePathParts(parts, platform) {
    const seen = new Set();
    const result = [];
    for (const raw of parts) {
        const segments = platform === 'win32' ? raw.split(';') : raw.split(path_1.default.delimiter);
        for (const segment of segments) {
            const trimmed = segment.trim();
            if (!trimmed)
                continue;
            const key = platform === 'win32' ? trimmed.toLowerCase() : trimmed;
            if (seen.has(key))
                continue;
            seen.add(key);
            result.push(trimmed);
        }
    }
    return result;
}
function prepareChatAgentLaunch(input) {
    const platform = input.platform ?? process.platform;
    const ext = path_1.default.win32.extname(input.binaryPath).toLowerCase();
    if (platform === 'win32' && ext === '.bat') {
        return {
            ok: false,
            error: `Cannot run Windows batch file safely: ${input.binaryPath}. Reinstall the agent so a native .exe or standard npm .cmd shim is available.`,
        };
    }
    if (platform !== 'win32' || ext !== '.cmd') {
        return { ok: true, command: input.binaryPath, args: input.args, env: input.env, mode: 'direct' };
    }
    const reader = input.shimReader ?? ((filePath) => fs_1.default.readFileSync(filePath, 'utf-8'));
    const fileExists = input.fileExists ?? ((filePath) => fs_1.default.existsSync(filePath));
    const nodeExecutable = input.nodeExecutable ?? process.execPath;
    const runViaNode = (scriptPath) => ({
        ok: true,
        command: nodeExecutable,
        args: [scriptPath, ...input.args],
        env: { ...input.env, ELECTRON_RUN_AS_NODE: '1' },
        mode: 'windows-npm-shim',
    });
    let content = '';
    try {
        content = reader(input.binaryPath);
    }
    catch (err) {
        return {
            ok: false,
            error: `Cannot read Windows command shim at ${input.binaryPath}: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
    // Standard npm shim: forwards node to a .js/.cjs/.mjs entry beside the shim.
    const target = parseWindowsNpmShim(input.binaryPath, content);
    if (target)
        return runViaNode(target.scriptPath);
    // pnpm / OpenCode-style shims forward to an extension-less node entry script
    // (e.g. `"%dp0%\node_modules\opencode-ai\bin\opencode"`), which the npm parser
    // skips. Resolve it against the candidate JS extensions and run whichever
    // file is actually on disk.
    const scriptToken = parseWindowsShimScriptPath(input.binaryPath, content);
    if (scriptToken) {
        const resolved = [scriptToken, `${scriptToken}.js`, `${scriptToken}.cjs`, `${scriptToken}.mjs`]
            .find((candidate) => fileExists(candidate));
        if (resolved)
            return runViaNode(resolved);
    }
    // Shims for packages that ship a platform binary instead of a JS entry forward to a nested
    // `.exe` (Claude Code emits `"%dp0%\node_modules\@anthropic-ai\claude-code\bin\claude.exe" %*`).
    // That target is not a sibling of the shim, so the fallback below cannot find it.
    const exeToken = parseWindowsShimExecutable(input.binaryPath, content);
    if (exeToken && fileExists(exeToken)) {
        return { ok: true, command: exeToken, args: input.args, env: input.env, mode: 'direct' };
    }
    // Last resort: a native .exe sitting next to the .cmd (scoop/winget layouts).
    const siblingExe = input.binaryPath.replace(/\.cmd$/i, '.exe');
    if (siblingExe !== input.binaryPath && fileExists(siblingExe)) {
        return { ok: true, command: siblingExe, args: input.args, env: input.env, mode: 'direct' };
    }
    return {
        ok: false,
        error: `Cannot run Windows command shim safely: ${input.binaryPath}. Reinstall the agent so a native .exe or standard npm .cmd shim is available.`,
    };
}
function parseWindowsNpmShim(shimPath, content) {
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        if (!/%\*/.test(line) || !/\.(?:c?m?js)\b/i.test(line))
            continue;
        const matches = line.matchAll(/"([^"]+\.(?:js|cjs|mjs))"|([^\s"]+\.(?:js|cjs|mjs))/gi);
        for (const match of matches) {
            const token = (match[1] ?? match[2] ?? '').trim();
            if (!token)
                continue;
            const expanded = expandWindowsShimToken(shimPath, token);
            if (expanded)
                return { scriptPath: expanded };
        }
    }
    return null;
}
/**
 * Extracts the node entry script a `.cmd` shim forwards to, including the
 * extension-less references that {@link parseWindowsNpmShim} skips (pnpm and
 * OpenCode emit `"%dp0%\node_modules\opencode-ai\bin\opencode"`). Native binary
 * references (`.exe`/`.cmd`/`.bat`/…) are ignored — those are handled by the
 * direct-launch and sibling-`.exe` paths instead. Returns an absolute path with
 * whatever extension the shim used (possibly none).
 */
function parseWindowsShimScriptPath(shimPath, content) {
    for (const line of content.split(/\r?\n/)) {
        // Only the forwarding line carries both the `%*` arg splat and a
        // `%dp0%`/`%~dp0%`-relative path to the entry script.
        if (!/%\*/.test(line) || !/%~?dp0%?/i.test(line))
            continue;
        for (const match of line.matchAll(/"([^"]+)"/g)) {
            const token = match[1].trim();
            if (!/%~?dp0%?/i.test(token))
                continue;
            if (/_prog/i.test(token) || /(?:^|[\\/])node(?:\.exe)?$/i.test(token))
                continue;
            if (/\.(?:exe|cmd|bat|com|ps1)$/i.test(token))
                continue;
            const expanded = expandWindowsShimToken(shimPath, token);
            if (expanded)
                return expanded;
        }
    }
    return null;
}
/**
 * Extracts the native executable a `.cmd` shim forwards to at a `%dp0%`-relative path, for packages
 * whose npm bin is a platform binary rather than a node entry script. Complements
 * {@link parseWindowsShimScriptPath}, which deliberately skips `.exe` targets: the sibling-`.exe`
 * fallback only covers binaries beside the shim, not nested ones under `node_modules`. `node.exe`
 * and `_prog` references are ignored — those mark the JS-forwarding shim shape instead.
 */
function parseWindowsShimExecutable(shimPath, content) {
    for (const line of content.split(/\r?\n/)) {
        if (!/%\*/.test(line) || !/%~?dp0%?/i.test(line))
            continue;
        for (const match of line.matchAll(/"([^"]+)"/g)) {
            const token = match[1].trim();
            if (!/%~?dp0%?/i.test(token))
                continue;
            if (/_prog/i.test(token) || /(?:^|[\\/])node\.exe$/i.test(token))
                continue;
            if (!/\.exe$/i.test(token))
                continue;
            const expanded = expandWindowsShimToken(shimPath, token);
            if (expanded)
                return expanded;
        }
    }
    return null;
}
function spawnCapture(command, args, opts) {
    return new Promise((resolve) => {
        const child = (0, child_process_1.spawn)(command, args, {
            cwd: opts.cwd,
            env: opts.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;
        let killTimer = null;
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
        }, opts.timeoutMs);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            opts.onStdout?.(chunk);
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
            opts.onStderr?.(chunk);
        });
        child.on('error', (err) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (killTimer)
                clearTimeout(killTimer);
            resolve({
                stdout,
                stderr: stderr || `Failed to start ${command}: ${err.message}`,
                exitCode: null,
                signal: null,
                timedOut,
            });
        });
        child.on('close', (exitCode, signal) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (killTimer)
                clearTimeout(killTimer);
            resolve({ stdout, stderr, exitCode, signal, timedOut });
        });
        child.stdin.end(opts.input ?? '');
    });
}
function readPathEnv(env) {
    for (const [key, value] of Object.entries(env)) {
        if (key.toLowerCase() === 'path' && value)
            return value;
    }
    return '';
}
function expandWindowsShimToken(shimPath, token) {
    const shimDir = path_1.default.win32.dirname(shimPath);
    const shimDirWithSep = shimDir.endsWith('\\') ? shimDir : `${shimDir}\\`;
    let expanded = token
        .replace(/%~dp0/gi, shimDirWithSep)
        .replace(/%dp0%/gi, shimDirWithSep)
        .replace(/\//g, '\\');
    if (/%[^%]+%/.test(expanded))
        return null;
    if (!path_1.default.win32.isAbsolute(expanded)) {
        expanded = path_1.default.win32.resolve(shimDir, expanded);
    }
    return path_1.default.win32.normalize(expanded);
}
//# sourceMappingURL=launcher.js.map