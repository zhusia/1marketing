"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketingBlobAdapter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("../../db");
const AssetService_1 = require("../AssetService");
const crypto_2 = require("./crypto");
const types_1 = require("./types");
const BLOB_CHUNK_SIZE = 8 * 1024 * 1024;
function isWithin(root, candidate) {
    const relative = path_1.default.relative(root, candidate);
    return relative !== '' && !relative.startsWith('..') && !path_1.default.isAbsolute(relative);
}
function fileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto_1.default.createHash('sha256');
        const stream = fs_1.default.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}
function blobId(spaceKey, plaintextHash) {
    return crypto_1.default.createHmac('sha256', spaceKey).update(`stoicsoft-blob-v1\0${plaintextHash}`).digest('base64url');
}
function blobHeader(spaceId, blob, chunkIndex) {
    return {
        format: 'stoicsoft-sync-blob',
        version: 1,
        spaceId,
        blobId: blob.blobId,
        chunkIndex,
        chunkCount: blob.chunkCount,
        plaintextHash: blob.plaintextHash,
    };
}
class MarketingBlobAdapter {
    db;
    constructor(db = (0, db_1.getDb)()) {
        this.db = db;
    }
    async attachReferences(spaceId, records, spaceKey) {
        const root = await fs_1.default.promises.realpath(AssetService_1.assetService.managedRoot());
        for (const record of records) {
            if (record.recordType !== 'asset')
                continue;
            const row = this.db.prepare('SELECT id, mime_type, managed, local_path FROM assets WHERE id = ?').get(record.recordId);
            if (!row?.managed || !row.local_path)
                continue;
            let real;
            let stats;
            try {
                real = await fs_1.default.promises.realpath(row.local_path);
                stats = await fs_1.default.promises.lstat(real);
            }
            catch {
                continue;
            }
            if (!stats.isFile() || stats.isSymbolicLink() || !isWithin(root, real))
                continue;
            const plaintextHash = await fileHash(real);
            const ref = {
                blobId: blobId(spaceKey, plaintextHash),
                byteLength: stats.size,
                mediaType: row.mime_type,
                chunkSize: BLOB_CHUNK_SIZE,
                chunkCount: Math.max(1, Math.ceil(stats.size / BLOB_CHUNK_SIZE)),
                plaintextHash,
            };
            record.blobRefs = [ref];
            const now = Date.now();
            this.db.prepare(`INSERT INTO sync_blob_state (
          space_id, blob_id, record_type, record_id, byte_length, media_type, plaintext_hash, chunk_size, chunk_count,
          local_state, remote_state, local_path, updated_at
        ) VALUES (?, ?, 'asset', ?, ?, ?, ?, ?, ?, 'complete', 'pending', ?, ?)
        ON CONFLICT(space_id, blob_id) DO UPDATE SET record_id = excluded.record_id, byte_length = excluded.byte_length,
          media_type = excluded.media_type, plaintext_hash = excluded.plaintext_hash, chunk_size = excluded.chunk_size,
          chunk_count = excluded.chunk_count, local_state = 'complete', local_path = excluded.local_path,
          updated_at = excluded.updated_at`).run(spaceId, ref.blobId, record.recordId, ref.byteLength, ref.mediaType, ref.plaintextHash, ref.chunkSize, ref.chunkCount, real, now);
        }
    }
    registerRemoteReferences(spaceId, recordType, recordId, refs) {
        const statement = this.db.prepare(`INSERT INTO sync_blob_state (
        space_id, blob_id, record_type, record_id, byte_length, media_type, plaintext_hash, chunk_size, chunk_count,
        local_state, remote_state, local_path, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'missing', 'complete', NULL, ?)
      ON CONFLICT(space_id, blob_id) DO UPDATE SET record_type = excluded.record_type, record_id = excluded.record_id,
        byte_length = excluded.byte_length, media_type = excluded.media_type, plaintext_hash = excluded.plaintext_hash,
        chunk_size = excluded.chunk_size, chunk_count = excluded.chunk_count, remote_state = 'complete',
        updated_at = excluded.updated_at`);
        for (const ref of refs) {
            statement.run(spaceId, ref.blobId, recordType, recordId, ref.byteLength, ref.mediaType, ref.plaintextHash, ref.chunkSize, ref.chunkCount, Date.now());
        }
    }
    async uploadPending(spaceId, transport, spaceKey, signal, onBytes) {
        const rows = this.db.prepare(`SELECT * FROM sync_blob_state WHERE space_id = ? AND local_state = 'complete' AND remote_state != 'complete'`).all(spaceId);
        for (const row of rows) {
            if (signal.aborted)
                throw new types_1.SyncError('cancelled');
            if (!row.local_path)
                continue;
            const handle = await fs_1.default.promises.open(row.local_path, 'r');
            try {
                const ref = this.toRef(row);
                for (let index = 0; index < row.chunk_count; index += 1) {
                    const length = Math.min(row.chunk_size, row.byte_length - index * row.chunk_size);
                    const plaintext = Buffer.alloc(Math.max(0, length));
                    if (length > 0)
                        await handle.read(plaintext, 0, length, index * row.chunk_size);
                    const encrypted = await (0, crypto_2.encryptBlobChunk)(blobHeader(spaceId, ref, index), plaintext, spaceKey);
                    await transport.putBlob(ref, index, encrypted, signal);
                    onBytes(encrypted.length);
                    this.db.prepare('UPDATE sync_blob_state SET transferred_bytes = ?, updated_at = ? WHERE space_id = ? AND blob_id = ?').run(Math.min(row.byte_length, (index + 1) * row.chunk_size), Date.now(), spaceId, row.blob_id);
                }
                this.db.prepare(`UPDATE sync_blob_state SET remote_state = 'complete', verified_at = ?, updated_at = ?, last_error = NULL
           WHERE space_id = ? AND blob_id = ?`).run(Date.now(), Date.now(), spaceId, row.blob_id);
            }
            finally {
                await handle.close();
            }
        }
    }
    async readEncryptedChunk(spaceId, blob, chunkIndex, spaceKey) {
        const row = this.db.prepare(`SELECT * FROM sync_blob_state WHERE space_id = ? AND blob_id = ? AND local_state = 'complete'`).get(spaceId, blob.blobId);
        if (!row?.local_path || chunkIndex < 0 || chunkIndex >= row.chunk_count)
            return null;
        const length = Math.min(row.chunk_size, row.byte_length - chunkIndex * row.chunk_size);
        const plaintext = Buffer.alloc(Math.max(0, length));
        const handle = await fs_1.default.promises.open(row.local_path, 'r');
        try {
            if (length > 0)
                await handle.read(plaintext, 0, length, chunkIndex * row.chunk_size);
            return (0, crypto_2.encryptBlobChunk)(blobHeader(spaceId, blob, chunkIndex), plaintext, spaceKey);
        }
        finally {
            await handle.close();
        }
    }
    async downloadMissing(spaceId, policy, transport, spaceKey, signal, onlyBlobId) {
        if (policy === 'metadata-only' && !onlyBlobId)
            return;
        if (policy === 'on-demand' && !onlyBlobId)
            return;
        const rows = this.db.prepare(`SELECT * FROM sync_blob_state WHERE space_id = ? AND local_state != 'complete'
       AND (? IS NULL OR blob_id = ?) ORDER BY updated_at`).all(spaceId, onlyBlobId ?? null, onlyBlobId ?? null);
        for (const row of rows) {
            const ref = this.toRef(row);
            const directory = path_1.default.join(AssetService_1.assetService.managedRoot(), 'sync', row.record_id);
            await fs_1.default.promises.mkdir(directory, { recursive: true });
            const target = path_1.default.join(directory, `${row.blob_id}.bin`);
            const temp = `${target}.part`;
            let startIndex = 0;
            const partial = await fs_1.default.promises.stat(temp).catch(() => null);
            if (partial?.isFile() && partial.size <= row.byte_length && partial.size % row.chunk_size === 0) {
                startIndex = Math.floor(partial.size / row.chunk_size);
            }
            else if (partial) {
                await fs_1.default.promises.rm(temp, { force: true });
            }
            const handle = await fs_1.default.promises.open(temp, startIndex > 0 ? 'r+' : 'w', 0o600);
            try {
                for (let index = startIndex; index < row.chunk_count; index += 1) {
                    const encrypted = Buffer.from(await transport.getBlob(ref, index, signal));
                    const plaintext = await (0, crypto_2.decryptBlobChunk)(encrypted, blobHeader(spaceId, ref, index), spaceKey);
                    await handle.write(plaintext, 0, plaintext.length, index * row.chunk_size);
                    this.db.prepare('UPDATE sync_blob_state SET transferred_bytes = ?, updated_at = ? WHERE space_id = ? AND blob_id = ?').run(Math.min(row.byte_length, (index + 1) * row.chunk_size), Date.now(), spaceId, row.blob_id);
                }
                await handle.sync();
            }
            catch (error) {
                await handle.close();
                throw error;
            }
            await handle.close();
            const actualHash = await fileHash(temp);
            if (actualHash !== row.plaintext_hash) {
                await fs_1.default.promises.rm(temp, { force: true });
                this.db.prepare(`UPDATE sync_blob_state SET transferred_bytes = 0, last_error = 'Hash verification failed', updated_at = ?
           WHERE space_id = ? AND blob_id = ?`).run(Date.now(), spaceId, row.blob_id);
                throw new types_1.SyncError('blob-corrupt', 'A downloaded media file failed verification.');
            }
            await fs_1.default.promises.rename(temp, target);
            this.db.transaction(() => {
                this.db.prepare(`UPDATE sync_blob_state SET local_state = 'complete', local_path = ?, transferred_bytes = byte_length,
           verified_at = ?, updated_at = ?, last_error = NULL WHERE space_id = ? AND blob_id = ?`).run(target, Date.now(), Date.now(), spaceId, row.blob_id);
                if (row.record_type === 'asset') {
                    this.db.prepare(`UPDATE assets SET local_path = ?, managed = 1, storage = 'local', sync_status = 'synced', sync_error = NULL
             WHERE id = ?`).run(target, row.record_id);
                }
            })();
        }
    }
    list(spaceId) {
        return this.db.prepare(`SELECT blob_id AS blobId, record_type AS recordType, record_id AS recordId, byte_length AS byteLength,
       media_type AS mediaType, local_state AS localState, remote_state AS remoteState,
       transferred_bytes AS transferredBytes, last_error AS lastError, updated_at AS updatedAt
       FROM sync_blob_state WHERE space_id = ? ORDER BY updated_at DESC`).all(spaceId);
    }
    toRef(row) {
        return {
            blobId: row.blob_id,
            byteLength: row.byte_length,
            mediaType: row.media_type,
            chunkSize: row.chunk_size,
            chunkCount: row.chunk_count,
            plaintextHash: row.plaintext_hash,
        };
    }
}
exports.MarketingBlobAdapter = MarketingBlobAdapter;
//# sourceMappingURL=MarketingBlobAdapter.js.map