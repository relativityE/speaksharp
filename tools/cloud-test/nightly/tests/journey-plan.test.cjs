"use strict";
// Nightly AHT suite: coverage drift. Every one of the catalog's rows has exactly one home in the nightly plan, every
// planned row is a catalog row, and the plan's structure matches the #1864 design (legs, dependencies, budget).
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, expect, it } = require('./expect-lite.cjs');
const { ALL_LEGS, CATALOG_ROW_HOMES, DESIGN_RUN_COACHING_CAP, JOURNEYS, LEG_INVARIANTS, NEW_ROWS, legById, rowsForLeg } = require('../journey-plan.cjs');
const root = path.resolve(__dirname, '../../../..');
const catalog = JSON.parse(readFileSync(path.join(root, 'tools/cloud-test/config/assertion-catalog.json'), 'utf8'));
const catalogRows = Object.entries(catalog.cases).flatMap(([c, v]) => v.requiredAssertions.map((a) => `${c}:${a}`));
describe('nightly plan coverage of the live catalog', () => {
    it('reads a non-empty catalog whose row count matches its own total', () => {
        expect(catalogRows.length).toBeGreaterThan(0);
        expect(catalogRows.length).toBe(catalog.totalAssertions);
    });
    it('gives every catalog row exactly one home', () => {
        const homed = CATALOG_ROW_HOMES.map((r) => `${r.caseId}:${r.assertion}`);
        const missing = catalogRows.filter((r) => !homed.includes(r));
        const duplicated = homed.filter((r, i) => homed.indexOf(r) !== i);
        expect({ missing, duplicated }).toEqual({ missing: [], duplicated: [] });
    });
    it('homes no row the catalog does not have', () => {
        const extra = CATALOG_ROW_HOMES.map((r) => `${r.caseId}:${r.assertion}`).filter((r) => !catalogRows.includes(r));
        expect(extra).toEqual([]);
    });
    it('homes every row on a planned leg', () => {
        const legIds = new Set(ALL_LEGS.map((l) => l.id));
        const bad = [...CATALOG_ROW_HOMES.flatMap((r) => r.legs), ...NEW_ROWS.map((r) => r.leg)].filter((l) => !legIds.has(l));
        expect(bad).toEqual([]);
    });
    it('does not reuse a catalog row name as a new row on the same leg', () => {
        for (const n of NEW_ROWS) {
            expect(rowsForLeg(n.leg).filter((r) => r.endsWith(`:${n.assertion}`))).toEqual([`new:${n.assertion}`]);
        }
    });
});
describe('nightly plan structure (#1864 design)', () => {
    it('has the nine journeys and the nineteen new rows of #1864 (098f0ae)', () => {
        expect(JOURNEYS.map((j) => j.id)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9']);
        expect(NEW_ROWS).toHaveLength(19);
        expect(NEW_ROWS.filter((r) => r.leg === 'J1.d').map((r) => r.assertion)).toEqual(['signout-no-unauthorized-read', 'signout-no-stale-request']);
        expect(NEW_ROWS.filter((r) => r.leg === 'J9.a').map((r) => r.assertion))
            .toEqual(['pre-upgrade-history-opens', 'pre-upgrade-progress-opens', 'old-sessions-no-new-coaching', 'entitlement-survives-upgrade']);
        expect(NEW_ROWS.filter((r) => r.leg === 'J9.b').map((r) => r.assertion)).toEqual(['production-entitlement-after-upgrade']);
    });
    it("takes each leg's coaching from the catalog's minimum takes for the case homed there", () => {
        const takes = Object.fromEntries(Object.entries(catalog.cases).map(([c, v]) => [c, v.minimumTakes]));
        const caseOfLeg = (leg) => [...new Set(CATALOG_ROW_HOMES.filter((r) => r.legs.length === 1 && r.legs[0] === leg).map((r) => r.caseId))];
        // AHT-01's takes are all carried by J1.a; J1.b and J1.c run on its account.
        const expected = (id) => (id === 'J1.a' ? takes['AHT-01'] : id === 'J1.b' || id === 'J1.c' ? 0
            : caseOfLeg(id).reduce((n, c) => n + takes[c], 0));
        expect(Object.fromEntries(ALL_LEGS.map((l) => [l.id, l.coachingRequests])))
            .toEqual(Object.fromEntries(ALL_LEGS.map((l) => [l.id, expected(l.id)])));
    });
    it('sets the design run budget to 32 coaching requests: 31 saved takes plus J1.e\'s probe at its worst case', () => {
        expect(Object.fromEntries(JOURNEYS.map((j) => [j.id, j.coachingMax]))).toEqual({ J1: 5, J2: 0, J3: 11, J4: 4, J5: 5, J6: 2, J7: 3, J8: 2, J9: 0 });
        expect(DESIGN_RUN_COACHING_CAP).toBe(32);
        expect(Object.fromEntries(ALL_LEGS.filter((l) => l.coachingProbes > 0).map((l) => [l.id, l.coachingProbes]))).toEqual({ 'J1.e': 1 });
    });
    it('keeps the design dependencies: J1.b-d need J1.a, J1.f needs J1.e, J8.c needs J8.b, J1.e needs nothing', () => {
        const needs = Object.fromEntries(ALL_LEGS.filter((l) => l.needs.length > 0).map((l) => [l.id, l.needs]));
        expect(needs).toEqual({ 'J1.b': ['J1.a'], 'J1.c': ['J1.a'], 'J1.d': ['J1.a'], 'J1.f': ['J1.e'], 'J8.c': ['J8.b'] });
    });
    it('only depends on legs of the same journey that come earlier', () => {
        for (const l of ALL_LEGS)
            for (const d of l.needs) {
                expect(legById(d).journey).toBe(l.journey);
                expect(ALL_LEGS.indexOf(legById(d))).toBeLessThan(ALL_LEGS.indexOf(l));
            }
    });
    it('isolates the browser conditions the design names', () => {
        expect(legById('J5.a').context).toBe('fresh-cold-context');
        expect(legById('J7.a').context).toBe('deny-launched-browser');
        expect(legById('J7.b').context).toBe('fresh-cold-context');
        expect(legById('J7.c').context).toBe('fresh-cold-context');
        expect(legById('J6').context).toBe('two-contexts');
    });
    it('gates the trial-ending legs on the canary claim, holds J7.a, and keeps J2 and J9 off', () => {
        const kinds = (id) => legById(id).gates.map((g) => `${g.kind}:${g.outcome}`);
        const NO_CASE = 'no-harness-case:NOT RUN';
        expect(kinds('J1.e')).toEqual(['canary-claim-ack:NOT RUN', NO_CASE]);
        expect(kinds('J1.f')).toEqual(['canary-claim-ack:NOT RUN', NO_CASE]);
        expect(kinds('J2')).toEqual(['canary-claim-ack:NOT RUN', 'disabled-until-reviewed:NOT RUN', NO_CASE]);
        expect(kinds('J7.a')).toEqual(['unqualified:HOLD']);
        expect(kinds('J7.d')).toEqual([NO_CASE]);
        expect(kinds('J8.c')).toEqual([NO_CASE]);
        expect(kinds('J9.a')).toEqual(['test-mode-fixture:NOT RUN', NO_CASE]);
        expect(kinds('J9.b')).toEqual(['no-safe-production-proof:NOT RUN', NO_CASE]);
        expect(ALL_LEGS.filter((l) => l.gates.length > 0).map((l) => l.id)).toEqual(['J1.e', 'J1.f', 'J2', 'J7.a', 'J7.d', 'J8.c', 'J9.a', 'J9.b']);
    });
    it('asserts the four invariants in every leg', () => {
        for (const l of ALL_LEGS)
            for (const a of LEG_INVARIANTS)
                expect(rowsForLeg(l.id)).toContain(`invariant:${a}`);
    });
    it('keeps J9 read-only with no takes or coaching', () => {
        const j9 = JOURNEYS.find((j) => j.id === 'J9');
        expect(j9.account).toBe('long-lived-paid-read-only');
        expect(j9.coachingMax).toBe(0);
        expect(j9.legs.every((l) => !l.needsCoaching)).toBe(true);
    });
    it('labels only the sandbox leg as sandbox scope', () => {
        expect(ALL_LEGS.filter((l) => l.proofScope !== 'deployed-production').map((l) => l.id)).toEqual(['J9.a']);
    });
});
