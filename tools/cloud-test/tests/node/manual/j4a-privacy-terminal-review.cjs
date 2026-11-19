'use strict';
// Offline contract fixture only; none of these inputs is a production attestation.
const RPC = '/rest/v1/rpc/set_practice_privacy_choices_v1';
const SHA = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const claim = (e, a) => a?.binding === e.binding && a?.owner === e.owner && a?.runId === e.runId;
const ordinal = (v) => Number.isSafeInteger(v) && v > 0;
const hold = (reason) => ({ verdict: 'HOLD', reason });
const exactKeys = (value, keys) => value && typeof value === 'object'
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
function decidePrivacyTerminal(expected, account, baseline, guard, observation) {
    if (!SHA.test(expected?.binding ?? '') || !UUID.test(expected?.owner ?? '')
        || typeof expected.runId !== 'string' || !expected.runId || !SHA.test(expected.attempt ?? '')
        || ![account, baseline, guard, observation].every(item => claim(expected, item))) return hold('identity');
    if (account.newlyRunOwned !== true || account.exactOwnerConfirmed !== true) return hold('owner-not-proven');
    if (baseline.independent !== true || baseline.ownerScoped !== true || !ordinal(baseline.ordinal)
        || !Array.isArray(baseline.rows) || baseline.rows.length !== 0) return hold('baseline-not-absent');
    if (guard.allRelevantWritersObserved !== true || guard.armedBeforeAnyWriter !== true
        || !ordinal(guard.closedOrdinal) || !Array.isArray(guard.writers)) return hold('writer-coverage');
    if (guard.writers.length !== 1) return hold('ambiguous-writers');
    const [writer] = guard.writers;
    const payload = writer?.payload;
    if (!claim(expected, writer) || writer.attempt !== expected.attempt || writer.path !== RPC
        || writer.method !== 'POST' || writer.admitted !== true || writer.forwarded !== true
        || !ordinal(writer.ordinal) || writer.ordinal <= baseline.ordinal || writer.ordinal >= guard.closedOrdinal
        || !exactKeys(payload, ['p_expected_revision', 'p_transcript_save', 'p_ai_coaching'])
        || payload.p_expected_revision !== null || payload.p_transcript_save !== true || payload.p_ai_coaching !== false) {
        return hold('not-exact-first-choice-rpc');
    }
    if (observation.independent !== true || observation.ownerScoped !== true
        || !ordinal(observation.ordinal) || observation.ordinal <= guard.closedOrdinal
        || !Array.isArray(observation.rows) || observation.rows.length !== 1) return hold('forwarded-outcome-unresolved');
    const [row] = observation.rows;
    if (row?.user_id !== expected.owner || row.choice_revision !== 1 || row.consent_version !== 1
        || row.transcript_save !== true || row.ai_coaching !== false) return hold('forwarded-outcome-unresolved');
    return { verdict: 'TERMINAL_ROW_ATTRIBUTED', reason: null };
}
module.exports = { RPC, decidePrivacyTerminal };
