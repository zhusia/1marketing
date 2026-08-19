"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDefaultLocatorIO = createDefaultLocatorIO;
exports.parseRegQueryPath = parseRegQueryPath;
exports.expandWindowsEnvValue = expandWindowsEnvValue;
exports.parseWhereOutput = parseWhereOutput;
exports.parseCommandVOutput = parseCommandVOutput;
exports.parseVersionOutput = parseVersionOutput;
exports.readRegistry = readRegistry;
exports.locateChatAgents = locateChatAgents;
exports.getAgentLaunchEnvironment = getAgentLaunchEnvironment;
exports.resetLocatorCacheForTests = resetLocatorCacheForTests;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const agent_specs_1 = require("./agent-specs");
const launcher_1 = require("./launcher");
const REGISTRY_TTL_SECONDS = 7 * 24 * 60 * 60;
const MEMO_TTL_MS = 30_000;
const PROBE_TIMEOUT_MS = 8_000;
// Windows CLI cold starts are much slower (Defender scans each spawn, and there is no warm page
// cache after a reboot). Measured on Windows 11: Gemini costs ~2.9s to answer --version even warm,
// and a cold boot pushed several agents past 8s at once — reporting installed, working CLIs as
// "did not answer --version". Probes only run for binaries already found on disk, so a higher
// ceiling costs nothing for agents that simply are not installed.
const PROBE_TIMEOUT_WIN_MS = 20_000;
const PATH_SEARCH_TIMEOUT_MS = 10_000;
const PROBE_CONCURRENCY = 4;
function createDefaultLocatorIO() {
    const home = os_1.default.homedir();
    return {
        platform: process.platform,
        home,
        env: process.env,
        nodeExecutable: process.execPath,
        registryPath: path_1.default.join(home, '.1marketingtool', 'state', 'cli-registry.json'),
        existsSync: (p) => fs_1.default.existsSync(p),
        statMtimeMs: (p) => {
            try {
                return fs_1.default.statSync(p).mtimeMs;
            }
            catch {
                return null;
            }
        },
        readFile: (p) => {
            try {
                return fs_1.default.readFileSync(p, 'utf-8');
            }
            catch {
                return null;
            }
        },
        readdir: (p) => {
            try {
                return fs_1.default.readdirSync(p);
            }
            catch {
                return null;
            }
        },
        writeFile: (p, content) => {
            fs_1.default.mkdirSync(path_1.default.dirname(p), { recursive: true });
            fs_1.default.writeFileSync(p, content);
        },
        exec: (command, args, opts) => (0, launcher_1.spawnCapture)(command, args, { ...opts, input: opts.input }),
        now: () => Date.now(),
    };
}
// ── Pure helpers (exported for unit tests) ─────────────────────────────
/** Extracts the Path value from `reg query <key> /v Path` output. */
function parseRegQueryPath(stdout) {
    for (const line of stdout.split(/\r?\n/)) {
        const match = /^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(.+)$/i.exec(line);
        if (match)
            return match[1].trim();
    }
    return null;
}
/** Expands %VAR% references using the provided env (case-insensitive keys). */
function expandWindowsEnvValue(value, env) {
    return value.replace(/%([^%]+)%/g, (whole, name) => {
        for (const [key, val] of Object.entries(env)) {
            if (key.toLowerCase() === name.toLowerCase() && val)
                return val;
        }
        return whole;
    });
}
/** Maps `where.exe a b c` output lines back to the binary names they matched. */
function parseWhereOutput(stdout, names) {
    const result = new Map();
    for (const line of stdout.split(/\r?\n/)) {
        const candidate = line.trim();
        if (!candidate)
            continue;
        const base = path_1.default.win32.basename(candidate).toLowerCase();
        const stem = base.replace(/\.(exe|cmd|bat|com|ps1)$/i, '');
        const ext = path_1.default.win32.extname(base);
        if (ext === '.bat' || ext === '.ps1' || ext === '.com')
            continue;
        for (const name of names) {
            if (stem === name.toLowerCase() && !result.has(name)) {
                result.set(name, candidate);
            }
        }
    }
    return result;
}
/** Maps `command -v a b c` output lines (absolute paths only) back to names. */
function parseCommandVOutput(stdout, names) {
    const result = new Map();
    for (const line of stdout.split(/\r?\n/)) {
        const candidate = line.trim();
        if (!candidate.startsWith('/'))
            continue;
        const base = path_1.default.posix.basename(candidate);
        for (const name of names) {
            if (base === name && !result.has(name)) {
                result.set(name, candidate);
            }
        }
    }
    return result;
}
/** Pulls a version-ish token out of `--version` output. */
function parseVersionOutput(text) {
    const firstLine = text.split(/\r?\n/).find((line) => line.trim().length > 0);
    if (!firstLine)
        return null;
    const match = /(\d+\.\d+(?:\.\d+)?(?:[-.][0-9A-Za-z.]+)?)/.exec(firstLine);
    return match ? match[1] : null;
}
// ── Registry ────────────────────────────────────────────────────────────
function readRegistry(io) {
    const raw = io.readFile(io.registryPath);
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.entries))
            return [];
        return parsed.entries.filter((entry) => entry && typeof entry.agentId === 'string' && typeof entry.path === 'string');
    }
    catch {
        return [];
    }
}
function writeRegistry(io, entries) {
    const file = {
        version: 1,
        writtenAt: Math.floor(io.now() / 1000),
        entries,
    };
    try {
        io.writeFile(io.registryPath, JSON.stringify(file, null, 2));
    }
    catch (err) {
        console.error('[agent-bridge] failed to write cli registry:', err);
    }
}
// ── Windows registry PATH rebuild ───────────────────────────────────────
async function readWindowsRegistryPathParts(io) {
    const systemRoot = io.env.SystemRoot || io.env.SYSTEMROOT || 'C:\\Windows';
    const regExe = path_1.default.win32.join(systemRoot, 'System32', 'reg.exe');
    const keys = [
        'HKCU\\Environment',
        'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    ];
    const parts = [];
    for (const key of keys) {
        try {
            const result = await io.exec(regExe, ['query', key, '/v', 'Path'], {
                timeoutMs: 5000,
                env: io.env,
            });
            const value = parseRegQueryPath(result.stdout);
            if (value) {
                const expanded = expandWindowsEnvValue(value, io.env);
                parts.push(...expanded.split(';').map((p) => p.trim()).filter(Boolean));
            }
        }
        catch {
            // Registry read is best-effort; the inherited PATH still applies.
        }
    }
    return parts;
}
// ── OpenCode deep scan ────────────────────────────────────────────────────
const SCAN_MAX_DIRS = 800;
const SCAN_MAX_DEPTH = 10;
// Only descend into directories on the path to a platform package binary,
// so the scan stays cheap even under a global root with many packages.
const SCAN_DESCEND = /^(?:node_modules|\.pnpm|global|bin|@[^\\/]+|opencode.*|\d+)$/i;
/**
 * Last-resort discovery of OpenCode's native binary for layouts the static
 * candidate list can't enumerate (pnpm's `.pnpm` store, deep hoisting).
 * Bounded BFS over the global package roots; Windows only.
 */
function scanForOpencodeBinary(io) {
    if (io.platform !== 'win32')
        return null;
    const join = path_1.default.win32.join;
    const wanted = 'opencode.exe';
    const queue = (0, agent_specs_1.opencodeScanRoots)({ home: io.home, platform: io.platform, env: io.env })
        .map((dir) => ({ dir, depth: 0 }));
    let visited = 0;
    while (queue.length > 0) {
        const { dir, depth } = queue.shift();
        if (visited >= SCAN_MAX_DIRS)
            break;
        const entries = io.readdir(dir);
        if (!entries)
            continue;
        visited += 1;
        for (const name of entries) {
            if (name.toLowerCase() === wanted) {
                const full = join(dir, name);
                if (io.existsSync(full))
                    return full;
            }
        }
        if (depth >= SCAN_MAX_DEPTH)
            continue;
        for (const name of entries) {
            if (SCAN_DESCEND.test(name))
                queue.push({ dir: join(dir, name), depth: depth + 1 });
        }
    }
    return null;
}
// ── PATH search ─────────────────────────────────────────────────────────
async function searchPathForAgents(io, env, agentIds) {
    const result = new Map();
    if (agentIds.length === 0)
        return result;
    const names = agentIds.map((id) => agent_specs_1.HEADLESS_SPECS[id].cliId);
    if (io.platform === 'win32') {
        const systemRoot = io.env.SystemRoot || io.env.SYSTEMROOT || 'C:\\Windows';
        const whereExe = path_1.default.win32.join(systemRoot, 'System32', 'where.exe');
        const res = await io.exec(whereExe, names, { timeoutMs: PATH_SEARCH_TIMEOUT_MS, env });
        const byName = parseWhereOutput(res.stdout, names);
        for (const id of agentIds) {
            const found = byName.get(agent_specs_1.HEADLESS_SPECS[id].cliId);
            if (found && io.existsSync(found))
                result.set(id, found);
        }
        return result;
    }
    const shell = io.env.SHELL || '/bin/sh';
    const script = `command -v ${names.join(' ')} || true`;
    const res = await io.exec(shell, ['-lc', script], { timeoutMs: PATH_SEARCH_TIMEOUT_MS, env });
    const byName = parseCommandVOutput(res.stdout, names);
    for (const id of agentIds) {
        const found = byName.get(agent_specs_1.HEADLESS_SPECS[id].cliId);
        if (found && io.existsSync(found))
            result.set(id, found);
    }
    return result;
}
// ── Probe ───────────────────────────────────────────────────────────────
async function probeAgent(io, agentId, binaryPath, source, env) {
    const launch = (0, launcher_1.prepareChatAgentLaunch)({
        binaryPath,
        args: agent_specs_1.AGENT_VERSION_ARGS[agentId],
        env,
        platform: io.platform,
        nodeExecutable: io.nodeExecutable,
        fileExists: io.existsSync,
    });
    if (!launch.ok) {
        return buildInfo(agentId, { state: 'error', path: binaryPath, source, error: launch.error });
    }
    const timeoutMs = io.platform === 'win32' ? PROBE_TIMEOUT_WIN_MS : PROBE_TIMEOUT_MS;
    const result = await io.exec(launch.command, launch.args, { timeoutMs, env: launch.env });
    if (result.timedOut) {
        return buildInfo(agentId, {
            state: 'error',
            path: binaryPath,
            source,
            error: `${binaryPath} did not answer --version within ${timeoutMs / 1000}s.`,
        });
    }
    if (result.exitCode !== 0) {
        const detail = result.stderr.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 300);
        return buildInfo(agentId, {
            state: 'error',
            path: binaryPath,
            source,
            error: detail || `${binaryPath} --version exited with code ${result.exitCode ?? result.signal ?? 'unknown'}.`,
        });
    }
    return buildInfo(agentId, {
        state: 'detected',
        path: binaryPath,
        source,
        version: parseVersionOutput(result.stdout || result.stderr),
    });
}
function buildInfo(agentId, fields) {
    return {
        id: agentId,
        displayName: agent_specs_1.CHAT_AGENT_LABELS[agentId],
        state: fields.state ?? 'not-found',
        version: fields.version ?? null,
        path: fields.path ?? null,
        source: fields.source ?? null,
        error: fields.error ?? null,
        acp: (0, agent_specs_1.supportsAcp)(agentId),
        imageGen: (0, agent_specs_1.supportsImageGeneration)(agentId),
    };
}
// ── Main entry ──────────────────────────────────────────────────────────
let memo = null;
let inflight = null;
let cachedWindowsPathParts = null;
async function locateChatAgents(opts = {}) {
    const io = opts.io ?? createDefaultLocatorIO();
    const usingDefaultIO = !opts.io;
    if (usingDefaultIO && !opts.force) {
        if (memo && io.now() - memo.at < MEMO_TTL_MS)
            return memo.agents;
        if (inflight)
            return inflight;
    }
    const run = locate(io, Boolean(opts.force)).then((agents) => {
        if (usingDefaultIO)
            memo = { at: io.now(), agents };
        return agents;
    });
    if (usingDefaultIO) {
        inflight = run.finally(() => {
            inflight = null;
        });
        return inflight;
    }
    return run;
}
/**
 * The launch environment for agent runs. Memoized because the Windows
 * registry PATH read spawns reg.exe.
 */
async function getAgentLaunchEnvironment(io = createDefaultLocatorIO()) {
    let registryParts = [];
    if (io.platform === 'win32') {
        if (cachedWindowsPathParts && io.now() - cachedWindowsPathParts.at < 5 * 60_000) {
            registryParts = cachedWindowsPathParts.parts;
        }
        else {
            registryParts = await readWindowsRegistryPathParts(io);
            cachedWindowsPathParts = { at: io.now(), parts: registryParts };
        }
    }
    return (0, launcher_1.createChatAgentEnvironment)(io.home, io.platform, io.env, registryParts);
}
async function locate(io, force) {
    const registryEntries = readRegistry(io);
    const env = await getAgentLaunchEnvironment(io);
    const nowSec = Math.floor(io.now() / 1000);
    const results = new Map();
    const pendingProbes = [];
    const pathSearchIds = [];
    for (const agentId of agent_specs_1.CHAT_AGENT_IDS) {
        const own = registryEntries.find((entry) => entry.agentId === agentId);
        if (own?.source === 'override') {
            if (io.existsSync(own.path)) {
                pendingProbes.push({ agentId, path: own.path, source: 'override' });
            }
            else {
                results.set(agentId, buildInfo(agentId, {
                    state: 'error',
                    path: own.path,
                    source: 'override',
                    error: `Configured path no longer exists: ${own.path}`,
                }));
            }
            continue;
        }
        if (!force &&
            own &&
            nowSec - own.detectedAt < REGISTRY_TTL_SECONDS &&
            io.existsSync(own.path) &&
            io.statMtimeMs(own.path) === own.mtimeMs) {
            results.set(agentId, buildInfo(agentId, {
                state: 'detected',
                path: own.path,
                source: own.source,
                version: own.version,
            }));
            continue;
        }
        const ctx = { home: io.home, platform: io.platform, env: io.env };
        const wellKnown = (0, agent_specs_1.buildWellKnownCandidates)(agentId, ctx).find((candidate) => io.existsSync(candidate));
        if (wellKnown) {
            pendingProbes.push({ agentId, path: wellKnown, source: 'well-known' });
            continue;
        }
        pathSearchIds.push(agentId);
    }
    let pathMatches = new Map();
    try {
        pathMatches = await searchPathForAgents(io, env, pathSearchIds);
    }
    catch (err) {
        console.error('[agent-bridge] PATH search failed:', err);
    }
    for (const agentId of pathSearchIds) {
        const found = pathMatches.get(agentId);
        if (found) {
            pendingProbes.push({ agentId, path: found, source: 'path' });
            continue;
        }
        if (agentId === 'opencode') {
            const scanned = scanForOpencodeBinary(io);
            if (scanned) {
                pendingProbes.push({ agentId, path: scanned, source: 'well-known' });
                continue;
            }
        }
        results.set(agentId, buildInfo(agentId, { state: 'not-found' }));
    }
    const probed = await mapWithConcurrency(pendingProbes, PROBE_CONCURRENCY, (probe) => probeAgent(io, probe.agentId, probe.path, probe.source, env));
    for (const info of probed) {
        results.set(info.id, info);
    }
    const nextEntries = [];
    for (const entry of registryEntries) {
        if (entry.source === 'override')
            nextEntries.push(entry);
    }
    for (const info of results.values()) {
        if (info.state !== 'detected' || !info.path || info.source === 'override')
            continue;
        nextEntries.push({
            agentId: info.id,
            path: info.path,
            version: info.version,
            source: info.source ?? 'path',
            mtimeMs: io.statMtimeMs(info.path),
            detectedAt: nowSec,
        });
    }
    writeRegistry(io, nextEntries);
    return agent_specs_1.CHAT_AGENT_IDS.map((agentId) => results.get(agentId) ?? buildInfo(agentId, { state: 'not-found' }));
}
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await fn(items[index]);
        }
    });
    await Promise.all(workers);
    return results;
}
/** Test hook: clears module-level memoization. */
function resetLocatorCacheForTests() {
    memo = null;
    inflight = null;
    cachedWindowsPathParts = null;
}
//# sourceMappingURL=cli-locator.js.map