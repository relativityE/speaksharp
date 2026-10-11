// @vitest-environment node
/**
 * #1258 RWT-feedback-journey-preparation (PM 6110520212): the AI request → Share Feedback support correlation must not
 * PASS when the chain is missing or mismatched. These cases fix the acceptance contract App Dev's journey will assert
 * against CLI Dev's diagnostics, before that code exists: missing evidence is HOLD, contradicting evidence is FAIL, and
 * only a complete, consistent, content-free chain is PASS.
 */
import { describe, expect, it } from 'vitest';
import {
    validateFeedbackDiagnostics,
    type DiagnosticExpectation,
    type FeedbackDiagnosticLookup,
} from '../live/helpers/feedbackDiagnosticContract';

const CURRENT = 'req-current';
const valid = (): FeedbackDiagnosticLookup => ({
    report: {
        reportId: 'rep-1', sessionId: 'ses-current', association: 'current_take', linkedRequestId: CURRENT,
        storage: 'stored_once', acknowledgementVisible: true, telemetryReceived: true,
    },
    requests: [{
        requestId: CURRENT, attemptId: 'att-1', sessionId: 'ses-current', outcome: 'provider_error', failureCategory: 'unavailable',
        serverReason: 'provider_http_5xx', statusClass: '5xx', providerStatusClass: '5xx', retryCount: 1, totalMs: 4200, providerMs: 3900, configuredModel: 'gemini-3.8-flash',
        observedModel: null, source: 'fresh',
    }],
});
const expectCurrent: DiagnosticExpectation = {
    reportId: 'rep-1', association: 'current_take', sessionId: 'ses-current', requestId: CURRENT, outcome: 'provider_error',
    attemptId: 'att-1', failureCategory: 'unavailable', serverReason: 'provider_http_5xx', configuredModel: 'gemini-3.8-flash', currentRequestId: CURRENT,
};

describe('#1258 feedback diagnostic contract — fail closed', () => {
    it('a complete, consistent, content-free chain is PASS', () => {
        expect(validateFeedbackDiagnostics(valid(), expectCurrent)).toEqual({ verdict: 'PASS', reasons: [] });
    });

    it('a successful request must name the provider-reported model; configured alone is HOLD', () => {
        const lookup = valid();
        Object.assign(lookup.requests[0], { outcome: 'success', failureCategory: null, serverReason: 'none', statusClass: '2xx', providerStatusClass: '2xx', observedModel: null });
        const success = { ...expectCurrent, outcome: 'success' as const, failureCategory: null, serverReason: 'none' };
        expect(validateFeedbackDiagnostics(lookup, success)).toEqual({ verdict: 'HOLD', reasons: ['observed_model_missing'] });
        lookup.requests[0].observedModel = 'gemini-3.8-flash-001';
        expect(validateFeedbackDiagnostics(lookup, success).verdict).toBe('PASS');
    });

    it.each([
        ['no lookup at all', () => null, 'report_not_found'],
        ['report not linked to any request', () => { const l = valid(); l.report.linkedRequestId = null; return l; }, 'request_link_missing'],
        ['linked request absent from the lookup', () => { const l = valid(); l.requests = []; return l; }, 'request_not_found'],
        ['feedback telemetry only sent, not received', () => { const l = valid(); l.report.telemetryReceived = false; return l; }, 'telemetry_not_received'],
    ])('MISSING evidence is HOLD, never PASS: %s', (_label, make, reason) => {
        expect(validateFeedbackDiagnostics(make(), expectCurrent)).toEqual({ verdict: 'HOLD', reasons: [reason] });
    });

    it.each([
        ['wrong association', (l: FeedbackDiagnosticLookup) => { l.report.association = 'no_session'; }, 'association_mismatch'],
        ['wrong session on the report', (l: FeedbackDiagnosticLookup) => { l.report.sessionId = 'ses-other'; }, 'session_mismatch'],
        ['linked to a different request', (l: FeedbackDiagnosticLookup) => { l.report.linkedRequestId = 'req-other'; l.requests[0].requestId = 'req-other'; }, 'request_mismatch'],
        ['request belongs to another session', (l: FeedbackDiagnosticLookup) => { l.requests[0].sessionId = 'ses-other'; }, 'request_session_mismatch'],
        ['outcome differs from what the run caused', (l: FeedbackDiagnosticLookup) => { l.requests[0].outcome = 'timeout'; }, 'outcome_mismatch'],
        ['stored twice', (l: FeedbackDiagnosticLookup) => { l.report.storage = 'stored_duplicate'; }, 'storage_not_exactly_once'],
        ['no visible acknowledgement', (l: FeedbackDiagnosticLookup) => { l.report.acknowledgementVisible = false; }, 'acknowledgement_not_visible'],
        ['unknown outcome token', (l: FeedbackDiagnosticLookup) => { (l.requests[0] as { outcome: string }).outcome = 'weird'; }, 'request_field_invalid'],
        ['negative duration', (l: FeedbackDiagnosticLookup) => { l.requests[0].totalMs = -1; }, 'request_field_invalid'],
        ['fractional retry count', (l: FeedbackDiagnosticLookup) => { l.requests[0].retryCount = 0.5; }, 'request_field_invalid'],
        ['status class contradicts the outcome', (l: FeedbackDiagnosticLookup) => { l.requests[0].statusClass = '2xx'; }, 'request_field_invalid'],
        ['empty configured model', (l: FeedbackDiagnosticLookup) => { l.requests[0].configuredModel = ''; }, 'request_field_invalid'],
        ['another report answered', (l: FeedbackDiagnosticLookup) => { l.report.reportId = 'rep-2'; }, 'report_mismatch'],
        ['another attempt', (l: FeedbackDiagnosticLookup) => { l.requests[0].attemptId = 'att-9'; }, 'attempt_mismatch'],
        ['another failure category', (l: FeedbackDiagnosticLookup) => { l.requests[0].failureCategory = 'network'; }, 'failure_category_mismatch'],
        ['an unknown failure category', (l: FeedbackDiagnosticLookup) => { l.requests[0].failureCategory = 'zzz'; }, 'request_field_invalid'],
        ['configured model not the contract target', (l: FeedbackDiagnosticLookup) => { l.requests[0].configuredModel = 'gemini-3.6-flash'; }, 'configured_model_mismatch'],
    ])('MISMATCHED evidence is FAIL: %s', (_label, mutate, reason) => {
        const lookup = valid();
        mutate(lookup);
        const result = validateFeedbackDiagnostics(lookup, expectCurrent);
        expect(result.verdict).toBe('FAIL');
        expect(result.reasons).toContain(reason);
    });

    describe('PM RETURN 6111565683 — exact source per outcome; coherent timing', () => {
        const as = (patch: Record<string, unknown>, exp: Partial<DiagnosticExpectation> = {}) => {
            const lookup = valid();
            Object.assign(lookup.requests[0], patch);
            return validateFeedbackDiagnostics(lookup, { ...expectCurrent, ...exp });
        };
        it.each([
            ['provider error claiming cache', { source: 'cache' }, {}],
            ['timeout claiming cache', { outcome: 'timeout', serverReason: 'provider_timeout', providerStatusClass: 'none', providerMs: null, source: 'cache' }, { outcome: 'timeout', serverReason: 'provider_timeout' }],
            ['invalid response claiming cache', { outcome: 'invalid_response', serverReason: 'invalid_shape', providerStatusClass: '2xx', source: 'cache' }, { outcome: 'invalid_response', serverReason: 'invalid_shape' }],
            ['rate limit claiming cache', { outcome: 'rate_limited', failureCategory: 'rate_limited', serverReason: 'quota_exceeded', statusClass: '4xx', providerStatusClass: 'none', providerMs: null, source: 'cache' }, { outcome: 'rate_limited', failureCategory: 'rate_limited', serverReason: 'quota_exceeded' }],
            ['pre-provider server refusal claiming fresh', { outcome: 'server_error', failureCategory: 'access_denied', serverReason: 'auth_failed', statusClass: '4xx', providerStatusClass: 'none', providerMs: null, source: 'fresh' }, { outcome: 'server_error', failureCategory: 'access_denied', serverReason: 'auth_failed' }],
            ['client network loss claiming fresh', { outcome: 'client_network', failureCategory: 'network', serverReason: null, statusClass: 'none', providerStatusClass: 'none', providerMs: null, source: 'fresh' }, { outcome: 'client_network', failureCategory: 'network', serverReason: null }],
            ['post-provider failure claiming unknown', { outcome: 'invalid_response', serverReason: 'missing_text', providerStatusClass: '2xx', source: 'unknown' }, { outcome: 'invalid_response', serverReason: 'missing_text' }],
            ['server failure after the provider answered claiming unknown', { outcome: 'server_error', failureCategory: 'unavailable', serverReason: 'persist_failed', statusClass: '5xx', providerStatusClass: '2xx', source: 'unknown' }, { outcome: 'server_error', serverReason: 'persist_failed' }],
        ])('FAIL: %s', (_label, patch, exp) => {
            const verdict = as(patch, exp);
            expect(verdict.verdict).toBe('FAIL');
            expect(verdict.reasons).toContain('request_field_invalid');
        });
        it('GREEN: each outcome with its one honest source PASSES', () => {
            expect(as({}).verdict).toBe('PASS'); // provider_error, fresh
            expect(as({ outcome: 'server_error', failureCategory: 'unavailable', serverReason: 'persist_failed', statusClass: '5xx', providerStatusClass: '2xx', source: 'fresh' },
                { outcome: 'server_error', serverReason: 'persist_failed' }).verdict).toBe('PASS');
            expect(as({ outcome: 'rate_limited', failureCategory: 'rate_limited', serverReason: 'quota_exceeded', statusClass: '4xx', providerStatusClass: 'none', providerMs: null, source: 'unknown' },
                { outcome: 'rate_limited', failureCategory: 'rate_limited', serverReason: 'quota_exceeded' }).verdict).toBe('PASS');
        });
        it('a provider leg longer than the whole request is FAIL; equal is allowed', () => {
            expect(as({ providerMs: 4201, totalMs: 4200 }).reasons).toContain('request_field_invalid');
            expect(as({ providerMs: 4200, totalMs: 4200 }).verdict).toBe('PASS');
        });
    });

    describe('PM 6111008437 — endpoint vs provider status, server_error, server reason, honest unknown source', () => {
        const as = (patch: Record<string, unknown>, exp: Partial<DiagnosticExpectation> = {}) => {
            const lookup = valid();
            Object.assign(lookup.requests[0], patch);
            return validateFeedbackDiagnostics(lookup, { ...expectCurrent, ...exp });
        };
        it('a provider timeout keeps the endpoint\'s answered 5xx; provider none', () => {
            expect(as({ outcome: 'timeout', serverReason: 'provider_timeout', statusClass: '5xx', providerStatusClass: 'none', providerMs: null },
                { outcome: 'timeout', serverReason: 'provider_timeout' }).verdict).toBe('PASS');
            expect(as({ outcome: 'timeout', serverReason: 'provider_timeout', statusClass: 'none', providerStatusClass: 'none' },
                { outcome: 'timeout', serverReason: 'provider_timeout' }).reasons, 'endpoint status must not be fabricated as none').toContain('request_field_invalid');
        });
        it('a client network loss genuinely has no endpoint status, no server reason, unknown source', () => {
            expect(as({ outcome: 'client_network', failureCategory: 'network', serverReason: null, statusClass: 'none', providerStatusClass: 'none', providerMs: null, source: 'unknown' },
                { outcome: 'client_network', failureCategory: 'network', serverReason: null }).verdict).toBe('PASS');
        });
        it('server_error keeps its exact closed reason; it is never coerced into provider_error', () => {
            const pass = as({ outcome: 'server_error', failureCategory: 'access_denied', serverReason: 'auth_failed', statusClass: '4xx', providerStatusClass: 'none', providerMs: null, source: 'unknown' },
                { outcome: 'server_error', failureCategory: 'access_denied', serverReason: 'auth_failed' });
            expect(pass.verdict).toBe('PASS');
            expect(as({ outcome: 'provider_error', serverReason: 'auth_failed' }).reasons).toContain('request_field_invalid');
        });
        it('the injected server reason and the visible category are asserted independently', () => {
            expect(as({ serverReason: 'provider_http_4xx', providerStatusClass: '4xx' }).reasons).toEqual(['server_reason_mismatch']);
            expect(as({ failureCategory: 'network' }).reasons).toEqual(['failure_category_mismatch']);
        });
        it('source unknown is refused once the provider answered, and on success', () => {
            expect(as({ source: 'unknown' }).reasons).toContain('request_field_invalid');
            expect(as({ outcome: 'success', failureCategory: null, serverReason: 'none', statusClass: '2xx', providerStatusClass: '2xx', observedModel: 'm', source: 'unknown' },
                { outcome: 'success', failureCategory: null, serverReason: 'none' }).reasons).toContain('request_field_invalid');
        });
        it('a cache success made no provider call; a fresh success must show the provider 2xx', () => {
            const ok = { outcome: 'success', failureCategory: null, serverReason: 'none', statusClass: '2xx', observedModel: 'gemini-3.8-flash-001' };
            const exp = { outcome: 'success' as const, failureCategory: null, serverReason: 'none' };
            expect(as({ ...ok, source: 'cache', providerStatusClass: 'none', providerMs: null }, exp).verdict).toBe('PASS');
            expect(as({ ...ok, source: 'cache', providerStatusClass: '2xx' }, exp).reasons).toContain('request_field_invalid');
            expect(as({ ...ok, source: 'fresh', providerStatusClass: 'none' }, exp).reasons).toContain('request_field_invalid');
        });
    });

    it('a report about an OLDER session must never carry the current take\'s request', () => {
        const lookup = valid();
        Object.assign(lookup.report, { sessionId: 'ses-older', association: 'selected_older_session' });
        const older: DiagnosticExpectation = { ...expectCurrent, association: 'selected_older_session', sessionId: 'ses-older', requestId: null, outcome: null, attemptId: null, failureCategory: null, serverReason: null };
        expect(validateFeedbackDiagnostics(lookup, older).reasons).toContain('current_attempt_attached_to_other_session');
        lookup.report.linkedRequestId = null;
        expect(validateFeedbackDiagnostics(lookup, older)).toEqual({ verdict: 'PASS', reasons: [] });
    });

    it('a no-session report must carry no session and no request link (no invented link)', () => {
        const lookup = valid();
        Object.assign(lookup.report, { sessionId: null, association: 'no_session' });
        const none: DiagnosticExpectation = { ...expectCurrent, association: 'no_session', sessionId: null, requestId: null, outcome: null, attemptId: null, failureCategory: null, serverReason: null };
        expect(validateFeedbackDiagnostics(lookup, none).reasons).toContain('invented_link');
        lookup.report.linkedRequestId = null;
        lookup.requests = [];
        expect(validateFeedbackDiagnostics(lookup, none)).toEqual({ verdict: 'PASS', reasons: [] });
    });

    it('the schema is an ALLOWLIST: any unexpected key, at any level, is FAIL — content names need not be guessed', () => {
        const cases: Array<(l: Record<string, unknown> & { report: Record<string, unknown>; requests: Record<string, unknown>[] }) => void> = [
            (l) => { l.report.transcript = 'x'; },
            (l) => { l.report.audio = 'data:…'; },
            (l) => { l.requests[0].apiKey = 'k'; },
            (l) => { l.requests[0].authorization = 'Bearer t'; },
            (l) => { l.requests[0].payload = { anything: 'nested' }; },
            (l) => { l.report.sessionId = { nested: 'object' } as unknown as string; },
            (l) => { l.requests[0].observedModel = ['array'] as unknown as string; },
            (l) => { l.extra = 1; },
            (l) => { l.requests = { not: 'an array' } as unknown as Record<string, unknown>[]; },
        ];
        for (const mutate of cases) {
            const lookup = valid() as unknown as Parameters<typeof mutate>[0];
            mutate(lookup);
            const verdict = validateFeedbackDiagnostics(lookup as unknown as FeedbackDiagnosticLookup, expectCurrent);
            expect(verdict.verdict).toBe('FAIL');
            expect(verdict.reasons).toContain('unexpected_field');
        }
    });

    it('legitimate free-form values stay valid: a provider model string and opaque ids', () => {
        const lookup = valid();
        Object.assign(lookup.requests[0], { outcome: 'success', failureCategory: null, serverReason: 'none', statusClass: '2xx', providerStatusClass: '2xx', observedModel: 'models/gemini-3.8-flash-preview-0925 (rev 7)' });
        expect(validateFeedbackDiagnostics(lookup, { ...expectCurrent, outcome: 'success', failureCategory: null, serverReason: 'none' }).verdict).toBe('PASS');
    });

    describe('PM RETURN 6110940975 — an older-session report\'s link must resolve', () => {
        const olderExpected = (): DiagnosticExpectation => ({ ...expectCurrent, association: 'selected_older_session', sessionId: 'ses-older', requestId: null, outcome: null, attemptId: null, failureCategory: null, serverReason: null });
        const olderLookup = (): FeedbackDiagnosticLookup => {
            const l = valid();
            Object.assign(l.report, { sessionId: 'ses-older', association: 'selected_older_session', linkedRequestId: 'req-older' });
            l.requests = [{ ...l.requests[0], requestId: 'req-older', attemptId: 'att-0', sessionId: 'ses-older' }];
            return l;
        };
        it('a valid older request bound to the older session PASSES', () => {
            expect(validateFeedbackDiagnostics(olderLookup(), olderExpected())).toEqual({ verdict: 'PASS', reasons: [] });
        });
        it('an UNKNOWN link (no such request in the lookup) is HOLD, never PASS', () => {
            const l = olderLookup();
            l.requests = [];
            expect(validateFeedbackDiagnostics(l, olderExpected())).toEqual({ verdict: 'HOLD', reasons: ['request_not_found'] });
        });
        it('a MALFORMED linked record is FAIL', () => {
            const l = olderLookup();
            l.requests[0].retryCount = -2;
            expect(validateFeedbackDiagnostics(l, olderExpected())).toEqual({ verdict: 'FAIL', reasons: ['request_field_invalid'] });
        });
        it('a linked request from ANOTHER session is FAIL', () => {
            const l = olderLookup();
            l.requests[0].sessionId = 'ses-third';
            expect(validateFeedbackDiagnostics(l, olderExpected())).toEqual({ verdict: 'FAIL', reasons: ['request_session_mismatch'] });
        });
        it('a duplicated linked record is FAIL', () => {
            const l = olderLookup();
            l.requests = [l.requests[0], { ...l.requests[0] }];
            expect(validateFeedbackDiagnostics(l, olderExpected())).toEqual({ verdict: 'FAIL', reasons: ['request_field_invalid'] });
        });
    });

    it('no single-field corruption of a valid chain can PASS', () => {
        const scalarPaths = [
            ...Object.keys(valid().report).map((k) => ['report', k] as const),
            ...Object.keys(valid().requests[0]).map((k) => ['requests', k] as const),
        ];
        for (const [part, key] of scalarPaths) {
            for (const bad of [undefined, null, '', 'zzz', -1, true]) {
                const lookup = valid();
                const target = (part === 'report' ? lookup.report : lookup.requests[0]) as Record<string, unknown>;
                if (target[key] === bad) continue;
                // Legitimately variable for a provider error: a null provider leg, and whatever model version the provider
                // reported (any non-empty string, or null) — the run cannot know it in advance.
                if (bad === null && ['observedModel', 'providerMs'].includes(key)) continue;
                if (key === 'observedModel' && bad === 'zzz') continue;
                target[key] = bad;
                expect(validateFeedbackDiagnostics(lookup, expectCurrent).verdict, `${part}.${key}=${String(bad)}`).not.toBe('PASS');
            }
        }
    });
});
