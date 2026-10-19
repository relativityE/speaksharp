/** Read private retained receipts locally; emit only allowlisted assertions and input hashes. Never copy raw evidence. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { automatedEvaluation } from '../../tests/live/helpers/rwtAcceptance.ts';

const root = process.argv[2];
assert(root, 'supply the private run-set2 directory');
const release = 'ecce3e8d9e154ddb12f7238a514f0ec85d4b75b4';
const hashes: Record<string, string> = {};
const read = (path: string) => {
    const bytes = readFileSync(resolve(root, path));
    hashes[path] = createHash('sha256').update(bytes).digest('hex');
    return JSON.parse(bytes.toString('utf8'));
};
const c7 = read('case07-run39180129880/receipts/feedback-association-boundaries-older-take.receipt.json');
const rb7 = read('case07-run39180129880/receipts/feedback-association-boundaries-older-take.readback-verdicts.json');
const c10 = read('case10-run39179792398/receipts/abandon-and-two-tabs-close-tab.receipt.json');
const c15 = read('case15-run39179807441/receipts/returning-user-navigation.receipt.json');
type Row = { step: string; verdict: string; evidence?: Record<string, unknown> };
const row = (receipt: { rows: Row[] }, step: string) => {
    const matches = receipt.rows.filter((r) => r.step === step);
    assert.equal(matches.length, 1, `one ${step} row required`);
    return matches[0];
};
for (const r of [c7, c10, c15]) assert.equal(r.release, release);
const merged = automatedEvaluation(c7, rb7);
assert.deepEqual(merged.errors, []);
assert.equal(row(c7, 'older-take association').verdict, 'PASS');
assert.equal(row(c7, 'older-take diagnostic binding').verdict, 'PASS');
assert.equal(row(c7, 'feedback diagnostic chain').evidence?.reasons, 'telemetry_not_received');
assert.equal(row(c7, 'feedback diagnostic chain').evidence?.expectedRequestSha256, undefined);
assert.equal(rb7.coachingDiagnostic, undefined);
assert.equal(rb7.journeys.length, 1);
assert.equal(rb7.journeys[0].verdict, 'QUALIFIED');
const budget7 = row(c7, 'coaching request budget').evidence!;
assert.equal(budget7.browserRequests, 2);
assert.equal(budget7.answered, 2);
assert.equal(typeof budget7.exchangeTimeline, 'string');
assert((budget7.exchangeTimeline as string).split(';').every((entry) => entry.startsWith('answered|502|')));
assert.equal(row(merged, 'journey telemetry received').verdict, 'PASS');
assert.equal(row(merged, 'feedback diagnostic chain').verdict, 'HOLD');
const next = row(c10, 'next take saves only itself');
assert.equal(next.verdict, 'FAIL');
assert.deepEqual(next.evidence, { rowsBefore: 1, rowsAfter: 2, activeAfter: 1 });
assert.equal(row(c15, 'returning-user access').verdict, 'HOLD');
assert.equal(row(c15, 'returning-user access').evidence?.canStart, false);
assert.equal(row(c15, 'returning-user access').evidence?.trialActive, false);
assert.equal(row(c15, 'returning-user access').evidence?.isPro, false);
assert.equal(c15.humanObservations.length, 2);
assert(c15.humanObservations.every((h: { result: string }) => h.result === 'pending'));
for (const step of ['Products → Open Mic', 'Products → Focus Points', 'back to Open Mic', 'returning history', 'no mic on navigation', 'navigation writes nothing']) assert.equal(row(c15, step).verdict, 'PASS');
console.log(JSON.stringify({
    kind: 'independent-retained-receipt-audit', sourceBase: 'ba1a9f5ad31778460a4ea9e383a08be14b3222f6', release, hashes,
    case7: { run: 39180129880, association: 'PASS', olderRequestExclusion: 'PASS', genericShareFeedbackReadback: 'QUALIFIED', finalizerErrors: 0,
        mergedJourneyTelemetry: 'PASS', mergedDiagnosticChain: 'HOLD', sentBindingPresent: false, receivedDiagnosticResultPresent: false,
        conclusion: 'Generic journey qualification cannot settle the diagnostic chain; source path accepts success only, while retained budget records two answered 502s. No association defect established.' },
    case10: { run: 39179792398, historicalVerdict: 'FAIL', rowCounts: next.evidence,
        fenceFieldsRetained: false, leaseIdentityRetained: false,
        conclusion: 'Zero-active oracle rejects the retained recoverable shape; counts alone do not prove permanent fencing, lease exclusion or exact displaced identity.' },
    case15: { run: 39179807441, access: 'HOLD', canStart: false, trialActive: false, isPro: false, navigationRows: 'PASS', pendingPhysicalObservations: 2,
        conclusion: 'No new navigation defect established. An eligible authorized returning fixture and real microphone/phone observations remain required.' },
    limits: ['No new live execution, production query, provider call, account mutation or physical observation.', 'Database controls prove source behavior in PGlite, not the historical or deployed row.', 'Original failures remain preserved.']
}, null, 2));
