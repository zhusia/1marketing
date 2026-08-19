"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planRecordMerge = planRecordMerge;
const clock_1 = require("./clock");
const canonical_1 = require("./canonical");
function stateClock(state) {
    return { wall: state.clock_wall, counter: state.clock_counter, deviceId: state.origin_device_id };
}
function semanticPayloadHash(recordType, payload) {
    if (!payload)
        return (0, canonical_1.canonicalHash)(payload);
    const normalized = { ...payload };
    delete normalized.created_at;
    delete normalized.updated_at;
    if (recordType === 'automation_assignment')
        delete normalized.clock_json;
    return (0, canonical_1.canonicalHash)(normalized);
}
function payloadsEquivalent(current, remote) {
    if (current.content_hash === remote.payloadHash)
        return true;
    if (!current.payload_json || !remote.payload)
        return false;
    try {
        const localPayload = JSON.parse(current.payload_json);
        return semanticPayloadHash(remote.recordType, localPayload) === semanticPayloadHash(remote.recordType, remote.payload);
    }
    catch {
        return false;
    }
}
function seededDefaultWorkspaceDecision(current, remote) {
    if (remote.recordType !== 'workspace' ||
        remote.recordId !== 'workspace-default' ||
        remote.operation !== 'upsert' ||
        remote.baseClock !== null ||
        !current.payload_json ||
        !remote.payload)
        return null;
    try {
        const localPayload = JSON.parse(current.payload_json);
        const isPlaceholder = (payload) => payload.id === 'workspace-default' &&
            payload.name === 'Unnamed' &&
            payload.is_default === 1 &&
            payload.sort_order === 0;
        const localIsPlaceholder = isPlaceholder(localPayload);
        const remoteIsPlaceholder = isPlaceholder(remote.payload);
        if (localIsPlaceholder === remoteIsPlaceholder)
            return null;
        return localIsPlaceholder
            ? { action: 'apply', conflict: false, winningSide: 'remote' }
            : { action: 'ignore', conflict: false, winningSide: 'local' };
    }
    catch {
        return null;
    }
}
function planRecordMerge(current, remote) {
    if (!current)
        return { action: 'apply', conflict: false, winningSide: 'remote' };
    const seededWorkspaceDecision = seededDefaultWorkspaceDecision(current, remote);
    if (seededWorkspaceDecision)
        return seededWorkspaceDecision;
    const clock = stateClock(current);
    if (current.deleted && remote.operation === 'upsert' && !(0, clock_1.clocksEqual)(remote.revivesClock, clock)) {
        return { action: 'ignore', conflict: false, winningSide: 'local' };
    }
    const ordering = (0, clock_1.compareClocks)(remote.clock, clock);
    const conflict = current.origin_device_id !== remote.originDeviceId &&
        !(0, clock_1.clocksEqual)(remote.baseClock, clock) && !payloadsEquivalent(current, remote);
    return {
        action: ordering > 0 ? 'apply' : 'ignore',
        conflict,
        winningSide: ordering > 0 ? 'remote' : 'local',
    };
}
//# sourceMappingURL=merge.js.map