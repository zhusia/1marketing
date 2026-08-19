"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIEW_LABELS = void 0;
exports.getActionEffect = getActionEffect;
exports.describeAction = describeAction;
exports.executeAction = executeAction;
exports.buildActionCatalog = buildActionCatalog;
const AppRepository_1 = require("./AppRepository");
const AiVisibilityService_1 = require("./AiVisibilityService");
const DashboardAggregatorService_1 = require("./DashboardAggregatorService");
const RankAutomationService_1 = require("./RankAutomationService");
exports.VIEW_LABELS = {
    dashboard: 'Dashboard',
    performance: 'Performance',
    'ai-visibility': 'AI Visibility',
    'keyword-explorer': 'Keyword Explorer',
    'content-library': 'Content Library',
    projects: 'Projects',
};
function projectName(projectId) {
    if (!projectId)
        return 'this project';
    return AppRepository_1.repository.getProduct(projectId)?.name ?? 'this project';
}
const ACTIONS = {
    navigate: {
        effect: 'read',
        describe: 'navigate(view): open a screen. view ∈ [dashboard, performance, ai-visibility, keyword-explorer, content-library].',
        title: (params) => `Open ${exports.VIEW_LABELS[String(params.view)] ?? String(params.view)}`,
        run: async (params) => ({ message: `Opened ${exports.VIEW_LABELS[String(params.view)] ?? String(params.view)}.` }),
    },
    'aiVisibility.run': {
        effect: 'write',
        describe: "aiVisibility.run(): run the AI/LLM visibility tracker for the current project (fetches AI answers and refreshes visibility metrics).",
        title: (_params, ctx) => `Run AI/LLM visibility tracker for ${projectName(ctx.projectId)}`,
        run: async (params, ctx, hooks) => {
            const projectId = (typeof params.projectId === 'string' && params.projectId) || ctx.projectId;
            if (!projectId)
                throw new Error('No project is selected to run the tracker for.');
            const trackers = AiVisibilityService_1.aiVisibilityService.list(projectId);
            if (trackers.length === 0) {
                throw new Error('This project has no AI visibility tracker yet — create one in the AI Visibility screen first.');
            }
            const tracker = trackers[0];
            hooks.onLog?.(`Running AI visibility tracker "${tracker.name}"…`);
            const result = await AiVisibilityService_1.aiVisibilityService.runTracker(tracker.id);
            return {
                message: `Ran "${tracker.name}": ${result.found}/${result.queries} AI answers captured${result.cost ? `, $${result.cost.toFixed(2)}` : ''}.`,
            };
        },
    },
    'performance.sync': {
        effect: 'write',
        describe: 'performance.sync(): fetch the latest Google Search Console + Analytics data for the whole workspace (last 30 days).',
        title: () => 'Sync Search Console + Analytics (last 30 days)',
        run: async (_params, ctx, hooks) => {
            hooks.onLog?.('Syncing Search Console + Analytics…');
            const dashboard = await DashboardAggregatorService_1.dashboardAggregatorService.syncWorkspaceDashboard({ workspaceId: ctx.workspaceId, range: { kind: 'preset', days: 30 } }, () => undefined);
            const siteCount = dashboard.rows?.length ?? 0;
            return {
                message: `Synced ${siteCount} site${siteCount === 1 ? '' : 's'} for the last 30 days.`,
                artifact: buildPerformanceArtifact(dashboard),
            };
        },
    },
    'rank.check': {
        effect: 'write',
        describe: "rank.check(): check the current project's Domain Rating via Ahrefs.",
        title: (_params, ctx) => `Check Domain Rating for ${projectName(ctx.projectId)}`,
        run: async (params, ctx, hooks) => {
            const projectId = (typeof params.projectId === 'string' && params.projectId) || ctx.projectId;
            if (!projectId)
                throw new Error('No project is selected to check rank for.');
            hooks.onLog?.(`Checking Domain Rating for ${projectName(projectId)}…`);
            await RankAutomationService_1.rankAutomationService.start(projectId);
            return {
                message: `Domain Rating check complete for ${projectName(projectId)}. Open Performance to see the latest numbers.`,
            };
        },
    },
};
function getActionEffect(type) {
    return ACTIONS[type]?.effect ?? null;
}
function describeAction(type, params, ctx) {
    const def = ACTIONS[type];
    return def ? def.title(params, ctx) : type;
}
async function executeAction(type, params, ctx, hooks) {
    const def = ACTIONS[type];
    if (!def)
        throw new Error(`Unknown action: ${type}`);
    return def.run(params, ctx, hooks);
}
/** Catalog text injected into the system prompt so the model knows what it can do. */
function buildActionCatalog() {
    return Object.values(ACTIONS)
        .map((def) => `- ${def.describe}`)
        .join('\n');
}
function buildPerformanceArtifact(dashboard) {
    const topSites = dashboard.rows
        .slice()
        .filter((row) => row.dataState === 'ok')
        .sort((a, b) => sortMetric(b) - sortMetric(a))
        .slice(0, 5)
        .map((row) => ({
        productId: row.productId,
        name: row.name,
        host: row.host,
        clicks: row.clicks,
        impressions: row.impressions,
        users: row.users,
        sessions: row.sessions,
        dataState: row.dataState,
    }));
    const stateCounts = {
        ok: 0,
        unsynced: 0,
        unmapped: 0,
        error: 0,
    };
    for (const row of dashboard.rows) {
        stateCounts[row.dataState] += 1;
    }
    return {
        type: 'performance-summary',
        title: 'Search Console + Analytics',
        rangeDays: dashboard.rangeDays,
        generatedAt: dashboard.generatedAt,
        syncedAt: dashboard.syncedAt,
        totals: {
            sites: dashboard.totals.sites,
            syncedSites: dashboard.totals.syncedSites,
            clicks: dashboard.totals.clicks,
            impressions: dashboard.totals.impressions,
            ctr: dashboard.totals.ctr,
            position: dashboard.totals.position,
            users: dashboard.totals.users,
            sessions: dashboard.totals.sessions,
        },
        trend: dashboard.trend.slice(-30).map((point) => ({
            date: point.date,
            clicks: point.clicks,
            impressions: point.impressions,
            users: point.users,
            sessions: point.sessions,
        })),
        topSites,
        attention: dashboard.attention.slice(0, 3).map((item) => ({
            id: item.id,
            productName: item.productName,
            severity: item.severity,
            message: item.message,
        })),
        stateCounts,
    };
}
function sortMetric(row) {
    return (row.clicks ?? 0) + (row.users ?? 0) + (row.sessions ?? 0);
}
//# sourceMappingURL=AssistantActions.js.map