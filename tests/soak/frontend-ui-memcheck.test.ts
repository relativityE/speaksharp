import { describe, expect, it } from 'vitest';
import { classifyRequestFailure, filterFailingConsoleErrors, type RequestFailureEvent } from './frontend-ui-memcheck';

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

// #1294 finding #5 — the benign-console filter must suppress ONLY the exact setup/navigation abort noise, and
// genuine HTTP/runtime errors (even ones whose text mentions the same endpoints) must still fail the run.
describe('filterFailingConsoleErrors — narrow benign-console suppression', () => {
    const TZ = '{error: Object} Error calling set_user_timezone:';
    const HIST = '{error: Object} [sessionService.getRecentReviewable] Unable to load your session history';
    const abortedTz = new Set(['timezone_preference']);
    const abortedHist = new Set(['session_history_read']);

    it('SUPPRESSES the exact set_user_timezone abort log when that endpoint recorded a benign abort in setup', () => {
        const out = filterFailingConsoleErrors([{ type: 'error', text: TZ, phase: 'setup' }], abortedTz);
        expect(out).toHaveLength(0);
    });

    it('SUPPRESSES the getRecentReviewable abort log when a session-history read aborted during navigation', () => {
        const out = filterFailingConsoleErrors([{ type: 'error', text: HIST, phase: 'navigation' }], abortedHist);
        expect(out).toHaveLength(0);
    });

    // NEGATIVE: a genuine error (NO abort recorded for that endpoint — e.g. an HTTP 5xx, which is
    // requestfinished, never requestfailed) still FAILS even though its text mentions set_user_timezone.
    it('FAILS a genuine set_user_timezone error when no benign abort was recorded (e.g. HTTP 500)', () => {
        const out = filterFailingConsoleErrors([{ type: 'error', text: TZ, phase: 'setup' }], new Set());
        expect(out).toHaveLength(1);
    });

    // NEGATIVE: an error during ACTIVE recording is never suppressed, even if the endpoint aborted elsewhere.
    it('FAILS a set_user_timezone error during active recording', () => {
        const out = filterFailingConsoleErrors([{ type: 'error', text: TZ, phase: 'active' }], abortedTz);
        expect(out).toHaveLength(1);
    });

    // NEGATIVE: an unrelated runtime error is never suppressed.
    it('FAILS an unrelated runtime error', () => {
        const out = filterFailingConsoleErrors([{ type: 'error', text: 'TypeError: cannot read x of undefined', phase: 'setup' }], abortedTz);
        expect(out).toHaveLength(1);
    });

    // NEGATIVE: a getRecentReviewable error without the correlated abort still fails.
    it('FAILS a getRecentReviewable error when no session-history abort was recorded', () => {
        const out = filterFailingConsoleErrors([{ type: 'error', text: HIST, phase: 'navigation' }], new Set());
        expect(out).toHaveLength(1);
    });

    it('ignores warnings (only error-type console issues can fail)', () => {
        const out = filterFailingConsoleErrors([{ type: 'warning', text: 'a warning', phase: 'active' }], new Set());
        expect(out).toHaveLength(0);
    });
});
