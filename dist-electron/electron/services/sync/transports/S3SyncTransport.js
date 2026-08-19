"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3SyncTransport = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const protocol_1 = require("../protocol");
const types_1 = require("../types");
function abortIfNeeded(signal) {
    if (signal.aborted)
        throw new types_1.SyncError('cancelled', 'Sync was cancelled.');
}
function isPreconditionFailure(error) {
    const candidate = error;
    return (candidate?.$metadata?.httpStatusCode === 409 ||
        candidate?.$metadata?.httpStatusCode === 412 ||
        candidate?.name === 'PreconditionFailed' ||
        candidate?.Code === 'PreconditionFailed');
}
function mapS3Error(error) {
    if (error instanceof types_1.SyncError)
        return error;
    const candidate = error;
    const status = candidate?.$metadata?.httpStatusCode;
    if (status === 401 || status === 403 || candidate?.name === 'InvalidAccessKeyId' || candidate?.name === 'SignatureDoesNotMatch') {
        return new types_1.SyncError('storage-auth-failed', 'The S3 credentials do not have access to this bucket.');
    }
    if (isPreconditionFailure(error)) {
        return new types_1.SyncError('storage-precondition-failed', 'The S3 object changed during a conditional write.');
    }
    return new types_1.SyncError('folder-unavailable', error instanceof Error ? error.message : 'The object-storage provider is unavailable.');
}
class S3SyncTransport {
    kind = 's3';
    capabilities = {
        durable: true,
        discovery: false,
        randomAccess: true,
        conditionalCreate: true,
        largeBlobs: true,
    };
    label;
    client;
    config;
    constructor(config, label = 'S3-compatible storage') {
        this.config = config;
        this.label = label;
        this.client = new client_s3_1.S3Client({
            region: config.region || 'auto',
            ...(config.endpoint ? { endpoint: config.endpoint } : {}),
            credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
            },
            forcePathStyle: config.forcePathStyle ?? config.provider === 'minio',
        });
    }
    key(relative) {
        const safe = relative.replace(/^\/+/, '');
        if (!safe || safe.includes('..') || safe.includes('\0') || safe.includes('\\')) {
            throw new types_1.SyncError('invalid-input', 'The object-storage key is unsafe.');
        }
        const prefix = this.config.rootPrefix.replace(/^\/+|\/+$/g, '');
        return `${prefix}/${safe}`;
    }
    relative(key) {
        const prefix = `${this.config.rootPrefix.replace(/^\/+|\/+$/g, '')}/`;
        return key.startsWith(prefix) ? key.slice(prefix.length) : null;
    }
    async get(relative, signal) {
        abortIfNeeded(signal);
        try {
            const response = await this.client.send(new client_s3_1.GetObjectCommand({ Bucket: this.config.bucket, Key: this.key(relative) }), { abortSignal: signal });
            if (!response.Body)
                throw new types_1.SyncError('folder-unavailable', 'The object-storage response was empty.');
            return Buffer.from(await response.Body.transformToByteArray());
        }
        catch (error) {
            throw mapS3Error(error);
        }
    }
    async putImmutable(relative, bytes, signal) {
        abortIfNeeded(signal);
        try {
            await this.client.send(new client_s3_1.PutObjectCommand({
                Bucket: this.config.bucket,
                Key: this.key(relative),
                Body: bytes,
                ContentType: 'application/octet-stream',
                IfNoneMatch: '*',
            }), { abortSignal: signal });
            return 'created';
        }
        catch (error) {
            if (!isPreconditionFailure(error))
                throw mapS3Error(error);
            const existing = await this.get(relative, signal);
            if ((0, protocol_1.encryptedObjectHash)(existing) === (0, protocol_1.encryptedObjectHash)(bytes))
                return 'exists-same';
            throw new types_1.SyncError('batch-id-collision', 'An immutable S3 object already exists with different bytes.');
        }
    }
    async putMutable(relative, bytes, signal) {
        abortIfNeeded(signal);
        try {
            await this.client.send(new client_s3_1.PutObjectCommand({
                Bucket: this.config.bucket,
                Key: this.key(relative),
                Body: bytes,
                ContentType: 'application/octet-stream',
            }), { abortSignal: signal });
        }
        catch (error) {
            throw mapS3Error(error);
        }
    }
    async probe(signal) {
        try {
            await this.client.send(new client_s3_1.ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: this.key('batches/'), MaxKeys: 1 }), { abortSignal: signal });
            return { status: 'healthy', checkedAt: Date.now() };
        }
        catch (error) {
            const mapped = mapS3Error(error);
            return {
                status: mapped.code === 'storage-auth-failed' ? 'auth-failed' : 'offline',
                checkedAt: Date.now(),
                detail: mapped.message,
            };
        }
    }
    async readManifest(signal) {
        try {
            const response = await this.client.send(new client_s3_1.GetObjectCommand({ Bucket: this.config.bucket, Key: this.key('manifest.json') }), { abortSignal: signal });
            if (!response.Body)
                throw new types_1.SyncError('folder-unavailable', 'The object-storage response was empty.');
            return Buffer.from(await response.Body.transformToByteArray());
        }
        catch (error) {
            const candidate = error;
            if (candidate?.name === 'NoSuchKey' || candidate?.Code === 'NoSuchKey' || candidate?.$metadata?.httpStatusCode === 404)
                return null;
            throw mapS3Error(error);
        }
    }
    async createManifest(bytes, signal) {
        const result = await this.putImmutable('manifest.json', bytes, signal);
        return result === 'created' ? 'created' : 'exists';
    }
    async listBatches(signal) {
        const output = [];
        const seenTokens = new Set();
        let token;
        do {
            abortIfNeeded(signal);
            let response;
            try {
                response = await this.client.send(new client_s3_1.ListObjectsV2Command({
                    Bucket: this.config.bucket,
                    Prefix: this.key('batches/'),
                    ContinuationToken: token,
                    MaxKeys: 1_000,
                }), { abortSignal: signal });
            }
            catch (error) {
                throw mapS3Error(error);
            }
            for (const item of response.Contents ?? []) {
                if (!item.Key || !Number.isSafeInteger(item.Size))
                    continue;
                const relative = this.relative(item.Key);
                if (!relative)
                    continue;
                const parsed = (0, protocol_1.parseBatchObjectKey)(relative, item.Size ?? 0, item.ETag?.replaceAll('"', ''));
                if (parsed)
                    output.push(parsed);
            }
            token = response.IsTruncated ? response.NextContinuationToken : undefined;
            if (token && seenTokens.has(token))
                break;
            if (token)
                seenTokens.add(token);
        } while (token && output.length < 10_000);
        return output.sort((left, right) => left.originDeviceId.localeCompare(right.originDeviceId) || left.firstSeq - right.firstSeq);
    }
    getBatch(ref, signal) {
        return this.get(ref.key, signal);
    }
    putBatch(ref, bytes, signal) {
        return this.putImmutable(`batches/${ref.originDeviceId}/${ref.firstSeq}-${ref.lastSeq}-${ref.batchId}.bin`, bytes, signal);
    }
    putDevice(deviceId, bytes, signal) {
        return this.putMutable(`devices/${deviceId}.bin`, bytes, signal);
    }
    putAcknowledgement(deviceId, bytes, signal) {
        return this.putMutable(`acknowledgements/${deviceId}.bin`, bytes, signal);
    }
    getBlob(blob, chunkIndex, signal) {
        return this.get(`blobs/v1/${blob.blobId.slice(0, 2)}/${blob.blobId}/${chunkIndex}.bin`, signal);
    }
    putBlob(blob, chunkIndex, bytes, signal) {
        return this.putImmutable(`blobs/v1/${blob.blobId.slice(0, 2)}/${blob.blobId}/${chunkIndex}.bin`, bytes, signal);
    }
    destroy() {
        this.client.destroy();
    }
}
exports.S3SyncTransport = S3SyncTransport;
//# sourceMappingURL=S3SyncTransport.js.map