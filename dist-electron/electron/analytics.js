"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAnalytics = initAnalytics;
exports.setAnalyticsConsentReader = setAnalyticsConsentReader;
exports.trackEvent = trackEvent;
const main_1 = require("@aptabase/electron/main");
const APTABASE_APP_KEY = 'A-US-0633182141';
let consentReader = null;
let initialized = false;
function initAnalytics() {
    if (initialized)
        return;
    try {
        void (0, main_1.initialize)(APTABASE_APP_KEY).catch((error) => {
            if (process.env.NODE_ENV !== 'production') {
                console.warn('[analytics] Aptabase initialization failed:', error);
            }
        });
        initialized = true;
    }
    catch (error) {
        if (process.env.NODE_ENV !== 'production') {
            console.warn('[analytics] Aptabase initialization failed:', error);
        }
    }
}
function setAnalyticsConsentReader(reader) {
    consentReader = reader;
}
function canTrack() {
    if (!consentReader)
        return false;
    try {
        return consentReader();
    }
    catch {
        return false;
    }
}
function trackEvent(name, props) {
    if (!initialized || !canTrack())
        return;
    if (process.env.NODE_ENV !== 'production') {
        console.log('[analytics:main]', name, props ?? '');
    }
    try {
        void (0, main_1.trackEvent)(name, props).catch(() => undefined);
    }
    catch {
        // Analytics must never break the app.
    }
}
//# sourceMappingURL=analytics.js.map