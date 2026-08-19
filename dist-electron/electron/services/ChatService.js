"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatService = void 0;
const db_1 = require("../db");
const AppRepository_1 = require("./AppRepository");
const AIService_1 = require("./AIService");
const AiVisibilityService_1 = require("./AiVisibilityService");
const DashboardAggregatorService_1 = require("./DashboardAggregatorService");
const id_1 = require("../utils/id");
const AssistantActions_1 = require("./AssistantActions");
const GoogleServiceAccountClient_1 = require("./google/GoogleServiceAccountClient");
const PERSONA = [
    "You are the user's AI CMO — a senior growth-marketing operator embedded in their marketing desktop app.",
    'You explain the app\'s data (SEO performance, analytics, rank, AI/LLM visibility, content) in plain language and give concrete, prioritized next actions.',
    'Be direct and action-biased: lead with the answer, then a few short supporting bullets, then the single most valuable next step.',
    'Use only the data provided in the context block below — never invent metrics, sites, or competitors. If the data cannot answer, say so plainly and name what to sync or connect.',
    'If the context includes current Performance / Analytics data, answer from it. Do not ask to sync the same data again unless the user explicitly asks for a refresh.',
    'Reply in concise GitHub-flavored markdown. Do not echo the raw context block.',
].join('\n');
const ACTION_INSTRUCTIONS = [
    'You can DO things in the app, not only answer. When the user asks you to perform something that matches an available action,',
    'briefly confirm in one sentence AND emit a fenced block on its own lines:',
    '```action',
    '{"type":"<action>","params":{}}',
    '```',
    'Rules: emit at most 2 action blocks; only use actions listed below; never invent action types or params.',
    'If the user is only asking a question (no action requested), do NOT emit any action block.',
    'Available actions:',
    (0, AssistantActions_1.buildActionCatalog)(),
].join('\n');
class ChatService {
    list(projectId) {
        return AppRepository_1.repository.listChatConversations(projectId);
    }
    get(conversationId) {
        return AppRepository_1.repository.getChatConversation(conversationId);
    }
    rename(conversationId, title) {
        return AppRepository_1.repository.renameChatConversation(conversationId, title);
    }
    remove(conversationId) {
        return { removed: AppRepository_1.repository.deleteChatConversation(conversationId) };
    }
    clear(conversationId) {
        return { removed: AppRepository_1.repository.clearChatMessages(conversationId) };
    }
    async send(input, hooks) {
        const message = (input.message ?? '').trim();
        if (!message)
            throw new Error('Type a message first.');
        const mentions = input.mentions ?? [];
        const projectId = input.projectId ?? mentionedProjectId(mentions) ?? null;
        let conversationId = input.conversationId ?? null;
        if (!conversationId) {
            const created = AppRepository_1.repository.createChatConversation({ projectId, title: deriveTitle(message) });
            conversationId = created.id;
        }
        AppRepository_1.repository.appendChatMessage({ conversationId, role: 'user', content: message, mentions });
        // Deterministic navigation from @view mentions (fires immediately).
        const actions = navigationActions(mentions, projectId);
        for (const action of actions)
            hooks?.onAction?.(action);
        const localAnswer = answerFromLocalData(input.workspaceId, projectId, message);
        if (localAnswer) {
            const stored = AppRepository_1.repository.appendChatMessage({
                conversationId,
                role: 'assistant',
                content: localAnswer.content,
                actions,
                toolCalls: localAnswer.toolCalls,
                provider: localAnswer.provider,
            });
            return { conversationId, message: stored, provider: localAnswer.provider, actions };
        }
        hooks?.onLog?.('Gathering context…');
        const history = priorMessages(conversationId);
        const contextBrief = this.buildContextBrief(input.workspaceId, projectId);
        const prompt = [
            PERSONA,
            '',
            ACTION_INSTRUCTIONS,
            '',
            '=== CONTEXT ===',
            contextBrief || '(no project data available — answer from general marketing expertise and say what to connect)',
            '=== END CONTEXT ===',
            '',
            history ? `=== CONVERSATION SO FAR ===\n${history}\n=== END ===\n` : '',
            `User: ${message}`,
        ]
            .filter((line) => line !== '')
            .join('\n');
        const { content, provider } = await AIService_1.aiService.complete(prompt, {
            conversationId: `assistant-chat:${conversationId}`,
            agentId: input.agentId ?? null,
            cwd: null,
            onLog: hooks?.onLog,
            onToken: hooks?.onToken,
        });
        // Pull any action requests the model emitted out of the visible text.
        const { cleaned, requests } = parseActionBlocks(content.trim());
        const ctx = { workspaceId: input.workspaceId, projectId };
        const toolCalls = [];
        for (const request of requests.slice(0, 2)) {
            const effect = (0, AssistantActions_1.getActionEffect)(request.type);
            if (!effect)
                continue;
            const id = (0, id_1.createId)();
            const params = { ...request.params, _workspaceId: input.workspaceId, _projectId: projectId };
            const title = (0, AssistantActions_1.describeAction)(request.type, params, ctx);
            if (effect === 'read') {
                // Reads (navigation, lookups) run immediately — no confirmation needed.
                try {
                    const result = await (0, AssistantActions_1.executeAction)(request.type, params, ctx, { onLog: hooks?.onLog });
                    toolCalls.push({
                        id,
                        type: request.type,
                        effect,
                        title,
                        params,
                        status: 'done',
                        result: result.message,
                        artifact: result.artifact ?? null,
                    });
                    if (request.type === 'navigate' && typeof request.params.view === 'string') {
                        const navAction = { type: 'navigate', view: request.params.view, projectId };
                        actions.push(navAction);
                        hooks?.onAction?.(navAction);
                    }
                }
                catch (error) {
                    toolCalls.push({
                        id,
                        type: request.type,
                        effect,
                        title,
                        params,
                        status: 'error',
                        result: error instanceof Error ? error.message : 'Action failed.',
                    });
                }
            }
            else {
                // Writes / destructive actions are proposed and wait for the user to confirm.
                toolCalls.push({ id, type: request.type, effect, title, params, status: 'proposed', result: null, artifact: null });
            }
        }
        const answer = cleaned || (toolCalls.length ? actionFallbackText(toolCalls) : '');
        if (!answer && toolCalls.length === 0) {
            throw new Error('The assistant did not return an answer. Try again or switch CLI agent.');
        }
        const stored = AppRepository_1.repository.appendChatMessage({
            conversationId,
            role: 'assistant',
            content: answer,
            actions,
            toolCalls,
            provider,
        });
        return { conversationId, message: stored, provider, actions };
    }
    /** Execute a previously-proposed action after the user confirmed it. */
    async runAction(input, hooks) {
        const message = AppRepository_1.repository.getChatMessage(input.messageId);
        if (!message)
            throw new Error('Message not found.');
        const call = message.toolCalls.find((entry) => entry.id === input.toolCallId);
        if (!call)
            throw new Error('Action not found.');
        if (call.status === 'done')
            return message;
        const conversation = AppRepository_1.repository.getChatConversation(input.conversationId);
        const ctx = {
            workspaceId: typeof call.params._workspaceId === 'string' ? call.params._workspaceId : db_1.DEFAULT_WORKSPACE_ID,
            projectId: typeof call.params._projectId === 'string' ? call.params._projectId : conversation?.projectId ?? null,
        };
        call.status = 'running';
        AppRepository_1.repository.updateChatMessageToolCalls(message.id, message.toolCalls);
        try {
            const result = await (0, AssistantActions_1.executeAction)(call.type, call.params, ctx, { onLog: hooks?.onLog });
            call.status = 'done';
            call.result = result.message;
            call.artifact = result.artifact ?? null;
            hooks?.onLog?.(result.message, 'success');
        }
        catch (error) {
            call.status = 'error';
            call.result = error instanceof Error ? error.message : 'Action failed.';
            hooks?.onLog?.(call.result, 'error');
        }
        return AppRepository_1.repository.updateChatMessageToolCalls(message.id, message.toolCalls) ?? message;
    }
    buildContextBrief(workspaceId, projectId) {
        const sections = [];
        if (projectId) {
            const project = projectProvider(projectId);
            if (project)
                sections.push(project);
        }
        const performance = performanceProvider(workspaceId, projectId);
        if (performance)
            sections.push(performance);
        if (projectId) {
            const aiVisibility = aiVisibilityProvider(projectId);
            if (aiVisibility)
                sections.push(aiVisibility);
        }
        return sections.join('\n\n');
    }
}
// --- action-block parsing -------------------------------------------------
function parseActionBlocks(text) {
    const requests = [];
    const cleaned = text
        .replace(/```action\s*([\s\S]*?)```/gi, (_match, body) => {
        try {
            const parsed = JSON.parse(String(body).trim());
            if (parsed && typeof parsed.type === 'string') {
                requests.push({
                    type: parsed.type,
                    params: parsed.params && typeof parsed.params === 'object' ? parsed.params : {},
                });
            }
        }
        catch {
            // Ignore malformed action blocks.
        }
        return '';
    })
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return { cleaned, requests };
}
function actionFallbackText(toolCalls) {
    const proposed = toolCalls.filter((call) => call.status === 'proposed');
    if (proposed.length)
        return 'Want me to run this? Confirm below.';
    return 'Done.';
}
// --- context providers ----------------------------------------------------
function projectProvider(projectId) {
    const product = AppRepository_1.repository.getProduct(projectId);
    if (!product)
        return null;
    const lines = [
        `## Project: ${product.name}`,
        product.url ? `URL: ${product.url}` : '',
        product.tagline ? `Tagline: ${product.tagline}` : '',
        product.categories?.length ? `Categories: ${product.categories.join(', ')}` : '',
        product.competitors?.length ? `Competitors: ${product.competitors.join(', ')}` : '',
    ].filter(Boolean);
    return lines.join('\n');
}
function answerFromLocalData(workspaceId, projectId, message) {
    if (!isAnalyticsEventQuestion(message))
        return null;
    const artifact = buildAnalyticsEventsArtifact(workspaceId, projectId);
    if (!artifact || artifact.topEvents.length === 0)
        return null;
    const top = artifact.topEvents[0];
    const nextEvents = artifact.topEvents.slice(1, 4);
    const topLanding = artifact.landingPages[0] ?? null;
    const content = [
        `Top GA4 event for **${artifact.projectName}** is **${top.name}**: **${formatInt(top.eventCount)} events** from **${formatInt(top.users)} users**${top.eventsPerUser != null ? ` (${formatDecimal(top.eventsPerUser)} events/user)` : ''}.`,
        nextEvents.length
            ? `Next: ${nextEvents.map((event) => `${event.name} (${formatInt(event.eventCount)})`).join(', ')}.`
            : '',
        topLanding
            ? `Top organic landing page by sessions: \`${topLanding.path}\` with **${formatInt(topLanding.sessions)} sessions** and **${formatInt(topLanding.eventCount)} events**.`
            : '',
    ]
        .filter(Boolean)
        .join('\n\n');
    return {
        content,
        provider: 'local-data',
        toolCalls: [
            {
                id: (0, id_1.createId)(),
                type: 'analytics.events',
                effect: 'read',
                title: `GA4 events for ${artifact.projectName}`,
                params: { _workspaceId: workspaceId, _projectId: projectId },
                status: 'done',
                result: `Loaded ${artifact.topEvents.length} GA4 event rows.`,
                artifact,
            },
        ],
    };
}
function isAnalyticsEventQuestion(message) {
    const text = message.toLowerCase();
    return /\b(event|events|landing page|landing-page|landing)\b/.test(text) && /\b(top|show|what|which|best|highest|biggest|analytics|ga4)\b/.test(text);
}
function buildAnalyticsEventsArtifact(workspaceId, projectId) {
    const dashboard = DashboardAggregatorService_1.dashboardAggregatorService.getWorkspaceDashboard({
        workspaceId,
        range: { kind: 'preset', days: 30 },
    });
    const row = projectId
        ? dashboard.rows.find((item) => item.productId === projectId)
        : dashboard.rows.find((item) => item.dataState === 'ok' && item.ga4Property);
    if (!row?.ga4Property)
        return null;
    const report = readCachedAnalyticsReport(dashboard.rangeKey, row.ga4Property);
    if (!report)
        return null;
    return {
        type: 'analytics-events',
        title: 'GA4 events',
        projectName: row.name,
        rangeDays: report.rangeDays || dashboard.rangeDays,
        generatedAt: Date.now(),
        syncedAt: row.syncedAt,
        property: (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(report.property || row.ga4Property),
        topEvents: topAnalyticsEvents(report),
        landingPages: topLandingPages(report),
    };
}
function readCachedAnalyticsReport(rangeKey, ga4Property) {
    const connector = AppRepository_1.repository.getConnector('google_search_console');
    if (!connector)
        return null;
    const property = (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(ga4Property);
    const cached = readRangeReport(connector.config, 'analyticsReportsByRange', rangeKey, property);
    if (isAnalyticsReport(cached) && reportMatchesRange(cached, rangeKey) && reportMatchesAnalyticsProperty(cached, property)) {
        return cached;
    }
    const latest = readRecord(connector.config, 'analyticsReport');
    if (isAnalyticsReport(latest) && reportMatchesRange(latest, rangeKey) && reportMatchesAnalyticsProperty(latest, property)) {
        return latest;
    }
    return null;
}
function readRangeReport(config, cacheKey, rangeKey, sourceValue) {
    const cache = readRecord(config, cacheKey);
    const rangeValue = cache?.[rangeKey];
    if (!isRecord(rangeValue) || !sourceValue)
        return null;
    const direct = readRecord(rangeValue, sourceValue);
    if (direct)
        return direct;
    if (reportMatchesAnalyticsProperty(rangeValue, sourceValue))
        return rangeValue;
    for (const value of Object.values(rangeValue)) {
        if (isRecord(value) && reportMatchesAnalyticsProperty(value, sourceValue))
            return value;
    }
    return null;
}
function topAnalyticsEvents(report) {
    const reportEvents = Array.isArray(report.events) ? report.events : [];
    const dailyEvents = Array.isArray(report.dailyEvents) ? report.dailyEvents : [];
    const eventRows = reportEvents.length > 0 ? reportEvents : deriveEventsFromDailyEvents(dailyEvents);
    return eventRows
        .slice()
        .sort((a, b) => metricNumber(b, 'eventCount') - metricNumber(a, 'eventCount'))
        .slice(0, 8)
        .map((row) => ({
        name: row.key,
        eventCount: metricValue(row, 'eventCount'),
        users: metricValue(row, 'totalUsers') ?? metricValue(row, 'activeUsers'),
        eventsPerUser: metricValue(row, 'eventCountPerUser'),
        revenue: metricValue(row, 'totalRevenue'),
    }));
}
function topLandingPages(report) {
    const landingPages = Array.isArray(report.organicLandingPages) ? report.organicLandingPages : [];
    return landingPages
        .slice()
        .sort((a, b) => metricNumber(b, 'sessions') - metricNumber(a, 'sessions'))
        .slice(0, 5)
        .map((row) => ({
        path: row.key,
        sessions: metricValue(row, 'sessions'),
        users: metricValue(row, 'totalUsers') ?? metricValue(row, 'activeUsers'),
        eventCount: metricValue(row, 'eventCount'),
    }));
}
function deriveEventsFromDailyEvents(dailyEvents) {
    const totals = new Map();
    for (const row of dailyEvents) {
        if (!row.key)
            continue;
        const current = totals.get(row.key) ?? { eventCount: 0, totalUsers: 0 };
        current.eventCount += row.eventCount ?? 0;
        current.totalUsers += row.totalUsers ?? row.activeUsers ?? 0;
        totals.set(row.key, current);
    }
    return Array.from(totals.entries()).map(([key, values]) => ({ key, ...values }));
}
function aiVisibilityProvider(projectId) {
    const trackers = AiVisibilityService_1.aiVisibilityService.list(projectId);
    if (trackers.length === 0)
        return null;
    const sections = [];
    for (const tracker of trackers.slice(0, 2)) {
        const detail = AiVisibilityService_1.aiVisibilityService.getDetail(tracker.id, { rangeDays: 30, compare: true });
        if (!detail)
            continue;
        const m = detail.metrics;
        const lines = [
            `## AI / LLM visibility — tracker "${tracker.name}" (last 30 days)`,
            `Visibility: ${m.visibility}% · Top-3: ${m.top3Visibility}% · Avg position: ${m.averagePosition ?? 'n/a'} · Share of voice: ${m.shareOfVoice}% · Detection rate: ${m.detectionRate}% · Citations: ${m.totalCitations}`,
        ];
        if (detail.previous) {
            lines.push(`Previous period visibility: ${detail.previous.visibility}% (so trend ${trend(detail.previous.visibility, m.visibility)}).`);
        }
        const absent = detail.terms.filter((t) => t.visibility === 0).slice(0, 8).map((t) => t.term);
        if (absent.length)
            lines.push(`Terms with NO brand presence in AI answers: ${absent.join(', ')}.`);
        const won = detail.terms.filter((t) => t.visibility > 0).slice(0, 6).map((t) => `${t.term} (pos ${t.averagePosition ?? '?'})`);
        if (won.length)
            lines.push(`Terms where the brand appears: ${won.join('; ')}.`);
        const rivals = detail.competitors.slice(0, 5).map((c) => `${c.brand} (${c.visibility}% vis)`);
        if (rivals.length)
            lines.push(`Top competitors in the same AI answers: ${rivals.join(', ')}.`);
        const cites = detail.citationDomains.slice(0, 6).map((d) => `${d.domain} (${d.share}%)`);
        if (cites.length)
            lines.push(`Domains the AI cites most: ${cites.join(', ')}.`);
        sections.push(lines.join('\n'));
    }
    return sections.length ? sections.join('\n\n') : null;
}
function performanceProvider(workspaceId, projectId) {
    const dashboard = DashboardAggregatorService_1.dashboardAggregatorService.getWorkspaceDashboard({
        workspaceId,
        range: { kind: 'preset', days: 30 },
    });
    const row = projectId ? dashboard.rows.find((item) => item.productId === projectId) : null;
    if (!row) {
        if (dashboard.rows.length === 0)
            return null;
        const totals = dashboard.totals;
        if (totals.syncedSites === 0) {
            return [
                `## Performance / Analytics — workspace (last ${dashboard.rangeDays} days)`,
                `No Search Console / GA4 performance data is synced yet for this workspace.`,
                `Sites needing mapping: ${dashboard.unmappedCount}/${totals.sites}.`,
            ].join('\n');
        }
        return [
            `## Performance / Analytics — workspace (last ${dashboard.rangeDays} days)`,
            `Synced sites: ${totals.syncedSites}/${totals.sites}${dashboard.syncedAt ? ` · latest sync ${new Date(dashboard.syncedAt).toISOString()}` : ''}`,
            `Search: ${formatInt(totals.clicks)} clicks, ${formatInt(totals.impressions)} impressions, ${formatPct(totals.ctr)} CTR, average position ${formatDecimal(totals.position)}.`,
            `Analytics: ${formatInt(totals.users)} users, ${formatInt(totals.sessions)} sessions.`,
            dashboard.attention.length
                ? `Needs attention: ${dashboard.attention
                    .slice(0, 5)
                    .map((item) => `${item.productName}: ${item.message}`)
                    .join('; ')}.`
                : '',
        ]
            .filter(Boolean)
            .join('\n');
    }
    const lines = [
        `## Performance / Analytics — ${row.name} (last ${dashboard.rangeDays} days)`,
        `Data state: ${row.dataState}${row.syncedAt ? ` · synced ${new Date(row.syncedAt).toISOString()}` : ''}`,
    ];
    if (row.dataState === 'ok') {
        lines.push([
            'Search:',
            `${formatInt(row.clicks)} clicks`,
            `${formatInt(row.impressions)} impressions`,
            `${formatPct(row.ctr)} CTR`,
            `average position ${formatDecimal(row.position)}`,
        ].join(' '));
        lines.push([
            'Analytics:',
            `${formatInt(row.users)} users`,
            `${formatInt(row.sessions)} sessions`,
            `${formatInt(row.engagementSeconds)} engagement seconds`,
        ].join(' '));
        const analyticsReport = row.ga4Property ? readCachedAnalyticsReport(dashboard.rangeKey, row.ga4Property) : null;
        if (analyticsReport) {
            const events = topAnalyticsEvents(analyticsReport).slice(0, 8);
            const landingPages = topLandingPages(analyticsReport).slice(0, 5);
            if (events.length) {
                lines.push(`Top GA4 events: ${events
                    .map((event) => `${event.name} (${formatInt(event.eventCount)} events, ${formatInt(event.users)} users)`)
                    .join('; ')}.`);
            }
            if (landingPages.length) {
                lines.push(`Top organic landing pages: ${landingPages
                    .map((page) => `${page.path} (${formatInt(page.sessions)} sessions, ${formatInt(page.eventCount)} events)`)
                    .join('; ')}.`);
            }
        }
        const recent = row.spark.slice(-7);
        if (recent.length) {
            lines.push(`Recent daily trend: ${recent
                .map((point) => `${point.date}: ${formatInt(point.clicks)} clicks, ${formatInt(point.users)} users`)
                .join('; ')}.`);
        }
    }
    else if (row.error) {
        lines.push(`Last sync error: ${row.error}`);
    }
    else if (row.dataState === 'unsynced') {
        lines.push('This project is mapped to Google data, but no cached performance report is available yet.');
    }
    else {
        lines.push('This project has no Search Console / GA4 property mapping yet.');
    }
    const totals = dashboard.totals;
    if (dashboard.totals.syncedSites > 0) {
        lines.push(`Workspace total: ${formatInt(totals.clicks)} clicks, ${formatInt(totals.impressions)} impressions, ${formatInt(totals.users)} users across ${totals.syncedSites}/${totals.sites} synced sites.`);
    }
    return lines.join('\n');
}
// --- helpers --------------------------------------------------------------
function trend(prev, curr) {
    if (curr > prev)
        return 'up';
    if (curr < prev)
        return 'down';
    return 'flat';
}
function mentionedProjectId(mentions) {
    return mentions.find((m) => m.kind === 'project')?.id ?? null;
}
function navigationActions(mentions, projectId) {
    const views = mentions.filter((m) => m.kind === 'view');
    if (views.length === 0)
        return [];
    const view = views[0];
    if (!AssistantActions_1.VIEW_LABELS[view.id])
        return [];
    return [{ type: 'navigate', view: view.id, projectId }];
}
function priorMessages(conversationId) {
    const detail = AppRepository_1.repository.getChatConversation(conversationId);
    if (!detail)
        return '';
    const prior = detail.messages.slice(0, -1).slice(-8);
    return prior
        .map((msg) => {
        const toolResults = msg.toolCalls
            .filter((call) => call.status === 'done' && call.result)
            .map((call) => `Action result: ${call.title}: ${call.result}`)
            .join('\n');
        return [`${msg.role === 'assistant' ? 'Assistant' : 'User'}: ${msg.content}`, toolResults].filter(Boolean).join('\n');
    })
        .join('\n');
}
function deriveTitle(message) {
    const firstLine = message.split('\n')[0].trim();
    return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine || 'New chat';
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function readRecord(record, key) {
    const value = record?.[key];
    return isRecord(value) ? value : null;
}
function readString(record, key) {
    const value = record?.[key];
    return typeof value === 'string' ? value.trim() : '';
}
function readNumber(record, key) {
    const value = record?.[key];
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function isAnalyticsReport(value) {
    return isRecord(value) && isRecord(value.summary) && Array.isArray(value.daily);
}
function reportMatchesRange(record, rangeKey) {
    if (!isRecord(record))
        return false;
    const reportKey = readString(record, 'rangeKey');
    if (reportKey)
        return reportKey === rangeKey;
    const reportDays = readNumber(record, 'rangeDays');
    return reportDays != null && String(reportDays) === rangeKey;
}
function reportMatchesAnalyticsProperty(record, property) {
    if (!isRecord(record))
        return false;
    const reportProperty = (0, GoogleServiceAccountClient_1.normalizeAnalyticsPropertyName)(readString(record, 'property'));
    return Boolean(property && reportProperty === property);
}
function metricValue(row, key) {
    const value = row[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function metricNumber(row, key) {
    return metricValue(row, key) ?? 0;
}
function formatInt(value) {
    return value == null ? 'n/a' : Math.round(value).toLocaleString('en-US');
}
function formatPct(value) {
    return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}
function formatDecimal(value) {
    return value == null ? 'n/a' : value.toFixed(1);
}
exports.chatService = new ChatService();
//# sourceMappingURL=ChatService.js.map