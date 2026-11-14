"use strict";
// Nightly AHT suite: the plan's mapping onto the existing harness cases, and the split of one case result into legs.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, expect, it } = require('./expect-lite.cjs');
const { ALL_LEGS, CATALOG_ROW_HOMES, DESIGN_RUN_START_PRESSES, HARNESS_CASES, legById, rowsForLeg } = require('../journey-plan.cjs');
const { legsForCase, outcomeOf, splitCaseResult } = require('../case-results.cjs');
const { legVerdict } = require('../leg-verdicts.cjs');
const catalog = JSON.parse(readFileSync(path.resolve(__dirname, '../../config/assertion-catalog.json'), 'utf8'));
const ALL_GATES = new Set(['canary-claim-ack', 'unqualified', 'disabled-until-reviewed', 'test-mode-fixture', 'no-safe-production-proof', 'no-harness-case']);
/** A case result that reports every row the plan homes to the case's legs, plus the given new rows. */
function caseResult(caseId, result = 'PASS', newRows = []) {
    const ids = catalog.cases[caseId].requiredAssertions;
    return { caseId, contentSafe: true, blocker: null, assertions: [...ids, ...newRows].map((id) => ({ id, result })) };
}
const sum = (legs, f) => legs.reduce((n, l) => n + f(l), 0);

describe('plan mapping onto the harness cases', () => {
    it('maps every leg, and only the plan legs', () => {
        expect(Object.keys(HARNESS_CASES).sort()).toEqual(ALL_LEGS.map((l) => l.id).sort());
    });
    it('spends 43 Start presses with every leg runnable: the catalog 42 plus the short Stop', () => {
        expect(DESIGN_RUN_START_PRESSES).toBe(43);
        expect(catalog.minimumStarts + 1).toBe(43);
    });
    it('spends each case exactly its catalog Start presses, AHT-01 one more for the short Stop', () => {
        for (const [caseId, c] of Object.entries(catalog.cases)) {
            const legs = ALL_LEGS.filter((l) => l.caseId === caseId);
            expect(legs.length).toBeGreaterThan(0);
            expect(sum(legs, (l) => l.startPresses)).toBe(c.minimumStarts + (caseId === 'AHT-01' ? 1 : 0));
        }
    });
    it('sends each case exactly its catalog takes as coaching requests', () => {
        for (const [caseId, c] of Object.entries(catalog.cases))
            expect(sum(ALL_LEGS.filter((l) => l.caseId === caseId), (l) => l.coachingRequests)).toBe(c.minimumTakes);
    });
    it('homes every catalog row only on legs its own case runs', () => {
        for (const r of CATALOG_ROW_HOMES)
            for (const leg of r.legs)
                expect(legById(leg).caseId).toBe(r.caseId);
    });
    it('gives a leg with no harness case nothing to spend and a NOT RUN gate', () => {
        const none = ALL_LEGS.filter((l) => l.caseId === null);
        expect(none.map((l) => l.id)).toEqual(['J1.e', 'J1.f', 'J2', 'J7.d', 'J8.c', 'J9.a', 'J9.b']);
        for (const l of none) {
            expect(l.startPresses).toBe(0);
            expect(l.coachingRequests).toBe(0);
            expect(l.gates.some((g) => g.kind === 'no-harness-case' && g.outcome === 'NOT RUN')).toBe(true);
        }
    });
});

describe('splitting a case result into legs', () => {
    it('places AHT-01 rows on J1.a, J1.b and J1.c, and its invariants on all three', () => {
        const split = splitCaseResult('AHT-01', caseResult('AHT-01'));
        expect([...split.keys()]).toEqual(['J1.a', 'J1.b', 'J1.c']);
        expect(split.get('J1.b')['AHT-01:same-target-repeat']).toBe('PASS');
        expect(split.get('J1.a')['AHT-01:same-target-repeat']).toBe(undefined);
        for (const leg of split.keys())
            expect(split.get(leg)['invariant:owner-bound']).toBe('PASS');
    });
    it('passes a leg whose case reported every row, including its new rows', () => {
        const r = splitCaseResult('AHT-15', caseResult('AHT-15', 'PASS', ['signout-no-unauthorized-read', 'signout-no-stale-request']));
        const v = legVerdict('J1.d', { prior: new Map([['J1.a', { outcome: 'PASS' }]]), satisfiedGates: ALL_GATES, results: r.get('J1.d') });
        expect(v.outcome).toBe('PASS');
    });
    it('keeps a leg NOT RUN while its new rows are not reported by the harness yet', () => {
        const r = splitCaseResult('AHT-15', caseResult('AHT-15'));
        const v = legVerdict('J1.d', { prior: new Map([['J1.a', { outcome: 'PASS' }]]), satisfiedGates: ALL_GATES, results: r.get('J1.d') });
        expect(v.outcome).toBe('NOT RUN');
        expect(v.rows['new:signout-no-stale-request']).toBe('NOT RUN');
    });
    it('fails every leg of the case on a row the plan places nowhere', () => {
        const res = caseResult('AHT-01');
        res.assertions.push({ id: 'renamed-row', result: 'PASS' });
        const split = splitCaseResult('AHT-01', res);
        for (const leg of split.keys()) {
            const v = legVerdict(leg, { prior: new Map([['J1.a', { outcome: 'PASS' }]]), satisfiedGates: ALL_GATES, results: split.get(leg) });
            expect(v.outcome).toBe('FAIL');
        }
    });
    it('reads the harness NOT_RUN as NOT RUN and any unknown result as FAIL, never PASS', () => {
        expect(outcomeOf('NOT_RUN')).toBe('NOT RUN');
        expect(outcomeOf('PASS')).toBe('PASS');
        for (const odd of ['pass', 'SKIPPED', undefined, null, 1])
            expect(outcomeOf(odd)).toBe('FAIL');
    });
    it('keeps the worse outcome of a row reported twice', () => {
        const res = caseResult('AHT-08');
        res.assertions.push({ id: 'feedback-stored-once', result: 'FAIL' });
        expect(splitCaseResult('AHT-08', res).get('J8.a')['AHT-08:feedback-stored-once']).toBe('FAIL');
    });
    it('refuses a result for another case, or one with no assertions', () => {
        expect(() => splitCaseResult('AHT-01', caseResult('AHT-02'))).toThrow();
        expect(() => splitCaseResult('AHT-01', { caseId: 'AHT-01' })).toThrow();
        expect(() => splitCaseResult('AHT-99', { caseId: 'AHT-99', assertions: [] })).toThrow();
    });
    it('lists the legs a case covers in plan order', () => {
        expect(legsForCase('AHT-07')).toEqual(['J8.b']);
        expect(legsForCase('AHT-99')).toEqual([]);
    });
    it('leaves every planned row of a fully reported case placed, with no unplaced row', () => {
        for (const caseId of Object.keys(catalog.cases)) {
            const split = splitCaseResult(caseId, caseResult(caseId));
            for (const [leg, rows] of split) {
                expect(Object.keys(rows).filter((r) => r.startsWith('unplaced:'))).toEqual([]);
                for (const r of Object.keys(rows))
                    expect(rowsForLeg(leg)).toContain(r);
            }
        }
    });
});
