import { describe, expect, it } from 'vitest';
import { classifyRequestFailure, type RequestFailureEvent } from './frontend-ui-memcheck';

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
