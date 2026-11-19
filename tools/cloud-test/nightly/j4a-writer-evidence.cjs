'use strict';
// Offline decision contract. This module does not make requests or grant cleanup.
// Inputs must come from the verified parent/supervisor and the reviewed guard,
// not a child step result or a caller-supplied attestation.
const SHA = /^[a-f0-9]{64}$/;
const KINDS = new Set(['signup', 'start', 'save', 'coaching', 'lease']);
const hold = (reason) => ({ verdict: 'HOLD', reason });

function decideJ4aWriters(expected, supervisor, journal) {
    if (!SHA.test(expected?.binding ?? '') || !SHA.test(expected?.droppedSave ?? '')
        || supervisor?.binding !== expected.binding || journal?.binding !== expected.binding) return hold('binding');
    if (supervisor.exited !== true || supervisor.ownedPagesClosed !== true
        || supervisor.descendantCount !== 0 || supervisor.interrupted !== false) return hold('writers-not-stopped');
    if (journal.armedBeforeLaunch !== true || journal.closedAfterLastWriter !== true
        || journal.integrityVerified !== true || !Array.isArray(journal.attempts)
        || supervisor.guardTransportDrained !== true) return hold('incomplete-observation');
    const seen = new Set();
    let drops = 0;
    for (const event of journal.attempts) {
        if (!SHA.test(event?.attempt ?? '') || seen.has(event.attempt) || !KINDS.has(event.kind)) return hold('attempt-integrity');
        seen.add(event.attempt);
        if (event.kind === 'save' && event.attempt === expected.droppedSave
            && event.decision === 'planned-request-lost' && event.upstreamStarted === false) {
            ++drops;
            continue;
        }
        // A local abort or socket "finish" is not server completion. A terminal
        // witness must be produced by the reviewed endpoint-specific oracle.
        if (event.decision !== 'forwarded' || event.upstreamStarted !== true
            || event.terminal?.attempt !== event.attempt || event.terminal?.backendConfirmed !== true)
            return hold('backend-write-unresolved');
    }
    if (drops !== 1) return hold('planned-drop-unproven');
    return { verdict: 'STOPPED', reason: null };
}

// In-process provenance prevents a serialized child/command result from being
// treated as a capability. Only reviewed parent wiring may supply these input records.
const verified = new WeakMap();
function verifyJ4aStoppedWriters(expected, supervisor, journal) {
    const { binding, runId, owner } = expected ?? {};
    if (typeof runId !== 'string' || !runId || typeof owner !== 'string' || !owner
        || supervisor?.runId !== runId || supervisor?.owner !== owner
        || journal?.runId !== runId || journal?.owner !== owner
        || !Number.isFinite(supervisor.writersClosedAt) || supervisor.writersClosedAt <= 0
        || decideJ4aWriters(expected, supervisor, journal).verdict !== 'STOPPED') return null;
    const token = Object.freeze({});
    verified.set(token, Object.freeze({ binding, runId, owner, writersClosedAt: supervisor.writersClosedAt }));
    return token;
}
function readJ4aStoppedWriters(token, expected) {
    const proof = verified.get(token);
    return proof && proof.binding === expected.binding && proof.runId === expected.runId && proof.owner === expected.owner ? proof : null;
}

module.exports = { decideJ4aWriters, verifyJ4aStoppedWriters, readJ4aStoppedWriters };
