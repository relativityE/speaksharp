// Independent offline characterization of the rejected 7e3e687 adapter, not product acceptance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assess } from '../1593-bootstrap/contract.mjs';
import { parseReceiptLog, ledgerEntry, invocationFor } from '../1593-campaign-helper/collect.mjs';
const S = '3540103e8d86b5a284265443312c61e643bf5304';
const now = 1800000000000;
const authority = { verified: true, campaignId: 'review-only', releaseSha: S, configDigest: 'a'.repeat(64), budget: 30,
    firstCase: 1, lastCase: 15, validFrom: now - 1, validUntil: now + 1000, allowRunOwnedCreation: true,
    allowPermanentRunOwnedCleanup: true, allowRunOwnedCanaryClaim: true, cleanupScopeDigest: 'c'.repeat(64) };
const rows = () => ['run-owned signup', 'canary claim in fresh login', 'run-owned cleanup', 'telemetry decodable']
    .map(step => ({ step, verdict: 'PASS' })).concat({ step: 'coaching request budget', verdict: 'PASS', evidence: { browserRequests: 1 } });
const log = (r, suite = 'unrelated-suite') => 'RUN_OWNED_CLEANUP cleanup_verified residue=0\nRWT_RECEIPT '
    + JSON.stringify({ suite, release: S, rows: r });
function nextCase(r) {
    const entry = ledgerEntry({ caseNumber: 1, runId: '123456', runAttempt: 1, conclusionTerminal: true,
        parsed: parseReceiptLog(log(r)), authority, reviewed: true, continuationApproved: true });
    return assess({ caseNumber: 2, now, authority,
        observation: { verified: true, observedAt: now, validUntil: now + 1000, mainSha: S, servedSha: S, workflowSha: S,
            configDigest: authority.configDigest, main: 'idle', rcGates: 'idle', production: 'idle' },
        ledger: { verified: true, campaignId: authority.campaignId, entries: [entry], inFlight: [], unresolvedCleanup: [] },
        bootstrap: null, previousReceipt: entry, invocation: invocationFor(2) });
}
test('KNOWN GAP: unrelated suite without artifact/readback is accepted by old adapter', () => {
    assert.equal(nextCase(rows()).eligible, true);
});
test('KNOWN GAP: privacy FAIL becomes GO under continuationApproved', () => {
    assert.equal(nextCase(rows().concat({ step: 'receipt content-free', verdict: 'FAIL' })).eligible, true);
});
test('KNOWN GAP: unanswered provider-cost HOLD becomes GO with a numeric browser count', () => {
    const r = rows().filter(x => x.step !== 'coaching request budget').concat({ step: 'coaching request budget', verdict: 'HOLD',
        evidence: { browserRequests: 1, unansweredAtBound: 1, answered: 0, withDiagnostics: 0 } });
    assert.equal(nextCase(r).eligible, true);
});
test('KNOWN GAP: multiple unrelated receipts silently select the first receipt', () => {
    const parsed = parseReceiptLog(log(rows(), 'wrong-first') + '\n' + log(rows(), 'open-mic-first-session'));
    assert.equal(parsed.receipt.suite, 'wrong-first');
    assert.equal(parsed.dominantStop, false);
});
test('SOURCE-FAITHFUL: maintained Open Mic identity labels disagree with adapter requirements', () => {
    const open = readFileSync('tests/live/rwt-open-mic-first-session.live.spec.ts', 'utf8');
    const shared = readFileSync('tests/live/helpers/rwtJourney.ts', 'utf8');
    assert.ok(open.includes("receipt.row('signup', 'PASS'"));
    assert.ok(shared.includes("receipt.row('session bears canary claim'"));
    const r = rows().map(x => ({ ...x, step: x.step === 'run-owned signup' ? 'signup'
        : x.step === 'canary claim in fresh login' ? 'session bears canary claim' : x.step }));
    assert.equal(parseReceiptLog(log(r, 'open-mic-first-session')).dominantStop, true);
});
test('SOURCE-FAITHFUL: Focus helper has no signup PASS row and first-three budget emission is missing', () => {
    const focus = readFileSync('tests/live/helpers/rwtFocusPointsJourney.ts', 'utf8');
    const open = readFileSync('tests/live/rwt-open-mic-first-session.live.spec.ts', 'utf8');
    assert.equal(/receipt\.row\(['"](?:run-owned signup|signup)['"],\s*['"]PASS/.test(focus), false);
    assert.equal(focus.includes('coachingRequestBudgetRow('), false);
    assert.equal(open.includes('coachingRequestBudgetRow('), false);
});
