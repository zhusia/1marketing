"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiPageExtractor = exports.AiPageExtractor = void 0;
const AIService_1 = require("../AIService");
const DEFAULT_MAX_TEXT = 22_000;
const DEFAULT_MAX_LINKS = 120;
/** Pull a single JSON object out of a model response that may include prose or fences. */
function stripToJson(raw) {
    let text = raw.trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced)
        text = fenced[1].trim();
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
        text = text.slice(first, last + 1);
    }
    return text;
}
/**
 * Replaces brittle injected-JS DOM scrapers with schema-validated AI extraction.
 * Given a provider-agnostic PageSnapshot and a Zod schema, it asks the configured
 * AI (local CLI first, then cloud connectors) to return JSON, then validates it.
 * The Zod schema is the contract — DOM changes can't silently break it.
 */
class AiPageExtractor {
    async extract(input) {
        const { snapshot, schema, instructions, schemaHint } = input;
        const maxText = input.maxTextChars ?? DEFAULT_MAX_TEXT;
        const maxLinks = input.maxLinks ?? DEFAULT_MAX_LINKS;
        const linkLines = snapshot.links
            .slice(0, maxLinks)
            .map((link) => `- ${link.text} -> ${link.href}`)
            .join('\n');
        const controlLines = snapshot.controls
            .map((control) => `- selector=${control.selector} label=${JSON.stringify(control.label ?? control.ariaLabel ?? control.placeholder ?? control.name ?? '')} type=${control.type ?? control.tag}${control.required ? ' required' : ''}`)
            .join('\n');
        const buttonLines = snapshot.buttons
            .map((button) => `- selector=${button.selector} text=${JSON.stringify(button.text)} type=${button.type ?? 'button'}`)
            .join('\n');
        const prompt = [
            'You extract structured data from a web page snapshot.',
            instructions,
            'Return ONLY a single minified JSON object. No prose, no markdown, no code fences.',
            'If a value is missing, use null. Do not invent values.',
            'Expected JSON shape:',
            schemaHint,
            `Page URL: ${snapshot.url}`,
            `Page title: ${snapshot.title}`,
            'Relevant links (text -> href):',
            linkLines || '(none)',
            controlLines ? 'Form controls:' : '',
            controlLines,
            buttonLines ? 'Buttons:' : '',
            buttonLines,
            'Page text:',
            snapshot.text.slice(0, maxText),
        ]
            .filter(Boolean)
            .join('\n\n');
        let lastError;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const { content } = await AIService_1.aiService.complete(prompt, {
                conversationId: `extract:${snapshot.url}:${attempt}`,
                agentId: input.agentId,
            });
            try {
                return schema.parse(JSON.parse(stripToJson(content)));
            }
            catch (error) {
                lastError = error;
            }
        }
        throw new Error(`AI extraction did not return valid JSON for ${snapshot.url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    }
}
exports.AiPageExtractor = AiPageExtractor;
exports.aiPageExtractor = new AiPageExtractor();
//# sourceMappingURL=AiPageExtractor.js.map