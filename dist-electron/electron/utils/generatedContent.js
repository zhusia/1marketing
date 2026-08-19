"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHORT_VIDEO_GENERATION_INSTRUCTION = exports.STANDARD_X_POST_LIMIT = void 0;
exports.generatedContentInstruction = generatedContentInstruction;
exports.sanitizeGeneratedContent = sanitizeGeneratedContent;
exports.fitGeneratedXPost = fitGeneratedXPost;
const META_TAIL_START = /^(?:one\s+)?(?:flag|note|caveat|heads?\s+up)\s*:/i;
const META_TAIL_INPUT = /\b(?:your|the)\s+brief(?:'s)?\b|\b(?:input|source)\s+(?:conflict|mismatch)\b|\b(?:doesn't|don't|does not|do not)\s+match\b|\bI\s+(?:anchored|led|focused)\s+(?:on|with)\b/i;
const META_TAIL_OFFER = /\b(?:want me to|would you like me to|if you(?:'d| would) rather|say the word|I(?:'ll| can) re-?(?:cut|write|work)|let me know if you want)\b/i;
const META_LEAD_OPENER = String.raw `(?:(?:ok(?:ay)?|sure|alright|got it|right)[,.\s—–-]+)?(?:(?:first|next),?\s+)?`;
const META_LEAD_PERSONAL = String.raw `(?:(?:i|we)\s+(?:(?:am|are|will)\s+|(?:am|are)\s+going\s+to\s+)|(?:i|we)['’](?:m|re|ll)\s+|let me\s+)(?:quickly\s+|now\s+)?`;
const META_LEAD_VERBS = String.raw `inspect|read|review|analy[sz]e|check|draft|write|create|prepare|adapt|repurpose|rewrite|generate|format|polish|condense|translate|verify|validate|count|craft|turn|pull|look(?:\s+up)?|fetch|open|load|gather|collect|scan|browse|confirm|ensure|return|produce|compose|assemble|consult|grab|peek`;
const META_LEAD_GERUNDS = String.raw `inspecting|reading|reviewing|analy[sz]ing|checking|drafting|writing|creating|preparing|adapting|repurposing|rewriting|generating|formatting|polishing|condensing|translating|verifying|validating|counting|crafting|turning|pulling|looking(?:\s+up)?|fetching|opening|loading|gathering|collecting|scanning|browsing|confirming|ensuring|returning|producing|composing|assembling|consulting|grabbing|peeking`;
const META_LEAD_THEN_VERBS = String.raw `inspect|read|review|analy[sz]|check|draft|writ|creat|prepar|adapt|repurpos|rewrit|generat|format|polish|condens|translat|verif|validat|count|craft|turn|return|pull|look|fetch|produc|compos|assembl`;
const META_CHANNEL = String.raw `x|twitter|linkedin|facebook|instagram|threads|bluesky|mastodon|reddit|telegram|slack|discord|pinterest|youtube|tiktok`;
const META_LEAD_PERSONAL_ACTION = new RegExp(`^${META_LEAD_OPENER}${META_LEAD_PERSONAL}(?:${META_LEAD_VERBS})\\b`, 'i');
const META_LEAD_GERUND_ACTION = new RegExp(`^${META_LEAD_OPENER}(?:${META_LEAD_GERUNDS})\\b`, 'i');
// Shared by "I'll …" and gerund work-status openers. Keep this set tight so hooks
// like "Writing in public changed how I build" stay publishable.
const META_LEAD_OPERATION_CORE = new RegExp([
    String.raw `\b(?:the|your|supplied|provided|campaign)\s+(?:source|brief|input|context|draft)\b`,
    String.raw `\b(?:character|word)s?\s+(?:count|cap|limit|ceiling|contract)\b`,
    String.raw `\b(?:character|word|length|format)\s+(?:ceiling|limit|contract|cap)\b`,
    String.raw `\b\d{2,5}[-\s]?characters?\s+(?:cap|limit|ceiling|count)\b`,
    String.raw `\b(?:${META_CHANNEL})[-\s]length\s+(?:post|caption|copy|thread|script|article|video|draft)\b`,
    String.raw `\b(?:${META_CHANNEL})[-\s]ready\b`,
    String.raw `\b(?:${META_CHANNEL})\s+(?:post|caption|copy|thread|script|article|video|draft)\b`,
    String.raw `\btarget\s+(?:channel|platform|format|length)\b`,
    String.raw `\b(?:final|finished|publishable|ready-to-publish)\s+(?:post|copy|caption|asset|response|content|draft)\b`,
    String.raw `\bthen\s+(?:${META_LEAD_THEN_VERBS})\w*\b`,
    String.raw `\breturn\s+only\s+the\s+(?:finished|final|publishable)\b`,
    String.raw `\bagainst\s+the\s+(?:\d|[a-z]+[-\s]character)\b`,
].join('|'), 'i');
// Extra cues Grok uses when it narrates a lookup before writing. Applied only to
// first-person openers so "Writing product details that convert" stays intact.
const META_LEAD_OPERATION_PERSONAL = new RegExp([
    String.raw `\b(?:page|brand|channel)\s+voice\b`,
    String.raw `\blive\s+(?:product|site|page|website)\b`,
    String.raw `\b(?:product|company)\s+(?:facts?|details?|page|site|changelog)\b`,
    String.raw `\b(?:image[-\s]plus[-\s]text|text[-\s]plus[-\s]image|image[-\s]only|text[-\s]only)\s+format\b`,
    String.raw `\bso\s+the\s+(?:caption|post|copy|draft)\b`,
].join('|'), 'i');
exports.STANDARD_X_POST_LIMIT = 280;
/**
 * Short-video generation is a two-stage workflow: the AI writes concise campaign
 * copy, then the app turns the campaign context and that copy into a local MP4.
 * Keep this late in the prompt so a generic/custom channel task cannot quietly
 * turn the primary deliverable back into a standalone script.
 */
exports.SHORT_VIDEO_GENERATION_INSTRUCTION = [
    'Short-video delivery contract (mandatory):',
    '- The default deliverable is a finished short-form video. 1MarketingTool will storyboard and render the MP4 locally through its VideoRenderService after this response.',
    '- Return concise, publishable caption copy with a strong hook, one clear product benefit or moment, and a direct CTA. The app uses the supplied campaign context plus this copy to direct the visuals and on-screen text.',
    '- Do not make a standalone production script the primary deliverable. A narration or dialogue script is optional; include one only when the operator explicitly requests it or the concept genuinely requires spoken delivery.',
    '- Do not return CSS, JavaScript, FFmpeg commands, rendering instructions, or executable code. The local video pipeline owns rendering.',
].join('\n');
function generatedContentInstruction(type) {
    return type === 'video_short' ? exports.SHORT_VIDEO_GENERATION_INSTRUCTION : '';
}
function isAssistantMetaTail(value) {
    const text = value.trim();
    if (!text)
        return false;
    const startsAsMeta = META_TAIL_START.test(text);
    const discussesInput = META_TAIL_INPUT.test(text);
    const offersRevision = META_TAIL_OFFER.test(text);
    return (startsAsMeta && (discussesInput || offersRevision)) || (discussesInput && offersRevision);
}
function isAssistantMetaLead(value) {
    const text = value.trim();
    if (!text)
        return false;
    const personal = META_LEAD_PERSONAL_ACTION.test(text);
    const gerund = META_LEAD_GERUND_ACTION.test(text);
    if (!personal && !gerund)
        return false;
    if (META_LEAD_OPERATION_CORE.test(text))
        return true;
    return personal && META_LEAD_OPERATION_PERSONAL.test(text);
}
/**
 * Find one bounded leading workflow sentence/line while leaving at least some
 * response text behind. ACP agents can emit a work-status message and the final
 * answer as adjacent message chunks, so the boundary does not always contain
 * whitespace or start the asset with an uppercase letter.
 */
function leadingMetaSegmentLength(value) {
    const prefix = value.slice(0, 480);
    for (const boundary of prefix.matchAll(/[.!?:](?=\s*\S)|(?:\r?\n)+(?=\S)/g)) {
        const start = boundary.index ?? -1;
        if (start < 0)
            continue;
        const isLineBoundary = boundary[0].startsWith('\n') || boundary[0].startsWith('\r');
        const textEnd = isLineBoundary ? start : start + 1;
        if (isAssistantMetaLead(value.slice(0, textEnd)))
            return start + boundary[0].length;
    }
    return null;
}
/**
 * Remove model-to-operator commentary that some CLI agents place before or
 * after the publishable asset. The cues are deliberately strict so
 * audience-facing hooks, CTAs, and legitimate horizontal rules remain untouched.
 */
function sanitizeGeneratedContent(raw) {
    let text = raw.trim();
    if (!text)
        return '';
    // Some ACP clients expose progress commentary as ordinary assistant-message
    // chunks. Remove only tightly-scoped workflow sentences so legitimate hooks
    // such as "Building in public changed everything" remain publishable content.
    for (let index = 0; index < 6; index += 1) {
        const segmentLength = leadingMetaSegmentLength(text);
        if (segmentLength === null)
            break;
        text = text.slice(segmentLength).trimStart();
    }
    // A complete work-status sentence with no following asset is not publishable.
    // Leave unfinished fragments in place so streamed chunks can still complete
    // the sentence and be stripped once the real copy arrives.
    if (text &&
        isAssistantMetaLead(text) &&
        leadingMetaSegmentLength(text) === null &&
        /[.!?]["')\]]*$/.test(text)) {
        text = '';
    }
    const dividers = Array.from(text.matchAll(/^[ \t]*(?:-{3,}|_{3,})[ \t]*$/gm));
    for (let index = dividers.length - 1; index >= 0; index -= 1) {
        const divider = dividers[index];
        const start = divider.index ?? -1;
        if (start < 0)
            continue;
        const tail = text.slice(start + divider[0].length).trim();
        if (isAssistantMetaTail(tail))
            return text.slice(0, start).trimEnd();
    }
    const trailingMeta = text.match(/\n{2,}((?:one\s+)?(?:flag|note|caveat|heads?\s+up)\s*:[\s\S]+)$/i);
    if (trailingMeta && isAssistantMetaTail(trailingMeta[1])) {
        return text.slice(0, trailingMeta.index).trimEnd();
    }
    return text;
}
/**
 * Enforce the same JavaScript character count shown by the campaign checklist.
 * Segmenting by grapheme keeps emoji and composed characters intact while the
 * accumulated UTF-16 length guarantees `content.length` cannot exceed the limit.
 */
function fitGeneratedXPost(raw, maxCharacters = exports.STANDARD_X_POST_LIMIT) {
    const content = sanitizeGeneratedContent(raw);
    const limit = Number.isFinite(maxCharacters) ? Math.max(1, Math.floor(maxCharacters)) : exports.STANDARD_X_POST_LIMIT;
    if (content.length <= limit)
        return { content, shortened: false };
    const suffix = '…';
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const kept = [];
    let keptLength = 0;
    let nextSegment = '';
    for (const entry of segmenter.segment(content)) {
        if (keptLength + entry.segment.length + suffix.length > limit) {
            nextSegment = entry.segment;
            break;
        }
        kept.push(entry.segment);
        keptLength += entry.segment.length;
    }
    let result = kept.join('').trimEnd();
    if (result && nextSegment && !/^\s/u.test(nextSegment)) {
        const lastWhitespace = Math.max(result.lastIndexOf(' '), result.lastIndexOf('\n'), result.lastIndexOf('\t'));
        if (lastWhitespace >= result.length * 0.75)
            result = result.slice(0, lastWhitespace).trimEnd();
    }
    return { content: `${result}${suffix}`, shortened: true };
}
//# sourceMappingURL=generatedContent.js.map