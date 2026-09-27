// @vitest-environment node
/**
 * #1532 open Codex P1s (b5071da25) — the pure oracles behind three RWT rows:
 *  - r4105978609: the pre-credential surface is approved only once the app is visible-ready;
 *  - r4105978619: the partial fixture must produce a PARTIAL point, and partial counts as detected;
 *  - r4105978630: feedback retention is proven only AFTER the account is deleted (row kept, user link cleared).
 */
import { describe, it, expect } from 'vitest';
import {
    detectedCountExpected, feedbackRetentionVerdict, focusPointMeetsExpectation, surfaceReadinessFailures,
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
