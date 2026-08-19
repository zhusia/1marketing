"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatePkce = generatePkce;
exports.randomState = randomState;
const crypto_1 = __importDefault(require("crypto"));
/** Base64url (RFC 7636) — no padding, URL-safe alphabet. */
function base64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/** Generate a PKCE verifier + S256 challenge pair. */
function generatePkce() {
    const verifier = base64url(crypto_1.default.randomBytes(32));
    const challenge = base64url(crypto_1.default.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}
/** Opaque anti-CSRF state value echoed back on the redirect. */
function randomState() {
    return base64url(crypto_1.default.randomBytes(16));
}
//# sourceMappingURL=pkce.js.map