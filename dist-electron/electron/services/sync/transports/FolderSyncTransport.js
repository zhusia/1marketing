"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FolderSyncTransport = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const protocol_1 = require("../protocol");
const types_1 = require("../types");
const MAX_STABLE_READ_ATTEMPTS = 4;
function abortIfNeeded(signal) {
    if (signal.aborted)
        throw new types_1.SyncError('cancelled', 'Sync was cancelled.');
}
function wait(milliseconds, signal) {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new types_1.SyncError('cancelled', 'Sync was cancelled.'));
            return;
        }
        const timer = setTimeout(resolve, milliseconds);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new types_1.SyncError('cancelled', 'Sync was cancelled.'));
        }, { once: true });
    });
}
class FolderSyncTransport {
    kind = 'folder';
    capabilities = {
        durable: true,
        discovery: false,
        randomAccess: true,
        conditionalCreate: true,
        largeBlobs: true,
    };
    label;
    root;
    constructor(rootPath, label = 'Synced folder') {
        this.root = path_1.default.resolve(rootPath);
        this.label = label;
    }
    resolve(relative) {
        if (!relative || relative.includes('\0') || path_1.default.isAbsolute(relative)) {
            throw new types_1.SyncError('unsafe-folder', 'The sync object path is unsafe.');
        }
        const normalized = relative.replace(/\\/g, '/');
        if (normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
            throw new types_1.SyncError('unsafe-folder', 'The sync object path is unsafe.');
        }
        const target = path_1.default.resolve(this.root, ...normalized.split('/'));
        if (target !== this.root && !target.startsWith(`${this.root}${path_1.default.sep}`)) {
            throw new types_1.SyncError('unsafe-folder', 'The sync object escapes the configured folder.');
        }
        return target;
    }
    async ensureSafeDirectory(directory) {
        const rootStats = await fs_1.default.promises.lstat(this.root);
        if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
            throw new types_1.SyncError('unsafe-folder', 'The sync root is not a safe directory.');
        }
        const relative = path_1.default.relative(this.root, directory);
        let current = this.root;
        for (const part of relative.split(path_1.default.sep).filter(Boolean)) {
            current = path_1.default.join(current, part);
            let stats = await fs_1.default.promises.lstat(current).catch((error) => {
                if (error.code === 'ENOENT')
                    return null;
                throw error;
            });
            if (!stats) {
                await fs_1.default.promises.mkdir(current, { mode: 0o700 });
                stats = await fs_1.default.promises.lstat(current);
            }
            if (!stats.isDirectory() || stats.isSymbolicLink()) {
                throw new types_1.SyncError('unsafe-folder', 'A sync folder component is a symbolic link or non-directory.');
            }
        }
    }
    async assertSafeParents(target) {
        await this.ensureSafeDirectory(path_1.default.dirname(target));
    }
    async stableRead(relative, signal) {
        const target = this.resolve(relative);
        await this.assertSafeParents(target);
        for (let attempt = 0; attempt < MAX_STABLE_READ_ATTEMPTS; attempt += 1) {
            abortIfNeeded(signal);
            let before;
            try {
                before = await fs_1.default.promises.lstat(target);
            }
            catch (error) {
                if (error.code === 'ENOENT')
                    throw new types_1.SyncError('folder-unavailable', 'The sync object is not available yet.');
                throw error;
            }
            if (!before.isFile() || before.isSymbolicLink())
                throw new types_1.SyncError('unsafe-folder', 'The sync object is not a regular file.');
            const bytes = await fs_1.default.promises.readFile(target);
            await wait(120, signal);
            const after = await fs_1.default.promises.lstat(target);
            if (before.size === after.size && before.mtimeMs === after.mtimeMs && bytes.length === after.size)
                return bytes;
        }
        throw new types_1.SyncError('folder-unavailable', 'The cloud provider has not finished downloading this sync object.');
    }
    async writeImmutable(relative, bytes, signal) {
        abortIfNeeded(signal);
        const target = this.resolve(relative);
        await this.ensureSafeDirectory(path_1.default.dirname(target));
        const existing = await fs_1.default.promises.readFile(target).catch((error) => {
            if (error.code === 'ENOENT')
                return null;
            throw error;
        });
        if (existing) {
            if ((0, protocol_1.encryptedObjectHash)(existing) === (0, protocol_1.encryptedObjectHash)(bytes))
                return 'exists-same';
            throw new types_1.SyncError('batch-id-collision', 'An immutable sync object already exists with different bytes.');
        }
        const temp = `${target}.${process.pid}.${(0, crypto_1.randomUUID)()}.tmp`;
        let handle = null;
        try {
            handle = await fs_1.default.promises.open(temp, 'wx', 0o600);
            await handle.writeFile(bytes);
            await handle.sync();
            await handle.close();
            handle = null;
            abortIfNeeded(signal);
            try {
                await fs_1.default.promises.link(temp, target);
            }
            catch (error) {
                const code = error.code;
                if (code === 'EEXIST') {
                    const raced = await fs_1.default.promises.readFile(target);
                    if ((0, protocol_1.encryptedObjectHash)(raced) === (0, protocol_1.encryptedObjectHash)(bytes))
                        return 'exists-same';
                    throw new types_1.SyncError('batch-id-collision', 'An immutable sync object was published concurrently with different bytes.');
                }
                if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EXDEV') {
                    try {
                        await fs_1.default.promises.copyFile(temp, target, fs_1.default.constants.COPYFILE_EXCL);
                    }
                    catch (copyError) {
                        if (copyError.code !== 'EEXIST')
                            throw copyError;
                        const raced = await fs_1.default.promises.readFile(target);
                        if ((0, protocol_1.encryptedObjectHash)(raced) === (0, protocol_1.encryptedObjectHash)(bytes))
                            return 'exists-same';
                        throw new types_1.SyncError('batch-id-collision', 'An immutable sync object was published concurrently with different bytes.');
                    }
                }
                else {
                    throw error;
                }
            }
            return 'created';
        }
        catch (error) {
            const code = error.code;
            if (error instanceof types_1.SyncError)
                throw error;
            if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
                throw new types_1.SyncError('folder-read-only', 'The selected sync folder is read-only.');
            }
            if (code === 'ENOSPC' || code === 'EDQUOT')
                throw new types_1.SyncError('quota-full', 'The selected sync folder is full.');
            throw new types_1.SyncError('folder-unavailable', error instanceof Error ? error.message : 'The sync folder is unavailable.');
        }
        finally {
            await handle?.close().catch(() => undefined);
            await fs_1.default.promises.rm(temp, { force: true }).catch(() => undefined);
        }
    }
    async writeMutable(relative, bytes, signal) {
        abortIfNeeded(signal);
        const target = this.resolve(relative);
        await this.ensureSafeDirectory(path_1.default.dirname(target));
        const temp = `${target}.${process.pid}.${(0, crypto_1.randomUUID)()}.tmp`;
        try {
            const handle = await fs_1.default.promises.open(temp, 'wx', 0o600);
            try {
                await handle.writeFile(bytes);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            abortIfNeeded(signal);
            await fs_1.default.promises.rename(temp, target);
        }
        catch (error) {
            const code = error.code;
            if (code === 'EROFS' || code === 'EACCES' || code === 'EPERM') {
                throw new types_1.SyncError('folder-read-only', 'The selected sync folder is read-only.');
            }
            if (code === 'ENOSPC' || code === 'EDQUOT')
                throw new types_1.SyncError('quota-full', 'The selected sync folder is full.');
            if (error instanceof types_1.SyncError)
                throw error;
            throw new types_1.SyncError('folder-unavailable', error instanceof Error ? error.message : 'The sync folder is unavailable.');
        }
        finally {
            await fs_1.default.promises.rm(temp, { force: true }).catch(() => undefined);
        }
    }
    async probe(signal) {
        abortIfNeeded(signal);
        try {
            await fs_1.default.promises.mkdir(this.root, { recursive: true });
            const stats = await fs_1.default.promises.lstat(this.root);
            if (!stats.isDirectory() || stats.isSymbolicLink())
                throw new types_1.SyncError('unsafe-folder', 'The sync target is not a safe folder.');
            // Canonicalize platform-level aliases such as macOS /var -> /private/var once, then keep every
            // subsequent object and parent check contained beneath the real directory.
            this.root = await fs_1.default.promises.realpath(this.root);
            await fs_1.default.promises.access(this.root, fs_1.default.constants.R_OK | fs_1.default.constants.W_OK);
            return { status: 'healthy', checkedAt: Date.now() };
        }
        catch (error) {
            if (error instanceof types_1.SyncError)
                throw error;
            const code = error.code;
            return {
                status: code === 'EACCES' || code === 'EROFS' ? 'read-only' : 'unavailable',
                checkedAt: Date.now(),
                detail: error instanceof Error ? error.message : 'Folder unavailable',
            };
        }
    }
    async readManifest(signal) {
        abortIfNeeded(signal);
        if (!fs_1.default.existsSync(this.resolve('manifest.json')))
            return null;
        return this.stableRead('manifest.json', signal);
    }
    async createManifest(bytes, signal) {
        const result = await this.writeImmutable('manifest.json', bytes, signal);
        return result === 'created' ? 'created' : 'exists';
    }
    async listBatches(signal) {
        abortIfNeeded(signal);
        const batchesRoot = this.resolve('batches');
        await this.ensureSafeDirectory(batchesRoot);
        const origins = await fs_1.default.promises.readdir(batchesRoot, { withFileTypes: true }).catch((error) => {
            if (error.code === 'ENOENT')
                return [];
            throw error;
        });
        const output = [];
        for (const origin of origins) {
            abortIfNeeded(signal);
            if (!origin.isDirectory() || origin.isSymbolicLink() || !/^[a-f0-9-]{36}$/i.test(origin.name))
                continue;
            const entries = await fs_1.default.promises.readdir(path_1.default.join(batchesRoot, origin.name), { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile() || entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name.includes('.tmp'))
                    continue;
                const key = `batches/${origin.name}/${entry.name}`;
                const stats = await fs_1.default.promises.lstat(this.resolve(key));
                const parsed = (0, protocol_1.parseBatchObjectKey)(key, stats.size);
                if (parsed)
                    output.push(parsed);
            }
        }
        return output.sort((left, right) => left.originDeviceId.localeCompare(right.originDeviceId) || left.firstSeq - right.firstSeq);
    }
    async getBatch(ref, signal) {
        return this.stableRead(ref.key, signal);
    }
    putBatch(ref, bytes, signal) {
        return this.writeImmutable(`batches/${ref.originDeviceId}/${ref.firstSeq}-${ref.lastSeq}-${ref.batchId}.bin`, bytes, signal);
    }
    putDevice(deviceId, bytes, signal) {
        return this.writeMutable(`devices/${deviceId}.bin`, bytes, signal);
    }
    putAcknowledgement(deviceId, bytes, signal) {
        return this.writeMutable(`acknowledgements/${deviceId}.bin`, bytes, signal);
    }
    getBlob(blob, chunkIndex, signal) {
        return this.stableRead(`blobs/v1/${blob.blobId.slice(0, 2)}/${blob.blobId}/${chunkIndex}.bin`, signal);
    }
    putBlob(blob, chunkIndex, bytes, signal) {
        return this.writeImmutable(`blobs/v1/${blob.blobId.slice(0, 2)}/${blob.blobId}/${chunkIndex}.bin`, bytes, signal);
    }
}
exports.FolderSyncTransport = FolderSyncTransport;
//# sourceMappingURL=FolderSyncTransport.js.map