// @vitest-environment node
/**
 * #1258 (PM 6114590729): the #1589 → #1590 adapter maps what the run observed at the request boundary into the
 * feedback-diagnostic contract without deciding the verdict itself. The contract then PASSes only a complete chain,
 * HOLDs missing evidence and FAILs contradictions — including shapes the adapter cannot map.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    buildFeedbackLookup, contractOutcome, echoMismatch, feedbackDiagnosticChainRow, currentTakeExpectation, reportAssociation, terminalRequests, toAiRequestDiagnostic,
} from '../live/helpers/coachingFeedbackAdapter';
import { readSentRequest, readSuggestionPair, type CoachingExchange } from '../live/helpers/coachingGenerationTap';
import { validateFeedbackDiagnostics } from '../live/helpers/feedbackDiagnosticContract';

const MODEL = 'gemini-3.6-flash';
const SES = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const REQ = '33333333-3333-4333-8333-333333333333';
const ATT1 = '44444444-4444-4444-8444-444444444444';
const ATT2 = '55555555-5555-4555-8555-555555555555';

const exchange = (over: Partial<CoachingExchange> & { diag?: Record<string, unknown> } = {}): CoachingExchange => {
    const { diag, ...rest } = over;
    return {
        sent: { sessionId: SES, product: 'open_mic', requestId: REQ, attemptId: ATT1, clientAttempt: 1, clientReleaseId: null },
        status: 200,
        diagnostics: {
            schema_version: 'coaching_diagnostic_v1', request_id: REQ, attempt_id: ATT1, client_attempt: 1, phase: 'complete',
            outcome: 'success', reason: 'none', status: 200, provider_status: 200, provider: 'google_gemini',
            configured_model: MODEL, observed_model: `${MODEL}-001`, source: 'fresh', provider_attempts: 1, retry_count: 0,
            provider_duration_ms: 640, total_duration_ms: 920, prompt_sha256: 'a'.repeat(64), product: 'open_mic', has_session: true,
            ...diag,
        },
        suggestions: null, clientMs: 1000, at: 1,
        ...rest,
    };
};
const report = (sessionId: string | null = SES, ref: string | null = REQ) => ({ id: 'rep-1', sessionId, coachingDiagnosticRef: ref, storedRows: 1 });
const lookup = (exchanges: CoachingExchange[], telemetryReceived = true, r = report()) => buildFeedbackLookup({
    report: r, currentSessionId: SES, acknowledgementVisible: true, telemetryReceived, exchanges, failureCategory: () => 'unavailable',
});
const expectation = (exchanges: CoachingExchange[]) => currentTakeExpectation({ reportId: 'rep-1', currentSessionId: SES, exchanges, configuredModel: MODEL })!;

describe('#1258 coaching → feedback adapter', () => {
    it('a fresh success about the current take resolves to a complete PASS chain', () => {
        const ex = [exchange()];
        expect(validateFeedbackDiagnostics(lookup(ex), expectation(ex))).toEqual({ verdict: 'PASS', reasons: [] });
        expect(toAiRequestDiagnostic(ex[0], 'unavailable')).toMatchObject({ outcome: 'success', failureCategory: null, providerMs: 640, statusClass: '2xx', providerStatusClass: '2xx' });
    });

    it('a cache success carries no provider leg (providerMs null, provider class none) and still PASSes', () => {
        const ex = [exchange({ diag: { source: 'cache', provider_status: null, provider_attempts: 0, provider_duration_ms: 0 } })];
        expect(toAiRequestDiagnostic(ex[0], null)).toMatchObject({ source: 'cache', providerMs: null, providerStatusClass: 'none' });
        expect(validateFeedbackDiagnostics(lookup(ex), expectation(ex)).verdict).toBe('PASS');
    });

    it('received telemetry not yet proven is an honest HOLD, never PASS', () => {
        const ex = [exchange()];
        expect(validateFeedbackDiagnostics(lookup(ex, false), expectation(ex))).toEqual({ verdict: 'HOLD', reasons: ['telemetry_not_received'] });
    });

    it('`retrying` is intermediate: the terminal record is the request\'s LAST terminal attempt', () => {
        const ex = [
            exchange({ status: 425, diag: { outcome: 'retrying', reason: 'focus_results_pending', status: 425 } }),
            exchange({ sent: { sessionId: SES, product: 'open_mic', requestId: REQ, attemptId: ATT2, clientAttempt: 2, clientReleaseId: null }, diag: { attempt_id: ATT2, client_attempt: 2 } }),
        ];
        expect(contractOutcome(ex[0])).toBeNull();
        expect(terminalRequests(ex, () => null)).toHaveLength(1);
        expect(expectation(ex)).toMatchObject({ attemptId: ATT2, outcome: 'success' });
        expect(validateFeedbackDiagnostics(lookup(ex), expectation(ex)).verdict).toBe('PASS');
    });

    it.each([
        ['provider_http_5xx', 'provider_error'], ['provider_http_4xx', 'provider_error'], ['provider_timeout', 'timeout'],
        ['provider_transport', 'transport_error'], ['missing_text', 'invalid_response'], ['over_character_ceiling', 'invalid_response'],
        ['quota_exceeded', 'rate_limited'], ['auth_failed', 'server_error'], ['persist_failed', 'server_error'],
    ])('failure reason %s maps to contract outcome %s', (reason, outcome) => {
        expect(contractOutcome(exchange({ status: 502, diag: { outcome: 'failure', reason, status: 502 } }))).toBe(outcome);
    });

    it('a request the browser never got an answer for is client_network, timed by the client, with no server reason', () => {
        const ex = exchange({ status: null, diagnostics: null, clientMs: 30_000 });
        expect(toAiRequestDiagnostic(ex, 'network')).toMatchObject({ outcome: 'client_network', serverReason: null, statusClass: 'none', totalMs: 30_000, requestId: REQ, attemptId: ATT1 });
    });

    it('an unmappable terminal shape is reported, so the contract FAILs it instead of the adapter dropping it', () => {
        const ex = [exchange({ status: 502, diag: { outcome: 'failure', reason: 'focus_results_pending', status: 502 } })];
        expect(contractOutcome(ex[0])).toBe('unmappable');
        const verdict = validateFeedbackDiagnostics(lookup(ex), { ...expectation([exchange()]), outcome: 'server_error' });
        expect(verdict.verdict).toBe('FAIL');
    });

    it('the request → session binding is the session the page SENT, never tap order', () => {
        const ex = [exchange(), exchange({ sent: { sessionId: OLD, product: 'open_mic', requestId: '66666666-6666-4666-8666-666666666666', attemptId: ATT2, clientAttempt: 1, clientReleaseId: null }, diag: { request_id: '66666666-6666-4666-8666-666666666666', attempt_id: ATT2 } })];
        expect(expectation(ex)).toMatchObject({ requestId: REQ, sessionId: SES });
        expect(validateFeedbackDiagnostics(lookup(ex), expectation(ex)).verdict).toBe('PASS');
    });

    it('no request sent for the current take gives no expectation (the caller HOLDs; it never guesses)', () => {
        expect(currentTakeExpectation({ reportId: 'rep-1', currentSessionId: SES, exchanges: [], configuredModel: MODEL })).toBeNull();
    });

    it('a report linking no request is HOLD; a report about another session carrying the current request FAILs', () => {
        const ex = [exchange()];
        expect(validateFeedbackDiagnostics(lookup(ex, true, report(SES, null)), expectation(ex))).toEqual({ verdict: 'HOLD', reasons: ['request_link_missing'] });
        expect(validateFeedbackDiagnostics(lookup(ex, true, report(OLD, REQ)), expectation(ex)).verdict).toBe('FAIL');
    });

    it('association is derived from the stored report\'s session', () => {
        expect(reportAssociation(null, SES)).toBe('no_session');
        expect(reportAssociation(SES, SES)).toBe('current_take');
        expect(reportAssociation(OLD, SES)).toBe('selected_older_session');
    });

    it('the tap reads only the request ids and a well-formed suggestion pair', () => {
        expect(readSentRequest({ postDataJSON: () => ({ sessionId: SES, product: 'open_mic', diagnostic_request_id: REQ, diagnostic_attempt_id: ATT1, client_attempt: 1, client_release_id: 'b'.repeat(40), transcript: 'never kept' }) }))
            .toEqual({ sessionId: SES, product: 'open_mic', requestId: REQ, attemptId: ATT1, clientAttempt: 1, clientReleaseId: 'b'.repeat(40) });
        expect(readSentRequest({ postDataJSON: () => { throw new Error('no body'); } })).toEqual({ sessionId: null, product: null, requestId: null, attemptId: null, clientAttempt: null, clientReleaseId: null });
        expect(readSuggestionPair({ suggestions: { version: 'gemini_coaching_v1', what_worked: 'a', what_to_try_next: 'b' } })).toEqual({ version: 'gemini_coaching_v1', what_worked: 'a', what_to_try_next: 'b' });
        expect(readSuggestionPair({ suggestions: { version: 'v0', what_worked: 'a', what_to_try_next: 'b' } })).toBeNull();
    });

    it('the live row reads the stored report by id for the run-owned account and HOLDs only on received telemetry', async () => {
        const rows: Array<{ step: string; verdict: string; detail: string; evidence?: Record<string, unknown> }> = [{ step: 'feedback', verdict: 'PASS', detail: '' }];
        const receipt = { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>) => { rows.push({ step, verdict, detail, evidence }); } };
        const reads: string[] = [];
        const admin = { from: (t: string) => ({ select: (c: string) => ({ eq: (k1: string, v1: string) => ({ eq: (k2: string, v2: string) => {
            reads.push(`${t}:${c}:${k1}=${v1}:${k2}=${v2}`);
            return Promise.resolve({ data: [{ id: 'rep-1', session_id: SES, metadata: { coaching_diagnostic_ref: REQ } }], error: null });
        } }) }) }) };
        await feedbackDiagnosticChainRow({ receipt, admin, userId: 'uid-1', reportId: 'rep-1', currentSessionId: SES, exchanges: [exchange()], configuredModel: MODEL, product: 'open_mic' });
        expect(reads).toEqual(['user_issue_reports:id, session_id, metadata:id=rep-1:user_id=uid-1']);
        const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
        expect(rows[rows.length - 1]).toMatchObject({ step: 'feedback diagnostic chain', verdict: 'HOLD', evidence: {
            reasons: 'telemetry_not_received', expectedRequestSha256: sha(REQ), expectedAttemptSha256: sha(ATT1),
            expectedProduct: 'open_mic', expectedConfiguredModel: MODEL, expectedOutcome: 'success',
        } });
        // Digests only: neither the session nor the raw request/attempt ids reach the receipt.
        for (const raw of [SES, REQ, ATT1]) expect(JSON.stringify(rows[rows.length - 1])).not.toContain(raw);
    });

    it('Codex P1 r4247280690: an explicitly observed acknowledgement counts without a core `feedback` row', async () => {
        const rows: Array<{ step: string; verdict: string; detail: string; evidence?: Record<string, unknown> }> = [];
        const receipt = { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>) => { rows.push({ step, verdict, detail, evidence }); } };
        const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ id: 'rep-1', session_id: SES, metadata: { coaching_diagnostic_ref: REQ } }], error: null }) }) }) }) };
        await feedbackDiagnosticChainRow({ receipt, admin, userId: 'uid-1', reportId: 'rep-1', currentSessionId: SES, exchanges: [exchange()], configuredModel: MODEL, product: 'open_mic', acknowledgementVisible: true });
        expect(rows[rows.length - 1]).toMatchObject({ verdict: 'HOLD', evidence: { reasons: 'telemetry_not_received', expectedRequestSha256: expect.any(String) } });
        // Explicitly NOT observed is a contradiction (FAIL) and carries no settlement binding.
        await feedbackDiagnosticChainRow({ receipt, admin, userId: 'uid-1', reportId: 'rep-1', currentSessionId: SES, exchanges: [exchange()], configuredModel: MODEL, product: 'open_mic', acknowledgementVisible: false });
        expect(rows[rows.length - 1]).toMatchObject({ verdict: 'FAIL' });
        expect(rows[rows.length - 1].evidence?.expectedRequestSha256).toBeUndefined();
    });

    it('no stored report is HOLD report_not_found without a database read', async () => {
        const rows: Array<{ step: string; verdict: string; evidence?: unknown }> = [];
        const receipt = { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', _d: string, evidence?: Record<string, string | number | boolean | null>) => { rows.push({ step, verdict, evidence }); } };
        const admin = { from: () => { throw new Error('must not read'); } };
        await feedbackDiagnosticChainRow({ receipt, admin: admin as never, userId: 'uid-1', reportId: null, currentSessionId: SES, exchanges: [], configuredModel: MODEL, product: 'open_mic' });
        expect(rows).toEqual([{ step: 'feedback diagnostic chain', verdict: 'HOLD', evidence: { reasons: 'report_not_found' } }]);
    });

    // ── PM RETURN 6115025110: identity is the SENT boundary; a response echo can never establish it ──────────────
    const WRONG_REQ = '77777777-7777-4777-8777-777777777777';
    const WRONG_ATT = '88888888-8888-4888-8888-888888888888';

    it('CASUALTY: mutually consistent WRONG echoes (B/b) with the report linked to B can never PASS', () => {
        const ex = [exchange({ diag: { request_id: WRONG_REQ, attempt_id: WRONG_ATT } })];
        const exp = expectation(ex);
        expect(exp).toMatchObject({ requestId: REQ, attemptId: ATT1, currentRequestId: REQ });
        const v = validateFeedbackDiagnostics(lookup(ex, true, report(SES, WRONG_REQ)), exp);
        expect(v.verdict).toBe('FAIL');
        expect(v.reasons).toContain('request_mismatch');
    });

    it.each([
        ['a changed response request id', { request_id: WRONG_REQ }, 'request'],
        ['a changed response attempt id', { attempt_id: WRONG_ATT }, 'attempt'],
    ])('CASUALTY: %s poisons the request — FAIL even when the report links the sent id', (_label, diag, kind) => {
        const ex = [exchange({ diag })];
        expect(echoMismatch(ex[0])).toBe(kind);
        const records = terminalRequests(ex, () => null);
        expect(records).toEqual([expect.objectContaining({ requestId: REQ, attemptId: ATT1, outcome: 'unmapped:echo_mismatch' })]);
        const v = validateFeedbackDiagnostics(lookup(ex), expectation(ex));
        expect(v.verdict).toBe('FAIL');
        expect(v.reasons).toContain('request_field_invalid');
    });

    it('CASUALTY: an inconsistent echo on an intermediate retry is not dropped — the request still FAILs', () => {
        const ex = [
            exchange({ status: 425, diag: { outcome: 'retrying', reason: 'focus_results_pending', status: 425, attempt_id: WRONG_ATT } }),
            exchange({ sent: { sessionId: SES, product: 'open_mic', requestId: REQ, attemptId: ATT2, clientAttempt: 2, clientReleaseId: null }, diag: { attempt_id: ATT2, client_attempt: 2 } }),
        ];
        expect(terminalRequests(ex, () => null)).toEqual([expect.objectContaining({ attemptId: ATT2, outcome: 'unmapped:echo_mismatch' })]);
        expect(validateFeedbackDiagnostics(lookup(ex), expectation(ex)).verdict).toBe('FAIL');
    });

    it('an exchange the page sent without a request id keeps its own record (never merged, never dropped)', () => {
        const unsent = exchange({ sent: { sessionId: SES, product: 'open_mic', requestId: null, attemptId: null, clientAttempt: 1, clientReleaseId: null } });
        const records = terminalRequests([exchange(), unsent], () => null);
        expect(records).toHaveLength(2);
        expect(records[1]).toMatchObject({ requestId: '', outcome: 'unmapped:echo_mismatch' });
    });

    it('CONTROL: consistent echoes keep PASS for fresh, cache and retry chains', () => {
        const fresh = [exchange()];
        const cache = [exchange({ diag: { source: 'cache', provider_status: null, provider_attempts: 0, provider_duration_ms: 0 } })];
        expect(validateFeedbackDiagnostics(lookup(fresh), expectation(fresh)).verdict).toBe('PASS');
        expect(validateFeedbackDiagnostics(lookup(cache), expectation(cache)).verdict).toBe('PASS');
        expect(echoMismatch(fresh[0])).toBeNull();
        expect(echoMismatch(exchange({ status: null, diagnostics: null }))).toBeNull();
    });
});
