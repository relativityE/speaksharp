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
        statusClass: '5xx', retryCount: 1, totalMs: 4200, providerMs: 3900, configuredModel: 'gemini-3.8-flash',
        observedModel: null, source: 'fresh',
    }],
});
const expectCurrent: DiagnosticExpectation = {
    reportId: 'rep-1', association: 'current_take', sessionId: 'ses-current', requestId: CURRENT, outcome: 'provider_error',
    attemptId: 'att-1', failureCategory: 'unavailable', configuredModel: 'gemini-3.8-flash', currentRequestId: CURRENT,
};

describe('#1258 feedback diagnostic contract — fail closed', () => {
    it('a complete, consistent, content-free chain is PASS', () => {
        expect(validateFeedbackDiagnostics(valid(), expectCurrent)).toEqual({ verdict: 'PASS', reasons: [] });
    });

    it('a successful request must name the provider-reported model; configured alone is HOLD', () => {
        const lookup = valid();
        Object.assign(lookup.requests[0], { outcome: 'success', failureCategory: null, statusClass: '2xx', observedModel: null });
        const success = { ...expectCurrent, outcome: 'success' as const, failureCategory: null };
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

    it('a report about an OLDER session must never carry the current take\'s request', () => {
        const lookup = valid();
        Object.assign(lookup.report, { sessionId: 'ses-older', association: 'selected_older_session' });
        const older: DiagnosticExpectation = { ...expectCurrent, association: 'selected_older_session', sessionId: 'ses-older', requestId: null, outcome: null, attemptId: null, failureCategory: null };
        expect(validateFeedbackDiagnostics(lookup, older).reasons).toContain('current_attempt_attached_to_other_session');
        lookup.report.linkedRequestId = null;
        expect(validateFeedbackDiagnostics(lookup, older)).toEqual({ verdict: 'PASS', reasons: [] });
    });

    it('a no-session report must carry no session and no request link (no invented link)', () => {
        const lookup = valid();
        Object.assign(lookup.report, { sessionId: null, association: 'no_session' });
        const none: DiagnosticExpectation = { ...expectCurrent, association: 'no_session', sessionId: null, requestId: null, outcome: null, attemptId: null, failureCategory: null };
        expect(validateFeedbackDiagnostics(lookup, none).reasons).toContain('invented_link');
        lookup.report.linkedRequestId = null;
        lookup.requests = [];
        expect(validateFeedbackDiagnostics(lookup, none)).toEqual({ verdict: 'PASS', reasons: [] });
    });

    it('content in the lookup (transcript, coaching text, prompt, email, report prose) is FAIL', () => {
        for (const key of ['transcript', 'what_worked', 'what_to_try_next', 'prompt', 'email', 'description']) {
            const lookup = valid() as unknown as Record<string, Record<string, unknown>>;
            lookup.report[key] = 'x';
            expect(validateFeedbackDiagnostics(lookup as unknown as FeedbackDiagnosticLookup, expectCurrent).reasons).toContain('content_leak');
        }
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
