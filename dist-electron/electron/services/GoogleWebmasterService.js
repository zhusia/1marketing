"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleWebmasterService = void 0;
const electron_1 = require("electron");
const AppRepository_1 = require("./AppRepository");
const domain_1 = require("../utils/domain");
const GOOGLE_PROVIDER = 'google_webmaster';
const GOOGLE_PARTITION = 'persist:1marketingtool-automation';
const GOOGLE_ACCOUNT_URL = 'https://myaccount.google.com/?hl=en';
const GOOGLE_SEARCH_CONSOLE_URL = 'https://search.google.com/search-console';
const GOOGLE_ACCOUNT_SNAPSHOT_JS = `
  (function() {
    var texts = [];
    var push = function(value) {
      if (typeof value === 'string') {
        var trimmed = value.trim();
        if (trimmed && trimmed.length < 400) texts.push(trimmed);
      }
    };

    var nodes = document.querySelectorAll('[aria-label], [title], [data-email], a, button, div, span');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.getAttribute) {
        push(node.getAttribute('aria-label'));
        push(node.getAttribute('title'));
        push(node.getAttribute('data-email'));
      }
      push(node.textContent);
    }

    push(document.title || '');
    if (document.body && document.body.innerText) {
      push(document.body.innerText.slice(0, 4000));
    }

    var joined = texts.join('\\n');
    var emailMatch = joined.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i);
    var email = emailMatch ? emailMatch[0] : null;
    var displayName = null;

    if (email) {
      for (var j = 0; j < texts.length; j++) {
        var candidate = texts[j];
        if (candidate.indexOf(email) !== -1) {
          var cleaned = candidate
            .replace(email, '')
            .replace(/[()<>]/g, ' ')
            .replace(/Google Account:?/ig, ' ')
            .replace(/Account:?/ig, ' ')
            .replace(/Profile:?/ig, ' ')
            .replace(/\\s+/g, ' ')
            .trim();
          if (cleaned) {
            displayName = cleaned;
            break;
          }
        }
      }
    }

    var avatarUrl = null;
    for (var k = 0; k < document.images.length; k++) {
      var src = document.images[k].src || '';
      if (/googleusercontent|gstatic/i.test(src)) {
        avatarUrl = src;
        break;
      }
    }

    return JSON.stringify({
      email: email,
      displayName: displayName,
      avatarUrl: avatarUrl,
      profileUrl: location.href,
      title: document.title || '',
      currentUrl: location.href,
      signedIn: !/signin|servicelogin/i.test(location.href) && !!email
    });
  })()
`;
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function buildSearchConsoleUrl(rawDomain) {
    if (!rawDomain) {
        return `${GOOGLE_SEARCH_CONSOLE_URL}?hl=en`;
    }
    const resourceId = encodeURIComponent(`sc-domain:${(0, domain_1.extractDomain)(rawDomain)}`);
    return `${GOOGLE_SEARCH_CONSOLE_URL}/index?resource_id=${resourceId}&hl=en`;
}
class GoogleWebmasterService {
    authWindow = null;
    getSavedAccount() {
        return AppRepository_1.repository.getAutomationAccount(GOOGLE_PROVIDER);
    }
    openLoginWindow() {
        this.openWindow(`${GOOGLE_SEARCH_CONSOLE_URL}?hl=en`, 'Google Login');
        return { opened: true };
    }
    openSearchConsole(rawDomain) {
        const url = buildSearchConsoleUrl(rawDomain);
        this.openWindow(url, 'Google Search Console');
        return { opened: true, url };
    }
    async syncAccount() {
        const hasSession = await this.hasGoogleSession();
        if (!hasSession) {
            return AppRepository_1.repository.upsertAutomationAccount({
                provider: GOOGLE_PROVIDER,
                sessionPartition: GOOGLE_PARTITION,
                status: 'attention',
                metadata: { reason: 'No persistent Google session detected. Sign in first.' },
                lastSyncedAt: null,
            });
        }
        const snapshot = await this.captureGoogleAccountSnapshot();
        return AppRepository_1.repository.upsertAutomationAccount({
            provider: GOOGLE_PROVIDER,
            email: snapshot.email,
            displayName: snapshot.displayName,
            avatarUrl: snapshot.avatarUrl,
            profileUrl: snapshot.profileUrl,
            sessionPartition: GOOGLE_PARTITION,
            status: snapshot.signedIn ? 'connected' : 'attention',
            metadata: {
                title: snapshot.title,
                currentUrl: snapshot.currentUrl,
            },
            lastSyncedAt: Date.now(),
        });
    }
    async resetSession() {
        const browserSession = electron_1.session.fromPartition(GOOGLE_PARTITION);
        await browserSession.clearStorageData();
        await browserSession.clearCache();
        AppRepository_1.repository.deleteAutomationAccount(GOOGLE_PROVIDER);
        return { cleared: true };
    }
    openWindow(url, title) {
        if (this.authWindow && !this.authWindow.isDestroyed()) {
            this.authWindow.setTitle(title);
            this.authWindow.show();
            this.authWindow.focus();
            void this.authWindow.loadURL(url);
            return;
        }
        this.authWindow = new electron_1.BrowserWindow({
            width: 1400,
            height: 920,
            minWidth: 1100,
            minHeight: 760,
            title,
            autoHideMenuBar: false,
            webPreferences: {
                partition: GOOGLE_PARTITION,
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });
        this.authWindow.on('closed', () => {
            this.authWindow = null;
        });
        void this.authWindow.loadURL(url);
    }
    async hasGoogleSession() {
        const browserSession = electron_1.session.fromPartition(GOOGLE_PARTITION);
        const cookies = await browserSession.cookies.get({ domain: '.google.com' });
        return cookies.some((cookie) => ['SID', 'HSID', 'SSID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSID'].includes(cookie.name));
    }
    async captureGoogleAccountSnapshot() {
        const win = new electron_1.BrowserWindow({
            show: false,
            width: 1200,
            height: 900,
            webPreferences: {
                partition: GOOGLE_PARTITION,
                contextIsolation: false,
                nodeIntegration: false,
                sandbox: false,
            },
        });
        try {
            await win.loadURL(GOOGLE_ACCOUNT_URL);
            for (let attempt = 0; attempt < 4; attempt += 1) {
                await wait(1200);
                const raw = await win.webContents.executeJavaScript(GOOGLE_ACCOUNT_SNAPSHOT_JS);
                const parsed = JSON.parse(raw);
                if (parsed.email || parsed.displayName || attempt === 3) {
                    return parsed;
                }
            }
            return {
                email: null,
                displayName: null,
                avatarUrl: null,
                profileUrl: win.webContents.getURL(),
                title: '',
                currentUrl: win.webContents.getURL(),
                signedIn: false,
            };
        }
        finally {
            if (!win.isDestroyed()) {
                win.destroy();
            }
        }
    }
}
exports.googleWebmasterService = new GoogleWebmasterService();
//# sourceMappingURL=GoogleWebmasterService.js.map