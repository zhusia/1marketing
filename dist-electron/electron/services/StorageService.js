"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageService = exports.StorageService = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const AppRepository_1 = require("./AppRepository");
const CredentialVault_1 = require("./CredentialVault");
const userDataPath_1 = require("../utils/userDataPath");
const STORAGE_POLICY_KEY = 'storageCleanupPolicy';
const STORAGE_SECRET_PREFIX = 'storage:';
const DASHBOARD_SITE_CACHE_KEY = 'dashboard.siteCache';
const GB = 1024 * 1024 * 1024;
const DEFAULT_QUOTA_BYTES = 50 * GB;
const MIN_QUOTA_BYTES = 256 * 1024 * 1024;
const MAX_QUOTA_BYTES = 50 * GB;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_POLICY = {
    quotaBytes: DEFAULT_QUOTA_BYTES,
    autoCleanupEnabled: true,
    logsRetentionDays: 30,
    exportsRetentionDays: 30,
    cacheRetentionDays: 30,
};
const EXPORT_DIRS = ['directory-exports', 'site-audit-exports', 'published-content'];
const BROWSER_EXTENSION_DIR = '1marketingtool-browser-extension';
const CLEANUP_TARGETS = new Set([
    'syncLogs',
    'aiLogs',
    'apiLogs',
    'allLogs',
    'cache',
    'exports',
    'orphanedAssets',
    'databaseMaintenance',
]);
const STORAGE_PROFILE_PROVIDERS = new Set([
    'r2',
    's3',
    'minio',
    'backblaze',
    'wasabi',
    'generic_s3',
]);
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function clampInteger(value, fallback, min, max) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
}
function normalizePolicy(value) {
    const record = isRecord(value) ? value : {};
    return {
        quotaBytes: clampInteger(record.quotaBytes, DEFAULT_POLICY.quotaBytes, MIN_QUOTA_BYTES, MAX_QUOTA_BYTES),
        autoCleanupEnabled: typeof record.autoCleanupEnabled === 'boolean' ? record.autoCleanupEnabled : DEFAULT_POLICY.autoCleanupEnabled,
        logsRetentionDays: clampInteger(record.logsRetentionDays, DEFAULT_POLICY.logsRetentionDays, 1, 3650),
        exportsRetentionDays: clampInteger(record.exportsRetentionDays, DEFAULT_POLICY.exportsRetentionDays, 1, 3650),
        cacheRetentionDays: clampInteger(record.cacheRetentionDays, DEFAULT_POLICY.cacheRetentionDays, 1, 3650),
    };
}
function optionalString(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed || null;
}
function storageSecretAccount(profileId) {
    return `${STORAGE_SECRET_PREFIX}${profileId}`;
}
function normalizeStorageProvider(value) {
    return STORAGE_PROFILE_PROVIDERS.has(value) ? value : 'r2';
}
function normalizePrefix(value) {
    return optionalString(value)?.replace(/^\/+|\/+$/g, '') || null;
}
function normalizePublicBaseUrl(value) {
    return optionalString(value)?.replace(/\/+$/g, '') || null;
}
function normalizeProfileInput(input) {
    const provider = normalizeStorageProvider(input.provider);
    const name = optionalString(input.name);
    const bucket = optionalString(input.bucket);
    const endpoint = optionalString(input.endpoint);
    const region = optionalString(input.region) ?? (provider === 'r2' ? 'auto' : 'us-east-1');
    if (!name)
        throw new Error('Storage profile name is required.');
    if (!bucket)
        throw new Error('Storage bucket is required.');
    if ((provider === 'r2' || provider === 'minio' || provider === 'generic_s3') && !endpoint) {
        throw new Error('Endpoint is required for this storage provider.');
    }
    return {
        id: optionalString(input.id),
        name,
        provider,
        endpoint,
        region,
        bucket,
        prefix: normalizePrefix(input.prefix),
        publicBaseUrl: normalizePublicBaseUrl(input.publicBaseUrl),
        forcePathStyle: Boolean(input.forcePathStyle),
        enabled: Boolean(input.enabled),
        isDefault: Boolean(input.isDefault),
    };
}
function profileProbeUrl(profile) {
    if (profile.publicBaseUrl)
        return profile.publicBaseUrl;
    const endpoint = profile.endpoint ? (profile.endpoint.includes('://') ? profile.endpoint : `https://${profile.endpoint}`) : null;
    if (endpoint) {
        try {
            const url = new URL(endpoint);
            if (profile.forcePathStyle) {
                url.pathname = `${url.pathname.replace(/\/+$/g, '')}/${profile.bucket}`;
            }
            else if (!url.hostname.startsWith(`${profile.bucket}.`)) {
                url.hostname = `${profile.bucket}.${url.hostname}`;
            }
            return url.toString();
        }
        catch {
            return null;
        }
    }
    if (profile.provider === 's3') {
        return `https://${profile.bucket}.s3.${profile.region}.amazonaws.com`;
    }
    if (profile.provider === 'backblaze') {
        return `https://${profile.bucket}.s3.${profile.region}.backblazeb2.com`;
    }
    if (profile.provider === 'wasabi') {
        return `https://${profile.bucket}.s3.${profile.region}.wasabisys.com`;
    }
    return null;
}
function olderThanCutoff(days) {
    if (days === undefined)
        return null;
    return Date.now() - Math.max(0, days) * DAY_MS;
}
function pathForCompare(filePath) {
    const resolved = path_1.default.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function isInside(root, candidate) {
    const rootPath = pathForCompare(root);
    const candidatePath = pathForCompare(candidate);
    return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path_1.default.sep}`);
}
async function statPath(filePath) {
    try {
        return await fs_1.default.promises.lstat(filePath);
    }
    catch {
        return null;
    }
}
async function pathSize(filePath) {
    const stats = await statPath(filePath);
    if (!stats || stats.isSymbolicLink())
        return { bytes: 0, items: 0 };
    if (stats.isFile())
        return { bytes: stats.size, items: 1 };
    if (!stats.isDirectory())
        return { bytes: 0, items: 0 };
    let bytes = 0;
    let items = 0;
    const entries = await fs_1.default.promises.readdir(filePath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const child = path_1.default.join(filePath, entry.name);
        const size = await pathSize(child);
        bytes += size.bytes;
        items += size.items;
    }
    return { bytes, items };
}
async function collectFiles(filePath, cutoff = null) {
    const stats = await statPath(filePath);
    if (!stats || stats.isSymbolicLink())
        return [];
    if (stats.isFile()) {
        if (cutoff === null || stats.mtimeMs < cutoff) {
            return [{ path: filePath, bytes: stats.size, mtimeMs: stats.mtimeMs }];
        }
        return [];
    }
    if (!stats.isDirectory())
        return [];
    const entries = await fs_1.default.promises.readdir(filePath, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        files.push(...(await collectFiles(path_1.default.join(filePath, entry.name), cutoff)));
    }
    return files;
}
async function removeEmptyDirectories(root, current = root) {
    const entries = await fs_1.default.promises.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (entry.isDirectory()) {
            await removeEmptyDirectories(root, path_1.default.join(current, entry.name));
        }
    }
    if (pathForCompare(current) === pathForCompare(root))
        return;
    const remaining = await fs_1.default.promises.readdir(current).catch(() => null);
    if (remaining && remaining.length === 0) {
        await fs_1.default.promises.rm(current, { recursive: false, force: true }).catch(() => undefined);
    }
}
function countDashboardCacheEntries(value) {
    if (!isRecord(value))
        return 0;
    if (typeof value.syncedAt === 'number')
        return 1;
    return Object.values(value).reduce((count, child) => count + countDashboardCacheEntries(child), 0);
}
function pruneDashboardCacheValue(value, cutoff) {
    if (!isRecord(value)) {
        return { value, deletedItems: 0, deletedBytes: 0 };
    }
    if (typeof value.syncedAt === 'number' && value.syncedAt < cutoff) {
        return { value: null, deletedItems: 1, deletedBytes: JSON.stringify(value).length };
    }
    let deletedItems = 0;
    let deletedBytes = 0;
    const next = {};
    for (const [key, child] of Object.entries(value)) {
        const pruned = pruneDashboardCacheValue(child, cutoff);
        deletedItems += pruned.deletedItems;
        deletedBytes += pruned.deletedBytes;
        if (pruned.value !== null)
            next[key] = pruned.value;
    }
    return { value: next, deletedItems, deletedBytes };
}
class StorageService {
    appDataRoot() {
        const root = (0, userDataPath_1.resolveUserDataPath)();
        fs_1.default.mkdirSync(root, { recursive: true });
        return root;
    }
    getPolicy() {
        return normalizePolicy(AppRepository_1.repository.getSetting(STORAGE_POLICY_KEY)?.value);
    }
    savePolicy(input) {
        const policy = normalizePolicy({ ...this.getPolicy(), ...input });
        AppRepository_1.repository.setSetting(STORAGE_POLICY_KEY, policy);
        return policy;
    }
    async listProfiles() {
        const profiles = AppRepository_1.repository.listStorageProfiles();
        const synced = [];
        for (const profile of profiles) {
            const hasSecret = await CredentialVault_1.credentialVault.hasSecret(storageSecretAccount(profile.id));
            synced.push(hasSecret === profile.hasSecret ? profile : AppRepository_1.repository.setStorageProfileHasSecret(profile.id, hasSecret) ?? profile);
        }
        return synced;
    }
    upsertProfile(input) {
        return AppRepository_1.repository.upsertStorageProfile(normalizeProfileInput(input));
    }
    async saveProfileSecret(input) {
        const profileId = optionalString(input.profileId);
        if (!profileId)
            throw new Error('Storage profile is required.');
        const profile = AppRepository_1.repository.getStorageProfile(profileId);
        if (!profile)
            throw new Error('Storage profile was not found.');
        if (input.clear) {
            await CredentialVault_1.credentialVault.removeSecret(storageSecretAccount(profile.id));
            return AppRepository_1.repository.setStorageProfileHasSecret(profile.id, false) ?? profile;
        }
        const accessKeyId = optionalString(input.accessKeyId);
        const secretAccessKey = optionalString(input.secretAccessKey);
        if (!accessKeyId || !secretAccessKey) {
            throw new Error('Both access key ID and secret access key are required.');
        }
        await CredentialVault_1.credentialVault.setSecret(storageSecretAccount(profile.id), { accessKeyId, secretAccessKey });
        return AppRepository_1.repository.setStorageProfileHasSecret(profile.id, true) ?? profile;
    }
    async testProfile(input) {
        const profileId = optionalString(input.profileId);
        const profile = profileId ? AppRepository_1.repository.getStorageProfile(profileId) : null;
        if (!profile)
            throw new Error('Storage profile was not found.');
        const checkedAt = Date.now();
        const hasSecret = await CredentialVault_1.credentialVault.hasSecret(storageSecretAccount(profile.id));
        if (!hasSecret) {
            AppRepository_1.repository.setStorageProfileHasSecret(profile.id, false);
            return {
                ok: false,
                message: 'Add access keys before testing this storage profile.',
                checkedAt,
            };
        }
        const probeUrl = profileProbeUrl(profile);
        if (!probeUrl) {
            return {
                ok: true,
                message: 'Profile and credentials are saved. Add an endpoint to test bucket reachability.',
                checkedAt,
            };
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(probeUrl, { method: 'HEAD', signal: controller.signal });
            if (response.ok) {
                return { ok: true, message: 'Bucket endpoint is reachable.', checkedAt };
            }
            if (response.status === 401 || response.status === 403 || response.status === 405) {
                return {
                    ok: true,
                    message: `Bucket endpoint responded with ${response.status}; saved credentials will be used by signed storage actions.`,
                    checkedAt,
                };
            }
            return {
                ok: false,
                message: `Bucket endpoint responded with ${response.status}. Check the endpoint, region, and bucket name.`,
                checkedAt,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Could not reach bucket endpoint.';
            return { ok: false, message, checkedAt };
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async deleteProfile(input) {
        const id = optionalString(input.id);
        if (!id)
            throw new Error('Storage profile is required.');
        if (AppRepository_1.repository.storageProfileAssetCount(id) > 0) {
            throw new Error('This storage profile is used by assets and cannot be deleted.');
        }
        const deleted = AppRepository_1.repository.deleteStorageProfile(id);
        if (deleted)
            await CredentialVault_1.credentialVault.removeSecret(storageSecretAccount(id));
        return { deleted };
    }
    async analyze() {
        const root = this.appDataRoot();
        const policy = this.getPolicy();
        const rootSize = await pathSize(root);
        const database = await this.databaseSize(root);
        const assets = await pathSize(this.assetsRoot(root));
        const exportsSize = await this.exportsSize(root);
        const browserExtension = await pathSize(path_1.default.join(root, BROWSER_EXTENSION_DIR));
        const oldExports = await this.measureOldExports(root, policy.exportsRetentionDays);
        const orphanAssets = await this.measureOrphanManagedAssets(root);
        const tableStats = AppRepository_1.repository.getStorageTableStats();
        const logsBytes = tableStats.syncLogs.estimatedBytes + tableStats.aiLogs.estimatedBytes + tableStats.apiLogs.estimatedBytes;
        const logsCount = tableStats.syncLogs.count + tableStats.aiLogs.count + tableStats.apiLogs.count;
        const cacheBytes = tableStats.keywordPlannerCache.estimatedBytes + tableStats.dashboardCache.estimatedBytes;
        const cacheCount = tableStats.keywordPlannerCache.count + tableStats.dashboardCache.count;
        const knownBytes = database.bytes + assets.bytes + exportsSize.bytes + browserExtension.bytes;
        const otherBytes = Math.max(0, rootSize.bytes - knownBytes);
        const categories = [
            {
                id: 'database',
                label: 'SQLite database',
                description: 'Primary local database plus SQLite WAL/SHM files.',
                bytes: database.bytes,
                clearableBytes: database.clearableBytes,
                itemCount: database.items,
                path: path_1.default.join(root, '1marketingtool.db'),
            },
            {
                id: 'logs',
                label: 'Database logs',
                description: 'Sync, AI agent, MCP, and external API call log payloads stored in SQLite.',
                bytes: logsBytes,
                clearableBytes: logsBytes,
                itemCount: logsCount,
            },
            {
                id: 'cache',
                label: 'Cached reports',
                description: 'Keyword Planner and dashboard report caches stored in SQLite settings/tables.',
                bytes: cacheBytes,
                clearableBytes: cacheBytes,
                itemCount: cacheCount,
            },
            {
                id: 'assets',
                label: 'Managed assets',
                description: 'Files copied into the asset library. Only orphaned files are clearable automatically.',
                bytes: assets.bytes,
                clearableBytes: orphanAssets.bytes,
                itemCount: assets.items,
                path: this.assetsRoot(root),
            },
            {
                id: 'exports',
                label: 'Exports and local publishes',
                description: 'Manual directory exports, audit exports, and local published markdown.',
                bytes: exportsSize.bytes,
                clearableBytes: oldExports.bytes,
                itemCount: exportsSize.items,
            },
            {
                id: 'browserExtension',
                label: 'Browser extension',
                description: 'Generated Chrome extension files used by Google automation.',
                bytes: browserExtension.bytes,
                clearableBytes: 0,
                itemCount: browserExtension.items,
                path: path_1.default.join(root, BROWSER_EXTENSION_DIR),
            },
            {
                id: 'other',
                label: 'Other app files',
                description: 'Remaining app-owned files in the data directory.',
                bytes: otherBytes,
                clearableBytes: 0,
                itemCount: Math.max(0, rootSize.items - database.items - assets.items - exportsSize.items - browserExtension.items),
                path: root,
            },
        ];
        return {
            rootPath: root,
            totalBytes: rootSize.bytes,
            quotaBytes: policy.quotaBytes,
            quotaUsedRatio: policy.quotaBytes > 0 ? rootSize.bytes / policy.quotaBytes : 0,
            policy,
            categories,
            analyzedAt: Date.now(),
        };
    }
    async clean(input) {
        const before = await this.analyze();
        const actions = [];
        const targets = this.normalizeTargets(input.targets);
        const cutoff = olderThanCutoff(input.olderThanDays);
        let needsMaintenance = false;
        if (targets.has('allLogs')) {
            const stats = AppRepository_1.repository.getStorageTableStats();
            const deletedItems = cutoff === null
                ? AppRepository_1.repository.clearSyncLogs() + AppRepository_1.repository.clearAiLogs() + AppRepository_1.repository.clearApiLogs()
                : AppRepository_1.repository.clearSyncLogsBefore(cutoff) + AppRepository_1.repository.clearAiLogsBefore(cutoff) + AppRepository_1.repository.clearApiLogsBefore(cutoff);
            actions.push({
                target: 'allLogs',
                label: cutoff === null ? 'All logs' : 'Old logs',
                deletedBytes: stats.syncLogs.estimatedBytes + stats.aiLogs.estimatedBytes + stats.apiLogs.estimatedBytes,
                deletedItems,
            });
            needsMaintenance = true;
        }
        else {
            if (targets.has('syncLogs')) {
                const stats = AppRepository_1.repository.getStorageTableStats().syncLogs;
                const deletedItems = cutoff === null ? AppRepository_1.repository.clearSyncLogs() : AppRepository_1.repository.clearSyncLogsBefore(cutoff);
                actions.push({ target: 'syncLogs', label: 'Sync logs', deletedBytes: stats.estimatedBytes, deletedItems });
                needsMaintenance = true;
            }
            if (targets.has('aiLogs')) {
                const stats = AppRepository_1.repository.getStorageTableStats().aiLogs;
                const deletedItems = cutoff === null ? AppRepository_1.repository.clearAiLogs() : AppRepository_1.repository.clearAiLogsBefore(cutoff);
                actions.push({ target: 'aiLogs', label: 'AI logs', deletedBytes: stats.estimatedBytes, deletedItems });
                needsMaintenance = true;
            }
            if (targets.has('apiLogs')) {
                const stats = AppRepository_1.repository.getStorageTableStats().apiLogs;
                const deletedItems = cutoff === null ? AppRepository_1.repository.clearApiLogs() : AppRepository_1.repository.clearApiLogsBefore(cutoff);
                actions.push({ target: 'apiLogs', label: 'API logs', deletedBytes: stats.estimatedBytes, deletedItems });
                needsMaintenance = true;
            }
        }
        if (targets.has('cache')) {
            const stats = AppRepository_1.repository.getStorageTableStats();
            const keywordItems = cutoff === null ? AppRepository_1.repository.clearKeywordPlannerCache() : AppRepository_1.repository.clearKeywordPlannerCacheBefore(cutoff);
            const dashboard = this.clearDashboardCache(cutoff);
            actions.push({
                target: 'cache',
                label: cutoff === null ? 'All caches' : 'Old caches',
                deletedBytes: stats.keywordPlannerCache.estimatedBytes + dashboard.deletedBytes,
                deletedItems: keywordItems + dashboard.deletedItems,
            });
            needsMaintenance = true;
        }
        if (targets.has('exports')) {
            const deleted = await this.deleteExports(this.appDataRoot(), cutoff);
            actions.push({
                target: 'exports',
                label: cutoff === null ? 'All exports' : 'Old exports',
                deletedBytes: deleted.bytes,
                deletedItems: deleted.items,
            });
        }
        if (targets.has('orphanedAssets')) {
            const deleted = await this.deleteOrphanManagedAssets(this.appDataRoot());
            actions.push({
                target: 'orphanedAssets',
                label: 'Orphaned managed assets',
                deletedBytes: deleted.bytes,
                deletedItems: deleted.items,
            });
            if (deleted.items > 0)
                needsMaintenance = true;
        }
        if (targets.has('databaseMaintenance') || needsMaintenance) {
            AppRepository_1.repository.runStorageMaintenance();
            if (targets.has('databaseMaintenance')) {
                actions.push({
                    target: 'databaseMaintenance',
                    label: 'SQLite maintenance',
                    deletedBytes: 0,
                    deletedItems: 0,
                });
            }
        }
        const report = await this.analyze();
        return {
            deletedBytes: Math.max(0, before.totalBytes - report.totalBytes),
            deletedItems: actions.reduce((sum, action) => sum + action.deletedItems, 0),
            actions,
            report,
        };
    }
    async runAutoCleanup() {
        const policy = this.getPolicy();
        if (!policy.autoCleanupEnabled)
            return null;
        await this.clean({ targets: ['allLogs'], olderThanDays: policy.logsRetentionDays });
        await this.clean({ targets: ['cache'], olderThanDays: policy.cacheRetentionDays });
        await this.clean({ targets: ['exports'], olderThanDays: policy.exportsRetentionDays });
        await this.clean({ targets: ['orphanedAssets', 'databaseMaintenance'] });
        const report = await this.analyze();
        if (report.totalBytes <= policy.quotaBytes)
            return null;
        return this.clean({
            targets: ['allLogs', 'cache', 'exports', 'orphanedAssets', 'databaseMaintenance'],
        });
    }
    normalizeTargets(targets) {
        const normalized = new Set();
        for (const target of targets) {
            if (CLEANUP_TARGETS.has(target))
                normalized.add(target);
        }
        return normalized;
    }
    assetsRoot(root) {
        return path_1.default.join(root, 'assets');
    }
    async databaseSize(root) {
        const dbPath = path_1.default.join(root, '1marketingtool.db');
        const files = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
        let bytes = 0;
        let items = 0;
        let clearableBytes = 0;
        for (const filePath of files) {
            const stats = await statPath(filePath);
            if (!stats?.isFile())
                continue;
            bytes += stats.size;
            items += 1;
            if (filePath.endsWith('-wal') || filePath.endsWith('-shm'))
                clearableBytes += stats.size;
        }
        return { bytes, items, clearableBytes };
    }
    async exportsSize(root) {
        let bytes = 0;
        let items = 0;
        for (const dirname of EXPORT_DIRS) {
            const size = await pathSize(path_1.default.join(root, dirname));
            bytes += size.bytes;
            items += size.items;
        }
        return { bytes, items };
    }
    async measureOldExports(root, days) {
        const cutoff = olderThanCutoff(days);
        if (cutoff === null)
            return { bytes: 0, items: 0 };
        let bytes = 0;
        let items = 0;
        for (const dirname of EXPORT_DIRS) {
            const files = await collectFiles(path_1.default.join(root, dirname), cutoff);
            bytes += files.reduce((sum, file) => sum + file.bytes, 0);
            items += files.length;
        }
        return { bytes, items };
    }
    async deleteExports(root, cutoff) {
        let bytes = 0;
        let items = 0;
        for (const dirname of EXPORT_DIRS) {
            const dir = path_1.default.join(root, dirname);
            if (!isInside(root, dir))
                continue;
            const files = await collectFiles(dir, cutoff);
            for (const file of files) {
                await fs_1.default.promises.rm(file.path, { force: true }).catch(() => undefined);
                bytes += file.bytes;
                items += 1;
            }
            await removeEmptyDirectories(dir).catch(() => undefined);
        }
        return { bytes, items };
    }
    clearDashboardCache(cutoff) {
        const current = AppRepository_1.repository.getSetting(DASHBOARD_SITE_CACHE_KEY)?.value;
        if (!isRecord(current))
            return { deletedItems: 0, deletedBytes: 0 };
        if (cutoff === null) {
            const deletedItems = countDashboardCacheEntries(current);
            const deletedBytes = JSON.stringify(current).length;
            AppRepository_1.repository.setSetting(DASHBOARD_SITE_CACHE_KEY, {});
            return { deletedItems, deletedBytes };
        }
        const pruned = pruneDashboardCacheValue(current, cutoff);
        if (pruned.deletedItems > 0)
            AppRepository_1.repository.setSetting(DASHBOARD_SITE_CACHE_KEY, pruned.value ?? {});
        return { deletedItems: pruned.deletedItems, deletedBytes: pruned.deletedBytes };
    }
    async measureOrphanManagedAssets(root) {
        const assetsRoot = this.assetsRoot(root);
        const referenced = new Set(AppRepository_1.repository.listManagedAssetPaths().map((asset) => pathForCompare(asset.localPath)));
        const files = await collectFiles(assetsRoot);
        const orphaned = files.filter((file) => !referenced.has(pathForCompare(file.path)));
        return {
            bytes: orphaned.reduce((sum, file) => sum + file.bytes, 0),
            items: orphaned.length,
        };
    }
    async deleteOrphanManagedAssets(root) {
        const assetsRoot = this.assetsRoot(root);
        const managed = AppRepository_1.repository.listManagedAssetPaths();
        const referenced = new Set(managed.map((asset) => pathForCompare(asset.localPath)));
        const existingPaths = new Set();
        for (const asset of managed) {
            const stats = await statPath(asset.localPath);
            if (stats?.isFile())
                existingPaths.add(asset.localPath);
        }
        const missingRows = AppRepository_1.repository.clearMissingManagedAssets(existingPaths);
        let bytes = 0;
        let items = missingRows;
        const files = await collectFiles(assetsRoot);
        for (const file of files) {
            if (referenced.has(pathForCompare(file.path)))
                continue;
            if (!isInside(assetsRoot, file.path))
                continue;
            await fs_1.default.promises.rm(file.path, { force: true }).catch(() => undefined);
            bytes += file.bytes;
            items += 1;
        }
        await removeEmptyDirectories(assetsRoot).catch(() => undefined);
        return { bytes, items };
    }
}
exports.StorageService = StorageService;
exports.storageService = new StorageService();
//# sourceMappingURL=StorageService.js.map