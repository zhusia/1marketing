"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentLanguageName = contentLanguageName;
exports.contentLanguageInstruction = contentLanguageInstruction;
const BUILTIN_LANGUAGE_NAMES = {
    en: 'English',
    vi: 'Vietnamese',
};
function normalizeLanguageCode(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
function normalizeLanguageName(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function languageNameKey(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}
function contentLanguageName(code, suppliedName) {
    const normalizedCode = normalizeLanguageCode(code);
    const normalizedName = normalizeLanguageName(suppliedName);
    return normalizedName || BUILTIN_LANGUAGE_NAMES[normalizedCode] || normalizedCode.toUpperCase();
}
/**
 * A late, mandatory language contract shared by copy and design prompts. It deliberately
 * overrides style skills that restrict punctuation to ASCII without allowing those skills
 * to transliterate the language itself.
 */
function contentLanguageInstruction(input) {
    const code = normalizeLanguageCode(input.code);
    const suppliedName = normalizeLanguageName(input.name);
    if (!code && !suppliedName)
        return null;
    const name = contentLanguageName(code, suppliedName);
    const outputLabel = input.outputLabel?.trim() || 'publishable content';
    const primaryCode = code.split('-')[0];
    const nameKey = languageNameKey(name);
    const isVietnamese = primaryCode === 'vi' || nameKey.includes('vietnamese') || nameKey.includes('tieng viet');
    if (isVietnamese) {
        return [
            `Language contract (mandatory): Write all ${outputLabel} in natural Vietnamese.`,
            'Use full Vietnamese Unicode spelling with every required diacritic and tone mark (for example, "tiếng Việt có dấu").',
            'Never output unaccented or romanized Vietnamese.',
            'This overrides any selected style or skill rule that limits characters to ASCII or a US keyboard; such rules apply only to punctuation, not Vietnamese letters.',
        ].join(' ');
    }
    if (primaryCode && primaryCode !== 'en') {
        return [
            `Language contract (mandatory): Write all ${outputLabel} in ${name}.`,
            'Preserve the Unicode letters, diacritics, and native script required by the language; never transliterate the copy to ASCII.',
            'This overrides any selected style or skill rule that limits characters to ASCII or a US keyboard; such rules apply only to punctuation.',
        ].join(' ');
    }
    return `Language contract (mandatory): Write all ${outputLabel} in ${name}.`;
}
//# sourceMappingURL=contentLanguage.js.map