"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUpdateStatusSnapshot = getUpdateStatusSnapshot;
exports.setupUpdater = setupUpdater;
exports.setupUpdaterIpcHandlers = setupUpdaterIpcHandlers;
exports.checkForUpdatesInBackground = checkForUpdatesInBackground;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const electron_updater_1 = require("electron-updater");
const channels_1 = require("./ipc/channels");
const updateEntitlement_1 = require("./updateEntitlement");
let configured = false;
/**
 * Lazy accessors into main-process state. Both are optional so dev builds and
 * tests degrade to the previous hard-coded defaults. They are only ever invoked
 * later, on update events, so `setupUpdater` may run before the license/store
 * singletons are ready.
 */
let getLicenseInfoFn = null;
let getUpdatePreferencesFn = null;
function resolveUpdaterPrefs() {
    const prefs = getUpdatePreferencesFn?.();
    return {
        // Preserve the historical hard-coded defaults when prefs are unavailable.
        autoDownload: prefs?.autoDownload ?? true,
        autoInstallOnQuit: prefs?.autoInstallOnQuit ?? true,
    };
}
/**
 * Background-download resilience state (§12.8 item 1). A mid-download network
 * blip (e.g. `net::ERR_NETWORK_CHANGED` on a Wi-Fi/VPN transition) kills the
 * transfer and electron-updater does nothing further — the "auto" download then
 * silently never happens until the next interval check, which looks to the user
 * like auto-download is broken. When a download we started dies, we re-run
 * `checkForUpdates()` on a backoff schedule; the resulting `update-available`
 * event re-enters the SAME preference + entitlement gated auto-download path.
 */
const DOWNLOAD_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];
let downloadInFlight = false;
let retryTimer = null;
let retryAttempts = 0;
let retryVersion = null;
/**
 * Version already downloaded AND handed to the platform installer in this
 * process (§12.8 item 3). On macOS, Squirrel stages the bundle in
 * `~/Library/Caches/<id>.ShipIt/update.XXXX` and parks a ShipIt waiting for app
 * termination. Re-running `downloadUpdate()` for the same version — which every
 * `checkForUpdates()` used to do via the update-available handler — re-stages a
 * NEW update.XXXX dir, overwrites ShipItState.plist, and spawns ANOTHER waiting
 * ShipIt; when the app finally exits, a surviving ShipIt can wake with state
 * pointing at a staging dir a later re-verify already replaced → ENOENT → "Too
 * many attempts to install" → the OLD version relaunches. One handoff per
 * version per process is all Squirrel needs.
 */
let downloadedVersion = null;
/**
 * Last status pushed to renderers, plus sticky info/progress so late subscribers
 * (pill after macOS window re-creation, dialog opened mid-download) can render
 * the real current state without forcing a fresh check (§12.8 item 2).
 */
let lastStatus = { status: 'idle' };
let lastInfo;
let lastProgress;
function getUpdateStatusSnapshot() {
    return {
        ...lastStatus,
        info: lastStatus.info ?? lastInfo,
        progress: lastStatus.progress ?? lastProgress,
    };
}
function clearDownloadRetry() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}
function scheduleDownloadRetry() {
    if (!resolveUpdaterPrefs().autoDownload)
        return false;
    if (retryAttempts >= DOWNLOAD_RETRY_DELAYS_MS.length)
        return false;
    const delay = DOWNLOAD_RETRY_DELAYS_MS[retryAttempts];
    retryAttempts += 1;
    clearDownloadRetry();
    retryTimer = setTimeout(() => {
        retryTimer = null;
        // A failed download needs a fresh check before downloadUpdate() is valid
        // again; the update-available handler restarts the gated auto-download.
        electron_updater_1.autoUpdater.checkForUpdates().catch(() => { });
    }, delay);
    retryTimer.unref?.();
    return true;
}
/**
 * Apply the user's update preferences to electron-updater. `autoUpdater.autoDownload`
 * is deliberately kept `false`: we drive the download ourselves from the
 * `update-available` handler so it can be gated by BOTH the `autoDownload`
 * preference AND license entitlement (§12.4) — electron-updater's own
 * autoDownload has no entitlement hook. `autoInstallOnAppQuit` only installs an
 * already-downloaded update, so it maps straight from the pref (an unentitled
 * user never has a downloaded update to install).
 */
function applyUpdaterPreferences() {
    electron_updater_1.autoUpdater.autoDownload = false;
    const prefs = resolveUpdaterPrefs();
    electron_updater_1.autoUpdater.autoInstallOnAppQuit = prefs.autoInstallOnQuit;
    // Turning auto-download off cancels any pending background-download retry so
    // it can't resurrect the download the user just disabled (§12.8 item 1).
    if (!prefs.autoDownload)
        clearDownloadRetry();
}
/**
 * Start the download for an available update, gated by BOTH the autoDownload
 * preference AND license entitlement — read FRESH each event so an activation /
 * expiry or a settings change takes effect with no restart. Unentitled (expired
 * Pro past their window) or auto-download off → stay at "available" and let the
 * user decide via the pill/dialog. The manual `updater:download` IPC stays
 * ungated — the UI steers expired users to renew.
 */
function maybeAutoDownload(info) {
    if (!resolveUpdaterPrefs().autoDownload)
        return;
    if (!(0, updateEntitlement_1.updateEntitled)(getLicenseInfoFn?.(), info))
        return;
    downloadInFlight = true;
    electron_updater_1.autoUpdater.downloadUpdate().catch(() => {
        // The 'error' event fires for download failures and owns the status update
        // + broadcast + retry scheduling; reporting here too would double-send.
    });
}
// electron-log is not bundled, so write updater events to a file we can inspect
// after a failed update (Linux/AppImage failures are otherwise invisible).
function createUpdaterLogger() {
    const logDir = path_1.default.join(electron_1.app.getPath('userData'), 'logs');
    const logFile = path_1.default.join(logDir, 'updater.log');
    const write = (level, ...args) => {
        const text = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        const line = `[${new Date().toISOString()}] [${level}] ${text}\n`;
        try {
            fs_1.default.mkdirSync(logDir, { recursive: true });
            fs_1.default.appendFileSync(logFile, line);
        }
        catch {
            // Logging must never crash the updater.
        }
        console.log(`[updater] ${level}:`, ...args);
    };
    return {
        info: (...args) => write('info', ...args),
        warn: (...args) => write('warn', ...args),
        error: (...args) => write('error', ...args),
        debug: (...args) => write('debug', ...args),
    };
}
// Turn raw electron-updater errors into something a user can act on.
function formatUpdaterError(error) {
    const message = error?.message ?? String(error);
    if (/app-update\.yml|dev-app-update\.yml/i.test(message)) {
        return 'Update configuration is missing. Software updates are only available in packaged release builds.';
    }
    if (/ERR_UPDATER_NO_FILES_PROVIDED|reading 'info'/i.test(message)) {
        return 'No update package is available for this platform yet. Please try again later.';
    }
    if (/sha512|sha256|checksum/i.test(message)) {
        return 'Update verification failed (checksum mismatch). Please try again later.';
    }
    if (/net::|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET/i.test(message)) {
        return 'Could not reach the update server. Check your internet connection and try again.';
    }
    if (/APPIMAGE/i.test(message)) {
        return 'Automatic updates require the AppImage build. Reinstall from the AppImage to enable updates.';
    }
    return message;
}
function broadcast(status) {
    for (const window of electron_1.BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
            try {
                window.webContents.send(channels_1.CHANNELS.UPDATES_STATUS, status);
            }
            catch {
                // Window/frame disposed mid-send; ignore.
            }
        }
    }
}
/**
 * Record the status snapshot, THEN broadcast (§12.8 item 2). The snapshot is
 * recorded first so late subscribers re-seed the real current state even when
 * every window is gone (macOS closes all windows while a background download
 * keeps progressing).
 */
function sendUpdateStatus(status) {
    lastStatus = status;
    if (status.info)
        lastInfo = status.info;
    if (status.progress)
        lastProgress = status.progress;
    if (status.status === 'not-available') {
        lastInfo = status.info;
        lastProgress = undefined;
    }
    broadcast(status);
}
// Register autoUpdater config + event handlers. Safe to call in dev: checkForUpdates()
// is a no-op there and never emits, so handlers simply stay quiet.
function setupUpdater(deps = {}) {
    if (deps.getLicenseInfo)
        getLicenseInfoFn = deps.getLicenseInfo;
    if (deps.getUpdatePreferences)
        getUpdatePreferencesFn = deps.getUpdatePreferences;
    // Re-apply prefs on every call. macOS re-creates the main window (app
    // 'activate') and re-runs setup; autoUpdater is a process-wide singleton, so
    // only the deps rebinding + this pref refresh may repeat. The event handlers
    // below are registered exactly once (guarded by `configured`) — re-registering
    // would stack duplicates (double downloads, duplicated status events) (§12.8 item 5).
    applyUpdaterPreferences();
    if (configured)
        return;
    configured = true;
    electron_updater_1.autoUpdater.logger = createUpdaterLogger();
    // CI publishes the Windows manifest as latest-windows.yml (not latest.yml), so the
    // updater must look for that channel on win32. mac/linux use the default names.
    if (process.platform === 'win32') {
        electron_updater_1.autoUpdater.channel = 'latest-windows';
    }
    electron_updater_1.autoUpdater.on('checking-for-update', () => sendUpdateStatus({ status: 'checking' }));
    electron_updater_1.autoUpdater.on('update-available', (info) => {
        // A new release supersedes any retry bookkeeping for the previous one.
        if (retryVersion !== info.version) {
            clearDownloadRetry();
            retryVersion = info.version;
            retryAttempts = 0;
            downloadedVersion = null;
        }
        // Already downloaded and handed to the installer this session — do NOT
        // re-download (§12.8 item 3, the ShipIt staging race); just re-assert the
        // terminal state so the pill/dialog don't rewind to "Update available".
        if (downloadedVersion === info.version) {
            sendUpdateStatus({ status: 'downloaded', info });
            return;
        }
        // Broadcast carries `info` verbatim, so any `securityCritical` field the
        // manifest stamped survives onto the renderer's UpdateStatus (§12.4).
        sendUpdateStatus({ status: 'available', info });
        // Pill honesty (§12.3): only start the download when the user is entitled +
        // has auto-download on, so the pill can progress available → downloading →
        // downloaded on its own. Otherwise stay at "available".
        maybeAutoDownload(info);
    });
    electron_updater_1.autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ status: 'not-available', info }));
    electron_updater_1.autoUpdater.on('download-progress', (progress) => {
        downloadInFlight = true;
        sendUpdateStatus({ status: 'downloading', progress });
    });
    electron_updater_1.autoUpdater.on('update-downloaded', (info) => {
        downloadInFlight = false;
        clearDownloadRetry();
        retryAttempts = 0;
        downloadedVersion = info.version;
        sendUpdateStatus({ status: 'downloaded', info });
    });
    electron_updater_1.autoUpdater.on('error', (error) => {
        const wasDownloading = downloadInFlight;
        downloadInFlight = false;
        // Only a dying download gets a retry; failed checks are already re-run by
        // the renderer's interval (§12.8 item 1).
        const retryScheduled = wasDownloading ? scheduleDownloadRetry() : false;
        sendUpdateStatus({ status: 'error', error: formatUpdaterError(error), retryScheduled });
    });
}
/**
 * True while an install handoff (prepare → quitAndInstall → exit backstop) is in
 * progress; makes `updater:install` idempotent so a second "Restart & Install"
 * click can't re-ship the update to Squirrel (§12.8 item 4).
 */
let installHandoffPending = false;
const PREPARE_FOR_INSTALL_DEADLINE_MS = 10_000;
/**
 * Run the install preparation with a deadline: resolves to its result, or
 * `undefined` once the deadline passes (the preparation keeps running in the
 * background — its writes still race ahead of the 3s exit backstop).
 */
async function resolveWithDeadline(run, deadlineMs) {
    if (!run)
        return undefined;
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(run),
            new Promise((resolve) => {
                timer = setTimeout(() => {
                    console.warn(`[updater] prepareForInstall exceeded ${deadlineMs}ms — proceeding with install`);
                    resolve(undefined);
                }, deadlineMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function setupUpdaterIpcHandlers(options = {}) {
    electron_1.ipcMain.handle(channels_1.CHANNELS.UPDATES_CHECK, async () => {
        try {
            const result = await electron_updater_1.autoUpdater.checkForUpdates();
            if (result == null) {
                return { ok: false, error: 'Software updates are only available in packaged release builds.' };
            }
            return { ok: true, updateInfo: result.updateInfo };
        }
        catch (error) {
            const message = formatUpdaterError(error instanceof Error ? error : new Error(String(error)));
            sendUpdateStatus({ status: 'error', error: message });
            return { ok: false, error: message };
        }
    });
    electron_1.ipcMain.handle(channels_1.CHANNELS.UPDATES_DOWNLOAD, async () => {
        // Same re-staging guard as the update-available handler (§12.8 item 3): a
        // version that was already handed to the installer must not be shipped again.
        if (downloadedVersion != null && lastInfo?.version === downloadedVersion) {
            sendUpdateStatus({ status: 'downloaded', info: lastInfo });
            return { ok: true };
        }
        try {
            downloadInFlight = true;
            await electron_updater_1.autoUpdater.downloadUpdate();
            return { ok: true };
        }
        catch (error) {
            const message = formatUpdaterError(error instanceof Error ? error : new Error(String(error)));
            sendUpdateStatus({ status: 'error', error: message });
            return { ok: false, error: message };
        }
    });
    electron_1.ipcMain.handle(channels_1.CHANNELS.UPDATES_GET_STATUS, () => getUpdateStatusSnapshot());
    electron_1.ipcMain.handle(channels_1.CHANNELS.UPDATES_INSTALL, async () => {
        // Single-flight (§12.8 item 4): a second "Restart & Install" click while the
        // first handoff is still driving toward exit must not re-run the prepare hook
        // or re-invoke quitAndInstall (which would re-ship the update to Squirrel —
        // see `downloadedVersion` for the staging race that causes).
        if (installHandoffPending) {
            return { ok: true };
        }
        installHandoffPending = true;
        let rollbackPreparation;
        try {
            // Deadline-capped: if the pre-install persistence hook wedges, the install
            // silently never starts and the exit backstop below is never even
            // scheduled. Past the deadline we proceed with the install; losing
            // pre-install state is recoverable, a blocked update is not.
            const preparation = await resolveWithDeadline(options.prepareForInstall, PREPARE_FOR_INSTALL_DEADLINE_MS);
            rollbackPreparation = typeof preparation === 'function' ? preparation : undefined;
            electron_updater_1.autoUpdater.quitAndInstall(false, true);
        }
        catch (error) {
            installHandoffPending = false;
            rollbackPreparation?.();
            return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
        // Backstop: quitAndInstall sometimes only minimizes the app on macOS
        // (SQRLInstallerError -9 "App Still Running"), so Squirrel's ShipIt aborts
        // the bundle swap and relaunches the OLD version. The external installer was
        // handed the update synchronously above, so a hard exit after a short grace
        // lets it complete the swap. Gated to packaged builds so it can never
        // hard-exit a dev session.
        if (electron_1.app.isPackaged) {
            setTimeout(() => electron_1.app.exit(0), 3000);
        }
        return { ok: true };
    });
    electron_1.ipcMain.handle(channels_1.CHANNELS.UPDATES_GET_VERSION, () => electron_1.app.getVersion());
}
// Fire-and-forget check used for the automatic post-launch check. Errors are logged
// by the updater logger and surfaced to any open update dialog via the status channel.
function checkForUpdatesInBackground() {
    electron_updater_1.autoUpdater.checkForUpdates().catch((error) => {
        electron_updater_1.autoUpdater.logger?.error?.(`Background update check failed: ${String(error)}`);
    });
}
//# sourceMappingURL=updater.js.map