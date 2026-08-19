"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncLifecycleService = exports.SyncLifecycleService = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
const crypto_1 = require("crypto");
const electron_1 = require("electron");
const db_1 = require("../../db");
const CredentialVault_1 = require("../CredentialVault");
const LicenseService_1 = require("../LicenseService");
const canonical_1 = require("./canonical");
const crypto_2 = require("./crypto");
const MarketingBlobAdapter_1 = require("./MarketingBlobAdapter");
const MarketingRecordCatalog_1 = require("./MarketingRecordCatalog");
const protocol_1 = require("./protocol");
const SyncStateRepository_1 = require("./SyncStateRepository");
const merge_1 = require("./merge");
const FolderSyncTransport_1 = require("./transports/FolderSyncTransport");
const S3SyncTransport_1 = require("./transports/S3SyncTransport");
const LanSyncTransport_1 = require("./lan/LanSyncTransport");
const LanSyncServer_1 = require("./lan/LanSyncServer");
const types_1 = require("./types");
const CYCLE_INTERVAL_MS = 60_000;
const SPACE_KEY_PREFIX = 'sync:space:';
const S3_SECRET_PREFIX = 'sync:s3:';
const CONTROL_RECORD_TYPES = new Set(MarketingRecordCatalog_1.MARKETING_RECORD_CATALOG.filter((adapter) => adapter.control).map((adapter) => adapter.recordType));
function asSyncError(error) {
    if (error instanceof types_1.SyncError)
        return error;
    return new types_1.SyncError('internal', error instanceof Error ? error.message : 'Sync failed.');
}
function spaceFolder(basePath, spaceId) {
    return path_1.default.join(path_1.default.resolve(basePath), '.stoicsoft-sync', types_1.SYNC_PRODUCT_ID, spaceId);
}
function normalizedPrefix(prefix, spaceId) {
    const base = (prefix ?? '').replace(/^\/+|\/+$/g, '');
    return [base, '.stoicsoft-sync', types_1.SYNC_PRODUCT_ID, spaceId].filter(Boolean).join('/');
}
function parseConfig(row) {
    try {
        const value = JSON.parse(row.config_json);
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }
    catch {
        return {};
    }
}
function localDevice() {
    const info = LicenseService_1.licenseService.getLicenseInfo();
    return {
        id: info.currentDeviceId || (0, crypto_1.randomUUID)(),
        name: info.deviceName || os_1.default.hostname() || 'This device',
    };
}
class SyncLifecycleService extends events_1.EventEmitter {
    state = new SyncStateRepository_1.SyncStateRepository();
    blobs = new MarketingBlobAdapter_1.MarketingBlobAdapter();
    interval = null;
    activeCycle = null;
    rerunRequested = false;
    abortController = null;
    folderWatcher = null;
    folderWatchTimer = null;
    resumeHandler = null;
    unsubscribeLicense = null;
    lanServer = new LanSyncServer_1.LanSyncServer({
        localDevice: () => {
            const device = localDevice();
            return { ...device, platform: process.platform };
        },
        onHostPeerConfirmed: (input) => this.persistLanPeer(input),
        onJoinMembership: (membership, key) => this.acceptLanMembership(membership, key),
        readLocalBlobChunk: (spaceId, blob, chunkIndex) => this.readLanBlobChunk(spaceId, blob, chunkIndex),
    });
    start() {
        if (this.interval)
            return;
        this.interval = setInterval(() => {
            if (this.state.getSpace() && LicenseService_1.licenseService.getLicenseInfo().isLicensed)
                void this.runCycle('interval').catch(() => undefined);
        }, CYCLE_INTERVAL_MS);
        this.interval.unref();
        if (this.state.getSpace() && LicenseService_1.licenseService.getLicenseInfo().isLicensed) {
            setTimeout(() => void this.runCycle('startup').catch(() => undefined), 2_000).unref();
        }
        if (this.state.getSpace()?.nearby_enabled)
            void this.lanServer.start().catch(() => undefined);
        this.startFolderWatcher();
        this.resumeHandler = () => void this.runCycle('resume').catch(() => undefined);
        electron_1.powerMonitor.on('resume', this.resumeHandler);
        this.unsubscribeLicense = LicenseService_1.licenseService.onChange((snapshot) => {
            if (!snapshot.info.isLicensed)
                this.cancelCycle();
            void this.getStatus().then((next) => this.emit('status', next));
        });
    }
    async stop() {
        if (this.interval)
            clearInterval(this.interval);
        this.interval = null;
        this.abortController?.abort();
        this.folderWatcher?.close();
        this.folderWatcher = null;
        if (this.folderWatchTimer)
            clearTimeout(this.folderWatchTimer);
        this.folderWatchTimer = null;
        if (this.resumeHandler)
            electron_1.powerMonitor.removeListener('resume', this.resumeHandler);
        this.resumeHandler = null;
        this.unsubscribeLicense?.();
        this.unsubscribeLicense = null;
        await this.activeCycle?.catch(() => undefined);
        await this.lanServer.stop();
        this.removeAllListeners();
    }
    onAppFocus() {
        if (this.state.getSpace() && LicenseService_1.licenseService.getLicenseInfo().isLicensed) {
            void this.runCycle('focus').catch(() => undefined);
        }
    }
    assertPro() {
        const access = LicenseService_1.licenseService.canUseSync();
        if (!access.allowed) {
            throw new types_1.SyncError('requires-pro', access.reason ?? 'Cross-device sync requires Pro on this device.');
        }
    }
    async getStatus() {
        const licenseInfo = LicenseService_1.licenseService.getLicenseInfo();
        const licensed = licenseInfo.isLicensed;
        const entitlement = licensed ? licenseInfo.graceUntil ? 'grace' : 'pro' : 'free';
        const space = this.state.getSpace();
        if (!space) {
            return {
                surface: licensed ? 'choose-transport' : 'pro-required',
                entitlement,
                lifecycle: 'disconnected',
                spaceId: null,
                spaceName: null,
                primaryTransport: null,
                nearbyEnabled: false,
                paused: false,
                currentDeviceId: null,
                currentDeviceName: null,
                deviceCount: 0,
                onlineDeviceCount: 0,
                queuedRecordCount: 0,
                queuedBlobBytes: 0,
                unresolvedConflictCount: 0,
                stagedChangeCount: 0,
                lastSuccessAt: null,
                lastErrorCode: null,
                lastErrorDetail: null,
                blobPolicy: 'on-demand',
                syncMode: 'auto',
                localRole: 'admin',
                disabledScopes: [],
                automationDeviceId: null,
                cycleRunning: Boolean(this.activeCycle),
            };
        }
        const counts = this.state.counts(space.id);
        const devices = this.state.listDevices(space);
        const owner = this.automationOwner(space.id);
        const hasNearbyPeer = devices.some((device) => !device.isCurrent && !device.retiredAt);
        const transportReady = Boolean(space.durable_transport) || hasNearbyPeer;
        return {
            surface: 'overview',
            entitlement: licensed ? entitlement : 'expired',
            lifecycle: !licensed || space.paused ? 'paused' : space.last_error_code || !transportReady ? 'attention' : 'connected',
            spaceId: space.id,
            spaceName: space.display_name,
            primaryTransport: space.durable_transport ?? (space.nearby_enabled ? 'lan' : null),
            nearbyEnabled: Boolean(space.nearby_enabled),
            paused: Boolean(space.paused),
            currentDeviceId: space.local_device_id,
            currentDeviceName: space.local_device_name,
            deviceCount: devices.length,
            onlineDeviceCount: devices.filter((device) => Date.now() - device.lastSeenAt < 120_000 && !device.retiredAt).length,
            queuedRecordCount: counts.queued,
            queuedBlobBytes: counts.blobBytes,
            unresolvedConflictCount: counts.conflicts,
            stagedChangeCount: counts.staged,
            lastSuccessAt: space.last_sync_at,
            lastErrorCode: space.last_error_code,
            lastErrorDetail: space.last_error_detail ?? (!transportReady ? 'Pair a second device to start this LAN-only sync space.' : null),
            blobPolicy: space.blob_policy,
            syncMode: space.sync_mode,
            localRole: this.state.roleFor(space.id, space.local_device_id),
            disabledScopes: [...this.disabledScopeSet(space)],
            automationDeviceId: owner,
            cycleRunning: Boolean(this.activeCycle),
        };
    }
    async suggestFolders() {
        const home = os_1.default.homedir();
        const candidates = [
            { kind: 'icloud', label: 'iCloud Drive', path: path_1.default.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs') },
            { kind: 'onedrive', label: 'OneDrive', path: path_1.default.join(home, 'OneDrive') },
            { kind: 'dropbox', label: 'Dropbox', path: path_1.default.join(home, 'Dropbox') },
            { kind: 'nextcloud', label: 'Nextcloud', path: path_1.default.join(home, 'Nextcloud') },
            { kind: 'syncthing', label: 'Syncthing', path: path_1.default.join(home, 'Sync') },
        ];
        const available = [];
        for (const candidate of candidates) {
            if (await fs_1.default.promises.stat(candidate.path).then((item) => item.isDirectory()).catch(() => false))
                available.push(candidate);
        }
        return available;
    }
    async pickFolder() {
        const result = await electron_1.dialog.showOpenDialog({
            title: 'Choose a sync folder',
            properties: ['openDirectory', 'createDirectory'],
            buttonLabel: 'Choose folder',
        });
        return result.canceled ? null : result.filePaths[0] ?? null;
    }
    async inspectTarget(targetPath) {
        const resolved = path_1.default.resolve(targetPath);
        const result = {
            targetPath: resolved,
            safe: false,
            writable: false,
            provider: this.detectProvider(resolved),
            existingSpaces: [],
            errorCode: null,
            detail: null,
        };
        try {
            await fs_1.default.promises.mkdir(resolved, { recursive: true });
            const stats = await fs_1.default.promises.lstat(resolved);
            if (!stats.isDirectory() || stats.isSymbolicLink())
                throw new types_1.SyncError('unsafe-folder', 'Choose a regular folder, not a symbolic link.');
            result.safe = true;
            await fs_1.default.promises.access(resolved, fs_1.default.constants.R_OK | fs_1.default.constants.W_OK);
            result.writable = true;
            const manifests = await this.findFolderManifests(resolved);
            for (const manifestPath of manifests) {
                try {
                    const manifest = (0, protocol_1.parseManifest)(await fs_1.default.promises.readFile(manifestPath));
                    result.existingSpaces.push({
                        spaceId: manifest.spaceId,
                        productId: manifest.productId,
                        protocolVersion: manifest.protocolVersion,
                        createdAt: manifest.createdAt,
                        path: path_1.default.dirname(manifestPath),
                    });
                }
                catch {
                    // Invalid or another product's files are not join candidates.
                }
            }
        }
        catch (error) {
            const mapped = asSyncError(error);
            result.errorCode = mapped.code;
            result.detail = mapped.message;
        }
        return result;
    }
    async createFolderSpace(input) {
        this.assertPro();
        this.assertDisconnected();
        const inspection = await this.inspectTarget(input.targetPath);
        if (!inspection.safe || !inspection.writable)
            throw new types_1.SyncError(inspection.errorCode ?? 'folder-read-only', inspection.detail ?? undefined);
        const device = localDevice();
        const spaceId = (0, crypto_1.randomUUID)();
        const target = spaceFolder(input.targetPath, spaceId);
        const transport = new FolderSyncTransport_1.FolderSyncTransport(target, inspection.provider);
        const { manifest, spaceKey, recoveryKey } = await (0, crypto_2.createEncryptedManifest)(spaceId, input.passphrase);
        try {
            const health = await transport.probe(new AbortController().signal);
            if (health.status !== 'healthy')
                throw new types_1.SyncError('folder-unavailable', health.detail);
            const manifestBytes = (0, protocol_1.encodeManifest)(manifest);
            await transport.createManifest(manifestBytes, new AbortController().signal);
            const space = this.state.createSpace({
                id: spaceId,
                displayName: input.displayName.trim() || 'My marketing workspace',
                durableTransport: 'folder',
                nearbyEnabled: false,
                deviceId: device.id,
                deviceName: device.name,
                manifestHash: (0, canonical_1.sha256)(manifestBytes),
                seedAdminRole: true,
            });
            this.state.addTransport({ spaceId, kind: 'folder', config: { path: target, label: inspection.provider } });
            this.startFolderWatcher();
            await this.storeSpaceKey(spaceId, spaceKey);
            this.setAutomationOwnerInternal(space, null);
            void this.runCycle('setup').catch(() => undefined);
            return { status: await this.getStatus(), recoveryKey, target };
        }
        finally {
            await (0, crypto_2.wipeBuffer)(spaceKey);
        }
    }
    async joinFolderSpace(input) {
        this.assertPro();
        this.assertDisconnected();
        const inspection = await this.inspectTarget(input.targetPath);
        const exactManifest = path_1.default.join(path_1.default.resolve(input.targetPath), 'manifest.json');
        const target = fs_1.default.existsSync(exactManifest)
            ? path_1.default.resolve(input.targetPath)
            : inspection.existingSpaces.length === 1
                ? inspection.existingSpaces[0].path
                : '';
        if (!target)
            throw new types_1.SyncError('invalid-input', 'Choose the folder containing one 1MarketingTool sync space.');
        return this.joinTransport(new FolderSyncTransport_1.FolderSyncTransport(target, inspection.provider), 'folder', { path: target, label: inspection.provider }, null, { passphrase: input.passphrase, recoveryKey: input.recoveryKey }, target);
    }
    async testS3(config) {
        this.assertPro();
        const transport = this.s3FromInput(config, config.prefix || '.stoicsoft-sync-test');
        try {
            const health = await transport.probe(new AbortController().signal);
            return { healthy: health.status === 'healthy', detail: health.detail ?? null };
        }
        finally {
            transport.destroy();
        }
    }
    async createS3Space(input) {
        this.assertPro();
        this.assertDisconnected();
        const device = localDevice();
        const spaceId = (0, crypto_1.randomUUID)();
        const rootPrefix = normalizedPrefix(input.config.prefix, spaceId);
        const transport = this.s3FromInput(input.config, rootPrefix);
        const { manifest, spaceKey, recoveryKey } = await (0, crypto_2.createEncryptedManifest)(spaceId, input.passphrase);
        const transportId = (0, crypto_1.randomUUID)();
        try {
            const health = await transport.probe(new AbortController().signal);
            if (health.status !== 'healthy')
                throw new types_1.SyncError('storage-auth-failed', health.detail ?? 'Object storage is unavailable.');
            const manifestBytes = (0, protocol_1.encodeManifest)(manifest);
            await transport.createManifest(manifestBytes, new AbortController().signal);
            const space = this.state.createSpace({
                id: spaceId,
                displayName: input.displayName.trim() || 'My marketing workspace',
                durableTransport: 's3',
                nearbyEnabled: false,
                deviceId: device.id,
                deviceName: device.name,
                manifestHash: (0, canonical_1.sha256)(manifestBytes),
                seedAdminRole: true,
            });
            await CredentialVault_1.credentialVault.setSecret(`${S3_SECRET_PREFIX}${transportId}`, {
                accessKeyId: input.config.accessKeyId,
                secretAccessKey: input.config.secretAccessKey,
            });
            this.state.addTransport({
                id: transportId,
                spaceId,
                kind: 's3',
                secretRef: `${S3_SECRET_PREFIX}${transportId}`,
                config: this.redactedS3Config(input.config, rootPrefix),
            });
            await this.storeSpaceKey(spaceId, spaceKey);
            this.setAutomationOwnerInternal(space, null);
            void this.runCycle('setup').catch(() => undefined);
            return { status: await this.getStatus(), recoveryKey, target: rootPrefix };
        }
        finally {
            transport.destroy();
            await (0, crypto_2.wipeBuffer)(spaceKey);
        }
    }
    async startNearbyHost(input) {
        this.assertPro();
        let space = this.state.getSpace();
        let recoveryKey;
        let manifestBytes;
        let spaceKey;
        if (!space) {
            if (!input?.passphrase)
                throw new types_1.SyncError('invalid-input', 'Create a passphrase with at least 12 characters.');
            const device = localDevice();
            const spaceId = (0, crypto_1.randomUUID)();
            const created = await (0, crypto_2.createEncryptedManifest)(spaceId, input.passphrase);
            manifestBytes = (0, protocol_1.encodeManifest)(created.manifest);
            spaceKey = created.spaceKey;
            recoveryKey = created.recoveryKey;
            space = this.state.createSpace({
                id: spaceId,
                displayName: input.displayName?.trim() || 'Nearby marketing workspace',
                durableTransport: null,
                nearbyEnabled: true,
                deviceId: device.id,
                deviceName: device.name,
                manifestHash: (0, canonical_1.sha256)(manifestBytes),
                seedAdminRole: true,
            });
            this.state.addTransport({
                spaceId,
                kind: 'lan',
                config: { label: 'Nearby — Same Wi-Fi', manifestBase64: manifestBytes.toString('base64') },
            });
            await this.storeSpaceKey(spaceId, spaceKey);
            this.setAutomationOwnerInternal(space, null);
        }
        else {
            spaceKey = await this.loadSpaceKey(space.id);
            manifestBytes = await this.manifestBytesForSpace(space);
            let lanRow = this.state.listTransportRows(space.id).find((row) => row.kind === 'lan');
            if (!lanRow) {
                this.state.addTransport({
                    spaceId: space.id,
                    kind: 'lan',
                    config: { label: 'Nearby — Same Wi-Fi', manifestBase64: manifestBytes.toString('base64') },
                });
                lanRow = this.state.listTransportRows(space.id).find((row) => row.kind === 'lan');
            }
            (0, db_1.getDb)().prepare('UPDATE sync_spaces SET nearby_enabled = 1, updated_at = ? WHERE id = ?').run(Date.now(), space.id);
        }
        try {
            const session = await this.lanServer.startHosting({
                spaceId: space.id,
                spaceName: space.display_name,
                manifestBase64: manifestBytes.toString('base64'),
                manifestHash: (0, canonical_1.sha256)(manifestBytes),
                spaceKeyBase64: spaceKey.toString('base64'),
                hostDeviceId: space.local_device_id,
                hostDeviceName: space.local_device_name,
                hostPlatform: process.platform,
                hostEndpoints: [],
            });
            return { session, ...(recoveryKey ? { recoveryKey } : {}) };
        }
        finally {
            await (0, crypto_2.wipeBuffer)(spaceKey);
        }
    }
    async joinNearby(code) {
        this.assertPro();
        this.assertDisconnected();
        return this.lanServer.beginJoin(code);
    }
    getNearbyPairing() {
        return this.lanServer.pairingStatus();
    }
    async confirmNearby() {
        this.assertPro();
        const result = await this.lanServer.confirm();
        const space = this.state.getSpace();
        if (space && result?.confirmed)
            void this.runCycle('nearby-paired').catch(() => undefined);
        return result;
    }
    cancelNearby() {
        this.lanServer.cancelPairing();
    }
    async joinS3Space(input) {
        this.assertPro();
        this.assertDisconnected();
        const rootPrefix = (input.config.prefix ?? '').replace(/^\/+|\/+$/g, '');
        if (!rootPrefix)
            throw new types_1.SyncError('invalid-input', 'Enter the complete sync-space prefix from the first device.');
        const transport = this.s3FromInput(input.config, rootPrefix);
        const transportId = (0, crypto_1.randomUUID)();
        try {
            await CredentialVault_1.credentialVault.setSecret(`${S3_SECRET_PREFIX}${transportId}`, {
                accessKeyId: input.config.accessKeyId,
                secretAccessKey: input.config.secretAccessKey,
            });
            return await this.joinTransport(transport, 's3', this.redactedS3Config(input.config, rootPrefix), `${S3_SECRET_PREFIX}${transportId}`, { passphrase: input.passphrase, recoveryKey: input.recoveryKey }, rootPrefix, transportId);
        }
        catch (error) {
            await CredentialVault_1.credentialVault.removeSecret(`${S3_SECRET_PREFIX}${transportId}`);
            throw error;
        }
        finally {
            transport.destroy();
        }
    }
    async joinTransport(transport, kind, config, secretRef, unlock, target, transportId) {
        const manifestBytes = Buffer.from(await transport.readManifest(new AbortController().signal) ?? []);
        if (!manifestBytes.length)
            throw new types_1.SyncError('invalid-input', 'No sync manifest was found at this location.');
        const manifest = (0, protocol_1.parseManifest)(manifestBytes);
        const spaceKey = await (0, crypto_2.unlockEncryptedManifest)(manifest, unlock);
        try {
            const device = localDevice();
            const space = this.state.createSpace({
                id: manifest.spaceId,
                displayName: 'Shared marketing workspace',
                durableTransport: kind,
                nearbyEnabled: false,
                deviceId: device.id,
                deviceName: device.name,
                manifestHash: (0, canonical_1.sha256)(manifestBytes),
            });
            this.state.addTransport({ id: transportId, spaceId: space.id, kind, config, secretRef });
            await this.storeSpaceKey(space.id, spaceKey);
            this.startFolderWatcher();
            this.setAutomationOwnerInternal(space, null);
            await this.runCycle('initial-join');
            return { status: await this.getStatus(), target };
        }
        catch (error) {
            this.state.removeSpace(manifest.spaceId);
            await CredentialVault_1.credentialVault.removeSecret(`${SPACE_KEY_PREFIX}${manifest.spaceId}`);
            throw error;
        }
        finally {
            await (0, crypto_2.wipeBuffer)(spaceKey);
        }
    }
    async runCycle(trigger = 'manual') {
        this.assertPro();
        const space = this.requireSpace();
        if (space.paused)
            throw new types_1.SyncError('cancelled', 'Sync is paused.');
        if (this.activeCycle) {
            this.rerunRequested = true;
            return this.activeCycle;
        }
        this.abortController = new AbortController();
        this.activeCycle = this.executeCycle(space, trigger, this.abortController.signal);
        void this.getStatus().then((next) => this.emit('status', next));
        try {
            return await this.activeCycle;
        }
        finally {
            this.activeCycle = null;
            this.abortController = null;
            this.emit('status', await this.getStatus());
            if (this.rerunRequested) {
                this.rerunRequested = false;
                void this.runCycle('coalesced').catch(() => undefined);
            }
        }
    }
    cancelCycle() {
        this.abortController?.abort();
    }
    async executeCycle(space, trigger, signal) {
        const transportRow = this.state.listTransportRows(space.id).find((row) => row.enabled && (space.durable_transport ? row.kind === space.durable_transport : row.kind === 'lan'));
        if (!transportRow)
            throw new types_1.SyncError('folder-unavailable', 'No sync transport is configured.');
        const transport = await this.createTransport(transportRow);
        const key = await this.loadSpaceKey(space.id);
        const jobId = this.state.createJob(space.id, trigger, transport.kind);
        const review = space.sync_mode === 'review';
        const localRole = this.state.roleFor(space.id, space.local_device_id);
        let pushed = 0;
        let pulled = 0;
        let conflicts = 0;
        let bytes = 0;
        let staged = 0;
        try {
            this.progress(jobId, 'preflight', 'Checking encrypted sync space', 0, 1, bytes);
            const health = await transport.probe(signal);
            this.state.updateTransportHealth(transportRow.id, health.status, health.checkedAt);
            if (health.status !== 'healthy') {
                throw new types_1.SyncError(transport.kind === 'lan' ? 'peer-offline' : 'folder-unavailable', health.detail ?? `${transport.label} is unavailable.`);
            }
            const remoteManifestBytes = Buffer.from(await transport.readManifest(signal) ?? []);
            const remoteManifest = (0, protocol_1.parseManifest)(remoteManifestBytes);
            this.assertManifest(space, remoteManifest, remoteManifestBytes);
            this.progress(jobId, 'scan', 'Scanning portable marketing data', 0, 1, bytes);
            if (localRole !== 'viewer') {
                const disabledScopes = this.disabledScopeSet(space);
                // Review mode only auto-syncs control records (roles, automation owner);
                // everything else waits for an explicit push from the Changes panel.
                let records = this.scopedRecords(disabledScopes);
                if (review)
                    records = records.filter((record) => CONTROL_RECORD_TYPES.has(record.recordType));
                await this.blobs.attachReferences(space.id, records, key);
                this.state.scanAndEnqueue(space, records, {
                    excludedScopes: disabledScopes,
                    restrictTypes: review ? CONTROL_RECORD_TYPES : null,
                });
            }
            while (true) {
                const batch = this.state.buildBatch(space);
                if (!batch)
                    break;
                const encrypted = await (0, protocol_1.encodeBatch)(batch, key);
                this.state.saveOutboundBatch(space.id, batch, (0, protocol_1.encryptedObjectHash)(encrypted), encrypted);
            }
            const outbound = this.state.pendingOutbound(space.id);
            this.progress(jobId, 'publish', 'Publishing encrypted changes', 0, outbound.length, bytes);
            for (let index = 0; index < outbound.length; index += 1) {
                const batch = outbound[index];
                await transport.putBatch({
                    batchId: batch.batch_id,
                    originDeviceId: batch.origin_device_id,
                    firstSeq: batch.first_seq,
                    lastSeq: batch.last_seq,
                    contentHash: batch.content_hash,
                }, batch.encrypted_bytes, signal);
                this.state.markOutboundWritten(space.id, batch.batch_id);
                bytes += batch.encrypted_bytes.length;
                pushed += batch.last_seq - batch.first_seq + 1;
                this.progress(jobId, 'publish', 'Publishing encrypted changes', index + 1, outbound.length, bytes);
            }
            const remote = await transport.listBatches(signal);
            this.progress(jobId, 'ingest', 'Reading changes from other devices', 0, remote.length, bytes);
            const candidates = [];
            const candidateHashes = new Map();
            const nextSequence = new Map();
            for (let index = 0; index < remote.length; index += 1) {
                const ref = remote[index];
                if (this.state.hasBatch(space.id, ref.batchId))
                    continue;
                const encrypted = Buffer.from(await transport.getBatch(ref, signal));
                const encryptedHash = (0, protocol_1.encryptedObjectHash)(encrypted);
                const priorHash = candidateHashes.get(ref.batchId);
                if (priorHash) {
                    if (priorHash !== encryptedHash)
                        throw new types_1.SyncError('batch-id-collision');
                    continue;
                }
                candidateHashes.set(ref.batchId, encryptedHash);
                if (ref.originDeviceId === space.local_device_id) {
                    const own = this.state.getOutboundBatch(space.id, ref.batchId);
                    if (!own)
                        throw new types_1.SyncError('identity-collision', 'Another installation is using this device identity.');
                    if (own.content_hash !== encryptedHash)
                        throw new types_1.SyncError('batch-id-collision');
                }
                const lastSequence = nextSequence.get(ref.originDeviceId) ??
                    this.state.lastBatchSequence(space.id, ref.originDeviceId);
                if (ref.firstSeq !== lastSequence + 1) {
                    throw new types_1.SyncError('batch-sequence-gap', `Expected operation ${lastSequence + 1} from ${ref.originDeviceId.slice(0, 8)}.`);
                }
                const batch = await (0, protocol_1.decodeBatch)(encrypted, {
                    spaceId: space.id,
                    batchId: ref.batchId,
                    originDeviceId: ref.originDeviceId,
                    firstSeq: ref.firstSeq,
                    lastSeq: ref.lastSeq,
                }, key);
                nextSequence.set(ref.originDeviceId, ref.lastSeq);
                candidates.push({ batch, hash: encryptedHash });
                bytes += encrypted.length;
                this.progress(jobId, 'ingest', 'Reading changes from other devices', index + 1, remote.length, bytes);
            }
            this.progress(jobId, 'apply', review ? 'Staging changes for review' : 'Applying verified changes', 0, candidates.length, bytes);
            try {
                (0, db_1.getDb)().transaction(() => {
                    candidates.forEach((candidate, index) => {
                        const result = review
                            ? this.stageBatch(space, candidate.batch, candidate.hash)
                            : this.applyBatch(space, candidate.batch, candidate.hash);
                        pulled += result.applied;
                        conflicts += result.conflicts;
                        staged += result.staged;
                        this.progress(jobId, 'apply', review ? 'Staging changes for review' : 'Applying verified changes', index + 1, candidates.length, bytes);
                    });
                })();
            }
            catch (error) {
                if (error instanceof types_1.SyncError)
                    throw error;
                throw new types_1.SyncError('apply-failed', error instanceof Error ? error.message : 'Verified changes could not be applied.');
            }
            for (const [originDeviceId, lastSequence] of nextSequence) {
                this.state.acknowledge(space.id, space.local_device_id, originDeviceId, lastSequence);
            }
            this.progress(jobId, 'blobs', 'Syncing managed media', 0, 1, bytes);
            await this.blobs.uploadPending(space.id, transport, key, signal, (amount) => { bytes += amount; });
            await this.blobs.downloadMissing(space.id, space.blob_policy, transport, key, signal);
            await this.publishPresence(space, transport, key, signal);
            this.state.markSpaceSuccess(space.id);
            this.state.finishJob(jobId, { status: pushed || pulled || staged ? 'success' : 'noop', pushed, pulled, bytes, conflicts });
            this.progress(jobId, 'done', 'Sync complete', 1, 1, bytes);
            if (pulled > 0)
                this.emit('data-changed', { spaceId: space.id, pulledOperations: pulled });
            return { pushed, pulled, conflicts, bytes, staged };
        }
        catch (error) {
            const mapped = asSyncError(error);
            this.state.markSpaceError(space.id, mapped.code, mapped.message);
            this.state.finishJob(jobId, {
                status: mapped.code === 'cancelled' ? 'cancelled' : 'failed', pushed, pulled, bytes, conflicts, errorCode: mapped.code,
            });
            this.progress(jobId, 'failed', mapped.message, 0, 1, bytes, mapped.code);
            throw mapped;
        }
        finally {
            if (transport instanceof S3SyncTransport_1.S3SyncTransport)
                transport.destroy();
            await (0, crypto_2.wipeBuffer)(key);
        }
    }
    sortForApply(operations) {
        return [...operations].sort((left, right) => {
            if (left.operation !== right.operation)
                return left.operation === 'upsert' ? -1 : 1;
            const leftOrder = (0, MarketingRecordCatalog_1.getRecordAdapter)(left.recordType).order;
            const rightOrder = (0, MarketingRecordCatalog_1.getRecordAdapter)(right.recordType).order;
            if (leftOrder !== rightOrder)
                return left.operation === 'upsert' ? leftOrder - rightOrder : rightOrder - leftOrder;
            return left.clock.wall - right.clock.wall || left.clock.counter - right.clock.counter;
        });
    }
    applyBatch(space, batch, fileHash) {
        let applied = 0;
        let conflicts = 0;
        (0, db_1.getDb)().transaction(() => {
            for (const operation of this.sortForApply(batch.operations)) {
                if (this.state.operationApplied(space.id, operation.operationId))
                    continue;
                const result = this.applyRemoteOperation(space, operation);
                if (result.applied)
                    applied += 1;
                if (result.conflict)
                    conflicts += 1;
                this.state.markOperationApplied(space.id, operation.operationId, batch.header.batchId);
            }
            this.state.recordIngestedBatch(space.id, batch, fileHash);
            this.recordBatchDevice(space, batch);
        })();
        return { applied, conflicts, staged: 0 };
    }
    /**
     * Review mode: hold remote operations in the staging area instead of applying them.
     * Our own echoes and control records (roles, automation owner) still apply directly.
     */
    stageBatch(space, batch, fileHash) {
        let applied = 0;
        let conflicts = 0;
        let staged = 0;
        (0, db_1.getDb)().transaction(() => {
            for (const operation of this.sortForApply(batch.operations)) {
                if (this.state.operationApplied(space.id, operation.operationId))
                    continue;
                if (operation.originDeviceId === space.local_device_id || CONTROL_RECORD_TYPES.has(operation.recordType)) {
                    const result = this.applyRemoteOperation(space, operation);
                    if (result.applied)
                        applied += 1;
                    if (result.conflict)
                        conflicts += 1;
                    this.state.markOperationApplied(space.id, operation.operationId, batch.header.batchId);
                }
                else {
                    this.state.stageOperation(space.id, batch.header.batchId, operation);
                    staged += 1;
                }
            }
            this.state.recordIngestedBatch(space.id, batch, fileHash);
            this.recordBatchDevice(space, batch);
        })();
        return { applied, conflicts, staged };
    }
    recordBatchDevice(space, batch) {
        this.state.upsertDevice(space.id, batch.header.originDeviceId, batch.header.originDeviceId === space.local_device_id ? space.local_device_name : `Device ${batch.header.originDeviceId.slice(0, 8)}`, 'unknown', null, batch.header.lastSeq, space.durable_transport);
    }
    applyRemoteOperation(space, operation) {
        const adapter = (0, MarketingRecordCatalog_1.getRecordAdapter)(operation.recordType);
        if (operation.recordSchemaVersion !== 1) {
            throw new types_1.SyncError('unsupported-record-schema', `Update the app to read ${operation.recordType} schema ${operation.recordSchemaVersion}.`);
        }
        // Disabled scopes still track remote state so re-enabling can materialize it later,
        // but they never touch domain tables, media, or the conflict queue.
        const scopeDisabled = this.disabledScopeSet(space).has(adapter.scope);
        const current = this.state.getRecordState(space.id, operation.recordType, operation.recordId);
        if (!current) {
            if (operation.operation === 'upsert' && !scopeDisabled) {
                (0, MarketingRecordCatalog_1.applyMarketingRecord)((0, db_1.getDb)(), operation.recordType, operation.operation, operation.payload, operation.recordId);
                this.blobs.registerRemoteReferences(space.id, operation.recordType, operation.recordId, operation.blobRefs);
            }
            this.state.acceptRemoteOperation(space.id, operation);
            return { applied: operation.operation === 'upsert' && !scopeDisabled, conflict: false };
        }
        const decision = (0, merge_1.planRecordMerge)(current, operation);
        if (decision.conflict && !scopeDisabled) {
            this.state.createConflict(space.id, current, operation, decision.winningSide);
        }
        if (decision.action === 'ignore')
            return { applied: false, conflict: decision.conflict && !scopeDisabled };
        if (!scopeDisabled) {
            (0, MarketingRecordCatalog_1.applyMarketingRecord)((0, db_1.getDb)(), operation.recordType, operation.operation, operation.payload, operation.recordId);
            this.blobs.registerRemoteReferences(space.id, operation.recordType, operation.recordId, operation.blobRefs);
        }
        this.state.acceptRemoteOperation(space.id, operation);
        return { applied: !scopeDisabled, conflict: decision.conflict && !scopeDisabled };
    }
    async publishPresence(space, transport, key, signal) {
        const descriptor = {
            deviceId: space.local_device_id,
            displayName: space.local_device_name,
            platform: process.platform,
            appVersion: electron_1.app.getVersion(),
            lastSeenAt: Date.now(),
        };
        const bytes = await (0, crypto_2.encryptSyncPayload)({ type: 'device', spaceId: space.id, deviceId: space.local_device_id }, Buffer.from((0, canonical_1.canonicalStringify)(descriptor)), key);
        await transport.putDevice(space.local_device_id, bytes, signal);
        const acknowledgement = await (0, crypto_2.encryptSyncPayload)({ type: 'acknowledgement', spaceId: space.id, deviceId: space.local_device_id }, Buffer.from((0, canonical_1.canonicalStringify)({
            deviceId: space.local_device_id,
            lastContiguousSequenceByOrigin: this.state.acknowledgements(space.id, space.local_device_id),
            updatedAt: Date.now(),
        })), key);
        await transport.putAcknowledgement(space.local_device_id, acknowledgement, signal);
        this.state.upsertDevice(space.id, space.local_device_id, space.local_device_name, process.platform, electron_1.app.getVersion(), 0, transport.kind);
    }
    async setPaused(paused) {
        const space = this.requireSpace();
        this.state.setPaused(space.id, paused);
        if (paused)
            this.cancelCycle();
        else
            void this.runCycle('resume').catch(() => undefined);
        return this.getStatus();
    }
    async setBlobPolicy(policy) {
        if (!['metadata-only', 'on-demand', 'keep-all'].includes(policy))
            throw new types_1.SyncError('invalid-input');
        const space = this.requireSpace();
        this.state.setBlobPolicy(space.id, policy);
        if (policy === 'keep-all')
            void this.runCycle('blob-policy').catch(() => undefined);
        return this.getStatus();
    }
    async downloadBlob(blobId) {
        this.assertPro();
        const space = this.requireSpace();
        const row = this.state.listTransportRows(space.id).find((item) => item.enabled && item.kind === space.durable_transport);
        if (!row)
            throw new types_1.SyncError('folder-unavailable');
        const transport = await this.createTransport(row);
        const key = await this.loadSpaceKey(space.id);
        try {
            await this.blobs.downloadMissing(space.id, space.blob_policy, transport, key, new AbortController().signal, blobId);
            this.emit('data-changed', { spaceId: space.id, pulledOperations: 0 });
        }
        finally {
            if (transport instanceof S3SyncTransport_1.S3SyncTransport)
                transport.destroy();
            await (0, crypto_2.wipeBuffer)(key);
        }
    }
    listBlobs() {
        const space = this.requireSpace();
        return this.blobs.list(space.id);
    }
    listTransports() {
        const space = this.requireSpace();
        return this.state.listTransportRows(space.id).map((row) => {
            const config = parseConfig(row);
            const label = typeof config.label === 'string' ? config.label : row.kind === 's3' ? 'Object storage' : 'Synced folder';
            return {
                id: row.id,
                kind: row.kind,
                label,
                enabled: Boolean(row.enabled),
                configured: true,
                health: row.last_health_status,
                lastHealthAt: row.last_health_at,
                redactedConfig: Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'manifestBase64').map(([key, value]) => [
                    key,
                    key.toLowerCase().includes('path') ? path_1.default.basename(String(value)) : value,
                ])),
            };
        });
    }
    listDevices() {
        const space = this.requireSpace();
        return this.state.listDevices(space);
    }
    async retireDevice(deviceId) {
        const space = this.requireSpace();
        this.requireAdmin(space, 'Only an admin device can remove devices.');
        if (deviceId === space.local_device_id)
            throw new types_1.SyncError('invalid-input', 'Disconnect this device instead.');
        const peer = (0, db_1.getDb)().prepare('SELECT secret_ref FROM sync_lan_peers WHERE space_id = ? AND device_id = ?')
            .get(space.id, deviceId);
        if (peer)
            await CredentialVault_1.credentialVault.removeSecret(peer.secret_ref);
        (0, db_1.getDb)().prepare('UPDATE sync_lan_peers SET revoked_at = ?, updated_at = ? WHERE space_id = ? AND device_id = ?')
            .run(Date.now(), Date.now(), space.id, deviceId);
        this.state.retireDevice(space.id, deviceId);
    }
    listConflicts() {
        return this.state.listConflicts(this.requireSpace().id);
    }
    resolveConflict(conflictId, selection) {
        const space = this.requireSpace();
        this.requireAdmin(space, 'Only an admin device can merge conflicting changes.');
        const conflict = this.state.listConflicts(space.id).find((item) => item.id === conflictId);
        if (!conflict || conflict.status !== 'open')
            throw new types_1.SyncError('invalid-input', 'That conflict is no longer open.');
        if (selection === 'dismiss') {
            this.state.resolveConflict(space.id, conflictId, 'dismissed');
            return;
        }
        const winnerPayload = conflict.winningSide === 'local' ? conflict.localPayload : conflict.remotePayload;
        const loserPayload = conflict.winningSide === 'local' ? conflict.remotePayload : conflict.localPayload;
        const chosen = selection === 'winner' ? winnerPayload : loserPayload;
        (0, MarketingRecordCatalog_1.applyMarketingRecord)((0, db_1.getDb)(), conflict.recordType, chosen ? 'upsert' : 'delete', chosen, conflict.recordId);
        (0, db_1.getDb)().prepare(`UPDATE sync_record_state SET content_hash = ?, deleted = 0, updated_at = ?
       WHERE space_id = ? AND record_type = ? AND record_id = ?`).run(`conflict-resolution:${Date.now()}`, Date.now(), space.id, conflict.recordType, conflict.recordId);
        this.state.resolveConflict(space.id, conflictId, 'resolved');
        // The next scan emits a new operation, making the explicit choice converge everywhere.
        void this.runCycle('conflict-resolution').catch(() => undefined);
    }
    listScopes() {
        const space = this.requireSpace();
        const disabled = this.disabledScopeSet(space);
        const counts = new Map();
        for (const state of this.state.listRecordStates(space.id)) {
            if (state.deleted)
                continue;
            const scope = (0, MarketingRecordCatalog_1.getRecordAdapter)(state.record_type).scope;
            counts.set(scope, (counts.get(scope) ?? 0) + 1);
        }
        return MarketingRecordCatalog_1.SYNC_SCOPE_DEFINITIONS.map((definition) => ({
            id: definition.id,
            label: definition.label,
            detail: definition.detail,
            enabled: !disabled.has(definition.id),
            locked: definition.locked,
            recordTypes: MarketingRecordCatalog_1.MARKETING_RECORD_CATALOG.filter((adapter) => adapter.scope === definition.id).map((adapter) => adapter.recordType),
            recordCount: counts.get(definition.id) ?? 0,
        }));
    }
    setScopeEnabled(scopeId, enabled) {
        const space = this.requireSpace();
        this.requireAdmin(space, 'Only an admin device can change what syncs.');
        const definition = MarketingRecordCatalog_1.SYNC_SCOPE_DEFINITIONS.find((item) => item.id === scopeId);
        if (!definition)
            throw new types_1.SyncError('invalid-input', 'Unknown sync scope.');
        if (definition.locked && !enabled)
            throw new types_1.SyncError('invalid-input', `${definition.label} always syncs.`);
        const disabled = this.disabledScopeSet(space);
        if (enabled)
            disabled.delete(definition.id);
        else
            disabled.add(definition.id);
        this.state.setDisabledScopes(space.id, [...disabled]);
        if (enabled)
            this.materializeScope(space, definition.id);
        void this.getStatus().then((next) => this.emit('status', next));
        void this.runCycle('scope-change').catch(() => undefined);
        return this.listScopes();
    }
    /** Write the already-received remote state of a re-enabled scope into the domain tables. */
    materializeScope(space, scopeId) {
        const states = this.state.listRecordStates(space.id)
            .filter((state) => !state.deleted && state.payload_json && (0, MarketingRecordCatalog_1.getRecordAdapter)(state.record_type).scope === scopeId)
            .sort((left, right) => (0, MarketingRecordCatalog_1.getRecordAdapter)(left.record_type).order - (0, MarketingRecordCatalog_1.getRecordAdapter)(right.record_type).order);
        if (!states.length)
            return;
        (0, db_1.getDb)().transaction(() => {
            for (const state of states) {
                try {
                    const payload = JSON.parse(state.payload_json);
                    (0, MarketingRecordCatalog_1.applyMarketingRecord)((0, db_1.getDb)(), state.record_type, 'upsert', payload, state.record_id);
                }
                catch {
                    // A single malformed payload must not block re-enabling the scope.
                }
            }
        })();
        this.emit('data-changed', { spaceId: space.id, pulledOperations: states.length });
    }
    async setSyncMode(mode) {
        if (mode !== 'auto' && mode !== 'review')
            throw new types_1.SyncError('invalid-input');
        const space = this.requireSpace();
        this.requireAdmin(space, 'Only an admin device can change how changes sync.');
        this.state.setSyncMode(space.id, mode);
        // Leaving review mode releases everything that was held for review.
        if (mode === 'auto') {
            const staged = this.state.listStagedOperations(space.id).map((row) => row.operation_id);
            if (staged.length)
                this.applyStagedChanges(staged);
            void this.runCycle('mode-change').catch(() => undefined);
        }
        const status = await this.getStatus();
        this.emit('status', status);
        return status;
    }
    /** Dry-run diff of local marketing data against the last synced state — nothing is queued. */
    previewLocalChanges() {
        const space = this.requireSpace();
        const disabled = this.disabledScopeSet(space);
        const records = this.scopedRecords(disabled);
        const states = this.state.listRecordStates(space.id);
        const byKey = new Map(states.map((state) => [(0, SyncStateRepository_1.recordKey)(state.record_type, state.record_id), state]));
        const seen = new Set();
        const changes = [];
        for (const record of records) {
            const key = (0, SyncStateRepository_1.recordKey)(record.recordType, record.recordId);
            seen.add(key);
            if (CONTROL_RECORD_TYPES.has(record.recordType))
                continue;
            const state = byKey.get(key);
            if (state && !state.deleted && state.content_hash === record.payloadHash)
                continue;
            const previous = state?.payload_json ? JSON.parse(state.payload_json) : null;
            changes.push({
                recordType: record.recordType,
                recordId: record.recordId,
                changeKind: state && !state.deleted ? 'update' : 'create',
                payload: record.payload,
                previousPayload: previous,
                modifiedAt: record.modifiedAt,
            });
        }
        for (const state of states) {
            if (state.deleted || seen.has((0, SyncStateRepository_1.recordKey)(state.record_type, state.record_id)))
                continue;
            if (CONTROL_RECORD_TYPES.has(state.record_type))
                continue;
            if (disabled.has((0, MarketingRecordCatalog_1.getRecordAdapter)(state.record_type).scope))
                continue;
            changes.push({
                recordType: state.record_type,
                recordId: state.record_id,
                changeKind: 'delete',
                payload: null,
                previousPayload: state.payload_json ? JSON.parse(state.payload_json) : null,
                modifiedAt: state.updated_at,
            });
        }
        return changes.sort((left, right) => right.modifiedAt - left.modifiedAt);
    }
    /** Queue the selected records (or every pending change) and run a sync cycle to publish them. */
    async pushChanges(selection) {
        this.assertPro();
        const space = this.requireSpace();
        if (this.state.roleFor(space.id, space.local_device_id) === 'viewer') {
            throw new types_1.SyncError('role-denied', 'Viewer devices receive changes but cannot push their own.');
        }
        const disabled = this.disabledScopeSet(space);
        const records = this.scopedRecords(disabled);
        const selectionSet = selection ? new Set(selection.map((item) => (0, SyncStateRepository_1.recordKey)(item.recordType, item.recordId))) : null;
        const chosen = selectionSet ? records.filter((record) => selectionSet.has((0, SyncStateRepository_1.recordKey)(record.recordType, record.recordId))) : records;
        const key = await this.loadSpaceKey(space.id);
        try {
            await this.blobs.attachReferences(space.id, chosen, key);
        }
        finally {
            await (0, crypto_2.wipeBuffer)(key);
        }
        this.state.scanAndEnqueue(space, records, { excludedScopes: disabled, selection: selectionSet });
        return this.runCycle('push');
    }
    /** Contact the transport and stage whatever the other devices pushed. */
    async fetchChanges() {
        this.assertPro();
        this.requireSpace();
        const result = await this.runCycle('fetch');
        return { result, changes: this.listIncomingChanges() };
    }
    listIncomingChanges() {
        const space = this.requireSpace();
        const devices = new Map(this.state.listDevices(space).map((device) => [device.deviceId, device.displayName]));
        const states = new Map(this.state.listRecordStates(space.id).map((state) => [(0, SyncStateRepository_1.recordKey)(state.record_type, state.record_id), state]));
        const changes = [];
        for (const row of this.state.listStagedOperations(space.id)) {
            try {
                const operation = JSON.parse(row.operation_json);
                const current = states.get((0, SyncStateRepository_1.recordKey)(operation.recordType, operation.recordId)) ?? null;
                const changeKind = operation.operation === 'delete'
                    ? 'delete'
                    : current && !current.deleted ? 'update' : 'create';
                changes.push({
                    operationId: row.operation_id,
                    batchId: row.batch_id,
                    originDeviceId: row.origin_device_id,
                    originDeviceName: devices.get(row.origin_device_id) ?? `Device ${row.origin_device_id.slice(0, 8)}`,
                    deviceSeq: row.device_seq,
                    recordType: operation.recordType,
                    recordId: operation.recordId,
                    changeKind,
                    payload: operation.payload,
                    currentPayload: current?.payload_json ? JSON.parse(current.payload_json) : null,
                    clockWall: operation.clock.wall,
                    stagedAt: row.staged_at,
                });
            }
            catch {
                // A malformed staged row is unrecoverable; leave it out of the list.
            }
        }
        return changes.sort((left, right) => right.stagedAt - left.stagedAt || right.deviceSeq - left.deviceSeq);
    }
    /** Apply the selected staged changes (or all of them) through the normal merge path. */
    applyStagedChanges(operationIds) {
        const space = this.requireSpace();
        const rows = this.state.listStagedOperations(space.id, operationIds);
        const operations = [];
        for (const row of rows) {
            try {
                operations.push({ operation: JSON.parse(row.operation_json), batchId: row.batch_id });
            }
            catch {
                this.state.deleteStagedOperation(space.id, row.operation_id);
            }
        }
        const byId = new Map(operations.map((entry) => [entry.operation.operationId, entry.batchId]));
        let applied = 0;
        let conflicts = 0;
        (0, db_1.getDb)().transaction(() => {
            for (const operation of this.sortForApply(operations.map((entry) => entry.operation))) {
                if (!this.state.operationApplied(space.id, operation.operationId)) {
                    const result = this.applyRemoteOperation(space, operation);
                    if (result.applied)
                        applied += 1;
                    if (result.conflict)
                        conflicts += 1;
                    this.state.markOperationApplied(space.id, operation.operationId, byId.get(operation.operationId) ?? 'staged');
                }
                this.state.deleteStagedOperation(space.id, operation.operationId);
            }
        })();
        if (applied)
            this.emit('data-changed', { spaceId: space.id, pulledOperations: applied });
        void this.getStatus().then((next) => this.emit('status', next));
        return { applied, conflicts };
    }
    /** Decline staged changes: this device keeps its version and the operations never re-appear. */
    skipStagedChanges(operationIds) {
        const space = this.requireSpace();
        const rows = this.state.listStagedOperations(space.id, operationIds);
        (0, db_1.getDb)().transaction(() => {
            for (const row of rows) {
                this.state.markOperationApplied(space.id, row.operation_id, row.batch_id);
                this.state.deleteStagedOperation(space.id, row.operation_id);
            }
        })();
        void this.getStatus().then((next) => this.emit('status', next));
        return rows.length;
    }
    setDeviceRole(deviceId, role) {
        const space = this.requireSpace();
        this.requireAdmin(space, 'Only an admin device can change roles.');
        if (!this.state.listDevices(space).some((device) => device.deviceId === deviceId && !device.retiredAt)) {
            throw new types_1.SyncError('invalid-input', 'Choose a trusted active device.');
        }
        const roles = this.state.listRoles(space.id);
        // The first explicit assignment turns enforcement on; keep this admin an admin.
        if (!roles.size && deviceId !== space.local_device_id) {
            this.state.setRole(space.id, space.local_device_id, 'admin');
            roles.set(space.local_device_id, 'admin');
        }
        roles.set(deviceId, role);
        const activeDevices = new Set(this.state.listDevices(space).filter((device) => !device.retiredAt).map((device) => device.deviceId));
        const adminRemains = [...roles.entries()].some(([id, value]) => value === 'admin' && activeDevices.has(id));
        if (!adminRemains)
            throw new types_1.SyncError('invalid-input', 'Keep at least one admin device.');
        this.state.setRole(space.id, deviceId, role);
        void this.getStatus().then((next) => this.emit('status', next));
        void this.runCycle('role-change').catch(() => undefined);
        return this.state.listDevices(space);
    }
    disabledScopeSet(space) {
        try {
            const parsed = JSON.parse(space.disabled_scopes_json);
            return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string' && value !== 'core') : []);
        }
        catch {
            return new Set();
        }
    }
    scopedRecords(disabledScopes) {
        return (0, MarketingRecordCatalog_1.scanMarketingRecords)((0, db_1.getDb)()).filter((record) => !disabledScopes.has((0, MarketingRecordCatalog_1.getRecordAdapter)(record.recordType).scope));
    }
    requireAdmin(space, message) {
        if (this.state.roleFor(space.id, space.local_device_id) !== 'admin') {
            throw new types_1.SyncError('role-denied', message);
        }
    }
    listJobs(limit = 100) {
        return this.state.listJobs(this.requireSpace().id, Math.max(1, Math.min(500, limit)));
    }
    getDiagnostics() {
        const space = this.state.getSpace();
        const counts = space ? this.state.counts(space.id) : { queued: 0, conflicts: 0, batches: 0, blobs: 0, blobBytes: 0 };
        return {
            generatedAt: Date.now(),
            protocolVersion: types_1.SYNC_PROTOCOL_VERSION,
            productId: types_1.SYNC_PRODUCT_ID,
            lifecycle: space ? space.last_error_code ? 'attention' : space.paused ? 'paused' : 'connected' : 'disconnected',
            transportKinds: space ? this.state.listTransportRows(space.id).map((row) => row.kind) : [],
            statusCode: space?.last_error_code ?? null,
            counts: { devices: space ? this.state.listDevices(space).length : 0, queuedRecords: counts.queued, conflicts: counts.conflicts, batches: counts.batches, blobs: counts.blobs },
            lastSyncAt: space?.last_sync_at ?? null,
            appVersion: electron_1.app.getVersion(),
            platform: process.platform,
        };
    }
    async disconnect() {
        const space = this.requireSpace();
        this.cancelCycle();
        await this.activeCycle?.catch(() => undefined);
        this.folderWatcher?.close();
        this.folderWatcher = null;
        for (const row of this.state.listTransportRows(space.id)) {
            if (row.secret_ref)
                await CredentialVault_1.credentialVault.removeSecret(row.secret_ref);
        }
        const peerSecrets = (0, db_1.getDb)().prepare('SELECT secret_ref FROM sync_lan_peers WHERE space_id = ?').all(space.id);
        for (const peer of peerSecrets)
            await CredentialVault_1.credentialVault.removeSecret(peer.secret_ref);
        await CredentialVault_1.credentialVault.removeSecret(`${SPACE_KEY_PREFIX}${space.id}`);
        this.state.removeSpace(space.id);
        this.emit('status', await this.getStatus());
    }
    isAutomationOwner(workspaceId = '*') {
        const space = this.state.getSpace();
        if (!space)
            return true;
        if (space.paused || !LicenseService_1.licenseService.getLicenseInfo().isLicensed)
            return false;
        const owner = (0, db_1.getDb)().prepare('SELECT device_id FROM sync_automation_assignments WHERE space_id = ? AND workspace_id IN (?, ?) ORDER BY workspace_id = ? DESC LIMIT 1').get(space.id, workspaceId, '*', workspaceId);
        return owner?.device_id === space.local_device_id;
    }
    setAutomationOwner(deviceId, workspaceId = '*') {
        const space = this.requireSpace();
        this.requireAdmin(space, 'Only an admin device can change the automation owner.');
        if (deviceId && !this.state.listDevices(space).some((device) => device.deviceId === deviceId && !device.retiredAt)) {
            throw new types_1.SyncError('invalid-input', 'Choose a trusted active device.');
        }
        this.setAutomationOwnerInternal(space, deviceId, workspaceId);
    }
    setAutomationOwnerInternal(space, deviceId, workspaceId = '*') {
        const clock = { wall: Date.now(), counter: 0, deviceId: space.local_device_id };
        (0, db_1.getDb)().prepare(`INSERT INTO sync_automation_assignments (space_id, workspace_id, device_id, clock_json, updated_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(space_id, workspace_id) DO UPDATE SET
       device_id = excluded.device_id, clock_json = excluded.clock_json, updated_at = excluded.updated_at`).run(space.id, workspaceId, deviceId, (0, canonical_1.canonicalStringify)(clock), Date.now());
    }
    automationOwner(spaceId) {
        const row = (0, db_1.getDb)().prepare(`SELECT device_id FROM sync_automation_assignments WHERE space_id = ? AND workspace_id = '*'`).get(spaceId);
        return row?.device_id ?? null;
    }
    requireSpace() {
        const space = this.state.getSpace();
        if (!space)
            throw new types_1.SyncError('invalid-input', 'Set up sync first.');
        return space;
    }
    assertDisconnected() {
        if (this.state.getSpace())
            throw new types_1.SyncError('invalid-input', 'Disconnect the current sync space before joining another.');
    }
    async storeSpaceKey(spaceId, key) {
        await CredentialVault_1.credentialVault.setSecret(`${SPACE_KEY_PREFIX}${spaceId}`, { key: key.toString('base64') });
    }
    async loadSpaceKey(spaceId) {
        const secret = await CredentialVault_1.credentialVault.getSecret(`${SPACE_KEY_PREFIX}${spaceId}`);
        const key = secret?.key ? Buffer.from(secret.key, 'base64') : Buffer.alloc(0);
        if (key.length !== 32)
            throw new types_1.SyncError('missing-key', 'Unlock this sync space again on this device.');
        return key;
    }
    async createTransport(row) {
        const config = parseConfig(row);
        if (row.kind === 'folder') {
            if (typeof config.path !== 'string')
                throw new types_1.SyncError('folder-unavailable', 'The sync folder setting is invalid.');
            return new FolderSyncTransport_1.FolderSyncTransport(config.path, typeof config.label === 'string' ? config.label : undefined);
        }
        if (row.kind === 's3') {
            const secret = row.secret_ref ? await CredentialVault_1.credentialVault.getSecret(row.secret_ref) : null;
            if (!secret)
                throw new types_1.SyncError('storage-auth-failed', 'Object-storage credentials are unavailable.');
            return new S3SyncTransport_1.S3SyncTransport({
                provider: String(config.provider),
                bucket: String(config.bucket),
                region: typeof config.region === 'string' ? config.region : undefined,
                endpoint: typeof config.endpoint === 'string' ? config.endpoint : undefined,
                forcePathStyle: Boolean(config.forcePathStyle),
                prefix: typeof config.prefix === 'string' ? config.prefix : undefined,
                rootPrefix: String(config.rootPrefix),
                accessKeyId: secret.accessKeyId,
                secretAccessKey: secret.secretAccessKey,
            });
        }
        if (row.kind === 'lan') {
            const peer = (0, db_1.getDb)().prepare(`SELECT * FROM sync_lan_peers WHERE space_id = ? AND revoked_at IS NULL AND confirmed_at IS NOT NULL
         ORDER BY last_seen_at DESC, created_at ASC LIMIT 1`).get(row.space_id);
            if (!peer)
                throw new types_1.SyncError('peer-offline', 'No confirmed Nearby Sync device is available.');
            const endpoints = JSON.parse(peer.endpoints_json);
            if (!endpoints[0])
                throw new types_1.SyncError('peer-offline', 'The Nearby device has no reachable address.');
            const space = this.state.getSpaceById(row.space_id);
            if (!space)
                throw new types_1.SyncError('internal');
            const localEndpoints = await this.lanServer.start();
            return new LanSyncTransport_1.LanSyncTransport({
                spaceId: row.space_id,
                localDeviceId: space.local_device_id,
                peerDeviceId: peer.device_id,
                localEndpoints,
                endpoints,
                secretRef: peer.secret_ref,
                label: `Nearby · ${peer.display_name}`,
            });
        }
        throw new types_1.SyncError('peer-offline', 'Nearby Sync is not active.');
    }
    async persistLanPeer(input) {
        const secretRef = `sync:lan:${input.spaceId}:${input.deviceId}`;
        await CredentialVault_1.credentialVault.setSecret(secretRef, { key: input.key.toString('base64') });
        const now = Date.now();
        (0, db_1.getDb)().prepare(`INSERT INTO sync_lan_peers (
        space_id, device_id, display_name, platform, endpoints_json, secret_ref, confirmed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(space_id, device_id) DO UPDATE SET display_name = excluded.display_name, platform = excluded.platform,
        endpoints_json = excluded.endpoints_json, secret_ref = excluded.secret_ref, confirmed_at = excluded.confirmed_at,
        revoked_at = NULL, next_out_seq = 1, last_in_seq = 0, last_seen_at = NULL, updated_at = excluded.updated_at`).run(input.spaceId, input.deviceId, input.deviceName, input.platform, (0, canonical_1.canonicalStringify)(input.endpoints), secretRef, now, now, now);
        this.state.upsertDevice(input.spaceId, input.deviceId, input.deviceName, input.platform, null, 0, 'lan');
        this.emit('status', await this.getStatus());
        void this.runCycle('nearby-connected').catch(() => undefined);
    }
    async acceptLanMembership(membership, pairingKey) {
        this.assertDisconnected();
        const manifestBytes = Buffer.from(membership.manifestBase64, 'base64');
        const manifest = (0, protocol_1.parseManifest)(manifestBytes);
        if (manifest.spaceId !== membership.spaceId || (0, canonical_1.sha256)(manifestBytes) !== membership.manifestHash) {
            throw new types_1.SyncError('tampered', 'The Nearby membership package is inconsistent.');
        }
        const spaceKey = Buffer.from(membership.spaceKeyBase64, 'base64');
        if (spaceKey.length !== 32)
            throw new types_1.SyncError('tampered', 'The Nearby membership key is malformed.');
        const device = localDevice();
        const space = this.state.createSpace({
            id: membership.spaceId,
            displayName: membership.spaceName,
            durableTransport: null,
            nearbyEnabled: true,
            deviceId: device.id,
            deviceName: device.name,
            manifestHash: membership.manifestHash,
        });
        this.state.addTransport({
            spaceId: space.id,
            kind: 'lan',
            config: { label: 'Nearby — Same Wi-Fi', manifestBase64: membership.manifestBase64 },
        });
        await this.storeSpaceKey(space.id, spaceKey);
        await this.persistLanPeer({
            spaceId: space.id,
            deviceId: membership.hostDeviceId,
            deviceName: membership.hostDeviceName,
            platform: membership.hostPlatform,
            endpoints: membership.hostEndpoints,
            key: pairingKey,
        });
        this.setAutomationOwnerInternal(space, null);
        await (0, crypto_2.wipeBuffer)(spaceKey);
    }
    async manifestBytesForSpace(space) {
        const lan = this.state.listTransportRows(space.id).find((row) => row.kind === 'lan');
        const lanConfig = lan ? parseConfig(lan) : null;
        if (typeof lanConfig?.manifestBase64 === 'string')
            return Buffer.from(lanConfig.manifestBase64, 'base64');
        const durable = this.state.listTransportRows(space.id).find((row) => row.kind === space.durable_transport);
        if (!durable)
            throw new types_1.SyncError('folder-unavailable', 'The sync manifest is unavailable.');
        const transport = await this.createTransport(durable);
        try {
            const bytes = await transport.readManifest(new AbortController().signal);
            if (!bytes)
                throw new types_1.SyncError('folder-unavailable', 'The sync manifest is unavailable.');
            return Buffer.from(bytes);
        }
        finally {
            if (transport instanceof S3SyncTransport_1.S3SyncTransport)
                transport.destroy();
        }
    }
    async readLanBlobChunk(spaceId, blob, chunkIndex) {
        const key = await this.loadSpaceKey(spaceId);
        try {
            return await this.blobs.readEncryptedChunk(spaceId, blob, chunkIndex, key);
        }
        finally {
            await (0, crypto_2.wipeBuffer)(key);
        }
    }
    s3FromInput(input, rootPrefix) {
        if (!input.bucket.trim() || !input.accessKeyId.trim() || !input.secretAccessKey) {
            throw new types_1.SyncError('invalid-input', 'Bucket and credentials are required.');
        }
        return new S3SyncTransport_1.S3SyncTransport({ ...input, bucket: input.bucket.trim(), rootPrefix });
    }
    redactedS3Config(input, rootPrefix) {
        return {
            provider: input.provider,
            bucket: input.bucket,
            region: input.region ?? 'auto',
            endpoint: input.endpoint ?? null,
            prefix: input.prefix ?? '',
            rootPrefix,
            forcePathStyle: Boolean(input.forcePathStyle),
            label: `${input.provider.toUpperCase()} · ${input.bucket}`,
        };
    }
    assertManifest(space, manifest, bytes) {
        if (manifest.spaceId !== space.id)
            throw new types_1.SyncError('product-mismatch', 'The configured transport points to another sync space.');
        if ((0, canonical_1.sha256)(bytes) !== space.manifest_hash)
            throw new types_1.SyncError('manifest-downgrade', 'The sync manifest changed after this device joined.');
    }
    detectProvider(target) {
        const lower = target.toLowerCase();
        if (lower.includes('cloudstorage/icloud') || lower.includes('com~apple~clouddocs'))
            return 'iCloud Drive';
        if (lower.includes('onedrive'))
            return 'OneDrive';
        if (lower.includes('dropbox'))
            return 'Dropbox';
        if (lower.includes('nextcloud'))
            return 'Nextcloud';
        if (lower.includes('syncthing') || path_1.default.basename(lower) === 'sync')
            return 'Syncthing';
        return 'Synced folder';
    }
    async findFolderManifests(root) {
        const direct = path_1.default.join(root, 'manifest.json');
        const output = fs_1.default.existsSync(direct) ? [direct] : [];
        const productRoot = path_1.default.join(root, '.stoicsoft-sync', types_1.SYNC_PRODUCT_ID);
        const entries = await fs_1.default.promises.readdir(productRoot, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink())
                continue;
            const manifest = path_1.default.join(productRoot, entry.name, 'manifest.json');
            if (fs_1.default.existsSync(manifest))
                output.push(manifest);
        }
        return output;
    }
    progress(jobId, phase, message, done, total, transferredBytes, errorCode) {
        this.emit('progress', { jobId, phase, message, done, total, transferredBytes, ...(errorCode ? { errorCode } : {}) });
    }
    startFolderWatcher() {
        this.folderWatcher?.close();
        this.folderWatcher = null;
        const space = this.state.getSpace();
        if (!space || space.durable_transport !== 'folder')
            return;
        const row = this.state.listTransportRows(space.id).find((item) => item.kind === 'folder' && item.enabled);
        const config = row ? parseConfig(row) : null;
        if (typeof config?.path !== 'string' || !fs_1.default.existsSync(config.path))
            return;
        try {
            this.folderWatcher = fs_1.default.watch(config.path, { recursive: true }, (_event, fileName) => {
                const relative = String(fileName ?? '').replace(/\\/g, '/');
                if (relative.startsWith('devices/') || relative.startsWith('acknowledgements/') || relative.includes('.tmp'))
                    return;
                if (this.folderWatchTimer)
                    clearTimeout(this.folderWatchTimer);
                this.folderWatchTimer = setTimeout(() => {
                    this.folderWatchTimer = null;
                    void this.runCycle('folder-watch').catch(() => undefined);
                }, 800);
            });
            this.folderWatcher.on('error', () => {
                this.folderWatcher?.close();
                this.folderWatcher = null;
            });
        }
        catch {
            // Periodic and focus cycles remain the cross-platform fallback.
        }
    }
}
exports.SyncLifecycleService = SyncLifecycleService;
exports.syncLifecycleService = new SyncLifecycleService();
//# sourceMappingURL=SyncLifecycleService.js.map