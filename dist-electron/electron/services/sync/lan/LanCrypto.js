"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateLanEndpoint = validateLanEndpoint;
exports.validateLanEndpoints = validateLanEndpoints;
exports.createLanKeyPair = createLanKeyPair;
exports.derivePairingKey = derivePairingKey;
exports.lanProof = lanProof;
exports.verifyLanProof = verifyLanProof;
exports.pairingFingerprint = pairingFingerprint;
exports.encryptLanFrame = encryptLanFrame;
exports.decryptLanFrame = decryptLanFrame;
const crypto_1 = __importDefault(require("crypto"));
const net_1 = __importDefault(require("net"));
const canonical_1 = require("../canonical");
const types_1 = require("../types");
function validateLanEndpoint(value) {
    let parsed;
    try {
        parsed = new URL(value);
    }
    catch {
        throw new types_1.SyncError('peer-untrusted', 'The Nearby endpoint is invalid.');
    }
    const octets = parsed.hostname.split('.').map(Number);
    const privateIpv4 = net_1.default.isIPv4(parsed.hostname) && (octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
    const port = Number(parsed.port);
    if (parsed.protocol !== 'http:' || !privateIpv4 || !Number.isInteger(port) || port < 1_024 || port > 65_535 ||
        parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) {
        throw new types_1.SyncError('peer-untrusted', 'Nearby Sync accepts private-network HTTP endpoints only.');
    }
    return `${parsed.protocol}//${parsed.hostname}:${port}`;
}
function validateLanEndpoints(values) {
    if (!Array.isArray(values))
        throw new types_1.SyncError('peer-untrusted', 'Nearby device addresses are invalid.');
    const endpoints = Array.from(new Set(values.map((value) => validateLanEndpoint(String(value)))));
    if (!endpoints.length)
        throw new types_1.SyncError('peer-untrusted', 'The Nearby device has no usable private-network address.');
    return endpoints;
}
function createLanKeyPair() {
    const ecdh = crypto_1.default.createECDH('prime256v1');
    ecdh.generateKeys();
    return { ecdh, publicKey: ecdh.getPublicKey().toString('base64') };
}
function derivePairingKey(pair, remotePublicKey, qrSecret, sessionId) {
    let shared;
    try {
        shared = pair.ecdh.computeSecret(Buffer.from(remotePublicKey, 'base64'));
    }
    catch {
        throw new types_1.SyncError('peer-untrusted', 'The pairing key is invalid.');
    }
    try {
        return Buffer.from(crypto_1.default.hkdfSync('sha256', shared, qrSecret, Buffer.from(`stoicsoft-lan-pair-v1\0${sessionId}`), 32));
    }
    finally {
        shared.fill(0);
    }
}
function lanProof(key, transcript, role) {
    return crypto_1.default.createHmac('sha256', key).update(role).update('\0').update((0, canonical_1.canonicalStringify)(transcript)).digest('base64url');
}
function verifyLanProof(key, transcript, role, proof) {
    const expected = Buffer.from(lanProof(key, transcript, role));
    const actual = Buffer.from(proof);
    return expected.length === actual.length && crypto_1.default.timingSafeEqual(expected, actual);
}
function pairingFingerprint(key) {
    const value = crypto_1.default.createHash('sha256').update('stoicsoft-fingerprint-v1\0').update(key).digest('hex').slice(0, 20).toUpperCase();
    return value.match(/.{1,4}/g).join(' ');
}
function encryptLanFrame(key, value, associatedData) {
    const nonce = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(associatedData));
    const plaintext = Buffer.from((0, canonical_1.canonicalStringify)(value));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function decryptLanFrame(key, frame, associatedData) {
    try {
        const nonce = Buffer.from(frame.nonce, 'base64');
        const tag = Buffer.from(frame.tag, 'base64');
        if (nonce.length !== 12 || tag.length !== 16)
            throw new Error('invalid frame');
        const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAAD(Buffer.from(associatedData));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(Buffer.from(frame.ciphertext, 'base64')), decipher.final()]);
        return JSON.parse(plaintext.toString('utf8'));
    }
    catch {
        throw new types_1.SyncError('peer-untrusted', 'A Nearby Sync frame failed authentication.');
    }
}
//# sourceMappingURL=LanCrypto.js.map