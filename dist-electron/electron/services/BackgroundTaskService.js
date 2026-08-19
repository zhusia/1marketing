"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backgroundTaskService = exports.BackgroundTaskService = void 0;
const crypto_1 = require("crypto");
const electron_1 = require("electron");
const channels_1 = require("../ipc/channels");
const FINAL_STATUSES = ['succeeded', 'failed', 'canceled'];
const MAX_TASKS = 80;
// Progress-only updates are coalesced to at most ~10 IPC emits/second per task; runners
// that report per-item progress in tight loops would otherwise flood every renderer window.
const PROGRESS_EMIT_INTERVAL_MS = 100;
function isFinalStatus(status) {
    return FINAL_STATUSES.includes(status);
}
function shouldExposeResult(task) {
    return (task.kind === 'dashboard.googleSync' ||
        task.kind === 'campaign.postNow' ||
        task.kind === 'campaign.schedule' ||
        // Regeneration returns a small `{ id, provider }` handle for the new piece; keeping it
        // lets a reopened modal or a second window recover the outcome after the task settles.
        task.kind === 'content.regenerate');
}
function cloneTask(task) {
    const { abortController: _abortController, promise: _promise, lastEmitAt: _lastEmitAt, emitTimer: _emitTimer, ...snapshot } = task;
    return {
        ...snapshot,
        result: shouldExposeResult(task) ? snapshot.result : undefined,
        progress: { ...snapshot.progress },
        scope: snapshot.scope ? { ...snapshot.scope } : undefined,
    };
}
class BackgroundTaskService {
    tasks = new Map();
    runners = new Map();
    settledListeners = new Set();
    register(kind, runner) {
        this.runners.set(kind, runner);
    }
    /**
     * Observe tasks reaching a final status. Kept as a listener rather than a direct service call so
     * this module stays dependency-free (NotificationService subscribes; nothing is imported back).
     */
    onSettled(listener) {
        this.settledListeners.add(listener);
        return () => {
            this.settledListeners.delete(listener);
        };
    }
    start(input) {
        const runner = this.runners.get(input.kind);
        if (!runner) {
            throw new Error(`No background task runner is registered for ${input.kind}.`);
        }
        return this.run({
            kind: input.kind,
            title: input.title?.trim() || this.defaultTitle(input.kind),
            input: input.input ?? {},
            scope: input.scope,
            dedupeKey: input.dedupeKey,
        }, (context) => runner(input.input ?? {}, context));
    }
    run(options, runner) {
        const existing = options.dedupeKey ? this.findActiveByDedupeKey(options.dedupeKey) : null;
        if (existing) {
            return cloneTask(existing);
        }
        const now = Date.now();
        const abortController = new AbortController();
        const id = (0, crypto_1.randomUUID)();
        const task = {
            id,
            kind: options.kind,
            title: options.title,
            status: 'queued',
            progress: { done: 0, total: 0, message: 'Queued' },
            input: options.input,
            scope: options.scope,
            dedupeKey: options.dedupeKey,
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            finishedAt: null,
            abortController,
            promise: Promise.resolve(),
            lastEmitAt: 0,
            emitTimer: null,
        };
        this.tasks.set(task.id, task);
        this.trimFinishedTasks();
        this.emitNow(task);
        task.promise = this.execute(task, runner);
        task.promise.catch(() => {
            // Detached tasks report failures through task state; keep Node from treating
            // an intentionally un-awaited background job as an unhandled rejection.
        });
        const release = () => {
            // Release the settled value: large results (rendered MP4/PNG payloads) must not
            // stay pinned in memory for as long as the task entry lives. Snapshot-exposed kinds
            // retain their small result separately so a start-then-wait caller can safely attach
            // after a fast task has already settled.
            task.promise = Promise.resolve(undefined);
        };
        void task.promise.then(release, release);
        return cloneTask(task);
    }
    async runAndWait(options, runner) {
        const task = this.run(options, runner);
        return this.wait(task.id);
    }
    async wait(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            throw new Error('Background task not found.');
        if (isFinalStatus(task.status)) {
            if (task.status === 'failed' || task.status === 'canceled') {
                throw new Error(task.error || task.progress.message || `Task ${task.status}.`);
            }
            if (shouldExposeResult(task))
                return task.result;
        }
        return task.promise;
    }
    list() {
        return Array.from(this.tasks.values())
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map(cloneTask);
    }
    get(taskId) {
        const task = this.tasks.get(taskId);
        return task ? cloneTask(task) : null;
    }
    cancel(taskId) {
        const task = this.tasks.get(taskId);
        if (!task)
            return null;
        if (isFinalStatus(task.status))
            return cloneTask(task);
        task.abortController.abort();
        this.patch(task, {
            progress: {
                ...task.progress,
                message: 'Cancel requested',
            },
        });
        return cloneTask(task);
    }
    update(taskId, progress) {
        const task = this.tasks.get(taskId);
        if (!task || isFinalStatus(task.status))
            return;
        this.patch(task, {
            progress: {
                ...task.progress,
                ...progress,
            },
        }, { coalesce: true });
    }
    async execute(task, runner) {
        this.patch(task, {
            status: 'running',
            startedAt: Date.now(),
            progress: { ...task.progress, message: 'Running' },
        });
        const context = {
            taskId: task.id,
            signal: task.abortController.signal,
            update: (progress) => this.update(task.id, progress),
            setTitle: (title) => {
                const nextTitle = title.trim();
                if (nextTitle)
                    this.patch(task, { title: nextTitle });
            },
        };
        try {
            if (context.signal.aborted)
                throw new Error('Task canceled.');
            const result = await runner(context);
            if (context.signal.aborted) {
                this.patch(task, {
                    status: 'canceled',
                    finishedAt: Date.now(),
                    progress: { ...task.progress, message: 'Canceled' },
                });
                throw new Error('Task canceled.');
            }
            this.patch(task, {
                status: 'succeeded',
                // Only kinds whose results are read from task snapshots keep them; everything
                // else already returned its result through the awaited promise, and keeping a
                // second reference here would pin large payloads for the task entry's lifetime.
                result: shouldExposeResult(task) ? result : undefined,
                finishedAt: Date.now(),
                progress: {
                    ...task.progress,
                    done: task.progress.total || task.progress.done,
                    message: 'Completed',
                },
            });
            return result;
        }
        catch (error) {
            const canceled = context.signal.aborted;
            const message = error instanceof Error ? error.message : 'Task failed.';
            this.patch(task, {
                status: canceled ? 'canceled' : 'failed',
                error: message,
                finishedAt: Date.now(),
                progress: { ...task.progress, message: canceled ? 'Canceled' : message },
            });
            throw error;
        }
    }
    patch(task, patch, options = {}) {
        const wasFinal = isFinalStatus(task.status);
        Object.assign(task, patch, { updatedAt: Date.now() });
        if (options.coalesce)
            this.scheduleEmit(task);
        else
            this.emitNow(task);
        if (!wasFinal && isFinalStatus(task.status))
            this.notifySettled(task);
    }
    notifySettled(task) {
        if (this.settledListeners.size === 0)
            return;
        const snapshot = cloneTask(task);
        for (const listener of this.settledListeners) {
            try {
                listener(snapshot);
            }
            catch (error) {
                console.warn('[tasks] settled listener threw:', error);
            }
        }
    }
    /** Coalesce progress-only updates; the trailing timer emits the latest task state. */
    scheduleEmit(task) {
        const elapsed = Date.now() - task.lastEmitAt;
        if (elapsed >= PROGRESS_EMIT_INTERVAL_MS) {
            this.emitNow(task);
            return;
        }
        if (task.emitTimer)
            return;
        task.emitTimer = setTimeout(() => {
            task.emitTimer = null;
            this.emitNow(task);
        }, PROGRESS_EMIT_INTERVAL_MS - elapsed);
        task.emitTimer.unref?.();
    }
    emitNow(task) {
        if (task.emitTimer) {
            clearTimeout(task.emitTimer);
            task.emitTimer = null;
        }
        task.lastEmitAt = Date.now();
        const snapshot = cloneTask(task);
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send(channels_1.CHANNELS.TASKS_PROGRESS, snapshot);
            }
        }
    }
    findActiveByDedupeKey(dedupeKey) {
        for (const task of this.tasks.values()) {
            if (task.dedupeKey === dedupeKey && !isFinalStatus(task.status))
                return task;
        }
        return null;
    }
    trimFinishedTasks() {
        const tasks = Array.from(this.tasks.values()).sort((left, right) => right.updatedAt - left.updatedAt);
        for (const task of tasks.slice(MAX_TASKS)) {
            if (isFinalStatus(task.status)) {
                if (task.emitTimer) {
                    clearTimeout(task.emitTimer);
                    task.emitTimer = null;
                }
                this.tasks.delete(task.id);
            }
        }
    }
    defaultTitle(kind) {
        return kind
            .split('.')
            .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
            .join(' ');
    }
}
exports.BackgroundTaskService = BackgroundTaskService;
exports.backgroundTaskService = new BackgroundTaskService();
//# sourceMappingURL=BackgroundTaskService.js.map