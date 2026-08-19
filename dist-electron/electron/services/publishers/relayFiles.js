"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.relayConfigured = relayConfigured;
exports.uploadToRelay = uploadToRelay;
exports.deleteFromRelay = deleteFromRelay;
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const hostedConfig_1 = require("../../generated/hostedConfig");
/**
 * Client for the ephemeral media relay (relay-files.1marketingtool.com) — see
 * docs/channel_implementation/channels/instagram.md. Instagram's publish API only accepts a public
 * `image_url`/`video_url` (no binary upload), so a *local* file is briefly hosted on our VPS, handed
 * to Meta as a URL, then deleted once the post is confirmed live (a cron sweep is the backstop).
 *
 * BYO-friendly: assets that already have a public HTTPS URL skip this entirely (the publisher checks
 * the media path first). The relay never touches OAuth tokens — it is a dumb file host.
 */
const BASE = (process.env.MARKETING_RELAY_FILES_BASE || 'https://relay-files.1marketingtool.com').replace(/\/+$/, '');
// Runtime env wins (dev/self-host); otherwise the token baked into the build by gen-hosted-config.
const TOKEN = process.env.MARKETING_RELAY_UPLOAD_TOKEN || hostedConfig_1.HOSTED_CONFIG.relayUploadToken || '';
// Extension the relay stores under, derived from the content type (mirrors the relay's allowlist).
const EXT_BY_TYPE = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
};
function relayConfigured() {
    return TOKEN.length > 0;
}
/** Upload bytes to the relay; returns the public URL Meta will fetch + the key used to delete it later. */
async function uploadToRelay(buffer, contentType) {
    if (!TOKEN) {
        throw new Error('The media relay is not configured (MARKETING_RELAY_UPLOAD_TOKEN is unset). Instagram needs a public media ' +
            'URL — set the relay token, or attach an asset that already has a public URL.');
    }
    const ext = EXT_BY_TYPE[contentType.toLowerCase()] || 'bin';
    const form = new form_data_1.default();
    form.append('file', buffer, { filename: `upload.${ext}`, contentType });
    const { data } = await axios_1.default.post(`${BASE}/v1/upload`, form, {
        headers: { ...form.getHeaders(), Authorization: `Bearer ${TOKEN}` },
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
    });
    const url = data?.url;
    const key = data?.key;
    if (!url || !key)
        throw new Error('The media relay did not return an upload URL.');
    return { url, key };
}
/** Delete a previously uploaded file. Best-effort — the relay's cron sweep cleans up anything missed. */
async function deleteFromRelay(key) {
    if (!TOKEN || !key)
        return;
    await axios_1.default.delete(`${BASE}/v1/files/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
        timeout: 15000,
    });
}
//# sourceMappingURL=relayFiles.js.map