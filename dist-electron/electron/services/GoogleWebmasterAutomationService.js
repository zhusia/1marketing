"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.googleWebmasterAutomationService = void 0;
const electron_1 = require("electron");
const channels_1 = require("../ipc/channels");
const AppRepository_1 = require("./AppRepository");
const domain_1 = require("../utils/domain");
const GOOGLE_PARTITION = 'persist:1marketingtool-automation';
const GOOGLE_SEARCH_CONSOLE_URL = 'https://search.google.com/search-console';
const DELAY_BETWEEN_CAPTURES_MS = 1500;
const SCRAPE_PAGE_JS = `
  (function() {
    function text(node) {
      return node && node.textContent ? node.textContent.trim().replace(/\\s+/g, ' ') : '';
    }
    function pick(selector, limit) {
      return Array.from(document.querySelectorAll(selector)).slice(0, limit);
    }
    var headings = pick('h1, h2, h3', 30).map(text).filter(Boolean);
    var tables = pick('table', 4).map(function(table) {
      return Array.from(table.querySelectorAll('tr')).slice(0, 15).map(function(row) {
        return Array.from(row.querySelectorAll('th, td')).slice(0, 8).map(text).filter(Boolean);
      }).filter(function(row) { return row.length > 0; });
    });
    return JSON.stringify({
      url: location.href,
      title: document.title || '',
      hostname: location.hostname,
      pageText: document.body ? (document.body.innerText || '').slice(0, 180000) : '',
      metadata: {
        headings: headings,
        tables: tables,
        capturedAt: Date.now()
      }
    });
  })()
`;
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function buildIndexUrl(rawDomain) {
    const resourceId = encodeURIComponent(`sc-domain:${(0, domain_1.extractDomain)(rawDomain)}`);
    return `${GOOGLE_SEARCH_CONSOLE_URL}/index?resource_id=${resourceId}&hl=en`;
}
function buildPerformanceUrl(rawDomain) {
    const resourceId = encodeURIComponent(`sc-domain:${(0, domain_1.extractDomain)(rawDomain)}`);
    return `${GOOGLE_SEARCH_CONSOLE_URL}/performance/search-analytics?resource_id=${resourceId}&hl=en`;
}
// The Links report (top linking sites/text) is UI-only — Google never exposed it through the
// Search Console API — so we capture it from the signed-in UI.
function buildLinksUrl(rawDomain) {
    const resourceId = encodeURIComponent(`sc-domain:${(0, domain_1.extractDomain)(rawDomain)}`);
    return `${GOOGLE_SEARCH_CONSOLE_URL}/links?resource_id=${resourceId}&hl=en`;
}
function buildCaptureTargets(products) {
    return products.flatMap((product) => [
        {
            product,
            pageKind: 'performance',
            targetUrl: buildPerformanceUrl(product.url),
        },
        {
            product,
            pageKind: 'index',
            targetUrl: buildIndexUrl(product.url),
        },
    ]);
}
class GoogleWebmasterAutomationService {
    running = false;
    automationWindow = null;
    progress = {
        status: 'idle',
        currentProductId: null,
        currentUrl: null,
        processedCount: 0,
        totalCount: 0,
        message: '',
        results: [],
        errors: [],
    };
    isRunning() {
        return this.running;
    }
    getProgress() {
        return { ...this.progress };
    }
    async start(productId, mode = 'headed') {
        if (this.running) {
            throw new Error('Google Webmaster automation is already running.');
        }
        const products = productId
            ? [AppRepository_1.repository.getProduct(productId)].filter(Boolean)
            : AppRepository_1.repository.listProducts();
        if (products.length === 0) {
            throw new Error('No products found to capture.');
        }
        const targets = buildCaptureTargets(products);
        this.running = true;
        this.progress = {
            status: 'running',
            currentProductId: null,
            currentUrl: null,
            processedCount: 0,
            totalCount: targets.length,
            message: 'Starting Google Webmaster automation...',
            results: [],
            errors: [],
        };
        this.emitProgress();
        try {
            this.createWindow(mode);
            for (let index = 0; index < targets.length; index += 1) {
                const target = targets[index];
                this.progress.currentProductId = target.product.id;
                this.progress.currentUrl = target.targetUrl;
                this.progress.message = `Capturing ${target.product.name} ${target.pageKind} (${index + 1}/${targets.length})...`;
                this.emitProgress();
                try {
                    const capture = await this.captureProduct(target);
                    this.progress.results.push(capture);
                }
                catch (error) {
                    this.progress.errors.push({
                        productId: target.product.id,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    });
                }
                this.progress.processedCount += 1;
                this.emitProgress();
                if (index < targets.length - 1) {
                    await wait(DELAY_BETWEEN_CAPTURES_MS);
                }
            }
            this.progress.status = 'completed';
            this.progress.currentProductId = null;
            this.progress.currentUrl = null;
            this.progress.message = `Completed. Captured ${this.progress.results.length} page(s), ${this.progress.errors.length} error(s).`;
        }
        catch (error) {
            this.progress.status = 'failed';
            this.progress.message = error instanceof Error ? error.message : 'Google Webmaster automation failed.';
        }
        finally {
            this.running = false;
            this.destroyWindow();
            this.emitProgress();
        }
    }
    createWindow(mode) {
        if (this.automationWindow && !this.automationWindow.isDestroyed())
            return;
        this.automationWindow = new electron_1.BrowserWindow({
            width: 1480,
            height: 960,
            show: mode === 'headed',
            title: '1MarketingTool — Google Webmaster Automation',
            webPreferences: {
                partition: GOOGLE_PARTITION,
                contextIsolation: false,
                nodeIntegration: false,
                sandbox: false,
            },
        });
        this.automationWindow.on('closed', () => {
            this.automationWindow = null;
        });
    }
    destroyWindow() {
        if (this.automationWindow && !this.automationWindow.isDestroyed()) {
            this.automationWindow.close();
        }
        this.automationWindow = null;
    }
    async captureProduct(target) {
        if (!this.automationWindow || this.automationWindow.isDestroyed()) {
            throw new Error('Automation window is unavailable.');
        }
        const win = this.automationWindow;
        await win.loadURL(target.targetUrl);
        await wait(2200);
        const finalUrl = win.webContents.getURL();
        if (/accounts\.google\.com/i.test(finalUrl)) {
            throw new Error('Google session required. Sign in from Automation > Google Webmaster first.');
        }
        const raw = await win.webContents.executeJavaScript(SCRAPE_PAGE_JS);
        const parsed = JSON.parse(raw);
        return AppRepository_1.repository.createBrowserCapture({
            matchedProductId: target.product.id,
            source: 'google_webmaster_automation',
            hostname: parsed.hostname || (0, domain_1.extractDomain)(parsed.url || target.product.url),
            url: parsed.url || target.targetUrl,
            title: parsed.title || `${target.product.name} ${target.pageKind}`,
            pageText: parsed.pageText || '',
            metadata: {
                ...parsed.metadata,
                automation: 'google_webmaster',
                pageKind: target.pageKind,
                targetUrl: target.targetUrl,
                productName: target.product.name,
            },
        });
    }
    /**
     * On-demand capture of just the GSC Links report for one property (used by the Links view button).
     * Opens a visible window on the app's persisted Google session so the user can sign in inline if
     * needed, waits for the report to render, scrapes it, and saves a capture.
     */
    async captureProductLinks(productId) {
        if (this.running) {
            throw new Error('Google Webmaster automation is already running. Try again when it finishes.');
        }
        const product = productId ? AppRepository_1.repository.getProduct(productId) : null;
        if (!product) {
            throw new Error('Select a property before capturing Search Console links.');
        }
        const targetUrl = buildLinksUrl(product.url);
        const win = new electron_1.BrowserWindow({
            width: 1480,
            height: 960,
            show: true,
            title: `Search Console Links — ${product.name}`,
            webPreferences: {
                partition: GOOGLE_PARTITION,
                contextIsolation: false,
                nodeIntegration: false,
                sandbox: false,
            },
        });
        try {
            await win.loadURL(targetUrl);
            // Allow up to 3 minutes so the user can complete Google sign-in in the window if needed.
            const ready = await this.waitForContent(win, /top linking/i, 180000);
            if (!ready) {
                const finalUrl = win.isDestroyed() ? '' : win.webContents.getURL();
                if (/accounts\.google\.com/i.test(finalUrl)) {
                    throw new Error('Google sign-in was not completed. Sign in to Search Console in the window, then capture again.');
                }
                throw new Error('Timed out waiting for the Search Console Links report to load.');
            }
            const raw = await win.webContents.executeJavaScript(SCRAPE_PAGE_JS);
            const parsed = JSON.parse(raw);
            return AppRepository_1.repository.createBrowserCapture({
                matchedProductId: product.id,
                source: 'google_webmaster_automation',
                hostname: parsed.hostname || (0, domain_1.extractDomain)(parsed.url || product.url),
                url: parsed.url || targetUrl,
                title: parsed.title || `${product.name} links`,
                pageText: parsed.pageText || '',
                metadata: {
                    ...parsed.metadata,
                    automation: 'google_webmaster',
                    pageKind: 'links',
                    targetUrl,
                    productId: product.id,
                    productName: product.name,
                    // Captured page hostname is search.google.com; record the product identity so consumers
                    // (e.g. the backlink profile) can match this capture back to the property.
                    productDomain: (0, domain_1.extractDomain)(product.url),
                },
            });
        }
        finally {
            if (!win.isDestroyed())
                win.destroy();
        }
    }
    /** Poll the window until its visible text matches `pattern`; returns false on timeout/close. */
    async waitForContent(win, pattern, timeoutMs) {
        const start = Date.now();
        await wait(1500);
        while (Date.now() - start < timeoutMs) {
            if (win.isDestroyed())
                return false;
            try {
                const text = (await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""'));
                if (typeof text === 'string' && pattern.test(text))
                    return true;
            }
            catch {
                // Ignore transient evaluation errors during navigation/redirects.
            }
            await wait(1000);
        }
        return false;
    }
    emitProgress() {
        try {
            const windows = electron_1.BrowserWindow.getAllWindows();
            for (const win of windows) {
                if (win !== this.automationWindow) {
                    win.webContents.send(channels_1.CHANNELS.AUTOMATION_GOOGLE_WEBMASTER_PROGRESS, this.progress);
                }
            }
        }
        catch {
            // Non-fatal
        }
    }
}
exports.googleWebmasterAutomationService = new GoogleWebmasterAutomationService();
//# sourceMappingURL=GoogleWebmasterAutomationService.js.map