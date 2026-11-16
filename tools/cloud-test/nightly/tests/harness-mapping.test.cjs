"use strict";
// Nightly AHT suite: the plan's mapping onto the existing harness cases, and the split of one case result into legs.
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const { expect } = require('./expect-lite.cjs');
const { ALL_LEGS, CATALOG_ROW_HOMES, DESIGN_RUN_START_PRESSES, HARNESS_CASES, historicalCase, legById, rowsForLeg } = require('../journey-plan.cjs');
const { legsForCase, outcomeOf, splitCaseResult } = require('../case-results.cjs');
const { legVerdict: rawLegVerdict } = require('../leg-verdicts.cjs');
// These tests are about the case split, so every leg has its allocation.
const legVerdict = (id, input) => rawLegVerdict(id, { budget: { allocated: true, overrun: [] }, ...input });
const catalog = JSON.parse(readFileSync(path.resolve(__dirname, '../../config/assertion-catalog.json'), 'utf8'));
const ALL_GATES = new Set(['canary-claim-ack', 'unqualified', 'disabled-until-reviewed', 'test-mode-fixture', 'no-safe-production-proof', 'no-harness-case']);
/** A case result that reports every row the plan homes to the case's legs, plus the given new rows. */
function caseResult(caseId, result = 'PASS', newRows = []) {
    const ids = catalog.cases[caseId].requiredAssertions;
    return { caseId, contentSafe: true, blocker: null, assertions: [...ids, ...newRows].map((id) => ({ id, result })) };
}
const sum = (legs, f) => legs.reduce((n, l) => n + f(l), 0);
/** The J8 invocation result reporting every planned row of its three legs, each row naming the leg it was observed on. */
function j8Result(result = 'PASS') {
    const assertions = ['J8.a', 'J8.b', 'J8.c'].flatMap((leg) => rowsForLeg(leg).map((row) => {
        const id = row.startsWith('invariant:') || row.startsWith('new:') ? row.slice(row.indexOf(':') + 1) : row;
        return { id, leg, result };
    }));
    return { caseId: 'J8', contentSafe: true, blocker: null, assertions };
}
/** The J1D invocation result: every J1.d row reported on J1.d, native rows as `J1.d:<row>` (Sam, 16 Nov). */
function j1dResult(result = 'PASS', omit = []) {
    const assertions = rowsForLeg('J1.d').filter((row) => !omit.includes(row)).map((row) => {
        const id = row.startsWith('invariant:') ? row.slice('invariant:'.length) : row;
        return { id, leg: 'J1.d', result };
    });
    return { caseId: 'J1D', contentSafe: true, blocker: null, assertions };
}
// AHT-15 is retired (Sam, 16 Nov): J1.d owns its rows natively; the catalog keeps AHT-15 only as the migration record.
const RETIRED = new Set(['AHT-07', 'AHT-08', 'AHT-15']);

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
            // AHT-15 is retired with no executable path: its catalog budget (0 Starts, 0 takes) is J1.d's, now native.
            if (caseId === 'AHT-15') {
                expect([c.minimumStarts, c.minimumTakes, legById('J1.d').startPresses, legById('J1.d').coachingRequests]).toEqual([0, 0, 0, 0]);
                continue;
            }
            // J8's legs count under their historical cases (AHT-08 for J8.a, AHT-07 for J8.b): one invocation, same totals.
            const legs = ALL_LEGS.filter((l) => historicalCase(l) === caseId);
            expect(legs.length).toBeGreaterThan(0);
            expect(sum(legs, (l) => l.startPresses)).toBe(c.minimumStarts + (caseId === 'AHT-01' ? 1 : 0));
        }
    });
    it('sends each case exactly its catalog takes as coaching requests', () => {
        for (const [caseId, c] of Object.entries(catalog.cases))
            expect(sum(ALL_LEGS.filter((l) => historicalCase(l) === caseId), (l) => l.coachingRequests)).toBe(c.minimumTakes);
    });
    it('homes every catalog row only on legs its own case runs', () => {
        for (const r of CATALOG_ROW_HOMES.filter((h) => !h.retired))
            for (const leg of r.legs)
                expect(historicalCase(legById(leg))).toBe(r.caseId);
    });
    it('gives a leg with no harness case nothing to spend and a NOT RUN gate', () => {
        const none = ALL_LEGS.filter((l) => l.caseId === null);
        expect(none.map((l) => l.id)).toEqual(['J1.e', 'J1.f', 'J2', 'J7.d', 'J9.a', 'J9.b']);
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
    it('places every J1.d row on J1.d from its own invocation, with nothing unplaced', () => {
        const r = splitCaseResult('J1D', j1dResult());
        expect([...r.keys()]).toEqual(['J1.d']);
        expect(Object.keys(r.get('J1.d')).sort()).toEqual([...rowsForLeg('J1.d')].sort());
    });
    it('keeps J1.d NOT RUN while one of its native rows is not reported (and its adapter gate is never satisfied)', () => {
        const r = splitCaseResult('J1D', j1dResult('PASS', ['J1.d:signout-no-stale-request']));
        const v = legVerdict('J1.d', { prior: new Map([['J1.a', { outcome: 'PASS' }]]), satisfiedGates: new Set([...ALL_GATES, 'no-j1d-harness-adapter']), results: r.get('J1.d') });
        expect(v.outcome).toBe('NOT RUN');
        expect(v.rows['J1.d:signout-no-stale-request']).toBe('NOT RUN');
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
    it('fails start-press-budget on every leg of the case when the harness stopped a press at its cap', () => {
        const res = caseResult('AHT-01');
        res.assertions = res.assertions.map((a) => (a.id === 'start-press-budget' ? { ...a, result: 'NOT RUN' } : a));
        res.executionSignals = { startPressCapExceeded: true };
        const split = splitCaseResult('AHT-01', res);
        for (const leg of split.keys()) {
            expect(split.get(leg)['invariant:start-press-budget']).toBe('FAIL');
            expect(legVerdict(leg, { prior: new Map([['J1.a', { outcome: 'PASS' }]]), satisfiedGates: ALL_GATES, results: split.get(leg) }).outcome).toBe('FAIL');
        }
        res.executionSignals = { startPressCapExceeded: false };
        expect(splitCaseResult('AHT-01', res).get('J1.a')['invariant:start-press-budget']).toBe('NOT RUN');
    });
    it('keeps the worse outcome of a row reported twice', () => {
        const res = j8Result();
        res.assertions.push({ id: 'AHT-08:feedback-stored-once', leg: 'J8.a', result: 'FAIL' });
        expect(splitCaseResult('J8', res).get('J8.a')['AHT-08:feedback-stored-once']).toBe('FAIL');
    });
    it('refuses a result for another case, or one with no assertions', () => {
        expect(() => splitCaseResult('AHT-01', caseResult('AHT-02'))).toThrow();
        expect(() => splitCaseResult('AHT-01', { caseId: 'AHT-01' })).toThrow();
        expect(() => splitCaseResult('AHT-99', { caseId: 'AHT-99', assertions: [] })).toThrow();
    });
    it('lists the legs a case covers in plan order', () => {
        expect(legsForCase('J8')).toEqual(['J8.a', 'J8.b', 'J8.c']);
        expect(legsForCase('AHT-07')).toEqual([]);
        expect(legsForCase('AHT-99')).toEqual([]);
    });
    it('leaves every planned row of a fully reported case placed, with no unplaced row', () => {
        for (const caseId of [...Object.keys(catalog.cases).filter((c) => !RETIRED.has(c)), 'J8', 'J1D']) {
            const split = splitCaseResult(caseId, caseId === 'J8' ? j8Result() : caseId === 'J1D' ? j1dResult() : caseResult(caseId));
            for (const [leg, rows] of split) {
                expect(Object.keys(rows).filter((r) => r.startsWith('unplaced:'))).toEqual([]);
                for (const r of Object.keys(rows))
                    expect(rowsForLeg(leg)).toContain(r);
            }
        }
    });
});

/** Sam on #1870: J8 is ONE invocation; AHT-07/AHT-08 are historical row IDs, never a receipt source. */
describe('the J8 invocation', () => {
    it('one invocation covers all three legs: one case id, no leg resolves to a retired case', () => {
        expect([...new Set(['J8.a', 'J8.b', 'J8.c'].map((id) => legById(id).caseId))]).toEqual(['J8']);
        for (const l of ALL_LEGS) expect(RETIRED.has(l.caseId)).toBe(false);
    });
    it('a fully reported J8 result passes each leg with every row on its own leg', () => {
        const split = splitCaseResult('J8', j8Result());
        for (const leg of ['J8.a', 'J8.b', 'J8.c']) expect(Object.keys(split.get(leg)).sort()).toEqual([...rowsForLeg(leg)].sort());
    });
    it('CONTROL: a legacy AHT-07 or AHT-08 receipt is refused, for J8 and on its own', () => {
        expect(() => splitCaseResult('J8', caseResult('AHT-07'))).toThrow();
        expect(() => splitCaseResult('J8', caseResult('AHT-08'))).toThrow();
        expect(() => splitCaseResult('AHT-07', caseResult('AHT-07'))).toThrow();
    });
    it('CONTROL: a row swapped between legs is unplaced on every leg, never a PASS on either', () => {
        const res = j8Result();
        res.assertions.push({ id: 'AHT-07:older-take-association', leg: 'J8.a', result: 'PASS' });
        const split = splitCaseResult('J8', res);
        for (const leg of ['J8.a', 'J8.b', 'J8.c']) expect(Object.keys(split.get(leg))).toContain('unplaced:J8.a:AHT-07:older-take-association');
        const v = legVerdict('J8.a', { prior: new Map(), satisfiedGates: new Set([...ALL_GATES, 'no-j8-harness-adapter']), results: split.get('J8.a') });
        expect(v.outcome).toBe('FAIL');
    });
    it('CONTROL: a row naming no leg, or a leg outside J8, is unplaced', () => {
        for (const extra of [{ id: 'AHT-08:owner-bound', result: 'PASS' }, { id: 'AHT-08:owner-bound', leg: 'J7.c', result: 'PASS' }]) {
            const res = j8Result();
            res.assertions.push(extra);
            expect(Object.keys(splitCaseResult('J8', res).get('J8.a')).some((r) => r.startsWith('unplaced:'))).toBe(true);
        }
    });
    it('an invariant lands only on the leg that reported it', () => {
        const res = { caseId: 'J8', assertions: [{ id: 'owner-bound', leg: 'J8.c', result: 'FAIL' }] };
        const split = splitCaseResult('J8', res);
        expect(split.get('J8.c')['invariant:owner-bound']).toBe('FAIL');
        expect('invariant:owner-bound' in split.get('J8.a')).toBe(false);
        expect('invariant:owner-bound' in split.get('J8.b')).toBe(false);
    });
    it('CONTROL: J8 is NOT RUN until its reviewed harness adapter lands, even with every row PASS', () => {
        const split = splitCaseResult('J8', j8Result());
        for (const leg of ['J8.a', 'J8.b']) {
            const v = legVerdict(leg, { prior: new Map(), satisfiedGates: ALL_GATES, results: split.get(leg) });
            expect(v.outcome).toBe('NOT RUN');
            expect(v.reason).toContain('no reviewed harness adapter');
        }
    });
    it('J8.c stays NOT RUN when J8.b did not PASS, and never passes while J8 has no adapter', () => {
        const gates = new Set([...ALL_GATES, 'no-j8-harness-adapter']);
        const split = splitCaseResult('J8', j8Result());
        const bad = { ...split.get('J8.b'), 'AHT-07:older-take-association': 'FAIL' };
        const b = legVerdict('J8.b', { prior: new Map(), satisfiedGates: gates, results: bad });
        expect(b.outcome).toBe('FAIL');
        const c = legVerdict('J8.c', { prior: new Map([['J8.b', b]]), satisfiedGates: gates, results: split.get('J8.c') });
        expect(c.outcome).toBe('NOT RUN');
        expect(c.reason).toContain('needs J8.b');
        // Sam on a90e906a: even a passing J8.b cannot make J8.c run: the adapter gate is never satisfied yet.
        const okB = legVerdict('J8.b', { prior: new Map(), satisfiedGates: gates, results: split.get('J8.b') });
        expect(okB.outcome).toBe('NOT RUN');
        expect(legVerdict('J8.c', { prior: new Map([['J8.b', okB]]), satisfiedGates: gates, results: split.get('J8.c') }).outcome).toBe('NOT RUN');
    });
});

// Sam, 16 Nov: J1.d is satisfied only by its own native invocation. An old AHT-15 receipt, a legacy-prefixed row, or a native
// row claimed for another leg never satisfies it.
describe('J1.d accepts only its native J1D receipt', () => {
    const ALL_SATISFIABLE = new Set([...ALL_GATES, 'no-j1d-harness-adapter']);
    const verdictOf = (rows) => legVerdict('J1.d', { prior: new Map([['J1.a', { outcome: 'PASS' }]]), satisfiedGates: ALL_SATISFIABLE, results: rows });
    it('places a complete native J1D receipt on J1.d, which still stays NOT RUN: its adapter gate cannot be satisfied today', () => {
        const rows = splitCaseResult('J1D', j1dResult()).get('J1.d');
        expect(Object.keys(rows).sort()).toEqual([...rowsForLeg('J1.d')].sort());
        const v = verdictOf(rows);
        expect(v.outcome).toBe('NOT RUN');
        expect(v.reason).toContain('no reviewed harness adapter');
    });
    it('NEGATIVE: an old AHT-15 receipt cannot satisfy J1.d: the retired case covers no leg', () => {
        let thrown = null;
        try { splitCaseResult('AHT-15', caseResult('AHT-15')); }
        catch (e) { thrown = e; }
        expect(String(thrown?.message)).toContain('AHT-15 covers no nightly leg');
        expect(legsForCase('AHT-15')).toEqual([]);
    });
    it('NEGATIVE: legacy-prefixed or bare rows inside a J1D receipt are unplaced, and J1.d is never PASS', () => {
        const native = j1dResult();
        const legacy = { ...native, assertions: native.assertions.map((a) => (a.id.startsWith('J1.d:') ? { ...a, id: a.id.replace('J1.d:', 'AHT-15:') } : a)) };
        const legacyRows = splitCaseResult('J1D', legacy).get('J1.d');
        expect(Object.keys(legacyRows).some((r) => r.startsWith('unplaced:'))).toBe(true);
        expect(verdictOf(legacyRows).outcome).not.toBe('PASS');
        const bare = { ...native, assertions: native.assertions.map((a) => (a.id.startsWith('J1.d:') ? { ...a, id: a.id.slice('J1.d:'.length) } : a)) };
        expect(verdictOf(splitCaseResult('J1D', bare).get('J1.d')).outcome).not.toBe('PASS');
    });
    it('NEGATIVE: a native row named for another leg does not land on J1.d', () => {
        const swapped = { caseId: 'J1D', contentSafe: true, blocker: null, assertions: [{ id: 'J1.a:history-preserved', leg: 'J1.d', result: 'PASS' }] };
        const rows = splitCaseResult('J1D', swapped).get('J1.d');
        expect(rows['J1.a:history-preserved']).toBe(undefined);
        expect(Object.keys(rows)).toEqual(['unplaced:J1.d:J1.a:history-preserved']);
    });
});
