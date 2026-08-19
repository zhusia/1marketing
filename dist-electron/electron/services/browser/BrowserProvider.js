"use strict";
/**
 * BrowserProvider is the seam that separates *what page we automate* from
 * *which browser does the automating*. Rank, Google Webmaster and Directory
 * automation all talk to this interface instead of owning a BrowserWindow and
 * a pile of injected DOM-scraping JavaScript.
 *
 * Two implementations:
 *   - ElectronWindowProvider: a persistent-session Electron BrowserWindow
 *     (self-contained, no install). Default.
 *   - BrowserMcpProvider: drives the user's real Chrome through the BrowserMCP
 *     extension bridge (optional "real browser" mode, gated behind a setting).
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=BrowserProvider.js.map