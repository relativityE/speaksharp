import { describe, expect, it } from 'vitest';
import { classifyRequestFailure, filterFailingConsoleErrors, type RequestFailureEvent, type BenignAbortEvent } from './frontend-ui-memcheck';

type TestPhase = 'setup' | 'navigation' | 'teardown' | 'active' | 'complete';

const IGNORED_READ_REASON = 'Known read-only polling endpoint aborted outside active recording (setup/navigation/teardown).';

const baseFailure: RequestFailureEvent = {
    userIndex: 0,
    url: 'https://yxlapjuovrsvjswkwnrk.supabase.co/functions/v1/check-usage-limit',
    method: 'GET',
    errorText: 'net::ERR_ABORTED',
    phase: 'teardown',
    functionalJourneyPassed: true,
};

describe('classifyRequestFailure', () => {
    it('records known read-only teardown aborts without failing release evidence', () => {
        const result = classifyRequestFailure(baseFailure);

        expect(result).toEqual({
            kind: 'ignored_teardown_read',
            reason: IGNORED_READ_REASON,
            category: 'usage_poll',
        });
    });

    it('records Supabase HEAD count reads during navigation without failing release evidence', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            url: 'https://yxlapjuovrsvjswkwnrk.supabase.co/rest/v1/sessions?select=id',
            method: 'HEAD',
            phase: 'navigation',
        });

        expect(result).toEqual({
            kind: 'ignored_teardown_read',
            reason: IGNORED_READ_REASON,
            category: 'session_history_read',
        });
    });

    it('records read-only usage checks invoked as POST after functional proof', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            method: 'POST',
            phase: 'navigation',
        });

        expect(result).toEqual({
            kind: 'ignored_teardown_read',
            reason: IGNORED_READ_REASON,
            category: 'usage_poll',
        });
    });

    // #1294 finding #5: a usage poll cancelled during SETUP (before the journey runs) is benign navigation
    // churn — the functional journey still succeeded with healthy memory. It must NOT be flagged critical.
    it('records read-only usage POST aborts during setup (before functional proof) as benign', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            method: 'POST',
            phase: 'setup',
            functionalJourneyPassed: false,
        });

        expect(result).toEqual({
            kind: 'ignored_teardown_read',
            reason: IGNORED_READ_REASON,
            category: 'usage_poll',
        });
    });

    // #1294 finding #5: a Vite dev-server module/asset fetch cancelled by navigation is a dev-harness
    // artifact (no such request exists in a production build), never a product failure.
    it('records Vite dev-server module fetch aborts as a dev-harness artifact', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            url: 'http://localhost:5173/src/pages/PracticePage.tsx',
            method: 'GET',
            phase: 'setup',
            functionalJourneyPassed: false,
        });

        expect(result).toEqual({
            kind: 'ignored_teardown_read',
            reason: 'Vite dev-server module/asset fetch aborted by navigation (dev harness only).',
            category: 'dev_asset_navigation_abort',
        });
    });

    // #1294 finding #5: the fire-and-forget set_user_timezone RPC is idempotent; a navigation abort during
    // setup is benign (the app never awaits it). Only an abort during active recording stays critical.
    it('records set_user_timezone POST aborts during setup as benign', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            url: 'https://yxlapjuovrsvjswkwnrk.supabase.co/rest/v1/rpc/set_user_timezone',
            method: 'POST',
            phase: 'setup',
            functionalJourneyPassed: false,
        });
        expect(result).toEqual({
            kind: 'ignored_teardown_read',
            reason: IGNORED_READ_REASON,
            category: 'timezone_preference',
        });
    });

    it('fails set_user_timezone POST aborts DURING active recording before the functional journey', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            url: 'https://yxlapjuovrsvjswkwnrk.supabase.co/rest/v1/rpc/set_user_timezone',
            method: 'POST',
            phase: 'active',
            functionalJourneyPassed: false,
        });
        expect(result).toEqual({
            kind: 'critical',
            reason: 'Read aborted during active recording before the functional journey passed',
        });
    });

    it('fails aborted write requests even during teardown', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            url: 'https://yxlapjuovrsvjswkwnrk.supabase.co/rest/v1/sessions',
            method: 'POST',
        });

        expect(result).toEqual({
            kind: 'critical',
            reason: 'Aborted non-read request',
        });
    });

    it('fails a NON-abort failure (real error) even on an allowlisted read endpoint', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            errorText: 'net::ERR_CONNECTION_REFUSED',
        });

        expect(result).toEqual({
            kind: 'critical',
            reason: 'Unexpected request failure: net::ERR_CONNECTION_REFUSED',
        });
    });

    // The active-recording window is the one place a known-read abort still matters: an abort there, before
    // the functional proof, could mask an unexpected teardown — so it stays critical.
    it('fails known read aborts DURING active recording before the functional journey has passed', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            phase: 'active',
            functionalJourneyPassed: false,
        });

        expect(result).toEqual({
            kind: 'critical',
            reason: 'Read aborted during active recording before the functional journey passed',
        });
    });

    it('fails read-only usage POST aborts DURING active recording before the functional journey has passed', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            method: 'POST',
            phase: 'active',
            functionalJourneyPassed: false,
        });

        expect(result).toEqual({
            kind: 'critical',
            reason: 'Read aborted during active recording before the functional journey passed',
        });
    });

    it('fails unknown read endpoints even after functional proof', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            url: 'https://example.com/telemetry/poll',
        });

        expect(result).toEqual({
            kind: 'critical',
            reason: 'Aborted read endpoint is not in the teardown allowlist',
        });
    });
});

// #1294 finding #5 (RETURN 5298368995) — benign-console suppression is correlated PER ERR_ABORTED EVENT: same
// user, same category, non-active phase, within a time window, and each abort consumed at most once. A run-wide
// set is wrong (one user's/one moment's abort must not excuse another's error).
describe('filterFailingConsoleErrors — per-event abort correlation, consumed once', () => {
    const TZ = '{error: Object} Error calling set_user_timezone:';
    const HIST = '{error: Object} [sessionService.getRecentReviewable] Unable to load your session history';
    const err = (userIndex: number, text: string, phase: TestPhase, ts: number) => ({ userIndex, type: 'error', text, phase, ts });
    const abort = (userIndex: number, category: string, phase: TestPhase, ts: number): BenignAbortEvent => ({ userIndex, category, phase, ts });

    it('SUPPRESSES a set_user_timezone log correlated to the same user/category/phase within the window', () => {
        const out = filterFailingConsoleErrors([err(0, TZ, 'setup', 1000)], [abort(0, 'timezone_preference', 'setup', 1100)]);
        expect(out).toHaveLength(0);
    });

    it('SUPPRESSES a getRecentReviewable log correlated to a same-user session-history abort in navigation', () => {
        const out = filterFailingConsoleErrors([err(1, HIST, 'navigation', 2000)], [abort(1, 'session_history_read', 'navigation', 2050)]);
        expect(out).toHaveLength(0);
    });

    // NEGATIVE (RETURN #4a): user 0's abort cannot suppress user 1's matching error.
    it("FAILS: user 0's abort cannot suppress user 1's error", () => {
        const out = filterFailingConsoleErrors([err(1, TZ, 'setup', 1000)], [abort(0, 'timezone_preference', 'setup', 1000)]);
        expect(out).toHaveLength(1);
        expect(out[0].userIndex).toBe(1);
    });

    // NEGATIVE (RETURN #4b): one abort cannot suppress two DISTINCT errors (>double-log window apart).
    it('FAILS: one abort cannot suppress two distinct errors (consumed once)', () => {
        const out = filterFailingConsoleErrors(
            [err(0, TZ, 'setup', 1000), err(0, TZ, 'setup', 2000)], // 1s apart → distinct events, not a double-log
            [abort(0, 'timezone_preference', 'setup', 1050)]);
        expect(out).toHaveLength(1); // the first is suppressed; the second (distinct) has no unconsumed abort → fails
    });

    // A single aborted fetch double-logged by the app (both lines ~same instant) is ONE event: one abort excuses
    // both, without consuming a second abort. This is what user 1 hit in the deployed run (1 abort, 2 lines).
    it('SUPPRESSES both lines of a single aborted event double-log with ONE abort', () => {
        const out = filterFailingConsoleErrors(
            [err(1, 'Error fetching session history from https://x', 'setup', 1000),
             err(1, 'Unable to load your session history', 'setup', 1000)], // same-ms double-log of ONE abort
            [abort(1, 'session_history_read', 'setup', 1010)]);
        expect(out).toHaveLength(0);
    });

    // NEGATIVE (RETURN #4c): a stale abort cannot suppress a later error outside the correlation window.
    it('FAILS: an old abort cannot suppress a much-later error (out of window)', () => {
        const out = filterFailingConsoleErrors([err(0, TZ, 'setup', 60000)], [abort(0, 'timezone_preference', 'setup', 1000)]);
        expect(out).toHaveLength(1);
    });

    // NEGATIVE (RETURN #4d): active-phase and unrelated errors remain fatal; a 5xx (no abort event) fails.
    it('FAILS: an error during active recording is never suppressed', () => {
        const out = filterFailingConsoleErrors([err(0, TZ, 'active', 1000)], [abort(0, 'timezone_preference', 'active', 1000)]);
        expect(out).toHaveLength(1);
    });

    it('FAILS: a genuine set_user_timezone error with NO abort event (e.g. HTTP 5xx = requestfinished)', () => {
        const out = filterFailingConsoleErrors([err(0, TZ, 'setup', 1000)], []);
        expect(out).toHaveLength(1);
    });

    it('FAILS: an unrelated runtime error is never suppressed', () => {
        const out = filterFailingConsoleErrors([err(0, 'TypeError: cannot read x of undefined', 'setup', 1000)], [abort(0, 'timezone_preference', 'setup', 1000)]);
        expect(out).toHaveLength(1);
    });

    it('ignores warnings (only error-type console issues can fail)', () => {
        const out = filterFailingConsoleErrors([{ userIndex: 0, type: 'warning', text: 'a warning', phase: 'active', ts: 1 }], []);
        expect(out).toHaveLength(0);
    });

    it('two distinct aborts (same user/category) suppress exactly two DISTINCT errors, no more', () => {
        const out = filterFailingConsoleErrors(
            [err(0, TZ, 'setup', 1000), err(0, TZ, 'setup', 1400), err(0, TZ, 'setup', 1800)], // 400ms apart → distinct
            [abort(0, 'timezone_preference', 'setup', 1000), abort(0, 'timezone_preference', 'setup', 1400)]);
        expect(out).toHaveLength(1); // 2 distinct suppressed by 2 aborts; the 3rd distinct fails
    });
});
