import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, CASE_MAXIMA } from './contract.mjs';

const S = 'a'.repeat(40), OLD = 'b'.repeat(40), CONFIG = 'c'.repeat(64), CLEANUP = 'd'.repeat(64);
const clone = (v) => structuredClone(v);
function fixture(n = 1, useMaximum = false) {
    const a = { verified: true, campaignId: 'selected-campaign', releaseSha: S, configDigest: CONFIG,
        budget: 30, firstCase: 1, lastCase: 15, validFrom: 1000, validUntil: 2000,
        allowRunOwnedCreation: true, allowPermanentRunOwnedCleanup: true, allowRunOwnedCanaryClaim: true,
        allowMaintainedReadOnly: true, cleanupScopeDigest: CLEANUP };
    const entries = Array.from({ length: n - 1 }, (_, i) => {
        const r = { caseNumber: i + 1, runId: String(100 + i), runAttempt: 1, campaignId: a.campaignId,
            releaseSha: S, configDigest: CONFIG, receiptDigest: String(i + 1).padStart(64, '0'),
            terminal: true, reviewed: true, mandatoryReadbackComplete: true, dominantStop: false,
            outcome: 'PASS', requests: useMaximum ? CASE_MAXIMA[i] : 0 };
        r.cleanup = { kind: 'run_owned_cleanup', verified: true, residue: 0, ownerScope: 'this_run_only',
            scopeDigest: CLEANUP, runId: r.runId, runAttempt: r.runAttempt, campaignId: r.campaignId, releaseSha: S };
        return r;
    });
    return { now: 1500, caseNumber: n, authority: a,
        observation: { verified: true, observedAt: 1400, validUntil: 1600, mainSha: S, servedSha: S,
            workflowSha: S, configDigest: CONFIG, main: 'idle', rcGates: 'idle', production: 'idle' },
        ledger: { verified: true, campaignId: a.campaignId, entries, inFlight: [], unresolvedCleanup: [] },
        bootstrap: n === 1 ? { kind: 'campaign_start_preflight', verified: true, campaignId: a.campaignId,
            releaseSha: S, configDigest: CONFIG, explicitFirstDispatch: true, noEarlierAttempt: true,
            priorCampaignCleanupReconciled: true } : null,
        previousReceipt: n === 1 ? null : clone(entries.at(-1)),
        invocation: { writesAck: n === 15 ? '' : 'RWT-DISPOSABLE-ACCOUNT-WRITES',
            canaryAck: n === 15 ? '' : 'RWT-CANARY-CLAIM-RUN-OWNED' } };
}
const held = (mutate, n = 1) => { const f = fixture(n); mutate(f); assert.equal(assess(f).eligible, false); };

test('case1 bootstraps without any predecessor; it creates no receipt and does not mutate evidence', () => {
    const f = fixture(), before = clone(f);
    assert.deepEqual(assess(f), { eligible: true, reason: 'explicit_bootstrap', used: 0, maximum: 4,
        remainingAfterReservation: 26, theoreticalProviderReservation: 12 });
    assert.deepEqual(f, before);
    assert.equal(f.previousReceipt, null);
});
test('old campaign cleanup can be reconciled without pretending it ran on current S', () => {
    const f = fixture();
    f.bootstrap.historicalCleanupReference = { releaseSha: OLD, residue: 0 };
    assert.equal(assess(f).eligible, true); // reference is provenance, NOT this campaign's predecessor
    f.ledger.unresolvedCleanup.push('old-run-with-unknown-cleanup');
    assert.equal(assess(f).eligible, false);
});
for (let n = 2; n <= 15; n += 1) test(`case${n} accepts its actual finalized predecessor on S`, () => {
    assert.equal(assess(fixture(n, true)).eligible, true);
});
test('maxima sum30; fullFocus includes7 and full+partial remain independent', () => {
    assert.equal(CASE_MAXIMA.reduce((a, b) => a + b, 0), 30);
    assert.deepEqual(CASE_MAXIMA.slice(0, 3), [4, 7, 4]);
});
test('case15 is eligible at exactly exhausted budget with read-only command and all other guards', () => {
    const r = assess(fixture(15, true));
    assert.equal(r.eligible, true); assert.equal(r.used, 30); assert.equal(r.maximum, 0);
    assert.equal(r.remainingAfterReservation, 0);
});
test('insufficient allowance stops before another request-bearing case starts', () => {
    const f = fixture(2, true); f.authority.budget = 10; // used4 + next7 cannot fit
    assert.equal(assess(f).reason, 'insufficient_remaining_request_allowance');
    f.authority.budget = 11; assert.equal(assess(f).eligible, true);
});
const negatives = [
    ['missing authority', (f) => { f.authority = null; }],
    ['expired approval', (f) => { f.authority.validUntil = 1499; }],
    ['unverified approval', (f) => { f.authority.verified = false; }],
    ['larger-than-selected budget', (f) => { f.authority.budget = 31; }],
    ['changed main', (f) => { f.observation.mainSha = OLD; }],
    ['changed served release', (f) => { f.observation.servedSha = OLD; }],
    ['changed workflow revision', (f) => { f.observation.workflowSha = OLD; }],
    ['changed effective config', (f) => { f.observation.configDigest = 'e'.repeat(64); }],
    ['stale guard observation', (f) => { f.observation.validUntil = 1499; }],
    ['future observation', (f) => { f.observation.observedAt = 1501; }],
    ['main action in flight', (f) => { f.observation.main = 'busy'; }],
    ['rc gate in flight', (f) => { f.observation.rcGates = 'busy'; }],
    ['unknown production activity', (f) => { delete f.observation.production; }],
    ['missing bootstrap', (f) => { f.bootstrap = null; }],
    ['bootstrap wrong kind', (f) => { f.bootstrap.kind = 'run_owned_cleanup'; }],
    ['bootstrap wrong release', (f) => { f.bootstrap.releaseSha = OLD; }],
    ['implicit first-case approval', (f) => { f.bootstrap.explicitFirstDispatch = false; }],
    ['unknown prior attempt', (f) => { f.bootstrap.noEarlierAttempt = null; }],
    ['unknown historical cleanup', (f) => { f.bootstrap.priorCampaignCleanupReconciled = null; }],
    ['fabricated case1 predecessor', (f) => { f.previousReceipt = { residue: 0, releaseSha: S }; }],
    ['unverified ledger', (f) => { f.ledger.verified = false; }],
    ['existing case1 attempt', (f) => { f.ledger.inFlight.push('unknown-run'); }],
    ['unresolved cleanup', (f) => { f.ledger.unresolvedCleanup.push('run'); }],
    ['absent cleanup authority', (f) => { f.authority.allowPermanentRunOwnedCleanup = false; }],
    ['absent claim authority', (f) => { f.authority.allowRunOwnedCanaryClaim = false; }],
    ['missing disposable write ack', (f) => { f.invocation.writesAck = ''; }],
];
for (const [name, mutate] of negatives) test(`HOLD: ${name}`, () => held(mutate));
const successorNegatives = [
    ['missing predecessor', (f) => { f.previousReceipt = null; }],
    ['substituted run', (f) => { f.previousReceipt.runId = '999'; }],
    ['substituted retry attempt', (f) => { f.previousReceipt.runAttempt = 2; }],
    ['substituted receipt artifact', (f) => { f.previousReceipt.receiptDigest = 'f'.repeat(64); }],
    ['old-release predecessor', (f) => { f.ledger.entries[0].releaseSha = OLD; f.previousReceipt.releaseSha = OLD; }],
    ['other campaign receipt', (f) => { f.ledger.entries[0].campaignId = 'other'; }],
    ['unfinished predecessor', (f) => { f.ledger.entries[0].terminal = false; }],
    ['missing mandatory received evidence', (f) => { f.ledger.entries[0].mandatoryReadbackComplete = false; }],
    ['dominant stop despite approval', (f) => { f.ledger.entries[0].dominantStop = true; f.ledger.entries[0].continuationApproved = true; }],
    ['unknown request count', (f) => { f.ledger.entries[0].requests = null; }],
    ['over-case request count', (f) => { f.ledger.entries[0].requests = 5; }],
    ['cleanup only attempted', (f) => { f.ledger.entries[0].cleanup.verified = false; }],
    ['nonzero cleanup residue', (f) => { f.ledger.entries[0].cleanup.residue = 1; }],
    ['string zero is not verified numeric zero', (f) => { f.ledger.entries[0].cleanup.residue = '0'; }],
    ['wrong cleanup owner', (f) => { f.ledger.entries[0].cleanup.ownerScope = 'other_account'; }],
    ['wrong cleanup run', (f) => { f.ledger.entries[0].cleanup.runId = '999'; }],
    ['wrong cleanup attempt', (f) => { f.ledger.entries[0].cleanup.runAttempt = 2; }],
    ['incomplete cleanup scope', (f) => { f.ledger.entries[0].cleanup.scopeDigest = 'e'.repeat(64); }],
    ['bootstrap reused for case2', (f) => { f.bootstrap = fixture().bootstrap; }],
    ['unreviewed ordinary failure', (f) => { f.ledger.entries[0].outcome = 'FAIL'; }],
];
for (const [name, mutate] of successorNegatives) test(`HOLD successor: ${name}`, () => held(mutate, 2));
test('reviewed ordinary product failure can continue only with completed mandatory evidence/cleanup', () => {
    const f = fixture(2); f.ledger.entries[0].outcome = 'FAIL'; f.ledger.entries[0].continuationApproved = true;
    assert.equal(assess(f).eligible, true);
    f.ledger.entries[0].mandatoryReadbackComplete = false;
    assert.equal(assess(f).eligible, false);
});
test('case1 cannot be replayed with an already-finalized ledger entry', () => {
    const f = fixture(); f.ledger.entries = fixture(2).ledger.entries;
    assert.equal(assess(f).eligible, false);
});
test('skipped predecessor, duplicate run and out-of-order prefix all HOLD', () => {
    const f = fixture(3);
    f.ledger.entries[1].caseNumber = 3; assert.equal(assess(f).eligible, false);
    const g = fixture(3); g.ledger.entries[1].runId = g.ledger.entries[0].runId;
    assert.equal(assess(g).eligible, false);
    const h = fixture(3); h.ledger.entries.pop(); assert.equal(assess(h).eligible, false);
});
test('zero-budget case still refuses maintained-account write/claim acks or missing scope', () => {
    held((f) => { f.invocation.writesAck = 'RWT-DISPOSABLE-ACCOUNT-WRITES'; }, 15);
    held((f) => { f.invocation.canaryAck = 'RWT-CANARY-CLAIM-RUN-OWNED'; }, 15);
    held((f) => { f.authority.allowMaintainedReadOnly = false; }, 15);
    held((f) => { f.observation.rcGates = 'busy'; }, 15);
});
test('malformed inputs never grant eligibility', () => {
    for (const f of [null, undefined, {}, { caseNumber: 0 }, { caseNumber: 16 }]) assert.equal(assess(f).eligible, false);
});
