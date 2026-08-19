"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.firstRunAdvisorService = void 0;
const AIService_1 = require("./AIService");
/**
 * First-run AI advisor (docs/onboarding_v2.md §3.3 / §5). When a local AI CLI is
 * available, the "Your report" screen auto-generates two grounded recommendation
 * sets — marketing growth moves and concrete SEO fixes — from the site's business
 * facts + the crawl's audit findings. One completion, strict-JSON out.
 */
const MAX_PER_SECTION = 6;
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
function toFiniteNumber(value) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    return Number.isFinite(n) ? n : null;
}
/** Normalize a free-form lift ("18", "18%", "+18%", "~20%") to a signed "+18%". */
function normalizeImpact(raw) {
    const match = raw.match(/-?\d+(?:\.\d+)?/);
    if (!match)
        return undefined;
    const n = Math.round(Number(match[0]));
    if (!Number.isFinite(n))
        return undefined;
    return `${n > 0 ? '+' : ''}${n}%`;
}
function coerceRecommendations(value, kind) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const entry of value) {
        const record = (entry ?? {});
        const title = typeof record.title === 'string' ? record.title.trim() : '';
        const detail = typeof record.detail === 'string' ? record.detail.trim() : '';
        if (!title && !detail)
            continue;
        const rec = { title: title || detail.slice(0, 60), detail: detail || title };
        if (kind === 'marketing') {
            const impact = typeof record.impact === 'string' ? normalizeImpact(record.impact) : undefined;
            if (impact)
                rec.impact = impact;
            const category = typeof record.category === 'string' ? record.category.trim().slice(0, 16) : '';
            if (category)
                rec.category = category;
        }
        else {
            const est = toFiniteNumber(record.estMinutes);
            if (est != null)
                rec.estMinutes = Math.min(600, Math.max(1, Math.round(est)));
        }
        out.push(rec);
        if (out.length >= MAX_PER_SECTION)
            break;
    }
    return out;
}
function buildPrompt(input) {
    const { site, audit } = input;
    const facts = [
        `Name: ${site.name}`,
        `Website: ${site.url}`,
        site.tagline ? `Tagline: ${site.tagline}` : '',
        site.description ? `Description: ${site.description}` : '',
        site.competitors?.length ? `Competitors: ${site.competitors.join(', ')}` : '',
        site.keywords?.length ? `Starting keywords: ${site.keywords.join(', ')}` : '',
    ]
        .filter(Boolean)
        .join('\n');
    const auditFacts = audit
        ? [
            `Technical SEO health score: ${audit.healthScore ?? 'unknown'} / 100`,
            audit.issues.length
                ? `Crawl findings:\n${audit.issues
                    .map((issue) => `- ${issue.label} (${issue.severity}, ${issue.count} page${issue.count === 1 ? '' : 's'})`)
                    .join('\n')}`
                : 'Crawl findings: none reported.',
        ].join('\n')
        : 'No technical crawl was available.';
    return [
        'You are a senior growth marketer and technical SEO consultant reviewing ONE specific website.',
        'Infer the real industry from the details — do NOT assume it is a SaaS or startup unless the facts say so.',
        'Produce two sets of specific, actionable recommendations grounded in the facts below:',
        '1. "marketing": high-leverage marketing / content / distribution moves to grow this specific site (use its keywords, audience, and competitors — not generic advice).',
        '2. "seo": concrete on-site fixes to improve search performance, prioritising the crawl findings above (reference the actual issues where relevant).',
        `Give at most ${MAX_PER_SECTION} items per set, most impactful first. Each item: a short imperative "title" (max ~8 words) and a 1-2 sentence "detail" that is concrete to THIS site.`,
        'For each MARKETING item also add "impact" (your best rough estimate of the lift as a percentage string, e.g. "+18%") and "category" (ONE short tag: one of CRO, Ads, SEO, Content, Social, Email, or Trust).',
        'For each SEO item also add "estMinutes" (integer — rough one-time minutes to implement the fix).',
        'Also add top-level "seoScore" (integer 0-100 rating this site\'s overall SEO/content opportunity, higher = stronger) and "seoSummary" (a max ~6-word verdict, e.g. "Healthy baseline, weak content depth").',
        'Output ONLY valid JSON, no prose and no code fences, matching exactly this schema:',
        '{"seoScore":0,"seoSummary":"","marketing":[{"title":"","detail":"","impact":"+12%","category":"CRO"}],"seo":[{"title":"","detail":"","estMinutes":10}]}',
        '',
        'Site details:',
        facts,
        '',
        'Technical audit:',
        auditFacts,
    ].join('\n');
}
class FirstRunAdvisorService {
    async recommend(input) {
        const prompt = buildPrompt(input);
        const { content, provider } = await AIService_1.aiService.complete(prompt, {
            conversationId: `first-run-advice:${input.site.url}`,
            agentId: input.agentId ?? null,
        });
        const jsonText = extractJsonObject(content);
        if (!jsonText) {
            throw new Error('The AI did not return parseable recommendations. Try again or switch CLI agent.');
        }
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        }
        catch {
            throw new Error('The AI returned malformed JSON. Try again or switch CLI agent.');
        }
        const marketing = coerceRecommendations(parsed.marketing, 'marketing');
        const seo = coerceRecommendations(parsed.seo, 'seo');
        if (!marketing.length && !seo.length) {
            throw new Error('The AI returned no usable recommendations. Try again or switch CLI agent.');
        }
        const seoScoreRaw = toFiniteNumber(parsed.seoScore);
        const seoScore = seoScoreRaw == null ? undefined : Math.min(100, Math.max(0, Math.round(seoScoreRaw)));
        const seoSummary = typeof parsed.seoSummary === 'string' && parsed.seoSummary.trim() ? parsed.seoSummary.trim() : undefined;
        return { marketing, seo, provider, seoScore, seoSummary };
    }
}
exports.firstRunAdvisorService = new FirstRunAdvisorService();
//# sourceMappingURL=FirstRunAdvisorService.js.map