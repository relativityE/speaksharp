// @vitest-environment node
/**
 * #1532 open Codex P1s (b5071da25) — the pure oracles behind three RWT rows:
 *  - r4105978609: the pre-credential surface is approved only once the app is visible-ready;
 *  - r4105978619: the partial fixture must produce a PARTIAL point, and partial counts as detected;
 *  - r4105978630: feedback retention is proven only AFTER the account is deleted (row kept, user link cleared).
 */
import { describe, it, expect } from 'vitest';
import {
    acquisitionTimingVerdict, detectedCountExpected, feedbackRetentionVerdict, focusPointMeetsExpectation, surfaceReadinessFailures,
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
    it('PASS for a warm cache (hit) with setup measured and no download', () => {
        expect(acquisitionTimingVerdict([{ cacheResult: 'hit', completeness: 'complete', downloadMs: 0, initMs: 2_000, totalMs: 2_000 }]).verdict).toBe('PASS');
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
