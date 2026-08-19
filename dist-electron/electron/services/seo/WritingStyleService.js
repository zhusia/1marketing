"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writingStyleService = exports.WritingStyleService = void 0;
/**
 * Writing Style Mimic — turns a user's own writing samples (URLs, pasted text, or
 * .md files) into a reusable "writing" skill that campaign generation can apply.
 *
 * Flow: gather samples (URLs are fetched via SiteAuditService's readable-text path,
 * files are read from disk, pasted text is used as-is) -> ask the local AI to distill
 * a style guide (STRICT JSON) -> return a draft the user can rename/edit -> persist
 * via writingStyleStore. Saved skills are merged into SkillsService.list() so they
 * show up in Settings and the New Campaign skill picker like any built-in skill.
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const seoSkills_1 = require("../../data/seoSkills");
const AIService_1 = require("../AIService");
const WebsiteBrandService_1 = require("../design/WebsiteBrandService");
const SiteAuditService_1 = require("./SiteAuditService");
const writingStyleStore_1 = require("./writingStyleStore");
/**
 * Small step counter that turns discrete gather/analyze steps into progress
 * updates. `log` re-emits the current count with a new message (for a step that
 * is starting); `step` advances the count first (for a step that just finished).
 */
class WritingStyleReporter {
    total;
    sink;
    done = 0;
    constructor(total, sink) {
        this.total = total;
        this.sink = sink;
    }
    log(message) {
        this.sink?.({ done: this.done, total: this.total, message });
    }
    step(message) {
        this.done = Math.min(this.done + 1, this.total);
        this.sink?.({ done: this.done, total: this.total, message });
    }
}
/** Total sample budget handed to the model — keeps us within local-CLI limits. */
const MAX_SAMPLE_CHARS = 18_000;
/** Per-file read cap so one giant file can't eat the whole budget. */
const MAX_FILE_CHARS = 12_000;
const ALLOWED_FILE_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt', '.text']);
/** Pull the first balanced JSON object out of a model response (tolerates fences/prose). */
function extractJsonObject(raw) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fenced ? fenced[1] : raw;
    const start = text.indexOf('{');
    if (start === -1)
        return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"')
            inString = true;
        else if (char === '{')
            depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0)
                return text.slice(start, i + 1);
        }
    }
    return null;
}
class WritingStyleService {
    list() {
        return writingStyleStore_1.writingStyleStore.list();
    }
    reservedNames() {
        return new Set(seoSkills_1.AGENT_SKILLS.map((skill) => skill.name));
    }
    readFileSample(filePath) {
        const label = path_1.default.basename(filePath);
        const ext = path_1.default.extname(filePath).toLowerCase();
        if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
            return {
                sample: null,
                report: { kind: 'file', label, ok: false, charCount: 0, error: 'Unsupported file type (use .md, .mdx, or .txt).' },
            };
        }
        try {
            const raw = fs_1.default.readFileSync(filePath, 'utf8');
            const text = raw.replace(/\r\n/g, '\n').trim().slice(0, MAX_FILE_CHARS);
            if (!text) {
                return { sample: null, report: { kind: 'file', label, ok: false, charCount: 0, error: 'File is empty.' } };
            }
            return { sample: { label, text }, report: { kind: 'file', label, ok: true, charCount: text.length, error: null } };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Could not read the file.';
            return { sample: null, report: { kind: 'file', label, ok: false, charCount: 0, error: message } };
        }
    }
    async gather(input, reporter) {
        const samples = [];
        const reports = [];
        // Fetch URLs one at a time so each shows up as its own log line as it lands.
        const urls = (input.urls ?? []).map((url) => url.trim()).filter(Boolean);
        for (const url of urls) {
            reporter.log(`Fetching ${url}…`);
            const [page] = await SiteAuditService_1.siteAuditService.fetchReadableContent([url]);
            if (page?.ok && page.text.trim()) {
                samples.push({ label: page.title ? `${page.title} (${page.url})` : page.url, text: page.text });
                reports.push({ kind: 'url', label: page.url, ok: true, charCount: page.charCount, error: null });
                reporter.step(`Read ${page.title || page.url} (${page.charCount.toLocaleString()} chars)`);
            }
            else {
                const error = page?.error ?? 'Could not read this page.';
                reports.push({ kind: 'url', label: page?.url ?? url, ok: false, charCount: 0, error });
                reporter.step(`Skipped ${url} — ${error}`);
            }
        }
        for (const rawPath of input.filePaths ?? []) {
            if (!rawPath?.trim())
                continue;
            const filePath = rawPath.trim();
            reporter.log(`Reading ${path_1.default.basename(filePath)}…`);
            const { sample, report } = this.readFileSample(filePath);
            if (sample)
                samples.push(sample);
            reports.push(report);
            reporter.step(report.ok
                ? `Read ${report.label} (${report.charCount.toLocaleString()} chars)`
                : `Skipped ${report.label} — ${report.error ?? 'unreadable'}`);
        }
        const pasted = (input.pastedText ?? '').trim();
        if (pasted) {
            const text = pasted.slice(0, MAX_FILE_CHARS);
            samples.push({ label: 'Pasted text', text });
            reports.push({ kind: 'text', label: 'Pasted text', ok: true, charCount: text.length, error: null });
            reporter.step(`Added pasted text (${text.length.toLocaleString()} chars)`);
        }
        return { samples, reports };
    }
    /** Count the discrete steps a run will report, so the progress bar can fill smoothly. */
    plannedSteps(input) {
        const urls = (input.urls ?? []).map((url) => url.trim()).filter(Boolean).length;
        const files = (input.filePaths ?? []).filter((filePath) => filePath?.trim()).length;
        const pasted = (input.pastedText ?? '').trim() ? 1 : 0;
        // gathered sources + optional GetWebsiteBrand + prepare-samples + analyze + parse
        return urls + files + pasted + (urls > 0 ? 1 : 0) + 3;
    }
    /** Concatenate gathered samples into a single, budget-capped prompt block. */
    buildSampleBlock(samples) {
        const parts = [];
        let used = 0;
        for (let i = 0; i < samples.length; i += 1) {
            if (used >= MAX_SAMPLE_CHARS)
                break;
            const remaining = MAX_SAMPLE_CHARS - used;
            const text = samples[i].text.slice(0, remaining);
            if (!text.trim())
                continue;
            parts.push(`--- SAMPLE ${i + 1}: ${samples[i].label} ---\n${text}`);
            used += text.length;
        }
        return { block: parts.join('\n\n'), usedChars: used };
    }
    buildPrompt(sampleBlock, preferredName) {
        const nameHint = preferredName
            ? `The user wants this style named "${preferredName}". Use it (or a close variant) for the title.`
            : 'Infer a short, memorable title for this writing style (e.g. "Casey\'s Blog Voice", "Punchy Changelog Voice").';
        return [
            'You are a writing-style analyst. You are given one or more real writing samples from a single author/brand.',
            'Study them closely and produce a reusable STYLE GUIDE that another AI can follow to write NEW content that sounds like the same author.',
            '',
            'Analyze (do not output this list — internalize it):',
            '- Voice & tone (formal/casual, warm/dry, confident/hedged, serious/playful).',
            '- Point of view and audience (first vs third person, who they address, how they relate to the reader).',
            '- Sentence structure & rhythm (short vs long, fragments, parallelism, average sentence length).',
            '- Vocabulary & register (plain vs technical, jargon, slang, reading level, favorite/recurring words).',
            '- Punctuation & formatting habits (em dashes, ellipses, emoji, headings, bullet lists, bold, one-sentence paragraphs).',
            '- Rhetorical devices, humor, analogies, and how they open and close pieces.',
            '- Signature quirks and, importantly, things they AVOID.',
            '',
            'Then write the STYLE GUIDE as markdown the writer AI will treat as mandatory constraints. It MUST:',
            '- Be concrete and prescriptive ("Use...", "Never...", "Keep sentences under..."), not a vague description.',
            '- Include a short "Do" list and a short "Avoid" list.',
            '- Capture formatting/punctuation rules explicitly.',
            '- Optionally include 1-2 SHORT illustrative example phrases written in the style (paraphrased, never copied verbatim from the samples).',
            '- Describe the STYLE ONLY. Do NOT lock it to the samples\' specific topics — it will be reused for unrelated content.',
            '',
            nameHint,
            '',
            'Reply with STRICT JSON only. No prose outside the JSON. Do not wrap it in code fences.',
            'JSON shape:',
            '{',
            '  "title": "<short human title for this style>",',
            '  "description": "<one sentence, under 140 chars, describing the voice — used as the skill summary>",',
            '  "body": "<the full markdown style guide, starting with a level-1 heading>"',
            '}',
            '',
            'Writing samples:',
            sampleBlock,
        ].join('\n');
    }
    async generate(input, onProgress) {
        const reporter = new WritingStyleReporter(this.plannedSteps(input), onProgress);
        reporter.log('Reading your writing samples…');
        const { samples, reports } = await this.gather(input, reporter);
        if (!samples.length) {
            const firstError = reports.find((report) => report.error)?.error;
            throw new Error(firstError
                ? `No writing samples could be read. ${firstError}`
                : 'Add at least one URL, some pasted text, or a markdown file to analyze.');
        }
        let websiteBrand = null;
        const firstWebsite = reports.find((report) => report.kind === 'url' && report.ok)?.label;
        if (firstWebsite) {
            try {
                websiteBrand = await WebsiteBrandService_1.websiteBrandService.capture(firstWebsite, {
                    agentId: input.agentId ?? null,
                    onProgress: (message) => reporter.log(message),
                });
                reporter.step(`Website style ready — “${websiteBrand.name}”`);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Could not capture the website style.';
                reporter.step(`Website style skipped — ${message}`);
            }
        }
        else if ((input.urls ?? []).some((url) => url.trim())) {
            reporter.step('Website style skipped — no URL could be read');
        }
        const { block, usedChars } = this.buildSampleBlock(samples);
        const preferredName = (input.name ?? '').trim();
        const prompt = this.buildPrompt(block, preferredName);
        reporter.step(`Prepared ${usedChars.toLocaleString()} characters from ${samples.length} source${samples.length === 1 ? '' : 's'}`);
        reporter.log('Analyzing your voice with the local AI — this can take a minute…');
        const { content, provider } = await AIService_1.aiService.complete(prompt, {
            conversationId: 'writing-style-mimic',
            agentId: input.agentId ?? null,
        });
        reporter.step(`Local AI responded (${provider})`);
        reporter.log('Distilling the reusable style guide…');
        const jsonText = extractJsonObject(content);
        if (!jsonText) {
            throw new Error('The AI did not return a parseable style guide. Try again or switch CLI agent.');
        }
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        }
        catch {
            throw new Error('The AI returned malformed JSON. Try again or switch CLI agent.');
        }
        const body = typeof parsed.body === 'string' ? parsed.body.trim() : '';
        if (!body) {
            throw new Error('The AI response did not include a style guide body. Try again.');
        }
        const title = (typeof parsed.title === 'string' && parsed.title.trim()) || preferredName || 'Custom writing style';
        const description = (typeof parsed.description === 'string' && parsed.description.trim()) || 'Writes in a saved custom voice.';
        reporter.step(`Style guide ready — “${title}”`);
        return {
            name: preferredName || title,
            title,
            description: description.slice(0, 200),
            body,
            sources: reports,
            sampleChars: usedChars,
            provider,
            websiteBrand,
        };
    }
    save(input) {
        const title = (input.title ?? '').trim();
        const body = (input.body ?? '').trim();
        if (!title)
            throw new Error('Give the writing style a name before saving.');
        if (!body)
            throw new Error('The writing style has no content to save.');
        return writingStyleStore_1.writingStyleStore.upsert({
            id: input.id ?? null,
            name: (input.name ?? '').trim() || title,
            title,
            description: (input.description ?? '').trim(),
            body,
            sources: input.sources,
            sampleChars: input.sampleChars,
        }, this.reservedNames());
    }
    delete(id) {
        const trimmed = (id ?? '').trim();
        if (!trimmed)
            return { removed: false };
        return { removed: writingStyleStore_1.writingStyleStore.remove(trimmed).removed };
    }
}
exports.WritingStyleService = WritingStyleService;
exports.writingStyleService = new WritingStyleService();
//# sourceMappingURL=WritingStyleService.js.map