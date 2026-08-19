"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AIService = exports.DEFAULT_CHANNEL_TASKS = exports.DEFAULT_SYSTEM_PROMPT = void 0;
const AiLogService_1 = require("./AiLogService");
const AiProviderService_1 = require("./AiProviderService");
const agent_bridge_1 = require("../agent-bridge");
const generatedContent_1 = require("../utils/generatedContent");
const aiResponse_1 = require("../utils/aiResponse");
const contentLanguage_1 = require("../utils/contentLanguage");
function classifyToolLog(text) {
    if (/^(Search:|Results:)/i.test(text.trim()) ||
        /\b(web\s*search|websearch|web_search|WebSearch|WebFetch|google_search|brave search|search the web|grounded with)\b/i.test(text)) {
        return 'websearch';
    }
    return 'tool';
}
function phaseFromToolText(text) {
    const trimmed = text.trim();
    if (/^Search:/i.test(trimmed))
        return 'query';
    if (/^Results:/i.test(trimmed))
        return 'result';
    if (/\b(returned|grounded with|sources?|citations?)\b/i.test(trimmed))
        return 'result';
    if (/\b(in[_\s-]?progress|pending|completed|failed|started|enabled|disabled|available)\b/i.test(trimmed)) {
        return 'status';
    }
    if (/^Web search:/i.test(trimmed) && trimmed.length > 'Web search:'.length + 1)
        return 'query';
    return undefined;
}
function detailFromToolText(text, phase) {
    const trimmed = text.trim();
    if (phase === 'query') {
        const match = trimmed.match(/^Search:\s*(.+)$/i) ?? trimmed.match(/^Web search:\s*(.+)$/i);
        return match?.[1]?.trim() || undefined;
    }
    if (phase === 'result') {
        const match = trimmed.match(/^Results:\s*(.+)$/i);
        return match?.[1]?.trim() || trimmed;
    }
    return undefined;
}
function sitesFromText(text) {
    if (!text?.trim())
        return undefined;
    const sites = [];
    const seen = new Set();
    const push = (urlRaw, title) => {
        try {
            const withProtocol = /^https?:\/\//i.test(urlRaw) ? urlRaw : `https://${urlRaw}`;
            const url = new URL(withProtocol.replace(/[.,;:!?)]+$/, ''));
            if (!url.hostname.includes('.'))
                return;
            url.hash = '';
            const href = url.toString();
            if (seen.has(href))
                return;
            seen.add(href);
            sites.push({ url: href, ...(title?.trim() ? { title: title.trim() } : {}) });
        }
        catch {
            // ignore invalid urls
        }
    };
    const md = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi;
    let match;
    while ((match = md.exec(text)) !== null)
        push(match[2], match[1]);
    const bare = /https?:\/\/[^\s<>"')\]]+/gi;
    while ((match = bare.exec(text)) !== null)
        push(match[0]);
    // "example.com — Title" lines
    for (const line of text.split(/\r?\n/)) {
        const domain = line.match(/^(?:[-*•]\s*)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\s*[—–:-]\s*(.+))?$/i);
        if (domain)
            push(domain[1], domain[2]);
    }
    return sites.length ? sites.slice(0, 12) : undefined;
}
/** Prompt appendix so local CLIs honor the operator's web-search toggle. */
function webSearchInstruction(enabled) {
    if (enabled) {
        return [
            'Web search is ENABLED for this run.',
            'You may use web search / browse tools when you need current facts, competitor context, or citations.',
            'When you search, keep queries short and relevant to the campaign source.',
            'Do not narrate the search, a voice check, or a product-page lookup. Fold any facts you find into the asset only.',
        ].join(' ');
    }
    return [
        'Web search is DISABLED for this run.',
        'Do not use web search, browse, WebFetch, or any internet lookup tools.',
        'Write only from the supplied product brief, brand voice, and your existing knowledge.',
    ].join(' ');
}
function languageInstruction(context) {
    return (0, contentLanguage_1.contentLanguageInstruction)({
        code: context.language,
        name: context.languageName,
        outputLabel: 'publishable copy',
    });
}
/**
 * Default system preamble shared by every channel. The renderer mirrors this in
 * the campaign prompt editor (DEFAULT_SYSTEM_PROMPT) — keep the two in sync.
 */
exports.DEFAULT_SYSTEM_PROMPT = [
    'You are a senior growth marketer writing high quality content for an indie SaaS founder.',
    'Use the supplied source as ground truth. Preserve concrete product details, avoid generic claims, and match the brand voice profile when present.',
    'Treat every channel-specific format, length limit, and output contract as mandatory. Check them silently — never mention the check, a character count, a voice review, or a product-page lookup in the output.',
    'Return only finished, ready-to-publish content. The first character of your response must belong to the asset. Never prepend progress updates, plans, or first-person drafting notes, and never append analysis, caveats, input critiques, or offers to revise it.',
].join('\n\n');
/**
 * Default per-channel task instruction. Mirrored by the renderer
 * (DEFAULT_CHANNEL_TASKS) so the prompt editor can show editable defaults.
 */
exports.DEFAULT_CHANNEL_TASKS = {
    changelog: 'Write a product changelog entry with sections Added/Changed/Fixed/Breaking.',
    blog: 'Write an SEO-optimized blog post (800-1200 words) with title and meta description.',
    tweet_thread: [
        'Write one short-form social post for the target channel.',
        'Do not write a thread unless the user explicitly asks for one.',
        'Keep it concise, native to the platform, and ready to publish.',
    ].join(' '),
    linkedin: 'Write a LinkedIn post in professional tone with clear CTA.',
    reddit: 'Write a value-first Reddit post that avoids promotional tone.',
    video_short: 'Create a short-form video with a strong hook, one clear product moment, concise on-screen copy, and a direct CTA.',
    video_long: 'Write a long video script (5-10 minutes) for tutorial walkthrough.',
    seo_brief: 'Write an SEO content brief with intent, outline, FAQ and internal linking suggestions.',
};
function readStringContext(context, key) {
    const value = context[key];
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}
function asksForThread(prompt) {
    const text = prompt.toLowerCase();
    const hasThreadAsk = /\b(thread|threads|tweetstorm|multi[-\s]?post|multiple posts|series of posts)\b/.test(text);
    if (!hasThreadAsk)
        return false;
    return !/\b(do not|don't|dont|never|avoid|no|not)\b[^.?!\n]{0,80}\b(thread|threads|tweetstorm|multi[-\s]?post|multiple posts|series of posts)\b/.test(text);
}
function platformInstruction(type, context) {
    const platform = readStringContext(context, 'targetPlatform');
    const label = readStringContext(context, 'targetPlatformLabel') || platform;
    if (!platform)
        return '';
    const xLimitRaw = context.xPostLimit;
    const xLimit = typeof xLimitRaw === 'number' && Number.isFinite(xLimitRaw) ? xLimitRaw : 280;
    const xTarget = Math.max(1, xLimit - 20);
    // Instagram posts can be a static image (caption) or a rendered Reel; default to image.
    const instagramAsVideo = readStringContext(context, 'instagramContentType') === 'video';
    const base = [
        `Target channel: ${label}.`,
        'Generate copy specifically for this channel. If a format-level instruction conflicts with this target channel, follow the target channel.',
    ];
    const platformRules = {
        twitter: [
            'Write one X post only.',
            'Do NOT write a thread.',
            'Return exactly one compact post body; do not split it into numbered parts or blank-line-separated posts.',
            'Use a strong opening line no longer than 120 characters. Include a clear call to action and 1-2 relevant hashtags.',
            `Hard length ceiling: the complete post must be ${xLimit.toLocaleString()} characters or fewer, including spaces, line breaks, hashtags, mentions, and URLs.`,
            xLimit <= 280
                ? `The X channel is configured as Standard for this run. Aim for ${xTarget.toLocaleString()} characters or fewer to leave a safety margin for X URL and Unicode weighting.`
                : `The X channel is configured as Premium / Premium+ and allows up to ${xLimit.toLocaleString()} characters for this run.`,
            'Before responding, count every character in the final post and silently rewrite it until it fits the hard ceiling.',
            'Do not use markdown bold or italic formatting.',
        ].join(' '),
        linkedin: 'Write a LinkedIn personal profile post. Professional tone, strong first line, clear CTA, under 3,000 characters. Do not use markdown bold or italic formatting.',
        linkedin_page: 'Write a LinkedIn Page post. Brand/account voice, clear CTA, under 3,000 characters. Do not use markdown bold or italic formatting.',
        facebook: 'Write a Facebook Page post. Conversational, clear, and native to Facebook. Do not mention LinkedIn. Do not use markdown bold or italic formatting.',
        threads: 'Write one Threads post only. Do not write a thread. Keep it conversational and under 500 characters. Honor the limit silently; do not mention the count in the post.',
        bluesky: 'Write one Bluesky post only. Do not write a thread. Keep it under 300 characters. Honor the limit silently; do not mention the count in the post.',
        mastodon: 'Write one Mastodon post only. Do not write a thread. Keep it under 500 characters. Honor the limit silently; do not mention the count in the post.',
        pinterest: 'Write Pinterest pin copy: a punchy title, a concise description, and search-friendly keywords. Avoid thread wording.',
        telegram: 'Write a Telegram channel post. Direct, readable in chat, and suitable for a broadcast message. Do not use markdown bold or italic formatting.',
        slack: 'Write a Slack community announcement. Concise, useful, plain text, and formatted for a workspace channel. Avoid generic openers like "Hey everyone".',
        discord: 'Write a Discord community announcement. Conversational, concise, and easy to scan in a server channel. Avoid generic openers like "Hey everyone".',
        reddit: 'Write a Reddit post. Value-first, non-promotional, and invite discussion.',
        instagram: instagramAsVideo
            ? 'Create an Instagram Reel with a fast hook, clear visual beats, concise on-screen copy, a native caption, and a CTA.'
            : 'Write an Instagram feed caption for a single image post: a scroll-stopping first line, 2-4 short lines of value, a clear CTA, and 3-6 relevant hashtags on the last line. Do not write a video script or scene directions.',
        tiktok: 'Create a TikTok short video with a fast hook, quick visual beats, concise on-screen copy, a native caption, and a CTA.',
        youtube: type === 'video_short'
            ? 'Create a YouTube Short with a strong hook, visual beats, concise on-screen copy, a native caption, and a CTA.'
            : 'Write a YouTube video script with intro, sections, on-screen beats, and CTA.',
        wordpress: 'Write a WordPress-ready blog article with clear headings, intro, body, and meta description.',
        ghost: 'Write a Ghost-ready blog article with clear headings, intro, body, and meta description.',
        devto: 'Write a Dev.to article for technical readers with practical framing, headings, and code-free clarity unless code is required.',
        hashnode: 'Write a Hashnode article for builders with practical framing, headings, and clear takeaways.',
        medium: 'Write a Medium-style article with a strong headline, narrative intro, headings, and clear takeaways.',
        custom_api: 'Write a generic long-form article suitable for a custom API destination.',
    };
    return [...base, platformRules[platform] ?? `Write for ${label}.`].join('\n');
}
function accountDeliveryInstruction(context) {
    const accountName = readStringContext(context, 'targetAccountName');
    const postFormat = readStringContext(context, 'accountPostFormat');
    if (!accountName || !postFormat)
        return '';
    const destination = `Destination account: ${accountName}.`;
    if (postFormat === 'image') {
        return [
            destination,
            'Delivery format: image only. Produce a concise visual concept and short on-image copy for the image ' +
                'designer. No caption text will be published.',
        ].join('\n');
    }
    if (postFormat === 'text_image') {
        return [
            destination,
            'Delivery format: text plus image. Write the publishable caption so it complements an accompanying ' +
                'image without describing the image literally.',
        ].join('\n');
    }
    return [
        destination,
        'Delivery format: text only. Write a complete post that does not refer to an attached image.',
    ].join('\n');
}
/**
 * Repurpose contract: the campaign source is a finished post the operator wrote
 * for one channel (e.g. Facebook), and each generated piece must faithfully adapt
 * it to its target channel instead of treating it as a loose brief. The renderer
 * mirrors this in NewCampaignView's repurposeInstruction — keep the two in sync.
 */
function repurposeInstruction(context) {
    if (readStringContext(context, 'sourceMode') !== 'repurpose')
        return '';
    const label = readStringContext(context, 'sourceChannelLabel');
    const origin = label ? `a finished ${label} post` : 'a finished post from another channel';
    return [
        `Repurpose contract (mandatory): the campaign source is ${origin} the operator wrote themselves.`,
        '- Treat it as the single source of truth for the message, story, claims, and voice. Repurpose it; do not write a new piece loosely inspired by it.',
        "- Keep the author's tone and every concrete detail, number, name, and link. Do not invent facts, features, or quotes that are not in the source.",
        '- Rebuild the hook, structure, length, and conventions natively for the target channel instead of copying the source layout.',
        '- Never mention the source channel or that the content was adapted from another post.',
    ].join('\n');
}
function contentDetailInstruction(context) {
    if (readStringContext(context, 'sourceMode') !== 'repurpose')
        return '';
    const detail = readStringContext(context, 'contentDetail');
    if (detail === 'concise') {
        return 'Detail level: concise. Keep one clear idea, a strong channel-native hook, and only the essential supporting facts.';
    }
    if (detail === 'detailed') {
        return 'Detail level: detailed. Preserve the source\'s nuance and supporting facts, expanding the structure only where the target channel rewards depth.';
    }
    return 'Detail level: balanced. Preserve the important specifics while keeping the result focused and native to the target channel.';
}
function outputFormatFrom(context) {
    const value = context.outputFormat;
    return value === 'plaintext' || value === 'html' || value === 'markdown' ? value : 'markdown';
}
function outputFormatInstruction(context) {
    const format = outputFormatFrom(context);
    if (format === 'html') {
        return [
            'Output format contract (mandatory): HTML.',
            '- Return only a valid, semantic HTML fragment.',
            '- Use HTML elements for headings, paragraphs, lists, emphasis, and links.',
            '- Do not include <!doctype>, <html>, <head>, or <body> wrappers.',
            '- Do not use Markdown or wrap the response in a code fence.',
        ].join('\n');
    }
    if (format === 'plaintext') {
        return [
            'Output format contract (mandatory): plain text.',
            '- Return only unformatted plain text.',
            '- Do not use Markdown syntax, HTML tags, or code fences.',
            '- Preserve readability with ordinary line breaks.',
        ].join('\n');
    }
    return [
        'Output format contract (mandatory): Markdown.',
        '- Return only the finished asset in valid Markdown.',
        '- Do not use HTML or wrap the entire response in a code fence.',
    ].join('\n');
}
function regenerationInstruction(context) {
    const prompt = readStringContext(context, 'regenerationPrompt');
    if (!prompt)
        return '';
    return [
        'Operator revision request (mandatory):',
        prompt,
        'Create a new version of the previous content that follows this request. Preserve accurate product details and any parts the request does not ask to change.',
    ].join('\n');
}
function readPromptOverrides(context) {
    const raw = context.promptOverrides;
    if (!raw || typeof raw !== 'object')
        return { tasks: {}, skills: [] };
    const obj = raw;
    const system = typeof obj.system === 'string' && obj.system.trim() ? obj.system.trim() : undefined;
    const tasks = {};
    const tasksRaw = obj.tasks && typeof obj.tasks === 'object' ? obj.tasks : {};
    for (const [key, value] of Object.entries(tasksRaw)) {
        if (typeof value === 'string' && value.trim())
            tasks[key] = value.trim();
    }
    const skillsRaw = Array.isArray(obj.skills) ? obj.skills : [];
    const skills = [];
    for (const entry of skillsRaw) {
        if (!entry || typeof entry !== 'object')
            continue;
        const record = entry;
        const body = typeof record.body === 'string' ? record.body.trim() : '';
        if (!body)
            continue;
        const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : 'selected-skill';
        const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : name;
        skills.push({ name, title, body });
    }
    return { system, tasks, skills };
}
function renderSkillInstructions(skills) {
    if (!skills.length)
        return '';
    return [
        'Apply these selected skills as mandatory writing constraints:',
        ...skills.map((skill) => `## ${skill.title}\n${skill.body}`),
    ].join('\n\n');
}
function resolveTask(type, overrides) {
    const custom = overrides.tasks[type];
    if (custom && !(type === 'tweet_thread' && asksForThread(custom)))
        return custom;
    return exports.DEFAULT_CHANNEL_TASKS[type] ?? 'Write marketing content.';
}
function buildPrompt(input) {
    const { product, type, context } = input;
    const overrides = readPromptOverrides(context);
    const systemPrompt = overrides.system ?? exports.DEFAULT_SYSTEM_PROMPT;
    const task = resolveTask(type, overrides);
    // Keep the editable prompt fields out of the embedded context dump so the
    // instruction text is not duplicated (and confusing) inside the JSON payload.
    const { promptOverrides: _omitOverrides, languageNames: _omitLanguageNames, regenerationPrompt: _omitRegenerationPrompt, ...contextForJson } = context;
    const contextText = JSON.stringify(contextForJson, null, 2);
    return [
        systemPrompt,
        renderSkillInstructions(overrides.skills),
        task,
        platformInstruction(type, context),
        accountDeliveryInstruction(context),
        repurposeInstruction(context),
        contentDetailInstruction(context),
        regenerationInstruction(context),
        (0, generatedContent_1.generatedContentInstruction)(type),
        `Product name: ${product.name}`,
        `Tagline: ${product.tagline}`,
        `Target user: ${product.targetUser || 'Indie founders'}`,
        `Pain solved: ${product.painSolved || 'Marketing automation complexity'}`,
        languageInstruction(context) ?? '',
        'Context JSON:',
        contextText,
        outputFormatInstruction(context),
        [
            'Response contract (mandatory):',
            '- Return only the finished, ready-to-publish asset in the requested output format.',
            '- The first character of the response must belong to the asset. Do not describe your process. Do not say you will check, draft, count, pull, review a voice, or validate anything.',
            '- If you need current facts, a character count, or a format check, do that silently and start the response with the asset itself.',
            '- Do not append analysis, caveats, notes, input conflicts, alternative directions, or commentary after the asset.',
            '- Never ask the operator for clarification, approval, or whether they want a revision. Do not say "want me to", "say the word", or "let me know".',
            '- If supplied details conflict, silently prioritize the campaign source and produce the best complete asset.',
        ].join('\n'),
    ].join('\n\n');
}
/** Strip code fences / surrounding quotes a CLI may wrap the generated prompt in. */
function sanitizeSystemPrompt(raw) {
    let text = raw.trim();
    const fence = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
    if (fence)
        text = fence[1].trim();
    if (text.length > 1 && /^["'`]/.test(text) && text.endsWith(text[0])) {
        text = text.slice(1, -1).trim();
    }
    return text;
}
function isSupportedAgentId(value) {
    return Object.prototype.hasOwnProperty.call(agent_bridge_1.CHAT_AGENT_LABELS, value);
}
function selectedLocalAgent(agents, requestedAgentId) {
    const requestedFromInput = requestedAgentId?.trim();
    if (requestedFromInput) {
        if (!isSupportedAgentId(requestedFromInput))
            return null;
        return agents.find((candidate) => candidate.id === requestedFromInput && candidate.state === 'detected') ?? null;
    }
    const requested = process.env.ONE_MARKETING_TOOL_AGENT_ID;
    if (requested && isSupportedAgentId(requested)) {
        const agent = agents.find((candidate) => candidate.id === requested && candidate.state === 'detected');
        if (agent)
            return agent;
    }
    return agents.find((agent) => agent.state === 'detected') ?? null;
}
function toLocalAgentInfo(agent) {
    return {
        id: agent.id,
        displayName: agent.displayName,
        state: agent.state,
        version: agent.version,
        path: agent.path,
        source: agent.source,
        error: agent.error,
        acp: agent.acp,
        imageGen: agent.imageGen,
    };
}
class AIService {
    async getLocalStatus(opts = {}) {
        const agents = (await (0, agent_bridge_1.listLocalChatAgents)({ force: opts.force })).map(toLocalAgentInfo);
        const activeRoute = AiProviderService_1.aiProviderService.getActiveRoute();
        const selected = activeRoute.mode === 'byok'
            ? null
            : selectedLocalAgent(agents, activeRoute.mode === 'local-cli' ? activeRoute.localAgentId ?? null : null);
        return {
            provider: 'local-cli',
            available: agents.some((agent) => agent.state === 'detected'),
            registryPath: '~/.1marketingtool/state/cli-registry.json',
            selectedAgentId: selected?.id ?? null,
            selectedAgentName: selected?.displayName ?? null,
            agents,
        };
    }
    /**
     * Live end-to-end health check for the AI stack. Sends a trivial prompt through
     * the same routing chain as real generation — local CLI first (ACP or headless,
     * exercising the agent-bridge), then the BYOK cloud fallback — and reports which
     * route answered so onboarding can confirm the AI actually works, not just that
     * a binary was detected on disk. Never throws: failures come back as ok:false.
     */
    async testConnection(opts) {
        const status = await this.getLocalStatus();
        // Respect the caller's explicit choice. When no agent is passed we fall through
        // to complete()'s router, which honours the active route (a specific local CLI,
        // a BYOK provider, or the auto chain) — NOT the auto-detected default agent.
        const requestedAgentId = opts?.agentId ?? null;
        const startedAt = Date.now();
        try {
            const result = await this.complete('Reply with only the word OK.', {
                agentId: requestedAgentId,
                conversationId: `ai-test:${Date.now()}`,
            });
            let agentId = null;
            let agentName = null;
            let transport = null;
            if (result.provider.startsWith('local-cli:')) {
                const id = result.provider.slice('local-cli:'.length);
                agentId = isSupportedAgentId(id) ? id : null;
                const info = agentId ? status.agents.find((agent) => agent.id === agentId) ?? null : null;
                agentName = info?.displayName ?? agentId;
                transport = info?.acp ? 'acp' : 'headless';
            }
            else if (result.provider.startsWith('byok:')) {
                transport = 'byok';
                agentName = result.provider.slice('byok:'.length) || 'Cloud provider';
            }
            return {
                ok: true,
                provider: result.provider,
                agentId,
                agentName,
                transport,
                reply: result.content.trim().slice(0, 200),
                elapsedMs: Date.now() - startedAt,
                error: null,
            };
        }
        catch (error) {
            return {
                ok: false,
                provider: null,
                agentId: null,
                agentName: null,
                transport: null,
                reply: '',
                elapsedMs: Date.now() - startedAt,
                error: error instanceof Error ? error.message : 'The AI did not respond.',
            };
        }
    }
    async generateWithLocalCli(prompt, cwd, conversationId, requestedAgentId, onLog, onToken, webSearch = false) {
        onLog?.('Scanning local CLI agents...');
        const agents = (await (0, agent_bridge_1.listLocalChatAgents)()).map(toLocalAgentInfo);
        const agent = selectedLocalAgent(agents, requestedAgentId);
        if (!agent) {
            onLog?.(requestedAgentId
                ? `Requested CLI "${requestedAgentId}" is not detected.`
                : 'No detected local CLI agent is available.', 'error');
            return null;
        }
        onLog?.(webSearch
            ? `Web search enabled for ${agent.displayName} (agent may call search tools).`
            : `Web search disabled for ${agent.displayName}.`, 'info', webSearch ? 'websearch' : 'message');
        onLog?.(`Running ${agent.displayName}${agent.acp ? ' via ACP' : ' headless'}...`);
        const fullPrompt = `${prompt}\n\n${webSearchInstruction(webSearch)}`;
        const result = await (0, agent_bridge_1.runLocalChatAgent)({
            agentId: agent.id,
            prompt: fullPrompt,
            cwd,
            timeoutSec: 600,
            conversationId,
            runId: `content:${Date.now()}`,
        }, {
            onChunk: (chunk) => {
                if (chunk.channel === 'message')
                    onToken?.(chunk.text);
                if (chunk.channel === 'tool') {
                    const kind = chunk.toolMeta?.isWebSearch
                        ? 'websearch'
                        : classifyToolLog(chunk.text);
                    const phase = chunk.toolMeta?.phase === 'query' || chunk.toolMeta?.phase === 'result' || chunk.toolMeta?.phase === 'status'
                        ? chunk.toolMeta.phase
                        : phaseFromToolText(chunk.text);
                    const detail = chunk.toolMeta?.detail ?? detailFromToolText(chunk.text, phase);
                    const sites = chunk.toolMeta?.sites?.length
                        ? chunk.toolMeta.sites.map((site) => ({
                            url: site.url,
                            ...(site.title ? { title: site.title } : {}),
                            ...(site.snippet ? { snippet: site.snippet } : {}),
                        }))
                        : sitesFromText(detail ?? chunk.text);
                    onLog?.(chunk.text, 'info', kind, {
                        phase,
                        detail,
                        ...(sites?.length ? { sites } : {}),
                    });
                }
            },
        });
        const output = result.output.trim();
        const reportedFailure = (0, aiResponse_1.detectAiResponseFailure)(output);
        if (!result.ok || !output || reportedFailure) {
            const message = result.error ??
                (reportedFailure
                    ? `${agent.displayName} failed: ${reportedFailure}`
                    : `${agent.displayName} did not return usable content.`);
            onLog?.(message, 'error');
            throw new Error(message);
        }
        onLog?.(`${agent.displayName} returned ${output.length.toLocaleString()} characters.`, 'success');
        return { content: output, provider: `local-cli:${agent.id}` };
    }
    async generate(input) {
        const prompt = buildPrompt(input);
        const language = typeof input.context.language === 'string' ? input.context.language : 'default';
        const conversationId = `content:${input.product.id}:${input.type}:${language}`;
        const webSearch = Boolean(input.webSearch);
        const result = await this.runPrompt(prompt, {
            cwd: input.product.repoPath,
            conversationId,
            agentId: input.agentId,
            webSearch,
            onLog: input.onLog,
            onToken: input.onToken,
        });
        const content = (0, generatedContent_1.sanitizeGeneratedContent)(result.content);
        if (!content.trim()) {
            const message = `${result.provider} did not return publishable content. No content was saved.`;
            input.onLog?.(message, 'error');
            throw new Error(message);
        }
        if (content !== result.content.trim()) {
            input.onLog?.('Removed non-publishable AI commentary from the generated result.', 'success');
        }
        return { ...result, content };
    }
    /**
     * Ask the local CLI to write a system prompt tailored to a specific product, so
     * the campaign generator is not hard-coded to "indie SaaS founder". The returned
     * text replaces DEFAULT_SYSTEM_PROMPT for that product.
     */
    async generateSystemPrompt(product, options) {
        const facts = [
            `Name: ${product.name}`,
            product.tagline ? `Tagline: ${product.tagline}` : '',
            product.shortDescription ? `What it is: ${product.shortDescription}` : '',
            product.mediumDescription ? `Description: ${product.mediumDescription}` : '',
            product.targetUser ? `Target audience: ${product.targetUser}` : '',
            product.painSolved ? `Problem it solves: ${product.painSolved}` : '',
            product.categories.length ? `Categories: ${product.categories.join(', ')}` : '',
            product.pricingModel ? `Pricing model: ${product.pricingModel}` : '',
            product.platforms.length ? `Platforms: ${product.platforms.join(', ')}` : '',
            product.url ? `Website: ${product.url}` : '',
        ]
            .filter(Boolean)
            .join('\n');
        const prompt = [
            'You are configuring an AI marketing-content generator for ONE specific product or website.',
            'Write a SYSTEM PROMPT (2-4 sentences) that will be prepended to every content-generation task for this product.',
            'Requirements for the system prompt you write:',
            '- Establish a writer persona, voice, and audience that genuinely fit THIS product. Do NOT assume it is a SaaS, software, app, or startup unless the details clearly say so — infer the real industry (e.g. ecommerce, local service, creator, agency, hardware, nonprofit).',
            '- Tell the writer to treat the supplied source as ground truth, preserve concrete product details, avoid generic claims, and match the brand voice profile when present.',
            '- Tell the writer to treat channel-specific format rules, character limits, and output contracts as mandatory, to check them silently, and to return only the finished asset — no process narration, character-count notes, or voice-check preamble.',
            '- Write it in second person, starting with "You are ".',
            'Output ONLY the system prompt text itself. No preamble, no explanation, no markdown, no surrounding quotes.',
            '',
            'Product details:',
            facts,
        ].join('\n');
        const result = await this.complete(prompt, {
            conversationId: `system-prompt:${product.id}`,
            agentId: options?.agentId ?? null,
            cwd: product.repoPath,
            onLog: options?.onLog,
            onToken: options?.onToken,
        });
        const content = sanitizeSystemPrompt(result.content);
        if (!content)
            throw new Error(`${result.provider} did not return a usable system prompt.`);
        return { content, provider: result.provider };
    }
    /**
     * General-purpose prompt completion (no marketing-content scaffolding). Used by
     * AiPageExtractor and other structured-extraction callers. Routes through the
     * same local-CLI-first, cloud-connector-fallback chain as generate().
     */
    async complete(prompt, options) {
        return this.runPrompt(prompt, {
            cwd: options?.cwd ?? null,
            conversationId: options?.conversationId ?? `complete:${Date.now()}`,
            agentId: options?.agentId ?? null,
            webSearch: Boolean(options?.webSearch),
            onLog: options?.onLog,
            onToken: options?.onToken,
        });
    }
    async runPrompt(prompt, opts) {
        const webSearch = Boolean(opts.webSearch);
        if (opts.agentId?.trim()) {
            const localContent = await this.generateWithLocalCli(prompt, opts.cwd, opts.conversationId, opts.agentId, opts.onLog, opts.onToken, webSearch);
            if (localContent)
                return localContent;
            throw new Error(`Selected local CLI "${opts.agentId.trim()}" did not return usable content. Pick another detected CLI or retry after that CLI is available.`);
        }
        const activeRoute = AiProviderService_1.aiProviderService.getActiveRoute();
        if (activeRoute.mode === 'byok') {
            return this.generateWithByok(prompt, opts.conversationId, activeRoute.providerProfileId ?? null, opts.onLog, webSearch);
        }
        if (activeRoute.mode === 'local-cli') {
            const localContent = await this.generateWithLocalCli(prompt, opts.cwd, opts.conversationId, activeRoute.localAgentId ?? null, opts.onLog, opts.onToken, webSearch);
            if (localContent)
                return localContent;
            throw new Error('Selected local CLI did not return usable content. Pick another detected CLI or switch the AI route to BYOK.');
        }
        let localFailure = null;
        let localContent = null;
        try {
            localContent = await this.generateWithLocalCli(prompt, opts.cwd, opts.conversationId, null, opts.onLog, opts.onToken, webSearch);
        }
        catch (error) {
            localFailure = error instanceof Error ? error : new Error('The local AI CLI failed.');
        }
        if (localContent)
            return localContent;
        opts.onLog?.('No local CLI result available; checking enabled BYOK providers...');
        let byokFailure = null;
        try {
            return await this.generateWithByok(prompt, opts.conversationId, null, opts.onLog, webSearch);
        }
        catch (error) {
            byokFailure = error instanceof Error ? error : new Error('The BYOK provider failed.');
        }
        // Prefer the concrete local-provider failure over a secondary missing or
        // failed BYOK fallback. This is the error the user selected and can act on.
        if (localFailure)
            throw localFailure;
        if (byokFailure)
            throw byokFailure;
        throw new Error(`No content generator is available. Install a local CLI agent (Claude Code, Codex, Gemini CLI, OpenCode, Amp, Qwen, Hermes, or Aider), or enable a BYOK AI provider in Settings.`);
    }
    async generateWithByok(prompt, conversationId, profileId, onLog, webSearch = false) {
        const startedAt = Date.now();
        try {
            if (webSearch) {
                onLog?.('Web search enabled for this BYOK run.', 'info', 'websearch');
            }
            const result = await AiProviderService_1.aiProviderService.complete({
                prompt,
                profileId,
                webSearch,
                onToolEvent: (event) => {
                    const kind = event.kind === 'websearch' ? 'websearch' : 'tool';
                    const phase = event.phase ?? phaseFromToolText(event.message);
                    const detail = event.detail ?? detailFromToolText(event.message, phase);
                    const sites = event.sites?.length ? event.sites : sitesFromText(detail ?? event.message);
                    onLog?.(event.message, 'info', kind, {
                        phase,
                        detail,
                        ...(sites?.length ? { sites } : {}),
                    });
                },
            });
            const content = result.content.trim();
            const reportedFailure = (0, aiResponse_1.detectAiResponseFailure)(content);
            if (!content)
                throw new Error(`${result.profile.label} returned an empty response.`);
            if (reportedFailure)
                throw new Error(`${result.profile.label} failed: ${reportedFailure}`);
            if (webSearch && !result.webSearchUsed) {
                onLog?.('Web search was available but the model answered without searching.', 'info', 'websearch');
            }
            onLog?.(`${result.profile.label} returned ${result.content.length.toLocaleString()} characters.`, 'success');
            AiLogService_1.aiLogService.record({
                kind: 'ai',
                agent: result.profile.label,
                tool: result.profile.provider,
                transport: 'byok',
                status: 'success',
                summary: `BYOK ${result.profile.label} · ${result.model} returned ${result.content.length.toLocaleString()} chars${result.webSearchUsed ? ' · web search used' : webSearch ? ' · web search idle' : ''}`,
                detail: `profile=${result.profile.id}\nprovider=${result.profile.provider}\nmodel=${result.model}\nwebSearch=${webSearch ? 'on' : 'off'}\nwebSearchUsed=${result.webSearchUsed ? 'yes' : 'no'}\nworkflow=${conversationId.split(':')[0] ?? ''}`,
                durationMs: Date.now() - startedAt,
                tokensInput: result.tokensInput,
                tokensOutput: result.tokensOutput,
                tokens: result.tokensTotal,
            });
            return { content: result.content, provider: result.provider };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'BYOK provider failed.';
            onLog?.(message, 'error');
            AiLogService_1.aiLogService.record({
                kind: 'ai',
                agent: profileId ? `byok:${profileId}` : 'byok',
                tool: 'byok',
                transport: 'byok',
                status: 'error',
                summary: message,
                detail: `profile=${profileId ?? ''}\nwebSearch=${webSearch ? 'on' : 'off'}\nworkflow=${conversationId.split(':')[0] ?? ''}`,
                durationMs: Date.now() - startedAt,
            });
            throw (error instanceof Error ? error : new Error(message));
        }
    }
}
exports.AIService = AIService;
exports.aiService = new AIService();
//# sourceMappingURL=AIService.js.map