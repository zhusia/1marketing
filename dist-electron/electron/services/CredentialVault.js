"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.credentialVault = exports.CredentialVault = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const keytar_1 = __importDefault(require("keytar"));
const electron_1 = require("electron");
const json_1 = require("../utils/json");
const userDataPath_1 = require("../utils/userDataPath");
const SERVICE_NAME = process.env.ONE_MARKETING_TOOL_CREDENTIAL_SERVICE?.trim() || '1MarketingTool';
const FALLBACK_FILE = 'credential-fallback.json';
const EPHEMERAL_TEST_VAULT = process.argv.includes('--ephemeral-credential-vault');
/**
 * Reserved keychain account under which ALL secrets are stored as a single JSON map
 * (`{ [account]: payloadJson }`). Consolidating every connector/OAuth/storage/AI-provider secret into
 * ONE keychain item means macOS prompts (and "Always Allow" ACL grants) once for the whole vault
 * instead of once per connector. The double-underscore name cannot collide with a real account.
 */
const VAULT_ACCOUNT = '__vault__';
function fallbackPath() {
    return path_1.default.join((0, userDataPath_1.resolveUserDataPath)(), FALLBACK_FILE);
}
function readFallback() {
    const file = fallbackPath();
    if (!fs_1.default.existsSync(file))
        return {};
    const raw = fs_1.default.readFileSync(file, 'utf8');
    return (0, json_1.safeParseJson)(raw, {});
}
function writeFallback(data) {
    const file = fallbackPath();
    // 0600 so other local users can't read the (encrypted) fallback store. Best-effort on non-POSIX FS.
    fs_1.default.writeFileSync(file, (0, json_1.safeStringify)(data), { encoding: 'utf8', mode: 0o600 });
    try {
        fs_1.default.chmodSync(file, 0o600);
    }
    catch {
        /* Windows / FAT — perms not enforceable */
    }
}
/**
 * When the OS keychain (keytar) is unavailable, secrets fall back to a local file — but they are
 * encrypted with Electron `safeStorage` (OS-bound key: Keychain / DPAPI / libsecret), NEVER stored in
 * plaintext. If encryption is unavailable, `setSecret` FAILS CLOSED rather than persist a readable
 * secret (security audit finding: the old base64 fallback was reversible by anyone with file access).
 */
function encryptForFallback(plain) {
    if (!electron_1.safeStorage.isEncryptionAvailable()) {
        throw new Error('Cannot store this credential securely: the OS keychain is unavailable and encrypted fallback is not ' +
            'supported on this system. Unlock your keychain / login keyring and try again.');
    }
    return electron_1.safeStorage.encryptString(plain).toString('base64');
}
/**
 * Decrypt a fallback entry. Current entries are safeStorage ciphertext (base64). Legacy pre-audit
 * builds wrote plaintext base64 — we still read those (so upgrading users don't lose credentials) and
 * they are silently re-encrypted the next time the same account is written.
 */
function decryptFromFallback(encoded) {
    if (electron_1.safeStorage.isEncryptionAvailable()) {
        try {
            const plain = electron_1.safeStorage.decryptString(Buffer.from(encoded, 'base64'));
            if (plain)
                return plain;
        }
        catch {
            /* not safeStorage ciphertext — try the legacy plaintext-base64 format below */
        }
    }
    try {
        const legacy = Buffer.from(encoded, 'base64').toString('utf8');
        JSON.parse(legacy); // our payloads are JSON; if this throws it was real ciphertext we can't read
        return legacy;
    }
    catch {
        return null;
    }
}
/**
 * Process-lifetime cache of the consolidated keychain blob. `null` once resolved means keytar is
 * unavailable and callers should use the encrypted file fallback. The shared promise guards against a
 * startup stampede (many connectors read at once) triggering the migration more than once.
 */
let blobCache = null;
let keytarAvailable = true;
let blobLoad = null;
const ephemeralBlob = {};
/**
 * Fold pre-consolidation per-account keychain items into a single blob, persist it, then delete the
 * old items. Runs at most once (guarded by `blobLoad`) — the first time a build without the
 * consolidated `__vault__` item reads any secret. Each legacy read/delete may prompt once during this
 * one-time pass; afterwards the whole vault is a single item.
 */
async function migrateLegacyItems() {
    const blob = {};
    let legacy = [];
    try {
        legacy = await keytar_1.default.findCredentials(SERVICE_NAME);
    }
    catch {
        legacy = [];
    }
    for (const { account, password } of legacy) {
        if (account === VAULT_ACCOUNT)
            continue; // ignore the consolidated item itself
        if (password)
            blob[account] = password;
    }
    // Persist the consolidated item first so we never delete a legacy item before its value is safe.
    await keytar_1.default.setPassword(SERVICE_NAME, VAULT_ACCOUNT, (0, json_1.safeStringify)(blob));
    for (const account of Object.keys(blob)) {
        try {
            await keytar_1.default.deletePassword(SERVICE_NAME, account);
        }
        catch {
            /* best-effort — a lingering legacy item is harmless; the blob is now the source of truth */
        }
    }
    return blob;
}
async function loadBlob() {
    if (blobCache)
        return blobCache;
    if (!keytarAvailable)
        return null;
    if (!blobLoad) {
        blobLoad = (async () => {
            try {
                const raw = await keytar_1.default.getPassword(SERVICE_NAME, VAULT_ACCOUNT);
                if (raw) {
                    blobCache = (0, json_1.safeParseJson)(raw, {});
                }
                else {
                    // No consolidated item yet → migrate any legacy per-account items into one.
                    blobCache = await migrateLegacyItems();
                }
                return blobCache;
            }
            catch {
                // Keychain unreachable (locked / unsupported) — signal callers to use the file fallback.
                keytarAvailable = false;
                return null;
            }
        })();
    }
    return blobLoad;
}
class CredentialVault {
    async setSecret(account, value) {
        const payload = (0, json_1.safeStringify)(value);
        if (EPHEMERAL_TEST_VAULT) {
            ephemeralBlob[account] = payload;
            return;
        }
        const blob = await loadBlob();
        if (keytarAvailable && blob) {
            const next = { ...blob, [account]: payload };
            try {
                await keytar_1.default.setPassword(SERVICE_NAME, VAULT_ACCOUNT, (0, json_1.safeStringify)(next));
                blobCache = next; // commit to cache only after the keychain write succeeds
                // Keychain now holds the value — drop any stale fallback copy so it can't linger on disk.
                this.pruneFallback(account);
                return;
            }
            catch {
                keytarAvailable = false; // fall through to the encrypted file fallback
            }
        }
        const fallback = readFallback();
        fallback[account] = encryptForFallback(payload);
        writeFallback(fallback);
    }
    async getSecret(account) {
        if (EPHEMERAL_TEST_VAULT) {
            const raw = ephemeralBlob[account];
            return raw ? (0, json_1.safeParseJson)(raw, null) : null;
        }
        const blob = await loadBlob();
        if (blob) {
            const raw = blob[account];
            if (raw)
                return (0, json_1.safeParseJson)(raw, null);
            // Present-but-empty — a value may still be mid-migration in the encrypted fallback below.
        }
        const encoded = readFallback()[account];
        if (!encoded)
            return null;
        const decoded = decryptFromFallback(encoded);
        return decoded ? (0, json_1.safeParseJson)(decoded, null) : null;
    }
    async removeSecret(account) {
        if (EPHEMERAL_TEST_VAULT) {
            delete ephemeralBlob[account];
            return;
        }
        const blob = await loadBlob();
        if (keytarAvailable && blob && account in blob) {
            const next = { ...blob };
            delete next[account];
            try {
                await keytar_1.default.setPassword(SERVICE_NAME, VAULT_ACCOUNT, (0, json_1.safeStringify)(next));
                blobCache = next;
            }
            catch {
                keytarAvailable = false;
            }
        }
        this.pruneFallback(account);
    }
    async hasSecret(account) {
        if (EPHEMERAL_TEST_VAULT)
            return account in ephemeralBlob;
        const secret = await this.getSecret(account);
        return !!secret;
    }
    /** Remove a single account's fallback entry (and the file if now empty). */
    pruneFallback(account) {
        if (!fs_1.default.existsSync(fallbackPath()))
            return;
        const fallback = readFallback();
        if (!(account in fallback))
            return;
        delete fallback[account];
        if (Object.keys(fallback).length === 0) {
            try {
                fs_1.default.rmSync(fallbackPath(), { force: true });
            }
            catch {
                /* best-effort */
            }
        }
        else {
            writeFallback(fallback);
        }
    }
}
exports.CredentialVault = CredentialVault;
exports.credentialVault = new CredentialVault();
//# sourceMappingURL=CredentialVault.js.map