"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiProviderService = exports.AiProviderService = exports.AI_PROVIDER_PRESETS = exports.AI_ACTIVE_ROUTE_SETTINGS_KEY = void 0;
const axios_1 = __importDefault(require("axios"));
const AppRepository_1 = require("./AppRepository");
const CredentialVault_1 = require("./CredentialVault");
exports.AI_ACTIVE_ROUTE_SETTINGS_KEY = 'ai.activeRoute';
exports.AI_PROVIDER_PRESETS = [
    {
        id: 'openai',
        provider: 'openai',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4.1-mini',
        maxTokens: 1600,
        getKeyUrl: 'https://platform.openai.com/api-keys',
        gateway: false,
    },
    {
        id: 'anthropic',
        provider: 'anthropic',
        label: 'Anthropic',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-3-5-haiku-latest',
        maxTokens: 1600,
        getKeyUrl: 'https://console.anthropic.com/settings/keys',
        gateway: false,
    },
    {
        id: 'google_gemini',
        provider: 'google_gemini',
        label: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: 'gemini-2.5-flash',
        maxTokens: 1600,
        getKeyUrl: 'https://aistudio.google.com/app/apikey',
        gateway: false,
    },
    {
        id: 'azure_openai',
        provider: 'azure_openai',
        label: 'Azure OpenAI',
        baseUrl: '',
        defaultModel: '',
        maxTokens: 1600,
        getKeyUrl: 'https://portal.azure.com/',
        gateway: false,
    },
    {
        id: 'openrouter',
        provider: 'openai_compatible',
        label: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        defaultModel: 'openai/gpt-4o-mini',
        maxTokens: 1600,
        getKeyUrl: 'https://openrouter.ai/settings/keys',
        gateway: true,
    },
    {
        id: 'ollama_cloud',
        provider: 'openai_compatible',
        label: 'Ollama Cloud',
        baseUrl: 'https://ollama.com/v1',
        defaultModel: 'gpt-oss:20b',
        maxTokens: 1600,
        getKeyUrl: 'https://ollama.com/settings/keys',
        gateway: true,
    },
    {
        id: 'custom_openai_compatible',
        provider: 'openai_compatible',
        label: 'Custom OpenAI-compatible',
        baseUrl: 'https://api.example.com/v1',
        defaultModel: 'model-id',
        maxTokens: 1600,
        getKeyUrl: null,
        gateway: true,
    },
];
class AiProviderService {
    async list() {
        return {
            presets: exports.AI_PROVIDER_PRESETS,
            profiles: await this.listProfiles(),
            activeRoute: this.getActiveRoute(),
        };
    }
    async listProfiles() {
        const profiles = AppRepository_1.repository.listAiProviderProfiles();
        return Promise.all(profiles.map((profile) => this.withSecretStatus(profile)));
    }
    async getProfile(id) {
        const profile = AppRepository_1.repository.getAiProviderProfile(id);
        return profile ? this.withSecretStatus(profile) : null;
    }
    async saveProfile(input) {
        const profile = AppRepository_1.repository.upsertAiProviderProfile(normalizeProfileInput(input));
        return this.withSecretStatus(profile);
    }
    async deleteProfile(id) {
        const deleted = AppRepository_1.repository.deleteAiProviderProfile(id);
        await CredentialVault_1.credentialVault.removeSecret(secretAccount(id));
        const activeRoute = this.getActiveRoute();
        if (activeRoute.providerProfileId === id) {
            this.setActiveRoute({ mode: 'auto', localAgentId: activeRoute.localAgentId ?? null, providerProfileId: null });
        }
        return { deleted };
    }
    async saveSecret(input) {
        const profile = AppRepository_1.repository.getAiProviderProfile(input.profileId);
        if (!profile)
            throw new Error('AI provider profile not found.');
        const apiKey = input.apiKey.trim();
        if (!apiKey)
            throw new Error('API key is required.');
        await CredentialVault_1.credentialVault.setSecret(secretAccount(profile.id), { apiKey });
        AppRepository_1.repository.updateAiProviderProfileStatus(profile.id, { lastError: null });
        return this.withSecretStatus(AppRepository_1.repository.getAiProviderProfile(profile.id));
    }
    async removeSecret(profileId) {
        const profile = AppRepository_1.repository.getAiProviderProfile(profileId);
        if (!profile)
            throw new Error('AI provider profile not found.');
        await CredentialVault_1.credentialVault.removeSecret(secretAccount(profileId));
        AppRepository_1.repository.updateAiProviderProfileStatus(profileId, { lastTestedAt: null, lastError: null, enabled: false });
        return this.withSecretStatus(AppRepository_1.repository.getAiProviderProfile(profileId));
    }
    getActiveRoute() {
        return normalizeRoute(AppRepository_1.repository.getSetting(exports.AI_ACTIVE_ROUTE_SETTINGS_KEY)?.value);
    }
    setActiveRoute(route) {
        const normalized = normalizeRoute(route);
        AppRepository_1.repository.setSetting(exports.AI_ACTIVE_ROUTE_SETTINGS_KEY, normalized);
        return normalized;
    }
    async test(profileId) {
        const started = Date.now();
        try {
            const result = await this.complete({ profileId, prompt: 'Reply with only: ok', maxTokens: 32 });
            const ok = result.content.trim().length > 0;
            const message = ok ? `Connected to ${result.profile.label}.` : `${result.profile.label} returned an empty response.`;
            const profile = await this.setStatus(profileId, ok ? null : message, ok);
            return { ok, status: profile.status, message, profile };
        }
        catch (error) {
            const message = scrubError(error);
            const profile = await this.setStatus(profileId, message, false, started);
            return { ok: false, status: profile.status, message, profile };
        }
    }
    async complete(input) {
        const profile = await this.resolveProfile(input.profileId ?? null);
        const secret = await this.getSecret(profile.id);
        if (!secret?.apiKey)
            throw new Error(`${profile.label} API key is missing.`);
        const startedProfile = await this.withSecretStatus(profile);
        const model = profile.defaultModel.trim();
        if (!model)
            throw new Error(`${profile.label} model is missing.`);
        const maxTokens = input.maxTokens ?? profile.maxTokens ?? undefined;
        const webSearch = Boolean(input.webSearch);
        if (webSearch && !providerSupportsWebSearch(startedProfile.provider)) {
            throw new Error(`${startedProfile.label} does not support hosted web search. Use OpenAI, Anthropic, or Gemini, or turn web search off.`);
        }
        const result = await completeWithProvider(startedProfile, secret.apiKey, input.prompt, maxTokens, {
            webSearch,
            onToolEvent: input.onToolEvent,
        });
        return {
            content: result.text.trim(),
            provider: `byok:${profile.id}`,
            model,
            profile: startedProfile,
            tokensInput: result.tokensInput ?? null,
            tokensOutput: result.tokensOutput ?? null,
            tokensTotal: result.tokensTotal ?? null,
            webSearchEnabled: webSearch,
            webSearchUsed: result.webSearchUsed ?? false,
        };
    }
    async firstEnabledProfile() {
        const profiles = await this.listProfiles();
        return profiles.find((profile) => profile.enabled && profile.hasSecret) ?? null;
    }
    /** Main-process credential bridge for media profiles linked to a text BYOK profile. */
    async resolveApiKey(profileId) {
        const profile = await this.getProfile(profileId);
        if (!profile?.enabled)
            return null;
        const secret = await this.getSecret(profileId);
        return secret?.apiKey?.trim() || null;
    }
    async resolveProfile(profileId) {
        const profile = profileId
            ? await this.getProfile(profileId)
            : await this.firstEnabledProfile();
        if (!profile)
            throw new Error('No BYOK AI provider is enabled.');
        if (!profile.enabled)
            throw new Error(`${profile.label} is disabled.`);
        if (!profile.hasSecret)
            throw new Error(`${profile.label} API key is missing.`);
        return profile;
    }
    async getSecret(profileId) {
        return CredentialVault_1.credentialVault.getSecret(secretAccount(profileId));
    }
    async withSecretStatus(profile) {
        const hasSecret = await CredentialVault_1.credentialVault.hasSecret(secretAccount(profile.id));
        return {
            ...profile,
            hasSecret,
            status: providerStatus(profile, hasSecret),
        };
    }
    async setStatus(profileId, error, ok, timestamp = Date.now()) {
        const updated = AppRepository_1.repository.updateAiProviderProfileStatus(profileId, {
            lastTestedAt: timestamp,
            lastError: error,
            enabled: ok ? true : undefined,
        });
        if (!updated)
            throw new Error('AI provider profile not found.');
        return this.withSecretStatus(updated);
    }
}
exports.AiProviderService = AiProviderService;
function providerSupportsWebSearch(provider) {
    return provider === 'openai' || provider === 'anthropic' || provider === 'google_gemini';
}
async function completeWithProvider(profile, apiKey, prompt, maxTokens, options = {}) {
    if (profile.provider === 'openai')
        return completeOpenAi(profile, apiKey, prompt, maxTokens, options);
    if (profile.provider === 'anthropic')
        return completeAnthropic(profile, apiKey, prompt, maxTokens, options);
    if (profile.provider === 'google_gemini')
        return completeGemini(profile, apiKey, prompt, maxTokens, options);
    if (profile.provider === 'azure_openai')
        return completeAzureOpenAi(profile, apiKey, prompt, maxTokens);
    return completeOpenAiCompatible(profile, apiKey, prompt, maxTokens);
}
async function completeOpenAi(profile, apiKey, prompt, maxTokens, options = {}) {
    const webSearch = Boolean(options.webSearch);
    const timeout = webSearch ? 120_000 : 45_000;
    const { data } = await axios_1.default.post(joinUrl(profile.baseUrl, 'responses'), {
        model: profile.defaultModel,
        input: prompt,
        temperature: 0.4,
        ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
        ...(webSearch ? { tools: [{ type: 'web_search' }], tool_choice: 'auto' } : {}),
    }, {
        headers: {
            ...headers(profile),
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        timeout,
    });
    const text = (typeof data?.output_text === 'string' ? data.output_text : '') ||
        (Array.isArray(data?.output)
            ? data.output
                .flatMap((item) => item?.content ?? [])
                .map((part) => (typeof part?.text === 'string' ? part.text : part?.type === 'output_text' ? String(part?.text ?? '') : ''))
                .join('\n')
            : '');
    const webSearchUsed = emitOpenAiWebSearchEvents(data, options.onToolEvent);
    return {
        text,
        tokensInput: numberOrNull(data?.usage?.input_tokens),
        tokensOutput: numberOrNull(data?.usage?.output_tokens),
        tokensTotal: numberOrNull(data?.usage?.total_tokens),
        webSearchUsed,
    };
}
async function completeOpenAiCompatible(profile, apiKey, prompt, maxTokens) {
    const { data } = await axios_1.default.post(joinUrl(profile.baseUrl, 'chat/completions'), {
        model: profile.defaultModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }, {
        headers: {
            ...headers(profile),
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        timeout: 45_000,
    });
    const text = String(data?.choices?.[0]?.message?.content ?? '');
    return {
        text,
        tokensInput: numberOrNull(data?.usage?.prompt_tokens),
        tokensOutput: numberOrNull(data?.usage?.completion_tokens),
        tokensTotal: numberOrNull(data?.usage?.total_tokens),
        webSearchUsed: false,
    };
}
async function completeAnthropic(profile, apiKey, prompt, maxTokens, options = {}) {
    const webSearch = Boolean(options.webSearch);
    const timeout = webSearch ? 120_000 : 45_000;
    const { data } = await axios_1.default.post(joinUrl(profile.baseUrl, 'v1/messages'), {
        model: profile.defaultModel,
        max_tokens: maxTokens ?? 1600,
        messages: [{ role: 'user', content: prompt }],
        ...(webSearch
            ? {
                tools: [
                    {
                        type: anthropicWebSearchToolType(profile.defaultModel),
                        name: 'web_search',
                        max_uses: 3,
                    },
                ],
            }
            : {}),
    }, {
        headers: {
            ...headers(profile),
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
        },
        timeout,
    });
    const text = Array.isArray(data?.content)
        ? data.content.map((part) => (part?.type === 'text' ? part.text : '')).join('\n')
        : '';
    const webSearchUsed = emitAnthropicWebSearchEvents(data, options.onToolEvent);
    return {
        text,
        tokensInput: numberOrNull(data?.usage?.input_tokens),
        tokensOutput: numberOrNull(data?.usage?.output_tokens),
        tokensTotal: null,
        webSearchUsed,
    };
}
async function completeGemini(profile, apiKey, prompt, maxTokens, options = {}) {
    const webSearch = Boolean(options.webSearch);
    const timeout = webSearch ? 120_000 : 45_000;
    const url = `${joinUrl(profile.baseUrl, `models/${encodeURIComponent(profile.defaultModel)}:generateContent`)}?key=${encodeURIComponent(apiKey)}`;
    const { data } = await axios_1.default.post(url, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4,
            ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        },
        ...(webSearch ? { tools: [{ google_search: {} }] } : {}),
    }, {
        headers: {
            ...headers(profile),
            'Content-Type': 'application/json',
        },
        timeout,
    });
    const text = Array.isArray(data?.candidates)
        ? data.candidates
            .flatMap((candidate) => candidate?.content?.parts ?? [])
            .map((part) => (typeof part?.text === 'string' ? part.text : ''))
            .join('\n')
        : '';
    const webSearchUsed = emitGeminiWebSearchEvents(data, options.onToolEvent);
    return {
        text,
        tokensInput: numberOrNull(data?.usageMetadata?.promptTokenCount),
        tokensOutput: numberOrNull(data?.usageMetadata?.candidatesTokenCount),
        tokensTotal: numberOrNull(data?.usageMetadata?.totalTokenCount),
        webSearchUsed,
    };
}
async function completeAzureOpenAi(profile, apiKey, prompt, maxTokens) {
    const base = profile.baseUrl.trim();
    if (!base)
        throw new Error('Azure OpenAI endpoint is required.');
    const endpoint = /\/chat\/completions/i.test(base)
        ? base
        : `${base.replace(/\/$/, '')}/openai/deployments/${encodeURIComponent(profile.defaultModel)}/chat/completions?api-version=2024-10-21`;
    const { data } = await axios_1.default.post(endpoint, {
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
    }, {
        headers: {
            ...headers(profile),
            'api-key': apiKey,
            'Content-Type': 'application/json',
        },
        timeout: 45_000,
    });
    const text = String(data?.choices?.[0]?.message?.content ?? '');
    return {
        text,
        tokensInput: numberOrNull(data?.usage?.prompt_tokens),
        tokensOutput: numberOrNull(data?.usage?.completion_tokens),
        tokensTotal: numberOrNull(data?.usage?.total_tokens),
        webSearchUsed: false,
    };
}
/** Newer Claude models prefer the 20260209 web_search tool type; older ones use 20250305. */
function anthropicWebSearchToolType(model) {
    const id = model.toLowerCase();
    if (/opus-4-6|sonnet-4-6|sonnet-5|opus-4\.6|sonnet-4\.6|claude-opus-4-6|claude-sonnet-4-6|claude-sonnet-5/.test(id) ||
        /20260209/.test(id)) {
        return 'web_search_20260209';
    }
    return 'web_search_20250305';
}
function emitOpenAiWebSearchEvents(data, onToolEvent) {
    if (!Array.isArray(data?.output))
        return false;
    let used = false;
    for (const item of data.output) {
        if (item?.type !== 'web_search_call')
            continue;
        used = true;
        const action = item?.action && typeof item.action === 'object' ? item.action : null;
        const actionType = typeof action?.type === 'string' ? action.type : 'search';
        const query = typeof action?.query === 'string'
            ? action.query
            : Array.isArray(action?.queries)
                ? action.queries.filter((entry) => typeof entry === 'string').join('; ')
                : '';
        const status = typeof item?.status === 'string' ? item.status : 'completed';
        if (query) {
            onToolEvent?.({
                kind: 'websearch',
                phase: 'query',
                message: `Search: ${query}`,
                detail: query,
            });
        }
        else if (actionType === 'open_page') {
            onToolEvent?.({
                kind: 'websearch',
                phase: 'status',
                message: 'Web search · opened a page',
                detail: actionType,
            });
        }
        else if (actionType === 'find_in_page') {
            onToolEvent?.({
                kind: 'websearch',
                phase: 'status',
                message: 'Web search · scanned a page',
                detail: actionType,
            });
        }
        else {
            onToolEvent?.({
                kind: 'websearch',
                phase: 'status',
                message: status === 'completed' ? 'Web search · completed' : `Web search · ${status}`,
                detail: actionType,
            });
        }
        // Surface any source URLs attached to the search call.
        const sourceSites = Array.isArray(action?.sources)
            ? action.sources
                .map((source) => {
                const title = typeof source?.title === 'string' ? source.title : undefined;
                const url = typeof source?.url === 'string' ? source.url : null;
                return url ? { url, ...(title ? { title } : {}) } : null;
            })
                .filter(Boolean)
            : [];
        if (sourceSites.length) {
            onToolEvent?.({
                kind: 'websearch',
                phase: 'result',
                message: `Results: ${sourceSites.length} site${sourceSites.length === 1 ? '' : 's'}`,
                detail: sourceSites
                    .map((site) => (site.title ? `${site.title} — ${site.url}` : site.url))
                    .join('\n'),
                sites: sourceSites,
            });
        }
    }
    // Citations on the message content are also results.
    for (const item of data.output) {
        if (item?.type !== 'message')
            continue;
        const annotations = Array.isArray(item?.content)
            ? item.content.flatMap((part) => (Array.isArray(part?.annotations) ? part.annotations : []))
            : [];
        const citationSites = annotations
            .filter((ann) => ann?.type === 'url_citation' && typeof ann?.url === 'string')
            .map((ann) => ({
            url: String(ann.url),
            ...(typeof ann.title === 'string' ? { title: ann.title } : {}),
        }));
        if (citationSites.length) {
            used = true;
            onToolEvent?.({
                kind: 'websearch',
                phase: 'result',
                message: `Results: ${citationSites.length} site${citationSites.length === 1 ? '' : 's'}`,
                detail: citationSites
                    .map((site) => site.title ? `${site.title} — ${site.url}` : site.url)
                    .join('\n'),
                sites: citationSites,
            });
        }
    }
    return used;
}
function emitAnthropicWebSearchEvents(data, onToolEvent) {
    if (!Array.isArray(data?.content))
        return false;
    let used = false;
    for (const part of data.content) {
        const type = typeof part?.type === 'string' ? part.type : '';
        if (type === 'server_tool_use' && (part?.name === 'web_search' || String(part?.name ?? '').includes('web_search'))) {
            used = true;
            const query = typeof part?.input?.query === 'string'
                ? part.input.query
                : typeof part?.input?.q === 'string'
                    ? part.input.q
                    : '';
            onToolEvent?.({
                kind: 'websearch',
                phase: query ? 'query' : 'status',
                message: query ? `Search: ${query}` : 'Web search tool called',
                detail: query || undefined,
            });
            continue;
        }
        if (type === 'web_search_tool_result') {
            used = true;
            const items = Array.isArray(part?.content) ? part.content : [];
            const sites = items
                .map((entry) => {
                if (!entry || typeof entry !== 'object')
                    return null;
                // Anthropic result items are often { type, title, url, ... } or nested content blocks.
                const title = typeof entry.title === 'string'
                    ? entry.title
                    : typeof entry?.content?.title === 'string'
                        ? entry.content.title
                        : undefined;
                const url = typeof entry.url === 'string'
                    ? entry.url
                    : typeof entry?.content?.url === 'string'
                        ? entry.content.url
                        : null;
                if (!url)
                    return null;
                return { url, ...(title ? { title } : {}) };
            })
                .filter(Boolean);
            const lines = sites.map((site) => (site.title ? `${site.title} — ${site.url}` : site.url));
            onToolEvent?.({
                kind: 'websearch',
                phase: 'result',
                message: sites.length
                    ? `Results: ${sites.length} site${sites.length === 1 ? '' : 's'}`
                    : items.length
                        ? `Results: ${items.length} source${items.length === 1 ? '' : 's'}`
                        : 'Results: web search completed',
                detail: lines.length ? lines.join('\n') : undefined,
                ...(sites.length ? { sites } : {}),
            });
        }
    }
    return used;
}
function emitGeminiWebSearchEvents(data, onToolEvent) {
    if (!Array.isArray(data?.candidates))
        return false;
    let used = false;
    for (const candidate of data.candidates) {
        const chunks = candidate?.groundingMetadata?.groundingChunks;
        const queries = candidate?.groundingMetadata?.webSearchQueries;
        const supports = candidate?.groundingMetadata?.groundingSupports;
        if (Array.isArray(queries) && queries.length) {
            used = true;
            for (const query of queries) {
                if (typeof query !== 'string' || !query.trim())
                    continue;
                onToolEvent?.({
                    kind: 'websearch',
                    phase: 'query',
                    message: `Search: ${query.trim()}`,
                    detail: query.trim(),
                });
            }
        }
        if (Array.isArray(chunks) && chunks.length) {
            used = true;
            const sites = chunks
                .map((chunk) => {
                const title = typeof chunk?.web?.title === 'string' ? chunk.web.title : undefined;
                const url = typeof chunk?.web?.uri === 'string' ? chunk.web.uri : null;
                return url ? { url, ...(title ? { title } : {}) } : null;
            })
                .filter(Boolean);
            const lines = sites.map((site) => (site.title ? `${site.title} — ${site.url}` : site.url));
            onToolEvent?.({
                kind: 'websearch',
                phase: 'result',
                message: sites.length
                    ? `Results: ${sites.length} site${sites.length === 1 ? '' : 's'}`
                    : `Results: ${chunks.length} source${chunks.length === 1 ? '' : 's'}`,
                detail: lines.length ? lines.join('\n') : undefined,
                ...(sites.length ? { sites } : {}),
            });
        }
        else if (Array.isArray(supports) && supports.length) {
            used = true;
            onToolEvent?.({
                kind: 'websearch',
                phase: 'result',
                message: 'Results: web search grounding applied',
            });
        }
    }
    return used;
}
function providerStatus(profile, hasSecret) {
    if (!hasSecret)
        return 'not_configured';
    if (profile.lastError)
        return 'error';
    if (profile.lastTestedAt)
        return 'connected';
    return 'attention';
}
function normalizeProfileInput(input) {
    const preset = presetFor(input.provider, input.gatewayPreset ?? null);
    return {
        ...input,
        provider: input.provider,
        label: input.label?.trim() || preset?.label || null,
        baseUrl: input.baseUrl?.trim() || preset?.baseUrl || null,
        defaultModel: input.defaultModel?.trim() || preset?.defaultModel || null,
        memoryModel: input.memoryModel?.trim() || null,
        maxTokens: input.maxTokens && input.maxTokens > 0 ? Math.round(input.maxTokens) : null,
        headers: input.headers ?? {},
    };
}
function normalizeRoute(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const mode = raw.mode === 'local-cli' || raw.mode === 'byok' ? raw.mode : 'auto';
    return {
        mode,
        localAgentId: typeof raw.localAgentId === 'string' && raw.localAgentId.trim() ? raw.localAgentId.trim() : null,
        providerProfileId: typeof raw.providerProfileId === 'string' && raw.providerProfileId.trim() ? raw.providerProfileId.trim() : null,
    };
}
function presetFor(provider, gatewayPreset) {
    return (exports.AI_PROVIDER_PRESETS.find((preset) => preset.provider === provider && preset.id === gatewayPreset) ??
        exports.AI_PROVIDER_PRESETS.find((preset) => preset.provider === provider) ??
        null);
}
function headers(profile) {
    return Object.fromEntries(Object.entries(profile.headers ?? {}).filter(([key, value]) => key.trim() && String(value).trim()));
}
function joinUrl(baseUrl, path) {
    const base = baseUrl.replace(/\/+$/, '');
    const suffix = path.replace(/^\/+/, '');
    return `${base}/${suffix}`;
}
function secretAccount(profileId) {
    return `ai_provider:${profileId}`;
}
function numberOrNull(value) {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : null;
}
function scrubError(error) {
    if (axios_1.default.isAxiosError(error)) {
        const status = error.response?.status;
        const message = typeof error.response?.data?.error?.message === 'string'
            ? error.response.data.error.message
            : typeof error.response?.data?.message === 'string'
                ? error.response.data.message
                : error.message;
        return `${status ? `HTTP ${status}: ` : ''}${redactSecrets(message)}`;
    }
    return redactSecrets(error instanceof Error ? error.message : String(error));
}
function redactSecrets(value) {
    return value
        .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-...')
        .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-...')
        .replace(/AIza[A-Za-z0-9_-]{8,}/g, 'AIza...');
}
exports.aiProviderService = new AiProviderService();
//# sourceMappingURL=AiProviderService.js.map