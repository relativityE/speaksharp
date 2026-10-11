/**
 * #1258 H1 (PM 6115110576) — the RECEIVED coaching-diagnostic chain, judged from the PostHog readback.
 *
 * The run's receipt names what it caused, as SHA-256 digests of the ids the page SENT (never the ids themselves): the
 * coaching request and its terminal attempt, plus the product and the configured model. This gate reads what PostHog
 * actually received for the run's own identity and release — the `ai_coaching_diagnostic` events and the Share Feedback
 * `feedback_submit` outcome — and decides:
 *  - PASS: exactly one terminal diagnostic for the expected request, bound to the expected attempt/product/model/release,
 *    with endpoint and provider status coherent for its outcome; and a received storage-success feedback outcome whose
 *    `coaching_diagnostic_id` is that same request;
 *  - HOLD: the diagnostic or the feedback outcome was not received (or an observed model is absent) — missing evidence;
 *  - FAIL: anything received that contradicts the run (another attempt, product, model or release; duplicate or ambiguous
 *    terminal evidence; a feedback outcome linked to a different request or to none).
 * Only digests are compared; the output is closed reason codes.
 */
export type CoachingReceiptVerdict = 'PASS' | 'FAIL' | 'HOLD';

export interface CoachingDiagnosticExpectation {
    requestSha256: string;
    attemptSha256: string;
    product: 'open_mic' | 'focus_points';
    configuredModel: string;
    outcome: 'success';
}

/** One received row, as the readback query returns it (raw; validated here, never trusted). */
export interface ReceivedCoachingRow {
    event: unknown;
    requestId: unknown;
    attemptId: unknown;
    outcome: unknown;
    product: unknown;
    configuredModel: unknown;
    observedModel: unknown;
    status: unknown;
    providerStatus: unknown;
    clientReleaseId: unknown;
    coachingDiagnosticId: unknown;
}

export type CoachingReceiptReason =
    | 'diagnostic_not_received' | 'observed_model_missing' | 'feedback_not_received'
    | 'duplicate_terminal_diagnostic' | 'attempt_mismatch' | 'outcome_mismatch' | 'product_mismatch'
    | 'configured_model_mismatch' | 'release_mismatch' | 'status_incoherent'
    | 'report_link_mismatch' | 'report_link_missing';

export const COACHING_RECEIPT_REASONS: readonly CoachingReceiptReason[] = [
    'diagnostic_not_received', 'observed_model_missing', 'feedback_not_received',
    'duplicate_terminal_diagnostic', 'attempt_mismatch', 'outcome_mismatch', 'product_mismatch',
    'configured_model_mismatch', 'release_mismatch', 'status_incoherent',
    'report_link_mismatch', 'report_link_missing',
];
const HOLD_REASONS: ReadonlySet<CoachingReceiptReason> = new Set(['diagnostic_not_received', 'observed_model_missing', 'feedback_not_received']);
const TERMINAL = new Set(['success', 'failure', 'network_failure']);
const SHA64 = /^[0-9a-f]{64}$/;

const statusClass = (v: unknown): '2xx' | '4xx' | '5xx' | 'none' => {
    if (!Number.isInteger(v)) return 'none';
    const s = Number(v);
    return s >= 200 && s < 300 ? '2xx' : s >= 400 && s < 500 ? '4xx' : s >= 500 && s < 600 ? '5xx' : 'none';
};

export function validExpectation(value: unknown): value is CoachingDiagnosticExpectation {
    const e = value as Partial<CoachingDiagnosticExpectation> | null;
    return !!e && typeof e === 'object' && !Array.isArray(e)
        && typeof e.requestSha256 === 'string' && SHA64.test(e.requestSha256)
        && typeof e.attemptSha256 === 'string' && SHA64.test(e.attemptSha256)
        && (e.product === 'open_mic' || e.product === 'focus_points')
        && typeof e.configuredModel === 'string' && e.configuredModel.length > 0
        && e.outcome === 'success';
}

export function evaluateCoachingDiagnosticReceipt(
    rows: readonly ReceivedCoachingRow[],
    expected: CoachingDiagnosticExpectation,
    releaseSha: string,
    sha256: (value: string) => string,
): { verdict: CoachingReceiptVerdict; reasons: CoachingReceiptReason[]; diagnosticsForRequest: number; feedbackOutcomes: number } {
    const reasons = new Set<CoachingReceiptReason>();
    const digest = (v: unknown) => (typeof v === 'string' && v.length > 0 ? sha256(v) : null);

    const forRequest = rows.filter((r) => r.event === 'ai_coaching_diagnostic' && digest(r.requestId) === expected.requestSha256);
    const terminal = forRequest.filter((r) => typeof r.outcome === 'string' && TERMINAL.has(r.outcome));
    if (terminal.length === 0) reasons.add('diagnostic_not_received');
    else if (terminal.length > 1) reasons.add('duplicate_terminal_diagnostic');
    else {
        const t = terminal[0];
        if (digest(t.attemptId) !== expected.attemptSha256) reasons.add('attempt_mismatch');
        if (t.outcome !== expected.outcome) reasons.add('outcome_mismatch');
        if (t.product !== expected.product) reasons.add('product_mismatch');
        if (t.configuredModel !== expected.configuredModel) reasons.add('configured_model_mismatch');
        if (typeof t.clientReleaseId === 'string' && t.clientReleaseId !== releaseSha) reasons.add('release_mismatch');
        // Endpoint and provider classes stay separate: a success is a 2xx endpoint answer whose provider leg either
        // answered 2xx (fresh) or was never called (cache: no provider status).
        if (t.outcome === 'success' && (statusClass(t.status) !== '2xx' || !['2xx', 'none'].includes(statusClass(t.providerStatus)))) {
            reasons.add('status_incoherent');
        }
        if (t.outcome === 'success' && !(typeof t.observedModel === 'string' && t.observedModel.length > 0)) reasons.add('observed_model_missing');
    }

    const stored = rows.filter((r) => r.event === 'feedback_submit' && r.outcome === 'storage_ok');
    const linked = stored.map((r) => digest(r.coachingDiagnosticId));
    if (stored.length === 0) reasons.add('feedback_not_received');
    else if (linked.some((d) => d !== null && d !== expected.requestSha256)) reasons.add('report_link_mismatch');
    else if (!linked.includes(expected.requestSha256)) reasons.add('report_link_missing');

    const list = [...reasons];
    const verdict: CoachingReceiptVerdict = list.length === 0 ? 'PASS' : list.some((r) => !HOLD_REASONS.has(r)) ? 'FAIL' : 'HOLD';
    return { verdict, reasons: list, diagnosticsForRequest: forRequest.length, feedbackOutcomes: stored.length };
}
