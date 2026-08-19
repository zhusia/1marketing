"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthCallbackServer = exports.OAUTH_CANCELLED = exports.OAUTH_REDIRECT_URI = exports.OAUTH_REDIRECT_PORT = void 0;
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
const brandAsset_1 = require("./brandAsset");
/**
 * Fixed loopback port for the OAuth redirect. Providers require the redirect_uri to match the
 * registered value exactly, so this cannot be ephemeral (unlike the *-mcp bridge servers).
 * The user registers `http://127.0.0.1:53682/callback` in their own app.
 */
const REDIRECT_PORT = 53682;
exports.OAUTH_REDIRECT_PORT = REDIRECT_PORT;
exports.OAUTH_REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
/** Marker rejection used when a wait is aborted (self-heal on retry, or the user cancelled). The
 *  service treats it as a benign cancellation rather than a real authorization failure. */
exports.OAUTH_CANCELLED = 'oauth-cancelled';
/** Where users can reach us when a connection fails — surfaced on the failure page. */
const SUPPORT_BUG_URL = 'https://stoicsoft.userjot.com/';
const SUPPORT_EMAIL = 'hello@stoicsoft.com';
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/** A read-only field with a Copy button. `id` must be unique within the page. */
function copyField(id, label, value) {
    return `<div class="field">
  <div class="field-top">
    <span class="field-label">${escapeHtml(label)}</span>
    <button type="button" class="copy" data-target="${id}" aria-label="Copy ${escapeHtml(label)}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      <span class="copy-label">Copy</span>
    </button>
  </div>
  <code id="${id}" class="field-value" data-value="${escapeHtml(value)}">${escapeHtml(value)}</code>
</div>`;
}
/**
 * The browser-facing page. It reflects the *actual* outcome — a green check only on a real
 * success, a red cross (with the provider's reason) on failure. When a `code` is present we also
 * show a "didn't connect automatically?" guide: the loopback handoff can be missed (focus stays in
 * the browser, the listener already closed, etc.), so we surface the full callback URL and the raw
 * code with one-tap Copy buttons. Pasting the URL back into the Connect dialog finishes the flow.
 */
function resultHtml(result) {
    const { ok, detail } = result;
    const glyph = ok ? '&#10003;' : '&#10007;';
    const accent = ok ? '#22c55e' : '#ef4444';
    const heading = ok ? 'Authorized' : 'Couldn’t connect';
    const guide = result.code
        ? `<div class="guide">
    <div class="guide-head">
      <span class="guide-dot"></span>
      Didn’t return to 1MarketingTool automatically?
    </div>
    <p class="guide-text">Copy the callback URL below, switch back to 1MarketingTool, and paste it into the Connect dialog to finish.</p>
    ${result.fullUrl ? copyField('cb-url', 'Callback URL', result.fullUrl) : ''}
    ${copyField('cb-code', 'Authorization code', result.code)}
  </div>`
        : '';
    // On failure, give the user a way to reach us. (On success there's nothing to report.)
    const support = ok
        ? ''
        : `<div class="support">
    <p class="support-text">Still stuck? We're happy to help.</p>
    <div class="support-links">
      <a class="support-link" href="${SUPPORT_BUG_URL}" target="_blank" rel="noopener noreferrer">Report a bug
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>
      </a>
      <a class="support-link" href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>
    </div>
  </div>`;
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <title>${heading} · 1MarketingTool</title>
  <style>
    :root { --accent: #2563eb; --status: ${accent}; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      color: #ededed;
      background:
        radial-gradient(1200px 600px at 50% -10%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%),
        #000;
    }
    .card {
      width: 100%;
      max-width: 480px;
      background: #0a0a0a;
      border: 1px solid #1f1f1f;
      border-radius: 18px;
      padding: 40px 32px 32px;
      text-align: center;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
    }
    .logo {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      display: block;
      margin: 0 auto 22px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
    }
    .glyph {
      width: 52px;
      height: 52px;
      margin: 0 auto 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      color: var(--status);
      border-radius: 50%;
      background: color-mix(in srgb, var(--status) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--status) 40%, transparent);
    }
    h1 { margin: 0 0 8px; font-size: 22px; font-weight: 650; letter-spacing: -0.01em; }
    .detail { margin: 0; color: #a1a1a1; line-height: 1.55; font-size: 14.5px; }
    .guide {
      margin-top: 28px;
      padding-top: 24px;
      border-top: 1px solid #1c1c1c;
      text-align: left;
    }
    .guide-head {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13.5px;
      font-weight: 600;
      color: #d4d4d4;
    }
    .guide-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .guide-text { margin: 10px 0 18px; font-size: 13px; color: #8f8f8f; line-height: 1.5; }
    .field { margin-bottom: 14px; }
    .field-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 7px;
    }
    .field-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6e6e6e;
    }
    .field-value {
      display: block;
      font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #d4d4d4;
      background: #121212;
      border: 1px solid #232323;
      border-radius: 10px;
      padding: 11px 13px;
      word-break: break-all;
      max-height: 132px;
      overflow-y: auto;
      text-align: left;
      scrollbar-width: thin;
      scrollbar-color: #2b2b2b transparent;
    }
    .field-value::-webkit-scrollbar { width: 9px; }
    .field-value::-webkit-scrollbar-thumb { background: #2b2b2b; border-radius: 8px; border: 2px solid #121212; }
    .copy {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      color: #ededed;
      background: var(--accent);
      border: 0;
      border-radius: 8px;
      padding: 6px 11px;
      cursor: pointer;
      transition: background 0.15s, transform 0.05s;
    }
    .copy svg { display: block; }
    .copy:hover { background: color-mix(in srgb, var(--accent) 88%, #fff); }
    .copy:active { transform: translateY(1px); }
    .copy.copied { background: #15803d; }
    .support {
      margin-top: 24px;
      padding-top: 22px;
      border-top: 1px solid #1c1c1c;
    }
    .support-text { margin: 0 0 14px; font-size: 13px; color: #8f8f8f; }
    .support-links { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
    .support-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 550;
      text-decoration: none;
      color: #d4d4d4;
      background: #121212;
      border: 1px solid #232323;
      border-radius: 9px;
      padding: 9px 14px;
      transition: border-color 0.15s, color 0.15s, background 0.15s;
    }
    .support-link:hover {
      color: #fff;
      border-color: color-mix(in srgb, var(--accent) 55%, #232323);
      background: color-mix(in srgb, var(--accent) 10%, #121212);
    }
    @media (max-width: 540px) {
      body { padding: 16px 12px; }
      .card { padding: 30px 20px 24px; border-radius: 16px; }
      .logo { width: 56px; height: 56px; margin-bottom: 18px; }
      h1 { font-size: 20px; }
      .detail { font-size: 14px; }
      .guide { margin-top: 24px; padding-top: 20px; }
      .field-value { font-size: 11.5px; max-height: 150px; }
      .support-links { flex-direction: column; }
      .support-link { justify-content: center; }
    }
    @media (prefers-reduced-motion: reduce) {
      .copy, .support-link { transition: none; }
    }
  </style>
</head>
<body>
  <main class="card">
    <img class="logo" src="${brandAsset_1.LOGO_DATA_URI}" alt="1MarketingTool" width="64" height="64" />
    <div class="glyph">${glyph}</div>
    <h1>${heading}</h1>
    <p class="detail">${escapeHtml(detail)}</p>
    ${guide}
    ${support}
  </main>
  <script>
    // Strip ?code=&state= from the address bar + browser history straight away. The auth code is
    // single-use and short-lived, but it shouldn't linger in history/URL after the page renders.
    // The copy fields below read from data-value (not the URL), so the manual-paste flow still works.
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* older browsers — ignore */ }
    document.querySelectorAll('.copy').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var el = document.getElementById(btn.dataset.target);
        var value = el ? el.dataset.value : '';
        var label = btn.querySelector('.copy-label') || btn;
        var done = function () {
          var prev = label.textContent;
          label.textContent = 'Copied';
          btn.classList.add('copied');
          setTimeout(function () { label.textContent = prev; btn.classList.remove('copied'); }, 1500);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(fallback);
        } else {
          fallback();
        }
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = value;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
          document.body.removeChild(ta);
        }
      });
    });
  </script>
</body>
</html>`;
}
/**
 * One-shot loopback HTTP server that captures the OAuth `code` from the browser redirect.
 * Bind the port with start(), then await waitForCode(state). Auto-closes after the first
 * callback (or the timeout). Bound to 127.0.0.1 only — never exposed to the network.
 */
class OAuthCallbackServer {
    server = null;
    settled = false;
    expectedState = '';
    onCode = null;
    onError = null;
    timer = null;
    /** Bind the fixed loopback port; rejects on EADDRINUSE so the user gets a clear message. */
    start() {
        return new Promise((resolve, reject) => {
            const server = http_1.default.createServer((req, res) => this.handleRequest(req, res));
            server.once('error', (err) => {
                reject(new Error(err.code === 'EADDRINUSE'
                    ? `Port ${REDIRECT_PORT} is already in use — close whatever is using it and click Connect again.`
                    : `Could not start the local OAuth listener: ${err.message}`));
            });
            server.listen(REDIRECT_PORT, '127.0.0.1', () => resolve());
            this.server = server;
        });
    }
    /** Resolve with the auth code once the browser redirects back with a matching state. */
    waitForCode(expectedState, timeoutMs = 5 * 60_000) {
        // Cancelled in the tiny window between start() and this call — don't hang forever.
        if (this.settled)
            return Promise.reject(new Error(exports.OAUTH_CANCELLED));
        this.expectedState = expectedState;
        return new Promise((resolve, reject) => {
            this.onCode = resolve;
            this.onError = reject;
            this.timer = setTimeout(() => this.settle(() => reject(new Error('Timed out waiting for authorization (5 min).'))), timeoutMs);
        });
    }
    handleRequest(req, res) {
        const url = new url_1.URL(req.url ?? '/', exports.OAUTH_REDIRECT_URI);
        if (url.pathname !== '/callback') {
            res.writeHead(404);
            res.end();
            return;
        }
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        // Decide the outcome BEFORE serving the page so the tab never shows a false "Authorized".
        // The provider redirects back with either a `code` or an `error` (+ human-readable description).
        let failure = null;
        if (error) {
            failure = errorDescription ? `${error} — ${errorDescription}` : error;
        }
        else if (state !== this.expectedState) {
            failure = 'state mismatch — the response did not match this request (aborted for safety)';
        }
        else if (!code) {
            failure = 'no authorization code was returned';
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(failure
            ? resultHtml({
                ok: false,
                detail: `${failure}. Close this tab and check the setup steps in 1MarketingTool.`,
                fullUrl: code ? url.href : null,
                code,
            })
            : resultHtml({
                ok: true,
                detail: 'You can close this tab and return to 1MarketingTool.',
                fullUrl: url.href,
                code,
            }));
        if (failure)
            return this.settle(() => this.onError?.(new Error(`Authorization failed: ${failure}`)));
        this.settle(() => this.onCode?.(code));
    }
    settle(fn) {
        if (this.settled)
            return;
        this.settled = true;
        if (this.timer)
            clearTimeout(this.timer);
        fn();
        this.close();
    }
    /**
     * Abort a wait in progress and free the loopback port immediately — used to self-heal a retry
     * (the user closed the browser and clicked Connect again) or when the user cancels/closes the
     * dialog. Rejects any pending waitForCode with the cancellation marker. Safe to call more than
     * once and when nothing is waiting.
     */
    cancel() {
        this.settle(() => this.onError?.(new Error(exports.OAUTH_CANCELLED)));
        this.close();
    }
    close() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
}
exports.OAuthCallbackServer = OAuthCallbackServer;
//# sourceMappingURL=OAuthCallbackServer.js.map