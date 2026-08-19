"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectBrowsers = detectBrowsers;
exports.openInBrowser = openInBrowser;
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
const child_process_1 = require("child_process");
const electron_1 = require("electron");
// Ordered by rough popularity; Safari lives last since it is always present on macOS.
const BROWSERS = [
    {
        id: 'chrome',
        name: 'Google Chrome',
        mac: ['Google Chrome.app'],
        win: [
            '%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
            '%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
            '%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe',
        ],
        linux: ['google-chrome', 'google-chrome-stable'],
    },
    { id: 'arc', name: 'Arc', mac: ['Arc.app'] },
    {
        id: 'edge',
        name: 'Microsoft Edge',
        mac: ['Microsoft Edge.app'],
        win: [
            '%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe',
            '%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe',
        ],
        linux: ['microsoft-edge', 'microsoft-edge-stable'],
    },
    {
        id: 'brave',
        name: 'Brave',
        mac: ['Brave Browser.app'],
        win: [
            '%ProgramFiles%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
            '%LocalAppData%\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        ],
        linux: ['brave-browser', 'brave'],
    },
    {
        id: 'firefox',
        name: 'Firefox',
        mac: ['Firefox.app'],
        win: ['%ProgramFiles%\\Mozilla Firefox\\firefox.exe', '%ProgramFiles(x86)%\\Mozilla Firefox\\firefox.exe'],
        linux: ['firefox'],
    },
    {
        id: 'vivaldi',
        name: 'Vivaldi',
        mac: ['Vivaldi.app'],
        win: ['%LocalAppData%\\Vivaldi\\Application\\vivaldi.exe'],
        linux: ['vivaldi', 'vivaldi-stable'],
    },
    { id: 'opera', name: 'Opera', mac: ['Opera.app'], linux: ['opera'] },
    { id: 'safari', name: 'Safari', mac: ['Safari.app'] },
];
function macAppPath(apps) {
    const roots = ['/Applications', (0, path_1.join)((0, os_1.homedir)(), 'Applications')];
    for (const app of apps)
        for (const root of roots) {
            const path = (0, path_1.join)(root, app);
            if ((0, fs_1.existsSync)(path))
                return path;
        }
    return null;
}
function expandWin(path) {
    return path.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? '');
}
function winExePath(paths) {
    for (const raw of paths) {
        const path = expandWin(raw);
        if (path && !path.includes('%') && (0, fs_1.existsSync)(path))
            return path;
    }
    return null;
}
function linuxBinPath(bins) {
    const dirs = (process.env.PATH ?? '').split(':').filter(Boolean);
    for (const bin of bins)
        for (const dir of dirs) {
            const path = (0, path_1.join)(dir, bin);
            if ((0, fs_1.existsSync)(path))
                return path;
        }
    return null;
}
/** Resolve how to launch a given browser on this platform, or null if it isn't installed. */
function resolveLaunch(def) {
    if (process.platform === 'darwin' && def.mac) {
        const path = macAppPath(def.mac);
        return path ? { kind: 'mac', target: path } : null;
    }
    if (process.platform === 'win32' && def.win) {
        const path = winExePath(def.win);
        return path ? { kind: 'exe', target: path } : null;
    }
    if (process.platform === 'linux' && def.linux) {
        const path = linuxBinPath(def.linux);
        return path ? { kind: 'exe', target: path } : null;
    }
    return null;
}
/** Browsers actually installed on this machine (best-effort; empty on unsupported platforms). */
function detectBrowsers() {
    const found = [];
    for (const def of BROWSERS) {
        if (resolveLaunch(def))
            found.push({ id: def.id, name: def.name });
    }
    return found;
}
function launchDetached(cmd, args, fallbackUrl) {
    try {
        const child = (0, child_process_1.spawn)(cmd, args, { detached: true, stdio: 'ignore' });
        // If the chosen browser can't be launched, don't strand the user — fall back to the OS default.
        child.on('error', () => void electron_1.shell.openExternal(fallbackUrl));
        child.unref();
    }
    catch {
        void electron_1.shell.openExternal(fallbackUrl);
    }
}
/**
 * Open `url` in a specific browser by id (from detectBrowsers()), or in the OS default when the id
 * is missing/unknown. We deliberately do NOT auto-open during a connect — the user chooses, so they
 * can land in the browser/profile that's signed into the right account.
 */
async function openInBrowser(url, browserId) {
    if (!browserId || browserId === 'default') {
        await electron_1.shell.openExternal(url);
        return;
    }
    const def = BROWSERS.find((b) => b.id === browserId);
    const launch = def ? resolveLaunch(def) : null;
    if (!launch) {
        await electron_1.shell.openExternal(url);
        return;
    }
    if (launch.kind === 'mac') {
        launchDetached('open', ['-a', launch.target, url], url);
    }
    else {
        launchDetached(launch.target, [url], url);
    }
}
//# sourceMappingURL=browserLaunch.js.map