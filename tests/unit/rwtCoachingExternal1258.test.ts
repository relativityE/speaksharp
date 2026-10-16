// @vitest-environment node
/**
 * #1258 — COACHING PROVIDER UNAVAILABILITY IS EXTERNAL (PO 2026-10-14; PM 6171519534, A+B+C with D1).
 *
 * A PROVED provider outage (request-bound provider 5xx with its integer status, or provider timeout) that the app handled
 * gracefully is EXTERNAL: non-blocking, named, never PASS — acceptance stays INCOMPLETE because successful coaching is
 * still unproven. Everything the app owns stays PASS/FAIL, and EXTERNAL can never hide a failed save, a missing or
 * disabled Try again, missing failure telemetry, a request/session mismatch, identity or cleanup errors.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    classifySavedCoaching, coachingParentVerdict, failureTelemetryBinding, coachingRequestBindingRow, coachingTelemetryVerdict, focusExternalDependentRows,
    gracefulFailures, provenExternalOutcome, providerStatusFrom, successDependentRow, takeExchangeEvidence,
    type CoachingFailureEvidence, type GracefulDegradation,
} from '../live/helpers/coachingExternal';
import { CoachingGenerationTap } from '../live/helpers/coachingGenerationTap';
import { analyticsRows, exactCountVerdict, firstTakeSavedExactlyOnce, observeCoachingPhrase, readCoachingFailureEvidence, readCoachingFailureReason, RwtReceipt, visibleCoachingAbsence } from '../live/helpers/rwtJourney';
import {
    finalizeReceipt, humanWorksheet, parseHumanWorksheet, receiptAcceptance, requiredAutomatedRows, validateReceipt, type ReceiptRow,
} from '../live/helpers/rwtAcceptance';

const graceful: GracefulDegradation = {
    savedTakeProven: true, reviewState: 'error', unavailableShown: true, retryEnabled: true, requestBoundToSession: true,
};
const provider503: CoachingFailureEvidence = { httpStatus: 502, reason: 'provider_http_5xx', providerStatus: 503 };
const providerTimeout: CoachingFailureEvidence = { httpStatus: 502, reason: 'provider_timeout', providerStatus: null };
const parent = (evidence: CoachingFailureEvidence, g: GracefulDegradation = graceful, rendered = false) =>
    coachingParentVerdict({ rendered, evidence, graceful: g });

describe('the parent "coaching rendered" verdict', () => {
    it('1. success → PASS', () => {
        expect(parent(provider503, graceful, true).verdict).toBe('PASS');
    });
    it('2. provider 503 + graceful app → EXTERNAL, naming the provider status, never PASS', () => {
        const v = parent(provider503);
        expect(v).toMatchObject({ verdict: 'EXTERNAL', external: 'provider_5xx' });
        expect(v.detail).toMatch(/provider 503.*non-blocking per PO.*Successful coaching was not exercised/);
    });
    it('3. provider timeout + graceful app → EXTERNAL', () => {
        expect(parent(providerTimeout)).toMatchObject({ verdict: 'EXTERNAL', external: 'provider_timeout' });
    });
    it.each([
        ['the saved take is not proven (failed or absent save proof)', { savedTakeProven: false }],
        ['Try again is missing or disabled', { retryEnabled: false }],
        ['the unavailable message is not shown', { unavailableShown: false }],
        ['the card did not settle on error', { reviewState: 'loading' }],
        ['the request is not bound to the saved session', { requestBoundToSession: false }],
    ] as const)('4. the same provider outage with broken handling → FAIL: %s', (_label, broken) => {
        const v = parent(provider503, { ...graceful, ...broken });
        expect(v.verdict).toBe('FAIL');
        expect(v.detail).toMatch(/did not degrade gracefully/);
    });
    it.each([
        ['an Edge 502 with no reason', { httpStatus: 502, reason: null, providerStatus: null }],
        ['an unrecognized reason', { httpStatus: 502, reason: 'unrecognized', providerStatus: null }],
        ['an unknown (unsettled) reason', { httpStatus: 502, reason: 'unknown', providerStatus: null }],
        ['provider_transport', { httpStatus: 502, reason: 'provider_transport', providerStatus: null }],
        ['provider_http_5xx without its integer provider status', { httpStatus: 502, reason: 'provider_http_5xx', providerStatus: null }],
        ['provider_http_5xx with a non-5xx provider status', { httpStatus: 502, reason: 'provider_http_5xx', providerStatus: 429 }],
        ['a provider reason on a non-502 response', { httpStatus: 500, reason: 'provider_http_5xx', providerStatus: 503 }],
        ['a browser/harness timeout (no response)', { httpStatus: null, reason: null, providerStatus: null }],
    ] as const)('5. unproven cause → FAIL: %s', (_label, evidence) => {
        expect(provenExternalOutcome(evidence)).toBeNull();
        expect(parent(evidence).verdict).toBe('FAIL');
    });
    it.each([
        ['an invalid answer (contract)', { httpStatus: 502, reason: 'invalid_shape', providerStatus: 200 }],
        ['a missing model version', { httpStatus: 502, reason: 'missing_model_version', providerStatus: 200 }],
        ['a persist failure', { httpStatus: 503, reason: 'persist_failed', providerStatus: 200 }],
    ] as const)('6. our own failure stays FAIL: %s', (_label, evidence) => {
        expect(parent(evidence).verdict).toBe('FAIL');
    });
    it('gracefulFailures names every broken check', () => {
        expect(gracefulFailures(graceful)).toEqual([]);
        expect(gracefulFailures({ ...graceful, savedTakeProven: false, retryEnabled: false })).toHaveLength(2);
    });
});

describe('success-dependent rows and failure-path telemetry', () => {
    it('7. a success-dependent row becomes "not exercised" ONLY under an EXTERNAL parent', () => {
        expect(successDependentRow(parent(provider503), { verdict: 'HOLD', detail: 'no phrases' }).verdict).toBe('EXTERNAL');
        expect(successDependentRow(parent(provider503, { ...graceful, retryEnabled: false }), { verdict: 'HOLD', detail: 'x' }).verdict).toBe('HOLD');
        expect(successDependentRow(parent(provider503, graceful, true), { verdict: 'FAIL', detail: 'mismatch' }).verdict).toBe('FAIL');
    });
    it('8. under EXTERNAL a bound app failure report for THIS request → EXTERNAL', () => {
        expect(coachingTelemetryVerdict(parent(provider503), 'bound', 'FAIL', 'x', 'PASS').verdict).toBe('EXTERNAL');
    });
    it('9. under EXTERNAL an absent, invalid or unbindable report stays FAIL; an ambiguous one is unproven (HOLD)', () => {
        for (const f of ['absent', 'invalid', 'unbindable'] as const) expect(coachingTelemetryVerdict(parent(provider503), f, 'FAIL', 'x', 'PASS').verdict).toBe('FAIL');
        expect(coachingTelemetryVerdict(parent(provider503), 'ambiguous', 'FAIL', 'x', 'PASS').verdict).toBe('HOLD');
    });
    it('without an EXTERNAL parent the success verdict is unchanged (success events are never assumed)', () => {
        expect(coachingTelemetryVerdict(parent(provider503, graceful, true), 'bound', 'FAIL', 'missing', 'PASS').verdict).toBe('FAIL');
    });
});

describe('PM 6174134686 §2 — the APP failure report is bound to the exact request (existing bindFailureReports)', () => {
    // One page boot; `batch` / `batchIndex` give the page's provable emission order inside one PostHog payload.
    let i = 0;
    const ev = (event: string, extra: Record<string, unknown> = {}) => ({ event, at: 0, bootId: 'boot-1', batch: 1, batchIndex: i++, ...extra });
    const diag = (id: string, outcome = 'failure') => ev('ai_coaching_diagnostic', { diagnosticRequestId: id, diagnosticOutcome: outcome });
    const failed = (reason = 'unavailable') => ev('practice_loop_review_failed', { reason });

    it('valid: this request\'s failure diagnostic followed by its app report → bound → EXTERNAL', () => {
        i = 0;
        const events = [diag('req-1'), failed()];
        expect(failureTelemetryBinding(events, 'req-1')).toBe('bound');
        expect(coachingTelemetryVerdict(parent(provider503), failureTelemetryBinding(events, 'req-1'), 'FAIL', 'x', 'PASS').verdict).toBe('EXTERNAL');
    });
    it('RED-case: the diagnostic is present but the app failure report never left → absent → FAIL (never EXTERNAL)', () => {
        i = 0;
        expect(failureTelemetryBinding([diag('req-1')], 'req-1')).toBe('absent');
        expect(coachingTelemetryVerdict(parent(provider503), 'absent', 'FAIL', 'x', 'PASS').verdict).toBe('FAIL');
    });
    it('a DIFFERENT take\'s report cannot satisfy this request', () => {
        i = 0;
        const events = [diag('req-1'), diag('req-2'), failed()];
        expect(failureTelemetryBinding(events, 'req-1')).toBe('absent');
        expect(failureTelemetryBinding(events, 'req-2')).toBe('bound');
    });
    it('reordered / unprovable payload evidence is ambiguous (unproven), never bound', () => {
        // Separate payloads with no capture times: the report's predecessor cannot be proven.
        const events = [
            { event: 'ai_coaching_diagnostic', at: 0, bootId: 'boot-1', batch: 2, batchIndex: 0, diagnosticRequestId: 'req-1', diagnosticOutcome: 'failure' },
            { event: 'practice_loop_review_failed', at: 0, bootId: 'boot-1', batch: 3, batchIndex: 0, reason: 'unavailable' },
        ];
        expect(failureTelemetryBinding(events, 'req-1')).toBe('ambiguous');
    });
    it('an out-of-vocabulary report bound to the request is invalid (FAIL)', () => {
        i = 0;
        expect(failureTelemetryBinding([diag('req-1'), failed('customer said something')], 'req-1')).toBe('invalid');
    });
    it('no diagnostic id → unbindable', () => {
        expect(failureTelemetryBinding([], null)).toBe('unbindable');
    });
});

describe('PM 6174134686 §1 — only the CLOSED reason vocabulary can reach the receipt', () => {
    const exchange = (reason: unknown, providerStatus: unknown = null) => ({
        sent: { sessionId: 's', product: null, requestId: 'r', attemptId: null, clientAttempt: null, clientReleaseId: null },
        status: 502, diagnostics: { reason, provider_status: providerStatus }, suggestions: null, clientMs: 1, at: 1,
    });
    it('an arbitrary slug is `unrecognized` — it never reaches the evidence or the row detail', () => {
        const take = takeExchangeEvidence([exchange('customer_content_123')]);
        expect(take.evidence.reason).toBe('unrecognized');
        const v = parent(take.evidence);
        expect(v.verdict).toBe('FAIL');
        expect(v.detail).not.toContain('customer_content_123');
    });
    it('the permitted provider outcomes stay intact', () => {
        expect(takeExchangeEvidence([exchange('provider_http_5xx', 503)]).evidence).toEqual({ httpStatus: 502, reason: 'provider_http_5xx', providerStatus: 503 });
        expect(takeExchangeEvidence([exchange('provider_timeout')]).evidence.reason).toBe('provider_timeout');
    });
    it('a non-string or absent reason is unrecognized / null', () => {
        expect(takeExchangeEvidence([exchange(42)]).evidence.reason).toBe('unrecognized');
        expect(takeExchangeEvidence([{ ...exchange('x'), diagnostics: null }]).evidence.reason).toBeNull();
    });
});

describe('PM 6173420642 §3 — external proof is the take\'s own request/response tuple (existing CoachingGenerationTap)', () => {
    type Handler = (arg: unknown) => void;
    const fakePage = () => {
        const handlers: Record<string, Handler[]> = {};
        return { on: (event: string, h: Handler) => { (handlers[event] ??= []).push(h); }, emit: (event: string, arg: unknown) => { for (const h of handlers[event] ?? []) h(arg); } };
    };
    const request = (sessionId: string, requestId: string) => ({
        url: () => 'https://x.supabase.co/functions/v1/get-ai-suggestions', method: () => 'POST',
        postDataJSON: () => ({ sessionId, diagnostic_request_id: requestId, product: 'open_mic' }),
    });
    const deferredBody = () => { let resolve!: (v: unknown) => void; const promise = new Promise<unknown>((r) => { resolve = r; }); return { promise, resolve }; };

    it('interleaved requests with reversed response and body completion cannot move take B\'s 503 onto take A', async () => {
        const page = fakePage();
        const tap = new CoachingGenerationTap();
        tap.attach(page as never);
        const reqA = request('sess-A', 'req-A');
        const reqB = request('sess-B', 'req-B');
        page.emit('request', reqA);
        page.emit('request', reqB);
        const bodyA = deferredBody();
        const bodyB = deferredBody();
        // B answers first (a provider 503), A answers later (a 502 with no provider proof); B's body settles LAST.
        page.emit('response', { url: reqB.url, request: () => reqB, status: () => 502, json: () => bodyB.promise });
        page.emit('response', { url: reqA.url, request: () => reqA, status: () => 502, json: () => bodyA.promise });
        bodyA.resolve({ reason: 'unrecognized', diagnostics: { reason: 'internal_error', provider_status: null } });
        bodyB.resolve({ reason: 'provider_http_5xx', diagnostics: { reason: 'provider_http_5xx', provider_status: 503 } });
        await tap.settle();
        const a = takeExchangeEvidence(tap.forSession('sess-A'));
        const b = takeExchangeEvidence(tap.forSession('sess-B'));
        // `internal_error` is outside the closed coaching vocabulary, so it is `unrecognized` (PM 6174134686 §1).
        expect(a.evidence).toEqual({ httpStatus: 502, reason: 'unrecognized', providerStatus: null });
        expect(provenExternalOutcome(a.evidence)).toBeNull();
        expect(b.evidence).toEqual({ httpStatus: 502, reason: 'provider_http_5xx', providerStatus: 503 });
        expect(a.diagnosticRequestId).toBe('req-A');
        expect(parent(a.evidence).verdict, 'A never borrows B\'s external proof').toBe('FAIL');
    });

    it('zero or two exchanges for one take prove nothing', () => {
        expect(takeExchangeEvidence([]).unique).toBe(false);
        const one = { sent: { sessionId: 's', product: null, requestId: 'r', attemptId: null, clientAttempt: null, clientReleaseId: null },
            status: 502, diagnostics: { reason: 'provider_http_5xx', provider_status: 503 }, suggestions: null, clientMs: 1, at: 1 };
        expect(takeExchangeEvidence([one, one])).toMatchObject({ unique: false, evidence: { httpStatus: null } });
        expect(provenExternalOutcome(takeExchangeEvidence([one]).evidence)).toBe('provider_5xx');
    });

    it('request provenance row: PASS for the saved take, FAIL when others were answered but not it, HOLD when none observed', () => {
        const tap = { sentCount: 1, exchanges: [] as never[], forSession: () => [] as never[] };
        expect(coachingRequestBindingRow(tap, 's').verdict).toBe('HOLD');
        expect(coachingRequestBindingRow({ ...tap, exchanges: [{}] as never[] }, 's').verdict).toBe('FAIL');
        expect(coachingRequestBindingRow({ ...tap, exchanges: [{}] as never[], forSession: () => [{}] as never[] }, 's').verdict).toBe('PASS');
    });
});

describe('PM 6173420642 §1 — Focus success-dependent rows read the exact saved coaching first', () => {
    const rowsOf = (rows: Array<{ step: string; verdict: string }>) => Object.fromEntries(rows.map((r) => [r.step, r.verdict]));
    it('provider 503 + a PERSISTED pair → provenance and visible = saved FAIL (never "not exercised")', async () => {
        const rows = rowsOf(await focusExternalDependentRows(parent(provider503), async () => ({ ok: true, raw: { what_worked: 'Saved well.', what_to_try_next: 'Saved next.' } }), true));
        expect(rows['Focus coaching visible = saved']).toBe('FAIL');
        expect(rows['Focus coaching provenance']).toBe('FAIL');
    });
    it('a PARTIAL saved pair is also FAIL', async () => {
        const rows = rowsOf(await focusExternalDependentRows(parent(provider503), async () => ({ ok: true, raw: { what_worked: 'Only one.' } }), true));
        expect(rows['Focus coaching visible = saved']).toBe('FAIL');
    });
    it('an UNREADABLE saved row (error or throw) is HOLD — absence unproven', async () => {
        expect(rowsOf(await focusExternalDependentRows(parent(provider503), async () => ({ ok: false }), true))['Focus coaching visible = saved']).toBe('HOLD');
        expect(rowsOf(await focusExternalDependentRows(parent(provider503), async () => { throw new Error('db'); }, true))['Focus coaching provenance']).toBe('HOLD');
    });
    it('a confirmed ABSENCE lets every success-dependent row be "not exercised"', async () => {
        const rows = await focusExternalDependentRows(parent(provider503), async () => ({ ok: true, raw: null }), true);
        // Six, plus the two #1258 R4 rows (character ceiling, open-point reference).
        expect(rows).toHaveLength(8);
        expect(rows.every((r) => r.verdict === 'EXTERNAL')).toBe(true);
    });
    it('no EXTERNAL parent → no rows are written here (the success path judges them)', async () => {
        expect(await focusExternalDependentRows(parent(provider503, { ...graceful, retryEnabled: false }), async () => ({ ok: true, raw: null }), true)).toEqual([]);
    });
});

describe('the failed response is read once, allowlisted scalars only', () => {
    it('reads the reason and the integer provider status from one json() call', async () => {
        let calls = 0;
        const response = { json: async () => { calls += 1; return { reason: 'provider_http_5xx', error: 'free text', diagnostics: { provider_status: 503, other: 'x' } }; } };
        expect(await readCoachingFailureEvidence(response)).toEqual({ reason: 'provider_http_5xx', providerStatus: 503 });
        expect(calls).toBe(1);
    });
    it('an unparseable body is unrecognized with no provider status (never proof)', async () => {
        expect(await readCoachingFailureEvidence({ json: async () => { throw new SyntaxError('html'); } })).toEqual({ reason: 'unrecognized', providerStatus: null });
    });
    it('readCoachingFailureReason keeps its API', async () => {
        expect(await readCoachingFailureReason({ json: async () => ({ reason: 'provider_timeout' }) })).toBe('provider_timeout');
    });
    it.each([[503.5], ['503'], [99], [600], [undefined]])('providerStatusFrom rejects %s', (value) => {
        expect(providerStatusFrom({ diagnostics: { provider_status: value } })).toBeNull();
    });
});

const external = (step: string): ReceiptRow => ({ step, verdict: 'EXTERNAL', detail: 'external provider unavailable' });
const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'ok' });
/** The parent's own recorded proof (Codex P1 r4275387520): a request-bound provider 503 with graceful app handling. */
const PROVED_PARENT_EVIDENCE = Object.freeze({
    reviewState: 'error', httpStatus: 502, failureReason: 'provider_http_5xx', providerStatus: 503, takeExchangeUnique: true,
    externalOutcome: 'provider_5xx', savedTakeProven: true, unavailableShown: true, retryEnabled: true,
});
const provedParent = (step: string): ReceiptRow => ({ ...external(step), evidence: { ...PROVED_PARENT_EVIDENCE } });

describe('acceptance: EXTERNAL is non-blocking but INCOMPLETE, and never hides a FAIL', () => {
    it('10. EXTERNAL alone → INCOMPLETE, named, coverage outstanding, not all-pass', () => {
        const a = receiptAcceptance([pass('session saved'), external('coaching rendered')]);
        expect(a).toMatchObject({ acceptance: 'INCOMPLETE', automatedRowsAllPass: false, successfulCoachingOutstanding: true });
        expect(a.external).toEqual([{ step: 'coaching rendered', detail: 'external provider unavailable' }]);
    });
    it.each([
        ['a save failure', 'saved exactly once'],
        ['a cleanup failure', 'run-owned cleanup'],
        ['an identity failure', 'session bears canary claim'],
        ['a request/session mismatch', 'coaching request bound to this take'],
    ])('11. an unrelated FAIL still fails the run beside EXTERNAL: %s', (_label, step) => {
        expect(receiptAcceptance([external('coaching rendered'), { step, verdict: 'FAIL', detail: 'x' }]).acceptance).toBe('FAIL');
    });
    it('a run without EXTERNAL rows reports no outstanding external coverage', () => {
        expect(receiptAcceptance([pass('a')])).toMatchObject({ acceptance: 'PASS', external: [], successfulCoachingOutstanding: false });
    });
});

describe('finalization (schema, readback D1, exit semantics)', () => {
    const SUITE = 'open-mic-first-session';
    const SHA = 'c'.repeat(40);
    const J = 'journey-rec';
    const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
    const humanRow = (id: string): ReceiptRow => ({
        step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation',
        evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' },
    });
    const base: ReceiptRow[] = [
        { step: 'journey telemetry received', verdict: 'HOLD', detail: 'pending' }, { step: 'signup-stage telemetry received', verdict: 'HOLD', detail: 'p' },
        pass('telemetry decodable'), pass('signup-stage telemetry (user class)'), pass('journey telemetry (canary class)'), pass('receipt content-free'),
        humanRow('open_mic_coaching_relevant'), humanRow('open_mic_uh_detected'), provedParent('coaching rendered'),
    ];
    const rows = [...base, ...requiredAutomatedRows(SUITE)!.product.filter((s) => !base.some((r) => r.step === s))
        .map((s) => (s === 'base_q4 primary' ? { step: s, verdict: 'HOLD' as const, detail: 'p' } : pass(s)))];
    const receipt = { suite: SUITE, release: SHA, meta: { fixtureKind: 'synthetic' }, rows,
        readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: [], missingBindings: [] } };
    const worksheet = () => parseHumanWorksheet(humanWorksheet(SUITE, SHA, [J], rows).split('\n')
        .map((l) => (l.startsWith('| `open_mic_')
            // A blank result is decided PASS; the prefilled NOT_EXERCISED is left as it is and SIGNED (Codex P2 r4275712673).
            ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-10-14 |').replace(/\| NOT_EXERCISED \| {2}\|$/, '| NOT_EXERCISED | PO · 2026-10-14 |')
            : l)).join('\n'));

    it('12. the schema accepts EXTERNAL and still rejects an unknown verdict', () => {
        expect(validateReceipt(receipt).errors).toEqual([]);
        const bad = { ...receipt, rows: [...rows.slice(0, -1), { step: 'coaching rendered', verdict: 'SKIPPED', detail: 'x' }] };
        expect(validateReceipt(bad).errors.join(' ')).toMatch(/verdict/i);
    });
    it('13. D1: a readback HOLD beside an EXTERNAL parent stays HOLD and names the success chain; the run is INCOMPLETE (exit 2)', () => {
        const r = finalizeReceipt(receipt, worksheet(), { suite: SUITE, release: SHA, journeys: [{ journeyId: J, stages: STAGES, verdict: 'HOLD' }], missingBindings: [] });
        const received = r.rows.find((row) => row.step === 'journey telemetry received')!;
        expect(received.verdict).toBe('HOLD');
        expect(received.detail).toMatch(/post-Stop success chain \(review_rendered\).*EXTERNAL; product gate unchanged, D1/);
        expect(r).toMatchObject({ status: 'final', finalAcceptance: 'INCOMPLETE', successfulCoachingOutstanding: true });
        // PM 6175763509 §4: the coaching-quality human check under this parent finalizes as EXTERNAL "not exercised".
        expect(r.external.map((e) => e.step).sort()).toEqual(['coaching rendered', 'human: open_mic_coaching_relevant']);
    });
    it('14. an observed readback FAIL still dominates beside EXTERNAL (never relabelled)', () => {
        const r = finalizeReceipt(receipt, worksheet(), { suite: SUITE, release: SHA, journeys: [{ journeyId: J, stages: STAGES, verdict: 'FAIL' }], missingBindings: [] });
        expect(r.rows.find((row) => row.step === 'journey telemetry received')!.verdict).toBe('FAIL');
        expect(r.finalAcceptance).toBe('FAIL');
    });
    it('15. even a fully qualified readback cannot turn an EXTERNAL run into PASS', () => {
        const r = finalizeReceipt(receipt, worksheet(), { suite: SUITE, release: SHA, journeys: [{ journeyId: J, stages: STAGES, verdict: 'QUALIFIED' }], missingBindings: [] });
        expect(r.rows.find((row) => row.step === 'journey telemetry received')!.verdict).toBe('PASS');
        expect(r.finalAcceptance).toBe('INCOMPLETE');
    });
});

// ── PM 6175763509 (Codex r4274573828 / 837 / 839 / 846) ─────────────────────────────────────────────────────────────

describe('§1 — the take\'s TERMINAL exchange within its review lifecycle (declared attempt authority, not arrival order)', () => {
    const ex = (o: { requestId?: string | null; attemptId?: string; clientAttempt?: number; status: number | null; reason?: string; providerStatus?: number | null;
        echoRequest?: string; echoAttempt?: string }) => ({
        sent: { sessionId: 's', product: null, requestId: o.requestId === undefined ? 'life-1' : o.requestId, attemptId: o.attemptId ?? 'att-x',
            clientAttempt: o.clientAttempt ?? 1, clientReleaseId: null },
        status: o.status,
        diagnostics: o.status === null ? null : { reason: o.reason ?? 'provider_http_5xx', provider_status: o.providerStatus ?? 503,
            ...(o.echoRequest ? { request_id: o.echoRequest } : {}), ...(o.echoAttempt ? { attempt_id: o.echoAttempt } : {}) },
        suggestions: null, clientMs: 1, at: 1,
    });
    const terminal503 = ex({ attemptId: 'a2', clientAttempt: 2, status: 502 });
    it('a single 503 exchange proves the outage', () => {
        expect(takeExchangeEvidence([ex({ status: 502 })])).toMatchObject({ unique: true, diagnosticRequestId: 'life-1', evidence: { providerStatus: 503 } });
    });
    it('network failure (no answer) on attempt 1, then a 503 on attempt 2 → the attempt-2 503, in either arrival order', () => {
        const net = ex({ attemptId: 'a1', clientAttempt: 1, status: null });
        expect(takeExchangeEvidence([net, terminal503])).toMatchObject({ unique: true, evidence: { httpStatus: 502, reason: 'provider_http_5xx' } });
        expect(takeExchangeEvidence([terminal503, net])).toMatchObject({ unique: true, evidence: { httpStatus: 502 } });
    });
    it('a 425 pending wait then the terminal answer at the SAME client attempt → the terminal answer', () => {
        const pending = ex({ attemptId: 'a1', clientAttempt: 1, status: 425, reason: 'focus_results_pending' });
        const final = ex({ attemptId: 'a1b', clientAttempt: 1, status: 502 });
        expect(takeExchangeEvidence([pending, final])).toMatchObject({ unique: true, evidence: { httpStatus: 502, providerStatus: 503 } });
        expect(takeExchangeEvidence([final, pending]).unique).toBe(true);
    });
    it('two unrelated lifecycles for one take are unproven', () => {
        expect(takeExchangeEvidence([ex({ status: 502 }), ex({ requestId: 'life-2', status: 502 })]).unique).toBe(false);
    });
    it('duplicate terminal evidence at the last attempt is unproven', () => {
        expect(takeExchangeEvidence([ex({ attemptId: 'a1', status: 502 }), ex({ attemptId: 'a1c', status: 502 })]).unique).toBe(false);
    });
    it('a conflicting server echo (request or attempt id) is unproven', () => {
        expect(takeExchangeEvidence([ex({ status: 502, echoRequest: 'life-OTHER' })]).unique).toBe(false);
        expect(takeExchangeEvidence([ex({ attemptId: 'a1', status: 502, echoAttempt: 'a-OTHER' })]).unique).toBe(false);
    });
    it('only pending/unanswered exchanges, or no lifecycle id, prove nothing', () => {
        expect(takeExchangeEvidence([ex({ status: 425 })]).unique).toBe(false);
        expect(takeExchangeEvidence([ex({ status: null })]).unique).toBe(false);
        expect(takeExchangeEvidence([ex({ requestId: null, status: 502 })]).unique).toBe(false);
    });
});

describe('§2–§4 — a consumer-built EXTERNAL receipt through the real validator and finalizer', () => {
    const SHA = 'e'.repeat(40);
    const J = 'journey-ext';
    const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
    const human = (id: string): ReceiptRow => ({ step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation',
        evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' } });
    /** The rows the Open Mic consumer writes on a proved outage, incl. analyticsRows' coaching-dependent rows. */
    const externalOpenMicRows = (): ReceiptRow[] => {
        const r = new RwtReceipt('open-mic-first-session');
        r.row('coaching rendered', 'EXTERNAL', 'external provider unavailable (provider 503)', { ...PROVED_PARENT_EVIDENCE });
        r.row('coaching request bound to this take', 'PASS', 'the coaching request named this saved take');
        // As the consumer writes it (Codex P1 r4276518654): the confirmed read found no saved coaching.
        r.row('coaching visible = saved', 'EXTERNAL', 'not exercised', { savedCoachingAbsent: true, visibleCoachingAbsent: true });
        analyticsRows(r, { actionClicked: true, listed: true, detailOpened: true, detailMatches: true, reloadMatches: true,
            coachingBefore: undefined, coachingAfter: undefined } as never, true);
        return r.rows;
    };
    const receiptWith = (rows: ReceiptRow[], suite = 'open-mic-first-session') => {
        const base: ReceiptRow[] = [
            ...rows, { step: 'journey telemetry received', verdict: 'HOLD', detail: 'p' }, { step: 'signup-stage telemetry received', verdict: 'HOLD', detail: 'p' },
            pass('telemetry decodable'), pass('signup-stage telemetry (user class)'), pass('journey telemetry (canary class)'), pass('receipt content-free'),
            human('open_mic_coaching_relevant'), human('open_mic_uh_detected'),
        ];
        const complete = [...base, ...requiredAutomatedRows(suite)!.product.filter((s) => !base.some((x) => x.step === s))
            .map((s) => (s === 'base_q4 primary' ? { step: s, verdict: 'HOLD' as const, detail: 'p' } : pass(s)))];
        return { suite, release: SHA, meta: { fixtureKind: 'synthetic' }, rows: complete,
            readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: [], missingBindings: [] } };
    };
    const worksheet = (rows: ReceiptRow[], results: Record<string, string>) => parseHumanWorksheet(humanWorksheet('open-mic-first-session', SHA, [J], rows)
        .split('\n').map((l) => {
            const id = Object.keys(results).find((k) => l.startsWith(`| \`${k}\``));
            return id ? l.replace(/\| [^|]* \| {2}\|$/, `| ${results[id]} | PO · 2026-10-14 |`) : l;
        }).join('\n'));

    it('§2: the consumer writes every coaching-dependent Analytics row as EXTERNAL, and the receipt finalizes INCOMPLETE (not a binding error)', () => {
        const rows = externalOpenMicRows();
        for (const step of ['analytics detail shows both AI suggestions', 'saved review is the first block', '"From this session" evidence', 'one practice action']) {
            expect({ step, verdict: rows.find((x) => x.step === step)?.verdict }).toEqual({ step, verdict: 'EXTERNAL' });
        }
        const receipt = receiptWith(rows);
        expect(validateReceipt(receipt).errors).toEqual([]);
        const r = finalizeReceipt(receipt, worksheet(receipt.rows, { open_mic_coaching_relevant: '', open_mic_uh_detected: 'PASS' }));
        expect(r).toMatchObject({ status: 'final', finalAcceptance: 'INCOMPLETE', successfulCoachingOutstanding: true });
    });
    it('§2 RED-case: a receipt missing one coaching-dependent Analytics row cannot finalize', () => {
        const receipt = receiptWith(externalOpenMicRows());
        receipt.rows = receipt.rows.filter((x) => x.step !== 'one practice action');
        expect(validateReceipt(receipt).errors.join(' ')).toMatch(/one practice action/);
    });
    it.each([['open-mic-first-session', 'coaching request bound to this take'], ['focus-points-session', 'Focus coaching request bound to this take']])(
        '§3 %s: the request-binding row is REQUIRED — omission cannot qualify; a mismatch FAILs', (suite, step) => {
            expect(requiredAutomatedRows(suite)!.product).toContain(step);
            const complete = receiptWith([], suite);
            const omitted = { ...complete, rows: complete.rows.filter((x) => x.step !== step) };
            expect(validateReceipt(omitted).errors.join(' ')).toContain(step);
            const mismatched = { ...complete, rows: complete.rows.map((x) => (x.step === step ? { ...x, verdict: 'FAIL' as const } : x)) };
            expect(receiptAcceptance(mismatched.rows).acceptance).toBe('FAIL');
        });
    it('§4: under the EXTERNAL parent the quality check is prefilled NOT_EXERCISED and finalizes as not exercised (never PASS)', () => {
        const receipt = receiptWith(externalOpenMicRows());
        const md = humanWorksheet('open-mic-first-session', SHA, [J], receipt.rows);
        expect(md).toMatch(/`open_mic_coaching_relevant`.*\| NOT_EXERCISED \|/);
        const r = finalizeReceipt(receipt, worksheet(receipt.rows, { open_mic_coaching_relevant: 'NOT_EXERCISED', open_mic_uh_detected: 'PASS' }));
        expect(r.status).toBe('final');
        expect(r.humanObservations.find((h) => h.id === 'open_mic_coaching_relevant')?.result).toBe('not_exercised');
        expect(r.finalAcceptance).toBe('INCOMPLETE');
    });
    it('§4: PASS for absent coaching is refused; a recorded FAIL still stands', () => {
        const receipt = receiptWith(externalOpenMicRows());
        const passed = finalizeReceipt(receipt, worksheet(receipt.rows, { open_mic_coaching_relevant: 'PASS', open_mic_uh_detected: 'PASS' }));
        expect(passed.status).toBe('binding_error');
        expect(passed.errors.join(' ')).toMatch(/cannot PASS/);
        const failed = finalizeReceipt(receipt, worksheet(receipt.rows, { open_mic_coaching_relevant: 'FAIL', open_mic_uh_detected: 'PASS' }));
        expect(failed.finalAcceptance).toBe('FAIL');
    });
    it('§4: NOT_EXERCISED without a matching EXTERNAL parent, or for any other human check, is refused', () => {
        const ordinary = receiptWith([pass('coaching rendered')]);
        expect(finalizeReceipt(ordinary, worksheet(ordinary.rows, { open_mic_coaching_relevant: 'NOT_EXERCISED', open_mic_uh_detected: 'PASS' })).status).toBe('binding_error');
        const external = receiptWith(externalOpenMicRows());
        expect(finalizeReceipt(external, worksheet(external.rows, { open_mic_coaching_relevant: '', open_mic_uh_detected: 'NOT_EXERCISED' })).status).toBe('binding_error');
    });
});

// ── Codex r4275387520 (P1) / r4275387528 (P2) on 69aba7df4 ─────────────────────────────────────────────────────────

describe('Codex P1 r4275387520 — EXTERNAL is a closed claim: only the proved coaching parent and its own dependents', () => {
    const SHA = 'f'.repeat(40);
    const J = 'journey-closed';
    const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
    const human = (id: string): ReceiptRow => ({ step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation',
        evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' } });
    /** A complete Open Mic receipt; `rows` override any same-named row. */
    const openMic = (rows: ReceiptRow[]) => {
        const base: ReceiptRow[] = [
            { step: 'journey telemetry received', verdict: 'HOLD', detail: 'p' }, { step: 'signup-stage telemetry received', verdict: 'HOLD', detail: 'p' },
            pass('telemetry decodable'), pass('signup-stage telemetry (user class)'), pass('journey telemetry (canary class)'), pass('receipt content-free'),
            human('open_mic_coaching_relevant'), human('open_mic_uh_detected'),
            ...requiredAutomatedRows('open-mic-first-session')!.product.map((s) => (s === 'base_q4 primary' ? { step: s, verdict: 'HOLD' as const, detail: 'p' } : pass(s))),
        ];
        const merged = [...base.filter((b) => !rows.some((r) => r.step === b.step)), ...rows];
        return { suite: 'open-mic-first-session', release: SHA, meta: { fixtureKind: 'synthetic' }, rows: merged,
            readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: [], missingBindings: [] } };
    };
    const errorsOf = (r: unknown) => validateReceipt(r).errors.join(' | ');

    it('RED-case from the review: a FAIL edited to EXTERNAL on an unrelated row is refused — never finalized as INCOMPLETE', () => {
        for (const step of ['saved exactly once', 'run-owned cleanup', 'session bears canary claim']) {
            const forged = openMic([{ step, verdict: 'EXTERNAL', detail: 'forged' }]);
            expect(errorsOf(forged)).toContain(`row "${step}" is EXTERNAL, but EXTERNAL is allowed only on the coaching rows`);
            const fin = finalizeReceipt(forged, parseHumanWorksheet(''));
            expect(fin.status).toBe('binding_error');
            expect(fin.errors.join(' ')).toMatch(/EXTERNAL is allowed only on the coaching rows/);
        }
    });
    it('the parent may be EXTERNAL only with its own proof (5xx or timeout); each missing proof is named', () => {
        expect(errorsOf(openMic([provedParent('coaching rendered')]))).toBe('');
        const timeout = { ...provedParent('coaching rendered'), evidence: { ...PROVED_PARENT_EVIDENCE, externalOutcome: 'provider_timeout', failureReason: 'provider_timeout', providerStatus: null } };
        expect(errorsOf(openMic([timeout]))).toBe('');
        expect(errorsOf(openMic([external('coaching rendered')]))).toMatch(/"coaching rendered" is EXTERNAL without its proof: httpStatus is not 502/);
        for (const [key, value] of [
            ['httpStatus', 500], ['failureReason', 'provider_transport'], ['providerStatus', 429], ['providerStatus', 503.5], ['externalOutcome', null],
            ['takeExchangeUnique', false], ['savedTakeProven', null], ['reviewState', 'ready'], ['unavailableShown', false], ['retryEnabled', false],
        ] as const) {
            const row = { ...provedParent('coaching rendered'), evidence: { ...PROVED_PARENT_EVIDENCE, [key]: value } };
            expect(errorsOf(openMic([row])), `${key}=${String(value)}`).toMatch(/is EXTERNAL without its proof/);
        }
    });
    it('an EXTERNAL parent whose request is not bound to this take is not a proved outage', () => {
        expect(errorsOf(openMic([provedParent('coaching rendered'), { step: 'coaching request bound to this take', verdict: 'FAIL', detail: 'x' }])))
            .toMatch(/"coaching request bound to this take" is not PASS/);
    });
    it('a dependent row is EXTERNAL only under an EXTERNAL parent', () => {
        const absent = { ...external('coaching visible = saved'), evidence: { savedCoachingAbsent: true, visibleCoachingAbsent: true } };
        expect(errorsOf(openMic([provedParent('coaching rendered'), absent, external('coaching length'), external('one practice action')]))).toBe('');
        expect(errorsOf(openMic([external('coaching length')]))).toMatch(/"coaching length" is EXTERNAL without an EXTERNAL "coaching rendered" parent/);
        // Another suite's coaching row is not this suite's dependent.
        expect(errorsOf(openMic([provedParent('coaching rendered'), external('Focus coaching length')]))).toMatch(/allowed only on the coaching rows/);
    });
    it('an input human observation can never arrive as EXTERNAL (only finalization records not exercised)', () => {
        const row = { ...human('open_mic_coaching_relevant'), verdict: 'EXTERNAL' as const };
        expect(errorsOf(openMic([provedParent('coaching rendered'), row]))).toMatch(/arrived as EXTERNAL; only finalization/);
    });
    it('a suite with no coaching parent rejects EXTERNAL outright', () => {
        const r = { ...openMic([]), suite: 'returning-user-navigation' };
        r.rows = [...r.rows, external('coaching rendered')];
        expect(errorsOf(r)).toMatch(/is EXTERNAL, which the returning-user-navigation suite never writes/);
    });
    it('every row the Focus producer writes under a proved outage is inside the Focus scope', async () => {
        const parent = { verdict: 'EXTERNAL' as const, detail: 'd', external: 'provider_5xx' as const };
        const produced = await focusExternalDependentRows(parent, async () => ({ ok: true, raw: null }), true);
        const r = new RwtReceipt('focus-points-session');
        r.row('Focus coaching rendered', 'EXTERNAL', 'd', { ...PROVED_PARENT_EVIDENCE });
        r.row('Focus coaching request bound to this take', 'PASS', 'bound');
        for (const x of produced) r.row(x.step, x.verdict, x.detail, x.evidence); // exactly as rwtJourney writes them
        r.row('Focus coaching telemetry sent', 'EXTERNAL', 'bound failure report', { boundFailureOutcome: 'bound', firstTakeRequestCount: 1, firstTakeRequestProof: 'PASS' });
        analyticsRows(r, { actionClicked: true, listed: true, detailOpened: true, detailMatches: true, reloadMatches: true,
            coachingBefore: undefined, coachingAfter: undefined } as never, true);
        const errors = validateReceipt({ suite: 'focus-points-session', release: SHA, rows: r.rows,
            readback: { journeys: [{ journeyId: J, stages: ['x'] }], reportedJourneyIds: [] } }).errors.filter((e) => e.includes('EXTERNAL'));
        expect(errors).toEqual([]);
    });
});

describe('Codex P2 r4275387528 — the worksheet explains the prefilled NOT_EXERCISED result', () => {
    const SHA = 'a'.repeat(40);
    const human = (id: string): ReceiptRow => ({ step: `human: ${id}`, verdict: 'HUMAN', detail: 'h',
        evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' } });
    it('under an EXTERNAL parent: the instruction and the column name the prefilled value and say to leave it', () => {
        const md = humanWorksheet('open-mic-first-session', SHA, ['j'], [provedParent('coaching rendered'), human('open_mic_coaching_relevant'), human('open_mic_uh_detected')]);
        expect(md).toContain('Result (PASS/FAIL, or prefilled NOT_EXERCISED)');
        expect(md).toMatch(/prefilled `NOT_EXERCISED` is a coaching-quality check whose coaching was never produced/);
        expect(md).toMatch(/Leave it as it is and sign the Observer cell\. PASS is refused for it/);
        // The instruction never invites NOT_EXERCISED on the other check.
        expect(md).toMatch(/`open_mic_uh_detected`[^\n]*\| {2}\| {2}\|$/m);
    });
    it('an ordinary run keeps the plain PASS/FAIL worksheet', () => {
        const md = humanWorksheet('open-mic-first-session', SHA, ['j'], [pass('coaching rendered'), human('open_mic_coaching_relevant')]);
        expect(md).toContain('| Result (PASS/FAIL) |');
        expect(md).not.toContain('NOT_EXERCISED');
    });
});

describe('Codex P2 r4275712673 — a not-exercised coaching-quality row is still signed', () => {
    const SHA = 'b'.repeat(40);
    const J = 'journey-sign';
    const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
    const human = (id: string): ReceiptRow => ({ step: `human: ${id}`, verdict: 'HUMAN', detail: 'h',
        evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' } });
    const base: ReceiptRow[] = [
        { step: 'journey telemetry received', verdict: 'HOLD', detail: 'p' }, { step: 'signup-stage telemetry received', verdict: 'HOLD', detail: 'p' },
        pass('telemetry decodable'), pass('signup-stage telemetry (user class)'), pass('journey telemetry (canary class)'), pass('receipt content-free'),
        human('open_mic_coaching_relevant'), human('open_mic_uh_detected'), provedParent('coaching rendered'),
    ];
    const rows = [...base, ...requiredAutomatedRows('open-mic-first-session')!.product.filter((s) => !base.some((r) => r.step === s))
        .map((s) => (s === 'base_q4 primary' ? { step: s, verdict: 'HOLD' as const, detail: 'p' } : pass(s)))];
    const receipt = { suite: 'open-mic-first-session', release: SHA, meta: { fixtureKind: 'synthetic' }, rows,
        readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: [], missingBindings: [] } };
    /** The generated worksheet with `uh` signed PASS and the coaching row set to `result` with `observer`. */
    const sheet = (result: string, observer: string) => parseHumanWorksheet(humanWorksheet('open-mic-first-session', SHA, [J], rows).split('\n')
        .map((l) => (l.startsWith('| `open_mic_uh_detected`') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-10-14 |')
            : l.startsWith('| `open_mic_coaching_relevant`') ? l.replace(/\| [^|]* \| [^|]* \|$/, `| ${result} | ${observer} |`) : l)).join('\n'));

    it('RED-case from the review: the prefilled NOT_EXERCISED row left UNSIGNED cannot finalize', () => {
        const untouched = parseHumanWorksheet(humanWorksheet('open-mic-first-session', SHA, [J], rows).split('\n')
            .map((l) => (l.startsWith('| `open_mic_uh_detected`') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-10-14 |') : l)).join('\n'));
        const r = finalizeReceipt(receipt, untouched);
        expect(r.status).toBe('binding_error');
        expect(r.errors).toContain('observation open_mic_coaching_relevant NOT_EXERCISED has no observer');
    });
    it('an allowed blank result is also refused without an observer', () => {
        expect(finalizeReceipt(receipt, sheet('', '')).errors).toContain('observation open_mic_coaching_relevant NOT_EXERCISED has no observer');
    });
    it('signed, it finalizes as not exercised (INCOMPLETE)', () => {
        const r = finalizeReceipt(receipt, sheet('NOT_EXERCISED', 'PO · 2026-10-14'));
        expect(r).toMatchObject({ status: 'final', finalAcceptance: 'INCOMPLETE' });
        expect(r.humanObservations.find((h) => h.id === 'open_mic_coaching_relevant')?.result).toBe('not_exercised');
    });
});

describe('Codex P1 r4276518654 — an app-owned EXTERNAL dependent needs its own proof, not just its parent', () => {
    const SHA = '9'.repeat(40);
    const J = 'journey-owned';
    const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
    const receiptOf = (suite: string, rows: ReceiptRow[]) => ({ suite, release: SHA, rows: [pass('telemetry decodable'), ...rows],
        readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: [] } });
    /** Only the EXTERNAL-scope errors (the fixture is deliberately not a complete receipt). */
    const scopeErrors = (suite: string, rows: ReceiptRow[]) => validateReceipt(receiptOf(suite, rows)).errors.filter((e) => e.includes('EXTERNAL'));
    const ext = (step: string, evidence?: ReceiptRow['evidence']): ReceiptRow => ({ ...external(step), ...(evidence ? { evidence } : {}) });

    it('RED-case from the review: Focus FAIL rows for an unexpectedly SAVED pair cannot be edited to EXTERNAL', async () => {
        const parent = { verdict: 'EXTERNAL' as const, detail: 'd', external: 'provider_5xx' as const };
        const produced = await focusExternalDependentRows(parent, async () => ({ ok: true, raw: { what_worked: 'saved anyway' } }), true);
        const owned = produced.filter((x) => x.step === 'Focus coaching provenance' || x.step === 'Focus coaching visible = saved');
        expect(owned.map((x) => [x.verdict, x.evidence?.savedCoachingAbsent])).toEqual([['FAIL', false], ['FAIL', false]]);
        const forged = owned.map((x) => ({ ...x, verdict: 'EXTERNAL' as const }));
        expect(scopeErrors('focus-points-session', [provedParent('Focus coaching rendered'), pass('Focus coaching request bound to this take'), ...forged]))
            .toEqual(forged.map((x) => `row "${x.step}" is EXTERNAL without a confirmed read of no saved coaching (savedCoachingAbsent)`));
    });
    it('an unreadable saved-coaching read (HOLD, absence null) cannot be edited to EXTERNAL either', async () => {
        const parent = { verdict: 'EXTERNAL' as const, detail: 'd', external: 'provider_5xx' as const };
        const produced = await focusExternalDependentRows(parent, async () => ({ ok: false }), true);
        const owned = produced.filter((x) => x.step === 'Focus coaching visible = saved').map((x) => ({ ...x, verdict: 'EXTERNAL' as const }));
        expect(owned[0].evidence?.savedCoachingAbsent).toBeNull();
        expect(scopeErrors('focus-points-session', [provedParent('Focus coaching rendered'), pass('Focus coaching request bound to this take'), ...owned]))
            .toHaveLength(1);
    });
    it.each([['absent', undefined], ['ambiguous', 'ambiguous'], ['invalid', 'invalid'], ['unbindable', 'unbindable']])(
        'a telemetry row whose failure report is %s cannot be EXTERNAL', (_label, outcome) => {
            const row = ext('coaching telemetry sent', outcome === undefined ? undefined : { boundFailureOutcome: outcome });
            expect(scopeErrors('open-mic-first-session', [provedParent('coaching rendered'), pass('coaching request bound to this take'), row]))
                .toEqual(['row "coaching telemetry sent" is EXTERNAL without this request\'s bound failure report (boundFailureOutcome)']);
        });
    it('a bound failure report and a confirmed absence are accepted', () => {
        expect(scopeErrors('open-mic-first-session', [provedParent('coaching rendered'), pass('coaching request bound to this take'),
            ext('coaching telemetry sent', { boundFailureOutcome: 'bound', firstTakeRequestCount: 1, firstTakeRequestProof: 'PASS' }),
            ext('coaching visible = saved', { savedCoachingAbsent: true, visibleCoachingAbsent: true })])).toEqual([]);
    });
    it('the coaching-dependent Analytics rows are EXTERNAL only when the take\'s saved-coaching absence is proved', () => {
        const base = [provedParent('coaching rendered'), pass('coaching request bound to this take'), ext('one practice action')];
        expect(scopeErrors('open-mic-first-session', [...base, { step: 'coaching visible = saved', verdict: 'FAIL', detail: 'saved anyway' }]))
            .toEqual(['row "one practice action" is EXTERNAL but the take\'s saved-coaching absence is not proved (coaching visible = saved)']);
        expect(scopeErrors('open-mic-first-session', base)).toHaveLength(1); // no absence row at all
        expect(scopeErrors('open-mic-first-session', [...base, ext('coaching visible = saved', { savedCoachingAbsent: true, visibleCoachingAbsent: true })])).toEqual([]);
    });
});

describe('Codex P1 r4276817126 — only a NULL saved-coaching column is a confirmed absence', () => {
    it.each([[null], [undefined]])('%s → absent', (raw) => {
        expect(classifySavedCoaching(raw)).toEqual({ state: 'absent' });
    });
    it('a complete pair of non-blank strings → pair (trimmed)', () => {
        expect(classifySavedCoaching({ what_worked: ' A. ', what_to_try_next: 'B.' })).toEqual({ state: 'pair', well: 'A.', next: 'B.' });
    });
    it.each([
        ['a non-string field', { what_worked: 123, what_to_try_next: 'B.' }],
        ['blank strings', { what_worked: '  ', what_to_try_next: '' }],
        ['an empty object', {}],
        ['one field only', { what_worked: 'A.' }],
        ['an array', ['A.', 'B.']],
        ['a string', 'A. B.'],
        ['a number', 0],
    ])('%s → malformed (never absent)', (_label, raw) => {
        expect(classifySavedCoaching(raw)).toEqual({ state: 'malformed' });
    });
    it.each([
        ['{ what_worked: 123 }', { what_worked: 123 }],
        ['blank strings', { what_worked: '', what_to_try_next: '' }],
    ])('RED-case from the review: a malformed persisted value (%s) under an outage is FAIL with absence false — never EXTERNAL', async (_label, raw) => {
        const parent = { verdict: 'EXTERNAL' as const, detail: 'd', external: 'provider_5xx' as const };
        const rows = await focusExternalDependentRows(parent, async () => ({ ok: true, raw }), true);
        const owned = rows.filter((x) => x.step === 'Focus coaching provenance' || x.step === 'Focus coaching visible = saved');
        expect(owned.map((x) => [x.verdict, x.evidence?.savedCoachingAbsent, x.detail])).toEqual([
            ['FAIL', false, 'the saved coaching value is malformed (an app persistence defect), not absent'],
            ['FAIL', false, 'the saved coaching value is malformed (an app persistence defect), not absent'],
        ]);
    });
    it('the Open Mic producer classifies the same column the same way (source contract)', () => {
        const src = readFileSync(path.resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        expect(src).toContain("const savedPresent = classifySavedCoaching(savedRow?.ai_suggestions ?? null).state !== 'absent';");
        expect(src).toContain('savedCoachingAbsent: !savedPresent');
    });
});

/**
 * A filter-honouring stand-in for `admin.from('sessions')`: `eq` filters rows, a head count resolves `{ count }`,
 * `maybeSingle` resolves one row. `fail` makes the account count or the own-row read return an error; `nullCount`
 * returns a null count without an error.
 */
type Row = { id: string; user_id: string; status: string };
const sessionsAdmin = (rows: Row[], o: { fail?: 'count' | 'own'; nullCount?: boolean } = {}) => ({
    from: () => ({
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
            const filters: Array<[keyof Row, string]> = [];
            const match = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
            const b = {
                eq: (k: keyof Row, v: string) => { filters.push([k, v]); return b; },
                maybeSingle: async () => (o.fail === 'own' ? { data: null, error: { message: 'x' } } : { data: match()[0] ?? null, error: null }),
                then: (resolve: (v: unknown) => void) => resolve(o.fail === 'count' ? { count: null, error: { message: 'x' } }
                    : { count: o.nullCount ? null : opts?.head ? match().length : null, error: null }),
            };
            return b;
        },
    }),
});

describe('Codex P1 r4277023741 (PM 6180080622) — Focus first-take save is proved exactly once on the run-owned account', () => {
    const UID = 'uid-1';
    const take = (id: string, status = 'completed'): Row => ({ id, user_id: UID, status });
    const prove = (rows: Row[], o?: Parameters<typeof sessionsAdmin>[1]) => firstTakeSavedExactlyOnce(sessionsAdmin(rows, o) as never, UID, 'take-1');

    it('RED-case from the review: the same first take saved twice under two ids is NOT proven', async () => {
        expect(await prove([take('take-1'), take('take-1-dup')])).toEqual({ proven: false, accountCompletedSessions: 2, thisTakeCompleted: true });
    });
    it('exactly one completed row, and it is this take → proven', async () => {
        expect(await prove([take('take-1'), take('draft', 'recording')])).toEqual({ proven: true, accountCompletedSessions: 1, thisTakeCompleted: true });
    });
    it('one completed row that is NOT this take → not proven', async () => {
        expect(await prove([take('other')])).toEqual({ proven: false, accountCompletedSessions: 1, thisTakeCompleted: false });
    });
    it('another account\'s rows are not counted', async () => {
        expect((await prove([take('take-1'), { id: 'x', user_id: 'someone-else', status: 'completed' }])).proven).toBe(true);
    });
    it.each([
        ['an account-count error', { fail: 'count' as const }, { accountCompletedSessions: null, thisTakeCompleted: true }],
        ['a null count', { nullCount: true }, { accountCompletedSessions: null, thisTakeCompleted: true }],
        ['an own-row read error', { fail: 'own' as const }, { accountCompletedSessions: 1, thisTakeCompleted: null }],
    ])('%s fails closed (never proven)', async (_label, o, expected) => {
        expect(await prove([take('take-1')], o)).toEqual({ proven: false, ...expected });
    });
    it('phase contract: the checkpoint runs once, at the FIRST take, before Practice-again and any later recording', () => {
        const journey = readFileSync(path.resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        const helper = readFileSync(path.resolve(__dirname, '../live/helpers/rwtJourney.ts'), 'utf8');
        expect(journey.match(/await focusCoachingRows\(/g)).toHaveLength(1);
        expect(journey.indexOf('await focusCoachingRows(')).toBeLessThan(journey.indexOf('await practiceAgainEvidence('));
        expect(journey.indexOf('signUpDisposableAccount(page, owner.email)')).toBeLessThan(journey.indexOf('await focusCoachingRows('));
        // The account-wide count is used by focusCoachingRows alone.
        expect(helper.match(/await firstTakeSavedExactlyOnce\(/g)).toHaveLength(1);
        // Both Focus suites run this one journey.
        for (const spec of ['rwt-focus-points-session.live.spec.ts', 'rwt-focus-points-partial.live.spec.ts']) {
            expect(readFileSync(path.resolve(__dirname, '../live', spec), 'utf8')).toContain('focusPointsJourney');
        }
    });
});

describe('Codex P1 r4277350691 (PM 6180758593) — Open Mic re-reads the save proof at outage classification', () => {
    const UID = 'uid-om';
    const PERSISTED = 'take-om';
    const row = (id: string, status = 'completed'): Row => ({ id, user_id: UID, status });
    /** The proof the spec runs at classification, fed into the real parent verdict with an otherwise-proved outage. */
    const classify = async (rows: Row[], o?: Parameters<typeof sessionsAdmin>[1]) => {
        const firstSave = await firstTakeSavedExactlyOnce(sessionsAdmin(rows, o) as never, UID, PERSISTED);
        return { firstSave, parent: coachingParentVerdict({ rendered: false, evidence: provider503, graceful: { ...graceful, savedTakeProven: firstSave.proven } }) };
    };

    it('RED-case from the review: count 1 at save time, then a duplicate before classification → EXTERNAL refused', async () => {
        const rows = [row(PERSISTED)];
        // Save time: the spec's earlier account-wide count sees exactly one…
        expect((await firstTakeSavedExactlyOnce(sessionsAdmin(rows) as never, UID, PERSISTED)).accountCompletedSessions).toBe(1);
        rows.push(row('take-om-dup')); // …and a duplicate lands during the filler/coaching waits.
        const { firstSave, parent } = await classify(rows);
        expect(firstSave).toEqual({ proven: false, accountCompletedSessions: 2, thisTakeCompleted: true });
        expect(parent.verdict).toBe('FAIL');
    });
    it.each([
        ['a non-completed expected row beside a different sole completed row', [row(PERSISTED, 'recording'), row('other')]],
        ['an expected id that does not exist, with a different sole completed row', [row('other')]],
    ])('%s → EXTERNAL refused', async (_label, rows) => {
        const { firstSave, parent } = await classify(rows);
        expect(firstSave).toMatchObject({ proven: false, accountCompletedSessions: 1, thisTakeCompleted: false });
        expect(parent.verdict).toBe('FAIL');
    });
    it('the current count is 1 and the expected row is completed → EXTERNAL-eligible (with the other graceful/request evidence)', async () => {
        const { firstSave, parent } = await classify([row(PERSISTED)]);
        expect(firstSave.proven).toBe(true);
        expect(parent).toMatchObject({ verdict: 'EXTERNAL', external: 'provider_5xx' });
    });
    it.each([[{ fail: 'count' as const }], [{ nullCount: true }], [{ fail: 'own' as const }]])('a failed or null read %j → EXTERNAL refused', async (o) => {
        expect((await classify([row(PERSISTED)], o)).parent.verdict).toBe('FAIL');
    });
    it('wiring contract: the spec re-reads the proof after the waits, uses it for the verdict AND the receipt, before Practice-again', () => {
        const src = readFileSync(path.resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const proof = src.indexOf('await firstTakeSavedExactlyOnce(admin! as never, capturedUid, persistedId)');
        expect(proof).toBeGreaterThan(src.indexOf('await settleCoachingReason(generations.settle());'));
        expect(proof).toBeLessThan(src.indexOf('const coachingParent = coachingParentVerdict({'));
        expect(proof).toBeLessThan(src.indexOf('await practiceAgainEvidence('));
        expect(src).toContain('graceful: { savedTakeProven: firstSave?.proven ?? false,');
        expect(src).toContain('savedTakeProven: rendered ? null : firstSave?.proven ?? false,');
        expect(src).not.toContain('Boolean(persistedId) && saved === 1');
    });
});

describe('Codex P1 r4277621594 (PM 6182054477) — the first take\'s review request must be proved before telemetry is EXTERNAL', () => {
    const outage = { verdict: 'EXTERNAL' as const, detail: 'd', external: 'provider_5xx' as const };
    /** The producers' first-take proof: `exactCountVerdict(count, 1, tap, stoppedAt, firstTakeWindowEnd)`. */
    const proof = (count: number, blindAt: number[] = []) => exactCountVerdict(count, 1, { blindAt } as never, 1_000, 2_000);
    it.each([[0, 'FAIL'], [2, 'FAIL'], [1, 'EXTERNAL']])('bound failure + %i first-take request(s) → %s', (count, expected) => {
        expect(coachingTelemetryVerdict(outage, 'bound', 'FAIL', 'x', proof(count as number)).verdict).toBe(expected);
    });
    it('an opaque beacon INSIDE the first-take window leaves the count unproven → HOLD, never EXTERNAL', () => {
        expect(proof(1, [1_500])).toBe('HOLD');
        expect(proof(0, [1_500])).toBe('HOLD');
        expect(coachingTelemetryVerdict(outage, 'bound', 'FAIL', 'x', proof(0, [1_500])).verdict).toBe('HOLD');
    });
    it('a beacon OUTSIDE the window (e.g. the later Practice-again take) neither satisfies nor breaks the first take', () => {
        expect(proof(1, [2_500])).toBe('PASS');
        expect(proof(0, [2_500])).toBe('FAIL');
    });
    it('a missing proof argument fails closed; the failure-binding outcomes keep their own verdicts', () => {
        expect(coachingTelemetryVerdict(outage, 'bound', 'FAIL', 'x', undefined as never).verdict).toBe('FAIL');
        expect(coachingTelemetryVerdict(outage, 'ambiguous', 'FAIL', 'x', 'PASS').verdict).toBe('HOLD');
        expect(coachingTelemetryVerdict(outage, 'invalid', 'FAIL', 'x', 'PASS').verdict).toBe('FAIL');
        expect(coachingTelemetryVerdict(outage, 'unbindable', 'FAIL', 'x', 'PASS').verdict).toBe('FAIL');
    });
    it('the success path is unchanged by the request proof', () => {
        expect(coachingTelemetryVerdict({ verdict: 'PASS', detail: '', external: null }, 'absent', 'PASS', 'ok', 'FAIL')).toEqual({ verdict: 'PASS', detail: 'ok' });
    });
    it('wiring contract: both producers count the FIRST take in its window (closed before Practice-again) and record normalized keys', () => {
        const om = readFileSync(path.resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const fp = readFileSync(path.resolve(__dirname, '../live/helpers/rwtFocusPointsJourney.ts'), 'utf8');
        expect(om).toContain("const firstTakeRequestCount = generationsForTake ?? tap.sent('practice_loop_review_requested').length;");
        expect(om).toContain('const firstTakeRequestProof = exactCountVerdict(firstTakeRequestCount, 1, tap, stoppedAt, generationsForTake === null ? Date.now() : generationsAt);');
        expect(om).toContain('firstTakeRequestCount, firstTakeRequestProof });');
        expect(fp.indexOf('const generationVerdict = exactCountVerdict(')).toBeLessThan(fp.indexOf('const focusCoachingTelemetry = coachingTelemetryVerdict('));
        expect(fp).toContain('firstTakeRequestCount: generationsForFirstTake, firstTakeRequestProof: generationVerdict });');
    });
    it.each([
        ['missing', {}], ['count 0', { firstTakeRequestCount: 0, firstTakeRequestProof: 'FAIL' }], ['HOLD proof', { firstTakeRequestCount: 1, firstTakeRequestProof: 'HOLD' }],
        ['null proof', { firstTakeRequestCount: 1, firstTakeRequestProof: null }], ['count 2', { firstTakeRequestCount: 2, firstTakeRequestProof: 'PASS' }],
    ])('validator: a forged EXTERNAL telemetry row with %s request evidence is refused', (_label, ev) => {
        const errors = validateReceipt({ suite: 'open-mic-first-session', release: 'a'.repeat(40), rows: [pass('telemetry decodable'), provedParent('coaching rendered'),
            pass('coaching request bound to this take'), { ...external('coaching telemetry sent'), evidence: { boundFailureOutcome: 'bound', ...ev } }],
            readback: { journeys: [{ journeyId: 'j', stages: ['x'] }], reportedJourneyIds: [] } }).errors.filter((e) => e.includes('EXTERNAL'));
        expect(errors).toEqual(['row "coaching telemetry sent" is EXTERNAL without the first take\'s proved review request (firstTakeRequestProof / firstTakeRequestCount)']);
    });
});

describe('Codex P1 r4277621600 (PM 6182054477) — EXTERNAL needs a confirmed VISIBLE absence (tri-state, unreadable is never absent)', () => {
    /** A stand-in review card: per test id, the node count (or a count failure) and whether the text read succeeds. */
    const card = (nodes: Record<string, { count: number | 'error' | 'hang'; text?: 'ok' | 'error' }>) => ({
        getByTestId: (id: string) => {
            const n = nodes[id] ?? { count: 0 };
            return {
                count: () => (n.count === 'error' ? Promise.reject(new Error('detached')) : n.count === 'hang' ? new Promise<number>(() => undefined) : Promise.resolve(n.count)),
                first: () => ({ innerText: () => (n.text === 'error' ? Promise.reject(new Error('timeout')) : Promise.resolve('phrase')) }),
            };
        },
    }) as never;
    const W = 'review-what-went-well';
    const N = 'review-try-next';
    it.each([
        ['both nodes absent', { [W]: { count: 0 }, [N]: { count: 0 } }, 'absent', 'absent', true],
        ['one visible phrase (saved null)', { [W]: { count: 1, text: 'ok' as const }, [N]: { count: 0 } }, 'present', 'absent', false],
        ['a stale visible pair', { [W]: { count: 1, text: 'ok' as const }, [N]: { count: 1, text: 'ok' as const } }, 'present', 'present', false],
        ['a failed phrase-count read', { [W]: { count: 'error' as const }, [N]: { count: 0 } }, 'unreadable', 'absent', null],
        ['a failed text read', { [W]: { count: 1, text: 'error' as const }, [N]: { count: 0 } }, 'unreadable', 'absent', null],
    ])('%s', async (_label, nodes, well, next, absent) => {
        const c = card(nodes);
        const [w, n] = [await observeCoachingPhrase(c, W), await observeCoachingPhrase(c, N)];
        expect([w, n]).toEqual([well, next]);
        expect(visibleCoachingAbsence(w, n)).toBe(absent);
    });
    it('a phrase-count read that never settles is bounded and unreadable (never absent)', async () => {
        vi.useFakeTimers();
        try {
            const pending = observeCoachingPhrase(card({ [W]: { count: 'hang' } }), W);
            await vi.advanceTimersByTimeAsync(60_000);
            expect(await pending).toBe('unreadable');
        } finally { vi.useRealTimers(); }
    });
    it.each([[true, 'EXTERNAL'], [false, 'FAIL'], [null, 'HOLD']])('Focus producer: saved null + visible absence %s → visible = saved %s', async (visible, verdict) => {
        const outage = { verdict: 'EXTERNAL' as const, detail: 'd', external: 'provider_5xx' as const };
        const rows = await focusExternalDependentRows(outage, async () => ({ ok: true, raw: null }), visible as boolean | null);
        const row = rows.find((x) => x.step === 'Focus coaching visible = saved')!;
        expect([row.verdict, row.evidence?.visibleCoachingAbsent, row.evidence?.savedCoachingAbsent]).toEqual([verdict, visible, true]);
        expect(rows.find((x) => x.step === 'Focus coaching provenance')?.verdict).toBe('EXTERNAL'); // saved absence alone decides provenance
    });
    it('Open Mic wiring contract: the visible tri-state is read under EXTERNAL and gates "visible = saved" before successDependentRow', () => {
        const om = readFileSync(path.resolve(__dirname, '../live/rwt-open-mic-first-session.live.spec.ts'), 'utf8');
        const read = om.indexOf("visibleCoachingAbsence(await observeCoachingPhrase(card, 'review-what-went-well'), await observeCoachingPhrase(card, 'review-try-next'))");
        expect(read).toBeGreaterThan(-1);
        expect(read).toBeLessThan(om.indexOf("receipt.row('coaching visible = saved'"));
        expect(om).toContain("coachingParent.verdict === 'EXTERNAL' && visibleCoachingAbsent === false");
        expect(om).toContain("coachingParent.verdict === 'EXTERNAL' && visibleCoachingAbsent === null");
        expect(om).toContain('savedCoachingAbsent: !savedPresent, visibleCoachingAbsent });');
    });
    it.each([['missing', undefined], ['false', false], ['null', null]])('validator: a forged EXTERNAL visible = saved row with %s visible absence is refused, and so are the Analytics rows', (_l, v) => {
        const visibleRow = { ...external('coaching visible = saved'), evidence: { savedCoachingAbsent: true, ...(v === undefined ? {} : { visibleCoachingAbsent: v }) } };
        const errors = validateReceipt({ suite: 'open-mic-first-session', release: 'a'.repeat(40), rows: [pass('telemetry decodable'), provedParent('coaching rendered'),
            pass('coaching request bound to this take'), visibleRow, external('one practice action')],
            readback: { journeys: [{ journeyId: 'j', stages: ['x'] }], reportedJourneyIds: [] } }).errors.filter((e) => e.includes('EXTERNAL'));
        expect(errors).toEqual([
            'row "coaching visible = saved" is EXTERNAL without a confirmed visible absence of coaching (visibleCoachingAbsent)',
            'row "one practice action" is EXTERNAL but the take\'s saved-coaching absence is not proved (coaching visible = saved)',
        ]);
    });
});

describe('Codex P1 r4278164966 (PM 6182647772) — an answered failure is terminal: a retry after it is never a proved outage', () => {
    const ex = (o: { attemptId: string; clientAttempt: number; status: number | null; reason?: string }) => ({
        sent: { sessionId: 's', product: null, requestId: 'life-1', attemptId: o.attemptId, clientAttempt: o.clientAttempt, clientReleaseId: null },
        status: o.status,
        diagnostics: o.status === null ? null : { reason: o.reason ?? 'provider_http_5xx', provider_status: 503 },
        suggestions: null, clientMs: 1, at: 1,
    });
    const first503 = ex({ attemptId: 'a1', clientAttempt: 1, status: 502 });
    const second503 = ex({ attemptId: 'a2', clientAttempt: 2, status: 502 });
    it.each([['in order', [first503, second503]], ['reversed', [second503, first503]]])(
        'RED-case from the review: answered 503 at attempt 1, then 503 at attempt 2 (%s) → UNPROVEN', (_l, exchanges) => {
            const take = takeExchangeEvidence(exchanges);
            expect(take.unique).toBe(false);
            // …so the parent can never become EXTERNAL for the invalid retry (the request is not provably bound).
            const parent = coachingParentVerdict({ rendered: false, evidence: take.evidence, graceful: { ...graceful, requestBoundToSession: take.unique } });
            expect(parent.verdict).toBe('FAIL');
        });
    it.each([
        ['a single 503', [ex({ attemptId: 'a1', clientAttempt: 1, status: 502 })]],
        ['unanswered (network) then 503', [ex({ attemptId: 'a1', clientAttempt: 1, status: null }), second503]],
        ['425 pending then 503 at the same attempt', [ex({ attemptId: 'a1', clientAttempt: 1, status: 425, reason: 'focus_results_pending' }), ex({ attemptId: 'a1b', clientAttempt: 1, status: 502 })]],
    ])('%s → still proved, and the parent is EXTERNAL under its valid binding', (_l, exchanges) => {
        const take = takeExchangeEvidence(exchanges);
        expect(take).toMatchObject({ unique: true, evidence: { httpStatus: 502, reason: 'provider_http_5xx', providerStatus: 503 } });
        expect(coachingParentVerdict({ rendered: false, evidence: take.evidence, graceful: { ...graceful, requestBoundToSession: take.unique } }).verdict).toBe('EXTERNAL');
    });
});
