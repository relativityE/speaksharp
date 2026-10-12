// @vitest-environment node
/**
 * #1258 H1 (PM 6115110576): the feedback diagnostic chain is settled ONLY by an independent PostHog readback of the
 * RECEIVED `ai_coaching_diagnostic` and `feedback_submit` events, bound to the digests of the ids the page SENT. Matching
 * received proof → PASS; missing → HOLD; contradiction → FAIL. The in-run adapter's FAIL is never rewritten, and generic
 * journey qualification never promotes the row.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    evaluateCoachingDiagnosticReceipt, validExpectation, type CoachingDiagnosticExpectation, type ReceivedCoachingRow,
} from '../../frontend/src/services/telemetry/coachingDiagnosticReceipt';
import { finalizeReceipt, humanWorksheet, parseHumanWorksheet, requiredAutomatedRows, type ReceiptRow } from '../live/helpers/rwtAcceptance';

const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
const RELEASE = 'b'.repeat(40);
const REQ = '33333333-3333-4333-8333-333333333333';
const ATT = '44444444-4444-4444-8444-444444444444';
const OTHER_REQ = '77777777-7777-4777-8777-777777777777';
const OTHER_ATT = '88888888-8888-4888-8888-888888888888';
const MODEL = 'gemini-3.6-flash';
const expected: CoachingDiagnosticExpectation = { requestSha256: sha(REQ), attemptSha256: sha(ATT), product: 'open_mic', configuredModel: MODEL, outcome: 'success' };

const diag = (over: Partial<ReceivedCoachingRow> = {}): ReceivedCoachingRow => ({
    event: 'ai_coaching_diagnostic', requestId: REQ, attemptId: ATT, outcome: 'success', product: 'open_mic', configuredModel: MODEL,
    observedModel: `${MODEL}-001`, status: 200, providerStatus: 200, source: 'fresh', providerAttempts: 1, clientReleaseId: RELEASE, coachingDiagnosticId: null, ...over,
});
const feedback = (over: Partial<ReceivedCoachingRow> = {}): ReceivedCoachingRow => ({
    event: 'feedback_submit', requestId: null, attemptId: null, outcome: 'storage_ok', product: null, configuredModel: null,
    observedModel: null, status: null, providerStatus: null, source: null, providerAttempts: null, clientReleaseId: null, coachingDiagnosticId: REQ, ...over,
});
const judge = (rows: ReceivedCoachingRow[]) => evaluateCoachingDiagnosticReceipt(rows, expected, RELEASE, sha);

describe('#1258 H1 received coaching-diagnostic chain', () => {
    it('GREEN: one terminal diagnostic for the sent request/attempt + the feedback outcome linked to it → PASS', () => {
        expect(judge([diag(), feedback()])).toMatchObject({ verdict: 'PASS', reasons: [] });
    });

    it('GREEN: a cache success (provider never called) and an intermediate retry both still PASS', () => {
        expect(judge([diag({ source: 'cache', providerAttempts: 0, providerStatus: null }), feedback()]).verdict).toBe('PASS');
        expect(judge([diag({ outcome: 'retrying', attemptId: OTHER_ATT, status: 425 }), diag(), feedback()]).verdict).toBe('PASS');
    });

    it.each([
        ['no diagnostic received at all', [feedback()], 'diagnostic_not_received'],
        ['only a diagnostic for ANOTHER request', [diag({ requestId: OTHER_REQ }), feedback()], 'diagnostic_not_received'],
        ['no feedback outcome received', [diag()], 'feedback_not_received'],
        ['a success with no provider-reported model', [diag({ observedModel: null }), feedback()], 'observed_model_missing'],
    ])('MISSING is HOLD, never PASS: %s', (_l, rows, reason) => {
        expect(judge(rows as ReceivedCoachingRow[])).toMatchObject({ verdict: 'HOLD', reasons: [reason] });
    });

    it.each([
        ['wrong attempt', [diag({ attemptId: OTHER_ATT }), feedback()], 'attempt_mismatch'],
        ['wrong product', [diag({ product: 'focus_points' }), feedback()], 'product_mismatch'],
        ['wrong configured model', [diag({ configuredModel: 'gemini-3.8-flash' }), feedback()], 'configured_model_mismatch'],
        ['wrong release', [diag({ clientReleaseId: 'c'.repeat(40) }), feedback()], 'release_mismatch'],
        ['an observed failure where the run caused a success', [diag({ outcome: 'failure', status: 502 }), feedback()], 'outcome_mismatch'],
        ['endpoint/provider status incoherent with success', [diag({ status: 502 }), feedback()], 'status_incoherent'],
        ['FRESH success with no provider status', [diag({ providerStatus: null }), feedback()], 'provenance_incoherent'],
        ['FRESH success with no provider attempt', [diag({ providerAttempts: 0 }), feedback()], 'provenance_incoherent'],
        ['FRESH success with a non-2xx provider status', [diag({ providerStatus: 503 }), feedback()], 'provenance_incoherent'],
        ['a MALFORMED provider status is never read as "no provider"', [diag({ source: 'cache', providerAttempts: 0, providerStatus: 'ok' }), feedback()], 'provenance_incoherent'],
        ['CACHE success that claims a provider status', [diag({ source: 'cache', providerAttempts: 0, providerStatus: 200 }), feedback()], 'provenance_incoherent'],
        ['CACHE success that claims a provider attempt', [diag({ source: 'cache', providerAttempts: 1, providerStatus: null }), feedback()], 'provenance_incoherent'],
        ['an unknown source', [diag({ source: 'unknown' }), feedback()], 'provenance_incoherent'],
        ['duplicate terminal evidence for the request', [diag(), diag(), feedback()], 'duplicate_terminal_diagnostic'],
        ['ambiguous terminal evidence (two attempts)', [diag(), diag({ attemptId: OTHER_ATT }), feedback()], 'duplicate_terminal_diagnostic'],
        ['the feedback outcome linked to a DIFFERENT request', [diag(), feedback({ coachingDiagnosticId: OTHER_REQ })], 'report_link_mismatch'],
        ['the feedback outcome carries no link', [diag(), feedback({ coachingDiagnosticId: null })], 'report_link_missing'],
    ])('CONTRADICTION is FAIL: %s', (_l, rows, reason) => {
        const out = judge(rows as ReceivedCoachingRow[]);
        expect(out.verdict).toBe('FAIL');
        expect(out.reasons).toContain(reason);
    });

    it('the result names the exact release and binding it was computed for', () => {
        expect(judge([diag(), feedback()])).toMatchObject({ release: RELEASE, expected });
    });

    it('the output is closed codes, counts and digests — never an id', () => {
        const text = JSON.stringify(judge([diag(), feedback({ coachingDiagnosticId: OTHER_REQ })]));
        for (const raw of [REQ, ATT, OTHER_REQ]) expect(text).not.toContain(raw);
    });

    it('an expectation is only ever digests of the sent ids, the product and the configured model', () => {
        expect(validExpectation(expected)).toBe(true);
        expect(validExpectation({ ...expected, requestSha256: REQ })).toBe(false);
        expect(validExpectation({ ...expected, product: 'unknown' })).toBe(false);
        expect(validExpectation(null)).toBe(false);
    });
});

// ── Finalization: the received verdict settles ONLY an eligible feedback diagnostic chain row ─────────────────────
const SUITE = 'open-mic-first-session';
const J = 'journey-rec';
const STAGES = ['session_during', 'session_after_open_mic', 'share_feedback', 'analytics_inventory', 'session_pdf_export'];
const pass = (step: string): ReceiptRow => ({ step, verdict: 'PASS', detail: 'ok' });
const hold = (step: string): ReceiptRow => ({ step, verdict: 'HOLD', detail: 'pending' });
const humans = ['open_mic_coaching_relevant', 'open_mic_uh_detected'].map((id): ReceiptRow => ({
    step: `human: ${id}`, verdict: 'HUMAN', detail: 'named human RWT observation', evidence: { observationId: id, runbookRow: 'row', passCriterion: 'c', recorded: 'pending' },
}));
const binding = { expectedRequestSha256: sha(REQ), expectedAttemptSha256: sha(ATT), expectedProduct: 'open_mic', expectedConfiguredModel: MODEL, expectedOutcome: 'success' };
const chain = (row: Partial<ReceiptRow>): ReceiptRow => ({ step: 'feedback diagnostic chain', verdict: 'HOLD', detail: 'the chain is incomplete',
    evidence: { reasons: 'telemetry_not_received', echoMismatches: 0, ...binding }, ...row });
const receiptWith = (chainRow: ReceiptRow) => {
    const rows: ReceiptRow[] = [
        pass('telemetry decodable'), pass('signup-stage telemetry (user class)'), pass('receipt content-free'), hold('signup-stage telemetry received'),
        pass('journey telemetry (canary class)'), hold('journey telemetry received'),
        ...requiredAutomatedRows(SUITE)!.product.filter((s) => s !== 'feedback diagnostic chain').map((s) => (s === 'base_q4 primary' ? hold(s) : pass(s))),
        chainRow, ...humans,
    ];
    return { suite: SUITE, release: RELEASE, meta: { fixtureKind: 'synthetic' }, rows,
        readback: { journeys: [{ journeyId: J, stages: STAGES }], reportedJourneyIds: ['other'], missingBindings: [] } };
};
const worksheet = (r: { rows: ReceiptRow[] }) => parseHumanWorksheet(humanWorksheet(SUITE, RELEASE, [J, 'other'], r.rows).split('\n')
    .map((l) => (l.startsWith('| `open_mic_') ? l.replace(/\| {2}\| {2}\|$/, '| PASS | PO · 2026-09-28 |') : l)).join('\n'));
const readback = (coachingDiagnostic?: unknown) => ({ suite: SUITE, release: RELEASE, journeys: [{ journeyId: J, stages: STAGES, verdict: 'QUALIFIED' }],
    missingBindings: [], ...(coachingDiagnostic === undefined ? {} : { coachingDiagnostic }) });
/** A received result bound to this receipt's release and exact sent-boundary binding, as the readback writes it. */
const bound = (verdict: string, reasons: string[], over: { release?: string; expected?: Record<string, unknown> } = {}) => ({
    verdict, reasons, release: RELEASE, expected: { ...expected }, ...over,
});
const finalize = (chainRow: ReceiptRow, coachingDiagnostic?: unknown) => {
    const r = receiptWith(chainRow);
    const out = finalizeReceipt(r, worksheet(r), readback(coachingDiagnostic));
    return { ...out, chain: out.rows.find((x) => x.step === 'feedback diagnostic chain') };
};

describe('#1258 H1 finalization settles the feedback diagnostic chain from the received readback only', () => {
    it('GREEN: binding + received PASS → the row PASSes and the run finalizes PASS', () => {
        const out = finalize(chain({}), bound('PASS', []));
        expect(out.chain).toMatchObject({ verdict: 'PASS', evidence: { settledByReadback: true, receivedReasons: 'none' } });
        expect(out).toMatchObject({ status: 'final', finalAcceptance: 'PASS' });
    });

    it('received FAIL → FAIL; received HOLD → INCOMPLETE', () => {
        expect(finalize(chain({}), bound('FAIL', ['attempt_mismatch']))).toMatchObject({ finalAcceptance: 'FAIL', chain: { verdict: 'FAIL' } });
        expect(finalize(chain({}), bound('HOLD', ['feedback_not_received']))).toMatchObject({ finalAcceptance: 'INCOMPLETE', chain: { verdict: 'HOLD' } });
    });

    it('CASUALTY: generic journey qualification alone (no received chain) never promotes the row', () => {
        expect(finalize(chain({}))).toMatchObject({ finalAcceptance: 'INCOMPLETE', chain: { verdict: 'HOLD' } });
    });

    it('CASUALTY: an in-run adapter FAIL is preserved even when the readback PASSes', () => {
        const failed = chain({ verdict: 'FAIL', evidence: { reasons: 'request_mismatch', echoMismatches: 1 } });
        expect(finalize(failed, bound('PASS', []))).toMatchObject({ finalAcceptance: 'FAIL', chain: { verdict: 'FAIL' } });
    });

    it('CASUALTY: a HOLD for any other reason, or without the sent-boundary binding, is never settled', () => {
        // Another HOLD reason: the row is never settled, whatever the received result says.
        expect(finalize(chain({ evidence: { reasons: 'request_link_missing', echoMismatches: 0, ...binding } }), bound('PASS', [])).chain!.verdict).toBe('HOLD');
        // No binding on the row: a bound PASS cannot match it — a binding error, never PASS.
        const unboundRow = finalize(chain({ evidence: { reasons: 'telemetry_not_received', echoMismatches: 0 } }), bound('PASS', []));
        expect(unboundRow.status).toBe('binding_error');
        expect(unboundRow.finalAcceptance).not.toBe('PASS');
    });

    it.each([
        ['a PASS for ANOTHER request (same suite and release)', bound('PASS', [], { expected: { ...expected, requestSha256: sha(OTHER_REQ) } })],
        ['a PASS for ANOTHER attempt', bound('PASS', [], { expected: { ...expected, attemptSha256: sha(OTHER_ATT) } })],
        ['a PASS for another product', bound('PASS', [], { expected: { ...expected, product: 'focus_points' } })],
        ['a PASS for another configured model', bound('PASS', [], { expected: { ...expected, configuredModel: 'gemini-3.8-flash' } })],
        ['a PASS for another outcome', bound('PASS', [], { expected: { ...expected, outcome: 'failure' } })],
        ['a PASS with an extra binding field', bound('PASS', [], { expected: { ...expected, sessionId: 'x' } })],
        ['a PASS for another release', bound('PASS', [], { release: 'c'.repeat(40) })],
        ['a PASS with no binding at all', { verdict: 'PASS', reasons: [] }],
        ['a FAIL with no binding at all', { verdict: 'FAIL', reasons: ['attempt_mismatch'] }],
        ['a PASS carrying a contradiction reason', bound('PASS', ['attempt_mismatch'])],
        ['a HOLD carrying a contradiction reason', bound('HOLD', ['product_mismatch'])],
        ['a FAIL with only missing-evidence reasons', bound('FAIL', ['feedback_not_received'])],
        ['an empty HOLD', bound('HOLD', [])],
        ['an unknown reason', bound('PASS', ['made_up'])],
        ['an unknown verdict', bound('QUALIFIED', [])],
        ['an unexpected field', { ...bound('PASS', []), note: 'x' }],
        ['null', null],
    ])('CASUALTY: %s → binding error, never PASS', (_l, result) => {
        const out = finalize(chain({}), result);
        expect(out.status).toBe('binding_error');
        expect(out.finalAcceptance).not.toBe('PASS');
    });

    it('an UNBOUND HOLD (the readback produced no result) is valid but never settles the row', () => {
        const out = finalize(chain({}), { verdict: 'HOLD', reasons: ['diagnostic_not_received'] });
        expect(out).toMatchObject({ status: 'final', finalAcceptance: 'INCOMPLETE', chain: { verdict: 'HOLD' } });
        expect(out.chain!.evidence?.settledByReadback).toBeUndefined();
    });
});
