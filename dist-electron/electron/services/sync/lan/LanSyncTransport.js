"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanSyncTransport = void 0;
const db_1 = require("../../../db");
const CredentialVault_1 = require("../../CredentialVault");
const LanCrypto_1 = require("./LanCrypto");
const types_1 = require("../types");
class LanSyncTransport {
    config;
    kind = 'lan';
    capabilities = { durable: false, discovery: true, randomAccess: true, conditionalCreate: true, largeBlobs: true };
    label;
    constructor(config) {
        this.config = config;
        this.label = config.label;
    }
    async request(action, payload, signal) {
        if (signal.aborted)
            throw new types_1.SyncError('cancelled');
        const secret = await CredentialVault_1.credentialVault.getSecret(this.config.secretRef);
        const key = secret?.key ? Buffer.from(secret.key, 'base64') : Buffer.alloc(0);
        if (key.length !== 32)
            throw new types_1.SyncError('peer-untrusted', 'The trusted peer key is unavailable.');
        const row = (0, db_1.getDb)().prepare('SELECT next_out_seq FROM sync_lan_peers WHERE space_id = ? AND device_id = ? AND revoked_at IS NULL').get(this.config.spaceId, this.config.peerDeviceId);
        if (!row)
            throw new types_1.SyncError('peer-revoked', 'This Nearby Sync peer is not trusted.');
        const sequence = row.next_out_seq;
        const ad = `request:${this.config.spaceId}:${this.config.localDeviceId}:${sequence}`;
        const frame = (0, LanCrypto_1.encryptLanFrame)(key, {
            action,
            payload,
            endpoints: (0, LanCrypto_1.validateLanEndpoints)(this.config.localEndpoints),
        }, ad);
        try {
            const endpoints = (0, LanCrypto_1.validateLanEndpoints)(this.config.endpoints);
            let lastError = null;
            for (const endpoint of endpoints) {
                const requestController = new AbortController();
                const abortRequest = () => requestController.abort(signal.reason);
                const timeout = setTimeout(() => requestController.abort(), 3_000);
                signal.addEventListener('abort', abortRequest, { once: true });
                try {
                    const response = await fetch(`${endpoint}/sync/${this.config.spaceId}`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ deviceId: this.config.localDeviceId, sequence, frame }),
                        signal: requestController.signal,
                        redirect: 'error',
                    });
                    if (response.status === 401) {
                        const detail = await response.json().catch(() => null);
                        throw new types_1.SyncError('peer-untrusted', detail?.error || 'Nearby peer rejected this device.');
                    }
                    if (!response.ok)
                        throw new types_1.SyncError('peer-offline', `Nearby peer returned HTTP ${response.status}.`);
                    const body = await response.json();
                    const result = (0, LanCrypto_1.decryptLanFrame)(key, body.frame, `response:${this.config.spaceId}:${this.config.peerDeviceId}:${sequence}`);
                    if (!result.ok)
                        throw new types_1.SyncError('peer-offline', result.error || 'Nearby peer rejected the request.');
                    const preferredEndpoints = [endpoint, ...endpoints.filter((candidate) => candidate !== endpoint)];
                    (0, db_1.getDb)().prepare(`UPDATE sync_lan_peers SET next_out_seq = ?, endpoints_json = ?, last_seen_at = ?, updated_at = ?
             WHERE space_id = ? AND device_id = ?`).run(sequence + 1, JSON.stringify(preferredEndpoints), Date.now(), Date.now(), this.config.spaceId, this.config.peerDeviceId);
                    this.config.endpoints = preferredEndpoints;
                    return result.data;
                }
                catch (error) {
                    if (error instanceof types_1.SyncError && (error.code === 'peer-untrusted' || error.code === 'cancelled'))
                        throw error;
                    lastError = error;
                }
                finally {
                    clearTimeout(timeout);
                    signal.removeEventListener('abort', abortRequest);
                }
            }
            throw new types_1.SyncError('peer-offline', lastError instanceof Error ? lastError.message : 'The Nearby Sync peer is offline on every advertised address.');
        }
        finally {
            key.fill(0);
        }
    }
    async probe(signal) {
        try {
            await this.request('probe', {}, signal);
            return { status: 'healthy', checkedAt: Date.now() };
        }
        catch (error) {
            return { status: 'offline', checkedAt: Date.now(), detail: error instanceof Error ? error.message : 'Peer offline' };
        }
    }
    async readManifest(signal) {
        const value = await this.request('readManifest', {}, signal);
        return value.bytes ? Buffer.from(value.bytes, 'base64') : null;
    }
    async createManifest(bytes, signal) {
        return this.request('createManifest', { bytes: Buffer.from(bytes).toString('base64') }, signal);
    }
    listBatches(signal) {
        return this.request('listBatches', {}, signal);
    }
    async getBatch(ref, signal) {
        const value = await this.request('getBatch', { batchId: ref.batchId }, signal);
        return Buffer.from(value.bytes, 'base64');
    }
    putBatch(ref, bytes, signal) {
        return this.request('putBatch', { ref, bytes: Buffer.from(bytes).toString('base64') }, signal);
    }
    async putDevice(_deviceId, _bytes, signal) {
        await this.request('presence', {}, signal);
    }
    async putAcknowledgement(_deviceId, _bytes, signal) {
        await this.request('acknowledge', {}, signal);
    }
    async getBlob(blob, chunkIndex, signal) {
        const value = await this.request('getBlob', { blob, chunkIndex }, signal);
        return Buffer.from(value.bytes, 'base64');
    }
    putBlob(blob, chunkIndex, bytes, signal) {
        return this.request('putBlob', { blob, chunkIndex, bytes: Buffer.from(bytes).toString('base64') }, signal);
    }
}
exports.LanSyncTransport = LanSyncTransport;
//# sourceMappingURL=LanSyncTransport.js.map