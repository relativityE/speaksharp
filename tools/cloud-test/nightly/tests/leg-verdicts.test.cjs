"use strict";
// Nightly AHT suite: NOT RUN and HOLD are never PASS; a dependent leg is NOT RUN when its dependency did not pass.
const { describe, expect, it } = require('./expect-lite.cjs');
const { ALL_LEGS, rowsForLeg } = require('../journey-plan.cjs');
const { legVerdict, runVerdict, verdictLine } = require('../leg-verdicts.cjs');
const ALL_GATES = new Set(['canary-claim-ack', 'unqualified', 'disabled-until-reviewed', 'test-mode-fixture', 'no-safe-production-proof', 'no-harness-case']);
const NO_GATES = new Set();
const results = (leg, o = 'PASS') => Object.fromEntries(rowsForLeg(leg).map((r) => [r, o]));
const prior = (...vs) => new Map(vs.map((v) => [v.leg, v]));
const pass = (leg) => legVerdict(leg, { prior: new Map(), satisfiedGates: ALL_GATES, results: results(leg) });
describe('leg verdict', () => {
    it('passes a leg only when every required row passed', () => {
        expect(pass('J1.a').outcome).toBe('PASS');
        const r = results('J1.a');
        r[Object.keys(r)[3]] = 'FAIL';
        expect(legVerdict('J1.a', { prior: new Map(), satisfiedGates: ALL_GATES, results: r }).outcome).toBe('FAIL');
    });
    it('treats a missing row result as NOT RUN, so the leg is not green', () => {
        const r = results('J3.a');
        delete r[Object.keys(r)[0]];
        const v = legVerdict('J3.a', { prior: new Map(), satisfiedGates: ALL_GATES, results: r });
        expect(v.outcome).toBe('NOT RUN');
    });
    it('folds FAIL over HOLD over NOT RUN', () => {
        const r = results('J4.a');
        const keys = Object.keys(r);
        r[keys[0]] = 'NOT RUN';
        r[keys[1]] = 'HOLD';
        expect(legVerdict('J4.a', { prior: new Map(), satisfiedGates: ALL_GATES, results: r }).outcome).toBe('HOLD');
        r[keys[2]] = 'FAIL';
        expect(legVerdict('J4.a', { prior: new Map(), satisfiedGates: ALL_GATES, results: r }).outcome).toBe('FAIL');
    });
    it('fails a leg that reports a row outside the plan', () => {
        const v = legVerdict('J6', { prior: new Map(), satisfiedGates: ALL_GATES, results: { ...results('J6'), 'AHT-99:made-up': 'PASS' } });
        expect(v.outcome).toBe('FAIL');
    });
    it('reports a leg that did not run as NOT RUN with every row NOT RUN', () => {
        const v = legVerdict('J5.b', { prior: new Map(), satisfiedGates: ALL_GATES });
        expect(v.outcome).toBe('NOT RUN');
        expect(new Set(Object.values(v.rows))).toEqual(new Set(['NOT RUN']));
    });
    it('makes a dependent leg NOT RUN, not FAIL and not PASS, when its dependency failed', () => {
        const failedA = legVerdict('J1.a', { prior: new Map(), satisfiedGates: ALL_GATES, results: results('J1.a', 'FAIL') });
        for (const leg of ['J1.b', 'J1.c', 'J1.d']) {
            const v = legVerdict(leg, { prior: prior(failedA), satisfiedGates: ALL_GATES, results: results(leg) });
            expect(v.outcome).toBe('NOT RUN');
            expect(v.reason).toContain('needs J1.a');
        }
    });
    it('makes a dependent leg NOT RUN when its dependency has no verdict', () => {
        expect(legVerdict('J8.c', { prior: new Map(), satisfiedGates: ALL_GATES, results: results('J8.c') }).outcome).toBe('NOT RUN');
    });
    it('runs J1.e without J1.a, and J1.f only after J1.e passed', () => {
        const failedA = legVerdict('J1.a', { prior: new Map(), satisfiedGates: ALL_GATES, results: results('J1.a', 'FAIL') });
        const e = legVerdict('J1.e', { prior: prior(failedA), satisfiedGates: ALL_GATES, results: results('J1.e') });
        expect(e.outcome).toBe('PASS');
        expect(legVerdict('J1.f', { prior: prior(failedA, e), satisfiedGates: ALL_GATES, results: results('J1.f') }).outcome).toBe('PASS');
    });
    it('reports an unmet gate as its own outcome even when the leg claims passing rows', () => {
        expect(legVerdict('J1.e', { prior: new Map(), satisfiedGates: NO_GATES, results: results('J1.e') }).outcome).toBe('NOT RUN');
        expect(legVerdict('J7.a', { prior: new Map(), satisfiedGates: NO_GATES, results: results('J7.a') }).outcome).toBe('HOLD');
        expect(legVerdict('J9.a', { prior: new Map(), satisfiedGates: NO_GATES, results: results('J9.a') }).outcome).toBe('NOT RUN');
        expect(legVerdict('J9.b', { prior: new Map(), satisfiedGates: NO_GATES, results: results('J9.b') }).outcome).toBe('NOT RUN');
    });
    it('keeps J2 off while its cleanup is unreviewed, even with the canary claim acknowledged', () => {
        const v = legVerdict('J2', { prior: new Map(), satisfiedGates: new Set(['canary-claim-ack', 'no-harness-case']), results: results('J2') });
        expect(v.outcome).toBe('NOT RUN');
        expect(v.reason).toContain('reviewed cleanup');
    });
    it('makes a coaching leg NOT RUN once the run cap is reached, but not a leg without coaching', () => {
        expect(legVerdict('J3.b', { prior: new Map(), satisfiedGates: ALL_GATES, results: results('J3.b'), stoppedForBudget: true }).outcome).toBe('NOT RUN');
        expect(legVerdict('J7.d', { prior: new Map(), satisfiedGates: ALL_GATES, results: results('J7.d'), stoppedForBudget: true }).outcome).toBe('PASS');
    });
});
describe('proof scope', () => {
    it('labels a sandbox pass as not production billing proof, and a production pass without that label', () => {
        const sandbox = verdictLine(pass('J9.a'));
        expect(sandbox).toContain('J9.a PASS');
        expect(sandbox).toContain('not production billing proof');
        expect(verdictLine(pass('J6'))).not.toContain('sandbox');
    });
    it('reports the production J9 leg NOT RUN while there is no safe way to prove it', () => {
        // Every other gate is met, so only the production gate can keep it NOT RUN.
        const v = legVerdict('J9.b', { prior: new Map(), satisfiedGates: new Set(['test-mode-fixture', 'no-harness-case']), results: results('J9.b') });
        expect(v.outcome).toBe('NOT RUN');
        expect(v.reason).toContain('NOT RUN by design');
        expect(v.proofScope).toBe('deployed-production');
    });
});
describe('run verdict', () => {
    const allPass = () => {
        const m = new Map();
        for (const l of ALL_LEGS)
            m.set(l.id, legVerdict(l.id, { prior: m, satisfiedGates: ALL_GATES, results: results(l.id) }));
        return m;
    };
    it('is PASS only when every planned leg passed', () => {
        expect(runVerdict(allPass()).outcome).toBe('PASS');
    });
    it('is never green with a NOT RUN or HOLD leg', () => {
        for (const o of ['NOT RUN', 'HOLD']) {
            const m = allPass();
            m.set('J5.c', { ...m.get('J5.c'), outcome: o });
            expect(runVerdict(m)).toEqual({ outcome: 'INCOMPLETE', notGreen: [`J5.c ${o}`] });
        }
    });
    it('is not green with a planned leg missing', () => {
        const m = allPass();
        m.delete('J9.b');
        expect(runVerdict(m).outcome).toBe('INCOMPLETE');
    });
    it('is FAIL with any failed leg, or an unknown leg', () => {
        const m = allPass();
        m.set('J4.b', { ...m.get('J4.b'), outcome: 'FAIL' });
        expect(runVerdict(m).outcome).toBe('FAIL');
        const n = allPass();
        n.set('J10', { leg: 'J10', outcome: 'PASS', reason: '', proofScope: 'deployed-production', rows: {} });
        expect(runVerdict(n).outcome).toBe('FAIL');
    });
});
