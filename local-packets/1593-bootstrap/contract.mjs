// Local decision-table reference only. No I/O, dispatch, receipt creation, or live authority.
// The operator's adapter must independently authenticate/verify every normalized evidence fact.
export const CASE_MAXIMA = Object.freeze([4, 7, 4, 0, 2, 2, 2, 0, 2, 2, 2, 1, 1, 1, 0]);
const sha = (v) => typeof v === 'string' && /^[a-f0-9]{40}$/.test(v);
const digest = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const count = (v) => Number.isSafeInteger(v) && v >= 0;
const same = (a, b, keys) => keys.every((key) => a?.[key] === b?.[key]);
const held = (reason) => Object.freeze({ eligible: false, reason });

export function assess(input) {
    try {
        const { authority: a, observation: o, ledger: l, caseNumber: n, now } = input;
        if (!Number.isInteger(n) || n < 1 || n > 15) return held('case_out_of_range');
        if (!count(now) || !a || !o || !l) return held('missing_common_evidence');
        if (a.verified !== true || typeof a.campaignId !== 'string' || !a.campaignId
            || !sha(a.releaseSha) || !digest(a.configDigest)
            || !count(a.budget) || a.budget > 30 || a.firstCase !== 1 || a.lastCase !== 15
            || !count(a.validFrom) || !count(a.validUntil) || now < a.validFrom || now > a.validUntil) {
            return held('authority_missing_expired_or_wrong_scope');
        }
        if (o.verified !== true || !count(o.observedAt) || !count(o.validUntil)
            || o.observedAt > now || now > o.validUntil
            || ![o.mainSha, o.servedSha, o.workflowSha].every((v) => v === a.releaseSha)
            || o.configDigest !== a.configDigest) return held('release_config_or_freshness');
        if (o.main !== 'idle' || o.rcGates !== 'idle' || o.production !== 'idle') return held('overlapping_or_unknown_activity');
        if (l.verified !== true || l.campaignId !== a.campaignId || !Array.isArray(l.entries)
            || !Array.isArray(l.inFlight) || !Array.isArray(l.unresolvedCleanup)) return held('ledger_unverified');
        if (l.inFlight.length || l.unresolvedCleanup.length) return held('unresolved_attempt_or_cleanup');
        if (l.entries.length !== n - 1) return held('ledger_not_exact_predecessor_prefix');

        let used = 0;
        const identities = new Set();
        for (let i = 0; i < l.entries.length; i += 1) {
            const r = l.entries[i];
            if (!r || r.caseNumber !== i + 1 || r.campaignId !== a.campaignId
                || r.releaseSha !== a.releaseSha || r.configDigest !== a.configDigest
                || typeof r.runId !== 'string' || !/^\d+$/.test(r.runId)
                || !Number.isSafeInteger(r.runAttempt) || r.runAttempt < 1 || !digest(r.receiptDigest)) {
                return held('receipt_identity_or_order');
            }
            const identity = `${r.runId}/${r.runAttempt}`;
            if (identities.has(identity)) return held('duplicate_run_identity');
            identities.add(identity);
            if (r.terminal !== true || r.reviewed !== true || r.mandatoryReadbackComplete !== true
                || r.dominantStop !== false || !['PASS', 'FAIL', 'HOLD'].includes(r.outcome)) return held('unfinished_or_dominant_receipt');
            if (r.outcome !== 'PASS' && r.continuationApproved !== true) return held('ordinary_outcome_needs_review');
            if (!count(r.requests) || r.requests > CASE_MAXIMA[i]) return held('unknown_or_exceeded_case_requests');
            const c = r.cleanup;
            if (!c || c.kind !== 'run_owned_cleanup' || c.verified !== true || c.residue !== 0
                || c.ownerScope !== 'this_run_only' || c.scopeDigest !== a.cleanupScopeDigest
                || !digest(c.scopeDigest)
                || !same(c, r, ['runId', 'runAttempt', 'campaignId', 'releaseSha'])) return held('cleanup_missing_mismatched_or_not_zero');
            used += r.requests;
        }

        if (n === 1) {
            const b = input.bootstrap;
            if (input.previousReceipt !== null) return held('case_one_must_not_have_predecessor');
            if (!b || b.kind !== 'campaign_start_preflight' || b.verified !== true
                || !same(b, a, ['campaignId', 'releaseSha', 'configDigest'])
                || b.explicitFirstDispatch !== true || b.noEarlierAttempt !== true
                || b.priorCampaignCleanupReconciled !== true) return held('bootstrap_missing_or_not_fresh');
        } else {
            if (input.bootstrap !== null) return held('bootstrap_cannot_replace_predecessor');
            const last = l.entries.at(-1);
            if (!same(input.previousReceipt, last, ['caseNumber', 'runId', 'runAttempt', 'campaignId', 'releaseSha', 'receiptDigest'])
                || !input.previousReceipt) return held('missing_or_wrong_actual_predecessor');
        }

        const maximum = CASE_MAXIMA[n - 1];
        if (used > a.budget || used + maximum > a.budget) return held('insufficient_remaining_request_allowance');
        const invocation = input.invocation;
        if (n === 15) {
            if (a.allowMaintainedReadOnly !== true || invocation?.writesAck !== '' || invocation?.canaryAck !== '') {
                return held('maintained_account_must_be_read_only_without_acks');
            }
        } else if (a.allowRunOwnedCreation !== true || a.allowPermanentRunOwnedCleanup !== true
            || a.allowRunOwnedCanaryClaim !== true || !digest(a.cleanupScopeDigest)
            || invocation?.writesAck !== 'RWT-DISPOSABLE-ACCOUNT-WRITES'
            || invocation?.canaryAck !== 'RWT-CANARY-CLAIM-RUN-OWNED') return held('run_owned_effects_not_authorized');

        return Object.freeze({ eligible: true, reason: n === 1 ? 'explicit_bootstrap' : 'actual_predecessor',
            used, maximum, remainingAfterReservation: a.budget - used - maximum,
            theoreticalProviderReservation: maximum * 3 });
    } catch {
        return held('malformed_evidence');
    }
}
