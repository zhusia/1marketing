"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SELF_CHECK_RULES = exports.REFERENCE_FIDELITY_RULES = exports.ART_DIRECTION_RULES = void 0;
exports.canvasScale = canvasScale;
exports.authoredHtmlContract = authoredHtmlContract;
exports.formatFromDirection = formatFromDirection;
const templates_1 = require("./templates");
/**
 * Type sizes track the SHORT edge, not the width — that keeps a story (1080x1920) and a
 * banner (1500x500) on the same optical scale instead of one rendering billboard-sized text.
 */
function canvasScale(format) {
    const { width, height } = (0, templates_1.formatInfo)(format);
    const short = Math.min(width, height);
    const round = (value) => Math.round(value);
    return {
        width,
        height,
        pad: round(Math.max(short * 0.085, width * 0.05)),
        headline: [round(short * 0.085), round(short * 0.15)],
        subhead: [round(short * 0.038), round(short * 0.055)],
        body: [round(short * 0.026), round(short * 0.034)],
        label: [round(short * 0.02), round(short * 0.027)],
        lineGap: round(short * 0.014),
        blockGap: round(short * 0.045),
        radius: round(short * 0.02),
    };
}
/**
 * The craft bar. Written as imperatives because models follow those; each rule exists to kill
 * a specific failure we kept shipping (even blocks, three competing accents, clipped tone marks).
 */
exports.ART_DIRECTION_RULES = [
    'Art direction (non-negotiable):',
    '- One focal idea. Decide what the viewer reads first, make it unmistakably largest, and let everything else support it. The hierarchy must still read at 25% size.',
    '- Compose on a grid: pick ONE outer margin and align every element to it. Default to a left-aligned editorial column; centre only when the message is a single short statement.',
    '- Rhythm, not distribution: keep related lines tight and push real space between blocks. Never spread blocks evenly to fill the canvas, and never vertically centre a multi-block layout by accident.',
    '- Scale contrast is the design. The headline should be 3-5x the body size. If every element is mid-sized, the composition has failed.',
    '- Leave 25-40% of the canvas quiet. Empty space is the layout, not a gap to fill with decoration.',
    'Typography:',
    '- Headline: display family, weight 700-900, letter-spacing -0.02em to -0.04em, line-height 1.02-1.12, at most 2 lines, 2-8 words.',
    '- Emphasise exactly ONE span of the headline with the accent colour. One, never two.',
    '- ALL CAPS only for short headlines and small labels; never for a sentence of body copy.',
    '- Support line: body family, weight 400-500, line-height 1.35-1.5, at most 2 lines, in the softened ink colour.',
    '- Small labels/eyebrows: uppercase, weight 600-700, letter-spacing 0.12em-0.2em.',
    '- Diacritics are content: for Vietnamese and any accented script keep line-height >= 1.12 and never clip a text box, so tone marks and stacked marks stay whole.',
    '- Never letter-space lowercase running text, never justify, never centre a paragraph longer than two lines.',
    'Colour:',
    '- Three hues maximum: one background family, one ink, one accent. Tints and shades of those are free.',
    '- The accent covers under 10% of the pixels — one headline span, one pill, one dot, one CTA. An all-accent canvas reads cheap.',
    '- Body copy needs >= 4.5:1 contrast against the pixels actually behind it; large display type >= 3:1. Never drop soft ink over the bright part of artwork.',
    '- Dark canvases: near-neutral black (#07070A-#121218) with ONE soft accent glow from a single origin. Not a saturated blue-black, not a rainbow mesh.',
    '- Light canvases: warm or cool paper (never pure #FFFFFF) with one soft tint and darker ink.',
    'Surfaces and decoration:',
    '- Hairline borders (1px at 8-16% ink), one pill radius for chips, one card radius for panels. Reuse those two radii everywhere.',
    '- At most one texture (fine dot grid, subtle noise, or vignette) at <= 8% opacity.',
    '- Banned: stacks of glassmorphic cards, random blurred blobs, drop shadows on text, gradient text over gradient artwork, emoji as icons, fake browser chrome, decorative swooshes, and any element that carries no meaning.',
    'Content:',
    '- Every string is real copy from the brief. No lorem, no placeholder names, no invented metrics, no fabricated logos, awards, or client marks.',
    '- Show a fact chip (date, time, place, price, capacity) only when the brief actually supplies that fact.',
    '- Keep all text inside the safe margin. Nothing may touch or cross the canvas edge except deliberate full-bleed artwork.',
];
/**
 * The technical contract for agent-authored HTML. The renderer is an offline Chromium capture
 * with inlined bundled fonts and no network, so anything that fetches is stripped by
 * `sanitizeAuthoredHtml` — say so up front rather than repairing broken markup afterwards.
 */
function authoredHtmlContract(format) {
    const s = canvasScale(format);
    return [
        `Authored HTML contract — return "html": ONE self-contained fragment with exactly one root element that fills the whole ${s.width}x${s.height}px canvas:`,
        `- Root element: style="position:relative;width:${s.width}px;height:${s.height}px;overflow:hidden" and it MUST paint its own background (the page behind it is not styled for you).`,
        '- Inline styles only. No <style>, <script>, <link>, <img>, @import, url(), data: URIs, remote fonts, SVG sprites, or any external reference — all of them are stripped before rendering and leave a hole in the design.',
        '- Artwork comes from CSS: linear/radial gradients, box-shadow, border, blur filters, and absolutely-positioned coloured divs. Draw icons as simple CSS shapes or skip them; never fake an icon with a letter.',
        '- Fonts: use var(--font-display) for display type, var(--font-body) for text, var(--font-mono) for labels. Never name a font family directly — only bundled faces render. The "typePairing" you return is what those variables resolve to, so choose the heavy display face when the headline should hit like a poster.',
        '- Available variables: --accent, --ink, --ink-soft, --hair, --card, --radius-pill, --radius-lg. Literal hex values are also fine and often clearer; pick one approach and stay consistent.',
        `- Pixel scale for THIS canvas: outer margin ${s.pad}px; headline ${s.headline[0]}-${s.headline[1]}px; support line ${s.subhead[0]}-${s.subhead[1]}px; body ${s.body[0]}-${s.body[1]}px; labels/chips ${s.label[0]}-${s.label[1]}px; ~${s.lineGap}px between related lines, ~${s.blockGap}px between blocks; corner radius ~${s.radius}px (or a full pill for chips).`,
        `- Put data-fit="<the px size you chose>" data-fit-lines="2" on the headline element (and on any long line) — the renderer shrinks it automatically if it would overflow. Do not rely on it: size the text to fit on the first try.`,
        '- Static render only: no hover states, transitions, animations, scrolling, or content that depends on JavaScript.',
        '- Escape < and > inside copy, use straight attribute quotes, and keep the whole fragment under 4500 characters on a SINGLE line — a raw newline inside the JSON string invalidates the whole reply.',
    ];
}
/**
 * How to use an inspected reference. The goal is a sibling, not a copy: same design language,
 * different composition and entirely new content.
 */
exports.REFERENCE_FIDELITY_RULES = [
    'Working from the reference:',
    '- Rebuild the reference\'s design LANGUAGE with precision: its palette roles, background treatment, type weights and case, label/chip shapes, border and radius language, spacing rhythm, and where weight sits on the canvas.',
    '- Match its craft level exactly. If the reference is a dark editorial cover with one accent word and a row of outlined fact chips, the result is also a dark editorial cover with one accent word and a row of outlined fact chips.',
    '- Replace 100% of the content: new headline, new copy, new facts, new marks. Keep zero source text, zero source logos.',
    '- Vary the composition deliberately — a different crop, weight distribution, or block order — so it reads as the next piece in the same series, not a traced duplicate.',
    '- When the operator direction conflicts with the reference, the operator direction wins; keep only the reference cues that still make sense.',
];
/** The last thing the agent reads before answering — a concrete pass/fail list. */
exports.SELF_CHECK_RULES = [
    'Before you answer, verify every item and fix what fails:',
    '1. Nothing overflows, wraps awkwardly, or sits outside the safe margin — including the longest line with its diacritics.',
    '2. The headline is the largest element by a clear margin and reads in under two seconds.',
    '3. Exactly one accent emphasis; body copy passes contrast against the pixels actually behind it.',
    '4. Every element aligns to the same margin or an intentional second column.',
    '5. Every string is real copy from the brief — no placeholder, no invented fact, no leftover reference text.',
    '6. The markup contains no url(), <img>, <script>, <style>, <link> or external font.',
];
const FORMAT_HINTS = [
    { match: /\bog[:\s_-]?image\b|open\s?graph|\bog\s?card\b|twitter\s?card|1200\s*[x×]\s*630/i, format: 'og_card' },
    { match: /\bstory\b|\breel\b|tiktok|vertical|9\s*[:x×]\s*16|1080\s*[x×]\s*1920/i, format: 'story' },
    { match: /\bsquare\b|1\s*[:x×]\s*1\b|1080\s*[x×]\s*1080|instagram\s?post/i, format: 'social_square' },
    { match: /\bbanner\b|cover\s?photo|1500\s*[x×]\s*500|header\s?image/i, format: 'banner' },
    { match: /feature\s?image|16\s*[:x×]\s*9|1200\s*[x×]\s*675|thumbnail|youtube/i, format: 'feature_image' },
];
/**
 * Let the operator ask for a size in plain words ("size là og:image", "make it a story").
 * The panel has no format picker, so the direction field is the only place they can say it.
 */
function formatFromDirection(text) {
    if (!text)
        return null;
    const hint = FORMAT_HINTS.find((entry) => entry.match.test(text));
    return hint ? hint.format : null;
}
//# sourceMappingURL=artDirection.js.map