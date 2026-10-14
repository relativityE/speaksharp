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
    coachingParentVerdict, coachingTelemetryVerdict, gracefulFailures, provenExternalOutcome, providerStatusFrom, successDependentRow,
    type CoachingFailureEvidence, type GracefulDegradation,
} from '../live/helpers/coachingExternal';
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
    const none = { requested: 0, completed: 0, persisted: 0, rendered: 0, failed: 0, reviewRenderedStage: 0 };
    it('8. under EXTERNAL the failure path (requested + failed) must have left the page → EXTERNAL', () => {
        expect(coachingTelemetryVerdict(parent(provider503), { ...none, requested: 1, failed: 1 }, 'FAIL', 'x').verdict).toBe('EXTERNAL');
    });
    it.each([
        ['no failed event', { requested: 1, failed: 0 }],
        ['no requested event', { requested: 0, failed: 1 }],
    ])('9. under EXTERNAL a missing failure event stays FAIL: %s', (_label, sent) => {
        expect(coachingTelemetryVerdict(parent(provider503), { ...none, ...sent }, 'FAIL', 'x').verdict).toBe('FAIL');
    });
    it('without an EXTERNAL parent the success verdict is unchanged (success events are never assumed)', () => {
        expect(coachingTelemetryVerdict(parent(provider503, graceful, true), none, 'FAIL', 'missing').verdict).toBe('FAIL');
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
