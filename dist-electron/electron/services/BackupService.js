"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.backupService = exports.BackupService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const events_1 = require("events");
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const electron_1 = require("electron");
const yauzl_1 = __importDefault(require("yauzl"));
const yazl_1 = __importDefault(require("yazl"));
const db_1 = require("../db");
const AppRepository_1 = require("./AppRepository");
const BackupRestore_1 = require("./BackupRestore");
const BACKUP_FORMAT = '1marketingtool.backup';
const BACKUP_FORMAT_VERSION = 1;
const SCHEMA_VERSION = 1;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const DATABASE_FILE = '1marketingtool.db';
const CHECKSUMS_ENTRY = 'checksums.json';
const RESTORE_NOTES_ENTRY = 'restore-notes.md';
const SETTINGS_ENTRY = 'settings/settings.json';
const CONNECTORS_ENTRY = 'connectors/connectors.json';
const STORAGE_PROFILES_ENTRY = 'storage/profiles.json';
const DATABASE_ENTRY = 'database/1marketingtool.db';
const ALLOWED_SETTINGS = new Set([
    'activeProductId',
    'activeWorkspaceId',
    'autoPublishEnabled',
    'mainCliId',
    'ai.activeAgentId',
    'automation.browserEngine',
    'mcpCliIntegrations',
    'layout.customizations',
    'performance.searchChartColors',
    'storageCleanupPolicy',
    'telemetryConsentShown',
    'telemetryOptIn',
]);
const EXCLUDED_SETTINGS = new Set([
    'subscriptionPlan',
    'trialStartedAt',
    'onboardingCompleted',
    'browserExtensionInstall',
    'browserExtensionRelayToken',
    'browserExtensionStatus',
    'dashboard.siteCache',
    'seo.backlinkProfileCache',
]);
const LOG_TABLES = ['sync_logs', 'ai_logs', 'api_logs'];
const CACHE_TABLES = ['keyword_planner_cache'];
// Protocol identity, encrypted outbox/inbox bytes, local paths, peer trust and execution claims are
// device-local. Restoring them would clone a device identity and can create batch collisions.
const SYNC_STATE_TABLES = [
    'sync_execution_claims',
    'sync_automation_assignments',
    'sync_lan_blob_inbox',
    'sync_lan_inbox',
    'sync_lan_peers',
    'sync_jobs',
    'sync_blob_state',
    'sync_conflicts',
    'sync_acknowledgements',
    'sync_devices',
    'sync_applied_operations',
    'sync_batches',
    'sync_outbound_batches',
    'sync_outbox',
    'sync_record_state',
    'sync_clocks',
    'sync_transports',
    'sync_spaces',
];
const MANAGED_DIRS = [
    { sourceName: 'assets', archivePrefix: 'files/assets' },
    { sourceName: 'directory-exports', archivePrefix: 'files/directory-exports' },
    { sourceName: 'site-audit-exports', archivePrefix: 'files/site-audit-exports' },
    { sourceName: 'published-content', archivePrefix: 'files/published-content' },
    { sourceName: '1marketingtool-browser-extension', archivePrefix: 'files/browser-extension' },
];
function appDataRoot() {
    return path_1.default.dirname((0, db_1.getDatabasePath)());
}
function backupTempRoot(root = appDataRoot()) {
    const tempRoot = path_1.default.join(root, 'backup-temp');
    fs_1.default.mkdirSync(tempRoot, { recursive: true });
    return tempRoot;
}
function nowToken() {
    return `${Date.now()}-${crypto_1.default.randomBytes(6).toString('hex')}`;
}
function defaultBackupName(kind) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${stamp}-1marketingtool-${kind === 'settings' ? 'settings' : 'full'}.1mtbackup`;
}
function formatBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function safeJsonBuffer(value) {
    return Buffer.from(JSON.stringify(value, null, 2), 'utf8');
}
function hashBuffer(buffer) {
    return crypto_1.default.createHash('sha256').update(buffer).digest('hex');
}
async function hashFile(filePath) {
    const hash = crypto_1.default.createHash('sha256');
    const stream = fs_1.default.createReadStream(filePath);
    for await (const chunk of stream) {
        hash.update(chunk);
    }
    return hash.digest('hex');
}
async function collectFiles(root, archivePrefix) {
    if (!fs_1.default.existsSync(root))
        return [];
    const entries = await fs_1.default.promises.readdir(root, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        const fullPath = path_1.default.join(root, entry.name);
        const archivePath = `${archivePrefix}/${entry.name}`;
        if (entry.isDirectory()) {
            results.push(...(await collectFiles(fullPath, archivePath)));
        }
        else if (entry.isFile()) {
            const stats = await fs_1.default.promises.stat(fullPath);
            results.push({ sourcePath: fullPath, archivePath, size: stats.size });
        }
    }
    return results;
}
async function collectManagedFiles(root) {
    const groups = await Promise.all(MANAGED_DIRS.map((dir) => collectFiles(path_1.default.join(root, dir.sourceName), dir.archivePrefix)));
    return groups.flat();
}
function includesFor(options) {
    return {
        settings: true,
        connectorMetadata: true,
        storageProfiles: true,
        database: options.kind === 'full',
        managedFiles: options.kind === 'full',
        logs: Boolean(options.includeLogs),
        cache: Boolean(options.includeCache),
        secrets: 'excluded',
    };
}
function portableSettings() {
    return AppRepository_1.repository.listSettings().filter((setting) => ALLOWED_SETTINGS.has(setting.key));
}
function isRecord(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isSensitiveKey(key) {
    return /(token|secret|password|authorization|api[-_]?key|access[-_]?key|client[-_]?secret)/i.test(key);
}
function redactConfig(value) {
    if (Array.isArray(value))
        return value.map(redactConfig);
    if (!isRecord(value))
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, isSensitiveKey(key) ? '[redacted]' : redactConfig(entry)]));
}
function portableConnectors() {
    return AppRepository_1.repository.listConnectors().map((connector) => ({
        name: connector.name,
        enabled: connector.enabled,
        status: connector.status,
        config: redactConfig(connector.config),
        hasSecret: connector.hasSecret,
    }));
}
function portableStorageProfiles() {
    return AppRepository_1.repository.listStorageProfiles().map((profile) => ({
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        endpoint: profile.endpoint,
        region: profile.region,
        bucket: profile.bucket,
        prefix: profile.prefix,
        publicBaseUrl: profile.publicBaseUrl,
        forcePathStyle: profile.forcePathStyle,
        hasSecret: profile.hasSecret,
        enabled: profile.enabled,
        isDefault: profile.isDefault,
    }));
}
function tableExists(db, tableName) {
    const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(tableName);
    return !!row;
}
function placeholders(values) {
    return values.map(() => '?').join(', ');
}
function sanitizeSnapshotDatabase(snapshotPath, options) {
    const db = new better_sqlite3_1.default(snapshotPath);
    try {
        db.pragma('foreign_keys = OFF');
        if (tableExists(db, 'settings')) {
            db.prepare(`DELETE FROM settings WHERE key NOT IN (${placeholders([...ALLOWED_SETTINGS])})`).run(...ALLOWED_SETTINGS);
            for (const key of EXCLUDED_SETTINGS) {
                db.prepare('DELETE FROM settings WHERE key = ?').run(key);
            }
            db.prepare("DELETE FROM settings WHERE key LIKE 'indexnow.%'").run();
        }
        if (tableExists(db, 'connectors')) {
            const rows = db.prepare('SELECT name, config_json FROM connectors').all();
            const update = db.prepare(`
        UPDATE connectors
        SET config_json = @configJson,
            has_secret = 0,
            status = CASE WHEN has_secret = 1 THEN 'attention' ELSE status END,
            last_tested_at = CASE WHEN has_secret = 1 THEN NULL ELSE last_tested_at END,
            last_error = CASE WHEN has_secret = 1 THEN 'Reconnect credentials after importing this backup.' ELSE last_error END
        WHERE name = @name
      `);
            for (const row of rows) {
                let parsed = {};
                try {
                    parsed = JSON.parse(row.config_json || '{}');
                }
                catch {
                    parsed = {};
                }
                update.run({ name: row.name, configJson: JSON.stringify(redactConfig(parsed)) });
            }
        }
        if (tableExists(db, 'storage_profiles')) {
            db.prepare('UPDATE storage_profiles SET has_secret = 0').run();
        }
        for (const table of SYNC_STATE_TABLES) {
            if (tableExists(db, table))
                db.prepare(`DELETE FROM ${table}`).run();
        }
        if (!options.includeLogs) {
            for (const table of LOG_TABLES) {
                if (tableExists(db, table))
                    db.prepare(`DELETE FROM ${table}`).run();
            }
        }
        if (!options.includeCache) {
            for (const table of CACHE_TABLES) {
                if (tableExists(db, table))
                    db.prepare(`DELETE FROM ${table}`).run();
            }
            if (tableExists(db, 'settings')) {
                db.prepare("DELETE FROM settings WHERE key IN ('dashboard.siteCache', 'seo.backlinkProfileCache')").run();
            }
        }
        db.exec('VACUUM');
    }
    finally {
        db.close();
    }
}
function manifestFor(options, counts, warnings, root) {
    return {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        backupKind: options.kind,
        appVersion: electron_1.app.getVersion(),
        schemaVersion: SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        sourcePlatform: process.platform,
        sourceUserDataRoot: root,
        includes: includesFor(options),
        counts,
        warnings,
    };
}
function restoreNotes(manifest) {
    return [
        '# 1MarketingTool Backup',
        '',
        `Created: ${manifest.createdAt}`,
        `Kind: ${manifest.backupKind}`,
        `App version: ${manifest.appVersion}`,
        '',
        'Credentials are excluded. Reconnect affected providers after import.',
        '',
    ].join('\n');
}
async function writeZipArchive(targetPath, buffers, files) {
    const checksums = {};
    for (const entry of buffers) {
        checksums[entry.archivePath] = hashBuffer(entry.buffer);
    }
    for (const entry of files) {
        checksums[entry.archivePath] = await hashFile(entry.sourcePath);
    }
    const zip = new yazl_1.default.ZipFile();
    for (const entry of buffers) {
        zip.addBuffer(entry.buffer, entry.archivePath);
    }
    for (const entry of files) {
        zip.addFile(entry.sourcePath, entry.archivePath);
    }
    zip.addBuffer(safeJsonBuffer(checksums), CHECKSUMS_ENTRY);
    zip.end();
    await new Promise((resolve, reject) => {
        const output = fs_1.default.createWriteStream(targetPath);
        zip.outputStream.pipe(output);
        zip.outputStream.on('error', reject);
        output.on('error', reject);
        output.on('close', resolve);
    });
    return checksums;
}
function openZip(filePath) {
    return new Promise((resolve, reject) => {
        yauzl_1.default.open(filePath, { lazyEntries: true }, (error, zip) => {
            if (error)
                reject(error);
            else if (!zip)
                reject(new Error('Could not open backup archive.'));
            else
                resolve(zip);
        });
    });
}
function openReadStream(zip, entry) {
    return new Promise((resolve, reject) => {
        zip.openReadStream(entry, (error, stream) => {
            if (error)
                reject(error);
            else if (!stream)
                reject(new Error(`Could not read archive entry ${entry.fileName}.`));
            else
                resolve(stream);
        });
    });
}
function isSafeArchivePath(entryName) {
    if (!entryName || entryName.includes('\\') || path_1.default.posix.isAbsolute(entryName))
        return false;
    return !entryName.split('/').some((part) => part === '..' || part === '');
}
async function writeChunk(output, chunk) {
    if (!output.write(chunk)) {
        await (0, events_1.once)(output, 'drain');
    }
}
async function consumeZipEntry(zip, entry, buffers, computedChecksums, extractRoot) {
    const entryName = entry.fileName;
    if (entryName.endsWith('/'))
        return;
    if (!isSafeArchivePath(entryName)) {
        throw new Error(`Unsafe archive entry path: ${entryName}`);
    }
    const shouldBuffer = entryName === CHECKSUMS_ENTRY ||
        entryName === SETTINGS_ENTRY ||
        entryName === CONNECTORS_ENTRY ||
        entryName === STORAGE_PROFILES_ENTRY ||
        entryName === 'manifest.json';
    const shouldExtract = !!extractRoot && (entryName === DATABASE_ENTRY || entryName.startsWith('files/'));
    const stream = await openReadStream(zip, entry);
    const hash = crypto_1.default.createHash('sha256');
    const chunks = [];
    const outputPath = shouldExtract ? path_1.default.join(extractRoot, entryName) : null;
    if (outputPath)
        fs_1.default.mkdirSync(path_1.default.dirname(outputPath), { recursive: true });
    const output = outputPath ? fs_1.default.createWriteStream(outputPath) : null;
    try {
        for await (const rawChunk of stream) {
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            hash.update(chunk);
            if (shouldBuffer)
                chunks.push(chunk);
            if (output)
                await writeChunk(output, chunk);
        }
    }
    finally {
        if (output)
            output.end();
    }
    if (output)
        await (0, events_1.once)(output, 'finish');
    if (shouldBuffer) {
        buffers.set(entryName, Buffer.concat(chunks));
    }
    if (entryName !== CHECKSUMS_ENTRY) {
        computedChecksums[entryName] = hash.digest('hex');
    }
}
async function readArchive(filePath, extractRoot) {
    const zip = await openZip(filePath);
    const buffers = new Map();
    const computedChecksums = {};
    try {
        await new Promise((resolve, reject) => {
            zip.on('entry', (entry) => {
                consumeZipEntry(zip, entry, buffers, computedChecksums, extractRoot)
                    .then(() => zip.readEntry())
                    .catch(reject);
            });
            zip.on('end', resolve);
            zip.on('error', reject);
            zip.readEntry();
        });
    }
    finally {
        zip.close();
    }
    const checksumBuffer = buffers.get(CHECKSUMS_ENTRY);
    const manifestBuffer = buffers.get('manifest.json');
    if (!checksumBuffer || !manifestBuffer) {
        throw new Error('Backup archive is missing required metadata.');
    }
    const expected = JSON.parse(checksumBuffer.toString('utf8'));
    for (const [entryName, digest] of Object.entries(computedChecksums)) {
        if (expected[entryName] !== digest) {
            throw new Error(`Backup checksum mismatch for ${entryName}.`);
        }
    }
    for (const entryName of Object.keys(expected)) {
        if (!computedChecksums[entryName]) {
            throw new Error(`Backup checksum references a missing entry: ${entryName}.`);
        }
    }
    const manifest = JSON.parse(manifestBuffer.toString('utf8'));
    if (manifest.format !== BACKUP_FORMAT)
        throw new Error('Unsupported backup format.');
    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION)
        throw new Error('Unsupported backup version.');
    if (manifest.schemaVersion > SCHEMA_VERSION)
        throw new Error('Backup was created by a newer schema version.');
    const settings = buffers.has(SETTINGS_ENTRY)
        ? JSON.parse(buffers.get(SETTINGS_ENTRY).toString('utf8'))
        : [];
    const connectors = buffers.has(CONNECTORS_ENTRY)
        ? JSON.parse(buffers.get(CONNECTORS_ENTRY).toString('utf8'))
        : [];
    const storageProfiles = buffers.has(STORAGE_PROFILES_ENTRY)
        ? JSON.parse(buffers.get(STORAGE_PROFILES_ENTRY).toString('utf8'))
        : [];
    return { manifest, settings, connectors, storageProfiles, computedChecksums };
}
async function createDatabaseSnapshot(options, targetDir) {
    const dbPath = path_1.default.join(targetDir, DATABASE_FILE);
    await (0, db_1.getDb)().backup(dbPath);
    sanitizeSnapshotDatabase(dbPath, options);
    return dbPath;
}
async function createCheckpointRoot(root, token) {
    const checkpointRoot = path_1.default.join(root, 'backup-checkpoints', token);
    fs_1.default.rmSync(checkpointRoot, { recursive: true, force: true });
    fs_1.default.mkdirSync(path_1.default.join(checkpointRoot, 'database'), { recursive: true });
    await (0, db_1.getDb)().backup(path_1.default.join(checkpointRoot, 'database', DATABASE_FILE));
    for (const dir of MANAGED_DIRS) {
        const source = path_1.default.join(root, dir.sourceName);
        const target = path_1.default.join(checkpointRoot, dir.archivePrefix);
        if (fs_1.default.existsSync(source)) {
            fs_1.default.mkdirSync(path_1.default.dirname(target), { recursive: true });
            fs_1.default.cpSync(source, target, { recursive: true, force: true });
        }
    }
    return checkpointRoot;
}
function normalizeOptions(options) {
    return {
        kind: options.kind === 'full' ? 'full' : 'settings',
        includeLogs: Boolean(options.includeLogs),
        includeCache: Boolean(options.includeCache),
    };
}
class BackupService {
    importTokens = new Map();
    async previewExport(input) {
        const options = normalizeOptions(input);
        const root = appDataRoot();
        const settings = portableSettings();
        const connectors = portableConnectors();
        const storageProfiles = portableStorageProfiles();
        const managedFiles = options.kind === 'full' ? await collectManagedFiles(root) : [];
        const dbSize = options.kind === 'full' && fs_1.default.existsSync((0, db_1.getDatabasePath)()) ? fs_1.default.statSync((0, db_1.getDatabasePath)()).size : 0;
        const estimatedBytes = safeJsonBuffer(settings).length +
            safeJsonBuffer(connectors).length +
            safeJsonBuffer(storageProfiles).length +
            managedFiles.reduce((sum, entry) => sum + entry.size, 0) +
            dbSize;
        const warnings = [
            'Credentials are excluded. Providers with saved secrets will need to be reconnected after import.',
            !options.includeLogs ? 'Logs are excluded from this backup.' : null,
            !options.includeCache ? 'Cache data is excluded from this backup.' : null,
        ].filter((value) => Boolean(value));
        return {
            kind: options.kind,
            estimatedBytes,
            counts: {
                settings: settings.length,
                connectors: connectors.length,
                storageProfiles: storageProfiles.length,
                managedFiles: managedFiles.length,
                database: options.kind === 'full' ? 1 : 0,
            },
            includes: includesFor(options),
            warnings,
        };
    }
    async export(input) {
        const options = normalizeOptions(input);
        const root = appDataRoot();
        const preview = await this.previewExport(options);
        const target = await electron_1.dialog.showSaveDialog({
            title: options.kind === 'settings' ? 'Export app settings' : 'Export app data',
            defaultPath: path_1.default.join(electron_1.app.getPath('documents'), defaultBackupName(options.kind)),
            filters: [{ name: '1MarketingTool Backup', extensions: ['1mtbackup'] }],
        });
        if (target.canceled || !target.filePath)
            return null;
        const tempDir = fs_1.default.mkdtempSync(path_1.default.join(backupTempRoot(root), 'export-'));
        try {
            const settings = portableSettings();
            const connectors = portableConnectors();
            const storageProfiles = portableStorageProfiles();
            const manifest = manifestFor(options, preview.counts, preview.warnings, root);
            const buffers = [
                { archivePath: 'manifest.json', buffer: safeJsonBuffer(manifest) },
                { archivePath: SETTINGS_ENTRY, buffer: safeJsonBuffer(settings) },
                { archivePath: CONNECTORS_ENTRY, buffer: safeJsonBuffer(connectors) },
                { archivePath: STORAGE_PROFILES_ENTRY, buffer: safeJsonBuffer(storageProfiles) },
                { archivePath: RESTORE_NOTES_ENTRY, buffer: Buffer.from(restoreNotes(manifest), 'utf8') },
            ];
            const files = [];
            if (options.kind === 'full') {
                const snapshotPath = await createDatabaseSnapshot(options, path_1.default.join(tempDir, 'database'));
                files.push({ sourcePath: snapshotPath, archivePath: DATABASE_ENTRY, size: fs_1.default.statSync(snapshotPath).size });
                files.push(...(await collectManagedFiles(root)));
            }
            await writeZipArchive(target.filePath, buffers, files);
            const stats = fs_1.default.statSync(target.filePath);
            electron_1.shell.showItemInFolder(target.filePath);
            return { filePath: target.filePath, bytes: stats.size, manifest };
        }
        finally {
            fs_1.default.rmSync(tempDir, { recursive: true, force: true });
        }
    }
    async inspectImport() {
        const selected = await electron_1.dialog.showOpenDialog({
            title: 'Import 1MarketingTool backup',
            properties: ['openFile'],
            filters: [{ name: '1MarketingTool Backup', extensions: ['1mtbackup'] }],
        });
        if (selected.canceled || !selected.filePaths[0])
            return null;
        const filePath = selected.filePaths[0];
        const archive = await readArchive(filePath);
        const warnings = [
            ...archive.manifest.warnings,
            archive.connectors.some((connector) => connector.hasSecret)
                ? 'Some connectors had credentials in the source app and will need reconnecting.'
                : null,
            archive.storageProfiles.some((profile) => profile.hasSecret)
                ? 'Some storage profiles had access keys in the source app and will need new keys.'
                : null,
        ].filter((value) => Boolean(value));
        const token = nowToken();
        const preview = {
            importToken: token,
            displayName: path_1.default.basename(filePath),
            manifest: archive.manifest,
            settingsKeys: archive.settings.map((setting) => setting.key).filter((key) => ALLOWED_SETTINGS.has(key)),
            connectorNames: archive.connectors.map((connector) => connector.name),
            storageProfileCount: archive.storageProfiles.length,
            warnings,
            requiresRestart: archive.manifest.backupKind === 'full',
        };
        this.importTokens.set(token, { filePath, preview, expiresAt: Date.now() + TOKEN_TTL_MS });
        return preview;
    }
    async import(input) {
        const token = this.importTokens.get(input.importToken);
        if (!token || token.expiresAt < Date.now()) {
            this.importTokens.delete(input.importToken);
            throw new Error('Backup import session expired. Choose the backup file again.');
        }
        this.importTokens.delete(input.importToken);
        if (input.kind !== token.preview.manifest.backupKind) {
            throw new Error('Selected import mode does not match the backup file.');
        }
        if (input.mode === 'merge-settings') {
            return this.importSettings(token.filePath, input.selectedSettingsKeys ?? []);
        }
        return this.stageFullRestore(token.filePath, token.preview);
    }
    async importSettings(filePath, selectedKeys) {
        const archive = await readArchive(filePath);
        if (archive.manifest.backupKind !== 'settings' && archive.manifest.backupKind !== 'full') {
            throw new Error('Unsupported backup kind.');
        }
        const requested = new Set(selectedKeys.filter((key) => ALLOWED_SETTINGS.has(key)));
        const settingsToImport = archive.settings.filter((setting) => requested.has(setting.key));
        for (const setting of settingsToImport) {
            AppRepository_1.repository.setSetting(setting.key, setting.value);
        }
        let importedConnectors = 0;
        for (const connector of archive.connectors) {
            const saved = AppRepository_1.repository.updateConnector({
                name: connector.name,
                enabled: connector.enabled,
                status: connector.hasSecret ? 'attention' : connector.status,
                config: connector.config,
                hasSecret: false,
                lastTestedAt: null,
                lastError: connector.hasSecret ? 'Reconnect credentials after importing this backup.' : null,
            });
            if (saved)
                importedConnectors += 1;
        }
        let importedStorageProfiles = 0;
        for (const profile of archive.storageProfiles) {
            AppRepository_1.repository.upsertStorageProfile({
                id: profile.id,
                name: profile.name,
                provider: profile.provider,
                endpoint: profile.endpoint,
                region: profile.region,
                bucket: profile.bucket,
                prefix: profile.prefix,
                publicBaseUrl: profile.publicBaseUrl,
                forcePathStyle: profile.forcePathStyle,
                enabled: profile.enabled,
                isDefault: profile.isDefault,
                hasSecret: false,
            });
            importedStorageProfiles += 1;
        }
        return {
            kind: archive.manifest.backupKind,
            importedSettings: settingsToImport.length,
            importedConnectors,
            importedStorageProfiles,
            requiresRestart: false,
            message: `Imported ${settingsToImport.length} setting(s), ${importedConnectors} connector(s), and ${importedStorageProfiles} storage profile(s).`,
        };
    }
    async stageFullRestore(filePath, preview) {
        const root = appDataRoot();
        const token = nowToken();
        const stagedRoot = path_1.default.join(root, 'pending-restore', token);
        const checkpointRoot = await createCheckpointRoot(root, token);
        fs_1.default.rmSync(stagedRoot, { recursive: true, force: true });
        fs_1.default.mkdirSync(stagedRoot, { recursive: true });
        const archive = await readArchive(filePath, stagedRoot);
        if (archive.manifest.backupKind !== 'full') {
            throw new Error('Selected backup does not contain full app data.');
        }
        if (!fs_1.default.existsSync(path_1.default.join(stagedRoot, DATABASE_ENTRY))) {
            throw new Error('Full backup is missing the SQLite database snapshot.');
        }
        fs_1.default.writeFileSync((0, BackupRestore_1.pendingRestoreMarkerPath)(root), JSON.stringify({
            format: '1marketingtool.pendingRestore',
            version: 1,
            token,
            stagedRoot,
            checkpointRoot,
            createdAt: new Date().toISOString(),
        }, null, 2), 'utf8');
        setTimeout(() => {
            electron_1.app.relaunch();
            electron_1.app.exit(0);
        }, 250);
        return {
            kind: 'full',
            importedSettings: preview.settingsKeys.length,
            importedConnectors: preview.connectorNames.length,
            importedStorageProfiles: preview.storageProfileCount,
            requiresRestart: true,
            checkpointPath: checkpointRoot,
            message: 'Full backup staged. 1MarketingTool will relaunch to complete the restore.',
        };
    }
    allowedSettingKeys() {
        return [...ALLOWED_SETTINGS].sort((a, b) => a.localeCompare(b));
    }
    describeSize(bytes) {
        return formatBytes(bytes);
    }
}
exports.BackupService = BackupService;
exports.backupService = new BackupService();
//# sourceMappingURL=BackupService.js.map