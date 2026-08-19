"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElectronWindowProvider = void 0;
const electron_1 = require("electron");
const DEFAULT_SNAPSHOT_CHARS = 24_000;
const DEFAULT_MAX_LINKS = 150;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * A persistent-session Electron BrowserWindow exposed through the BrowserProvider
 * interface. Owns the window lifecycle that previously lived inline in
 * RankAutomationService / GoogleWebmasterAutomationService.
 */
class ElectronWindowProvider {
    options;
    id = 'electron-window';
    window = null;
    constructor(options) {
        this.options = options;
    }
    hasWindow() {
        return Boolean(this.window && !this.window.isDestroyed());
    }
    ensureWindow(visible) {
        if (this.window && !this.window.isDestroyed()) {
            if (visible) {
                this.window.show();
                this.window.focus();
            }
            return this.window;
        }
        this.window = new electron_1.BrowserWindow({
            width: this.options.width ?? 1480,
            height: this.options.height ?? 960,
            minWidth: this.options.minWidth ?? 1100,
            minHeight: this.options.minHeight ?? 760,
            show: visible,
            title: this.options.title ?? '1MarketingTool - Automation',
            webPreferences: {
                partition: this.options.partition,
                contextIsolation: false,
                nodeIntegration: false,
                sandbox: false,
            },
        });
        this.window.on('closed', () => {
            this.window = null;
        });
        return this.window;
    }
    async open(url, options) {
        const win = this.ensureWindow(Boolean(options?.visible));
        if (options?.visible) {
            win.show();
            win.focus();
        }
        const timeoutMs = options?.waitForBodyMs ?? 30_000;
        let loadError = null;
        const loadPromise = win.loadURL(url).catch((error) => {
            loadError = error;
        });
        const bodyPromise = this.waitForBody(win, timeoutMs);
        await Promise.race([loadPromise, bodyPromise]);
        const hasBody = await win.webContents.executeJavaScript('Boolean(document.body)', true).catch(() => false);
        if (!hasBody) {
            if (loadError) {
                throw loadError;
            }
            await bodyPromise;
        }
    }
    async waitForBody(win, timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const ready = await win.webContents.executeJavaScript('Boolean(document.body)', true).catch(() => false);
            if (ready)
                return;
            await sleep(250);
        }
        throw new Error('Page did not finish loading.');
    }
    async snapshot(options) {
        const win = this.requireWindow();
        const maxChars = options?.maxChars ?? DEFAULT_SNAPSHOT_CHARS;
        const maxLinks = options?.maxLinks ?? DEFAULT_MAX_LINKS;
        const includeControls = options?.includeControls ?? false;
        const script = `(${snapshotExtractor()})(${maxChars}, ${maxLinks}, ${includeControls})`;
        const raw = (await win.webContents.executeJavaScript(script, true));
        const base = raw ?? {
            url: win.webContents.getURL(),
            title: '',
            text: '',
            links: [],
            controls: [],
            buttons: [],
        };
        if (options?.screenshot) {
            try {
                const image = await win.webContents.capturePage();
                base.screenshot = image.toPNG();
            }
            catch {
                // Screenshots are best-effort.
            }
        }
        return base;
    }
    async act(steps) {
        const win = this.requireWindow();
        const results = [];
        for (const step of steps) {
            if (step.action === 'wait') {
                await sleep(step.ms);
                results.push({ step, ok: true });
                continue;
            }
            try {
                const script = `(${actStepRunner()})(${JSON.stringify(step)})`;
                const outcome = (await win.webContents.executeJavaScript(script, true));
                results.push({ step, ok: outcome.ok, error: outcome.error });
            }
            catch (error) {
                results.push({ step, ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return { ok: results.every((result) => result.ok), steps: results };
    }
    async isAuthenticated(signedOutSignals) {
        const win = this.requireWindow();
        const text = (await win.webContents
            .executeJavaScript('(document.body && document.body.innerText || "").slice(0, 4000)', true)
            .catch(() => ''));
        return !signedOutSignals.some((signal) => signal.test(text));
    }
    currentUrl() {
        if (!this.window || this.window.isDestroyed())
            return null;
        try {
            return this.window.webContents.getURL();
        }
        catch {
            return null;
        }
    }
    /** webContents id of the automation window, so callers can exclude it from IPC broadcasts. */
    getWebContentsId() {
        if (!this.window || this.window.isDestroyed())
            return null;
        return this.window.webContents.id;
    }
    show() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.show();
            this.window.focus();
        }
    }
    setTitle(title) {
        if (this.window && !this.window.isDestroyed()) {
            this.window.setTitle(title);
        }
    }
    async close() {
        if (this.window && !this.window.isDestroyed()) {
            this.window.close();
        }
        this.window = null;
    }
    async evaluate(script) {
        const win = this.requireWindow();
        return (await win.webContents.executeJavaScript(script, true));
    }
    requireWindow() {
        if (!this.window || this.window.isDestroyed()) {
            throw new Error('Browser window is unavailable. Open the page first.');
        }
        return this.window;
    }
}
exports.ElectronWindowProvider = ElectronWindowProvider;
/** Serialized into the page: returns a provider-agnostic PageSnapshot payload. */
function snapshotExtractor() {
    return `
function(maxChars, maxLinks, includeControls) {
  function clean(value) { return (value || '').replace(/\\s+/g, ' ').trim(); }

  var text = '';
  if (document.body) {
    text = (document.body.innerText || '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
    if (text.length > maxChars) text = text.slice(0, maxChars);
  }

  var links = [];
  var seenLinks = new Set();
  var anchors = Array.from(document.querySelectorAll('a[href]'));
  for (var i = 0; i < anchors.length && links.length < maxLinks; i++) {
    var anchor = anchors[i];
    var href = anchor.href || '';
    var label = clean(anchor.textContent);
    if (!href || href.indexOf('javascript:') === 0) continue;
    var key = label + '|' + href;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    links.push({ text: label.slice(0, 200), href: href });
  }

  var controls = [];
  var buttons = [];
  if (includeControls) {
    var nodes = Array.from(document.querySelectorAll('input, textarea, select'));
    for (var j = 0; j < nodes.length; j++) {
      var node = nodes[j];
      var type = (node.getAttribute('type') || '').toLowerCase();
      if (node.tagName.toLowerCase() === 'input' && (type === 'hidden' || type === 'submit' || type === 'button')) continue;
      controls.push({
        selector: stableSelector(node),
        tag: node.tagName.toLowerCase(),
        type: node.getAttribute('type'),
        name: node.getAttribute('name'),
        id: node.getAttribute('id'),
        placeholder: node.getAttribute('placeholder'),
        ariaLabel: node.getAttribute('aria-label'),
        label: labelFor(node),
        required: node.hasAttribute('required')
      });
    }

    var buttonNodes = Array.from(
      document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')
    );
    var seenButtons = new Set();
    for (var k = 0; k < buttonNodes.length && buttons.length < 40; k++) {
      var button = buttonNodes[k];
      var btnText = clean(button.textContent || button.getAttribute('value') || button.getAttribute('aria-label'));
      var btnSelector = stableSelector(button);
      if (seenButtons.has(btnSelector)) continue;
      seenButtons.add(btnSelector);
      buttons.push({ selector: btnSelector, text: btnText.slice(0, 120), type: button.getAttribute('type') });
    }
  }

  return {
    url: location.href,
    title: document.title || '',
    text: text,
    links: links,
    controls: controls,
    buttons: buttons
  };

  function labelFor(node) {
    if (node.id) {
      var explicit = document.querySelector('label[for="' + cssEscape(node.id) + '"]');
      if (explicit) return clean(explicit.textContent).slice(0, 120);
    }
    var parentLabel = node.closest ? node.closest('label') : null;
    if (parentLabel) return clean(parentLabel.textContent).slice(0, 120);
    return null;
  }

  function stableSelector(node) {
    if (node.id) return '#' + cssEscape(node.id);
    var name = node.getAttribute('name');
    if (name && node.tagName.toLowerCase() !== 'button') {
      return node.tagName.toLowerCase() + '[name="' + cssEscape(name) + '"]';
    }
    // Mark the element so the same selector resolves on later act() calls (same page).
    var existing = node.getAttribute('data-1mt-id');
    if (existing) return '[data-1mt-id="' + existing + '"]';
    var marker = 'mt-' + Math.random().toString(36).slice(2, 10);
    node.setAttribute('data-1mt-id', marker);
    return '[data-1mt-id="' + marker + '"]';
  }

  function cssEscape(value) {
    return String(value).replace(/["\\\\]/g, '\\\\$&');
  }
}
`;
}
/** Serialized into the page: performs a single fill/click/select/waitFor step. */
function actStepRunner() {
    return `
async function(step) {
  function setNativeValue(element, value) {
    var proto = element.tagName.toLowerCase() === 'textarea'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    var setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) { setter.set.call(element, value); } else { element.value = value; }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  try {
    if (step.action === 'waitFor') {
      var timeout = step.timeoutMs || 8000;
      var deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (document.querySelector(step.selector)) return { ok: true };
        await new Promise(function (resolve) { setTimeout(resolve, 200); });
      }
      return { ok: false, error: 'Timed out waiting for ' + step.selector };
    }

    var el = document.querySelector(step.selector);
    if (!el) return { ok: false, error: 'Element not found: ' + step.selector };

    if (step.action === 'fill') {
      el.focus();
      setNativeValue(el, step.value);
      return { ok: true };
    }
    if (step.action === 'select') {
      el.value = step.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    if (step.action === 'click') {
      el.click();
      return { ok: true };
    }
    return { ok: false, error: 'Unknown action: ' + step.action };
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}
`;
}
//# sourceMappingURL=ElectronWindowProvider.js.map