"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserExtensionService = exports.BrowserExtensionService = void 0;
const fs_1 = __importDefault(require("fs"));
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const channels_1 = require("../ipc/channels");
const AppRepository_1 = require("./AppRepository");
const domain_1 = require("../utils/domain");
const userDataPath_1 = require("../utils/userDataPath");
const RELAY_PORT = Number(process.env.ONE_MARKETING_TOOL_EXTENSION_RELAY_PORT || 18794);
const RELAY_HOST = '127.0.0.1';
const RELAY_TOKEN_KEY = 'browserExtensionRelayToken';
const RELAY_STATUS_KEY = 'browserExtensionStatus';
const EXTENSION_DIRNAME = '1marketingtool-browser-extension';
const EXTENSION_VERSION = '0.1.0';
const EXTENSION_JOB_TIMEOUT_MS = 10 * 60 * 1000;
function buildGoogleWebmasterTargets(products) {
    return products.flatMap((product) => {
        const domain = (0, domain_1.extractDomain)(product.url);
        const resourceId = encodeURIComponent(`sc-domain:${domain}`);
        return [
            {
                productId: product.id,
                productName: product.name,
                pageKind: 'performance',
                url: `https://search.google.com/search-console/performance/search-analytics?resource_id=${resourceId}&hl=en`,
            },
            {
                productId: product.id,
                productName: product.name,
                pageKind: 'index',
                url: `https://search.google.com/search-console/index?resource_id=${resourceId}&hl=en`,
            },
            {
                productId: product.id,
                productName: product.name,
                // The Links report (top linking sites/text) is UI-only — no Search Console API exposes it —
                // so we capture it from the signed-in UI like the other reports.
                pageKind: 'links',
                url: `https://search.google.com/search-console/links?resource_id=${resourceId}&hl=en`,
            },
        ];
    });
}
function limitText(value, max) {
    return value.length > max ? value.slice(0, max) : value;
}
function relayBaseUrl() {
    return `http://${RELAY_HOST}:${RELAY_PORT}`;
}
function parseJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8');
                resolve(raw ? JSON.parse(raw) : {});
            }
            catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
function sendJson(res, statusCode, data, origin) {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (origin?.startsWith('chrome-extension://')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'content-type, x-1marketingtool-token');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    res.end(JSON.stringify(data));
}
function sanitizeManifestVersion(rawVersion) {
    const cleaned = rawVersion
        .split('.')
        .map((part) => part.replace(/[^0-9]/g, ''))
        .filter(Boolean)
        .slice(0, 4);
    return cleaned.length > 0 ? cleaned.join('.') : EXTENSION_VERSION;
}
function popupHtml() {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>1MarketingTool</title>
    <style>
      body {
        margin: 0;
        width: 320px;
        background: #f8fafc;
        color: #0f172a;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .app {
        padding: 14px;
        display: grid;
        gap: 10px;
      }
      .status {
        border: 1px solid rgba(15, 23, 42, 0.08);
        border-radius: 10px;
        padding: 10px 12px;
        background: #fff;
        display: grid;
        gap: 6px;
      }
      .kicker {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #64748b;
      }
      .title {
        font-size: 15px;
        font-weight: 700;
      }
      .muted {
        color: #475569;
        font-size: 12px;
        line-height: 1.45;
      }
      button {
        min-height: 36px;
        border-radius: 8px;
        border: 0;
        background: #2563eb;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      button.secondary {
        background: #e2e8f0;
        color: #0f172a;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 11px;
        color: #334155;
      }
    </style>
  </head>
  <body>
    <div class="app">
      <div class="status">
        <div class="kicker">1MarketingTool</div>
        <div class="title" id="state-title">Connecting…</div>
        <div class="muted" id="state-copy">Checking relay and reading the current tab.</div>
      </div>
      <button id="capture-btn">Capture Current Tab</button>
      <button class="secondary" id="retry-btn">Check Relay</button>
      <div class="status">
        <div class="kicker">Last Result</div>
        <pre id="result">Waiting…</pre>
      </div>
    </div>
    <script src="config.js"></script>
    <script src="popup.js"></script>
  </body>
</html>`;
}
function popupScript() {
    return `
const config = window.__ONE_MARKETING_TOOL_EXTENSION_CONFIG__;
const stateTitle = document.getElementById('state-title');
const stateCopy = document.getElementById('state-copy');
const result = document.getElementById('result');
const captureBtn = document.getElementById('capture-btn');
const retryBtn = document.getElementById('retry-btn');

function setBadge(text, color) {
  if (chrome?.action?.setBadgeText) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  }
}

function setState(title, copy) {
  stateTitle.textContent = title;
  stateCopy.textContent = copy;
}

async function checkRelay() {
  const response = await fetch(config.relayBaseUrl + '/health');
  if (!response.ok) throw new Error('Relay unavailable');
  const data = await response.json();
  setState('Relay Connected', 'Desktop app relay is ready.');
  result.textContent = JSON.stringify(data, null, 2);
  setBadge('ON', '#2563eb');
}

function truncate(value, max) {
  return typeof value === 'string' && value.length > max ? value.slice(0, max) : value;
}

function scrapePage() {
  const pick = (selector, limit) => Array.from(document.querySelectorAll(selector)).slice(0, limit);
  const text = (node) => (node && node.textContent ? node.textContent.trim().replace(/\\s+/g, ' ') : '');
  const meta = {};
  for (const node of document.querySelectorAll('meta[name], meta[property]')) {
    const key = node.getAttribute('name') || node.getAttribute('property');
    const value = node.getAttribute('content') || '';
    if (key && value) meta[key] = value;
  }
  const serializedTables = pick('table', 4).map((table) =>
    Array.from(table.querySelectorAll('tr')).slice(0, 12).map((row) =>
      Array.from(row.querySelectorAll('th, td')).slice(0, 8).map((cell) => text(cell)).filter(Boolean)
    ).filter((row) => row.length > 0)
  );

  return {
    url: location.href,
    title: document.title || '',
    hostname: location.hostname,
    pageText: truncate(document.body ? document.body.innerText || '' : '', 180000),
    metadata: {
      lang: document.documentElement.lang || null,
      meta,
      headings: pick('h1, h2, h3', 24).map((node) => text(node)).filter(Boolean),
      links: pick('a[href]', 30).map((node) => ({
        text: text(node),
        href: node.href,
      })).filter((item) => item.href),
      tables: serializedTables,
      capturedAt: Date.now(),
      userAgent: navigator.userAgent,
    },
  };
}

async function sendHeartbeat(extra) {
  await fetch(config.relayBaseUrl + '/extension/heartbeat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-1marketingtool-token': config.token,
    },
    body: JSON.stringify({
      browserName: navigator.userAgent.includes('Brave') ? 'Brave' : navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome',
      browserVersion: navigator.userAgent,
      extensionVersion: config.extensionVersion,
      ...extra,
    }),
  });
}

async function captureCurrentTab() {
  setState('Capturing…', 'Reading the current tab and sending it to 1MarketingTool.');
  setBadge('…', '#f59e0b');

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.id) throw new Error('No active tab found.');
  if (!tab.url) throw new Error('The current tab has no readable URL.');
  if (/^(chrome|edge|brave|about|chrome-extension):/i.test(tab.url)) {
    throw new Error('This browser page cannot be captured. Open a normal website tab first.');
  }

  let scraped = null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapePage,
    });
    if (injection && injection.result && typeof injection.result === 'object') {
      scraped = injection.result;
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to read the current tab.');
  }

  const fallbackUrl = tab.url || '';
  const payload = scraped && typeof scraped === 'object'
    ? scraped
    : {
        url: fallbackUrl,
        title: tab.title || fallbackUrl,
        hostname: (() => {
          try {
            return new URL(fallbackUrl).hostname;
          } catch {
            return '';
          }
        })(),
        pageText: '',
        metadata: {
          captureMode: 'tab_fallback',
          capturedAt: Date.now(),
        },
      };

  if (!payload.url) {
    throw new Error('Could not read the current tab URL.');
  }

  await sendHeartbeat({ lastUrl: payload.url });

  const response = await fetch(config.relayBaseUrl + '/extension/capture', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-1marketingtool-token': config.token,
    },
    body: JSON.stringify({
      source: 'browser_extension',
      ...payload,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Capture failed');
  }

  const saved = await response.json();
  setState('Capture Saved', 'The page data is now available in 1MarketingTool.');
  result.textContent = JSON.stringify(saved, null, 2);
  setBadge('ON', '#059669');
}

captureBtn.addEventListener('click', async () => {
  try {
    await captureCurrentTab();
  } catch (error) {
    setState('Capture Failed', error instanceof Error ? error.message : 'Unexpected error');
    result.textContent = String(error);
    setBadge('ERR', '#dc2626');
  }
});

retryBtn.addEventListener('click', async () => {
  try {
    await checkRelay();
  } catch (error) {
    setState('Relay Unavailable', error instanceof Error ? error.message : 'Unexpected error');
    result.textContent = String(error);
    setBadge('ERR', '#dc2626');
  }
});

(async () => {
  try {
    await checkRelay();
    await captureCurrentTab();
  } catch (error) {
    setState('Need Attention', error instanceof Error ? error.message : 'Unexpected error');
    result.textContent = String(error);
    setBadge('ERR', '#dc2626');
  }
})();
`;
}
function backgroundScript(config) {
    return `
const config = ${JSON.stringify(config)};
let processing = false;
let currentTabId = null;

function setBadge(text, color) {
  if (chrome?.action?.setBadgeText) {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(node) {
  return node && node.textContent ? node.textContent.trim().replace(/\\s+/g, ' ') : '';
}

function scrapePage() {
  const pick = (selector, limit) => Array.from(document.querySelectorAll(selector)).slice(0, limit);
  const meta = {};
  for (const node of document.querySelectorAll('meta[name], meta[property]')) {
    const key = node.getAttribute('name') || node.getAttribute('property');
    const value = node.getAttribute('content') || '';
    if (key && value) meta[key] = value;
  }
  const tables = pick('table', 4).map((table) =>
    Array.from(table.querySelectorAll('tr')).slice(0, 15).map((row) =>
      Array.from(row.querySelectorAll('th, td')).slice(0, 8).map((cell) => text(cell)).filter(Boolean)
    ).filter((row) => row.length > 0)
  );
  return {
    url: location.href,
    title: document.title || '',
    hostname: location.hostname,
    pageText: document.body ? (document.body.innerText || '').slice(0, 180000) : '',
    metadata: {
      headings: pick('h1, h2, h3', 24).map((node) => text(node)).filter(Boolean),
      links: pick('a[href]', 30).map((node) => ({ text: text(node), href: node.href })).filter((item) => item.href),
      tables,
      meta,
      capturedAt: Date.now(),
      userAgent: navigator.userAgent,
    },
  };
}

async function request(pathname, options) {
  const response = await fetch(config.relayBaseUrl + pathname, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-1marketingtool-token': config.token,
      ...(options && options.headers ? options.headers : {}),
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Relay request failed');
  }
  return response.json();
}

async function sendHeartbeat(extra) {
  try {
    await request('/extension/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        browserName: navigator.userAgent.includes('Brave') ? 'Brave' : navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome',
        browserVersion: navigator.userAgent,
        extensionVersion: config.extensionVersion,
        ...extra,
      }),
    });
  } catch {
    setBadge('ERR', '#dc2626');
  }
}

async function waitForTabComplete(tabId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab && tab.status === 'complete' && tab.url) {
      return tab;
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for the page to load.');
}

async function waitForText(tabId, needle, timeoutMs) {
  const start = Date.now();
  const lower = needle.toLowerCase();
  while (Date.now() - start < timeoutMs) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (value) => (document.body ? document.body.innerText.toLowerCase().indexOf(value) !== -1 : false),
        args: [lower],
      });
      if (res && res.result) return;
    } catch (error) {
      // Ignore transient injection errors while the page is still navigating.
    }
    await sleep(800);
  }
}

async function ensureTab(url, active) {
  if (currentTabId) {
    await chrome.tabs.update(currentTabId, { url, active }).catch(() => {
      currentTabId = null;
    });
  }

  if (!currentTabId) {
    const tab = await chrome.tabs.create({ url, active });
    currentTabId = tab.id || null;
  }

  if (!currentTabId) {
    throw new Error('Could not create a browser tab for automation.');
  }

  return waitForTabComplete(currentTabId, 30000);
}

async function captureTarget(job, target, index, total) {
  const tab = await ensureTab(target.url, job.mode === 'headed');
  await sleep(2200);

  if (!tab.id) throw new Error('Automation tab disappeared.');

  if (/accounts\\.google\\.com/i.test(tab.url || '')) {
    throw new Error('Google session required in this browser profile.');
  }

  if (target.pageKind === 'links') {
    // The Links report lazy-loads its tables; wait until they render before scraping.
    await waitForText(tab.id, 'top linking', 12000);
  }

  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: scrapePage,
  });

  const payload = injection && injection.result && typeof injection.result === 'object'
    ? injection.result
    : {
        url: tab.url || target.url,
        title: tab.title || target.productName,
        hostname: (() => {
          try { return new URL(tab.url || target.url).hostname; } catch { return 'search.google.com'; }
        })(),
        pageText: '',
        metadata: { captureMode: 'tab_fallback', capturedAt: Date.now() },
      };

  await sendHeartbeat({
    lastUrl: payload.url,
    message: 'Capturing ' + target.productName + ' ' + target.pageKind + ' (' + (index + 1) + '/' + total + ')',
  });

  await request('/extension/capture', {
    method: 'POST',
    body: JSON.stringify({
      source: 'google_webmaster_browser',
      ...payload,
      metadata: {
        ...(payload.metadata || {}),
        automation: 'google_webmaster_browser',
        jobId: job.id,
        productId: target.productId,
        productName: target.productName,
        pageKind: target.pageKind,
        targetUrl: target.url,
      },
    }),
  });
}

async function reportJobError(jobId, target, error) {
  await request('/extension/job-error', {
    method: 'POST',
    body: JSON.stringify({
      jobId,
      productId: target.productId,
      pageKind: target.pageKind,
      targetUrl: target.url,
      error: error instanceof Error ? error.message : String(error),
    }),
  });
}

async function completeJob(jobId) {
  await request('/extension/job-complete', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });
}

async function pollJob() {
  if (processing) return;
  processing = true;
  try {
    const response = await request('/extension/job', { method: 'GET' }).catch(() => null);
    if (!response || !response.job) {
      await sendHeartbeat({});
      return;
    }

    const job = response.job;
    setBadge('RUN', '#2563eb');
    for (let i = 0; i < job.targets.length; i++) {
      const target = job.targets[i];
      try {
        await captureTarget(job, target, i, job.targets.length);
      } catch (error) {
        await reportJobError(job.id, target, error);
      }
      await sleep(1200);
    }

    await completeJob(job.id);
    setBadge('ON', '#059669');
  } finally {
    processing = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('relayPoll', { periodInMinutes: 0.5 });
  pollJob();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('relayPoll', { periodInMinutes: 0.5 });
  pollJob();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'relayPoll') {
    pollJob();
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    sendHeartbeat({ lastUrl: tab.url });
  }
});

pollJob();
`;
}
class BrowserExtensionService {
    server = null;
    relayReady = false;
    googleWebmasterJob = null;
    googleWebmasterProgress = {
        status: 'idle',
        currentProductId: null,
        currentUrl: null,
        processedCount: 0,
        totalCount: 0,
        message: '',
        results: [],
        errors: [],
    };
    start() {
        void this.installOrUpdateExtensionFiles();
        if (this.server)
            return;
        this.server = http_1.default.createServer(async (req, res) => {
            const origin = req.headers.origin;
            if (req.method === 'OPTIONS') {
                sendJson(res, 204, {}, origin);
                return;
            }
            try {
                const url = new URL(req.url ?? '/', relayBaseUrl());
                if (req.method === 'GET' && url.pathname === '/health') {
                    sendJson(res, 200, { ok: true, relayPort: RELAY_PORT, relayReady: this.relayReady }, origin);
                    return;
                }
                if (req.method === 'GET' && url.pathname === '/extension/status') {
                    sendJson(res, 200, this.getInfo(), origin);
                    return;
                }
                if (req.method === 'GET' && url.pathname === '/extension/job') {
                    const job = this.getNextGoogleWebmasterJob();
                    sendJson(res, 200, { job }, origin);
                    return;
                }
                if (!this.isAuthorized(req)) {
                    sendJson(res, 401, { error: 'Unauthorized' }, origin);
                    return;
                }
                if (req.method === 'POST' && url.pathname === '/extension/heartbeat') {
                    const body = (await parseJsonBody(req));
                    const status = {
                        lastSeenAt: Date.now(),
                        browserName: typeof body.browserName === 'string' ? body.browserName : null,
                        browserVersion: typeof body.browserVersion === 'string' ? body.browserVersion : null,
                        extensionVersion: typeof body.extensionVersion === 'string' ? body.extensionVersion : null,
                        message: typeof body.lastUrl === 'string' ? `Attached to ${body.lastUrl}` : null,
                    };
                    AppRepository_1.repository.setSetting(RELAY_STATUS_KEY, status);
                    sendJson(res, 200, { ok: true }, origin);
                    return;
                }
                if (req.method === 'POST' && url.pathname === '/extension/capture') {
                    const body = (await parseJsonBody(req));
                    const capture = this.saveCapture(body);
                    sendJson(res, 200, capture, origin);
                    return;
                }
                if (req.method === 'POST' && url.pathname === '/extension/job-error') {
                    const body = (await parseJsonBody(req));
                    this.recordGoogleWebmasterJobError(body);
                    sendJson(res, 200, { ok: true }, origin);
                    return;
                }
                if (req.method === 'POST' && url.pathname === '/extension/job-complete') {
                    const body = (await parseJsonBody(req));
                    this.completeGoogleWebmasterJob(body);
                    sendJson(res, 200, { ok: true }, origin);
                    return;
                }
                sendJson(res, 404, { error: 'Not found' }, origin);
            }
            catch (error) {
                sendJson(res, 500, { error: error instanceof Error ? error.message : 'Unexpected error' }, origin);
            }
        });
        this.server.listen(RELAY_PORT, RELAY_HOST, () => {
            this.relayReady = true;
        });
        this.server.on('error', () => {
            this.relayReady = false;
        });
    }
    stop() {
        this.relayReady = false;
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }
    getInfo() {
        const installPath = this.getInstallPath();
        const status = AppRepository_1.repository.getSetting(RELAY_STATUS_KEY)?.value;
        return {
            installed: fs_1.default.existsSync(path_1.default.join(installPath, 'manifest.json')),
            installPath,
            relayPort: RELAY_PORT,
            relayReady: this.relayReady,
            lastSeenAt: typeof status?.lastSeenAt === 'number' ? status.lastSeenAt : null,
            browserName: typeof status?.browserName === 'string' ? status.browserName : null,
            browserVersion: typeof status?.browserVersion === 'string' ? status.browserVersion : null,
            extensionVersion: typeof status?.extensionVersion === 'string' ? status.extensionVersion : null,
            message: typeof status?.message === 'string' ? status.message : null,
        };
    }
    installOrUpdateExtensionFiles() {
        const installPath = this.getInstallPath();
        fs_1.default.mkdirSync(installPath, { recursive: true });
        const configSource = `window.__ONE_MARKETING_TOOL_EXTENSION_CONFIG__ = ${JSON.stringify({
            relayBaseUrl: relayBaseUrl(),
            token: this.getRelayToken(),
            extensionVersion: EXTENSION_VERSION,
        }, null, 2)};\n`;
        const manifest = {
            manifest_version: 3,
            name: '1MarketingTool',
            version: sanitizeManifestVersion(electron_1.app.getVersion()),
            description: 'Capture page data from logged-in browser tabs into 1MarketingTool.',
            permissions: ['activeTab', 'scripting', 'storage', 'tabs', 'alarms'],
            host_permissions: [`http://${RELAY_HOST}/*`, 'http://localhost/*', 'https://*/*', 'http://*/*'],
            background: {
                service_worker: 'background.js',
            },
            action: {
                default_title: '1MarketingTool',
                default_popup: 'popup.html',
            },
        };
        fs_1.default.writeFileSync(path_1.default.join(installPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(installPath, 'config.js'), configSource, 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(installPath, 'popup.html'), popupHtml(), 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(installPath, 'popup.js'), popupScript(), 'utf8');
        fs_1.default.writeFileSync(path_1.default.join(installPath, 'background.js'), backgroundScript({
            relayBaseUrl: relayBaseUrl(),
            token: this.getRelayToken(),
            extensionVersion: EXTENSION_VERSION,
        }), 'utf8');
        AppRepository_1.repository.setSetting('browserExtensionInstall', {
            installedAt: Date.now(),
            installPath,
            relayPort: RELAY_PORT,
        });
        return this.getInfo();
    }
    listCaptures(productId, limit = 20) {
        return AppRepository_1.repository.listBrowserCaptures(productId, limit);
    }
    getGoogleWebmasterProgress() {
        return { ...this.googleWebmasterProgress };
    }
    async runGoogleWebmasterAutomation(productId, mode = 'headed') {
        const products = productId
            ? [AppRepository_1.repository.getProduct(productId)].filter(Boolean)
            : AppRepository_1.repository.listProducts();
        if (products.length === 0) {
            throw new Error('No products found to capture.');
        }
        const targets = buildGoogleWebmasterTargets(products);
        this.googleWebmasterJob = {
            id: (0, crypto_1.randomBytes)(12).toString('hex'),
            mode,
            claimedAt: null,
            createdAt: Date.now(),
            targets,
        };
        this.googleWebmasterProgress = {
            status: 'running',
            currentProductId: null,
            currentUrl: null,
            processedCount: 0,
            totalCount: targets.length,
            message: 'Waiting for the browser extension to pick up the job...',
            results: [],
            errors: [],
        };
        this.emitGoogleWebmasterProgress();
    }
    async openExtensionsManager() {
        const candidates = this.getBrowserCommands();
        for (const candidate of candidates) {
            try {
                candidate.open();
                return { opened: true, browser: candidate.name };
            }
            catch {
                // try next
            }
        }
        try {
            await electron_1.shell.openExternal('https://support.google.com/chrome_webstore/answer/2664769?hl=en');
            return { opened: true, browser: null };
        }
        catch {
            return { opened: false, browser: null };
        }
    }
    getInstallPath() {
        return path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), EXTENSION_DIRNAME);
    }
    getRelayToken() {
        const existing = AppRepository_1.repository.getSetting(RELAY_TOKEN_KEY)?.value;
        if (typeof existing === 'string' && existing.length >= 24) {
            return existing;
        }
        const token = (0, crypto_1.randomBytes)(24).toString('hex');
        AppRepository_1.repository.setSetting(RELAY_TOKEN_KEY, token);
        return token;
    }
    isAuthorized(req) {
        const provided = req.headers['x-1marketingtool-token'];
        return typeof provided === 'string' && provided === this.getRelayToken();
    }
    saveCapture(body) {
        const url = typeof body.url === 'string' ? body.url : '';
        const hostname = typeof body.hostname === 'string' && body.hostname ? body.hostname : (0, domain_1.extractDomain)(url);
        const pageText = limitText(typeof body.pageText === 'string' ? body.pageText : '', 180000);
        const metadata = typeof body.metadata === 'object' && body.metadata ? body.metadata : {};
        const matchedProductId = this.matchProductId(url, hostname);
        const capture = AppRepository_1.repository.createBrowserCapture({
            matchedProductId,
            source: typeof body.source === 'string' ? body.source : 'browser_extension',
            hostname,
            url,
            title: limitText(typeof body.title === 'string' ? body.title : url || hostname, 300),
            pageText,
            metadata: {
                ...metadata,
                textHash: (0, crypto_1.createHash)('sha1').update(pageText).digest('hex'),
            },
        });
        const jobId = typeof metadata.jobId === 'string' ? metadata.jobId : null;
        if (this.googleWebmasterJob && jobId === this.googleWebmasterJob.id) {
            this.googleWebmasterProgress.results.push(capture);
            this.googleWebmasterProgress.processedCount += 1;
            this.googleWebmasterProgress.currentProductId =
                typeof metadata.productId === 'string' ? metadata.productId : capture.matchedProductId;
            this.googleWebmasterProgress.currentUrl = capture.url;
            this.googleWebmasterProgress.message = `Captured ${capture.title}`;
            this.emitGoogleWebmasterProgress();
        }
        AppRepository_1.repository.setSetting(RELAY_STATUS_KEY, {
            ...AppRepository_1.repository.getSetting(RELAY_STATUS_KEY)?.value,
            lastSeenAt: Date.now(),
            message: `Captured ${capture.hostname}`,
        });
        return capture;
    }
    matchProductId(url, hostname) {
        const products = AppRepository_1.repository.listProducts(true);
        const direct = products.find((product) => (0, domain_1.extractDomain)(product.url) === hostname);
        if (direct)
            return direct.id;
        try {
            const parsed = new URL(url);
            if (parsed.hostname === 'search.google.com' && parsed.pathname.includes('/search-console')) {
                const resourceId = parsed.searchParams.get('resource_id');
                const domain = resourceId?.startsWith('sc-domain:') ? resourceId.replace('sc-domain:', '') : null;
                if (domain) {
                    const product = products.find((entry) => (0, domain_1.extractDomain)(entry.url) === domain);
                    return product?.id ?? null;
                }
            }
        }
        catch {
            // ignore
        }
        return null;
    }
    getNextGoogleWebmasterJob() {
        if (!this.googleWebmasterJob)
            return null;
        if (this.googleWebmasterJob.claimedAt &&
            Date.now() - this.googleWebmasterJob.claimedAt > EXTENSION_JOB_TIMEOUT_MS) {
            this.googleWebmasterProgress.status = 'failed';
            this.googleWebmasterProgress.message = 'Browser extension job timed out.';
            this.emitGoogleWebmasterProgress();
            this.googleWebmasterJob = null;
            return null;
        }
        if (this.googleWebmasterJob.claimedAt) {
            return null;
        }
        this.googleWebmasterJob.claimedAt = Date.now();
        this.googleWebmasterProgress.message = 'Browser extension picked up the job.';
        this.emitGoogleWebmasterProgress();
        return this.googleWebmasterJob;
    }
    recordGoogleWebmasterJobError(body) {
        if (!this.googleWebmasterJob || body.jobId !== this.googleWebmasterJob.id)
            return;
        this.googleWebmasterProgress.errors.push({
            productId: typeof body.productId === 'string' ? body.productId : null,
            error: typeof body.error === 'string' ? body.error : 'Unknown error',
        });
        this.googleWebmasterProgress.processedCount += 1;
        this.googleWebmasterProgress.currentProductId = typeof body.productId === 'string' ? body.productId : null;
        this.googleWebmasterProgress.currentUrl = typeof body.targetUrl === 'string' ? body.targetUrl : null;
        this.googleWebmasterProgress.message = typeof body.error === 'string' ? body.error : 'Capture failed.';
        this.emitGoogleWebmasterProgress();
    }
    completeGoogleWebmasterJob(body) {
        if (!this.googleWebmasterJob || body.jobId !== this.googleWebmasterJob.id)
            return;
        this.googleWebmasterProgress.status = this.googleWebmasterProgress.errors.length > 0 ? 'completed' : 'completed';
        this.googleWebmasterProgress.currentProductId = null;
        this.googleWebmasterProgress.currentUrl = null;
        this.googleWebmasterProgress.message = `Completed. Captured ${this.googleWebmasterProgress.results.length} page(s), ${this.googleWebmasterProgress.errors.length} error(s).`;
        this.googleWebmasterJob = null;
        this.emitGoogleWebmasterProgress();
    }
    emitGoogleWebmasterProgress() {
        try {
            const windows = electron_1.BrowserWindow.getAllWindows();
            for (const win of windows) {
                win.webContents.send(channels_1.CHANNELS.AUTOMATION_GOOGLE_WEBMASTER_PROGRESS, this.googleWebmasterProgress);
            }
        }
        catch {
            // Non-fatal
        }
    }
    getBrowserCommands() {
        const urlByBrowser = {
            chrome: 'chrome://extensions',
            brave: 'brave://extensions',
            edge: 'edge://extensions',
        };
        if (process.platform === 'darwin') {
            return [
                {
                    name: 'Chrome',
                    open: () => this.spawnDetached('open', ['-a', 'Google Chrome', urlByBrowser.chrome]),
                },
                {
                    name: 'Brave',
                    open: () => this.spawnDetached('open', ['-a', 'Brave Browser', urlByBrowser.brave]),
                },
                {
                    name: 'Edge',
                    open: () => this.spawnDetached('open', ['-a', 'Microsoft Edge', urlByBrowser.edge]),
                },
            ];
        }
        if (process.platform === 'win32') {
            return [
                {
                    name: 'Chrome',
                    open: () => this.spawnDetached('cmd', ['/c', 'start', '', 'chrome', urlByBrowser.chrome]),
                },
                {
                    name: 'Brave',
                    open: () => this.spawnDetached('cmd', ['/c', 'start', '', 'brave', urlByBrowser.brave]),
                },
                {
                    name: 'Edge',
                    open: () => this.spawnDetached('cmd', ['/c', 'start', '', 'msedge', urlByBrowser.edge]),
                },
            ];
        }
        return [
            {
                name: 'Chrome',
                open: () => this.spawnDetached('google-chrome', [urlByBrowser.chrome]),
            },
            {
                name: 'Brave',
                open: () => this.spawnDetached('brave-browser', [urlByBrowser.brave]),
            },
            {
                name: 'Edge',
                open: () => this.spawnDetached('microsoft-edge', [urlByBrowser.edge]),
            },
        ];
    }
    spawnDetached(command, args) {
        const child = (0, child_process_1.spawn)(command, args, {
            detached: true,
            stdio: 'ignore',
        });
        child.unref();
    }
}
exports.BrowserExtensionService = BrowserExtensionService;
exports.browserExtensionService = new BrowserExtensionService();
//# sourceMappingURL=BrowserExtensionService.js.map