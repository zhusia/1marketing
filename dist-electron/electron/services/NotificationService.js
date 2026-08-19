"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = exports.NotificationService = void 0;
const electron_1 = require("electron");
const AppRepository_1 = require("./AppRepository");
const BackgroundTaskService_1 = require("./BackgroundTaskService");
const channels_1 = require("../ipc/channels");
const PREFERENCES_KEY = 'notifications.preferences';
const INBOX_LIMIT = 120;
const RETAINED_ROWS = 300;
const DEFAULT_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;
const SEVERITY_RANK = {
    info: 0,
    success: 1,
    warning: 2,
    critical: 3,
};
const DEFAULT_PREFERENCES = {
    desktopEnabled: true,
    minDesktopSeverity: 'warning',
    visibilityDeltaPoints: 10,
};
/**
 * Task kinds whose failure is already reported inline by the view that started them — a second
 * OS banner would be noise. They still land in the inbox, just silently.
 */
const QUIET_TASK_KINDS = new Set(['design.imageGenerate', 'design.generate', 'promptExplorer.explore']);
function severityAtLeast(severity, floor) {
    return SEVERITY_RANK[severity] >= SEVERITY_RANK[floor];
}
function coercePreferences(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return { ...DEFAULT_PREFERENCES };
    const record = value;
    const severity = record.minDesktopSeverity;
    const points = Number(record.visibilityDeltaPoints);
    return {
        desktopEnabled: typeof record.desktopEnabled === 'boolean' ? record.desktopEnabled : DEFAULT_PREFERENCES.desktopEnabled,
        minDesktopSeverity: severity === 'info' || severity === 'success' || severity === 'warning' || severity === 'critical'
            ? severity
            : DEFAULT_PREFERENCES.minDesktopSeverity,
        visibilityDeltaPoints: Number.isFinite(points) && points > 0 ? Math.min(100, Math.round(points)) : DEFAULT_PREFERENCES.visibilityDeltaPoints,
    };
}
/**
 * The app's alert inbox: persists alerts, raises native OS banners, and pushes a snapshot to every
 * renderer window. Sinks that feed it (AI-visibility rules, background-task failures) call `publish`;
 * nothing else in the app should write the `notifications` table directly.
 */
class NotificationService {
    attached = false;
    detachTaskSink = null;
    /** Subscribe to the sinks that generate alerts. Safe to call once, at app start. */
    start() {
        if (this.attached)
            return;
        this.attached = true;
        this.detachTaskSink = BackgroundTaskService_1.backgroundTaskService.onSettled((task) => this.handleSettledTask(task));
    }
    stop() {
        this.detachTaskSink?.();
        this.detachTaskSink = null;
        this.attached = false;
    }
    getPreferences() {
        return coercePreferences(AppRepository_1.repository.getSetting(PREFERENCES_KEY)?.value);
    }
    setPreferences(patch) {
        const next = coercePreferences({ ...this.getPreferences(), ...patch });
        AppRepository_1.repository.setSetting(PREFERENCES_KEY, next);
        this.broadcast();
        return next;
    }
    snapshot() {
        return {
            notifications: AppRepository_1.repository.listNotifications({ limit: INBOX_LIMIT }),
            unreadCount: AppRepository_1.repository.countUnreadNotifications(),
            preferences: this.getPreferences(),
        };
    }
    /**
     * Record an alert and (when it clears the severity floor) raise a native banner.
     * Returns null when the alert was suppressed as a duplicate.
     */
    publish(input) {
        const severity = input.severity ?? 'info';
        const dedupeKey = input.dedupeKey ?? null;
        if (dedupeKey) {
            const window = input.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
            const existing = AppRepository_1.repository.findRecentNotificationByDedupeKey(dedupeKey, Date.now() - window);
            if (existing)
                return null;
        }
        let created;
        try {
            created = AppRepository_1.repository.createNotification({
                kind: input.kind,
                severity,
                title: input.title.trim() || 'Alert',
                body: (input.body ?? '').trim(),
                productId: input.productId ?? null,
                workspaceId: input.workspaceId ?? null,
                route: input.route ?? null,
                meta: input.meta ?? {},
                dedupeKey,
            });
        }
        catch (error) {
            console.error('[notifications] failed to record alert:', error);
            return null;
        }
        AppRepository_1.repository.trimNotifications(RETAINED_ROWS);
        const preferences = this.getPreferences();
        if (!input.silent && preferences.desktopEnabled && severityAtLeast(severity, preferences.minDesktopSeverity)) {
            this.showNativeBanner(created);
        }
        this.broadcast();
        return created;
    }
    markRead(id) {
        AppRepository_1.repository.markNotificationRead(id, true);
        this.broadcast();
        return this.snapshot();
    }
    markAllRead() {
        AppRepository_1.repository.markAllNotificationsRead();
        this.broadcast();
        return this.snapshot();
    }
    remove(id) {
        AppRepository_1.repository.deleteNotification(id);
        this.broadcast();
        return this.snapshot();
    }
    clear() {
        AppRepository_1.repository.clearNotifications();
        this.broadcast();
        return this.snapshot();
    }
    /** Failed background tasks become alerts so a job that dies off-screen is still reported. */
    handleSettledTask(task) {
        if (task.status !== 'failed')
            return;
        const reason = (task.error || task.progress.message || 'The task failed.').trim();
        this.publish({
            kind: 'task.failed',
            severity: 'warning',
            title: `${task.title} failed`,
            body: reason.slice(0, 300),
            productId: task.scope?.productId ?? null,
            workspaceId: task.scope?.workspaceId ?? null,
            meta: { taskId: task.id, taskKind: task.kind },
            // One banner per kind+reason per hour: a sweep that fails every cycle must not spam.
            dedupeKey: `task.failed:${task.kind}:${reason.slice(0, 80)}`,
            dedupeWindowMs: 60 * 60 * 1000,
            silent: QUIET_TASK_KINDS.has(task.kind),
        });
    }
    showNativeBanner(notification) {
        if (!electron_1.Notification.isSupported())
            return;
        try {
            const banner = new electron_1.Notification({
                title: notification.title,
                body: notification.body || 'Open 1MarketingTool for details.',
                silent: notification.severity === 'info',
            });
            banner.on('click', () => {
                const target = electron_1.BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
                if (!target)
                    return;
                if (target.isMinimized())
                    target.restore();
                target.show();
                target.focus();
                AppRepository_1.repository.markNotificationRead(notification.id, true);
                this.broadcast();
                target.webContents.send(channels_1.CHANNELS.NOTIFICATIONS_ACTIVATE, notification);
            });
            banner.show();
        }
        catch (error) {
            console.warn('[notifications] native banner failed:', error);
        }
    }
    broadcast() {
        const snapshot = this.snapshot();
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed())
                win.webContents.send(channels_1.CHANNELS.NOTIFICATIONS_CHANGED, snapshot);
        }
    }
}
exports.NotificationService = NotificationService;
exports.notificationService = new NotificationService();
//# sourceMappingURL=NotificationService.js.map