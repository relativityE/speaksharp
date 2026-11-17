"use strict";
// Nightly AHT suite: the lowest limits that still give a truthful result (#1864 at 2c72705, Akin 14 Nov 17:31Z).
const { describe, it } = require('node:test');
const { cleanupReserve, reserveMinutes } = require('../cleanup-plan.cjs');
const { expect } = require('./expect-lite.cjs');
const {
    PROPOSED_MARGIN_PCT, allGateKinds, countedLimits, dollarCap, journeyAllowance, limitsTable, measuredLimit, runnableJourneys,
} = require('../limits.cjs');
const counted = (l) => [l.freshSignUps, l.takes, l.startPresses, l.coachingRequests, l.identityReads, l.providerCalls, l.paidActionsUsd];
const run = (value, complete = true) => ({ complete, value });

describe('counted limits', () => {
    it('matches the all-legs column with J1.e\'s probe reserved: 15 sign-ups, 29 takes, 41 starts, 30 coaching, 32 identity reads, 90 provider calls, $0', () => {
        // J8 and J1.d never count for now (Sam on a90e906a; Sam 16 Nov): neither invocation has a reviewed adapter, so even the
        // all-legs column leaves them out, like J9.b. J1.d's two identity reads leave it (34 -> 32); it adds no take or start.
        expect(counted(countedLimits(allGateKinds()))).toEqual([15, 29, 41, 30, 32, 90, 0]);
        expect(countedLimits(allGateKinds()).sharedAccountTarget).toEqual({ freshSignUps: 7 });
    });
    it("matches today's column: 11 sign-ups, 28 takes, 38 starts, 28 coaching, 24 identity reads, 84 provider calls, $0", () => {
        // One account per runnable harness case today, not one per journey (6); identity reads stay 2 per runnable harness
        // case (11) plus 2. Gated today: J1.d's AHT-15 until the sign-out recorder is wired (Sam on 79320578), and all of J8
        // until its one-invocation adapter lands (#1870): J8.b's 2 takes, starts and coaching leave today's column.
        expect(counted(countedLimits(new Set()))).toEqual([11, 28, 38, 28, 24, 84, 0]);
        expect(countedLimits(new Set()).sharedAccountTarget).toEqual({ freshSignUps: 6 });
    });
    it('counts nothing for a leg that cannot run, and names it NOT RUN', () => {
        const today = countedLimits(new Set());
        expect(today.notRun).toEqual(['J1.d', 'J1.e', 'J1.f', 'J2', 'J7.a', 'J7.d', 'J8.a', 'J8.b', 'J8.c', 'J9.a', 'J9.b']);
        for (const id of today.notRun)
            expect(today.legs.includes(id)).toBe(false);
    });
    it('never counts J9, J8 or J1.d: the J9 sandbox leg is outside production limits, J9.b is NOT RUN by design, J8 and J1.d have no adapter', () => {
        // A caller supplying every gate, the J8 and J1.d adapter gates and J9.b's production gate included, changes nothing.
        const all = countedLimits(new Set([...allGateKinds(), 'no-safe-production-proof', 'no-j8-harness-adapter', 'no-j1d-harness-adapter']));
        expect(all.journeys.includes('J9')).toBe(false);
        expect(all.journeys.includes('J8')).toBe(false);
        expect(all.notRun).toEqual(['J1.d', 'J8.a', 'J8.b', 'J8.c', 'J9.a', 'J9.b']);
    });
    it('allows 30 runs in 30 days and no paid action', () => {
        const l = countedLimits(allGateKinds());
        expect(l.runsPerPeriod).toEqual({ runs: 30, days: 30 });
        expect(l.paidActionsUsd).toBe(0);
    });
    it('adds the canary legs once the canary claim is acknowledged: no take or start of their own, one probe reserved', () => {
        const withCanary = countedLimits(new Set(['canary-claim-ack', 'no-harness-case']));
        expect(withCanary.legs).toContain('J1.e');
        expect(counted(withCanary).slice(1, 4)).toEqual([28, 38, 29]);
        expect(withCanary.providerCalls).toBe(87);
    });
});

describe('measured limits', () => {
    it('leaves request and time limits unset with no complete baseline', () => {
        const t = limitsTable();
        expect(t.requests.perRun).toBe(null);
        expect(t.windowMinutes.perRun).toBe(null);
        expect(t.githubRunnerMinutes).toBe(null);
        expect(t.providerUsd).toBe(null);
    });
    it('proposes only the evidence-based margins: 11% on requests, 14% on time, none elsewhere', () => {
        expect(Object.fromEntries(Object.entries(PROPOSED_MARGIN_PCT).map(([k, v]) => [k, v.pct]))).toEqual({ requests: 11, minutes: 14 });
        expect(() => journeyAllowance('takes', [run(1)])).toThrow();
        expect(() => journeyAllowance('identityReads', [run(1)])).toThrow();
    });
    it('adds the proposed margin to one complete baseline, never a flat 20% or 25%', () => {
        expect(journeyAllowance('requests', [run(157)])).toMatchObject({ allowance: 175, marginPct: 11 });
        expect(journeyAllowance('requests', [run(1000)]).allowance === 1200).toBe(false);
        expect(journeyAllowance('minutes', [run(600)])).toMatchObject({ allowance: 12, marginPct: 14 });
    });
    it('lowers the margin to the spread of two complete baselines when they agree more closely, and never raises it', () => {
        expect(journeyAllowance('requests', [run(100), run(105)])).toMatchObject({ allowance: 111, marginPct: 5 });
        expect(journeyAllowance('requests', [run(100), run(150)])).toMatchObject({ allowance: 167, marginPct: 11 });
        expect(journeyAllowance('requests', [run(100), run(100)])).toMatchObject({ allowance: 100, marginPct: 0 });
    });
    it('ignores runs in which a runnable leg did not execute', () => {
        expect(journeyAllowance('requests', [run(9000, false)]).allowance).toBe(null);
        expect(journeyAllowance('requests', [run(9000, false), run(100)]).allowance).toBe(111);
        expect(journeyAllowance('requests', [run(-1), run(NaN)]).allowance).toBe(null);
    });
    it('rounds time up to whole minutes per journey, then sums the journeys', () => {
        const ids = runnableJourneys(new Set()).map((j) => j.id);
        const baseline = Object.fromEntries(ids.map((id) => [id, [run(61)]]));
        const m = measuredLimit('minutes', new Set(), baseline);
        expect(m.perJourney.map((p) => p.allowance)).toEqual(ids.map(() => 2));
        const reserve = ids.reduce((n, id) => n + reserveMinutes(cleanupReserve(id)), 0);
        expect(m.perRun).toBe(2 * ids.length + reserve);
        expect(m.perPeriod).toBe((2 * ids.length + reserve) * 30);
    });
    it('adds each runnable journey\'s protected cleanup reserve once, on top of its test-work baseline', () => {
        const ids = runnableJourneys(new Set()).map((j) => j.id);
        const baseline = Object.fromEntries(ids.map((id) => [id, [run(100)]]));
        const m = measuredLimit('requests', new Set(), baseline);
        for (const p of m.perJourney) {
            expect(p.cleanupReserve).toBe(cleanupReserve(p.journey).requests);
            expect(p.total).toBe(111 + p.cleanupReserve);
        }
        expect(m.perRun).toBe(ids.length * 111 + ids.reduce((n, id) => n + cleanupReserve(id).requests, 0));
        expect(countedLimits(new Set()).cleanupRequests).toBe(ids.reduce((n, id) => n + cleanupReserve(id).requests, 0));
    });
    it('leaves the limits unset while a runnable journey has no defined cleanup step (J2)', () => {
        const gates = new Set([...allGateKinds()]);
        const ids = runnableJourneys(gates).map((j) => j.id);
        expect(ids).toContain('J2');
        const baseline = Object.fromEntries(ids.map((id) => [id, [run(100)]]));
        const m = measuredLimit('requests', gates, baseline);
        expect(m.perRun).toBe(null);
        expect(m.basis).toContain('no cleanup reserve for J2');
        expect(countedLimits(gates).cleanupRequests).toBe(null);
    });
    it('stays unset while any runnable journey lacks a complete baseline, and names it', () => {
        const ids = runnableJourneys(new Set()).map((j) => j.id);
        const baseline = Object.fromEntries(ids.filter((id) => id !== 'J6').map((id) => [id, [run(100)]]));
        const m = measuredLimit('requests', new Set(), baseline);
        expect(m.perRun).toBe(null);
        expect(m.basis).toContain('J6');
    });
    it('prices dollar caps from a supplied unit price with no margin, and leaves them unset without one', () => {
        expect(dollarCap(93, 0.01)).toBe(0.93);
        expect(dollarCap(93, undefined)).toBe(null);
        expect(dollarCap(null, 0.01)).toBe(null);
        expect(limitsTable(new Set(), {}, { providerPerCallUsd: 0.02 }).providerUsd).toBe(1.68);
    });
    // Codex P2 on 589e5882: a cap is never below the cost of its own counted work.
    it('rounds a fractional-cent cost UP to whole cents, so the cap covers its own counted work', () => {
        expect(limitsTable(new Set(), {}, { providerPerCallUsd: 0.00049 }).providerUsd).toBe(0.05);
        expect(dollarCap(90, 0.00005)).toBe(0.01);
        expect(dollarCap(1, 0.001)).toBe(0.01);
        expect(dollarCap(0, 0.02)).toBe(0);
        expect(dollarCap(90, 0.02)).toBe(1.8);
        for (const [n, p] of [[90, 0.00049], [90, 0.00005], [93, 0.0137], [7, 0.333]])
            expect(dollarCap(n, p) + 1e-12 >= n * p).toBe(true);
    });
});
