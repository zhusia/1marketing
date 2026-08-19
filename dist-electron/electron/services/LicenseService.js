"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.licenseService = exports.LicenseService = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const LemonSqueezyService_1 = require("./LemonSqueezyService");
const userDataPath_1 = require("../utils/userDataPath");
const FREE_TIER_LIMITS = {
    workspaces: 1,
    projects: 2,
};
function defaultStore() {
    return {
        license: null,
        deviceId: '',
        deviceName: '',
        isLicensed: false,
    };
}
function safeReadStore(filePath) {
    try {
        if (!fs_1.default.existsSync(filePath))
            return defaultStore();
        const parsed = JSON.parse(fs_1.default.readFileSync(filePath, 'utf8'));
        return {
            license: parsed.license ?? null,
            deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : '',
            deviceName: typeof parsed.deviceName === 'string' ? parsed.deviceName : '',
            isLicensed: Boolean(parsed.isLicensed),
        };
    }
    catch (error) {
        console.warn('[LicenseService] Failed to read license store', error);
        return defaultStore();
    }
}
class LicenseService {
    deviceName = os_1.default.hostname() || 'unknown-device';
    listeners = new Set();
    /**
     * Entitlement gate evaluator. When set, its verdict overrides the legacy
     * `isLicensed` boolean. Injected from main after the gate is built, so
     * LicenseService stays decoupled and unit-testable. Absent → legacy boolean.
     */
    entitlementEvaluator = null;
    entitlementRefresh = null;
    storePath() {
        return path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), 'license.json');
    }
    readStore() {
        const store = safeReadStore(this.storePath());
        if (!store.deviceId) {
            store.deviceId = (0, crypto_1.randomUUID)();
            store.deviceName = this.deviceName;
            this.writeStore(store);
        }
        return store;
    }
    writeStore(store) {
        const filePath = this.storePath();
        fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.${process.pid}.tmp`;
        fs_1.default.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
        fs_1.default.renameSync(tempPath, filePath);
    }
    /**
     * Wire the entitlement gate. After this, `getLicenseInfo().isLicensed` reflects
     * the cryptographic verdict, not the raw boolean. Fail-safe: the gate itself
     * falls back to the legacy boolean on any error.
     *
     * `refresh` re-evaluates the gate after a LICENSE MUTATION (activate/deactivate)
     * so a fresh activation grants Pro immediately instead of serving the latched
     * pre-activation verdict until the next boot/24h pass. `resetLatch` is set for
     * user-initiated downgrades (deactivate), where "never downgrade mid-session"
     * would wrongly preserve Pro the user just gave up.
     */
    setEntitlementEvaluator(evaluator, refresh) {
        this.entitlementEvaluator = evaluator;
        this.entitlementRefresh = refresh ?? null;
    }
    /** Raw legacy license, straight off disk — the gate's input. NEVER calls the gate. */
    getRawLicenseSnapshot() {
        // Open-source build: the raw snapshot always reports licensed so every
        // legacy-boolean consumer (gate fallback, feature flags) stays unlocked.
        const store = this.readStore();
        return {
            isLicensed: true,
            licenseKey: store.license?.licenseKey ?? null,
            instanceId: store.license?.instanceId ?? null,
        };
    }
    /** Public re-emit of the license snapshot — used after a gate re-evaluation. */
    notifyLicenseChanged() {
        this.notifyChange();
    }
    getLicenseInfo() {
        // Open-source build: always fully licensed. No key, no server, no gate.
        const store = this.readStore();
        const license = store.license;
        return {
            isLicensed: true,
            licenseId: license?.lsLicenseId ?? null,
            licenseKey: license?.licenseKey ?? null,
            email: license?.email ?? null,
            customerName: license?.customerName ?? null,
            deviceLimit: null,
            activatedDevices: license?.activationUsage ?? 0,
            updatesUntil: null,
            activatedAt: license?.activatedAt ?? null,
            lastVerified: null,
            canUpdate: true,
            status: 'active',
            variantName: 'Open Source',
            instanceName: null,
            instanceId: null,
            currentDeviceId: store.deviceId,
            deviceName: this.deviceName,
            proSource: 'open-source',
            entitlementNotice: null,
            graceUntil: null,
        };
    }
    getUsageLimits() {
        const info = this.getLicenseInfo();
        if (info.isLicensed) {
            return {
                isLicensed: true,
                maxWorkspaces: null,
                maxProjects: null,
                canImportExport: true,
            };
        }
        return {
            isLicensed: false,
            maxWorkspaces: FREE_TIER_LIMITS.workspaces,
            maxProjects: FREE_TIER_LIMITS.projects,
            canImportExport: false,
        };
    }
    canAddWorkspace(currentCount) {
        const info = this.getLicenseInfo();
        return this.generateLimitResult(currentCount, info.isLicensed ? null : FREE_TIER_LIMITS.workspaces, info.isLicensed, 'Free users can have 1 workspace. Upgrade to Pro for unlimited workspaces.');
    }
    canAddProject(currentCount) {
        const info = this.getLicenseInfo();
        return this.generateLimitResult(currentCount, info.isLicensed ? null : FREE_TIER_LIMITS.projects, info.isLicensed, 'Free users can have 2 projects. Upgrade to Pro for unlimited projects.');
    }
    canUseImportExport() {
        const info = this.getLicenseInfo();
        return {
            allowed: info.isLicensed,
            isLicensed: info.isLicensed,
            reason: info.isLicensed ? undefined : 'Local data import and export are Pro features.',
        };
    }
    canUseSync() {
        const info = this.getLicenseInfo();
        return {
            allowed: info.isLicensed,
            isLicensed: info.isLicensed,
            reason: info.isLicensed ? undefined : 'Cross-device sync is a Pro feature on every participating device.',
        };
    }
    requireImportExport(action) {
        const result = this.canUseImportExport();
        if (!result.allowed) {
            throw new Error(`A Pro license is required to ${action} data.`);
        }
    }
    onChange(listener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
    async activateLicense(licenseKey) {
        const trimmedKey = licenseKey.trim();
        if (!trimmedKey) {
            throw new Error('License key is required');
        }
        // Open-source build: activation is a local no-op — no LemonSqueezy call.
        const store = this.readStore();
        store.license = {
            licenseKey: trimmedKey,
            lsLicenseId: null,
            instanceId: 'opensource',
            instanceName: 'Open Source',
            email: null,
            customerName: null,
            storeId: null,
            orderId: null,
            productId: null,
            variantId: null,
            variantName: 'Open Source',
            activationLimit: null,
            activationUsage: 1,
            status: 'active',
            expiresAt: null,
            activatedAt: new Date().toISOString(),
            lastVerified: new Date().toISOString(),
            metadata: null,
        };
        store.isLicensed = true;
        this.writeStore(store);
        this.notifyChange();
    }
    async validateLicense() {
        // Open-source build: always valid, no network call.
        return true;
    }
    async deactivateLicense() {
        const store = this.readStore();
        if (!store.isLicensed) {
            throw new Error('No active license to deactivate');
        }
        // Open-source build: deactivation is a local cleanup, no LemonSqueezy call.
        store.license = null;
        store.isLicensed = false;
        this.writeStore(store);
        this.notifyChange();
    }
    generateLimitResult(current, max, isLicensed, blockedReason) {
        const allowed = max === null || current < max;
        return {
            allowed,
            current,
            max,
            remaining: max === null ? null : Math.max(max - current, 0),
            isLicensed,
            reason: allowed ? undefined : blockedReason,
        };
    }
    notifyChange() {
        if (!this.listeners.size)
            return;
        const snapshot = { info: this.getLicenseInfo(), limits: this.getUsageLimits() };
        for (const listener of this.listeners) {
            try {
                listener(snapshot);
            }
            catch (error) {
                console.error('[LicenseService] Change listener threw', error);
            }
        }
    }
}
exports.LicenseService = LicenseService;
exports.licenseService = new LicenseService();
//# sourceMappingURL=LicenseService.js.map