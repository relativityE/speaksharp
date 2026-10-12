// @vitest-environment node
/**
 * #1594 (PM 6120326867): the three supplemental RWT boundary suites are first-class in acceptance and finalization.
 * A complete receipt finalizes PASS; a missing required/product row, a row the scenario has no basis for, an unbound
 * received result or an unknown suite never does; the four core suites are unchanged. The older-take chain resolves to
 * the SELECTED older take's own sent request and refuses the newer take's; the request budget is whole-scenario.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    FEEDBACK_NO_SESSION_SUITE, FEEDBACK_OLDER_TAKE_SUITE, PENDING_START_SUITE, finalizeReceipt, humanWorksheet,
    parseHumanWorksheet, requiredAutomatedRows, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';
import { buildFeedbackLookup, takeExpectation } from '../live/helpers/coachingFeedbackAdapter';
import type { CoachingExchange } from '../live/helpers/coachingGenerationTap';
import { coachingRequestBudgetRow } from '../live/helpers/rwtCoachingCollector';
import { validateFeedbackDiagnostics } from '../live/helpers/feedbackDiagnosticContract';

const SHA = 'b'.repeat(40);
const J = 'journey-feedback';
const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'ok' });
const hold = (step: string): ReceiptRow => ({ step, verdict: 'HOLD', detail: 'pending' });
const MODEL = 'gemini-3.8-flash';
const OLD = '11111111-1111-4111-8111-111111111111';
const NEW = '22222222-2222-4222-8222-222222222222';
const OLD_REQ = '33333333-3333-4333-8333-333333333333';
const NEW_REQ = '44444444-4444-4444-8444-444444444444';
const OLD_ATT = '55555555-5555-4555-8555-555555555555';
const NEW_ATT = '66666666-6666-4666-8666-666666666666';
const binding = { expectedRequestSha256: sha(OLD_REQ), expectedAttemptSha256: sha(OLD_ATT), expectedProduct: 'open_mic', expectedConfiguredModel: MODEL, expectedOutcome: 'success' };
const expectation = { requestSha256: sha(OLD_REQ), attemptSha256: sha(OLD_ATT), product: 'open_mic', configuredModel: MODEL, outcome: 'success' };

/** A complete receipt for a supplemental suite, built from the code-owned inventory (the chain row as the suite writes it). */
function canonical(suite: string): { suite: string; release: string; meta: Record<string, unknown>; rows: ReceiptRow[]; readback: unknown } {
    const inv = requiredAutomatedRows(suite)!;
    const rows: ReceiptRow[] = [
        ...inv.required.map((s) => (s === 'signup-stage telemetry received' || s === 'journey telemetry received' ? hold(s) : pass(s))),
        ...inv.product.map((s): ReceiptRow => (s === 'feedback diagnostic chain'
            ? { step: s, verdict: 'HOLD', detail: 'the chain is incomplete', evidence: { reasons: 'telemetry_not_received', echoMismatches: 0, ...binding } }
            : pass(s))),
    ];
    const feedback = suite !== PENDING_START_SUITE;
    return { suite, release: SHA, meta: { fixtureKind: 'synthetic' }, rows,
        readback: { journeys: feedback ? [{ journeyId: J, stages: ['share_feedback'] }] : [], reportedJourneyIds: [], missingBindings: [] } };
}
const worksheet = (r: { suite: string; rows: ReceiptRow[]; readback: unknown }) =>
    parseHumanWorksheet(humanWorksheet(r.suite, SHA, (r.readback as { journeys: { journeyId: string }[] }).journeys.map((j) => j.journeyId), r.rows));
const readback = (suite: string, coachingDiagnostic?: unknown) => (suite === PENDING_START_SUITE ? undefined : {
    suite, release: SHA, journeys: [{ journeyId: J, stages: ['share_feedback'], verdict: 'QUALIFIED' }], missingBindings: [],
    ...(coachingDiagnostic === undefined ? {} : { coachingDiagnostic }),
});
const boundPass = { verdict: 'PASS', reasons: [], release: SHA, expected: expectation };
const finalize = (r: ReturnType<typeof canonical>, coaching?: unknown) =>
    finalizeReceipt(r, worksheet(r), readback(r.suite, r.suite === FEEDBACK_OLDER_TAKE_SUITE && coaching === undefined ? boundPass : coaching));

const SUPPLEMENTAL = [FEEDBACK_OLDER_TAKE_SUITE, FEEDBACK_NO_SESSION_SUITE, PENDING_START_SUITE];

describe('#1594 supplemental suites in acceptance and finalization', () => {
    for (const suite of SUPPLEMENTAL) {
        it(`${suite}: the complete receipt finalizes PASS`, () => {
            expect(finalize(canonical(suite))).toMatchObject({ status: 'final', finalAcceptance: 'PASS', errors: [] });
        });
        it(`${suite}: removing EACH required or product row → binding error, never PASS`, () => {
            const r = canonical(suite);
            for (const step of [...requiredAutomatedRows(suite)!.required, ...requiredAutomatedRows(suite)!.product]) {
                const out = finalize({ ...r, rows: r.rows.filter((row) => row.step !== step) });
                expect({ step, status: out.status, pass: out.finalAcceptance === 'PASS' }).toEqual({ step, status: 'binding_error', pass: false });
            }
        });
    }

    it('older take: the chain settles only from a received result bound to the OLDER take\'s sent request', () => {
        const r = canonical(FEEDBACK_OLDER_TAKE_SUITE);
        expect(finalizeReceipt(r, worksheet(r), readback(r.suite))).toMatchObject({ finalAcceptance: 'INCOMPLETE' });
        const newer = finalize(r, { ...boundPass, expected: { ...expectation, requestSha256: sha(NEW_REQ), attemptSha256: sha(NEW_ATT) } });
        expect(newer.status).toBe('binding_error');
        expect(newer.finalAcceptance).not.toBe('PASS');
        expect(finalize(r, { verdict: 'FAIL', reasons: ['report_link_mismatch'], release: SHA, expected: expectation })).toMatchObject({ finalAcceptance: 'FAIL' });
    });

    it('no session and pending Start never carry a coaching chain or prompt-binding row (no coaching result exists)', () => {
        for (const suite of [FEEDBACK_NO_SESSION_SUITE, PENDING_START_SUITE]) {
            for (const step of ['feedback diagnostic chain', 'coaching prompt binding']) {
                const r = canonical(suite);
                const out = finalize({ ...r, rows: [...r.rows, hold(step)] });
                expect({ suite, step, status: out.status }).toEqual({ suite, step, status: 'binding_error' });
            }
        }
    });

    it('pending Start qualifies no journey: it may not carry journey readback rows, and declares no stages', () => {
        const r = canonical(PENDING_START_SUITE);
        expect((r.readback as { journeys: unknown[] }).journeys).toEqual([]);
        for (const step of ['journey telemetry (canary class)', 'journey telemetry received']) {
            expect(finalize({ ...r, rows: [...r.rows, hold(step)] }).status).toBe('binding_error');
        }
    });

    it('an unknown or bare suite id still fails closed', () => {
        for (const suite of ['feedback-association-boundaries', 'pending-start', 'made-up-suite']) {
            const r = { ...canonical(FEEDBACK_NO_SESSION_SUITE), suite };
            const out = finalizeReceipt(r, worksheet(r), undefined);
            expect(out.status).toBe('binding_error');
            expect(out.finalAcceptance).not.toBe('PASS');
        }
    });

    it('the four core suites are unchanged: none requires a supplemental-only row', () => {
        const supplementalOnly = ['older-take association', 'no-session association', 'cold Start is pending', 'coaching request budget', 'two saved takes'];
        for (const suite of ['open-mic-first-session', 'focus-points-session', 'focus-points-partial', 'returning-user-navigation']) {
            const inv = requiredAutomatedRows(suite)!;
            for (const step of supplementalOnly) expect(inv.product.includes(step) || inv.required.includes(step)).toBe(false);
        }
    });

    it('Codex P1s r4247193659/674/687: the specs use the product\'s real controls and status values', () => {
        const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
        const feedback = src('live/rwt-feedback-association-boundaries.live.spec.ts');
        const pending = src('live/rwt-pending-start-navigation.live.spec.ts');
        const service = src('../frontend/src/services/transcription/TranscriptionService.ts');
        // The second take starts from the after-state review's own repeat action, never the before-state mic-start.
        expect(feedback).toContain("page.getByTestId('verdict-practice-again')");
        expect(feedback.match(/startBenchmarkRecording\(/g)?.length).toBe(1);
        // The pending Start is the published `loading` value; `downloading`/`initializing` are never written.
        expect(service).toContain("DOWNLOADING: 'loading'");
        expect(service).toContain("ENGINE_INITIALIZING: 'loading'");
        expect(pending).toContain("=== 'loading'");
        expect(pending).not.toMatch(/status === '(downloading|initializing)'/);
        // A cancelled Start settles to `idle`: settlement is any readable status other than `loading`.
        expect(service).toContain("TERMINATED: 'idle'");
        expect(pending).toContain("status !== null && status !== 'loading'");
    });

    it('drift guard: suite ids and every required product row name are written by the specs or their helpers', () => {
        const src = (f: string) => readFileSync(path.resolve(__dirname, '..', f), 'utf8');
        const feedback = src('live/rwt-feedback-association-boundaries.live.spec.ts');
        const pending = src('live/rwt-pending-start-navigation.live.spec.ts');
        const helpers = ['live/helpers/rwtJourney.ts', 'live/helpers/coachingFeedbackAdapter.ts', 'live/helpers/rwtCoachingCollector.ts'].map(src).join('\n');
        expect(feedback).toContain("const SUITE = 'feedback-association-boundaries';");
        expect(feedback).toContain('`${SUITE}-older-take`');
        expect(feedback).toContain('`${SUITE}-no-session`');
        expect(pending).toContain("const SUITE = 'pending-start-navigation';");
        for (const [suite, spec] of [[FEEDBACK_OLDER_TAKE_SUITE, feedback], [FEEDBACK_NO_SESSION_SUITE, feedback], [PENDING_START_SUITE, pending]] as const) {
            for (const step of requiredAutomatedRows(suite)!.product) {
                expect({ suite, step, written: `${spec}\n${helpers}`.includes(`'${step}'`) }).toEqual({ suite, step, written: true });
            }
        }
    });
});

// ── The older-take expectation (#1590 contract on the SELECTED take) and the whole-scenario budget ───────────────
const ex = (sessionId: string, requestId: string, attemptId: string, over: Partial<CoachingExchange> = {}): CoachingExchange => ({
    sent: { sessionId, product: 'open_mic', requestId, attemptId, clientAttempt: 1, clientReleaseId: SHA },
    status: 200,
    diagnostics: { request_id: requestId, attempt_id: attemptId, outcome: 'success', reason: 'none', status: 200, provider_status: 200,
        configured_model: MODEL, observed_model: `${MODEL}-001`, source: 'fresh', provider_attempts: 1, retry_count: 0,
        provider_duration_ms: 600, total_duration_ms: 900 },
    suggestions: null, clientMs: 900, at: 1, ...over,
});
const exchanges = [ex(OLD, OLD_REQ, OLD_ATT), ex(NEW, NEW_REQ, NEW_ATT)];
const report = (ref: string | null) => ({ id: 'rep-1', sessionId: OLD, coachingDiagnosticRef: ref, storedRows: 1 });
const lookup = (ref: string | null) => buildFeedbackLookup({ report: report(ref), currentSessionId: NEW, acknowledgementVisible: true, telemetryReceived: true, exchanges, failureCategory: () => null });

describe('#1594 older-take expectation and request budget', () => {
    const exp = takeExpectation({ reportId: 'rep-1', reportedSessionId: OLD, currentSessionId: NEW, exchanges, configuredModel: MODEL })!;

    it('the older take resolves to its OWN sent request; the newer take is named current', () => {
        expect(exp).toMatchObject({ association: 'selected_older_session', sessionId: OLD, requestId: OLD_REQ, attemptId: OLD_ATT, currentRequestId: NEW_REQ });
        expect(validateFeedbackDiagnostics(lookup(OLD_REQ), exp)).toEqual({ verdict: 'PASS', reasons: [] });
    });

    it('a report borrowing the NEWER take\'s request FAILs; one with no link HOLDs', () => {
        const borrowed = validateFeedbackDiagnostics(lookup(NEW_REQ), exp);
        expect(borrowed.verdict).toBe('FAIL');
        expect(borrowed.reasons).toEqual(expect.arrayContaining(['current_attempt_attached_to_other_session', 'request_mismatch']));
        expect(validateFeedbackDiagnostics(lookup(null), exp)).toEqual({ verdict: 'HOLD', reasons: ['request_link_missing'] });
    });

    const rows: ReceiptRow[] = [];
    const receipt = { rows, row: (step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>) => { rows.push({ step, verdict, detail, evidence }); } };
    const last = () => rows[rows.length - 1];

    it('budget PASS: every sent request answered with Edge diagnostics, within budget, one per take', () => {
        coachingRequestBudgetRow(receipt, { sentCount: 2, exchanges }, { maximum: 2, oneRequestPerSession: [OLD, NEW] });
        expect(last()).toMatchObject({ step: 'coaching request budget', verdict: 'PASS', evidence: { browserRequests: 2, providerAttemptsReported: 2, maxRequestsForOneTake: 1 } });
    });

    it.each([
        ['more browser requests than the budget', { sentCount: 3, exchanges }, { maximum: 2 }],
        ['a take requested twice (a client retry)', { sentCount: 2, exchanges: [ex(OLD, OLD_REQ, OLD_ATT), ex(OLD, OLD_REQ, NEW_ATT)] }, { maximum: 2, oneRequestPerSession: [OLD] }],
        ['Edge-reported provider attempts above the budget', { sentCount: 1, exchanges: [ex(OLD, OLD_REQ, OLD_ATT, { diagnostics: { ...ex(OLD, OLD_REQ, OLD_ATT).diagnostics, provider_attempts: 2 } })] }, { maximum: 1 }],
        ['any request where none is allowed', { sentCount: 1, exchanges: [ex(OLD, OLD_REQ, OLD_ATT)] }, { maximum: 0 }],
    ])('budget FAIL: %s', (_l, tap, budget) => {
        coachingRequestBudgetRow(receipt, tap, budget);
        expect(last().verdict).toBe('FAIL');
    });

    it('budget HOLD (fail closed, never PASS): a sent request unanswered or without readable Edge diagnostics', () => {
        coachingRequestBudgetRow(receipt, { sentCount: 2, exchanges: [exchanges[0]] }, { maximum: 2 });
        expect(last().verdict).toBe('HOLD');
        coachingRequestBudgetRow(receipt, { sentCount: 1, exchanges: [ex(OLD, OLD_REQ, OLD_ATT, { diagnostics: null })] }, { maximum: 2 });
        expect(last().verdict).toBe('HOLD');
    });

    // PM RETURN 6121020210: malformed provider-attempt counts can never PASS, and never offset a valid count.
    const withAttempts = (sessionId: string, requestId: string, attemptId: string, attempts: unknown) =>
        ex(sessionId, requestId, attemptId, { diagnostics: { ...ex(sessionId, requestId, attemptId).diagnostics, provider_attempts: attempts } });

    it('CASUALTY [3, -1] under maximum 2: the negative count cannot mask the valid 3 → FAIL (was PASS)', () => {
        coachingRequestBudgetRow(receipt, { sentCount: 2, exchanges: [withAttempts(OLD, OLD_REQ, OLD_ATT, 3), withAttempts(NEW, NEW_REQ, NEW_ATT, -1)] },
            { maximum: 2, oneRequestPerSession: [OLD, NEW] });
        expect(last()).toMatchObject({ verdict: 'FAIL', evidence: { providerAttemptsReported: 3, malformedProviderAttempts: 1 } });
    });

    it.each([
        ['a negative count alone', -1],
        ['an unsafe integer', Number.MAX_SAFE_INTEGER + 2],
        ['a fractional count', 0.5],
        ['a numeric string', '1'],
    ])('CASUALTY: %s is malformed → HOLD, never PASS', (_l, attempts) => {
        coachingRequestBudgetRow(receipt, { sentCount: 1, exchanges: [withAttempts(OLD, OLD_REQ, OLD_ATT, attempts)] }, { maximum: 2 });
        expect(last()).toMatchObject({ verdict: 'HOLD', evidence: { malformedProviderAttempts: 1, providerAttemptsReported: 0 } });
    });

    it('CONTROL: zero (a cache answer) and nonnegative counts within budget still PASS', () => {
        coachingRequestBudgetRow(receipt, { sentCount: 2, exchanges: [withAttempts(OLD, OLD_REQ, OLD_ATT, 0), withAttempts(NEW, NEW_REQ, NEW_ATT, 2)] },
            { maximum: 2, oneRequestPerSession: [OLD, NEW] });
        expect(last()).toMatchObject({ verdict: 'PASS', evidence: { providerAttemptsReported: 2, malformedProviderAttempts: 0 } });
    });

    it('budget PASS for a scenario that must send nothing, and sent nothing', () => {
        coachingRequestBudgetRow(receipt, { sentCount: 0, exchanges: [] }, { maximum: 0 });
        expect(last()).toMatchObject({ verdict: 'PASS', evidence: { browserRequests: 0, providerAttemptsReported: 0 } });
    });
});
