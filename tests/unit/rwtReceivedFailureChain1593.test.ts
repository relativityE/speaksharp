// @vitest-environment node
/** Case 7: actual sent-boundary adapter → received evidence → unchanged receipt finalizer. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    evaluateCoachingDiagnosticReceipt, validExpectation, type ReceivedCoachingRow,
} from '../../frontend/src/services/telemetry/coachingDiagnosticReceipt';
import { feedbackDiagnosticChainRow, type ObservedEvent } from '../live/helpers/coachingFeedbackAdapter';
import type { CoachingExchange } from '../live/helpers/coachingGenerationTap';
import { finalizeReceipt, humanWorksheet, parseHumanWorksheet, requiredAutomatedRows, type ReceiptRow } from '../live/helpers/rwtAcceptance';

const RELEASE = 'b'.repeat(40);
const MODEL = 'gemini-3.6-flash';
const SESSION = '11111111-1111-4111-8111-111111111111';
const OLD_SESSION = '22222222-2222-4222-8222-222222222222';
const REQUEST = '33333333-3333-4333-8333-333333333333';
const ATTEMPT = '44444444-4444-4444-8444-444444444444';
const OTHER_REQUEST = '77777777-7777-4777-8777-777777777777';
const OTHER_ATTEMPT = '88888888-8888-4888-8888-888888888888';
const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const SUITE = 'open-mic-first-session';
const JOURNEY = 'case7-journey';
const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];

const failure = (reason = 'provider_http_4xx', providerStatus: number | null = 429): CoachingExchange => ({
    sent: { sessionId: SESSION, product: 'open_mic', requestId: REQUEST, attemptId: ATTEMPT, clientAttempt: 1, clientReleaseId: RELEASE },
    status: 502, diagnostics: {
        schema_version: 'coaching_diagnostic_v1', request_id: REQUEST, attempt_id: ATTEMPT, outcome: 'failure', reason,
        status: 502, provider_status: providerStatus, configured_model: MODEL, observed_model: null, source: 'fresh',
        provider_attempts: 1, retry_count: 0, provider_duration_ms: 640, total_duration_ms: 920,
    }, suggestions: null, clientMs: 1000, at: 1,
});
const pageFailure = (requestId = REQUEST): ObservedEvent[] => [
    { event: 'ai_coaching_diagnostic', at: 1, bootId: 'boot', batch: 1, batchIndex: 0, diagnosticRequestId: requestId, diagnosticOutcome: 'failure' },
    { event: 'practice_loop_review_failed', at: 2, bootId: 'boot', batch: 1, batchIndex: 1, reason: 'unavailable' },
];

async function chain(options: {
    exchange?: CoachingExchange; exchanges?: CoachingExchange[]; events?: ObservedEvent[];
    reportedSessionId?: string; storedRequestId?: string;
} = {}): Promise<ReceiptRow> {
    const rows: ReceiptRow[] = [];
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({
        data: [{ id: 'report', session_id: options.reportedSessionId ?? SESSION, metadata: { coaching_diagnostic_ref: options.storedRequestId ?? REQUEST } }], error: null,
    }) }) }) }) };
    await feedbackDiagnosticChainRow({
        receipt: { rows, row: (step, verdict, detail, evidence) => { rows.push({ step, verdict, detail, evidence }); } },
        admin, userId: 'run-owned-user', reportId: 'report', currentSessionId: SESSION,
        reportedSessionId: options.reportedSessionId, acknowledgementVisible: true,
        exchanges: options.exchanges ?? [options.exchange ?? failure()], observedEvents: options.events ?? pageFailure(),
        configuredModel: MODEL, product: 'open_mic',
    });
    return rows[0];
}

// Exactly the existing five-field workflow extraction; no new workflow/caller plumbing.
function binding(row: ReceiptRow): unknown {
    const e = row.evidence;
    return { requestSha256: e?.expectedRequestSha256, attemptSha256: e?.expectedAttemptSha256,
        product: e?.expectedProduct, configuredModel: e?.expectedConfiguredModel, outcome: e?.expectedOutcome };
}
const receivedFailure = (over: Partial<ReceivedCoachingRow> = {}): ReceivedCoachingRow => ({
    event: 'ai_coaching_diagnostic', requestId: REQUEST, attemptId: ATTEMPT, outcome: 'failure', product: 'open_mic',
    configuredModel: MODEL, observedModel: null, status: 502, providerStatus: 429, source: 'fresh', providerAttempts: 1,
    clientReleaseId: RELEASE, coachingDiagnosticId: null, ...over,
});
const receivedFeedback = (over: Partial<ReceivedCoachingRow> = {}): ReceivedCoachingRow => ({
    ...receivedFailure(), event: 'feedback_submit', outcome: 'storage_ok', coachingDiagnosticId: REQUEST, ...over,
});
const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'control' });
function finalize(chainRow: ReceiptRow, received?: ReturnType<typeof evaluateCoachingDiagnosticReceipt>, productVerdict: 'PASS' | 'FAIL' | 'EXTERNAL' = 'PASS') {
    const rows: ReceiptRow[] = [
        ...['telemetry decodable', 'signup-stage telemetry (user class)', 'receipt content-free', 'journey telemetry (canary class)'].map(pass),
        ...['signup-stage telemetry received', 'journey telemetry received'].map((step): ReceiptRow => ({ step, verdict: 'HOLD', detail: 'readback pending' })),
        ...requiredAutomatedRows(SUITE)!.product.filter((step) => step !== 'feedback diagnostic chain').map((step): ReceiptRow => (
            step === 'coaching rendered' ? { step, verdict: productVerdict, detail: 'original coaching outcome' }
                : step === 'base_q4 primary' ? { step, verdict: 'HOLD', detail: 'readback pending' } : pass(step)
        )), chainRow,
        ...['open_mic_coaching_relevant', 'open_mic_uh_detected'].map((id): ReceiptRow => ({
            step: `human: ${id}`, verdict: 'HUMAN', detail: 'control only',
            evidence: { observationId: id, runbookRow: 'row', passCriterion: 'control', recorded: 'pending' },
        })),
    ];
    if (productVerdict === 'EXTERNAL') {
        const parent = rows.find((r) => r.step === 'coaching rendered')!;
        parent.evidence = { httpStatus: 502, externalOutcome: 'provider_timeout', failureReason: 'provider_timeout',
            takeExchangeUnique: true, savedTakeProven: true, reviewState: 'error', unavailableShown: true, retryEnabled: true };
        Object.assign(rows.find((r) => r.step === 'coaching visible = saved')!, { verdict: 'EXTERNAL',
            evidence: { savedCoachingAbsent: true, visibleCoachingAbsent: true } });
    }
    const receipt = { suite: SUITE, release: RELEASE, meta: { fixtureKind: 'synthetic' }, rows,
        readback: { journeys: [{ journeyId: JOURNEY, stages: STAGES }], reportedJourneyIds: ['other'], missingBindings: [] } };
    const worksheet = parseHumanWorksheet(humanWorksheet(SUITE, RELEASE, [JOURNEY, 'other'], rows).split('\n')
        .map((line) => line.startsWith('| `open_mic_')
            ? line.replace(/\| [^|]* \| {2}\|$/, productVerdict === 'EXTERNAL' && line.startsWith('| `open_mic_coaching_relevant`')
                ? '| NOT_EXERCISED | Offline control |' : '| PASS | Offline control |') : line).join('\n'));
    const result = finalizeReceipt(receipt, worksheet, { suite: SUITE, release: RELEASE,
        journeys: [{ journeyId: JOURNEY, stages: STAGES, verdict: 'QUALIFIED' }], missingBindings: [],
        // The workflow writes only the closed result, not the validator's diagnostic counters/identity appendix.
        ...(received === undefined ? {} : { coachingDiagnostic: {
            verdict: received.verdict, reasons: received.reasons, release: received.release, expected: received.expected,
        } }),
    });
    return { ...result, chain: result.rows.find((r) => r.step === 'feedback diagnostic chain') };
}

describe('#1593 case7 answered-failure chain, adapter through finalization', () => {
    it.each([
        ['provider 429 behind Edge 502', 'provider_http_4xx', 429],
        ['provider 503 behind Edge 502', 'provider_http_5xx', 503],
        ['timeout before headers', 'provider_timeout', null],
        ['body timeout after provider 200', 'provider_timeout', 200],
        ['provider transport loss', 'provider_transport', null],
        ['malformed provider 200 body', 'provider_malformed_response', 200],
        ['persistence failure after provider 200', 'persist_failed', 200],
    ] as const)('%s binds raw terminal failure and settles assurance only', async (_label, reason, providerStatus) => {
        const row = await chain({ exchange: failure(reason, providerStatus) });
        expect(row).toMatchObject({ verdict: 'HOLD', evidence: { reasons: 'telemetry_not_received', expectedOutcome: 'failure' } });
        const expected = binding(row);
        expect(validExpectation(expected)).toBe(true);
        if (!validExpectation(expected)) throw new Error('adapter did not emit a valid received binding');
        const result = evaluateCoachingDiagnosticReceipt([receivedFailure({ providerStatus }), receivedFeedback()], expected, RELEASE, sha);
        expect(result).toMatchObject({ verdict: 'PASS', reasons: [] });
        expect(finalize(row, result)).toMatchObject({ status: 'final', finalAcceptance: 'PASS', chain: { verdict: 'PASS' } });
        const failedCoaching = finalize(row, result, 'FAIL');
        expect(failedCoaching).toMatchObject({ status: 'final', finalAcceptance: 'FAIL', chain: { verdict: 'PASS' } });
        expect(failedCoaching.rows.find((r) => r.step === 'coaching rendered')?.verdict).toBe('FAIL');
        for (const raw of [SESSION, REQUEST, ATTEMPT]) expect(JSON.stringify(row)).not.toContain(raw);
    });

    it('generic journey qualification cannot promote an answered-failure chain', async () => {
        expect(finalize(await chain())).toMatchObject({ finalAcceptance: 'INCOMPLETE', chain: { verdict: 'HOLD' } });
    });

    it('the supported upper boundary of three provider attempts still qualifies', async () => {
        const exchange = failure();
        Object.assign(exchange.diagnostics!, { provider_attempts: 3, retry_count: 2 });
        const row = await chain({ exchange });
        const expected = binding(row);
        if (!validExpectation(expected)) throw new Error('adapter did not emit a valid received binding');
        const result = evaluateCoachingDiagnosticReceipt([receivedFailure({ providerAttempts: 3 }), receivedFeedback()], expected, RELEASE, sha);
        expect(result.verdict).toBe('PASS');
        expect(finalize(row, result).chain?.verdict).toBe('PASS');
    });

    it('received failure-chain PASS leaves a proved provider outage EXTERNAL and acceptance INCOMPLETE', async () => {
        const row = await chain({ exchange: failure('provider_timeout', null) });
        const expected = binding(row);
        if (!validExpectation(expected)) throw new Error('adapter did not emit a valid received binding');
        const result = evaluateCoachingDiagnosticReceipt([receivedFailure({ providerStatus: null }), receivedFeedback()], expected, RELEASE, sha);
        const out = finalize(row, result, 'EXTERNAL');
        expect(out).toMatchObject({ status: 'final', finalAcceptance: 'INCOMPLETE', successfulCoachingOutstanding: true,
            chain: { verdict: 'PASS' } });
        expect(out.rows.find((r) => r.step === 'coaching rendered')?.verdict).toBe('EXTERNAL');
    });

    it.each([
        ['missing received diagnostic', [receivedFeedback()], 'HOLD', 'diagnostic_not_received'],
        ['another request', [receivedFailure({ requestId: OTHER_REQUEST }), receivedFeedback()], 'HOLD', 'diagnostic_not_received'],
        ['missing received feedback', [receivedFailure()], 'HOLD', 'feedback_not_received'],
        ['wrong attempt', [receivedFailure({ attemptId: OTHER_ATTEMPT }), receivedFeedback()], 'FAIL', 'attempt_mismatch'],
        ['wrong product', [receivedFailure({ product: 'focus_points' }), receivedFeedback()], 'FAIL', 'product_mismatch'],
        ['wrong model', [receivedFailure({ configuredModel: 'other-model' }), receivedFeedback()], 'FAIL', 'configured_model_mismatch'],
        ['wrong release', [receivedFailure({ clientReleaseId: 'c'.repeat(40) }), receivedFeedback()], 'FAIL', 'release_mismatch'],
        ['missing release', [receivedFailure({ clientReleaseId: null }), receivedFeedback()], 'FAIL', 'release_mismatch'],
        ['success substituted for failure', [receivedFailure({ outcome: 'success' }), receivedFeedback()], 'FAIL', 'outcome_mismatch'],
        ['duplicate terminal', [receivedFailure(), receivedFailure(), receivedFeedback()], 'FAIL', 'duplicate_terminal_diagnostic'],
        ['feedback borrowed another request', [receivedFailure(), receivedFeedback({ coachingDiagnosticId: OTHER_REQUEST })], 'FAIL', 'report_link_mismatch'],
        ['feedback missing link', [receivedFailure(), receivedFeedback({ coachingDiagnosticId: null })], 'FAIL', 'report_link_missing'],
        ['successful endpoint on failure', [receivedFailure({ status: 200 }), receivedFeedback()], 'FAIL', 'status_incoherent'],
        ['malformed endpoint', [receivedFailure({ status: '502' }), receivedFeedback()], 'FAIL', 'status_incoherent'],
        ['malformed provider status', [receivedFailure({ providerStatus: '429' }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['impossible provider redirect', [receivedFailure({ providerStatus: 302 }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['provider called without attempt', [receivedFailure({ providerAttempts: 0 }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['missing provider attempts', [receivedFailure({ providerAttempts: null }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['negative provider attempts', [receivedFailure({ providerAttempts: -1 }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['fractional provider attempts', [receivedFailure({ providerAttempts: 1.5 }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['string provider attempts', [receivedFailure({ providerAttempts: '1' }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['provider attempts above the producer maximum', [receivedFailure({ providerAttempts: 4 }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['large impossible provider attempts', [receivedFailure({ providerAttempts: Number.MAX_SAFE_INTEGER }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['provider call with unknown source', [receivedFailure({ source: 'unknown' }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
        ['failure claims cache', [receivedFailure({ source: 'cache' }), receivedFeedback()], 'FAIL', 'provenance_incoherent'],
    ] as const)('%s cannot falsely settle PASS', async (_label, rows, verdict, reason) => {
        const row = await chain();
        const expected = binding(row);
        expect(validExpectation(expected)).toBe(true);
        if (!validExpectation(expected)) throw new Error('adapter did not emit a valid received binding');
        const result = evaluateCoachingDiagnosticReceipt(rows, expected, RELEASE, sha);
        expect(result.verdict).toBe(verdict);
        expect(result.reasons).toContain(reason);
        const out = finalize(row, result);
        expect(out.chain?.verdict).toBe(verdict);
        expect(out.finalAcceptance).not.toBe('PASS');
    });

    it('a pre-provider refusal binds without inventing provider provenance', async () => {
        const exchange = failure('quota_exceeded', null);
        exchange.status = 429;
        Object.assign(exchange.diagnostics!, { status: 429, source: 'unknown', provider_attempts: 0, provider_duration_ms: null });
        const row = await chain({ exchange });
        const expected = binding(row);
        expect(validExpectation(expected)).toBe(true);
        if (!validExpectation(expected)) throw new Error('adapter did not emit a valid received binding');
        expect(evaluateCoachingDiagnosticReceipt([
            receivedFailure({ status: 429, providerStatus: null, source: 'unknown', providerAttempts: 0 }), receivedFeedback(),
        ], expected, RELEASE, sha).verdict).toBe('PASS');
    });

    it.each([
        ['no captured page failure', []],
        ['page failure belongs to another request', pageFailure(OTHER_REQUEST)],
        ['duplicate page failure', [...pageFailure(), ...pageFailure().map((e) => ({ ...e, batchIndex: e.batchIndex! + 2 }))]],
    ])('%s has no settlement binding', async (_label, events) => {
        const row = await chain({ events });
        expect(row.verdict).toBe('HOLD');
        expect(validExpectation(binding(row))).toBe(false);
        expect(finalize(row).chain?.verdict).toBe('HOLD');
    });

    it('unanswered client-network failure cannot invent a configured model', async () => {
        const row = await chain({ exchange: { ...failure(), status: null, diagnostics: null } });
        expect(row.verdict).not.toBe('PASS');
        expect(validExpectation(binding(row))).toBe(false);
    });

    it('a stored report for an older take cannot borrow the current failure', async () => {
        const older = failure();
        older.sent = { ...older.sent, sessionId: OLD_SESSION, requestId: OTHER_REQUEST, attemptId: OTHER_ATTEMPT };
        older.diagnostics = { ...older.diagnostics, request_id: OTHER_REQUEST, attempt_id: OTHER_ATTEMPT };
        const row = await chain({ reportedSessionId: OLD_SESSION, exchanges: [older, failure()],
            events: pageFailure(OTHER_REQUEST), storedRequestId: REQUEST });
        expect(row.verdict).toBe('FAIL');
        expect(validExpectation(binding(row))).toBe(false);
    });
});
