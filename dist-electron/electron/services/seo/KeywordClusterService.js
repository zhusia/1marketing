"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.keywordClusterService = exports.KeywordClusterService = void 0;
const electron_1 = require("electron");
const AIService_1 = require("../AIService");
const SeoDataService_1 = require("./SeoDataService");
const agent_bridge_1 = require("../../agent-bridge");
const channels_1 = require("../../ipc/channels");
const MAX_SEEDS = 200;
const DATAFORSEO_CLUSTER_SEED_LIMIT = 12;
const VALID_INTENTS = [
    'informational',
    'commercial',
    'transactional',
    'navigational',
    'unknown',
];
function normalizeKey(keyword) {
    return keyword.trim().toLowerCase();
}
function slug(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 48);
}
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'with', 'your', 'my', 'how',
    'what', 'best', 'free', 'vs', 'is', 'are', 'can', 'do', 'does', 'top', 'guide', 'tips',
]);
/** Significant lowercase tokens from a keyword, used by the heuristic fallback. */
function significantTokens(keyword) {
    return keyword
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}
function titleCase(value) {
    return value.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
function agentNameFromProvider(provider) {
    if (provider === 'fallback-heuristic')
        return null;
    if (provider === 'dataforseo')
        return 'DataForSEO';
    if (provider.startsWith('local-cli:')) {
        const id = provider.slice('local-cli:'.length);
        if ((0, agent_bridge_1.isSupportedChatAgent)(id))
            return agent_bridge_1.CHAT_AGENT_LABELS[id];
        return id;
    }
    if (provider === 'openai')
        return 'OpenAI';
    if (provider === 'claude')
        return 'Claude API';
    return null;
}
/** Pull the first balanced JSON object out of a possibly-fenced agent reply. */
function extractJsonObject(text) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    if (start === -1)
        return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (ch === '{')
            depth += 1;
        if (ch === '}') {
            depth -= 1;
            if (depth === 0)
                return candidate.slice(start, i + 1);
        }
    }
    return null;
}
function buildPrompt(input, seeds, gscMap) {
    const expand = input.expand !== false;
    const expandCount = Math.max(0, Math.min(60, input.expandCount ?? 20));
    const lines = seeds.map((keyword) => {
        const row = gscMap.get(normalizeKey(keyword));
        if (!row)
            return `- ${keyword}`;
        const parts = [
            row.clicks != null ? `clicks=${row.clicks}` : null,
            row.impressions != null ? `impressions=${row.impressions}` : null,
            row.position != null ? `position=${row.position.toFixed(1)}` : null,
        ].filter(Boolean);
        return parts.length ? `- ${keyword} (${parts.join(', ')})` : `- ${keyword}`;
    });
    return [
        'You are an SEO strategist. Cluster the keywords below into semantically coherent topic groups for content planning.',
        'Rules:',
        '- Group keywords by search intent and topic meaning, not exact-match strings or shared words.',
        expand
            ? `- Also propose up to ${expandCount} NEW related keywords the site should target, placing them in the most relevant cluster. Mark new ones with "source":"ai-expansion".`
            : '- Do not invent new keywords; only cluster the ones provided.',
        '- Every provided keyword must appear in exactly one cluster, or in "unclustered" if it fits nowhere.',
        '- Do NOT output search volume, difficulty, or any numeric metrics; those are filled in separately.',
        '- For each cluster provide: label, intent (one of informational|commercial|transactional|navigational), pillar (suggested pillar-page topic), contentType (suggested format e.g. "How-to guide"), rationale (one short sentence).',
        'Output ONLY valid JSON, no prose and no code fences, matching exactly this schema:',
        '{"clusters":[{"label":"string","intent":"informational","pillar":"string","contentType":"string","rationale":"string","keywords":[{"keyword":"string","source":"gsc"}]}],"unclustered":[{"keyword":"string","source":"gsc"}]}',
        '',
        'Keywords (with Search Console performance when available):',
        lines.join('\n'),
    ].join('\n');
}
function asString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function coerceIntent(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return VALID_INTENTS.includes(normalized) ? normalized : 'unknown';
}
function metricPriority(metric) {
    return (metric.searchVolume ?? 0) * 10 + (metric.difficulty == null ? 0 : 100 - metric.difficulty);
}
function tokenOverlapScore(keyword, seed) {
    const keywordTokens = new Set(significantTokens(keyword));
    const seedTokens = significantTokens(seed);
    let score = 0;
    for (const token of seedTokens) {
        if (keywordTokens.has(token))
            score += 2;
    }
    const keywordKey = normalizeKey(keyword);
    const seedKey = normalizeKey(seed);
    if (keywordKey === seedKey)
        score += 20;
    if (keywordKey.includes(seedKey) || seedKey.includes(keywordKey))
        score += 8;
    return score;
}
function bestSeedForKeyword(keyword, seeds) {
    let best = seeds[0] ?? keyword;
    let bestScore = -1;
    for (const seed of seeds) {
        const score = tokenOverlapScore(keyword, seed);
        if (score > bestScore) {
            best = seed;
            bestScore = score;
        }
    }
    return best;
}
function contentTypeForIntent(intent) {
    switch (intent) {
        case 'informational':
            return 'Guide or resource page';
        case 'commercial':
            return 'Comparison or alternatives page';
        case 'transactional':
            return 'Product or landing page';
        case 'navigational':
            return 'Brand or support page';
        default:
            return null;
    }
}
function dataForSeoClusterLabel(seed, intent) {
    const seedLabel = titleCase(seed);
    return intent === 'unknown' ? seedLabel : `${seedLabel}: ${titleCase(intent)}`;
}
function dataForSeoRationale(seed, intent) {
    return intent === 'unknown'
        ? `DataForSEO keyword ideas grouped around the "${seed}" seed topic.`
        : `DataForSEO keyword ideas grouped around "${seed}" with ${intent} search intent.`;
}
class KeywordClusterService {
    progress = null;
    lastStreamEmit = 0;
    async cluster(input) {
        const seeds = Array.from(new Map((input.seeds ?? [])
            .map((seed) => seed.trim())
            .filter(Boolean)
            .map((seed) => [normalizeKey(seed), seed])).values()).slice(0, MAX_SEEDS);
        if (seeds.length === 0) {
            throw new Error('Provide at least one seed keyword to cluster.');
        }
        const method = input.method === 'dataforseo' ? 'dataforseo' : 'ai';
        const runId = `cluster:${Date.now()}`;
        const requestedAgentName = method === 'dataforseo'
            ? 'DataForSEO'
            : input.agentId
                ? agentNameFromProvider(`local-cli:${input.agentId}`)
                : null;
        const startedAt = Date.now();
        this.lastStreamEmit = 0;
        this.progress = {
            runId,
            phase: 'starting',
            message: `Preparing ${seeds.length} seed keyword${seeds.length === 1 ? '' : 's'}…`,
            agentName: requestedAgentName,
            seeds,
            streamPreview: '',
            streamedChars: 0,
            clustersFound: 0,
            usedFallback: false,
            startedAt,
            updatedAt: startedAt,
            error: null,
        };
        this.emit();
        const gscMap = new Map();
        for (const row of input.gscRows ?? []) {
            if (row?.keyword)
                gscMap.set(normalizeKey(row.keyword), row);
        }
        const seedSet = new Set(seeds.map(normalizeKey));
        const seenKeywords = new Set();
        const resolveKeyword = (rawKeyword) => {
            const keyword = asString(rawKeyword);
            if (!keyword)
                return null;
            const key = normalizeKey(keyword);
            if (seenKeywords.has(key))
                return null;
            seenKeywords.add(key);
            const gsc = gscMap.get(key);
            const source = gsc ? 'gsc' : seedSet.has(key) ? 'seed' : 'ai-expansion';
            return {
                keyword,
                source,
                searchVolume: null,
                difficulty: null,
                clicks: gsc?.clicks ?? null,
                impressions: gsc?.impressions ?? null,
                ctr: gsc?.ctr ?? null,
                position: gsc?.position ?? null,
            };
        };
        try {
            let clusters;
            let unclustered;
            let provider;
            if (method === 'dataforseo') {
                const built = await this.buildDataForSeoClusters(seeds, input.location, gscMap);
                clusters = built.clusters;
                unclustered = built.unclustered;
                provider = 'dataforseo';
            }
            else {
                const ai = await this.runAgent(input, seeds, gscMap, requestedAgentName);
                if (ai) {
                    this.update({ phase: 'parsing', message: 'Parsing clusters from the AI response…' });
                    const built = this.buildFromParsed(ai.parsed, resolveKeyword);
                    clusters = built.clusters;
                    unclustered = built.unclustered;
                    provider = ai.provider;
                }
                else {
                    // AI was unavailable or returned nothing parseable — group keywords locally
                    // so the user still gets a usable starting point.
                    this.update({
                        phase: 'fallback',
                        usedFallback: true,
                        message: 'AI unavailable — grouping keywords locally by shared topic.',
                    });
                    const built = this.buildHeuristicClusters(seeds, resolveKeyword);
                    clusters = built.clusters;
                    unclustered = built.unclustered;
                    provider = 'fallback-heuristic';
                }
            }
            if (method !== 'dataforseo') {
                // Any provided seed that was dropped entirely lands in unclustered.
                for (const seed of seeds) {
                    if (!seenKeywords.has(normalizeKey(seed))) {
                        const resolved = resolveKeyword(seed);
                        if (resolved)
                            unclustered.push(resolved);
                    }
                }
            }
            if (input.enrichVolume && method !== 'dataforseo') {
                this.update({ phase: 'enriching', message: 'Fetching search volumes from DataForSEO…' });
                await this.enrichVolume(clusters, unclustered, input.location);
            }
            for (const cluster of clusters) {
                const volumes = cluster.keywords.map((kw) => kw.searchVolume).filter((v) => v != null);
                cluster.totalVolume = volumes.length ? volumes.reduce((sum, v) => sum + v, 0) : null;
            }
            const usedFallback = provider === 'fallback-heuristic';
            const clusterCountLabel = `${clusters.length} cluster${clusters.length === 1 ? '' : 's'}`;
            const seedCountLabel = `${seeds.length} seed keyword${seeds.length === 1 ? '' : 's'}`;
            const doneMessage = provider === 'dataforseo'
                ? `Done — ${clusterCountLabel} from ${seedCountLabel} with DataForSEO.`
                : usedFallback
                    ? `Grouped ${seeds.length} keywords into ${clusterCountLabel} locally.`
                    : `Done — ${clusterCountLabel} from ${seeds.length} keywords.`;
            this.update({
                phase: 'done',
                clustersFound: clusters.length,
                message: doneMessage,
            });
            return {
                seeds,
                clusters,
                unclustered,
                generatedAt: Date.now(),
                provider,
                agentName: agentNameFromProvider(provider),
            };
        }
        catch (error) {
            this.update({
                phase: 'error',
                message: 'Clustering failed.',
                error: error instanceof Error ? error.message : 'Clustering failed.',
            });
            throw error;
        }
    }
    /**
     * Run the local-CLI / cloud AI agent and parse its reply. Streams the agent's
     * output to the renderer as it arrives. Returns null (rather than throwing) when
     * the agent is unavailable or its output cannot be parsed, so the caller can fall
     * back to deterministic grouping.
     */
    async runAgent(input, seeds, gscMap, agentName) {
        const prompt = buildPrompt(input, seeds, gscMap);
        this.update({
            phase: 'thinking',
            message: agentName
                ? `Asking ${agentName} to group ${seeds.length} keywords…`
                : `Asking your local AI CLI to group ${seeds.length} keywords…`,
        });
        let buffer = '';
        let result;
        try {
            result = await AIService_1.aiService.complete(prompt, {
                conversationId: `cluster:${slug(seeds.slice(0, 3).join('-')) || 'adhoc'}`,
                agentId: input.agentId ?? null,
                onToken: (chunk) => {
                    if (!chunk)
                        return;
                    buffer += chunk;
                    const preview = buffer.slice(-280).replace(/\s+/g, ' ').trim();
                    const clustersFound = (buffer.match(/"label"\s*:/g) ?? []).length;
                    this.streamUpdate({
                        phase: 'streaming',
                        message: agentName ? `${agentName} is grouping keywords…` : 'Your local AI CLI is grouping keywords…',
                        streamPreview: preview,
                        streamedChars: buffer.length,
                        clustersFound,
                    });
                },
            });
        }
        catch {
            return null;
        }
        const json = extractJsonObject(result.content);
        if (!json)
            return null;
        try {
            return { parsed: JSON.parse(json), provider: result.provider };
        }
        catch {
            return null;
        }
    }
    async buildDataForSeoClusters(seeds, location, gscMap) {
        const seedSet = new Set(seeds.map(normalizeKey));
        const apiSeeds = seeds.slice(0, DATAFORSEO_CLUSTER_SEED_LIMIT);
        const metricsByKeyword = new Map();
        const seedByKeyword = new Map();
        this.update({
            phase: 'thinking',
            message: `Preparing DataForSEO keyword ideas for ${apiSeeds.length} seed keyword${apiSeeds.length === 1 ? '' : 's'}…`,
        });
        for (const [index, seed] of apiSeeds.entries()) {
            const capped = seeds.length > DATAFORSEO_CLUSTER_SEED_LIMIT
                ? ` using the first ${DATAFORSEO_CLUSTER_SEED_LIMIT}`
                : '';
            this.update({
                phase: 'streaming',
                message: `Fetching DataForSEO keyword ideas for "${seed}" (${index + 1}/${apiSeeds.length}${capped})…`,
            });
            const ideas = await SeoDataService_1.seoDataService.keywordIdeas(seed, location);
            for (const metric of ideas) {
                const key = normalizeKey(metric.keyword);
                if (!key)
                    continue;
                const previous = metricsByKeyword.get(key);
                if (!previous || metricPriority(metric) > metricPriority(previous)) {
                    metricsByKeyword.set(key, metric);
                }
                const previousSeed = seedByKeyword.get(key);
                if (!previousSeed ||
                    tokenOverlapScore(metric.keyword, seed) > tokenOverlapScore(metric.keyword, previousSeed)) {
                    seedByKeyword.set(key, seed);
                }
            }
        }
        const missingSeeds = seeds.filter((seed) => !metricsByKeyword.has(normalizeKey(seed)));
        if (missingSeeds.length > 0) {
            this.update({
                phase: 'streaming',
                message: `Fetching DataForSEO overview for ${missingSeeds.length} seed keyword${missingSeeds.length === 1 ? '' : 's'}…`,
            });
            const seedMetrics = await SeoDataService_1.seoDataService.keywordOverview(missingSeeds, location);
            for (const metric of seedMetrics) {
                const key = normalizeKey(metric.keyword);
                if (!key)
                    continue;
                metricsByKeyword.set(key, metric);
                seedByKeyword.set(key, bestSeedForKeyword(metric.keyword, seeds));
            }
        }
        this.update({ phase: 'parsing', message: 'Grouping DataForSEO keywords by seed topic and intent…' });
        const keywordByKey = new Map();
        for (const metric of metricsByKeyword.values()) {
            const keyword = metric.keyword.trim();
            if (!keyword)
                continue;
            const key = normalizeKey(keyword);
            const gsc = gscMap.get(key);
            keywordByKey.set(key, {
                row: {
                    keyword,
                    source: gsc ? 'gsc' : seedSet.has(key) ? 'seed' : 'dataforseo',
                    searchVolume: metric.searchVolume,
                    difficulty: metric.difficulty,
                    clicks: gsc?.clicks ?? null,
                    impressions: gsc?.impressions ?? null,
                    ctr: gsc?.ctr ?? null,
                    position: gsc?.position ?? null,
                },
                seed: seedByKeyword.get(key) ?? bestSeedForKeyword(keyword, seeds),
                intent: coerceIntent(metric.intent),
            });
        }
        for (const seed of seeds) {
            const key = normalizeKey(seed);
            if (keywordByKey.has(key))
                continue;
            const gsc = gscMap.get(key);
            keywordByKey.set(key, {
                row: {
                    keyword: seed,
                    source: gsc ? 'gsc' : 'seed',
                    searchVolume: null,
                    difficulty: null,
                    clicks: gsc?.clicks ?? null,
                    impressions: gsc?.impressions ?? null,
                    ctr: gsc?.ctr ?? null,
                    position: gsc?.position ?? null,
                },
                seed,
                intent: 'unknown',
            });
        }
        const groups = new Map();
        for (const entry of keywordByKey.values()) {
            const groupKey = `${normalizeKey(entry.seed)}::${entry.intent}`;
            const group = groups.get(groupKey) ?? { seed: entry.seed, intent: entry.intent, keywords: [] };
            group.keywords.push(entry.row);
            groups.set(groupKey, group);
        }
        const clusters = Array.from(groups.values())
            .map((group, index) => {
            const keywords = group.keywords.sort((a, b) => {
                const sourceDelta = (b.source === 'seed' ? 1 : 0) - (a.source === 'seed' ? 1 : 0);
                if (sourceDelta !== 0)
                    return sourceDelta;
                return (b.searchVolume ?? -1) - (a.searchVolume ?? -1) || a.keyword.localeCompare(b.keyword);
            });
            const totalVolumeValues = keywords
                .map((kw) => kw.searchVolume)
                .filter((value) => value != null);
            const label = dataForSeoClusterLabel(group.seed, group.intent);
            return {
                id: `${index + 1}-${slug(label) || 'dataforseo-cluster'}`,
                label,
                intent: group.intent,
                pillar: titleCase(group.seed),
                contentType: contentTypeForIntent(group.intent),
                rationale: dataForSeoRationale(group.seed, group.intent),
                totalVolume: totalVolumeValues.length
                    ? totalVolumeValues.reduce((sum, value) => sum + value, 0)
                    : null,
                keywords,
            };
        })
            .sort((a, b) => (b.totalVolume ?? -1) - (a.totalVolume ?? -1) || a.label.localeCompare(b.label));
        return { clusters, unclustered: [] };
    }
    buildFromParsed(parsed, resolveKeyword) {
        const rawClusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];
        const clusters = [];
        rawClusters.forEach((raw, index) => {
            const keywords = (Array.isArray(raw.keywords) ? raw.keywords : [])
                .map((entry) => resolveKeyword(entry?.keyword ?? entry))
                .filter((kw) => kw !== null);
            if (keywords.length === 0)
                return;
            const label = asString(raw.label) ?? `Cluster ${index + 1}`;
            clusters.push({
                id: `${index + 1}-${slug(label) || 'cluster'}`,
                label,
                intent: coerceIntent(raw.intent),
                pillar: asString(raw.pillar),
                contentType: asString(raw.contentType),
                rationale: asString(raw.rationale),
                totalVolume: null,
                keywords,
            });
        });
        const unclustered = (Array.isArray(parsed.unclustered) ? parsed.unclustered : [])
            .map((entry) => resolveKeyword(entry?.keyword ?? entry))
            .filter((kw) => kw !== null);
        return { clusters, unclustered };
    }
    /**
     * Deterministic fallback: group seeds that share a significant topic term. Used
     * when no AI agent is available or the agent reply cannot be parsed.
     */
    buildHeuristicClusters(seeds, resolveKeyword) {
        const seedTokens = new Map();
        const tokenFreq = new Map();
        for (const seed of seeds) {
            const tokens = significantTokens(seed);
            seedTokens.set(seed, tokens);
            for (const token of new Set(tokens)) {
                tokenFreq.set(token, (tokenFreq.get(token) ?? 0) + 1);
            }
        }
        const groups = new Map();
        const leftovers = [];
        for (const seed of seeds) {
            const tokens = seedTokens.get(seed) ?? [];
            let bestToken = null;
            let bestFreq = 1;
            for (const token of tokens) {
                const freq = tokenFreq.get(token) ?? 0;
                if (freq >= 2 && freq > bestFreq) {
                    bestFreq = freq;
                    bestToken = token;
                }
            }
            if (bestToken) {
                const members = groups.get(bestToken) ?? [];
                members.push(seed);
                groups.set(bestToken, members);
            }
            else {
                leftovers.push(seed);
            }
        }
        const clusters = [];
        let index = 0;
        for (const [token, members] of groups) {
            if (members.length < 2) {
                leftovers.push(...members);
                continue;
            }
            index += 1;
            const keywords = members
                .map((member) => resolveKeyword(member))
                .filter((kw) => kw !== null);
            if (keywords.length === 0)
                continue;
            clusters.push({
                id: `${index}-${slug(token) || 'group'}`,
                label: titleCase(token),
                intent: 'unknown',
                pillar: null,
                contentType: null,
                rationale: 'Grouped locally by shared topic term (AI unavailable).',
                totalVolume: null,
                keywords,
            });
        }
        const unclustered = leftovers
            .map((member) => resolveKeyword(member))
            .filter((kw) => kw !== null);
        return { clusters, unclustered };
    }
    emit() {
        if (!this.progress)
            return;
        const payload = this.progress;
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                win.webContents.send(channels_1.CHANNELS.KEYWORDS_CLUSTER_PROGRESS, payload);
            }
        }
    }
    update(patch) {
        if (!this.progress)
            return;
        this.progress = { ...this.progress, ...patch, updatedAt: Date.now() };
        this.emit();
    }
    /** Throttled variant for high-frequency token streaming. */
    streamUpdate(patch) {
        if (!this.progress)
            return;
        this.progress = { ...this.progress, ...patch, updatedAt: Date.now() };
        const now = Date.now();
        if (now - this.lastStreamEmit < 80)
            return;
        this.lastStreamEmit = now;
        this.emit();
    }
    async enrichVolume(clusters, unclustered, location) {
        const all = [...clusters.flatMap((cluster) => cluster.keywords), ...unclustered];
        const keywords = Array.from(new Set(all.map((kw) => kw.keyword)));
        if (keywords.length === 0)
            return;
        try {
            const metrics = await SeoDataService_1.seoDataService.keywordOverview(keywords, location);
            const metricMap = new Map(metrics.map((metric) => [normalizeKey(metric.keyword), metric]));
            for (const kw of all) {
                const metric = metricMap.get(normalizeKey(kw.keyword));
                if (metric) {
                    kw.searchVolume = metric.searchVolume;
                    kw.difficulty = metric.difficulty;
                }
            }
        }
        catch {
            // Enrichment is best-effort; clustering still succeeds without volumes.
        }
    }
}
exports.KeywordClusterService = KeywordClusterService;
exports.keywordClusterService = new KeywordClusterService();
//# sourceMappingURL=KeywordClusterService.js.map