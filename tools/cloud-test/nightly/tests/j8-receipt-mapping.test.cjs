"use strict";
// Nightly AHT suite: J8's one receipt becomes its invocation's case result, fail closed, each row on its own leg only.
const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { J8_SUITE, J8_RECEIPT_MAP, mapJ8Receipt } = require('../j8-receipt-mapping.cjs');
const { splitCaseResult } = require('../case-results.cjs');
const { rowsForLeg } = require('../journey-plan.cjs');

const LEGS = ['J8.a', 'J8.b', 'J8.c'];
const GAP_ROWS = {
    'J8.a': ['invariant:start-press-budget', 'AHT-08:start-press-budget'],
    'J8.b': ['invariant:start-press-budget', 'AHT-07:start-press-budget', 'AHT-07:fresh-acknowledgment', 'AHT-07:received-feedback-proof'],
    'J8.c': [],
};
/** Every receipt step the mapping reads, each PASS, plus account and journey rows the mapping does not consume. */
function passingReceipt(extra = []) {
    const steps = new Set(['receipt content-free', 'zero residue', 'feedback retention', 'feedback fence close', 'telemetry rows']);
    for (const leg of LEGS) for (const sources of Object.values(J8_RECEIPT_MAP[leg]))
        for (const s of sources) if (!s.gap) steps.add(s.scope === 'leg' ? `${leg}: ${s.step}` : s.step);
    return { suite: J8_SUITE, rows: [...[...steps].map((step) => ({ step, verdict: 'PASS', detail: '' })), ...extra] };
}
const without = (r, step) => ({ ...r, rows: r.rows.filter((x) => x.step !== step) });
const withVerdict = (r, step, verdict) => ({ ...r, rows: r.rows.map((x) => (x.step === step ? { ...x, verdict } : x)) });
const rowOf = (out, leg, id) => out.assertions.find((a) => a.leg === leg && a.id === id);
const thrown = (f) => { try { f(); } catch (e) { return String(e.message); } return null; };
const planId = (row) => (row.startsWith('invariant:') || row.startsWith('new:') ? row.slice(row.indexOf(':') + 1) : row);

describe('J8 receipt mapping', () => {
    it('covers exactly every plan row of every J8 leg, once each', () => {
        const out = mapJ8Receipt(passingReceipt());
        for (const leg of LEGS) {
            const ids = out.assertions.filter((a) => a.leg === leg).map((a) => a.id).sort();
            expect(ids).toEqual(rowsForLeg(leg).map(planId).sort());
        }
        expect(out.assertions.length).toBe(13 + 19 + 5);
    });
    it('passes every row a passing receipt proves, and keeps each named gap HOLD with its reason', () => {
        const out = mapJ8Receipt(passingReceipt());
        for (const leg of LEGS) for (const row of rowsForLeg(leg)) {
            const a = rowOf(out, leg, planId(row));
            if (GAP_ROWS[leg].includes(row)) {
                expect(a.result).toBe('HOLD');
                expect(a.sources.some((s) => s.startsWith('GAP: '))).toBe(true);
            } else expect(a.result).toBe('PASS');
        }
    });
    it('lands every row on its own leg through the case-result splitter, with nothing unplaced', () => {
        const split = splitCaseResult('J8', mapJ8Receipt(passingReceipt()));
        for (const leg of LEGS) {
            const rows = split.get(leg);
            expect(Object.keys(rows).sort()).toEqual([...rowsForLeg(leg)].sort());
            expect(Object.keys(rows).filter((k) => k.startsWith('unplaced:'))).toEqual([]);
        }
    });
    it('CONTROL: a missing leg step is HOLD on that leg only, and another leg\'s same step never stands in for it', () => {
        const out = mapJ8Receipt(without(passingReceipt(), 'J8.a: fresh acknowledgment'));
        expect(rowOf(out, 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('HOLD');
        // J8.c's fresh acknowledgment is still in the receipt and still passes J8.c.
        expect(rowOf(out, 'J8.c', 'no-session-choice-with-takes').result).toBe('PASS');
    });
    it('CONTROL: an unprefixed step never proves a leg-scoped row', () => {
        const r = without(passingReceipt([{ step: 'no-session association', verdict: 'PASS' }]), 'J8.a: no-session association');
        expect(rowOf(mapJ8Receipt(r), 'J8.a', 'AHT-08:no-session-association').result).toBe('HOLD');
    });
    it('a FAIL step fails every row that rests on it, and only those', () => {
        const out = mapJ8Receipt(withVerdict(passingReceipt(), 'J8.b: feedback leg request lost: same key on Retry', 'FAIL'));
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-transport-form-retry').result).toBe('FAIL');
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-failure-retry-form').result).toBe('FAIL');
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-rejection-form-retry').result).toBe('PASS');
        expect(rowOf(out, 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('PASS');
    });
    it('a journey-wide step affects every leg: one account, one browser context', () => {
        const out = mapJ8Receipt(withVerdict(passingReceipt(), 'no Cloud speech-to-text request', 'FAIL'));
        for (const leg of LEGS) expect(rowOf(out, leg, 'no-cloud-stt').result).toBe('FAIL');
        const held = mapJ8Receipt(withVerdict(passingReceipt(), 'canary claim in fresh login', 'HOLD'));
        for (const leg of LEGS) expect(rowOf(held, leg, 'owner-bound').result).toBe('HOLD');
    });
    it('HUMAN and EXTERNAL steps are never a PASS', () => {
        for (const v of ['HUMAN', 'EXTERNAL', 'SOMETHING']) {
            const out = mapJ8Receipt(withVerdict(passingReceipt(), 'J8.c: both saved takes unchanged', v));
            expect(rowOf(out, 'J8.c', 'no-session-choice-with-takes').result).toBe('HOLD');
        }
    });
    it('a step written twice keeps its worse verdict', () => {
        const out = mapJ8Receipt(passingReceipt([{ step: 'J8.a: no-session report stored once', verdict: 'FAIL' }]));
        expect(rowOf(out, 'J8.a', 'AHT-08:feedback-stored-once').result).toBe('FAIL');
        // Order does not matter: a FAIL written first is not replaced by a later PASS.
        const r = passingReceipt();
        const first = { ...r, rows: [{ step: 'J8.a: no-session association', verdict: 'FAIL' }, ...r.rows] };
        expect(rowOf(mapJ8Receipt(first), 'J8.a', 'AHT-08:no-session-association').result).toBe('FAIL');
    });
    it('CONTROL: an unconsumed failing step is never ignored: journey-wide floors every leg, leg-scoped floors its own leg', () => {
        const journey = mapJ8Receipt(passingReceipt([{ step: 'scenario execution', verdict: 'FAIL' }]));
        for (const leg of LEGS) expect(journey.assertions.filter((a) => a.leg === leg).every((a) => a.result === 'FAIL')).toBe(true);
        expect(journey.unmapped.filter((u) => u.step === 'scenario execution')).toEqual([{ step: 'scenario execution', outcome: 'FAIL' }]);
        const legOnly = mapJ8Receipt(passingReceipt([{ step: 'J8.c: a renamed row', verdict: 'HOLD' }]));
        expect(legOnly.assertions.filter((a) => a.leg === 'J8.c').every((a) => a.result === 'HOLD')).toBe(true);
        expect(rowOf(legOnly, 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('PASS');
        // An unconsumed PASS (e.g. the content-free row) floors nothing.
        expect(rowOf(mapJ8Receipt(passingReceipt()), 'J8.a', 'AHT-08:fresh-acknowledgment').result).toBe('PASS');
    });
    it('a leg whose prerequisites HOLD was NOT RUN, but an earlier FAIL on it stays FAIL', () => {
        const r = passingReceipt([{ step: 'J8.c: prerequisites', verdict: 'HOLD' }]);
        const out = mapJ8Receipt(r);
        expect(out.assertions.filter((a) => a.leg === 'J8.c').every((a) => a.result === 'NOT_RUN')).toBe(true);
        expect(rowOf(out, 'J8.b', 'AHT-07:feedback-attempts').result).toBe('PASS');
        const failed = mapJ8Receipt(withVerdict(r, 'no Cloud speech-to-text request', 'FAIL'));
        expect(rowOf(failed, 'J8.c', 'no-cloud-stt').result).toBe('FAIL');
        // The splitter reads NOT_RUN as NOT RUN.
        expect(splitCaseResult('J8', out).get('J8.c')['new:no-session-choice-with-takes']).toBe('NOT RUN');
    });
    it('refuses a receipt that is not J8\'s or is malformed', () => {
        expect(thrown(() => mapJ8Receipt(null))).toBe('expected the feedback-association-boundaries-j8 receipt, got nothing');
        expect(thrown(() => mapJ8Receipt({ ...passingReceipt(), suite: 'feedback-association-boundaries-no-session' })))
            .toBe('expected the feedback-association-boundaries-j8 receipt, got feedback-association-boundaries-no-session');
        expect(thrown(() => mapJ8Receipt({ suite: J8_SUITE, rows: [] }))).toBe('the J8 receipt has no rows');
        expect(thrown(() => mapJ8Receipt({ suite: J8_SUITE, rows: [{ step: 'x' }] }))).toBe('the J8 receipt has a malformed row');
    });
    it('every receipt step it reads is a step the J8 spec or its helpers actually write (drift guard)', () => {
        const live = path.resolve(__dirname, '..', '..', '..', '..', 'tests', 'live');
        const sources = ['rwt-feedback-association-boundaries.live.spec.ts', 'helpers/feedbackDiagnosticRef.ts', 'helpers/feedbackAttemptLedger.ts',
            'helpers/rwtHarnessParity.ts', 'helpers/coachingFeedbackAdapter.ts', 'helpers/rwtCoachingCollector.ts', 'helpers/feedbackFence.ts',
            'helpers/rwtAcceptance.ts'].map((f) => fs.readFileSync(path.join(live, f), 'utf8')).join('\n');
        const missing = new Set();
        for (const leg of LEGS) for (const sources_ of Object.values(J8_RECEIPT_MAP[leg])) for (const s of sources_) {
            if (s.gap) continue;
            // A fault-leg row is written from FEEDBACK_LEG_ROWS as one literal; every other step is a literal row name.
            if (!sources.includes(`'${s.step}'`)) missing.add(s.step);
        }
        expect([...missing]).toEqual([]);
    });
});
