"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.limitPostText = limitPostText;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function utf8Length(value) {
    return Buffer.byteLength(value, 'utf8');
}
/**
 * Fit post copy to a platform's Unicode grapheme and UTF-8 byte limits without splitting an emoji.
 * When possible, the shortened text ends at a word boundary and reserves room for an ellipsis.
 */
function limitPostText(value, maxGraphemes, maxUtf8Bytes = Number.POSITIVE_INFINITY) {
    const text = value.trim();
    const graphemes = Array.from(graphemeSegmenter.segment(text), (entry) => entry.segment);
    if (graphemes.length <= maxGraphemes && utf8Length(text) <= maxUtf8Bytes) {
        return { text, shortened: false };
    }
    const suffix = '…';
    const kept = [];
    let keptBytes = 0;
    let nextIndex = 0;
    for (; nextIndex < graphemes.length; nextIndex++) {
        const grapheme = graphemes[nextIndex];
        if (kept.length + 1 >= maxGraphemes)
            break;
        if (keptBytes + utf8Length(grapheme) + utf8Length(suffix) > maxUtf8Bytes)
            break;
        kept.push(grapheme);
        keptBytes += utf8Length(grapheme);
    }
    let result = kept.join('').trimEnd();
    const nextGrapheme = graphemes[nextIndex] ?? '';
    if (result && nextGrapheme && !/\s/u.test(nextGrapheme)) {
        const lastWhitespace = Math.max(result.lastIndexOf(' '), result.lastIndexOf('\n'), result.lastIndexOf('\t'));
        if (lastWhitespace >= result.length * 0.75)
            result = result.slice(0, lastWhitespace).trimEnd();
    }
    return { text: `${result}${suffix}`, shortened: true };
}
//# sourceMappingURL=textLimits.js.map