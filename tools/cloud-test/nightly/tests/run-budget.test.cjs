"use strict";
// Nightly AHT suite: the run budget meets Sam's contract (#1864 review, 14 Nov): frozen per-leg allocations reserved
// before the run, atomic reservation, no retry borrowing, J1.e's probe reserved at its worst case, protected cleanup.
const { describe, expect, it } = require('./expect-lite.cjs');
const { ALL_LEGS, rowsForLeg } = require('../journey-plan.cjs');
const { allGateKinds, countedLimits } = require('../limits.cjs');
const { VerdictLedger, legVerdict, runVerdict } = require('../leg-verdicts.cjs');
const { CLEANUP, COACHING_CEILING_ENV, RunBudget, coachingCeilingFromEnv, planRunBudget } = require('../run-budget.cjs');
const EVERY_GATE = allGateKinds();
const TODAY = new Set();
const cleanupFor = (n = 2) => new Map(ALL_LEGS.map((l) => [l.id, n]));
const plan = (o = {}) => planRunBudget({ satisfiedGates: TODAY, cleanup: cleanupFor(), ...o });

describe('frozen per-leg allocations, reserved before the run', () => {
    it('reserves the whole run up front: 32 coaching and 43 starts with every leg, 30 and 40 today', () => {
        const all = plan({ satisfiedGates: EVERY_GATE });
        expect(all.totals().coaching).toBe(32);
        expect(all.totals().starts).toBe(43);
        expect(all.totals().coaching).toBe(countedLimits(EVERY_GATE).coachingRequests);
        const today = plan();
        expect(today.totals()).toEqual({ coaching: 30, starts: 40, [CLEANUP]: 2 * countedLimits(TODAY).legs.length });
        expect(today.totals().coaching).toBe(countedLimits(TODAY).coachingRequests);
    });
    it("gives each leg its own allocation, and none to a gated leg", () => {
        const b = plan();
        expect(b.allocationOf('J3.a')).toEqual({ coaching: 7, starts: 7, [CLEANUP]: 2 });
        expect(b.allocationOf('J1.c')).toEqual({ coaching: 0, starts: 1, [CLEANUP]: 2 });
        expect(b.allocationOf('J7.a')).toBe(null);
        expect(b.legBudget('J7.a').allocated).toBe(false);
    });
    it('freezes every allocation, so nothing can be moved once the run has started', () => {
        const a = plan().allocationOf('J6');
        expect(Object.isFrozen(a)).toBe(true);
        expect(() => { a.coaching = 99; }).toThrow();
        expect(plan().allocationOf('J6').coaching).toBe(2);
    });
    it('refuses to budget a run when an allocated leg has no cleanup allocation, but not for a gated leg', () => {
        const missing = cleanupFor();
        missing.delete('J4.b');
        expect(() => plan({ cleanup: missing })).toThrow();
        const gatedMissing = cleanupFor();
        gatedMissing.delete('J7.a');
        expect(plan({ cleanup: gatedMissing }).allocationOf('J4.b')).toEqual({ coaching: 2, starts: 2, [CLEANUP]: 2 });
    });
    it('drops whole legs before the start under a lowered ceiling, with the legs that need them, never mid-run', () => {
        const b = plan({ coachingCeiling: 28 });
        expect(b.totals().coaching).toBe(28);
        expect(b.allocationOf('J8.b')).toBe(null);
        expect(b.legBudget('J8.b').reason).toContain('lowered coaching ceiling of 28');
        expect(b.allocationOf('J7.c')).toEqual({ coaching: 1, starts: 3, [CLEANUP]: 2 });
        const dependent = plan({ satisfiedGates: EVERY_GATE, coachingCeiling: 30 });
        expect(dependent.allocationOf('J8.c')).toBe(null);
        expect(dependent.legBudget('J8.c').reason).toContain('needs J8.b');
        expect(plan({ coachingCeiling: 30 }).totals().coaching).toBe(30);
    });
    it('refuses a ceiling above what the legs need, or not a whole number', () => {
        expect(() => plan({ coachingCeiling: 31 })).toThrow();
        expect(() => plan({ coachingCeiling: 2.5 })).toThrow();
        expect(() => new RunBudget(new Map([['J6', { coaching: -1, starts: 0, [CLEANUP]: 0 }]]))).toThrow();
    });
    it('reads a lower ceiling from the environment, never a higher one', () => {
        expect(coachingCeilingFromEnv({}, 30)).toBe(30);
        expect(coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: '' }, 12)).toBe(12);
        expect(coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: '12' }, 30)).toBe(12);
        expect(coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: '0' }, 30)).toBe(0);
        for (const bad of ['31', '1000', '3.5', '-1', 'abc', '1e3'])
            expect(() => coachingCeilingFromEnv({ [COACHING_CEILING_ENV]: bad }, 30)).toThrow();
        expect(() => coachingCeilingFromEnv({}, -1)).toThrow();
    });
});
describe('J1.e probe reserved at its worst case', () => {
    it('reserves one coaching request for the expired-token probe once J1.e can run, and nothing more', () => {
        const b = plan({ satisfiedGates: EVERY_GATE });
        expect(b.allocationOf('J1.e')).toEqual({ coaching: 1, starts: 0, [CLEANUP]: 2 });
        expect(b.reserve('J1.e', 'coaching').granted).toBe(true);
        expect(b.reserve('J1.e', 'coaching').granted).toBe(false);
        expect(b.legBudgetRow('J1.e').outcome).toBe('FAIL');
    });
    it('reserves nothing for it while J1.e is gated', () => {
        expect(plan().allocationOf('J1.e')).toBe(null);
        expect(plan().reserve('J1.e', 'coaching').granted).toBe(false);
    });
});
describe('atomic reservation', () => {
    it('lets exactly the allocation through when many sends race', async () => {
        const b = plan();
        let started = 0;
        const action = async () => { started += 1; await new Promise((r) => setImmediate(r)); return 'sent'; };
        const results = await Promise.all(Array.from({ length: 20 }, () => b.send('J3.a', 'coaching', action)));
        expect(started).toBe(7);
        expect(results.filter((r) => r.sent)).toHaveLength(7);
        expect(results.filter((r) => !r.sent)).toHaveLength(13);
        expect(b.legBudgetRow('J3.a').outcome).toBe('FAIL');
    });
    it('never starts a refused action', async () => {
        const b = plan();
        let started = 0;
        expect((await b.send('J7.a', 'coaching', async () => { started += 1; })).sent).toBe(false);
        expect(started).toBe(0);
    });
});
describe('no retry borrowing', () => {
    it("refuses a leg's retry past its own allocation and stops its ordinary work, without touching any other leg", () => {
        const b = plan();
        expect([1, 2].map(() => b.reserve('J6', 'coaching').granted)).toEqual([true, true]);
        expect(b.reserve('J6', 'coaching').granted).toBe(false);
        expect(b.reserve('J6', 'starts').granted).toBe(false);
        expect(b.legBudgetRow('J6').outcome).toBe('FAIL');
        expect([1, 2].map(() => b.reserve('J4.a', 'coaching').granted)).toEqual([true, true]);
        expect(b.legBudgetRow('J4.a').outcome).toBe('PASS');
        expect(b.allocationOf('J4.b').coaching).toBe(2);
    });
    it('keeps the other legs of the same journey on their own allocations', () => {
        const b = plan();
        b.reserve('J4.a', 'coaching');
        b.reserve('J4.a', 'coaching');
        expect(b.reserve('J4.a', 'coaching').granted).toBe(false);
        expect([1, 2].map(() => b.reserve('J4.b', 'coaching').granted)).toEqual([true, true]);
        expect(b.reserve('J4.b', 'coaching').granted).toBe(false);
    });
    it('has no way to give a reservation back, so a retry always needs a unit of its own', () => {
        const b = plan();
        expect(b.release).toBe(undefined);
        expect(b.transfer).toBe(undefined);
    });
    it('passes a leg that used exactly its allocation', () => {
        const b = plan();
        for (let i = 0; i < 4; i += 1)
            expect(b.reserve('J3.b', 'starts').granted).toBe(true);
        expect(b.legBudgetRow('J3.b').outcome).toBe('PASS');
    });
});
describe('protected cleanup', () => {
    it('keeps ordinary work out of the cleanup pool', () => {
        expect(() => plan().reserve('J6', CLEANUP)).toThrow();
    });
    it('lets a leg that overran its ordinary budget still clean up within its own cleanup allocation', () => {
        const b = plan();
        b.reserve('J6', 'coaching');
        b.reserve('J6', 'coaching');
        b.reserve('J6', 'coaching');
        expect([1, 2].map(() => b.reserveCleanup('J6').granted)).toEqual([true, true]);
        expect(b.reserveCleanup('J6').granted).toBe(false);
    });
    it('fails the budget row of a leg whose cleanup needs more than its cleanup allocation', () => {
        const b = plan();
        b.reserveCleanup('J8.a');
        b.reserveCleanup('J8.a');
        expect(b.legBudgetRow('J8.a').outcome).toBe('PASS');
        b.reserveCleanup('J8.a');
        expect(b.legBudgetRow('J8.a').outcome).toBe('FAIL');
        expect(b.legBudget('J8.a').overrun).toEqual([CLEANUP]);
    });
    it('gives cleanup through send only from the cleanup pool', async () => {
        const b = plan({ cleanup: new Map(ALL_LEGS.map((l) => [l.id, 1])) });
        expect((await b.send('J5.a', CLEANUP, async () => 'ok')).sent).toBe(true);
        expect((await b.send('J5.a', CLEANUP, async () => 'ok')).sent).toBe(false);
        expect(b.reserve('J5.a', 'coaching').granted).toBe(true);
    });
});
describe('budget facts in the verdicts', () => {
    const results = (leg, o = 'PASS') => Object.fromEntries(rowsForLeg(leg).map((r) => [r, o]));
    it('fails an overrunning leg and the run, even though its rows passed', () => {
        const b = plan();
        b.reserve('J6', 'coaching');
        b.reserve('J6', 'coaching');
        b.reserve('J6', 'coaching');
        const ledger = new VerdictLedger();
        const v = ledger.record(legVerdict('J6', { prior: ledger.verdicts(), satisfiedGates: EVERY_GATE, results: results('J6'), budget: b.legBudget('J6') }));
        expect(v.outcome).toBe('FAIL');
        ledger.record({ ...v, outcome: 'NOT RUN' });
        expect(runVerdict(ledger.verdicts()).outcome).toBe('FAIL');
    });
    it('reports a leg left out before the run as NOT RUN', () => {
        const b = plan({ coachingCeiling: 28 });
        const v = legVerdict('J8.b', { prior: new Map(), satisfiedGates: EVERY_GATE, results: undefined, budget: b.legBudget('J8.b') });
        expect(v.outcome).toBe('NOT RUN');
        expect(v.reason).toContain('no budget allocation');
    });
});
