// @vitest-environment node
/** Independent synthetic reproduction of the run-set2 case-7 receipt boundary; no product edits or live requests. */
import { describe, expect, it } from 'vitest';
import { feedbackDiagnosticChainRow, type ObservedEvent } from '../live/helpers/coachingFeedbackAdapter';
import type { CoachingExchange } from '../live/helpers/coachingGenerationTap';
import { validExpectation } from '../../frontend/src/services/telemetry/coachingDiagnosticReceipt';

const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const NEW_REQUEST = '44444444-4444-4444-8444-444444444444';
const ATTEMPT = '55555555-5555-4555-8555-555555555555';
const MODEL = 'gemini-3.6-flash';
const exchange = (sessionId: string, requestId: string, quota: boolean): CoachingExchange => ({
    sent: { sessionId, requestId, attemptId: ATTEMPT, product: 'open_mic', clientAttempt: 1, clientReleaseId: null },
    status: quota ? 502 : 200, suggestions: null, clientMs: 900, at: 1,
    diagnostics: { schema_version: 'coaching_diagnostic_v1', request_id: requestId, attempt_id: ATTEMPT, client_attempt: 1,
        phase: 'complete', outcome: quota ? 'failure' : 'success', reason: quota ? 'provider_http_4xx' : 'none',
        status: quota ? 502 : 200, provider_status: quota ? 429 : 200, provider: 'google_gemini',
        configured_model: MODEL, observed_model: quota ? null : `${MODEL}-001`, source: 'fresh', provider_attempts: 1,
        retry_count: 0, provider_duration_ms: 640, total_duration_ms: 920, prompt_sha256: 'a'.repeat(64), product: 'open_mic', has_session: true },
});
async function chain(quota: boolean, ref = REQUEST) {
    const rows: Array<{ step: string; verdict: string; evidence?: Record<string, string | number | boolean | null> }> = [];
    const receipt = { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', _detail: string, evidence?: Record<string, string | number | boolean | null>) => { rows.push({ step, verdict, evidence }); } };
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ id: 'synthetic-report', session_id: OLD, metadata: { coaching_diagnostic_ref: ref } }], error: null }) }) }) }) };
    const observedEvents: ObservedEvent[] = quota ? [
        { event: 'ai_coaching_diagnostic', at: 1, bootId: 'synthetic', batch: 1, batchIndex: 0, diagnosticRequestId: REQUEST, diagnosticOutcome: 'failure' },
        { event: 'practice_loop_review_failed', at: 2, bootId: 'synthetic', batch: 1, batchIndex: 1, reason: 'unavailable' },
        { event: 'ai_coaching_diagnostic', at: 3, bootId: 'synthetic', batch: 1, batchIndex: 2, diagnosticRequestId: NEW_REQUEST, diagnosticOutcome: 'failure' },
        { event: 'practice_loop_review_failed', at: 4, bootId: 'synthetic', batch: 1, batchIndex: 3, reason: 'unavailable' },
    ] : [];
    await feedbackDiagnosticChainRow({ receipt, admin, userId: 'synthetic-user', reportId: 'synthetic-report',
        currentSessionId: NEW, reportedSessionId: OLD, acknowledgementVisible: true,
        exchanges: [exchange(OLD, REQUEST, quota), exchange(NEW, NEW_REQUEST, quota)], observedEvents, configuredModel: MODEL, product: 'open_mic' });
    return rows[0];
}
describe('case7 received diagnostic assurance', () => {
    it('provider-429/Edge-502 failure resolves its stored older-take link but emits no received settlement binding', async () => {
        const row = await chain(true);
        expect(row).toMatchObject({ verdict: 'HOLD', evidence: { reasons: 'telemetry_not_received', echoMismatches: 0 } });
        expect(row.evidence?.expectedRequestSha256).toBeUndefined();
        expect(validExpectation({ requestSha256: 'a'.repeat(64), attemptSha256: 'b'.repeat(64), product: 'open_mic', configuredModel: MODEL, outcome: 'provider_error' })).toBe(false);
    });
    it('success control emits a sent-boundary digest for the independent received gate', async () => {
        expect(await chain(false)).toMatchObject({ verdict: 'HOLD', evidence: { reasons: 'telemetry_not_received', expectedRequestSha256: expect.stringMatching(/^[0-9a-f]{64}$/), expectedOutcome: 'success' } });
    });
    it('negative control: borrowing the newer request for an older report fails rather than becoming settleable', async () => {
        const row = await chain(true, NEW_REQUEST);
        expect(row.verdict).toBe('FAIL');
        expect(row.evidence?.expectedRequestSha256).toBeUndefined();
    });
});
