"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateJsonLimits = validateJsonLimits;
exports.canonicalStringify = canonicalStringify;
exports.sha256 = sha256;
exports.canonicalHash = canonicalHash;
exports.parseObjectJson = parseObjectJson;
const crypto_1 = require("crypto");
const types_1 = require("./types");
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 1_000_000;
function normalize(value) {
    if (value === undefined)
        return null;
    if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new types_1.SyncError('invalid-input', 'Sync data contains a non-finite number.');
    }
    if (Array.isArray(value))
        return value.map(normalize);
    if (value && typeof value === 'object') {
        const output = Object.create(null);
        for (const key of Object.keys(value).sort()) {
            const current = value[key];
            if (current !== undefined)
                output[key] = normalize(current);
        }
        return output;
    }
    return value;
}
function validateJsonLimits(value) {
    const pending = [{ value, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
        const current = pending.pop();
        nodes += 1;
        if (nodes > MAX_JSON_NODES || current.depth > MAX_JSON_DEPTH) {
            throw new types_1.SyncError('invalid-input', 'Sync JSON exceeds the supported size or nesting limit.');
        }
        if (Array.isArray(current.value)) {
            for (const child of current.value)
                pending.push({ value: child, depth: current.depth + 1 });
        }
        else if (current.value && typeof current.value === 'object') {
            for (const child of Object.values(current.value)) {
                pending.push({ value: child, depth: current.depth + 1 });
            }
        }
    }
}
function canonicalStringify(value) {
    validateJsonLimits(value);
    return JSON.stringify(normalize(value));
}
function sha256(value) {
    return (0, crypto_1.createHash)('sha256').update(value).digest('hex');
}
function canonicalHash(value) {
    return sha256(canonicalStringify(value));
}
function parseObjectJson(value) {
    let parsed;
    try {
        parsed = JSON.parse(value);
    }
    catch {
        throw new types_1.SyncError('invalid-input', 'Sync JSON is malformed.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new types_1.SyncError('invalid-input', 'Sync JSON must contain an object.');
    }
    validateJsonLimits(parsed);
    return parsed;
}
//# sourceMappingURL=canonical.js.map