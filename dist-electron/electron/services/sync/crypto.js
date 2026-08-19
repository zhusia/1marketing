"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wipeBuffer = wipeBuffer;
exports.createEncryptedManifest = createEncryptedManifest;
exports.unlockEncryptedManifest = unlockEncryptedManifest;
exports.encryptSyncPayload = encryptSyncPayload;
exports.decryptSyncPayload = decryptSyncPayload;
exports.encryptBlobChunk = encryptBlobChunk;
exports.decryptBlobChunk = decryptBlobChunk;
const crypto_1 = require("crypto");
const canonical_1 = require("./canonical");
const types_1 = require("./types");
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const NONCE_BYTES = 24;
const STREAM_HEADER_BYTES = 24;
const STREAM_OVERHEAD_BYTES = 17;
const PLAINTEXT_CHUNK_BYTES = 64 * 1024;
const MAX_CLEAR_HEADER_BYTES = 16 * 1024;
const MAX_ENCRYPTED_BYTES = 52 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES = 48 * 1024 * 1024;
const KDF_OPSLIMIT = 3;
const KDF_MEMLIMIT_KIB = 262_144;
const KDF_OPSLIMIT_MIN = 2;
const KDF_OPSLIMIT_MAX = 10;
const KDF_MEMLIMIT_KIB_MIN = 65_536;
const KDF_MEMLIMIT_KIB_MAX = 1_048_576;
const ENCRYPTED_MAGIC = Buffer.from('STSYNC01', 'ascii');
const BLOB_MAGIC = Buffer.from('STBLB01', 'ascii');
const MAX_BLOB_CHUNK_BYTES = 16 * 1024 * 1024;
let sodiumPromise = null;
async function loadSodium() {
    if (!sodiumPromise) {
        sodiumPromise = (async () => {
            const sodium = require('libsodium-wrappers-sumo');
            await sodium.ready;
            return sodium;
        })();
    }
    return sodiumPromise;
}
async function deriveKey(passphrase, params) {
    validateKdf(params);
    const sodium = await loadSodium();
    const passphraseBytes = Buffer.from(passphrase, 'utf8');
    try {
        const key = sodium.crypto_pwhash(KEY_BYTES, new Uint8Array(passphraseBytes), new Uint8Array(Buffer.from(params.salt, 'base64')), params.opslimit, params.memlimitKib * 1024, sodium.crypto_pwhash_ALG_ARGON2ID13);
        return Buffer.from(key);
    }
    catch (error) {
        throw new types_1.SyncError('internal', error instanceof Error ? error.message : 'Unable to derive the sync key.');
    }
    finally {
        sodium.memzero(passphraseBytes);
    }
}
async function wipeBuffer(value) {
    if (!value)
        return;
    const sodium = await loadSodium();
    sodium.memzero(value);
}
function recoveryWrappingKey(recoveryKey) {
    return (0, crypto_1.createHash)('sha256')
        .update('stoicsoft-sync-recovery-v1\0')
        .update(recoveryKey.trim())
        .digest();
}
function wrappingAssociatedData(base) {
    return Buffer.from((0, canonical_1.canonicalStringify)(base), 'utf8');
}
function validateKdf(params) {
    const salt = Buffer.from(params.salt, 'base64');
    if (params.algorithm !== 'argon2id13' ||
        params.parametersVersion !== 1 ||
        salt.length !== SALT_BYTES ||
        !Number.isInteger(params.opslimit) ||
        params.opslimit < KDF_OPSLIMIT_MIN ||
        params.opslimit > KDF_OPSLIMIT_MAX ||
        !Number.isInteger(params.memlimitKib) ||
        params.memlimitKib < KDF_MEMLIMIT_KIB_MIN ||
        params.memlimitKib > KDF_MEMLIMIT_KIB_MAX) {
        throw new types_1.SyncError('tampered', 'The sync manifest has unsafe key-derivation parameters.');
    }
}
function validWrappedKey(value) {
    return (value.algorithm === 'xchacha20poly1305' &&
        Buffer.from(value.nonce, 'base64').length === NONCE_BYTES &&
        Buffer.from(value.ciphertext, 'base64').length === KEY_BYTES + 16);
}
async function wrapKey(spaceKey, wrappingKey, ad) {
    const sodium = await loadSodium();
    const nonce = Buffer.from(sodium.randombytes_buf(NONCE_BYTES));
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(new Uint8Array(spaceKey), new Uint8Array(ad), null, new Uint8Array(nonce), new Uint8Array(wrappingKey));
    return {
        algorithm: 'xchacha20poly1305',
        nonce: nonce.toString('base64'),
        ciphertext: Buffer.from(ciphertext).toString('base64'),
    };
}
async function unwrapKey(wrapped, wrappingKey, ad) {
    if (!validWrappedKey(wrapped))
        throw new types_1.SyncError('tampered', 'The wrapped sync key is malformed.');
    const sodium = await loadSodium();
    try {
        const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, new Uint8Array(Buffer.from(wrapped.ciphertext, 'base64')), new Uint8Array(ad), new Uint8Array(Buffer.from(wrapped.nonce, 'base64')), new Uint8Array(wrappingKey));
        if (!plaintext || plaintext.length !== KEY_BYTES)
            throw new Error('invalid key length');
        const result = Buffer.from(plaintext);
        plaintext.fill(0);
        return result;
    }
    catch {
        throw new types_1.SyncError('wrong-passphrase', 'The passphrase or recovery key is incorrect, or the manifest was changed.');
    }
}
async function createEncryptedManifest(spaceId, passphrase, createdAt = Date.now()) {
    if (passphrase.length < 12 || passphrase.length > 1_024) {
        throw new types_1.SyncError('invalid-input', 'Use an encryption passphrase with at least 12 characters.');
    }
    const sodium = await loadSodium();
    const kdf = {
        algorithm: 'argon2id13',
        parametersVersion: 1,
        salt: Buffer.from(sodium.randombytes_buf(SALT_BYTES)).toString('base64'),
        opslimit: KDF_OPSLIMIT,
        memlimitKib: KDF_MEMLIMIT_KIB,
    };
    const base = {
        format: types_1.SYNC_FORMAT,
        protocolVersion: types_1.SYNC_PROTOCOL_VERSION,
        minimumReaderVersion: types_1.SYNC_PROTOCOL_VERSION,
        productId: types_1.SYNC_PRODUCT_ID,
        spaceId,
        mode: 'encrypted',
        createdAt,
        kdf,
    };
    const spaceKey = Buffer.from(sodium.randombytes_buf(KEY_BYTES));
    const recoverySecret = Buffer.from(sodium.randombytes_buf(32));
    const recoveryKey = `STOIC-SYNC-${recoverySecret.toString('base64url')}`;
    sodium.memzero(recoverySecret);
    const passphraseKey = await deriveKey(passphrase, kdf);
    const recoveryKeyBytes = recoveryWrappingKey(recoveryKey);
    const ad = wrappingAssociatedData(base);
    try {
        return {
            manifest: {
                ...base,
                wrappedSpaceKey: await wrapKey(spaceKey, passphraseKey, ad),
                recoveryWrappedSpaceKey: await wrapKey(spaceKey, recoveryKeyBytes, ad),
            },
            spaceKey,
            recoveryKey,
        };
    }
    catch (error) {
        await wipeBuffer(spaceKey);
        throw error;
    }
    finally {
        await wipeBuffer(passphraseKey);
        await wipeBuffer(recoveryKeyBytes);
    }
}
async function unlockEncryptedManifest(manifest, input) {
    validateKdf(manifest.kdf);
    const base = {
        format: manifest.format,
        protocolVersion: manifest.protocolVersion,
        minimumReaderVersion: manifest.minimumReaderVersion,
        productId: manifest.productId,
        spaceId: manifest.spaceId,
        mode: manifest.mode,
        createdAt: manifest.createdAt,
        kdf: manifest.kdf,
    };
    const ad = wrappingAssociatedData(base);
    if (input.recoveryKey?.trim()) {
        const key = recoveryWrappingKey(input.recoveryKey);
        try {
            return await unwrapKey(manifest.recoveryWrappedSpaceKey, key, ad);
        }
        finally {
            await wipeBuffer(key);
        }
    }
    if (!input.passphrase)
        throw new types_1.SyncError('wrong-passphrase', 'Enter the sync passphrase.');
    const key = await deriveKey(input.passphrase, manifest.kdf);
    try {
        return await unwrapKey(manifest.wrappedSpaceKey, key, ad);
    }
    finally {
        await wipeBuffer(key);
    }
}
async function encryptSyncPayload(clearHeader, plaintext, spaceKey) {
    if (spaceKey.length !== KEY_BYTES)
        throw new types_1.SyncError('missing-key', 'The sync space key is unavailable.');
    if (plaintext.length > MAX_PLAINTEXT_BYTES)
        throw new types_1.SyncError('invalid-input', 'The sync payload is too large.');
    const sodium = await loadSodium();
    const header = Buffer.from((0, canonical_1.canonicalStringify)(clearHeader), 'utf8');
    if (header.length > MAX_CLEAR_HEADER_BYTES)
        throw new types_1.SyncError('invalid-input', 'The sync header is too large.');
    const state = sodium.crypto_secretstream_xchacha20poly1305_init_push(new Uint8Array(spaceKey));
    const chunks = [ENCRYPTED_MAGIC];
    const headerLength = Buffer.alloc(4);
    headerLength.writeUInt32LE(header.length, 0);
    chunks.push(headerLength, header, Buffer.from(state.header));
    const frameCount = Math.max(1, Math.ceil(plaintext.length / PLAINTEXT_CHUNK_BYTES));
    for (let index = 0; index < frameCount; index += 1) {
        const start = index * PLAINTEXT_CHUNK_BYTES;
        const end = Math.min(plaintext.length, start + PLAINTEXT_CHUNK_BYTES);
        const part = plaintext.subarray(start, end);
        const final = index === frameCount - 1;
        const ciphertext = Buffer.from(sodium.crypto_secretstream_xchacha20poly1305_push(state.state, new Uint8Array(part), new Uint8Array(header), final ? sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL : sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE));
        const length = Buffer.alloc(4);
        length.writeUInt32LE(ciphertext.length, 0);
        chunks.push(length, ciphertext);
    }
    const encoded = Buffer.concat(chunks);
    if (encoded.length > MAX_ENCRYPTED_BYTES)
        throw new types_1.SyncError('invalid-input', 'The encrypted sync payload is too large.');
    return encoded;
}
async function decryptSyncPayload(input, expectedHeader, spaceKey) {
    if (spaceKey.length !== KEY_BYTES)
        throw new types_1.SyncError('missing-key', 'The sync space key is unavailable.');
    if (input.length <= ENCRYPTED_MAGIC.length + 4 + STREAM_HEADER_BYTES || input.length > MAX_ENCRYPTED_BYTES) {
        throw new types_1.SyncError('tampered', 'The encrypted sync payload is truncated or oversized.');
    }
    if (!input.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC)) {
        throw new types_1.SyncError('tampered', 'The encrypted sync payload has an invalid header.');
    }
    let offset = ENCRYPTED_MAGIC.length;
    const headerLength = input.readUInt32LE(offset);
    offset += 4;
    if (headerLength <= 0 || headerLength > MAX_CLEAR_HEADER_BYTES || offset + headerLength + STREAM_HEADER_BYTES > input.length) {
        throw new types_1.SyncError('tampered', 'The encrypted sync header is malformed.');
    }
    const header = input.subarray(offset, offset + headerLength);
    offset += headerLength;
    if (header.toString('utf8') !== (0, canonical_1.canonicalStringify)(expectedHeader)) {
        throw new types_1.SyncError('tampered', 'The encrypted sync header does not match its object name.');
    }
    const streamHeader = input.subarray(offset, offset + STREAM_HEADER_BYTES);
    offset += STREAM_HEADER_BYTES;
    const sodium = await loadSodium();
    let state;
    try {
        state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(new Uint8Array(streamHeader), new Uint8Array(spaceKey));
    }
    catch {
        throw new types_1.SyncError('tampered', 'The encrypted sync stream cannot be opened.');
    }
    const parts = [];
    let total = 0;
    let sawFinal = false;
    while (offset < input.length) {
        if (sawFinal || offset + 4 > input.length)
            throw new types_1.SyncError('tampered', 'The encrypted sync stream has trailing data.');
        const length = input.readUInt32LE(offset);
        offset += 4;
        if (!Number.isInteger(length) ||
            length < STREAM_OVERHEAD_BYTES ||
            length > PLAINTEXT_CHUNK_BYTES + STREAM_OVERHEAD_BYTES ||
            offset + length > input.length) {
            throw new types_1.SyncError('tampered', 'The encrypted sync stream contains an invalid frame.');
        }
        let result;
        try {
            result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, new Uint8Array(input.subarray(offset, offset + length)), new Uint8Array(header));
        }
        catch {
            throw new types_1.SyncError('tampered', 'The encrypted sync payload failed authentication.');
        }
        offset += length;
        if (!result)
            throw new types_1.SyncError('tampered', 'The encrypted sync payload failed authentication.');
        const plaintext = Buffer.from(result.message);
        total += plaintext.length;
        if (total > MAX_PLAINTEXT_BYTES)
            throw new types_1.SyncError('tampered', 'The decrypted sync payload is too large.');
        parts.push(plaintext);
        sawFinal = result.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL;
    }
    if (!sawFinal)
        throw new types_1.SyncError('tampered', 'The encrypted sync payload is incomplete.');
    return Buffer.concat(parts, total);
}
function deterministicBlobNonce(spaceKey, header) {
    return (0, crypto_1.createHmac)('sha256', spaceKey)
        .update('stoicsoft-sync-blob-nonce-v1\0')
        .update(header)
        .digest()
        .subarray(0, NONCE_BYTES);
}
async function encryptBlobChunk(clearHeader, plaintext, spaceKey) {
    if (spaceKey.length !== KEY_BYTES)
        throw new types_1.SyncError('missing-key', 'The sync space key is unavailable.');
    if (plaintext.length > MAX_BLOB_CHUNK_BYTES)
        throw new types_1.SyncError('invalid-input', 'The media chunk is too large.');
    const sodium = await loadSodium();
    const header = Buffer.from((0, canonical_1.canonicalStringify)(clearHeader));
    if (header.length > MAX_CLEAR_HEADER_BYTES)
        throw new types_1.SyncError('invalid-input', 'The media chunk header is too large.');
    const nonce = deterministicBlobNonce(spaceKey, header);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(new Uint8Array(plaintext), new Uint8Array(header), null, new Uint8Array(nonce), new Uint8Array(spaceKey));
    const headerLength = Buffer.alloc(4);
    headerLength.writeUInt32LE(header.length, 0);
    return Buffer.concat([BLOB_MAGIC, headerLength, header, nonce, Buffer.from(ciphertext)]);
}
async function decryptBlobChunk(input, expectedHeader, spaceKey) {
    if (spaceKey.length !== KEY_BYTES)
        throw new types_1.SyncError('missing-key', 'The sync space key is unavailable.');
    if (input.length < BLOB_MAGIC.length + 4 + NONCE_BYTES + 16 || !input.subarray(0, BLOB_MAGIC.length).equals(BLOB_MAGIC)) {
        throw new types_1.SyncError('blob-corrupt', 'The encrypted media chunk is malformed.');
    }
    let offset = BLOB_MAGIC.length;
    const headerLength = input.readUInt32LE(offset);
    offset += 4;
    if (headerLength <= 0 || headerLength > MAX_CLEAR_HEADER_BYTES || offset + headerLength + NONCE_BYTES + 16 > input.length) {
        throw new types_1.SyncError('blob-corrupt', 'The encrypted media chunk header is malformed.');
    }
    const header = input.subarray(offset, offset + headerLength);
    offset += headerLength;
    if (header.toString('utf8') !== (0, canonical_1.canonicalStringify)(expectedHeader)) {
        throw new types_1.SyncError('blob-corrupt', 'The media chunk does not match its authenticated metadata.');
    }
    const nonce = input.subarray(offset, offset + NONCE_BYTES);
    offset += NONCE_BYTES;
    const expectedNonce = deterministicBlobNonce(spaceKey, header);
    if (!nonce.equals(expectedNonce))
        throw new types_1.SyncError('blob-corrupt', 'The media chunk nonce is invalid.');
    const sodium = await loadSodium();
    try {
        const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, new Uint8Array(input.subarray(offset)), new Uint8Array(header), new Uint8Array(nonce), new Uint8Array(spaceKey));
        if (!plaintext || plaintext.length > MAX_BLOB_CHUNK_BYTES)
            throw new Error('invalid chunk');
        return Buffer.from(plaintext);
    }
    catch {
        throw new types_1.SyncError('blob-corrupt', 'The encrypted media chunk failed authentication.');
    }
}
//# sourceMappingURL=crypto.js.map