// @vitest-environment node
/**
 * #1258 — COACHING PROVIDER UNAVAILABILITY IS EXTERNAL (PO 2026-10-14; PM 6171519534, A+B+C with D1).
 *
 * A PROVED provider outage (request-bound provider 5xx with its integer status, or provider timeout) that the app handled
 * gracefully is EXTERNAL: non-blocking, named, never PASS — acceptance stays INCOMPLETE because successful coaching is
 * still unproven. Everything the app owns stays PASS/FAIL, and EXTERNAL can never hide a failed save, a missing or
 * disabled Try again, missing failure telemetry, a request/session mismatch, identity or cleanup errors.
 */
import { describe, expect, it } from 'vitest';
import {
    coachingParentVerdict, failureTelemetryBinding, coachingRequestBindingRow, coachingTelemetryVerdict, focusExternalDependentRows,
    gracefulFailures, provenExternalOutcome, providerStatusFrom, successDependentRow, takeExchangeEvidence,
    type CoachingFailureEvidence, type GracefulDegradation,
} from '../live/helpers/coachingExternal';
import { CoachingGenerationTap } from '../live/helpers/coachingGenerationTap';
import { readCoachingFailureEvidence, readCoachingFailureReason } from '../live/helpers/rwtJourney';
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
        expect(coachingTelemetryVerdict(parent(provider503), 'bound', 'FAIL', 'x').verdict).toBe('EXTERNAL');
    });
    it('9. under EXTERNAL an absent, invalid or unbindable report stays FAIL; an ambiguous one is unproven (HOLD)', () => {
        for (const f of ['absent', 'invalid', 'unbindable'] as const) expect(coachingTelemetryVerdict(parent(provider503), f, 'FAIL', 'x').verdict).toBe('FAIL');
        expect(coachingTelemetryVerdict(parent(provider503), 'ambiguous', 'FAIL', 'x').verdict).toBe('HOLD');
    });
    it('without an EXTERNAL parent the success verdict is unchanged (success events are never assumed)', () => {
        expect(coachingTelemetryVerdict(parent(provider503, graceful, true), 'bound', 'FAIL', 'missing').verdict).toBe('FAIL');
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
        expect(coachingTelemetryVerdict(parent(provider503), failureTelemetryBinding(events, 'req-1'), 'FAIL', 'x').verdict).toBe('EXTERNAL');
    });
    it('RED-case: the diagnostic is present but the app failure report never left → absent → FAIL (never EXTERNAL)', () => {
        i = 0;
        expect(failureTelemetryBinding([diag('req-1')], 'req-1')).toBe('absent');
        expect(coachingTelemetryVerdict(parent(provider503), 'absent', 'FAIL', 'x').verdict).toBe('FAIL');
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
        const rows = rowsOf(await focusExternalDependentRows(parent(provider503), async () => ({ ok: true, well: 'Saved well.', next: 'Saved next.' })));
        expect(rows['Focus coaching visible = saved']).toBe('FAIL');
        expect(rows['Focus coaching provenance']).toBe('FAIL');
    });
    it('a PARTIAL saved pair is also FAIL', async () => {
        const rows = rowsOf(await focusExternalDependentRows(parent(provider503), async () => ({ ok: true, well: 'Only one.', next: '' })));
        expect(rows['Focus coaching visible = saved']).toBe('FAIL');
    });
    it('an UNREADABLE saved row (error or throw) is HOLD — absence unproven', async () => {
        expect(rowsOf(await focusExternalDependentRows(parent(provider503), async () => ({ ok: false })))['Focus coaching visible = saved']).toBe('HOLD');
        expect(rowsOf(await focusExternalDependentRows(parent(provider503), async () => { throw new Error('db'); }))['Focus coaching provenance']).toBe('HOLD');
    });
    it('a confirmed ABSENCE lets every success-dependent row be "not exercised"', async () => {
        const rows = await focusExternalDependentRows(parent(provider503), async () => ({ ok: true, well: '', next: '' }));
        expect(rows).toHaveLength(6);
        expect(rows.every((r) => r.verdict === 'EXTERNAL')).toBe(true);
    });
    it('no EXTERNAL parent → no rows are written here (the success path judges them)', async () => {
        expect(await focusExternalDependentRows(parent(provider503, { ...graceful, retryEnabled: false }), async () => ({ ok: true, well: '', next: '' }))).toEqual([]);
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
        humanRow('open_mic_coaching_relevant'), humanRow('open_mic_uh_detected'), external('coaching rendered'),
    ];
    const rows = [...base, ...requiredAutomatedRows(SUITE)!.product.filter((s) => !base.some((r) => r.step === s))
        .map((s) => (s === 'base_q4 primary' ? { step: s, verdict: 'HOLD' as const, detail: 'p' } : pass(s)))];
    const receipt = { suite: SUITE, release: SHA, meta: { fixtureKind: 'synthetic' }, rows,
        readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: [], missingBindings: [] } };
    const worksheet = () => parseHumanWorksheet(humanWorksheet(SUITE, SHA, [J], rows).split('\n')
        .map((l) => (l.startsWith('| `open_mic_') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-10-14 |') : l)).join('\n'));

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
        expect(r.external.map((e) => e.step)).toEqual(['coaching rendered']);
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
