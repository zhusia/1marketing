"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBatch = validateBatch;
exports.encodeManifest = encodeManifest;
exports.parseManifest = parseManifest;
exports.encodeBatch = encodeBatch;
exports.decodeBatch = decodeBatch;
exports.batchObjectKey = batchObjectKey;
exports.parseBatchObjectKey = parseBatchObjectKey;
exports.encryptedObjectHash = encryptedObjectHash;
const canonical_1 = require("./canonical");
const crypto_1 = require("./crypto");
const types_1 = require("./types");
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_BATCH_PLAINTEXT_BYTES = 48 * 1024 * 1024;
const MAX_OPERATIONS = 250;
const MAX_RECORD_BYTES = 7 * 1024 * 1024;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH_RE = /^[a-f0-9]{64}$/;
const BATCH_KEY_RE = /^batches\/([a-f0-9-]{36})\/(\d+)-(\d+)-([a-f0-9-]{36})\.bin$/i;
function isPlainObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function validClock(value) {
    if (!isPlainObject(value))
        return false;
    return (Number.isSafeInteger(value.wall) &&
        Number(value.wall) >= 0 &&
        Number.isSafeInteger(value.counter) &&
        Number(value.counter) >= 0 &&
        typeof value.deviceId === 'string' &&
        UUID_RE.test(value.deviceId));
}
function validBlobRef(value) {
    if (!isPlainObject(value))
        return false;
    return (typeof value.blobId === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(value.blobId) &&
        Number.isSafeInteger(value.byteLength) && Number(value.byteLength) >= 0 &&
        typeof value.mediaType === 'string' && value.mediaType.length > 0 && value.mediaType.length <= 200 &&
        Number.isSafeInteger(value.chunkSize) && Number(value.chunkSize) > 0 && Number(value.chunkSize) <= 16 * 1024 * 1024 &&
        Number.isSafeInteger(value.chunkCount) && Number(value.chunkCount) >= 0 && Number(value.chunkCount) <= 1_000_000 &&
        typeof value.plaintextHash === 'string' && HASH_RE.test(value.plaintextHash));
}
function validateOperation(operation, header, expectedSeq) {
    if (operation.protocolVersion !== types_1.SYNC_PROTOCOL_VERSION ||
        operation.productId !== types_1.SYNC_PRODUCT_ID ||
        operation.spaceId !== header.spaceId ||
        operation.originDeviceId !== header.originDeviceId ||
        operation.operationId !== `${operation.originDeviceId}:${operation.deviceSeq}` ||
        operation.deviceSeq !== expectedSeq ||
        typeof operation.recordType !== 'string' || operation.recordType.length < 1 || operation.recordType.length > 80 ||
        typeof operation.recordId !== 'string' || operation.recordId.length < 1 || operation.recordId.length > 2_048 ||
        !Number.isSafeInteger(operation.recordSchemaVersion) || operation.recordSchemaVersion < 1 ||
        (operation.operation !== 'upsert' && operation.operation !== 'delete') ||
        !validClock(operation.clock) ||
        (operation.baseClock !== null && !validClock(operation.baseClock)) ||
        (operation.revivesClock !== null && !validClock(operation.revivesClock)) ||
        typeof operation.payloadHash !== 'string' || !HASH_RE.test(operation.payloadHash) ||
        !Array.isArray(operation.blobRefs) || !operation.blobRefs.every(validBlobRef) ||
        !Number.isSafeInteger(operation.createdAt) || operation.createdAt < 0) {
        throw new types_1.SyncError('tampered', 'A sync operation is malformed.');
    }
    if (operation.operation === 'delete') {
        if (operation.payload !== null || operation.payloadHash !== (0, canonical_1.canonicalHash)(null)) {
            throw new types_1.SyncError('tampered', 'A sync tombstone is malformed.');
        }
        return;
    }
    if (!isPlainObject(operation.payload))
        throw new types_1.SyncError('tampered', 'A sync record payload is malformed.');
    (0, canonical_1.validateJsonLimits)(operation.payload);
    if (Buffer.byteLength((0, canonical_1.canonicalStringify)(operation.payload)) > MAX_RECORD_BYTES) {
        throw new types_1.SyncError('tampered', 'A sync record exceeds the supported size.');
    }
    if ((0, canonical_1.canonicalHash)(operation.payload) !== operation.payloadHash) {
        throw new types_1.SyncError('tampered', 'A sync record hash does not match its content.');
    }
}
function validateBatch(batch) {
    const header = batch.header;
    if (header.format !== types_1.SYNC_FORMAT ||
        header.protocolVersion !== types_1.SYNC_PROTOCOL_VERSION ||
        header.productId !== types_1.SYNC_PRODUCT_ID ||
        !UUID_RE.test(header.spaceId) ||
        !UUID_RE.test(header.batchId) ||
        !UUID_RE.test(header.originDeviceId) ||
        !Number.isSafeInteger(header.firstSeq) || header.firstSeq <= 0 ||
        !Number.isSafeInteger(header.lastSeq) || header.lastSeq < header.firstSeq ||
        !Number.isSafeInteger(header.createdAt) || header.createdAt < 0 ||
        header.operationCount !== batch.operations.length ||
        batch.operations.length < 1 ||
        batch.operations.length > MAX_OPERATIONS ||
        header.lastSeq - header.firstSeq + 1 !== batch.operations.length) {
        throw new types_1.SyncError('tampered', 'The sync batch header is malformed.');
    }
    batch.operations.forEach((operation, index) => validateOperation(operation, header, header.firstSeq + index));
}
function encodeManifest(manifest) {
    const encoded = Buffer.from(`${(0, canonical_1.canonicalStringify)(manifest)}\n`, 'utf8');
    if (encoded.length > MAX_MANIFEST_BYTES)
        throw new types_1.SyncError('invalid-input', 'The sync manifest is too large.');
    return encoded;
}
function parseManifest(input) {
    if (input.length <= 0 || input.length > MAX_MANIFEST_BYTES) {
        throw new types_1.SyncError('tampered', 'The sync manifest is missing or oversized.');
    }
    let value;
    try {
        value = JSON.parse(input.toString('utf8'));
    }
    catch {
        throw new types_1.SyncError('tampered', 'The sync manifest is not valid JSON.');
    }
    if (!isPlainObject(value))
        throw new types_1.SyncError('tampered', 'The sync manifest is malformed.');
    if (value.format !== types_1.SYNC_FORMAT)
        throw new types_1.SyncError('unsupported-protocol', 'This is not a StoicSoft sync space.');
    if (value.productId !== types_1.SYNC_PRODUCT_ID)
        throw new types_1.SyncError('product-mismatch', 'This sync space belongs to another product.');
    if (value.protocolVersion !== types_1.SYNC_PROTOCOL_VERSION ||
        !Number.isSafeInteger(value.minimumReaderVersion) ||
        Number(value.minimumReaderVersion) > types_1.SYNC_PROTOCOL_VERSION) {
        throw new types_1.SyncError('unsupported-protocol', 'Update the app to open this sync space.');
    }
    if (!UUID_RE.test(String(value.spaceId ?? '')) ||
        value.mode !== 'encrypted' ||
        !Number.isSafeInteger(value.createdAt) ||
        !isPlainObject(value.kdf) ||
        !isPlainObject(value.wrappedSpaceKey) ||
        !isPlainObject(value.recoveryWrappedSpaceKey)) {
        throw new types_1.SyncError('tampered', 'The sync manifest is malformed.');
    }
    return value;
}
async function encodeBatch(batch, spaceKey) {
    validateBatch(batch);
    const plaintext = Buffer.from((0, canonical_1.canonicalStringify)(batch), 'utf8');
    if (plaintext.length > MAX_BATCH_PLAINTEXT_BYTES)
        throw new types_1.SyncError('invalid-input', 'The sync batch is too large.');
    return (0, crypto_1.encryptSyncPayload)({ ...batch.header }, plaintext, spaceKey);
}
async function decodeBatch(input, expected, spaceKey) {
    const expectedHeader = {
        format: types_1.SYNC_FORMAT,
        protocolVersion: types_1.SYNC_PROTOCOL_VERSION,
        productId: types_1.SYNC_PRODUCT_ID,
        spaceId: expected.spaceId,
        batchId: expected.batchId,
        originDeviceId: expected.originDeviceId,
        firstSeq: expected.firstSeq,
        lastSeq: expected.lastSeq,
        operationCount: expected.operationCount ?? expected.lastSeq - expected.firstSeq + 1,
        createdAt: expected.createdAt ?? 0,
    };
    let plaintext;
    if (expected.createdAt === undefined) {
        const clearHeader = readClearHeader(input);
        if (!isPlainObject(clearHeader))
            throw new types_1.SyncError('tampered', 'The sync batch header is malformed.');
        Object.assign(expectedHeader, {
            operationCount: Number(clearHeader.operationCount),
            createdAt: Number(clearHeader.createdAt),
        });
    }
    plaintext = await (0, crypto_1.decryptSyncPayload)(input, { ...expectedHeader }, spaceKey);
    let batch;
    try {
        batch = JSON.parse(plaintext.toString('utf8'));
    }
    catch {
        throw new types_1.SyncError('tampered', 'The decrypted sync batch is malformed.');
    }
    validateBatch(batch);
    if (batch.header.spaceId !== expected.spaceId ||
        batch.header.batchId !== expected.batchId ||
        batch.header.originDeviceId !== expected.originDeviceId ||
        batch.header.firstSeq !== expected.firstSeq ||
        batch.header.lastSeq !== expected.lastSeq) {
        throw new types_1.SyncError('tampered', 'The sync batch does not match its object name.');
    }
    return batch;
}
function readClearHeader(input) {
    if (input.length < 12 || input.subarray(0, 8).toString('ascii') !== 'STSYNC01') {
        throw new types_1.SyncError('tampered', 'The encrypted sync batch header is invalid.');
    }
    const length = input.readUInt32LE(8);
    if (length <= 0 || length > 16 * 1024 || 12 + length > input.length) {
        throw new types_1.SyncError('tampered', 'The encrypted sync batch header is malformed.');
    }
    try {
        return JSON.parse(input.subarray(12, 12 + length).toString('utf8'));
    }
    catch {
        throw new types_1.SyncError('tampered', 'The encrypted sync batch header is malformed.');
    }
}
function batchObjectKey(ref) {
    return `batches/${ref.originDeviceId}/${ref.firstSeq}-${ref.lastSeq}-${ref.batchId}.bin`;
}
function parseBatchObjectKey(key, byteLength, etag) {
    const match = BATCH_KEY_RE.exec(key);
    if (!match)
        return null;
    const firstSeq = Number(match[2]);
    const lastSeq = Number(match[3]);
    if (!Number.isSafeInteger(firstSeq) || !Number.isSafeInteger(lastSeq) || firstSeq <= 0 || lastSeq < firstSeq) {
        return null;
    }
    return {
        key,
        originDeviceId: match[1],
        firstSeq,
        lastSeq,
        batchId: match[4],
        byteLength,
        ...(etag ? { etag } : {}),
    };
}
function encryptedObjectHash(bytes) {
    return (0, canonical_1.sha256)(bytes);
}
//# sourceMappingURL=protocol.js.map