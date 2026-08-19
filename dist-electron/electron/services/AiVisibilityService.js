"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiVisibilityService = void 0;
const crypto_1 = require("crypto");
const electron_1 = require("electron");
const AppRepository_1 = require("./AppRepository");
const AIService_1 = require("./AIService");
const NotificationService_1 = require("./NotificationService");
const SentimentService_1 = require("./SentimentService");
const aiAnswerFetcher_1 = require("./seo/aiAnswerFetcher");
const channels_1 = require("../ipc/channels");
const EMPTY_METRICS = {
    visibility: 0,
    top3Visibility: 0,
    averagePosition: null,
    latestPosition: null,
    sentiment: null,
    totalCitations: 0,
    detectionRate: 0,
    shareOfVoice: 0,
    totalQueries: 0,
    brandQueries: 0,
};
class AiVisibilityService {
    list(productId) {
        return AppRepository_1.repository.listAiTrackers(productId);
    }
    upsert(input) {
        if (!input.productId)
            throw new Error('Select a project before creating a tracker.');
        const variants = input.brandVariants.map((variant) => variant.trim()).filter(Boolean);
        if (variants.length === 0)
            throw new Error('Add at least one brand variant.');
        const engines = input.engines.length ? input.engines : ['ai_overview'];
        return AppRepository_1.repository.upsertAiTracker({ ...input, brandVariants: variants, engines: [...engines] });
    }
    remove(id) {
        return { removed: AppRepository_1.repository.deleteAiTracker(id) };
    }
    snapshots(trackerId) {
        return AppRepository_1.repository.listAiTrackerSnapshots(trackerId);
    }
    deleteSnapshot(id) {
        return { removed: AppRepository_1.repository.deleteAiTrackerSnapshot(id) };
    }
    /** Run a tracker end to end: fetch each (term, engine) answer, extract mentions, persist a snapshot. */
    async runTracker(id) {
        const tracker = AppRepository_1.repository.getAiTracker(id);
        if (!tracker)
            throw new Error('Tracker not found.');
        const terms = AppRepository_1.repository.getAiTrackerTerms(id);
        if (terms.length === 0)
            throw new Error('Add at least one search term before running the tracker.');
        const engines = tracker.engines.length ? tracker.engines : ['ai_overview'];
        const snapshotDate = todayIso();
        const snapshotId = AppRepository_1.repository.startAiTrackerSnapshot(id, snapshotDate);
        const total = terms.length * engines.length;
        const useNlp = SentimentService_1.sentimentService.isConfigured();
        const logs = [];
        let queries = 0;
        let found = 0;
        let cost = 0;
        const notes = [];
        const emit = (patch) => {
            if (patch.log)
                logs.push({ time: Date.now(), message: patch.log.message, level: patch.log.level ?? 'info' });
            this.emitProgress({
                trackerId: id,
                status: patch.status ?? 'running',
                message: patch.message ?? '',
                processed: queries,
                total,
                found,
                currentTerm: patch.currentTerm ?? null,
                currentEngine: patch.currentEngine ?? null,
                logs: logs.slice(-50),
            });
        };
        emit({
            message: `Starting run — ${total} queries${useNlp ? ' · Google NLP sentiment' : ''}`,
            log: { message: `Run started: ${terms.length} terms × ${engines.length} engine(s).` },
        });
        for (const term of terms) {
            for (const engine of engines) {
                queries += 1;
                emit({
                    message: `Fetching “${term.term}” (${ENGINE_LABEL[engine] ?? engine})…`,
                    currentTerm: term.term,
                    currentEngine: engine,
                });
                try {
                    const answer = await (0, aiAnswerFetcher_1.fetchAiAnswer)({
                        term: term.term,
                        engine,
                        source: tracker.source,
                        location: tracker.location,
                        language: tracker.language,
                    });
                    cost += answer.cost;
                    const resultId = AppRepository_1.repository.insertAiTrackerResult({
                        snapshotId,
                        termId: term.id,
                        term: term.term,
                        engine,
                        fetchSource: answer.source,
                        responseText: answer.found ? answer.text : null,
                        responseHash: answer.found ? sha256(answer.text) : null,
                        found: answer.found,
                    });
                    for (const citation of answer.citations) {
                        AppRepository_1.repository.insertAiTrackerCitation({
                            resultId,
                            url: citation.url,
                            domain: citation.domain,
                            title: citation.title,
                            brands: [],
                        });
                    }
                    if (answer.found) {
                        found += 1;
                        const mentions = await this.extractMentions(answer.text, tracker.brandVariants);
                        if (useNlp && mentions.length > 0) {
                            const scores = await SentimentService_1.sentimentService.scoreMany(mentions.map((mention) => mention.snippet));
                            mentions.forEach((mention, index) => {
                                if (scores[index] != null)
                                    mention.sentiment = scores[index];
                            });
                        }
                        for (const mention of mentions) {
                            AppRepository_1.repository.insertAiTrackerMention({
                                resultId,
                                brand: mention.brand,
                                isSelf: mention.isSelf,
                                position: mention.position,
                                snippet: mention.snippet,
                                sentiment: mention.sentiment,
                            });
                        }
                        emit({
                            message: `Found AI answer for “${term.term}”`,
                            currentTerm: term.term,
                            currentEngine: engine,
                            log: { message: `“${term.term}” (${ENGINE_LABEL[engine] ?? engine}): ${mentions.length} brand(s) found.`, level: 'success' },
                        });
                    }
                    else {
                        emit({
                            message: `No AI content for “${term.term}”`,
                            currentTerm: term.term,
                            currentEngine: engine,
                            log: { message: `“${term.term}” (${ENGINE_LABEL[engine] ?? engine}): no AI content.`, level: 'info' },
                        });
                    }
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : 'fetch failed';
                    notes.push(`${term.term} (${engine}): ${message}`);
                    AppRepository_1.repository.insertAiTrackerResult({
                        snapshotId,
                        termId: term.id,
                        term: term.term,
                        engine,
                        fetchSource: tracker.source,
                        responseText: null,
                        responseHash: null,
                        found: false,
                    });
                    emit({
                        message: `Failed: ${term.term}`,
                        currentTerm: term.term,
                        currentEngine: engine,
                        log: { message: `“${term.term}” (${ENGINE_LABEL[engine] ?? engine}): ${message}`, level: 'error' },
                    });
                }
            }
        }
        const status = notes.length === 0 ? 'complete' : found === 0 ? 'failed' : 'partial';
        AppRepository_1.repository.finalizeAiTrackerSnapshot(snapshotId, cost, status);
        const lastRunAt = Date.now();
        const nextRunAt = tracker.scheduleDays > 0 ? lastRunAt + tracker.scheduleDays * 86_400_000 : null;
        AppRepository_1.repository.setAiTrackerRunTimes(id, lastRunAt, nextRunAt);
        try {
            this.publishRunAlerts(tracker, snapshotId, status, notes);
        }
        catch (error) {
            // Alerting is advisory — never fail a completed run because a rule threw.
            console.warn('[ai-visibility] alert evaluation failed:', error);
        }
        emit({
            status: found === 0 && notes.length > 0 ? 'failed' : 'complete',
            message: `Run complete — ${found}/${total} answers found${cost ? `, $${cost.toFixed(2)}` : ''}`,
            log: { message: `Done: ${found}/${total} found, ${notes.length} issue(s).`, level: found > 0 ? 'success' : 'error' },
        });
        return { trackerId: id, snapshotDate, queries, found, cost, notes };
    }
    emitProgress(progress) {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed())
                win.webContents.send(channels_1.CHANNELS.AI_VISIBILITY_PROGRESS, progress);
        }
    }
    getDetail(id, options = {}) {
        const tracker = AppRepository_1.repository.getAiTracker(id);
        if (!tracker)
            return null;
        const configuredTerms = AppRepository_1.repository.getAiTrackerTerms(id);
        const tagsByTerm = new Map(configuredTerms.map((term) => [term.term, term.tags]));
        const rangeDays = options.rangeDays ?? 30;
        const range = computeRange(rangeDays);
        const snapshots = AppRepository_1.repository.getAiTrackerSnapshotsInRange(id, range.startDate, range.endDate);
        if (snapshots.length === 0) {
            return {
                tracker,
                configuredTerms,
                range,
                metrics: EMPTY_METRICS,
                previous: null,
                series: [],
                competitorSeries: [],
                terms: [],
                competitors: [],
                citationDomains: [],
                latestSnapshotDate: null,
            };
        }
        // Aggregate across every snapshot in the range, and build a per-snapshot series.
        const allResults = [];
        const allMentions = [];
        const allCitations = [];
        const series = [];
        const perSnapshotCompetitors = [];
        for (const snapshot of snapshots) {
            const results = AppRepository_1.repository.getAiTrackerResults(snapshot.id);
            const mentions = AppRepository_1.repository.getAiTrackerMentionsForSnapshot(snapshot.id);
            const citations = AppRepository_1.repository.getAiTrackerCitationsForSnapshot(snapshot.id);
            allResults.push(...results);
            allMentions.push(...mentions);
            allCitations.push(...citations);
            const snapRollup = rollup(results, mentions, citations, tagsByTerm);
            const point = snapRollup.metrics;
            perSnapshotCompetitors.push(snapRollup.competitors);
            series.push({
                date: snapshot.snapshot_date,
                visibility: point.visibility,
                averagePosition: point.averagePosition,
                top3Visibility: point.top3Visibility,
                sentiment: point.sentiment,
                detectionRate: point.detectionRate,
                shareOfVoice: point.shareOfVoice,
                totalCitations: point.totalCitations,
            });
        }
        const aggregate = rollup(allResults, allMentions, allCitations, tagsByTerm);
        // "Latest position" is the most recent snapshot's average position within the range.
        const latestPoint = series[series.length - 1];
        aggregate.metrics.latestPosition = latestPoint?.averagePosition ?? aggregate.metrics.averagePosition;
        // Trend lines for the top competitors (only the metrics computed per competitor).
        const competitorSeries = aggregate.competitors.slice(0, 5).map((competitor) => {
            const key = normalizeBrand(competitor.brand);
            return {
                brand: competitor.brand,
                points: snapshots.map((snapshot, index) => {
                    const match = perSnapshotCompetitors[index].find((entry) => normalizeBrand(entry.brand) === key);
                    return {
                        date: snapshot.snapshot_date,
                        visibility: match?.visibility ?? 0,
                        averagePosition: match?.averagePosition ?? null,
                        detectionRate: match?.detectionRate ?? 0,
                        top3Visibility: null,
                        sentiment: null,
                        shareOfVoice: null,
                        totalCitations: null,
                    };
                }),
            };
        });
        let previous = null;
        if (options.compare && rangeDays > 0) {
            const prevRange = computePreviousRange(range);
            const prevSnapshots = AppRepository_1.repository.getAiTrackerSnapshotsInRange(id, prevRange.startDate, prevRange.endDate);
            if (prevSnapshots.length > 0) {
                const prevResults = [];
                const prevMentions = [];
                const prevCitations = [];
                for (const snapshot of prevSnapshots) {
                    prevResults.push(...AppRepository_1.repository.getAiTrackerResults(snapshot.id));
                    prevMentions.push(...AppRepository_1.repository.getAiTrackerMentionsForSnapshot(snapshot.id));
                    prevCitations.push(...AppRepository_1.repository.getAiTrackerCitationsForSnapshot(snapshot.id));
                }
                previous = rollup(prevResults, prevMentions, prevCitations, tagsByTerm).metrics;
            }
        }
        return {
            tracker,
            configuredTerms,
            range,
            ...aggregate,
            previous,
            series,
            competitorSeries,
            latestSnapshotDate: snapshots[snapshots.length - 1].snapshot_date,
        };
    }
    responses(trackerId, snapshotId) {
        const snapshot = snapshotId
            ? AppRepository_1.repository.getAiTrackerSnapshot(snapshotId)
            : AppRepository_1.repository.getLatestAiTrackerSnapshot(trackerId);
        if (!snapshot)
            return [];
        return AppRepository_1.repository.getAiTrackerResults(snapshot.id).map((result) => {
            const mentions = AppRepository_1.repository.getAiTrackerMentionsForResult(result.id);
            const citations = AppRepository_1.repository.getAiTrackerCitationsForResult(result.id);
            return {
                term: result.term,
                engine: result.engine,
                found: result.found === 1,
                fetchSource: result.fetch_source,
                responseText: result.response_text,
                citations: citations.map((citation) => ({
                    url: citation.url,
                    domain: citation.domain,
                    title: citation.title,
                })),
                mentions: mentions.map((mention) => ({
                    brand: mention.brand,
                    isSelf: mention.is_self === 1,
                    position: mention.position,
                    snippet: mention.snippet,
                    sentiment: mention.sentiment,
                })),
            };
        });
    }
    /** Metrics + competitor board for one snapshot, used by the alert rules. */
    snapshotRollup(snapshotId, tagsByTerm) {
        return rollup(AppRepository_1.repository.getAiTrackerResults(snapshotId), AppRepository_1.repository.getAiTrackerMentionsForSnapshot(snapshotId), AppRepository_1.repository.getAiTrackerCitationsForSnapshot(snapshotId), tagsByTerm);
    }
    /**
     * Turn a finished run into alerts: a visibility swing past the configured threshold, a competitor
     * that just overtook the tracked brand, or a run that failed outright. Compares the snapshot that
     * was just written against the previous completed one, so a first-ever run stays quiet.
     */
    publishRunAlerts(tracker, snapshotId, status, notes) {
        const product = AppRepository_1.repository.getProduct(tracker.productId);
        const route = {
            view: 'ai-visibility',
            workspaceId: product?.workspaceId ?? null,
            productId: tracker.productId,
            trackerId: tracker.id,
        };
        const scope = { productId: tracker.productId, workspaceId: product?.workspaceId ?? null };
        if (status === 'failed') {
            NotificationService_1.notificationService.publish({
                kind: 'aiVisibility.runFailed',
                severity: 'critical',
                title: `${tracker.name}: tracker run failed`,
                body: notes[0] ? notes[0].slice(0, 300) : 'No AI answers could be fetched for this run.',
                route,
                ...scope,
                meta: { trackerId: tracker.id },
                dedupeKey: `aiVisibility.runFailed:${tracker.id}`,
            });
            return;
        }
        const completed = AppRepository_1.repository.listAiTrackerSnapshots(tracker.id).filter((snapshot) => snapshot.status !== 'running');
        const previous = completed.find((snapshot) => snapshot.id !== snapshotId);
        if (!previous)
            return;
        const tagsByTerm = new Map(AppRepository_1.repository.getAiTrackerTerms(tracker.id).map((term) => [term.term, term.tags]));
        const current = this.snapshotRollup(snapshotId, tagsByTerm);
        const prior = this.snapshotRollup(previous.id, tagsByTerm);
        if (current.metrics.totalQueries === 0 || prior.metrics.totalQueries === 0)
            return;
        const threshold = NotificationService_1.notificationService.getPreferences().visibilityDeltaPoints;
        const delta = Math.round(current.metrics.visibility - prior.metrics.visibility);
        const window = `${prior.metrics.visibility.toFixed(0)}% → ${current.metrics.visibility.toFixed(0)}%`;
        if (delta <= -threshold) {
            NotificationService_1.notificationService.publish({
                kind: 'aiVisibility.drop',
                severity: Math.abs(delta) >= threshold * 2 ? 'critical' : 'warning',
                title: `${tracker.name}: AI visibility dropped ${Math.abs(delta)} pts`,
                body: `${window} since ${previous.snapshotDate}. ${current.metrics.brandQueries}/${current.metrics.totalQueries} answers still mention the brand.`,
                route,
                ...scope,
                meta: { trackerId: tracker.id, delta, visibility: current.metrics.visibility },
                dedupeKey: `aiVisibility.drop:${tracker.id}`,
                dedupeWindowMs: 12 * 60 * 60 * 1000,
            });
        }
        else if (delta >= threshold) {
            NotificationService_1.notificationService.publish({
                kind: 'aiVisibility.gain',
                severity: 'success',
                title: `${tracker.name}: AI visibility up ${delta} pts`,
                body: `${window} since ${previous.snapshotDate}.`,
                route,
                ...scope,
                meta: { trackerId: tracker.id, delta, visibility: current.metrics.visibility },
                dedupeKey: `aiVisibility.gain:${tracker.id}`,
                dedupeWindowMs: 12 * 60 * 60 * 1000,
            });
        }
        // Overtake: someone is ahead now who was not ahead in the previous snapshot.
        const priorByBrand = new Map(prior.competitors.map((entry) => [normalizeBrand(entry.brand), entry.visibility]));
        const overtaking = current.competitors.find((competitor) => {
            if (competitor.visibility <= current.metrics.visibility)
                return false;
            const before = priorByBrand.get(normalizeBrand(competitor.brand));
            return before === undefined || before <= prior.metrics.visibility;
        });
        if (overtaking) {
            NotificationService_1.notificationService.publish({
                kind: 'aiVisibility.competitorOvertake',
                severity: 'warning',
                title: `${overtaking.brand} overtook you in AI answers`,
                body: `${overtaking.brand} appears in ${overtaking.visibility.toFixed(0)}% of ${tracker.name}'s tracked answers vs your ${current.metrics.visibility.toFixed(0)}%.`,
                route,
                ...scope,
                meta: { trackerId: tracker.id, competitor: overtaking.brand, competitorVisibility: overtaking.visibility },
                dedupeKey: `aiVisibility.overtake:${tracker.id}:${normalizeBrand(overtaking.brand)}`,
                dedupeWindowMs: 24 * 60 * 60 * 1000,
            });
        }
    }
    async extractMentions(answerText, brandVariants) {
        const prompt = buildExtractionPrompt(answerText, brandVariants);
        const { content } = await AIService_1.aiService.complete(prompt, { conversationId: 'ai-visibility:extract' });
        const parsed = parseMentions(content);
        const out = [];
        const seen = new Set();
        for (const raw of parsed) {
            const brand = String(raw.brand ?? '').trim();
            if (!brand)
                continue;
            const key = normalizeBrand(brand);
            if (!key || seen.has(key))
                continue;
            seen.add(key);
            out.push({
                brand,
                isSelf: matchesBrand(brand, brandVariants),
                position: clampPosition(raw.position),
                snippet: typeof raw.snippet === 'string' ? raw.snippet.trim().slice(0, 400) || null : null,
                sentiment: clampSentiment(raw.sentiment),
            });
            if (out.length >= 40)
                break;
        }
        return out;
    }
}
function rollup(results, mentions, citations, tagsByTerm) {
    const totalQueries = results.length;
    const citationsByResult = new Map();
    for (const citation of citations) {
        citationsByResult.set(citation.resultId, (citationsByResult.get(citation.resultId) ?? 0) + 1);
    }
    // Per-result self summary.
    const selfByResult = new Map();
    for (const result of results)
        selfByResult.set(result.id, { mentioned: false, position: null, sentiment: null });
    const selfSentiments = [];
    for (const mention of mentions) {
        if (mention.isSelf !== 1)
            continue;
        const entry = selfByResult.get(mention.resultId);
        if (!entry)
            continue;
        entry.mentioned = true;
        if (mention.position != null)
            entry.position = entry.position == null ? mention.position : Math.min(entry.position, mention.position);
        if (mention.sentiment != null) {
            entry.sentiment = mention.sentiment;
            selfSentiments.push(mention.sentiment);
        }
    }
    const brandQueries = [...selfByResult.values()].filter((entry) => entry.mentioned).length;
    const top3 = [...selfByResult.values()].filter((entry) => entry.position != null && entry.position <= 3).length;
    const selfPositions = [...selfByResult.values()].map((entry) => entry.position).filter((p) => p != null);
    const averagePosition = avg(selfPositions);
    const distinctTerms = new Set(results.map((result) => result.term));
    const termsMentioned = new Set(results.filter((result) => selfByResult.get(result.id)?.mentioned).map((result) => result.term));
    const totalMentions = mentions.length;
    const selfMentions = mentions.filter((mention) => mention.isSelf === 1).length;
    const totalCitations = results
        .filter((result) => selfByResult.get(result.id)?.mentioned)
        .reduce((sum, result) => sum + (citationsByResult.get(result.id) ?? 0), 0);
    const metrics = {
        visibility: pct(brandQueries, totalQueries),
        top3Visibility: pct(top3, totalQueries),
        averagePosition,
        latestPosition: averagePosition,
        sentiment: avg(selfSentiments),
        totalCitations,
        detectionRate: pct(termsMentioned.size, distinctTerms.size),
        shareOfVoice: pct(selfMentions, totalMentions),
        totalQueries,
        brandQueries,
    };
    // Per-term rows.
    const resultsByTerm = new Map();
    for (const result of results) {
        const list = resultsByTerm.get(result.term) ?? [];
        list.push(result);
        resultsByTerm.set(result.term, list);
    }
    const terms = [...resultsByTerm.entries()].map(([term, termResults]) => {
        const perEngine = {};
        const positions = [];
        const sentiments = [];
        let mentionedCount = 0;
        let termCitations = 0;
        for (const result of termResults) {
            const entry = selfByResult.get(result.id);
            perEngine[result.engine] = entry?.position ?? null;
            if (entry?.mentioned) {
                mentionedCount += 1;
                termCitations += citationsByResult.get(result.id) ?? 0;
            }
            if (entry?.position != null)
                positions.push(entry.position);
            if (entry?.sentiment != null)
                sentiments.push(entry.sentiment);
        }
        return {
            term,
            tags: tagsByTerm.get(term) ?? [],
            averagePosition: avg(positions),
            visibility: pct(mentionedCount, termResults.length),
            sentiment: avg(sentiments),
            citations: termCitations,
            perEngine,
        };
    });
    terms.sort((a, b) => (a.averagePosition ?? 999) - (b.averagePosition ?? 999));
    // Competitors (every non-self brand discovered).
    const byBrand = new Map();
    for (const mention of mentions) {
        if (mention.isSelf === 1)
            continue;
        const key = normalizeBrand(mention.brand);
        if (!key)
            continue;
        const entry = byBrand.get(key) ?? { brand: mention.brand, resultIds: new Set(), terms: new Set(), positions: [], top3: 0, mentions: 0 };
        entry.mentions += 1;
        entry.resultIds.add(mention.resultId);
        entry.terms.add(mention.term);
        if (mention.position != null) {
            entry.positions.push(mention.position);
            if (mention.position <= 3)
                entry.top3 += 1;
        }
        byBrand.set(key, entry);
    }
    const competitors = [...byBrand.values()]
        .map((entry) => ({
        brand: entry.brand,
        visibility: pct(entry.resultIds.size, totalQueries),
        mentions: entry.mentions,
        averagePosition: avg(entry.positions),
        detectionRate: pct(entry.terms.size, distinctTerms.size),
        top3Rate: pct(entry.top3, entry.positions.length),
    }))
        .sort((a, b) => b.visibility - a.visibility || b.mentions - a.mentions)
        .slice(0, 15);
    // Citation domains.
    const byDomain = new Map();
    for (const citation of citations) {
        const entry = byDomain.get(citation.domain) ?? { domain: citation.domain, urls: new Set(), count: 0 };
        entry.urls.add(citation.url);
        entry.count += 1;
        byDomain.set(citation.domain, entry);
    }
    const totalCitationCount = citations.length;
    const citationDomains = [...byDomain.values()]
        .map((entry) => ({
        domain: entry.domain,
        urls: entry.urls.size,
        citations: entry.count,
        share: pct(entry.count, totalCitationCount),
    }))
        .sort((a, b) => b.citations - a.citations)
        .slice(0, 20);
    return { metrics, terms, competitors, citationDomains };
}
// --- helpers --------------------------------------------------------------
const ENGINE_LABEL = { ai_overview: 'AI Overview', ai_mode: 'AI Mode' };
function todayIso() {
    return toIso(new Date());
}
function toIso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function shiftIso(iso, deltaDays) {
    const [year, month, day] = iso.split('-').map(Number);
    const date = new Date(year, (month ?? 1) - 1, day ?? 1);
    date.setDate(date.getDate() + deltaDays);
    return toIso(date);
}
/** Build a date window ending today. `rangeDays <= 0` means all-time. */
function computeRange(rangeDays) {
    const endDate = todayIso();
    if (rangeDays <= 0)
        return { days: 0, startDate: '0000-01-01', endDate };
    return { days: rangeDays, startDate: shiftIso(endDate, -(rangeDays - 1)), endDate };
}
/** The same-length window immediately preceding `range`. */
function computePreviousRange(range) {
    const endDate = shiftIso(range.startDate, -1);
    return { days: range.days, startDate: shiftIso(endDate, -(range.days - 1)), endDate };
}
function sha256(text) {
    return (0, crypto_1.createHash)('sha256').update(text).digest('hex');
}
function avg(values) {
    if (values.length === 0)
        return null;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}
function pct(part, total) {
    if (total <= 0)
        return 0;
    return Math.round((part / total) * 1000) / 10;
}
function normalizeBrand(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function matchesBrand(brand, variants) {
    const normalized = normalizeBrand(brand);
    if (!normalized)
        return false;
    return variants.some((variant) => {
        const variantNorm = normalizeBrand(variant);
        if (variantNorm.length < 2)
            return false;
        return normalized === variantNorm || normalized.includes(variantNorm) || variantNorm.includes(normalized);
    });
}
function clampPosition(value) {
    const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(num) || num <= 0)
        return null;
    return Math.min(Math.round(num), 999);
}
function clampSentiment(value) {
    const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(num))
        return null;
    return Math.min(Math.max(Math.round(num), 0), 100);
}
function buildExtractionPrompt(answerText, brandVariants) {
    return [
        'You analyze AI-generated search answers for brand visibility.',
        `The tracked brand is: "${brandVariants[0] ?? ''}" (also written as: ${brandVariants.join(', ')}).`,
        'From the AI answer below, list EVERY brand, product, company, or website named — the tracked brand AND all competitors.',
        'For each, return: brand (canonical name), position (1-based order of first appearance in the answer),',
        'snippet (the short phrase/sentence around the mention), and sentiment (0-100, how positively the answer portrays it; 50 = neutral).',
        'Respond with ONLY a JSON object, no prose, no code fences:',
        '{ "mentions": [ { "brand": string, "position": number, "snippet": string, "sentiment": number } ] }',
        'If no brands are named, return { "mentions": [] }.',
        '',
        'AI answer:',
        '"""',
        answerText.slice(0, 12_000),
        '"""',
    ].join('\n');
}
function parseMentions(content) {
    const json = extractJsonObject(content);
    if (!json)
        return [];
    try {
        const parsed = JSON.parse(json);
        if (!Array.isArray(parsed.mentions))
            return [];
        return parsed.mentions.filter((item) => typeof item === 'object' && item !== null);
    }
    catch {
        return [];
    }
}
function extractJsonObject(content) {
    const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start)
        return null;
    return cleaned.slice(start, end + 1);
}
exports.aiVisibilityService = new AiVisibilityService();
//# sourceMappingURL=AiVisibilityService.js.map