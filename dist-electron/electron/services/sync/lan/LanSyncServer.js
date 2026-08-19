"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanSyncServer = void 0;
const http_1 = __importDefault(require("http"));
const os_1 = __importDefault(require("os"));
const crypto_1 = require("crypto");
const db_1 = require("../../../db");
const CredentialVault_1 = require("../../CredentialVault");
const canonical_1 = require("../canonical");
const LanCrypto_1 = require("./LanCrypto");
const types_1 = require("../types");
const MAX_BODY_BYTES = 70 * 1024 * 1024;
const PAIRING_TTL_MS = 10 * 60_000;
function json(response, status, value) {
    const bytes = Buffer.from(JSON.stringify(value));
    response.writeHead(status, { 'content-type': 'application/json', 'content-length': String(bytes.length), 'cache-control': 'no-store' });
    response.end(bytes);
}
function readJson(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        request.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new types_1.SyncError('invalid-input', 'Nearby request is too large.'));
                request.destroy();
            }
            else
                chunks.push(chunk);
        });
        request.on('end', () => {
            try {
                const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    throw new Error('invalid JSON object');
                resolve(value);
            }
            catch {
                reject(new types_1.SyncError('invalid-input', 'Nearby request is malformed.'));
            }
        });
        request.on('error', reject);
    });
}
function addresses(port) {
    const output = [];
    for (const [name, group] of Object.entries(os_1.default.networkInterfaces())) {
        const virtual = /virtual|vethernet|wsl|docker|vmware|bridge|utun|awdl|llw/i.test(name);
        for (const item of group ?? []) {
            if (item.family === 'IPv4' && !item.internal) {
                output.push({ endpoint: `http://${item.address}:${port}`, priority: virtual ? 1 : 0 });
            }
        }
    }
    output.push({ endpoint: `http://127.0.0.1:${port}`, priority: 2 });
    output.sort((left, right) => left.priority - right.priority || left.endpoint.localeCompare(right.endpoint));
    return Array.from(new Set(output.map((item) => item.endpoint)));
}
function parseCode(code) {
    if (!code.startsWith('STOIC-LAN1.'))
        throw new types_1.SyncError('invalid-input', 'This is not a StoicSoft Nearby code.');
    try {
        const value = JSON.parse(Buffer.from(code.slice('STOIC-LAN1.'.length), 'base64url').toString('utf8'));
        if (typeof value.sessionId !== 'string' || typeof value.secret !== 'string' || typeof value.publicKey !== 'string' ||
            !Array.isArray(value.endpoints) || !value.endpoints.every((item) => typeof item === 'string') ||
            typeof value.deviceId !== 'string' || typeof value.deviceName !== 'string')
            throw new Error('bad code');
        return { ...value, endpoints: (0, LanCrypto_1.validateLanEndpoints)(value.endpoints) };
    }
    catch {
        throw new types_1.SyncError('invalid-input', 'The Nearby code is malformed or incomplete.');
    }
}
class LanSyncServer {
    options;
    server = null;
    endpoints = [];
    hostSession = null;
    joinSession = null;
    constructor(options) {
        this.options = options;
    }
    async start() {
        if (this.server)
            return this.endpoints;
        this.server = http_1.default.createServer((request, response) => void this.route(request, response));
        await new Promise((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(0, '0.0.0.0', () => resolve());
        });
        const address = this.server.address();
        if (!address || typeof address === 'string')
            throw new types_1.SyncError('firewall-blocked', 'Could not open a Nearby Sync port.');
        this.endpoints = addresses(address.port);
        return this.endpoints;
    }
    async stop() {
        this.clearSessions();
        const server = this.server;
        this.server = null;
        this.endpoints = [];
        if (server) {
            server.closeIdleConnections();
            server.closeAllConnections();
            await new Promise((resolve) => server.close(() => resolve()));
        }
    }
    async startHosting(membership) {
        const endpoints = await this.start();
        membership.hostEndpoints = endpoints;
        this.clearSessions();
        const device = this.options.localDevice();
        const sessionId = (0, crypto_1.randomUUID)();
        const secret = (0, crypto_1.randomBytes)(32);
        const keyPair = (0, LanCrypto_1.createLanKeyPair)();
        const expiresAt = Date.now() + PAIRING_TTL_MS;
        const codeValue = {
            sessionId,
            secret: secret.toString('base64url'),
            publicKey: keyPair.publicKey,
            endpoints,
            deviceId: device.id,
            deviceName: device.name,
        };
        const code = `STOIC-LAN1.${Buffer.from((0, canonical_1.canonicalStringify)(codeValue)).toString('base64url')}`;
        this.hostSession = { sessionId, secret, keyPair, expiresAt, code, membership, request: null, confirmed: false };
        return this.pairingStatus();
    }
    async beginJoin(code) {
        await this.start();
        this.clearSessions();
        const parsed = parseCode(code.trim());
        const device = this.options.localDevice();
        const pair = (0, LanCrypto_1.createLanKeyPair)();
        const key = (0, LanCrypto_1.derivePairingKey)(pair, parsed.publicKey, Buffer.from(parsed.secret, 'base64url'), parsed.sessionId);
        const transcript = {
            sessionId: parsed.sessionId,
            hostPublicKey: parsed.publicKey,
            joinPublicKey: pair.publicKey,
            hostDeviceId: parsed.deviceId,
            joinDeviceId: device.id,
            joinEndpoints: this.endpoints,
        };
        let responseBody = null;
        let endpoint = '';
        for (const candidate of parsed.endpoints) {
            try {
                const response = await fetch(`${candidate}/pair/join`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        ...transcript,
                        deviceName: device.name,
                        platform: device.platform,
                        proof: (0, LanCrypto_1.lanProof)(key, transcript, 'joiner'),
                    }),
                    redirect: 'error',
                });
                if (!response.ok)
                    continue;
                responseBody = await response.json();
                endpoint = candidate;
                break;
            }
            catch {
                // Try another advertised local address.
            }
        }
        if (!responseBody || !endpoint) {
            key.fill(0);
            throw new types_1.SyncError('peer-offline', 'The other device is not reachable on this network.');
        }
        if (!(0, LanCrypto_1.verifyLanProof)(key, transcript, 'host', String(responseBody.proof ?? ''))) {
            key.fill(0);
            throw new types_1.SyncError('peer-untrusted', 'The other device failed pairing authentication.');
        }
        this.joinSession = {
            role: 'joiner',
            requestId: String(responseBody.requestId),
            endpoint,
            sessionId: parsed.sessionId,
            key,
            fingerprint: (0, LanCrypto_1.pairingFingerprint)(key),
            peerDeviceId: parsed.deviceId,
            peerDeviceName: parsed.deviceName,
            expiresAt: Date.now() + PAIRING_TTL_MS,
            confirmed: false,
        };
        return this.pairingStatus();
    }
    pairingStatus() {
        if (this.hostSession) {
            return {
                role: 'host', code: this.hostSession.code, expiresAt: this.hostSession.expiresAt,
                fingerprint: this.hostSession.request?.fingerprint ?? null,
                peerDeviceId: this.hostSession.request?.deviceId ?? null,
                peerDeviceName: this.hostSession.request?.deviceName ?? null,
                confirmed: this.hostSession.confirmed,
                endpoint: this.endpoints[0] ?? null,
            };
        }
        if (this.joinSession) {
            return {
                role: 'joiner', code: '', expiresAt: this.joinSession.expiresAt, fingerprint: this.joinSession.fingerprint,
                peerDeviceId: this.joinSession.peerDeviceId, peerDeviceName: this.joinSession.peerDeviceName,
                confirmed: this.joinSession.confirmed, endpoint: this.joinSession.endpoint,
            };
        }
        return null;
    }
    async confirm() {
        if (this.hostSession) {
            if (!this.hostSession.request)
                throw new types_1.SyncError('peer-offline', 'Wait for the other device to enter the pairing code.');
            this.hostSession.confirmed = true;
            return this.pairingStatus();
        }
        const session = this.joinSession;
        if (!session)
            throw new types_1.SyncError('invalid-input', 'No Nearby pairing is active.');
        const response = await fetch(`${session.endpoint}/pair/package`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: session.sessionId, requestId: session.requestId }),
            redirect: 'error',
        });
        if (response.status === 425)
            throw new types_1.SyncError('peer-offline', 'Confirm the matching fingerprint on the other device first.');
        if (!response.ok)
            throw new types_1.SyncError('peer-offline', 'The other device cancelled or expired the pairing request.');
        const body = await response.json();
        const membership = (0, LanCrypto_1.decryptLanFrame)(session.key, body.frame, `pair-package:${session.sessionId}:${session.requestId}`);
        await this.options.onJoinMembership(membership, session.key);
        session.confirmed = true;
        return this.pairingStatus();
    }
    cancelPairing() {
        this.clearSessions();
    }
    clearSessions() {
        this.hostSession?.secret.fill(0);
        this.hostSession?.request?.key.fill(0);
        this.joinSession?.key.fill(0);
        this.hostSession = null;
        this.joinSession = null;
    }
    async route(request, response) {
        try {
            if (request.method !== 'POST')
                return json(response, 405, { error: 'method not allowed' });
            if (request.url === '/pair/join')
                return await this.handlePairJoin(request, response);
            if (request.url === '/pair/package')
                return await this.handlePairPackage(request, response);
            const syncMatch = /^\/sync\/([a-f0-9-]{36})$/i.exec(request.url ?? '');
            if (syncMatch)
                return await this.handleSync(syncMatch[1], request, response);
            json(response, 404, { error: 'not found' });
        }
        catch (error) {
            const mapped = error instanceof types_1.SyncError ? error : new types_1.SyncError('internal', error instanceof Error ? error.message : 'Nearby request failed.');
            json(response, mapped.code === 'peer-untrusted' ? 401 : 400, { error: mapped.message });
        }
    }
    async handlePairJoin(request, response) {
        const session = this.hostSession;
        if (!session || session.expiresAt < Date.now())
            throw new types_1.SyncError('peer-offline', 'The pairing session expired.');
        const body = await readJson(request);
        if (body.sessionId !== session.sessionId)
            throw new types_1.SyncError('peer-untrusted');
        const device = this.options.localDevice();
        const joinEndpoints = (0, LanCrypto_1.validateLanEndpoints)(body.joinEndpoints);
        const transcript = {
            sessionId: session.sessionId,
            hostPublicKey: session.keyPair.publicKey,
            joinPublicKey: String(body.joinPublicKey),
            hostDeviceId: device.id,
            joinDeviceId: String(body.joinDeviceId),
            joinEndpoints,
        };
        const key = (0, LanCrypto_1.derivePairingKey)(session.keyPair, String(body.joinPublicKey), session.secret, session.sessionId);
        if (!(0, LanCrypto_1.verifyLanProof)(key, transcript, 'joiner', String(body.proof ?? ''))) {
            key.fill(0);
            throw new types_1.SyncError('peer-untrusted', 'The pairing proof did not match.');
        }
        session.request?.key.fill(0);
        const requestId = (0, crypto_1.randomUUID)();
        session.request = {
            requestId,
            deviceId: String(body.joinDeviceId),
            deviceName: String(body.deviceName || 'Nearby device'),
            platform: String(body.platform || 'unknown'),
            endpoints: joinEndpoints,
            publicKey: String(body.joinPublicKey),
            key,
            fingerprint: (0, LanCrypto_1.pairingFingerprint)(key),
        };
        json(response, 200, { requestId, proof: (0, LanCrypto_1.lanProof)(key, transcript, 'host') });
    }
    async handlePairPackage(request, response) {
        const session = this.hostSession;
        const body = await readJson(request);
        if (!session || !session.request || body.sessionId !== session.sessionId || body.requestId !== session.request.requestId) {
            throw new types_1.SyncError('peer-untrusted', 'The pairing request is no longer valid.');
        }
        if (!session.confirmed)
            return json(response, 425, { error: 'awaiting confirmation' });
        await this.options.onHostPeerConfirmed({
            spaceId: session.membership.spaceId,
            deviceId: session.request.deviceId,
            deviceName: session.request.deviceName,
            platform: session.request.platform,
            endpoints: session.request.endpoints,
            key: session.request.key,
        });
        const frame = (0, LanCrypto_1.encryptLanFrame)(session.request.key, session.membership, `pair-package:${session.sessionId}:${session.request.requestId}`);
        json(response, 200, { frame });
    }
    async handleSync(spaceId, request, response) {
        const body = await readJson(request);
        const deviceId = String(body.deviceId ?? '');
        const sequence = Number(body.sequence);
        const peer = (0, db_1.getDb)().prepare('SELECT * FROM sync_lan_peers WHERE space_id = ? AND device_id = ? AND revoked_at IS NULL').get(spaceId, deviceId);
        if (!peer || !Number.isSafeInteger(sequence))
            throw new types_1.SyncError('peer-untrusted');
        if (sequence < peer.last_in_seq) {
            throw new types_1.SyncError('peer-untrusted', 'Nearby request counter moved backward. Pair this device again.');
        }
        const secret = await CredentialVault_1.credentialVault.getSecret(peer.secret_ref);
        const key = secret?.key ? Buffer.from(secret.key, 'base64') : Buffer.alloc(0);
        if (key.length !== 32)
            throw new types_1.SyncError('peer-untrusted');
        try {
            const frame = body.frame;
            const message = (0, LanCrypto_1.decryptLanFrame)(key, frame, `request:${spaceId}:${deviceId}:${sequence}`);
            // The listener uses an ephemeral port, so a trusted peer advertises its current
            // addresses on every authenticated request. This lets the reverse direction
            // recover after either app or machine restarts without requiring a new pairing.
            const peerEndpoints = message.endpoints === undefined ? null : (0, LanCrypto_1.validateLanEndpoints)(message.endpoints);
            const data = await this.dispatchSync(spaceId, message.action, message.payload);
            const now = Date.now();
            (0, db_1.getDb)().prepare(`UPDATE sync_lan_peers SET last_in_seq = MAX(last_in_seq, ?),
           endpoints_json = COALESCE(?, endpoints_json), last_seen_at = ?, updated_at = ?
         WHERE space_id = ? AND device_id = ?`).run(sequence, peerEndpoints ? (0, canonical_1.canonicalStringify)(peerEndpoints) : null, now, now, spaceId, deviceId);
            const local = this.options.localDevice();
            const responseFrame = (0, LanCrypto_1.encryptLanFrame)(key, { ok: true, data }, `response:${spaceId}:${local.id}:${sequence}`);
            json(response, 200, { frame: responseFrame });
        }
        finally {
            key.fill(0);
        }
    }
    async dispatchSync(spaceId, action, payload) {
        if (action === 'probe' || action === 'presence' || action === 'acknowledge')
            return { ok: true };
        const transport = (0, db_1.getDb)().prepare(`SELECT id, config_json FROM sync_transports WHERE space_id = ? AND kind = 'lan' AND enabled = 1 LIMIT 1`).get(spaceId);
        if (!transport)
            throw new types_1.SyncError('peer-revoked');
        const config = JSON.parse(transport.config_json);
        if (action === 'readManifest')
            return { bytes: typeof config.manifestBase64 === 'string' ? config.manifestBase64 : null };
        if (action === 'createManifest') {
            if (config.manifestBase64)
                return 'exists';
            config.manifestBase64 = String(payload.bytes);
            (0, db_1.getDb)().prepare('UPDATE sync_transports SET config_json = ?, updated_at = ? WHERE id = ?')
                .run((0, canonical_1.canonicalStringify)(config), Date.now(), transport.id);
            return 'created';
        }
        if (action === 'listBatches')
            return this.listBatches(spaceId);
        if (action === 'getBatch') {
            const row = (0, db_1.getDb)().prepare(`SELECT encrypted_bytes FROM sync_outbound_batches WHERE space_id = ? AND batch_id = ?
         UNION ALL SELECT encrypted_bytes FROM sync_lan_inbox WHERE space_id = ? AND batch_id = ? LIMIT 1`).get(spaceId, String(payload.batchId), spaceId, String(payload.batchId));
            if (!row)
                throw new types_1.SyncError('batch-sequence-gap', 'The requested Nearby batch is unavailable.');
            return { bytes: row.encrypted_bytes.toString('base64') };
        }
        if (action === 'putBatch') {
            const ref = payload.ref;
            const bytes = Buffer.from(String(payload.bytes), 'base64');
            const existing = (0, db_1.getDb)().prepare('SELECT file_hash FROM sync_lan_inbox WHERE space_id = ? AND batch_id = ?')
                .get(spaceId, ref.batchId);
            const hash = (0, canonical_1.sha256)(bytes);
            if (existing) {
                if (existing.file_hash !== hash)
                    throw new types_1.SyncError('batch-id-collision');
                return 'exists-same';
            }
            (0, db_1.getDb)().prepare(`INSERT INTO sync_lan_inbox (
          space_id, batch_id, origin_device_id, first_seq, last_seq, file_hash, encrypted_bytes,
          received_from_device_id, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(spaceId, ref.batchId, ref.originDeviceId, ref.firstSeq, ref.lastSeq, hash, bytes, ref.originDeviceId, Date.now());
            return 'created';
        }
        if (action === 'putBlob') {
            const blob = payload.blob;
            const index = Number(payload.chunkIndex);
            const bytes = Buffer.from(String(payload.bytes), 'base64');
            const hash = (0, canonical_1.sha256)(bytes);
            const existing = (0, db_1.getDb)().prepare('SELECT file_hash FROM sync_lan_blob_inbox WHERE space_id = ? AND blob_id = ? AND chunk_index = ?').get(spaceId, blob.blobId, index);
            if (existing) {
                if (existing.file_hash !== hash)
                    throw new types_1.SyncError('batch-id-collision');
                return 'exists-same';
            }
            (0, db_1.getDb)().prepare('INSERT INTO sync_lan_blob_inbox (space_id, blob_id, chunk_index, encrypted_bytes, file_hash, received_at) VALUES (?, ?, ?, ?, ?, ?)').run(spaceId, blob.blobId, index, bytes, hash, Date.now());
            return 'created';
        }
        if (action === 'getBlob') {
            const blob = payload.blob;
            const index = Number(payload.chunkIndex);
            const inbox = (0, db_1.getDb)().prepare('SELECT encrypted_bytes FROM sync_lan_blob_inbox WHERE space_id = ? AND blob_id = ? AND chunk_index = ?').get(spaceId, blob.blobId, index);
            const bytes = inbox?.encrypted_bytes ?? await this.options.readLocalBlobChunk(spaceId, blob, index);
            if (!bytes)
                throw new types_1.SyncError('blob-missing');
            return { bytes: bytes.toString('base64') };
        }
        throw new types_1.SyncError('invalid-input', 'Unsupported Nearby Sync action.');
    }
    listBatches(spaceId) {
        const rows = (0, db_1.getDb)().prepare(`SELECT batch_id, origin_device_id, first_seq, last_seq, length(encrypted_bytes) AS byte_length
       FROM sync_outbound_batches WHERE space_id = ?
       UNION ALL
       SELECT batch_id, origin_device_id, first_seq, last_seq, length(encrypted_bytes) AS byte_length
       FROM sync_lan_inbox WHERE space_id = ?`).all(spaceId, spaceId);
        const seen = new Set();
        return rows.filter((row) => !seen.has(row.batch_id) && Boolean(seen.add(row.batch_id))).map((row) => ({
            key: `batches/${row.origin_device_id}/${row.first_seq}-${row.last_seq}-${row.batch_id}.bin`,
            batchId: row.batch_id,
            originDeviceId: row.origin_device_id,
            firstSeq: row.first_seq,
            lastSeq: row.last_seq,
            byteLength: row.byte_length,
        })).sort((left, right) => left.originDeviceId.localeCompare(right.originDeviceId) || left.firstSeq - right.firstSeq);
    }
}
exports.LanSyncServer = LanSyncServer;
//# sourceMappingURL=LanSyncServer.js.map