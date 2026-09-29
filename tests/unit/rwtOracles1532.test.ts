// @vitest-environment node
/**
 * #1532 open Codex P1s (b5071da25) — the pure oracles behind three RWT rows:
 *  - r4105978609: the pre-credential surface is approved only once the app is visible-ready;
 *  - r4105978619: the partial fixture must produce a PARTIAL point, and partial counts as detected;
 *  - r4105978630: feedback retention is proven only AFTER the account is deleted (row kept, user link cleared).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    acquisitionTimingVerdict, detectedCountExpected, expectsLiveChange, feedbackRetentionVerdict, focusCoachingProvenanceVerdict, focusPointMeetsExpectation,
    liveChangeFailures, persistedVerdictMismatches,
    surfaceReadinessFailures,
} from '../live/helpers/rwtOracles';

describe('r4105978609 — approved surface requires app-visible readiness', () => {
    it('CASUALTY: a visible form on an app that never reported visible-ready is refused', () => {
        expect(surfaceReadinessFailures(false)).toEqual(['the app never reported data-app-visible-ready; the route is not committed']);
    });
    it('CONTROL: visible-ready adds no failure', () => {
        expect(surfaceReadinessFailures(true)).toEqual([]);
    });
});

describe('r4105978619 — the partial fixture must exercise the partial state', () => {
    it('CASUALTY: an expected PARTIAL point that came back MISSING fails (the yellow state stays untested otherwise)', () => {
        expect(focusPointMeetsExpectation('partial', 'missing')).toBe(false);
        expect(focusPointMeetsExpectation('partial', 'covered')).toBe(false);
        expect(focusPointMeetsExpectation('partial', null)).toBe(false);
        expect(focusPointMeetsExpectation('partial', 'partial')).toBe(true);
    });
    it('covered and missing expectations are exact', () => {
        expect(focusPointMeetsExpectation('covered', 'covered')).toBe(true);
        expect(focusPointMeetsExpectation('covered', 'partial')).toBe(false);
        expect(focusPointMeetsExpectation('missing', 'missing')).toBe(true);
        expect(focusPointMeetsExpectation('missing', 'partial')).toBe(false);
    });
    it('the retired loose expectation is no longer accepted', () => {
        expect(focusPointMeetsExpectation('not-covered-or-partial', 'missing')).toBe(false);
        expect(focusPointMeetsExpectation('not-covered-or-partial', 'partial')).toBe(false);
    });
    it('CASUALTY: partial counts as DETECTED (the product persists covered OR partial as detected) — 3/4, not 2/4', () => {
        expect(detectedCountExpected(['covered', 'covered', 'partial', 'missing'])).toBe(3);
        expect(detectedCountExpected(['covered', 'covered', 'covered', 'covered'])).toBe(4);
        expect(detectedCountExpected(['missing', 'missing'])).toBe(0);
    });
});

describe('r4105978630 — feedback retention is proven after deletion, not before', () => {
    it('PASS only when the account was deleted and the report still exists with its user link cleared', () => {
        expect(feedbackRetentionVerdict({ reportId: 'r1', deletion: 'deleted', read: { error: false, rows: [{ user_id: null }] } }).verdict).toBe('PASS');
    });
    it('CASUALTY: a report cascaded away with the account FAILS', () => {
        expect(feedbackRetentionVerdict({ reportId: 'r1', deletion: 'deleted', read: { error: false, rows: [] } }).verdict).toBe('FAIL');
    });
    it('CASUALTY: a report still linked to the deleted user FAILS', () => {
        expect(feedbackRetentionVerdict({ reportId: 'r1', deletion: 'deleted', read: { error: false, rows: [{ user_id: 'u1' }] } }).verdict).toBe('FAIL');
    });
    it('HOLD (never PASS) when the deletion did not complete, the read failed, or no report was stored', () => {
        expect(feedbackRetentionVerdict({ reportId: 'r1', deletion: 'failed', read: null }).verdict).toBe('HOLD');
        expect(feedbackRetentionVerdict({ reportId: 'r1', deletion: 'deleted', read: { error: true, rows: [] } }).verdict).toBe('HOLD');
        expect(feedbackRetentionVerdict({ reportId: null, deletion: 'deleted', read: null }).verdict).toBe('HOLD');
    });
    it('the evidence is content-free (no report id, no user id)', () => {
        const v = feedbackRetentionVerdict({ reportId: 'report-abc', deletion: 'deleted', read: { error: false, rows: [{ user_id: 'user-xyz' }] } });
        expect(JSON.stringify(v)).not.toMatch(/report-abc|user-xyz/);
    });
});

// v12 preflight (PM 5859727542, Dev mapping 5860497358): model DOWNLOAD vs engine SETUP timing, measured separately.
describe('v12 — download vs setup timing from the app\'s own acquisition receipt', () => {
    it('PASS when the receipt measured download and setup separately (complete), content-free evidence', () => {
        const v = acquisitionTimingVerdict([{ cacheResult: 'miss', completeness: 'complete', downloadMs: 41_200, initMs: 3_100, totalMs: 44_500 }]);
        expect(v.verdict).toBe('PASS');
        expect(v.evidence).toMatchObject({ cacheResult: 'miss', downloadMs: 41_200, initMs: 3_100, totalMs: 44_500 });
    });
    it('HOLD for a warm cache (hit): a first-use download claim needs a proven COLD acquisition (PM 5860859136)', () => {
        const v = acquisitionTimingVerdict([{ cacheResult: 'hit', completeness: 'complete', downloadMs: 0, initMs: 2_000, totalMs: 2_000 }]);
        expect(v.verdict).toBe('HOLD');
        expect(v.detail).toMatch(/not a cold/);
    });
    it('HOLD for partial / unobservable cache results — never a download inferred from total time', () => {
        for (const cacheResult of ['partial', 'unobservable', undefined]) {
            expect(acquisitionTimingVerdict([{ cacheResult, completeness: 'complete', downloadMs: 10, initMs: 5, totalMs: 15 }]).verdict).toBe('HOLD');
        }
    });
    it('the evidence says it is browser-sent, not a PostHog receipt', () => {
        expect(acquisitionTimingVerdict([{ cacheResult: 'miss', completeness: 'complete', downloadMs: 1, initMs: 1, totalMs: 2 }]).evidence.evidenceClass).toBe('browser_sent');
    });
    it('HOLD (never PASS) when no receipt was sent, or it was only partially measured, or a split is missing', () => {
        expect(acquisitionTimingVerdict([]).verdict).toBe('HOLD');
        expect(acquisitionTimingVerdict([{ cacheResult: 'miss', completeness: 'partial', downloadMs: null, initMs: null, totalMs: 9_000 }]).verdict).toBe('HOLD');
        expect(acquisitionTimingVerdict([{ cacheResult: 'miss', completeness: 'complete', downloadMs: 1, initMs: null, totalMs: 9 }]).verdict).toBe('HOLD');
    });
    it('uses the FIRST acquisition of the journey (the first-use cost)', () => {
        const v = acquisitionTimingVerdict([
            { cacheResult: 'miss', completeness: 'complete', downloadMs: 30_000, initMs: 3_000, totalMs: 33_000 },
            { cacheResult: 'hit', completeness: 'complete', downloadMs: 0, initMs: 1_000, totalMs: 1_000 },
        ]);
        expect(v.evidence).toMatchObject({ cacheResult: 'miss', downloadMs: 30_000, acquisitions: 2 });
    });
});

// #1538 provenance (PROPOSAL for PM, 2026-09-28): the saved Focus pair must be the one generated from the saved point
// results (`gemini_coaching_focus_v1`), requested by a client that declared it reads that provenance.
describe('#1538 — Focus coaching provenance', () => {
    const CAPABLE = ['gemini_coaching_v1', 'gemini_coaching_focus_v1'];
    it('CONTROL: a focus_v1 saved pair from a capable request passes', () => {
        expect(focusCoachingProvenanceVerdict({ savedVersion: 'gemini_coaching_focus_v1', acceptedVersions: CAPABLE }).verdict).toBe('PASS');
    });
    it('CASUALTY: a generic v1 saved pair on a Focus take fails (not generated from the points)', () => {
        const v = focusCoachingProvenanceVerdict({ savedVersion: 'gemini_coaching_v1', acceptedVersions: CAPABLE });
        expect(v.verdict).toBe('FAIL');
        expect(v.detail).toMatch(/not generated from the saved point results/);
    });
    it('CASUALTY: a request without the capability fails (a legacy client would be shown a relabelled copy)', () => {
        for (const accepted of [null, undefined, [], ['gemini_coaching_v1'], 'gemini_coaching_focus_v1']) {
            expect(focusCoachingProvenanceVerdict({ savedVersion: 'gemini_coaching_focus_v1', acceptedVersions: accepted }).verdict).toBe('FAIL');
        }
    });
    it('HOLD: no saved version to read is not a pass', () => {
        expect(focusCoachingProvenanceVerdict({ savedVersion: null, acceptedVersions: CAPABLE }).verdict).toBe('HOLD');
    });
});

// #1532 Codex P2 r4120338752 (PM RETURN 5866867380): the saved verdict of EACH point must match what the rail showed for
// that point — counts alone let a swapped detected/not-detected pair pass.
describe('persistedVerdictMismatches', () => {
    const points = [{ id: 'p0', sort_order: 0 }, { id: 'p1', sort_order: 1 }, { id: 'p2', sort_order: 2 }, { id: 'p3', sort_order: 3 }];
    const rail = ['covered', 'covered', 'partial', 'missing'] as const;
    const saved = (v: string[]) => v.map((verdict, i) => ({ brief_point_id: `p${i}`, verdict }));

    it('CONTROL: covered and partial persist as detected, missing as not_detected — per point', () => {
        expect(persistedVerdictMismatches([...rail], points, saved(['detected', 'detected', 'detected', 'not_detected']))).toEqual([]);
    });

    it('CASUALTY: a swapped detected / not-detected pair keeps both counts but is caught, by point', () => {
        const swapped = saved(['detected', 'detected', 'not_detected', 'detected']);
        expect(swapped.filter((r) => r.verdict === 'detected').length).toBe(3); // the old count check would pass
        expect(persistedVerdictMismatches([...rail], points, swapped)).toEqual([2, 3]);
    });

    it('points are matched by sort_order, not by row order', () => {
        const shuffled = [...saved(['detected', 'detected', 'detected', 'not_detected'])].reverse();
        const pointsShuffled = [...points].reverse();
        expect(persistedVerdictMismatches([...rail], pointsShuffled, shuffled)).toEqual([]);
    });

    it('CASUALTY: a missing, duplicate, unknown-point or unavailable verdict is a mismatch; so is a still-pending rail point', () => {
        expect(persistedVerdictMismatches([...rail], points, saved(['detected', 'detected', 'detected']))).toEqual([3]);
        expect(persistedVerdictMismatches([...rail], points, [...saved(['detected', 'detected', 'detected', 'not_detected']), { brief_point_id: 'p0', verdict: 'detected' }])).toEqual([0]);
        expect(persistedVerdictMismatches([...rail], points, [...saved(['detected', 'detected', 'detected', 'not_detected']), { brief_point_id: 'px', verdict: 'detected' }])).toEqual([-1]);
        expect(persistedVerdictMismatches([...rail], points, saved(['detected', 'unavailable', 'detected', 'not_detected']))).toEqual([1]);
        expect(persistedVerdictMismatches(['covered', 'pending', 'partial', 'missing'], points, saved(['detected', 'detected', 'detected', 'not_detected']))).toEqual([1]);
    });
});

/** #1532 Codex P2 r4127572206 (PM RETURN 5879843525) — every point expected to be detected changes LIVE, judged per point. */
describe('r4127572206 — the expected-partial point must visibly change during speech', () => {
    const PARTIAL = ['covered', 'covered', 'partial', 'missing'];
    const at = (status: string) => ({ status });

    it('RED case: points 1–2 change live but the expected-partial point 3 stays pending → point 3 is reported', () => {
        expect(liveChangeFailures(PARTIAL, [at('covered'), at('covered'), null, null])).toEqual([2]);
    });
    it('GREEN: covered points and the partial point change live; the missing point is not required to', () => {
        expect(liveChangeFailures(PARTIAL, [at('covered'), at('covered'), at('partial'), null])).toEqual([]);
    });
    it('any visible non-pending live state counts; the final verdict is checked separately after Stop', () => {
        expect(liveChangeFailures(PARTIAL, [at('covered'), at('covered'), at('covered'), null])).toEqual([]);
    });
    it('per point, not by count: a wrong point changing cannot stand in for the partial one', () => {
        expect(liveChangeFailures(PARTIAL, [at('covered'), at('covered'), null, at('covered')])).toEqual([2]);
    });
    it('a covered point with no live change is still reported (unchanged behaviour)', () => {
        expect(liveChangeFailures(PARTIAL, [null, at('covered'), at('partial'), null])).toEqual([0]);
        expect(liveChangeFailures(['covered', 'covered', 'covered', 'covered'], [at('covered'), at('covered'), at('covered'), at('covered')])).toEqual([]);
    });
    it('expectsLiveChange: covered and partial yes; missing no', () => {
        expect(['covered', 'partial', 'missing'].map(expectsLiveChange)).toEqual([true, true, false]);
    });
    it('wiring: the Focus journey judges both the live row and the timing oracle with the shared predicate', () => {
        const src = readFileSync(resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        expect(src).toContain('const notLive = liveChangeFailures(expectedFinal, firstChange);');
        expect(src).toMatch(/receipt\.row\('live marker changes', notLive\.length === 0 && ordered \? 'PASS' : 'FAIL'/);
        expect(src).toContain("if (!change) return expectsLiveChange(expectedFinal[i]) ? 'no-live-change' : 'ok-no-change';");
        expect(src).not.toContain("expectedFinal.filter((e) => e === 'covered').length");
    });
});
