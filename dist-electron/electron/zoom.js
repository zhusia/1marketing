"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZoomFactor = getZoomFactor;
exports.setZoomFactor = setZoomFactor;
exports.stepZoomFactor = stepZoomFactor;
exports.resetZoomFactor = resetZoomFactor;
const electron_1 = require("electron");
const channels_1 = require("./ipc/channels");
/**
 * Application zoom.
 *
 * The View menu items and the status-bar zoom control both go through here so a
 * single ladder of steps and a single broadcast keep them in sync — whichever
 * one the user drives, the status bar shows the same percentage.
 */
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const DEFAULT_ZOOM = 1;
const EPSILON = 0.001;
function focusedContents() {
    const target = electron_1.BrowserWindow.getFocusedWindow() ?? electron_1.BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
    return target && !target.isDestroyed() ? target.webContents : null;
}
function clamp(factor) {
    if (!Number.isFinite(factor))
        return DEFAULT_ZOOM;
    return Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], factor));
}
/** The rung to land on when stepping `delta` (+1 / -1) away from `factor`. */
function nextStep(factor, delta) {
    if (delta > 0) {
        const found = ZOOM_STEPS.find((step) => step > factor + EPSILON);
        return found ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
    }
    for (let index = ZOOM_STEPS.length - 1; index >= 0; index -= 1) {
        if (ZOOM_STEPS[index] < factor - EPSILON)
            return ZOOM_STEPS[index];
    }
    return ZOOM_STEPS[0];
}
function getZoomFactor(contents) {
    const target = contents ?? focusedContents();
    return target ? target.getZoomFactor() : DEFAULT_ZOOM;
}
function setZoomFactor(factor, contents) {
    const target = contents ?? focusedContents();
    const applied = clamp(factor);
    if (!target)
        return applied;
    target.setZoomFactor(applied);
    target.send(channels_1.CHANNELS.SYSTEM_ZOOM_CHANGED, { factor: applied });
    return applied;
}
function stepZoomFactor(delta, contents) {
    const target = contents ?? focusedContents();
    return setZoomFactor(nextStep(getZoomFactor(target), delta), target);
}
function resetZoomFactor(contents) {
    return setZoomFactor(DEFAULT_ZOOM, contents);
}
//# sourceMappingURL=zoom.js.map