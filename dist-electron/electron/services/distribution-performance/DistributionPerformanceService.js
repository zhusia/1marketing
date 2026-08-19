"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.distributionPerformanceService = exports.DistributionPerformanceService = void 0;
const db_1 = require("../../db");
const id_1 = require("../../utils/id");
const AppRepository_1 = require("../AppRepository");
const ApiLogService_1 = require("../ApiLogService");
const ConnectorService_1 = require("../ConnectorService");
const OAuthService_1 = require("../oauth/OAuthService");
const providers_1 = require("../oauth/providers");
const registry_1 = require("../publishers/registry");
const aggregations_1 = require("./aggregations");
const artifacts_1 = require("./artifacts");
const repository_1 = require("./repository");
const providers_2 = require("./providers");
const OAUTH_CHANNELS = new Set([
    'linkedin',
    'pinterest',
    'youtube',
    'instagram',
    'facebook',
    'tiktok',
    'threads',
]);
const PERMISSION_DECISIONS_SETTING = 'distributionPerformance.permissionDecisions';
const UNSUPPORTED_MESSAGES = {
    telegram: 'The Bot API does not expose historical channel post views or reach.',
    slack: 'Incoming webhooks do not return a message ID. Use a future OAuth bot connector for reactions and replies.',
    ghost: 'Ghost Admin API does not expose a stable post analytics contract.',
    linkedin: 'LinkedIn does not expose personal-post analytics with the current member permissions.',
    linkedin_page: 'Organization analytics require the deferred LinkedIn Page connector and approved Community Management access.',
    reddit: 'Reddit publishing and analytics are not implemented yet.',
    hashnode: 'Hashnode analytics need a verified Pro publication API contract.',
    custom_api: 'Configure a future analytics response mapping for Custom API posts.',
};
function cleanFilters(filters) {
    const now = Date.now();
    const from = Number.isFinite(filters.from) ? filters.from : now - 30 * 86_400_000;
    const to = Number.isFinite(filters.to) ? filters.to : now;
    return {
        ...filters,
        from: Math.min(from, to),
        to: Math.max(from, to),
        productIds: filters.productIds ? Array.from(new Set(filters.productIds.filter(Boolean))) : undefined,
        connectorName: filters.connectorName && filters.connectorName !== 'all' ? filters.connectorName : undefined,
        // Lifetime snapshots cannot answer "activity during period". Keep the backend on the truthful
        // cohort lens until at least one adapter persists native rows to distribution_metric_daily.
        lens: 'cohort',
        timezone: filters.timezone || 'UTC',
    };
}
function parseScopes(value) {
    if (!value)
        return new Set();
    return new Set(value
        .split(/[\s,]+/)
        .map((scope) => scope.trim())
        .filter(Boolean));
}
function storedPermissionDecisions() {
    const value = AppRepository_1.repository.getSetting(PERMISSION_DECISIONS_SETTING)?.value;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const result = {};
    for (const [connectorName, candidate] of Object.entries(value)) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            continue;
        const record = candidate;
        const scopes = Array.isArray(record.scopes)
            ? record.scopes.filter((scope) => typeof scope === 'string' && Boolean(scope.trim()))
            : [];
        if (!scopes.length)
            continue;
        result[connectorName] = {
            scopes: Array.from(new Set(scopes)),
            updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : 0,
        };
    }
    return result;
}
function hasConfiguration(connector) {
    if (connector.hasSecret)
        return true;
    const ignored = new Set(['projectScope', 'projectIds', 'projectProfiles', '__history', 'mutedProjectIds']);
    return Object.entries(connector.config).some(([key, value]) => {
        if (ignored.has(key))
            return false;
        if (typeof value === 'string')
            return Boolean(value.trim());
        if (Array.isArray(value))
            return value.length > 0;
        return value != null;
    });
}
function capabilityMessage(state, connectorName) {
    if (state === 'ready')
        return 'Ready to sync native post metrics.';
    if (state === 'reconnect_required')
        return 'Reconnect this channel to grant analytics permissions.';
    if (state === 'declined')
        return 'Analytics is unavailable by choice. Publishing remains connected.';
    if (state === 'disconnected')
        return 'Connect and verify this channel before syncing metrics.';
    if (state === 'error')
        return 'The connector needs attention before metrics can sync.';
    return UNSUPPORTED_MESSAGES[connectorName] ?? 'This channel does not expose supported post analytics.';
}
function isMetricRefreshDue(item, now = Date.now()) {
    if (item.artifact.lastCheckedAt == null)
        return true;
    const age = Math.max(0, now - item.artifact.publishedAt);
    const interval = age <= 2 * 86_400_000
        ? 2 * 60 * 60 * 1000
        : age <= 7 * 86_400_000
            ? 6 * 60 * 60 * 1000
            : age <= 30 * 86_400_000
                ? 24 * 60 * 60 * 1000
                : age <= 90 * 86_400_000
                    ? 7 * 86_400_000
                    : Number.POSITIVE_INFINITY;
    return now - item.artifact.lastCheckedAt >= interval;
}
class DistributionPerformanceService {
    backfillComplete = false;
    staleSyncPromise = null;
    async backfillArtifacts() {
        if (this.backfillComplete)
            return;
        const rows = repository_1.distributionPerformanceRepository.listBackfillTargets();
        for (const row of rows) {
            const artifacts = (0, artifacts_1.normalizePublishedArtifacts)(row.connectorName, {
                url: row.publishedUrl,
                response: row.response,
            }, row.publishedAt);
            if (!artifacts.length)
                continue;
            repository_1.distributionPerformanceRepository.upsertPublishedArtifacts({
                targetId: row.targetId,
                scheduledPostId: row.postId,
                contentId: row.contentId,
                productId: row.productId,
                connectorName: row.connectorName,
                accountRef: row.accountRef,
                artifacts,
            });
        }
        this.backfillComplete = true;
    }
    async capabilityFor(connectorName, productId, lastSyncedAt) {
        const descriptor = (0, registry_1.listPlatformDescriptors)().find((item) => item.platform === connectorName);
        const provider = providers_2.DISTRIBUTION_ANALYTICS_PROVIDER_MAP.get(connectorName);
        const connector = AppRepository_1.repository.getConnector(connectorName);
        let state;
        let missingScopes = [];
        let permissionState = 'not_required';
        const requiredScopes = provider?.requiredScopes ?? [];
        const supplementalScopes = provider?.supplementalScopes ?? [];
        const analyticsScopes = Array.from(new Set([...requiredScopes, ...supplementalScopes]));
        if (!provider) {
            state = connectorName === 'linkedin_page' || connectorName === 'hashnode' ? 'restricted' : 'unsupported';
        }
        else if (!connector || !connector.enabled || !hasConfiguration(connector)) {
            state = 'disconnected';
        }
        else if (connector.status === 'error') {
            state = 'error';
        }
        else if (OAUTH_CHANNELS.has(connectorName)) {
            const status = await OAuthService_1.oauthService.status(connectorName);
            const profile = await ConnectorService_1.connectorService.getConnectionProfile(connectorName, productId);
            const hasManualPinterestToken = connectorName === 'pinterest' &&
                Boolean(profile.secret?.productionToken ||
                    profile.secret?.production_token ||
                    profile.secret?.sandboxToken ||
                    profile.secret?.sandbox_token);
            if (!status.connected && !hasManualPinterestToken) {
                state = 'disconnected';
            }
            else if (status.connected && analyticsScopes.length) {
                const granted = parseScopes(status.scope);
                missingScopes = analyticsScopes.filter((scope) => !granted.has(scope));
                if (!missingScopes.length) {
                    state = 'ready';
                    permissionState = 'granted';
                }
                else {
                    const declined = new Set(storedPermissionDecisions()[connectorName]?.scopes ?? []);
                    permissionState = missingScopes.every((scope) => declined.has(scope)) ? 'declined' : 'prompt';
                    const missingRequiredScopes = requiredScopes.filter((scope) => !granted.has(scope));
                    state = missingRequiredScopes.length
                        ? permissionState === 'declined'
                            ? 'declined'
                            : 'reconnect_required'
                        : 'ready';
                }
            }
            else {
                state = 'ready';
                permissionState = analyticsScopes.length ? 'granted' : 'not_required';
            }
        }
        else {
            state = 'ready';
        }
        let message = capabilityMessage(state, connectorName);
        if (state === 'ready' && permissionState === 'prompt') {
            message = 'Core metrics are ready. Optional permission can unlock additional analytics.';
        }
        else if (state === 'ready' && permissionState === 'declined') {
            message = 'Available metrics can sync; optional analytics was left unavailable.';
        }
        return {
            connectorName,
            label: descriptor?.label ?? provider?.label ?? connectorName,
            state,
            supportedMetrics: provider?.supportedMetrics ?? [],
            supportsDailySeries: provider?.supportsDailySeries ?? false,
            supportsConversationSummary: provider?.supportsConversationSummary ?? false,
            requiredScopes,
            missingScopes,
            permissions: analyticsScopes.map((scope) => ({
                scope,
                feature: provider?.scopeFeatures?.[scope] ?? 'Distribution Performance analytics',
                required: requiredScopes.includes(scope),
                missing: missingScopes.includes(scope),
            })),
            permissionState,
            message,
            lastSyncedAt,
        };
    }
    async setPermissionDecision(input) {
        if (input.decision !== 'prompt' && input.decision !== 'declined') {
            throw new Error('Invalid distribution permission decision.');
        }
        const provider = providers_2.DISTRIBUTION_ANALYTICS_PROVIDER_MAP.get(input.connectorName);
        if (!provider)
            throw new Error(`No distribution analytics provider exists for ${input.connectorName}.`);
        const analyticsScopes = Array.from(new Set([...provider.requiredScopes, ...(provider.supplementalScopes ?? [])]));
        const decisions = storedPermissionDecisions();
        if (input.decision === 'prompt') {
            delete decisions[input.connectorName];
            AppRepository_1.repository.setSetting(PERMISSION_DECISIONS_SETTING, decisions);
            return { connectorName: input.connectorName, decision: input.decision, scopes: [] };
        }
        const oauthStatus = OAUTH_CHANNELS.has(input.connectorName)
            ? await OAuthService_1.oauthService.status(input.connectorName)
            : null;
        const granted = parseScopes(oauthStatus?.scope ?? null);
        const missingScopes = analyticsScopes.filter((scope) => !granted.has(scope));
        if (missingScopes.length) {
            decisions[input.connectorName] = { scopes: missingScopes, updatedAt: Date.now() };
            AppRepository_1.repository.setSetting(PERMISSION_DECISIONS_SETTING, decisions);
        }
        else if (decisions[input.connectorName]) {
            delete decisions[input.connectorName];
            AppRepository_1.repository.setSetting(PERMISSION_DECISIONS_SETTING, decisions);
        }
        return { connectorName: input.connectorName, decision: input.decision, scopes: missingScopes };
    }
    async listCapabilities(filters, connectorNamesFilter) {
        const normalized = cleanFilters(filters);
        const lastSync = repository_1.distributionPerformanceRepository.lastMetricSyncByConnector();
        const connectorNames = new Set();
        if (connectorNamesFilter?.length) {
            for (const connectorName of connectorNamesFilter)
                connectorNames.add(connectorName);
        }
        else {
            for (const descriptor of (0, registry_1.listPlatformDescriptors)())
                connectorNames.add(descriptor.platform);
            for (const connector of AppRepository_1.repository.listConnectors()) {
                if (providers_2.DISTRIBUTION_ANALYTICS_PROVIDER_MAP.has(connector.name))
                    connectorNames.add(connector.name);
            }
        }
        const productId = normalized.productId ?? normalized.productIds?.[0] ?? null;
        return Promise.all(Array.from(connectorNames).map((connectorName) => this.capabilityFor(connectorName, productId, lastSync.get(connectorName) ?? null)));
    }
    async connectionFor(item) {
        const name = item.artifact.connectorName;
        const profile = await ConnectorService_1.connectorService.getConnectionProfile(name, item.artifact.productId);
        let accessToken = null;
        if ((0, providers_1.oauthProvider)(name)) {
            try {
                accessToken = await OAuthService_1.oauthService.ensureFreshToken(name);
            }
            catch {
                accessToken =
                    (typeof profile.secret?.accessToken === 'string' ? profile.secret.accessToken : null) ??
                        (typeof profile.secret?.productionToken === 'string' ? profile.secret.productionToken : null);
            }
        }
        return {
            config: profile.config,
            secret: profile.secret,
            accessToken,
        };
    }
    async resolvePendingArtifacts(filters, capabilities) {
        const ready = new Set(capabilities
            .filter((capability) => capability.state === 'ready')
            .map((capability) => capability.connectorName));
        const pending = repository_1.distributionPerformanceRepository
            .listArtifactAnalytics(filters)
            .filter((item) => item.artifact.mappingStatus === 'pending');
        for (const item of pending) {
            const provider = providers_2.DISTRIBUTION_ANALYTICS_PROVIDER_MAP.get(item.artifact.connectorName);
            if (!provider?.resolvePendingArtifact || !ready.has(item.artifact.connectorName))
                continue;
            try {
                const connection = await this.connectionFor(item);
                const resolved = await provider.resolvePendingArtifact(item.artifact, connection);
                if (!resolved.length)
                    continue;
                const artifacts = resolved.map((artifact) => ({
                    remotePostId: artifact.remotePostId,
                    url: artifact.remoteUrl ?? undefined,
                    kind: item.artifact.artifactKind,
                    identitySource: 'status_resolution',
                    mappingStatus: 'resolved',
                }));
                repository_1.distributionPerformanceRepository.upsertPublishedArtifacts({
                    targetId: item.artifact.targetId,
                    scheduledPostId: item.artifact.scheduledPostId,
                    contentId: item.artifact.contentId,
                    productId: item.artifact.productId,
                    connectorName: item.artifact.connectorName,
                    accountRef: item.artifact.accountRef,
                    artifacts,
                });
                repository_1.distributionPerformanceRepository.markArtifactMapping(item.artifact.id, 'unavailable');
            }
            catch {
                // Pending processing is expected; the next manual/app-open sync tries again.
            }
        }
    }
    async getDashboard(filters) {
        const normalized = cleanFilters(filters);
        await this.backfillArtifacts();
        const [capabilities, targets, artifacts] = await Promise.all([
            this.listCapabilities(normalized),
            Promise.resolve(repository_1.distributionPerformanceRepository.listPublishedTargets(normalized)),
            Promise.resolve(repository_1.distributionPerformanceRepository.listArtifactAnalytics(normalized)),
        ]);
        return (0, aggregations_1.aggregateDistributionPerformance)({
            filters: normalized,
            targets,
            artifacts,
            capabilities,
        });
    }
    async sync(filters, emit, options = {}) {
        const normalized = cleanFilters(filters);
        await this.backfillArtifacts();
        const capabilities = await this.listCapabilities(normalized);
        await this.resolvePendingArtifacts(normalized, capabilities);
        let artifacts = repository_1.distributionPerformanceRepository.listArtifactAnalytics(normalized);
        artifacts = artifacts.filter((item) => item.artifact.mappingStatus === 'resolved');
        if (options.dueOnly)
            artifacts = artifacts.filter((item) => isMetricRefreshDue(item));
        if (options.dueOnly && artifacts.length === 0) {
            return {
                runId: '',
                considered: 0,
                synced: 0,
                skipped: 0,
                failed: 0,
                warnings: [],
                dashboard: await this.getDashboard(normalized),
            };
        }
        const ready = new Map(capabilities.map((capability) => [capability.connectorName, capability.state === 'ready']));
        const runId = (0, id_1.createId)();
        const connectorNames = Array.from(new Set(artifacts.map((item) => item.artifact.connectorName)));
        repository_1.distributionPerformanceRepository.startSyncRun({
            runId,
            trigger: options.trigger ?? 'manual',
            filters: normalized,
            connectorNames,
        });
        const progress = (phase, done, connectorName, message) => {
            emit?.({ runId, phase, done, total: artifacts.length, connectorName, message });
        };
        progress('preparing', 0, null, 'Preparing post metrics…');
        let synced = 0;
        let skipped = 0;
        let failed = 0;
        const warnings = [];
        for (let index = 0; index < artifacts.length; index += 1) {
            const item = artifacts[index];
            const connectorName = item.artifact.connectorName;
            const provider = providers_2.DISTRIBUTION_ANALYTICS_PROVIDER_MAP.get(connectorName);
            progress('provider', index, connectorName, 'Syncing ' + (provider?.label ?? connectorName) + '…');
            if (!provider || ready.get(connectorName) !== true) {
                skipped += 1;
                const capability = capabilities.find((item) => item.connectorName === connectorName);
                const message = `${provider?.label ?? connectorName}: ${capability?.message ?? 'analytics unavailable'}`;
                if (!warnings.includes(message) && warnings.length < 20)
                    warnings.push(message);
                continue;
            }
            const startedAt = Date.now();
            try {
                const connection = await this.connectionFor(item);
                const result = await provider.syncArtifact(item, connection);
                progress('saving', index, connectorName, 'Saving ' + provider.label + ' metrics…');
                (0, db_1.getDb)().transaction(() => {
                    repository_1.distributionPerformanceRepository.saveMetricObservation({
                        artifactId: item.artifact.id,
                        providerUpdatedAt: result.providerUpdatedAt,
                        source: 'api',
                        quality: result.quality ?? 'native_lifetime',
                        metrics: result.metrics,
                        extraMetrics: result.extraMetrics,
                    });
                    if (result.conversation) {
                        repository_1.distributionPerformanceRepository.saveConversationObservation({
                            artifactId: item.artifact.id,
                            ...result.conversation,
                            source: 'api',
                        });
                    }
                })();
                ApiLogService_1.apiLogService.record({
                    provider: connectorName,
                    method: 'READ',
                    path: '/distribution-performance/post-metrics',
                    status: 'success',
                    summary: `${provider.label} distribution metrics synced`,
                    durationMs: Date.now() - startedAt,
                });
                synced += 1;
            }
            catch (error) {
                ApiLogService_1.apiLogService.record({
                    provider: connectorName,
                    method: 'READ',
                    path: '/distribution-performance/post-metrics',
                    status: 'error',
                    summary: `${provider?.label ?? connectorName} distribution metrics failed`,
                    detail: (0, providers_2.distributionProviderError)(error),
                    durationMs: Date.now() - startedAt,
                });
                failed += 1;
                const message = (provider?.label ?? connectorName) + ': ' + (0, providers_2.distributionProviderError)(error);
                if (!warnings.includes(message) && warnings.length < 20)
                    warnings.push(message);
            }
        }
        const status = failed === 0 && skipped === 0 ? 'completed' : synced > 0 || skipped > 0 ? 'partial' : 'failed';
        repository_1.distributionPerformanceRepository.finishSyncRun({
            runId,
            status,
            considered: artifacts.length,
            succeeded: synced,
            skipped,
            failed,
            warnings,
        });
        progress('done', artifacts.length, null, failed === 0 && skipped === 0
            ? 'Distribution metrics are up to date.'
            : synced > 0 || skipped > 0
                ? 'Sync finished with partial provider coverage.'
                : 'Sync finished with provider errors.');
        return {
            runId,
            considered: artifacts.length,
            synced,
            skipped,
            failed,
            warnings,
            dashboard: await this.getDashboard(normalized),
        };
    }
    /** App-open/hourly catch-up. The cadence is age-aware and stops refreshing posts after 90 days. */
    async syncStale() {
        if (this.staleSyncPromise)
            return this.staleSyncPromise;
        const now = Date.now();
        this.staleSyncPromise = this.sync({
            from: now - 90 * 86_400_000,
            to: now,
            lens: 'cohort',
            timezone: 'UTC',
        }, undefined, { trigger: 'scheduled', dueOnly: true })
            .then(() => undefined);
        try {
            await this.staleSyncPromise;
        }
        finally {
            this.staleSyncPromise = null;
        }
    }
}
exports.DistributionPerformanceService = DistributionPerformanceService;
exports.distributionPerformanceService = new DistributionPerformanceService();
//# sourceMappingURL=DistributionPerformanceService.js.map