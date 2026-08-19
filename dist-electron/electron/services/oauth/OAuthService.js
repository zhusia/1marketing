"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.oauthService = void 0;
const electron_1 = require("electron");
const axios_1 = __importDefault(require("axios"));
const channels_1 = require("../../ipc/channels");
const CredentialVault_1 = require("../CredentialVault");
const AppRepository_1 = require("../AppRepository");
const pkce_1 = require("./pkce");
const providers_1 = require("./providers");
const OAuthCallbackServer_1 = require("./OAuthCallbackServer");
const browserLaunch_1 = require("./browserLaunch");
/** How long a started Connect stays completable via the manual paste-URL fallback. Bounds the window
 *  in which a captured code+state could be replayed, and stops old PKCE verifiers lingering in memory
 *  indefinitely. Comfortably longer than the loopback listener's own 5-minute wait. */
const PENDING_TTL_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;
const SHORT_LIVED_UPGRADE_WINDOW_MS = 48 * HOUR_MS;
const META_LONG_LIVED_FALLBACK_SECONDS = 60 * 24 * 60 * 60;
class OAuthService {
    /** Per-channel context for the most recent Connect, enabling the manual paste-URL fallback. */
    pending = new Map();
    /** Deduplicates the status + capability checks that can both try to upgrade the same legacy token. */
    longLivedUpgradeAttempts = new Map();
    /** The loopback listener for the currently in-flight Connect. Held so a retry or an explicit
     *  cancel can free the fixed port 53682 instead of leaving it bound for the 5-minute timeout —
     *  the cause of the "Port 53682 is already in use" trap that forced an app restart. */
    active = null;
    /** Run the full browser auth flow: open the system browser, capture the code, exchange + persist tokens. */
    async startAuth(name, additionalScopes = []) {
        const provider = (0, providers_1.oauthProvider)(name);
        if (!provider)
            return { ok: false, username: null, message: `${name} is not an OAuth2 channel.` };
        const allowedOptionalScopes = new Set(provider.optionalScopes ?? []);
        const requestedOptionalScopes = Array.from(new Set(additionalScopes.map((scope) => scope.trim()).filter(Boolean)));
        const unsupportedScopes = requestedOptionalScopes.filter((scope) => !allowedOptionalScopes.has(scope));
        if (unsupportedScopes.length) {
            return {
                ok: false,
                username: null,
                message: `Unsupported optional permission request: ${unsupportedScopes.join(', ')}.`,
            };
        }
        const secret = (await CredentialVault_1.credentialVault.getSecret(name)) ?? {};
        const hadConnection = Boolean(secret.oauth?.accessToken);
        const previouslyGrantedOptionalScopes = (secret.oauth?.scope ?? '')
            .split(/[\s,]+/)
            .filter((scope) => allowedOptionalScopes.has(scope));
        // During a feature upgrade, carry already-granted optional scopes so a second optional step does
        // not replace the first. A routine channel reconnect deliberately stays base-only: if a provider
        // later removes/restricts an analytics permission, publishing must still be able to reconnect.
        const scopes = Array.from(new Set([
            ...provider.scopes,
            ...(requestedOptionalScopes.length ? previouslyGrantedOptionalScopes : []),
            ...requestedOptionalScopes,
        ]));
        const { clientId, clientSecret } = this.resolveClientCreds(provider, secret);
        if (!clientId) {
            return {
                ok: false,
                username: null,
                // Hosted/relay clients have no BYO field to fill — an empty id means the build shipped without
                // creds (e.g. MARKETING_THREADS_CLIENT_ID unset). Don't open a doomed authorize URL: Threads
                // answers an invalid client_id with an opaque "An unknown error has occurred." (error_code 1).
                message: provider.hosted
                    ? 'Google sign-in isn’t configured in this build.'
                    : provider.relay
                        ? `${this.channelLabel(name)} isn’t configured in this build (missing app id).`
                        : 'Paste your Client ID and Save before connecting.',
            };
        }
        // Pick the redirect URI: relay → the relay's HTTPS callback; httpsRedirect BYO providers
        // (Facebook/Pinterest, which reject loopback) → the hosted bounce; everything else → loopback.
        // Whichever it is flows to BOTH the authorize URL and the token exchange (they must match).
        const redirectUri = provider.relay
            ? this.relayCallback(provider)
            : provider.httpsRedirect
                ? providers_1.HOSTED_BOUNCE_URL
                : OAuthCallbackServer_1.OAUTH_REDIRECT_URI;
        const pkce = (0, pkce_1.generatePkce)();
        const state = (0, pkce_1.randomState)();
        const authUrl = this.buildAuthUrl(provider, clientId, state, pkce.challenge, redirectUri, scopes);
        // Self-heal the "Port 53682 already in use" trap: abort any prior in-flight attempt (the user
        // closed the browser and clicked Connect again) so the fixed loopback port is free to rebind.
        this.active?.cancel();
        this.active = null;
        const server = new OAuthCallbackServer_1.OAuthCallbackServer();
        try {
            await server.start();
        }
        catch (error) {
            return {
                ok: false,
                username: null,
                message: error instanceof Error ? error.message : 'Could not start OAuth listener.',
                authUrl: null,
            };
        }
        this.active = server;
        // Remember this attempt so completeAuth() can finish it if the loopback never fires. Left in
        // place on failure/timeout (so the user can still paste the URL); cleared only once tokens land.
        this.pending.set(name, {
            state,
            verifier: pkce.verifier,
            clientId,
            redirectUri,
            authUrl,
            scopes,
            createdAt: Date.now(),
        });
        // Push the URL to the renderer so it can offer the "open in <browser> / copy link" chooser.
        // We deliberately do NOT auto-open a browser here: the OS default is often signed into the
        // wrong account/profile (the provider then fails with an opaque error), so the user picks.
        this.broadcastAuthUrl(name, authUrl);
        try {
            const code = await server.waitForCode(state);
            return await this.finalize(provider, name, secret, clientId, clientSecret, code, pkce.verifier, redirectUri, scopes);
        }
        catch (error) {
            server.close();
            if (this.active === server)
                this.active = null;
            const message = error instanceof Error ? error.message : 'Authorization failed.';
            // A cancel (self-heal on retry, or the user aborting) is not a failure worth flagging — the
            // connector keeps its previous status and the UI just resets.
            if (message === OAuthCallbackServer_1.OAUTH_CANCELLED) {
                return { ok: false, username: null, message: 'Connection cancelled.', authUrl };
            }
            // A failed optional upgrade must not poison a working publisher. The previous token is still
            // in the vault because finalize() only replaces it after a successful exchange.
            if (!hadConnection)
                AppRepository_1.repository.updateConnector({ name, status: 'attention', lastError: message });
            return {
                ok: false,
                username: null,
                message: hadConnection ? `${message} Your existing publishing connection was kept.` : message,
                authUrl,
            };
        }
    }
    /** Abort an in-flight browser auth (the user closed the dialog or hit Cancel) and free the
     *  loopback port right away. The pending context is kept so a manual paste can still finish it. */
    async cancelAuth(_name) {
        this.active?.cancel();
        this.active = null;
        return { ok: true };
    }
    /** Open the in-flight authorization URL in a chosen browser (or the OS default when browserId is
     *  omitted). Requires a Connect to be in progress so we hold the URL that matches the listener. */
    async openAuthUrl(name, browserId) {
        const pending = this.pending.get(name);
        if (!pending) {
            return { ok: false, message: 'No connect in progress — click Connect first.' };
        }
        await (0, browserLaunch_1.openInBrowser)(pending.authUrl, browserId ?? null);
        return { ok: true, message: 'Opening your browser…' };
    }
    /** Browsers installed on this machine, so the UI can offer "Open with <browser>". */
    listBrowsers() {
        return (0, browserLaunch_1.detectBrowsers)();
    }
    broadcastAuthUrl(name, url) {
        for (const win of electron_1.BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed())
                win.webContents.send(channels_1.CHANNELS.CONNECTORS_OAUTH_URL, { name, url });
        }
    }
    /**
     * Fallback for when the loopback listener missed the redirect: the user pastes the full
     * `http://127.0.0.1:53682/callback?code=…&state=…` URL and we finish the exchange. Requires a
     * Connect to have been started this session (so we hold the matching state + PKCE verifier).
     */
    async completeAuth(name, redirectedUrl) {
        const provider = (0, providers_1.oauthProvider)(name);
        if (!provider)
            return { ok: false, username: null, message: `${name} is not an OAuth2 channel.` };
        const pending = this.pending.get(name);
        if (!pending) {
            if ((await this.status(name)).connected) {
                return { ok: true, username: null, message: 'Already connected.' };
            }
            return {
                ok: false,
                username: null,
                message: 'No connect in progress — click Connect first, then paste the redirected URL.',
            };
        }
        // Expire a stale attempt: a leaked code+state can only be replayed within this window, and old
        // PKCE verifiers don't linger in memory. The loopback listener's own 5-min wait is well inside it.
        if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
            this.pending.delete(name);
            this.active?.cancel();
            this.active = null;
            return {
                ok: false,
                username: null,
                message: 'This connect attempt expired — click Connect again, then paste the redirected URL.',
            };
        }
        let parsed;
        try {
            parsed = new URL(redirectedUrl.trim());
        }
        catch {
            return {
                ok: false,
                username: null,
                message: 'That is not a valid URL — paste the whole http://127.0.0.1:53682/callback?… address.',
            };
        }
        // Only accept a code from an origin we actually sent the user to — the loopback callback, or the
        // redirect this attempt used (the hosted bounce for Facebook/Instagram/Pinterest). Rejects a code
        // pasted from any other origin (e.g. a look-alike page), on top of the state check below.
        const expectedOrigins = new Set();
        for (const uri of [OAuthCallbackServer_1.OAUTH_REDIRECT_URI, pending.redirectUri]) {
            try {
                expectedOrigins.add(new URL(uri).origin);
            }
            catch {
                /* skip an unparseable redirect */
            }
        }
        if (!expectedOrigins.has(parsed.origin)) {
            return {
                ok: false,
                username: null,
                message: 'That URL isn’t from the sign-in redirect — paste the http://127.0.0.1:53682/callback?… address you landed on.',
            };
        }
        const error = parsed.searchParams.get('error');
        const errorDescription = parsed.searchParams.get('error_description');
        if (error) {
            return {
                ok: false,
                username: null,
                message: `Authorization failed: ${errorDescription ? `${error} — ${errorDescription}` : error}`,
            };
        }
        const code = parsed.searchParams.get('code');
        const state = parsed.searchParams.get('state');
        if (!code) {
            return { ok: false, username: null, message: 'That URL has no ?code= value — copy the full address you landed on.' };
        }
        if (state !== pending.state) {
            return {
                ok: false,
                username: null,
                message: 'State mismatch — paste the URL from the latest Connect attempt, or click Connect again.',
            };
        }
        try {
            const secret = (await CredentialVault_1.credentialVault.getSecret(name)) ?? {};
            const { clientSecret } = this.resolveClientCreds(provider, secret);
            return await this.finalize(provider, name, secret, pending.clientId, clientSecret, code, pending.verifier, pending.redirectUri, pending.scopes);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Token exchange failed.';
            const existing = (await CredentialVault_1.credentialVault.getSecret(name)) ?? {};
            const hadConnection = Boolean(existing.oauth?.accessToken);
            if (!hadConnection)
                AppRepository_1.repository.updateConnector({ name, status: 'attention', lastError: message });
            return {
                ok: false,
                username: null,
                message: hadConnection ? `${message} Your existing publishing connection was kept.` : message,
            };
        }
    }
    /** Exchange the code, persist tokens, mark the connector connected, and clear the pending attempt. */
    async finalize(provider, name, secret, clientId, clientSecret, code, verifier, redirectUri, scopes) {
        const tokens = await this.exchangeCode(provider, clientId, clientSecret, code, verifier, redirectUri, scopes);
        // Persist only the connector's OWN secret plus the fresh tokens — we never copy a fallback app's
        // creds into this connector's vault entry (Instagram keeps a single source of truth: Facebook's).
        await CredentialVault_1.credentialVault.setSecret(name, { ...secret, oauth: tokens });
        const username = await this.fetchUsername(provider, tokens.accessToken).catch(() => null);
        // The connector now holds a usable secret (the OAuth tokens) even if no other secret was saved
        // first — important for hosted providers (e.g. Google sign-in) that have no prior Save step.
        AppRepository_1.repository.updateConnector({ name, status: 'connected', hasSecret: true, lastError: null, lastTestedAt: Date.now() });
        // Release the loopback listener if one is still bound (e.g. finished via manual paste while the
        // server was also waiting) — cancel() is a no-op once the server has already settled.
        this.active?.cancel();
        this.active = null;
        this.pending.delete(name);
        return { ok: true, username, message: username ? `Connected as ${this.handle(username)}.` : 'Connected.' };
    }
    /** Return a valid access token, refreshing first if it is expired or about to expire. */
    async ensureFreshToken(name) {
        const provider = (0, providers_1.oauthProvider)(name);
        if (!provider)
            throw new Error(`${name} is not an OAuth2 channel.`);
        const secret = (await CredentialVault_1.credentialVault.getSecret(name)) ?? {};
        let tokens = secret.oauth;
        if (!tokens?.accessToken) {
            throw new Error(`${provider.name} is not connected — open the channel settings and click "Connect".`);
        }
        tokens = await this.maybeUpgradeShortLivedToken(name, provider, secret, tokens);
        if (tokens.expiresAt - Date.now() > 60_000)
            return tokens.accessToken;
        // Relay providers refresh through the relay (which holds the secret). Facebook re-runs its
        // long-lived exchange on the current token, so it needs no classic refresh_token.
        if (provider.relay) {
            const refreshed = await this.refreshViaRelay(provider, tokens);
            await CredentialVault_1.credentialVault.setSecret(name, { ...secret, oauth: refreshed });
            return refreshed.accessToken;
        }
        if (!tokens.refreshToken) {
            throw new Error(`${provider.name} session expired — open the channel settings and click "Connect" to re-authorize.`);
        }
        const { clientId, clientSecret } = this.resolveClientCreds(provider, secret);
        const refreshed = await this.refresh(provider, clientId, clientSecret, tokens.refreshToken, tokens.scope);
        await CredentialVault_1.credentialVault.setSecret(name, { ...secret, oauth: refreshed });
        return refreshed.accessToken;
    }
    async status(name) {
        const secret = (await CredentialVault_1.credentialVault.getSecret(name)) ?? {};
        const provider = (0, providers_1.oauthProvider)(name);
        let tokens = secret.oauth;
        if (tokens && provider) {
            tokens = await this.maybeUpgradeShortLivedToken(name, provider, secret, tokens);
        }
        return {
            connected: Boolean(tokens?.accessToken),
            expiresAt: tokens?.expiresAt ?? null,
            scope: tokens?.scope ?? null,
            autoRenews: Boolean(tokens?.refreshToken) || Boolean(provider?.relay),
        };
    }
    async revoke(name) {
        const secret = (await CredentialVault_1.credentialVault.getSecret(name)) ?? {};
        delete secret.oauth;
        await CredentialVault_1.credentialVault.setSecret(name, secret);
        AppRepository_1.repository.updateConnector({ name, status: 'attention', lastError: null });
        return { ok: true };
    }
    buildAuthUrl(provider, clientId, state, challenge, redirectUri, scopes) {
        const params = new URLSearchParams({
            response_type: 'code',
            state,
            redirect_uri: redirectUri,
            scope: scopes.join(provider.scopeSeparator ?? ' '),
        });
        params.set(provider.clientIdParam ?? 'client_id', clientId);
        if (provider.usePkce !== false) {
            params.set('code_challenge', challenge);
            params.set('code_challenge_method', 'S256');
        }
        for (const [key, value] of Object.entries(provider.extraAuthParams ?? {}))
            params.set(key, value);
        return `${provider.authorizeUrl}?${params.toString()}`;
    }
    async exchangeCode(provider, clientId, clientSecret, code, verifier, redirectUri, scopes) {
        const requestedScope = scopes.join(' ');
        // Relay providers exchange the code at the relay (which adds the client secret), not the platform.
        if (provider.relay) {
            try {
                const { data } = await axios_1.default.post(`${provider.relay.base.replace(/\/+$/, '')}/oauth/${provider.name}/token`, { code, code_verifier: provider.usePkce !== false ? verifier : undefined, redirect_uri: redirectUri }, { timeout: 30_000 });
                return this.tokensFromResponse(data, null, requestedScope);
            }
            catch (error) {
                throw this.tokenError(error);
            }
        }
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
        });
        if (provider.usePkce !== false)
            body.set('code_verifier', verifier);
        try {
            // tokenHeaders() mutates `body` (adds client_id/client_secret for clientAuth: 'body'), so it
            // MUST run before body.toString() — keep it on its own line, not inline in the axios args.
            const headers = this.tokenHeaders(provider, clientId, clientSecret, body);
            const { data } = await axios_1.default.post(provider.tokenUrl, body.toString(), { headers, timeout: 20_000 });
            const tokens = this.tokensFromResponse(data, null, requestedScope);
            // Facebook/Threads code exchange returns a SHORT-lived (~1-2h) token — swap it for the ~60-day
            // long-lived one (still BYO: signed with the user's own app secret, no browser round-trip).
            if (provider.longLived) {
                return await this.extendToLongLivedToken(provider, clientId, clientSecret, tokens.accessToken, tokens.scope || requestedScope);
            }
            return tokens;
        }
        catch (error) {
            throw this.tokenError(error);
        }
    }
    /**
     * Trade a short-lived user token for a ~60-day long-lived one via the provider's `longLived` GET
     * exchange — Facebook's `fb_exchange_token` or Threads' `th_exchange_token`. No refresh_token exists
     * for these; when the long-lived token lapses the user reconnects (the days-left badge counts down to
     * it). Facebook's publisher then derives a non-expiring Page token via /me/accounts at publish time.
     */
    async extendToLongLivedToken(provider, clientId, clientSecret, shortLivedToken, scope) {
        const ll = provider.longLived;
        const params = new URLSearchParams({ grant_type: ll.grantType, client_secret: clientSecret });
        if (ll.sendClientId)
            params.set('client_id', clientId);
        params.set(ll.tokenParam, shortLivedToken);
        try {
            const { data } = await axios_1.default.get(`${ll.url}?${params.toString()}`, { timeout: 20_000 });
            // Meta's long-lived exchange omits `scope`; carry the code-exchange grant forward so the
            // capability layer can accurately distinguish publisher access from optional analytics.
            return this.tokensFromResponse(data, null, scope, META_LONG_LIVED_FALLBACK_SECONDS);
        }
        catch (error) {
            throw this.tokenError(error);
        }
    }
    /**
     * Tokens saved before the long-lived Meta exchange was introduced can still contain the original
     * ~1-hour token. Upgrade those while they are valid, and keep the existing token untouched if Meta
     * rejects the exchange. A genuinely long-lived token only enters this path in its final 48 hours;
     * the exchange is harmless there and the UI still shows the original reconnect deadline unless
     * Meta actually returns a later one.
     */
    async maybeUpgradeShortLivedToken(name, provider, secret, tokens) {
        const remainingMs = tokens.expiresAt - Date.now();
        if (!provider.longLived || remainingMs <= 0 || remainingMs > SHORT_LIVED_UPGRADE_WINDOW_MS)
            return tokens;
        const inFlight = this.longLivedUpgradeAttempts.get(name);
        if (inFlight)
            return inFlight;
        const attempt = (async () => {
            const { clientId, clientSecret } = this.resolveClientCreds(provider, secret);
            if (!clientSecret)
                return tokens;
            // Pre-upgrade vault entries have no `scope`; the original authorization requested the
            // provider's base scopes, so carry those forward instead of persisting an undefined value.
            const tokenScope = typeof tokens.scope === 'string' && tokens.scope.trim() ? tokens.scope : provider.scopes.join(' ');
            try {
                const extended = await this.extendToLongLivedToken(provider, clientId, clientSecret, tokens.accessToken, tokenScope);
                if (extended.expiresAt <= tokens.expiresAt)
                    return tokens;
                // Do not let a status check overwrite credentials or a newer token saved by a concurrent
                // Connect. Re-read the vault immediately before committing the upgraded token.
                const latest = (await CredentialVault_1.credentialVault.getSecret(name)) ?? secret;
                if (latest.oauth?.accessToken && latest.oauth.accessToken !== tokens.accessToken)
                    return latest.oauth;
                await CredentialVault_1.credentialVault.setSecret(name, { ...latest, oauth: extended });
                return extended;
            }
            catch {
                return tokens;
            }
        })();
        this.longLivedUpgradeAttempts.set(name, attempt);
        try {
            return await attempt;
        }
        finally {
            if (this.longLivedUpgradeAttempts.get(name) === attempt)
                this.longLivedUpgradeAttempts.delete(name);
        }
    }
    /**
     * Turn an axios failure from a token endpoint into a useful message. OAuth providers return the
     * real reason in the JSON body (`{error, error_description}`) with a 400/401 — axios only exposes
     * "Request failed with status code 400", so we dig the body out.
     */
    tokenError(error) {
        if (axios_1.default.isAxiosError(error)) {
            const data = error.response?.data;
            if (data && typeof data === 'object') {
                const body = data;
                const code = typeof body.error === 'string' ? body.error : null;
                const desc = typeof body.error_description === 'string'
                    ? body.error_description
                    : typeof body.message === 'string'
                        ? body.message
                        : null;
                if (code || desc)
                    return new Error([code, desc].filter(Boolean).join(' — '));
            }
            if (typeof data === 'string' && data.trim())
                return new Error(data.trim().slice(0, 300));
            if (error.response)
                return new Error(`Token endpoint returned HTTP ${error.response.status}.`);
        }
        return error instanceof Error ? error : new Error('Token exchange failed.');
    }
    async refreshViaRelay(provider, tokens) {
        const base = provider.relay.base.replace(/\/+$/, '');
        try {
            const { data } = await axios_1.default.post(`${base}/oauth/${provider.name}/refresh`, { refresh_token: tokens.refreshToken, access_token: tokens.accessToken }, { timeout: 30_000 });
            return this.tokensFromResponse(data, tokens.refreshToken, tokens.scope);
        }
        catch (error) {
            throw this.tokenError(error);
        }
    }
    relayCallback(provider) {
        return `${provider.relay.base.replace(/\/+$/, '')}/oauth/${provider.name}/callback`;
    }
    async refresh(provider, clientId, clientSecret, refreshToken, scope) {
        const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
        try {
            // Same ordering constraint as exchangeCode: build headers (which mutate body) before serializing.
            const headers = this.tokenHeaders(provider, clientId, clientSecret, body);
            const { data } = await axios_1.default.post(provider.tokenUrl, body.toString(), { headers, timeout: 20_000 });
            // Some providers omit refresh_token on refresh — keep the existing one.
            return this.tokensFromResponse(data, refreshToken, scope);
        }
        catch (error) {
            throw this.tokenError(error);
        }
    }
    /**
     * Resolve the effective client credentials for a flow. Relay providers always use the relay's app.
     * Otherwise a user's own saved clientId+secret win (BYO override), so a hosted-by-default connector
     * can still be routed through the user's own Google app; failing that, a hosted provider uses its
     * build-embedded creds, and a pure-BYO provider uses whatever (possibly empty) creds it has.
     */
    resolveClientCreds(provider, ownSecret) {
        if (provider.relay)
            return { clientId: provider.relay.clientId, clientSecret: '' };
        const ownClientId = typeof ownSecret.clientId === 'string' ? ownSecret.clientId.trim() : '';
        const ownClientSecret = typeof ownSecret.clientSecret === 'string' ? ownSecret.clientSecret : '';
        if (ownClientId && ownClientSecret)
            return { clientId: ownClientId, clientSecret: ownClientSecret };
        if (provider.hosted)
            return { clientId: provider.hosted.clientId, clientSecret: provider.hosted.clientSecret ?? '' };
        return { clientId: ownClientId, clientSecret: ownClientSecret };
    }
    tokenHeaders(provider, clientId, clientSecret, body) {
        const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
        if (provider.userAgent)
            headers['User-Agent'] = provider.userAgent;
        if (provider.clientAuth === 'basic') {
            headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
        }
        else if (provider.clientAuth === 'body') {
            body.set(provider.clientIdParam ?? 'client_id', clientId);
            if (clientSecret)
                body.set('client_secret', clientSecret);
        }
        return headers;
    }
    tokensFromResponse(data, fallbackRefresh, fallbackScope, fallbackExpiresInSeconds = 3600) {
        if (!data.access_token)
            throw new Error('Token endpoint returned no access token.');
        const parsedExpiresIn = Number(data.expires_in);
        const expiresIn = Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0 ? parsedExpiresIn : fallbackExpiresInSeconds;
        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? fallbackRefresh,
            expiresAt: Date.now() + expiresIn * 1000,
            scope: data.scope ?? fallbackScope,
        };
    }
    async fetchUsername(provider, accessToken) {
        if (!provider.identity)
            return null;
        const headers = { Authorization: `bearer ${accessToken}` };
        if (provider.userAgent)
            headers['User-Agent'] = provider.userAgent;
        const { data } = await axios_1.default.get(provider.identity.url, { headers, timeout: 10_000 });
        const value = data?.[provider.identity.field];
        return typeof value === 'string' ? value : null;
    }
    handle(username) {
        return username;
    }
    /** Title-case a connector name for user-facing messages (e.g. 'threads' → 'Threads'). */
    channelLabel(name) {
        return name.charAt(0).toUpperCase() + name.slice(1);
    }
}
exports.oauthService = new OAuthService();
//# sourceMappingURL=OAuthService.js.map