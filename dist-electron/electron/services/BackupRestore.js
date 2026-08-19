"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingRestoreMarkerPath = pendingRestoreMarkerPath;
exports.processPendingRestore = processPendingRestore;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const PENDING_MARKER = 'pending-restore.json';
const DATABASE_FILE = '1marketingtool.db';
const DATABASE_SIDECARS = ['1marketingtool.db-wal', '1marketingtool.db-shm'];
const RESTORE_DIRS = [
    { archivePath: path_1.default.join('files', 'assets'), targetName: 'assets' },
    { archivePath: path_1.default.join('files', 'directory-exports'), targetName: 'directory-exports' },
    { archivePath: path_1.default.join('files', 'site-audit-exports'), targetName: 'site-audit-exports' },
    { archivePath: path_1.default.join('files', 'published-content'), targetName: 'published-content' },
    { archivePath: path_1.default.join('files', 'browser-extension'), targetName: '1marketingtool-browser-extension' },
];
function pendingRestoreMarkerPath(root) {
    return path_1.default.join(root, PENDING_MARKER);
}
function isInside(parent, candidate) {
    const relative = path_1.default.relative(parent, candidate);
    return !!relative && !relative.startsWith('..') && !path_1.default.isAbsolute(relative);
}
function readMarker(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
        if (parsed.format !== '1marketingtool.pendingRestore' || parsed.version !== 1)
            return null;
        if (!parsed.stagedRoot || !parsed.checkpointRoot || !parsed.token)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function movePathSync(source, target) {
    fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
    try {
        fs_1.default.renameSync(source, target);
    }
    catch {
        fs_1.default.cpSync(source, target, { recursive: true, force: true });
        fs_1.default.rmSync(source, { recursive: true, force: true });
    }
}
function replacePathSync(source, target) {
    fs_1.default.rmSync(target, { recursive: true, force: true });
    if (fs_1.default.existsSync(source)) {
        movePathSync(source, target);
    }
}
function copyReplacePathSync(source, target) {
    fs_1.default.rmSync(target, { recursive: true, force: true });
    if (fs_1.default.existsSync(source)) {
        fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
        fs_1.default.cpSync(source, target, { recursive: true, force: true });
    }
}
function restoreCheckpoint(root, checkpointRoot, dbPath) {
    const checkpointDb = path_1.default.join(checkpointRoot, 'database', DATABASE_FILE);
    if (!fs_1.default.existsSync(checkpointDb)) {
        throw new Error('Backup restore failed and checkpoint database is missing.');
    }
    for (const fileName of [DATABASE_FILE, ...DATABASE_SIDECARS]) {
        fs_1.default.rmSync(path_1.default.join(root, fileName), { force: true });
    }
    fs_1.default.copyFileSync(checkpointDb, dbPath);
    for (const dir of RESTORE_DIRS) {
        copyReplacePathSync(path_1.default.join(checkpointRoot, dir.archivePath), path_1.default.join(root, dir.targetName));
    }
}
function applyStagedRestore(root, marker, dbPath) {
    const pendingRoot = path_1.default.join(root, 'pending-restore');
    const checkpointRoot = path_1.default.join(root, 'backup-checkpoints');
    if (!isInside(pendingRoot, marker.stagedRoot) || !isInside(checkpointRoot, marker.checkpointRoot)) {
        throw new Error('Pending restore marker points outside the app data folder.');
    }
    const stagedDb = path_1.default.join(marker.stagedRoot, 'database', DATABASE_FILE);
    if (!fs_1.default.existsSync(stagedDb)) {
        throw new Error('Pending restore database is missing.');
    }
    for (const fileName of [DATABASE_FILE, ...DATABASE_SIDECARS]) {
        fs_1.default.rmSync(path_1.default.join(root, fileName), { force: true });
    }
    movePathSync(stagedDb, dbPath);
    for (const dir of RESTORE_DIRS) {
        replacePathSync(path_1.default.join(marker.stagedRoot, dir.archivePath), path_1.default.join(root, dir.targetName));
    }
}
function processPendingRestore(root, dbPath) {
    const markerFile = pendingRestoreMarkerPath(root);
    const marker = readMarker(markerFile);
    if (!marker)
        return;
    try {
        applyStagedRestore(root, marker, dbPath);
        fs_1.default.rmSync(markerFile, { force: true });
        fs_1.default.rmSync(marker.stagedRoot, { recursive: true, force: true });
    }
    catch (error) {
        try {
            restoreCheckpoint(root, marker.checkpointRoot, dbPath);
            fs_1.default.rmSync(markerFile, { force: true });
            fs_1.default.rmSync(marker.stagedRoot, { recursive: true, force: true });
        }
        catch (rollbackError) {
            const message = error instanceof Error ? error.message : 'Unknown restore error';
            const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : 'Unknown rollback error';
            throw new Error(`Pending restore failed: ${message}. Rollback failed: ${rollbackMessage}`);
        }
    }
}
//# sourceMappingURL=BackupRestore.js.map