"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.websiteBrandService = exports.WebsiteBrandService = void 0;
/**
 * GetWebsiteBrand — captures a website's rendered visual language and turns it
 * into a reusable Design Studio system. Remote content is opened only inside a
 * sandboxed, hidden BrowserWindow with no preload or Node access.
 */
const fs_1 = __importDefault(require("fs"));
const net_1 = require("net");
const electron_1 = require("electron");
const AIService_1 = require("../AIService");
const websiteBrandStore_1 = require("./websiteBrandStore");
const WIDTH = 1440;
const HEIGHT = 960;
const LOAD_TIMEOUT_MS = 30_000;
const HEX = /^#[0-9a-fA-F]{6}$/;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
function assertPublicWebsite(url) {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname === '0.0.0.0' ||
        hostname === '::1') {
        throw new Error('Website brand capture only supports public websites.');
    }
    if ((0, net_1.isIP)(hostname) === 4) {
        const [a, b] = hostname.split('.').map(Number);
        if (a === 10 ||
            a === 127 ||
            a === 0 ||
            (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && b === 168)) {
            throw new Error('Website brand capture cannot open private network addresses.');
        }
    }
    if ((0, net_1.isIP)(hostname) === 6 && (/^(fc|fd)/i.test(hostname) || /^fe[89ab]/i.test(hostname))) {
        throw new Error('Website brand capture cannot open private network addresses.');
    }
}
function visualSignalsScript() {
    return `(() => {
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 8 && rect.height > 8 && style.display !== 'none' &&
        style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.05;
    };
    const colorCounts = new Map();
    const fontCounts = new Map();
    const radiusCounts = new Map();
    const bump = (map, value) => {
      const next = clean(value);
      if (!next || next === 'transparent' || next === 'rgba(0, 0, 0, 0)') return;
      map.set(next, (map.get(next) || 0) + 1);
    };
    const candidates = Array.from(document.querySelectorAll(
      'body, header, nav, main, section, article, aside, footer, h1, h2, h3, p, a, button, ' +
      '[role="button"], [class*="hero"], [class*="card"], [class*="cta"]'
    ))
      .filter(visible)
      .slice(0, 180);
    for (const element of candidates) {
      const style = getComputedStyle(element);
      bump(colorCounts, style.backgroundColor);
      bump(colorCounts, style.color);
      bump(colorCounts, style.borderTopColor);
      bump(fontCounts, style.fontFamily);
      bump(radiusCounts, style.borderRadius);
    }
    const selectors = [
      'body', 'header', 'nav', 'main', 'h1', 'h2', 'p', 'a', 'button', '[role="button"]',
      '[class*="hero"]', '[class*="card"]', '[class*="cta"]',
    ];
    const elements = selectors.flatMap((selector) => {
      const element = Array.from(document.querySelectorAll(selector)).find(visible);
      if (!element) return [];
      const style = getComputedStyle(element);
      return [{
        selector,
        backgroundColor: style.backgroundColor,
        color: style.color,
        borderColor: style.borderTopColor,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        borderRadius: style.borderRadius,
      }];
    });
    const variableNames = new Set();
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          const text = rule.cssText || '';
          for (const match of text.matchAll(/--[a-zA-Z0-9-]+/g)) variableNames.add(match[0]);
          if (variableNames.size >= 120) break;
        }
      } catch {}
      if (variableNames.size >= 120) break;
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const cssVariables = {};
    for (const name of Array.from(variableNames).slice(0, 120)) {
      const value = clean(rootStyle.getPropertyValue(name));
      if (value && value.length <= 160) cssVariables[name] = value;
    }
    const ranked = (map, limit) => Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([value, count]) => ({ value, count }));
    return {
      url: location.href,
      title: document.title || '',
      description: document.querySelector('meta[name="description"]')?.content || '',
      colors: ranked(colorCounts, 24),
      fonts: ranked(fontCounts, 12),
      radii: ranked(radiusCounts, 12),
      cssVariables,
      elements,
    };
  })()`;
}
function cssColorToHex(value) {
    if (typeof value !== 'string')
        return null;
    const text = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(text))
        return text.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(text)) {
        return `#${text.slice(1).split('').map((char) => char + char).join('')}`.toLowerCase();
    }
    const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(text);
    if (!match)
        return null;
    const alphaRaw = match[4];
    const alpha = alphaRaw?.endsWith('%') ? Number.parseFloat(alphaRaw) / 100 : Number.parseFloat(alphaRaw ?? '1');
    if (!Number.isFinite(alpha) || alpha < 0.12)
        return null;
    const parts = [match[1], match[2], match[3]].map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))));
    return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}
function luminance(hex) {
    const int = Number.parseInt(hex.slice(1), 16);
    return (0.2126 * ((int >> 16) & 255) + 0.7152 * ((int >> 8) & 255) + 0.0722 * (int & 255)) / 255;
}
function firstHex(values, fallback, reject = []) {
    for (const value of values) {
        const hex = cssColorToHex(value);
        if (hex && !reject.includes(hex))
            return hex;
    }
    return fallback;
}
function variableValues(signals, pattern) {
    return Object.entries(signals.cssVariables)
        .filter(([name]) => pattern.test(name))
        .map(([, value]) => value);
}
function signalFor(signals, selector) {
    return signals.elements.find((element) => element.selector === selector);
}
function cleanFont(value, fallback) {
    if (typeof value !== 'string')
        return fallback;
    const font = value.replace(/[^a-zA-Z0-9 '\",._-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return font && !/^(?:var|url|@)/i.test(font) ? font : fallback;
}
function cleanRadius(value, fallback) {
    if (typeof value !== 'string')
        return fallback;
    const match = /^(\d+(?:\.\d+)?)(px|rem)$/i.exec(value.trim());
    if (!match)
        return fallback;
    const amount = Math.max(0, Math.min(match[2].toLowerCase() === 'rem' ? 3 : 48, Number(match[1])));
    return `${amount}${match[2].toLowerCase()}`;
}
function cleanTracking(value, fallback) {
    if (typeof value !== 'string')
        return fallback;
    const match = /^(-?\d+(?:\.\d+)?)em$/.exec(value.trim());
    if (!match)
        return fallback;
    const amount = Math.max(-0.2, Math.min(0.2, Number(match[1])));
    return `${amount}em`;
}
function extractJsonObject(raw) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const text = fenced ? fenced[1] : raw;
    const start = text.indexOf('{');
    if (start === -1)
        return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped)
                escaped = false;
            else if (char === '\\')
                escaped = true;
            else if (char === '"')
                inString = false;
            continue;
        }
        if (char === '"')
            inString = true;
        else if (char === '{')
            depth += 1;
        else if (char === '}') {
            depth -= 1;
            if (depth === 0) {
                try {
                    const parsed = JSON.parse(text.slice(start, index + 1));
                    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                        ? parsed
                        : null;
                }
                catch {
                    return null;
                }
            }
        }
    }
    return null;
}
function fallbackDraft(signals) {
    const body = signalFor(signals, 'body');
    const main = signalFor(signals, 'main');
    const card = signalFor(signals, '[class*="card"]') ?? signalFor(signals, 'section');
    const action = signalFor(signals, 'button') ?? signalFor(signals, '[role="button"]') ?? signalFor(signals, '[class*="cta"]');
    const link = signalFor(signals, 'a');
    const paragraph = signalFor(signals, 'p');
    const heading = signalFor(signals, 'h1') ?? signalFor(signals, 'h2');
    const backgroundColor = firstHex([...variableValues(signals, /(?:^|-)bg|background/i), body?.backgroundColor, main?.backgroundColor], '#0b0b10');
    const foregroundColor = firstHex([...variableValues(signals, /(?:^|-)fg|foreground|text(?:-primary)?$/i), body?.color, heading?.color], luminance(backgroundColor) > 0.6 ? '#111827' : '#ffffff');
    const accentColor = firstHex([
        ...variableValues(signals, /accent|brand|primary|action/i),
        action?.backgroundColor,
        link?.color,
        ...signals.colors.map((entry) => entry.value),
    ], '#2563eb', [backgroundColor, foregroundColor, '#000000', '#ffffff']);
    const surfaceColor = firstHex([...variableValues(signals, /surface|panel|card/i), card?.backgroundColor, main?.backgroundColor], luminance(backgroundColor) > 0.6 ? '#ffffff' : '#15151c', [backgroundColor]);
    const mutedColor = firstHex([...variableValues(signals, /muted|secondary|subtle/i), paragraph?.color], luminance(backgroundColor) > 0.6 ? '#475569' : '#a1a1aa', [foregroundColor]);
    const borderColor = firstHex([...variableValues(signals, /border|hair|line/i), card?.borderColor, action?.borderColor], luminance(backgroundColor) > 0.6 ? '#e2e8f0' : '#2a2a38');
    const title = signals.title.split(/\s+[|–—-]\s+/)[0]?.trim();
    const host = new URL(signals.url).hostname.replace(/^www\./, '');
    const displayFont = cleanFont(heading?.fontFamily ?? signals.fonts[0]?.value, "'Space Grotesk'");
    const bodyFont = cleanFont(body?.fontFamily ?? paragraph?.fontFamily ?? signals.fonts[0]?.value, "'Inter'");
    const commonRadius = cleanRadius(card?.borderRadius ?? signals.radii[0]?.value, '12px');
    const mode = luminance(backgroundColor) > 0.6 ? 'light' : 'dark';
    const displayName = displayFont.replace(/["']/g, '').split(',')[0];
    return {
        name: `${title || host} website`,
        summary: `Visual style captured from ${host}: ${mode} surfaces, ${accentColor} accent, and ${displayName} typography.`,
        accentColor,
        backgroundColor,
        surfaceColor,
        foregroundColor,
        mutedColor,
        borderColor,
        accentOnColor: luminance(accentColor) > 0.62 ? '#111827' : '#ffffff',
        displayFont,
        bodyFont,
        monoFont: "'JetBrains Mono'",
        radiusSm: cleanRadius(action?.borderRadius, '6px'),
        radiusMd: commonRadius,
        radiusLg: commonRadius,
        trackingDisplay: '-0.025em',
        designGuide: '',
    };
}
function mergeAiDraft(fallback, parsed) {
    if (!parsed)
        return fallback;
    const color = (name, current) => {
        const value = typeof parsed[name] === 'string' ? parsed[name].trim() : '';
        return HEX.test(value) ? value.toLowerCase() : current;
    };
    const text = (name, current, max) => typeof parsed[name] === 'string' && parsed[name].trim() ? parsed[name].trim().slice(0, max) : current;
    return {
        name: text('name', fallback.name, 80),
        summary: text('summary', fallback.summary, 240),
        accentColor: color('accentColor', fallback.accentColor),
        backgroundColor: color('backgroundColor', fallback.backgroundColor),
        surfaceColor: color('surfaceColor', fallback.surfaceColor),
        foregroundColor: color('foregroundColor', fallback.foregroundColor),
        mutedColor: color('mutedColor', fallback.mutedColor),
        borderColor: color('borderColor', fallback.borderColor),
        accentOnColor: color('accentOnColor', fallback.accentOnColor),
        displayFont: cleanFont(parsed.displayFont, fallback.displayFont),
        bodyFont: cleanFont(parsed.bodyFont, fallback.bodyFont),
        monoFont: cleanFont(parsed.monoFont, fallback.monoFont),
        radiusSm: cleanRadius(parsed.radiusSm, fallback.radiusSm),
        radiusMd: cleanRadius(parsed.radiusMd, fallback.radiusMd),
        radiusLg: cleanRadius(parsed.radiusLg, fallback.radiusLg),
        trackingDisplay: cleanTracking(parsed.trackingDisplay, fallback.trackingDisplay),
        designGuide: text('designGuide', '', 12_000),
    };
}
function buildPrompt(signals, screenshotPath) {
    return [
        'You are running GetWebsiteBrand for a local marketing design tool.',
        `Open and inspect this full-page viewport screenshot: ${screenshotPath}`,
        'Use the screenshot as the visual source of truth. The computed browser signals below are supporting evidence.',
        'Extract a reusable brand design system that can guide NEW marketing graphics. Preserve the website\'s identity ' +
            'without copying page content or recreating the page.',
        'Return STRICT JSON only, without prose or code fences.',
        'Rules:',
        '- Every colour must be a six-digit #RRGGBB value sampled or reasonably resolved from the screenshot/signals.',
        '- Name the actual brand/site when visible, followed by “website”.',
        '- The summary is one sentence under 200 characters.',
        '- Fonts are CSS font-family stacks. Keep the observed family first and include a safe fallback.',
        '- Radii must be px or rem values.',
        '- designGuide is concise markdown covering palette roles, typography mood, spacing/density, shapes, imagery, ' +
            'layout/composition, and explicit do/avoid rules.',
        'JSON shape:',
        JSON.stringify({
            name: 'string',
            summary: 'string',
            accentColor: '#RRGGBB',
            backgroundColor: '#RRGGBB',
            surfaceColor: '#RRGGBB',
            foregroundColor: '#RRGGBB',
            mutedColor: '#RRGGBB',
            borderColor: '#RRGGBB',
            accentOnColor: '#RRGGBB',
            displayFont: 'string',
            bodyFont: 'string',
            monoFont: 'string',
            radiusSm: 'string',
            radiusMd: 'string',
            radiusLg: 'string',
            trackingDisplay: 'string',
            designGuide: 'string',
        }, null, 2),
        'Computed browser signals:',
        JSON.stringify(signals, null, 2),
    ].join('\n\n');
}
function buildSpec(sourceUrl, draft) {
    const guide = draft.designGuide.trim() || [
        '## Visual direction',
        draft.summary,
        '',
        '## Composition',
        '- Reuse the observed hierarchy, spacing density, corner treatment, and contrast rhythm.',
        '- Create a new marketing composition; do not reproduce the source page or its copy.',
        '- Keep one clear focal idea and preserve the website palette roles.',
        '',
        '## Do / avoid',
        '- Do use the captured accent, surface contrast, typography mood, and shape language consistently.',
        '- Avoid generic gradients or unrelated aesthetic motifs that dilute the captured identity.',
    ].join('\n');
    return [
        `# ${draft.name}`,
        '> Category: Website brand',
        `> ${draft.summary}`,
        '',
        `Captured from: ${sourceUrl}`,
        '',
        '## Palette',
        `- Background: ${draft.backgroundColor}`,
        `- Surface: ${draft.surfaceColor}`,
        `- Foreground: ${draft.foregroundColor}`,
        `- Muted: ${draft.mutedColor}`,
        `- Border: ${draft.borderColor}`,
        `- Accent: ${draft.accentColor}`,
        `- On accent: ${draft.accentOnColor}`,
        '',
        '## Typography and shape',
        `- Display: ${draft.displayFont}`,
        `- Body: ${draft.bodyFont}`,
        `- Radius scale: ${draft.radiusSm} / ${draft.radiusMd} / ${draft.radiusLg}`,
        '',
        guide,
    ].join('\n');
}
function tokenVars(draft) {
    return {
        '--bg': draft.backgroundColor,
        '--surface': draft.surfaceColor,
        '--surface-warm': draft.surfaceColor,
        '--fg': draft.foregroundColor,
        '--fg-2': draft.mutedColor,
        '--muted': draft.mutedColor,
        '--border': draft.borderColor,
        '--border-soft': draft.borderColor,
        '--accent': draft.accentColor,
        '--accent-on': draft.accentOnColor,
        '--font-display': draft.displayFont,
        '--font-body': draft.bodyFont,
        '--font-mono': draft.monoFont,
        '--tracking-display': draft.trackingDisplay,
        '--radius-sm': draft.radiusSm,
        '--radius-md': draft.radiusMd,
        '--radius-lg': draft.radiusLg,
    };
}
class WebsiteBrandService {
    inflight = new Map();
    async capture(source, options = {}) {
        const sourceUrl = (0, websiteBrandStore_1.normalizeWebsiteBrandUrl)(source);
        assertPublicWebsite(sourceUrl);
        const key = (0, websiteBrandStore_1.websiteBrandId)(sourceUrl);
        const existing = this.inflight.get(key);
        if (existing)
            return (0, websiteBrandStore_1.publicWebsiteBrand)(await existing);
        const promise = this.captureInternal(sourceUrl, options);
        this.inflight.set(key, promise);
        try {
            return (0, websiteBrandStore_1.publicWebsiteBrand)(await promise);
        }
        finally {
            this.inflight.delete(key);
        }
    }
    async captureInternal(sourceUrl, options) {
        const { onProgress } = options;
        onProgress?.('GetWebsiteBrand: opening the website in an isolated browser…');
        const win = new electron_1.BrowserWindow({
            width: WIDTH,
            height: HEIGHT,
            useContentSize: true,
            show: false,
            frame: false,
            webPreferences: {
                partition: 'website-brand-capture',
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                backgroundThrottling: false,
            },
        });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        let navigationError = null;
        const guardNavigation = (event, targetUrl) => {
            try {
                const normalized = (0, websiteBrandStore_1.normalizeWebsiteBrandUrl)(targetUrl);
                assertPublicWebsite(normalized);
            }
            catch (error) {
                navigationError = error instanceof Error ? error : new Error('The website redirected to a blocked address.');
                event.preventDefault();
            }
        };
        win.webContents.on('will-navigate', guardNavigation);
        win.webContents.on('will-redirect', guardNavigation);
        let signals;
        let screenshot;
        try {
            await withTimeout(win.loadURL(sourceUrl), LOAD_TIMEOUT_MS, 'The website took too long to load.');
            if (navigationError)
                throw navigationError;
            await win.webContents
                .executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true', true)
                .catch(() => undefined);
            await delay(850);
            signals = await win.webContents.executeJavaScript(visualSignalsScript(), true);
            const image = await win.webContents.capturePage();
            screenshot = image.toPNG();
            if (!screenshot.length)
                throw new Error('The website rendered without a usable screenshot.');
        }
        finally {
            if (!win.isDestroyed())
                win.destroy();
        }
        const resolvedUrl = (0, websiteBrandStore_1.normalizeWebsiteBrandUrl)(signals.url || sourceUrl);
        assertPublicWebsite(resolvedUrl);
        const screenshotPath = (0, websiteBrandStore_1.websiteBrandScreenshotPath)((0, websiteBrandStore_1.websiteBrandId)(resolvedUrl));
        await fs_1.default.promises.writeFile(screenshotPath, screenshot);
        onProgress?.('GetWebsiteBrand: extracting palette, typography, and layout cues…');
        const fallback = fallbackDraft(signals);
        let parsed = null;
        try {
            const { content } = await AIService_1.aiService.complete(buildPrompt(signals, screenshotPath), {
                conversationId: `website-brand:${(0, websiteBrandStore_1.websiteBrandId)(resolvedUrl)}`,
                agentId: options.agentId ?? null,
                cwd: null,
            });
            parsed = extractJsonObject(content);
        }
        catch {
            // Computed visual signals still produce a useful deterministic system.
        }
        const draft = mergeAiDraft(fallback, parsed);
        const saved = websiteBrandStore_1.websiteBrandStore.upsert({
            sourceUrl: resolvedUrl,
            name: draft.name,
            summary: draft.summary,
            accentColor: draft.accentColor,
            backgroundColor: draft.backgroundColor,
            spec: buildSpec(resolvedUrl, draft),
            vars: tokenVars(draft),
            referenceImagePath: screenshotPath,
        });
        onProgress?.(`GetWebsiteBrand: saved “${saved.name}” for Design Studio`);
        return saved;
    }
}
exports.WebsiteBrandService = WebsiteBrandService;
exports.websiteBrandService = new WebsiteBrandService();
//# sourceMappingURL=WebsiteBrandService.js.map