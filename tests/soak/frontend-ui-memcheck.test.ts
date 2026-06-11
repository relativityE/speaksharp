import { describe, expect, it } from 'vitest';
import { classifyRequestFailure, type RequestFailureEvent } from './frontend-ui-memcheck';

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
            reason: 'Known read-only polling endpoint aborted during teardown/navigation after functional proof.',
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
            reason: 'Known read-only polling endpoint aborted during teardown/navigation after functional proof.',
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
            reason: 'Known read-only polling endpoint aborted during teardown/navigation after functional proof.',
            category: 'usage_poll',
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

    it('fails known read aborts before the functional journey has passed', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            phase: 'active',
            functionalJourneyPassed: false,
        });

        expect(result).toEqual({
            kind: 'critical',
            reason: 'Read aborted before the functional journey passed',
        });
    });

    it('fails read-only usage POST aborts before the functional journey has passed', () => {
        const result = classifyRequestFailure({
            ...baseFailure,
            method: 'POST',
            phase: 'active',
            functionalJourneyPassed: false,
        });

        expect(result).toEqual({
            kind: 'critical',
            reason: 'Read aborted before the functional journey passed',
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
