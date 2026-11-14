"use strict";
// Nightly AHT suite: the coaching hard stop is enforced per journey, sends nothing past a journey's cap, and a
// journey's retry can never use another journey's allowance (#1864 at 098f0ae, §6).
const { describe, expect, it } = require('./expect-lite.cjs');
const { COACHING_CAP_ENV, CoachingBudget, coachingCapFromEnv, journeyCoachingCaps, minimumCoachingCap } = require('../coaching-budget.cjs');
const EVERY_GATE = new Set(['canary-claim-ack', 'unqualified', 'disabled-until-reviewed', 'test-mode-fixture', 'no-safe-production-proof']);
const TODAY = new Set(['canary-claim-ack', 'disabled-until-reviewed', 'test-mode-fixture']);
describe('calculated caps', () => {
    it('gives each journey the coaching its legs need: 31 in total when every leg runs', () => {
        expect(Object.fromEntries(journeyCoachingCaps(EVERY_GATE))).toEqual({ J1: 4, J2: 0, J3: 11, J4: 4, J5: 5, J6: 2, J7: 3, J8: 2, J9: 0 });
        expect(minimumCoachingCap(EVERY_GATE)).toBe(31);
    });
    it('drops a held leg\'s coaching from its journey (J7.a today): J7 2, total 30', () => {
        expect(journeyCoachingCaps(TODAY).get('J7')).toBe(2);
        expect(minimumCoachingCap(TODAY)).toBe(30);
    });
    it('counts only the selected legs', () => {
        expect(minimumCoachingCap(EVERY_GATE, ['J6'])).toBe(2);
        expect(minimumCoachingCap(EVERY_GATE, ['J3.a', 'J3.b'])).toBe(11);
        expect(minimumCoachingCap(EVERY_GATE, [])).toBe(0);
    });
});
describe('optional lower run cap', () => {
    it('defaults to the calculated minimum and may be lowered', () => {
        expect(coachingCapFromEnv({}, 30)).toBe(30);
        expect(coachingCapFromEnv({ [COACHING_CAP_ENV]: '' }, 12)).toBe(12);
        expect(coachingCapFromEnv({ [COACHING_CAP_ENV]: '12' }, 30)).toBe(12);
        expect(coachingCapFromEnv({ [COACHING_CAP_ENV]: '0' }, 30)).toBe(0);
    });
    it('refuses a cap above the minimum, a fraction, a negative or text, and an impossible minimum', () => {
        for (const bad of ['31', '1000', '3.5', '-1', 'abc', '1e3'])
            expect(() => coachingCapFromEnv({ [COACHING_CAP_ENV]: bad }, 30)).toThrow();
        expect(() => coachingCapFromEnv({}, -1)).toThrow();
    });
});
describe('per-journey coaching budget', () => {
    const budget = (runCap) => new CoachingBudget(journeyCoachingCaps(TODAY), runCap);
    it('admits a journey\'s requests up to its cap and refuses the next one', () => {
        const b = budget();
        expect([1, 2].map(() => b.admit('J6').admitted)).toEqual([true, true]);
        expect(b.admit('J6')).toEqual({ admitted: false, reason: 'J6 reached its coaching cap of 2' });
        expect(b.journeyBudgetRow('J6')).toEqual({ outcome: 'FAIL', sent: 2, overCap: 1, max: 2 });
        expect(b.journeyStopped('J6')).toBe(true);
    });
    it('passes a journey that sent exactly its cap, without stopping it', () => {
        const b = budget();
        b.admit('J8');
        b.admit('J8');
        expect(b.journeyBudgetRow('J8')).toEqual({ outcome: 'PASS', sent: 2, overCap: 0, max: 2 });
        expect(b.journeyStopped('J8')).toBe(false);
    });
    it('keeps one journey\'s retry from using another journey\'s allowance', () => {
        const b = budget();
        b.admit('J6');
        b.admit('J6');
        expect(b.admit('J6').admitted).toBe(false);
        expect([1, 2, 3, 4].map(() => b.admit('J4').admitted)).toEqual([true, true, true, true]);
        expect(b.journeyStopped('J4')).toBe(false);
        expect(b.journeyBudgetRow('J4').outcome).toBe('PASS');
    });
    it('sends nothing for J2 and J9 and fails their row on any attempt', () => {
        const b = budget();
        expect(b.admit('J9').admitted).toBe(false);
        expect(b.journeyBudgetRow('J9').outcome).toBe('FAIL');
        expect(b.journeyBudgetRow('J2').outcome).toBe('PASS');
        expect(b.sent).toBe(0);
    });
    it('with a lowered run cap, stops whichever journey reaches it without failing its budget row', () => {
        const b = budget(3);
        b.admit('J1');
        b.admit('J1');
        b.admit('J1');
        expect(b.admit('J1').admitted).toBe(false);
        expect(b.journeyStopped('J1')).toBe(true);
        expect(b.journeyBudgetRow('J1').outcome).toBe('PASS');
        expect(b.admit('J3').admitted).toBe(false);
        expect(b.sent).toBe(3);
    });
    it('stays stopped after a refusal', () => {
        const b = budget();
        b.admit('J7');
        b.admit('J7');
        b.admit('J7');
        expect(b.admit('J7').admitted).toBe(false);
    });
    it('refuses an invalid cap and an unknown journey', () => {
        expect(() => new CoachingBudget(new Map([['J1', -1]]))).toThrow();
        expect(() => new CoachingBudget(new Map([['J1', 1]]), 1.5)).toThrow();
        expect(() => budget().admit('J10')).toThrow();
    });
});
