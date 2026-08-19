"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSecurityCritical = isSecurityCritical;
exports.updateEntitled = updateEntitled;
/**
 * §12.4 — security-critical updates are always allowed, even for an expired Pro
 * user, so everyone stays patchable. Strict `=== true` means an unflagged or
 * malformed manifest can never wrongly bypass the window gate.
 */
function isSecurityCritical(update) {
    return update.securityCritical === true;
}
/**
 * Whether the app may OFFER `update` to this user (§12.4). This is a UX gate,
 * not security.
 *
 * - Free (never licensed) → always entitled; the free tier must track latest.
 * - Pro, in window (release date ≤ `updatesUntil`) → entitled.
 * - Pro, expired → NOT entitled to feature releases published past their window;
 *   offering it would push them into a downgrade. Route them to renew instead.
 * - Security-critical release → always entitled.
 *
 * The gate is `isLicensed && !entitled`, never `!canUpdate` — free users have
 * `canUpdate === true` and must keep updating.
 */
function updateEntitled(info, update) {
    // Free / unknown license → always offer.
    if (!info || !info.isLicensed)
        return true;
    // Security-critical bypass (seam).
    if (isSecurityCritical(update))
        return true;
    const until = info.updatesUntil ? new Date(info.updatesUntil).getTime() : NaN;
    const released = update.releaseDate ? new Date(update.releaseDate).getTime() : NaN;
    // If either date is missing/unparseable we cannot prove the release is out of
    // window; fall back to the LicenseService's own verdict rather than wrongly
    // blocking an in-window Pro user (or wrongly offering to an expired one).
    if (Number.isNaN(until) || Number.isNaN(released)) {
        return info.canUpdate;
    }
    return released <= until;
}
//# sourceMappingURL=updateEntitlement.js.map