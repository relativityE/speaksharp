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
    /** The page's raw terminal vocabulary; a failed chain can be received without coaching having succeeded. */
    outcome: 'success' | 'failure';
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
    source: unknown;
    providerAttempts: unknown;
    clientReleaseId: unknown;
    coachingDiagnosticId: unknown;
    /** #1258 smoke item 3 (PM 6182446740): PostHog's event `uuid` and the page's `client_attempt` — identity diagnostics only. */
    uuid?: unknown;
    clientAttempt?: unknown;
}

/**
 * #1258 smoke item 3 (PM 6182446740) — the IDENTITY of the bound request's terminal rows, content-free: counts and closed
 * values only, never a raw id. It does not change the verdict or the exactly-once rule.
 *  - `repeated_event_identity`: some terminal rows share one event uuid — a repeated record of the same event. Which layer
 *    repeated it (SDK, transport, ingestion, or a duplicating query) is NOT established by this.
 *  - `distinct_records_one_attempt`: distinct uuids, one attempt id — distinct records for one attempt; the layer that
 *    created them is not established either.
 *  - `distinct_attempts`: distinct uuids across more than one attempt id.
 *  - `unknown`: a uuid or attempt id is missing or malformed on ANY terminal row (one row included), so identity cannot be
 *    decided. Both ids must be the emitted UUID form (`crypto.randomUUID()`), case-normalized; whitespace is malformed.
 *  - `single`: exactly one terminal row with valid identity; `none`: no terminal row.
 */
export type TerminalIdentityClass = 'none' | 'single' | 'repeated_event_identity' | 'distinct_records_one_attempt' | 'distinct_attempts' | 'unknown';
export interface TerminalIdentity {
    terminalRows: number;
    distinctEventUuids: number; missingEventUuid: number;
    distinctAttemptIds: number; missingAttemptId: number;
    /** Each terminal row's closed outcome and client attempt (1–9, else `missing`), in received order. */
    rows: Array<{ outcome: string; clientAttempt: number | 'missing' }>;
    classification: TerminalIdentityClass;
}
const EVENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function terminalIdentity(terminal: readonly ReceivedCoachingRow[]): TerminalIdentity {
    const uuids = terminal.map((r) => (typeof r.uuid === 'string' && EVENT_UUID.test(r.uuid) ? r.uuid.toLowerCase() : null));
    // PM 6182647952 §3: the attempt id is the page's `crypto.randomUUID()` — anything else is malformed, never an identity.
    const attempts = terminal.map((r) => (typeof r.attemptId === 'string' && EVENT_UUID.test(r.attemptId) ? r.attemptId.toLowerCase() : null));
    const missingEventUuid = uuids.filter((u) => u === null).length;
    const missingAttemptId = attempts.filter((a) => a === null).length;
    const distinctEventUuids = new Set(uuids.filter((u): u is string => u !== null)).size;
    const distinctAttemptIds = new Set(attempts.filter((a): a is string => a !== null)).size;
    const classification: TerminalIdentityClass = terminal.length === 0 ? 'none'
        : missingEventUuid > 0 || missingAttemptId > 0 ? 'unknown'
            : terminal.length === 1 ? 'single'
            : distinctEventUuids < terminal.length ? 'repeated_event_identity'
                : distinctAttemptIds === 1 ? 'distinct_records_one_attempt' : 'distinct_attempts';
    return {
        terminalRows: terminal.length, distinctEventUuids, missingEventUuid, distinctAttemptIds, missingAttemptId,
        rows: terminal.map((r) => ({
            outcome: String(r.outcome),
            clientAttempt: Number.isInteger(r.clientAttempt) && Number(r.clientAttempt) >= 1 && Number(r.clientAttempt) <= 9 ? Number(r.clientAttempt) : 'missing',
        })),
        classification,
    };
}

export type CoachingReceiptReason =
    | 'diagnostic_not_received' | 'observed_model_missing' | 'feedback_not_received'
    | 'duplicate_terminal_diagnostic' | 'attempt_mismatch' | 'outcome_mismatch' | 'product_mismatch'
    | 'configured_model_mismatch' | 'release_mismatch' | 'status_incoherent' | 'provenance_incoherent'
    | 'report_link_mismatch' | 'report_link_missing';

export const COACHING_RECEIPT_REASONS: readonly CoachingReceiptReason[] = [
    'diagnostic_not_received', 'observed_model_missing', 'feedback_not_received',
    'duplicate_terminal_diagnostic', 'attempt_mismatch', 'outcome_mismatch', 'product_mismatch',
    'configured_model_mismatch', 'release_mismatch', 'status_incoherent', 'provenance_incoherent',
    'report_link_mismatch', 'report_link_missing',
];
/** Missing-evidence reasons: the only reasons a HOLD may carry. Every other reason is a contradiction (FAIL). */
export const COACHING_RECEIPT_HOLD_REASONS: ReadonlySet<CoachingReceiptReason> = new Set(['diagnostic_not_received', 'observed_model_missing', 'feedback_not_received']);
const HOLD_REASONS = COACHING_RECEIPT_HOLD_REASONS;
const TERMINAL = new Set(['success', 'failure', 'network_failure']);
const SHA64 = /^[0-9a-f]{64}$/;

/** A received HTTP status: an integer in 100–599, or `null` when absent. Anything else is malformed (never "none"). */
const httpStatus = (v: unknown): number | null | 'malformed' =>
    (v === null || v === undefined ? null : Number.isInteger(v) && Number(v) >= 100 && Number(v) <= 599 ? Number(v) : 'malformed');
const is2xx = (v: number | null | 'malformed') => typeof v === 'number' && v >= 200 && v < 300;

export function validExpectation(value: unknown): value is CoachingDiagnosticExpectation {
    const e = value as Partial<CoachingDiagnosticExpectation> | null;
    return !!e && typeof e === 'object' && !Array.isArray(e)
        && typeof e.requestSha256 === 'string' && SHA64.test(e.requestSha256)
        && typeof e.attemptSha256 === 'string' && SHA64.test(e.attemptSha256)
        && (e.product === 'open_mic' || e.product === 'focus_points')
        && typeof e.configuredModel === 'string' && e.configuredModel.length > 0
        && (e.outcome === 'success' || e.outcome === 'failure');
}

export function evaluateCoachingDiagnosticReceipt(
    rows: readonly ReceivedCoachingRow[],
    expected: CoachingDiagnosticExpectation,
    releaseSha: string,
    sha256: (value: string) => string,
): {
    verdict: CoachingReceiptVerdict; reasons: CoachingReceiptReason[]; diagnosticsForRequest: number; feedbackOutcomes: number;
    /** Diagnostic only (smoke item 3): never part of the verdict. */
    terminalIdentity: TerminalIdentity;
    /** The exact binding this verdict was computed for, so finalization can refuse a result about anything else. */
    release: string; expected: CoachingDiagnosticExpectation;
} {
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
        // Failure settlement is new: require positive release binding, not merely absence of a conflicting string.
        if (expected.outcome === 'failure' && t.clientReleaseId !== releaseSha) reasons.add('release_mismatch');
        // Endpoint and provider stay separate: a success is a 2xx ENDPOINT answer, and its provider provenance must be
        // coherent with its source — FRESH: at least one provider attempt and a 2xx provider response; CACHE: no provider
        // call and no provider status. A malformed status or an unknown source is never read as "no provider".
        const endpoint = httpStatus(t.status);
        const provider = httpStatus(t.providerStatus);
        if (t.outcome === 'success' && !is2xx(endpoint)) reasons.add('status_incoherent');
        if (t.outcome === 'success') {
            const attempts = Number.isInteger(t.providerAttempts) ? Number(t.providerAttempts) : null;
            const fresh = t.source === 'fresh' && attempts !== null && attempts >= 1 && is2xx(provider);
            const cache = t.source === 'cache' && attempts === 0 && provider === null;
            if (!fresh && !cache) reasons.add('provenance_incoherent');
        }
        if (t.outcome === 'failure') {
            const isError = (v: number | null | 'malformed') => typeof v === 'number' && v >= 400 && v < 600;
            if (!isError(endpoint)) reasons.add('status_incoherent');
            const attempts = Number.isInteger(t.providerAttempts) ? Number(t.providerAttempts) : null;
            // A fresh failed provider leg may never answer, time out after 2xx headers, return an error, or produce an
            // invalid 2xx body / fail persistence. A refusal before the provider has no provider status or attempts.
            // This is the closed union of answered failure shapes; readback does not prove the exact server reason.
            const fresh = t.source === 'fresh' && attempts !== null && attempts >= 1
                && typeof endpoint === 'number' && endpoint >= 500 && endpoint < 600
                && (provider === null || is2xx(provider) || isError(provider));
            const refusal = t.source === 'unknown' && attempts === 0 && provider === null;
            if (!fresh && !refusal) reasons.add('provenance_incoherent');
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
    return {
        verdict, reasons: list, diagnosticsForRequest: forRequest.length, feedbackOutcomes: stored.length, release: releaseSha, expected: { ...expected },
        terminalIdentity: terminalIdentity(terminal),
    };
}

/**
 * The verdict and its reasons must agree (PM RETURN 6115229273): PASS carries no reason; HOLD carries only
 * missing-evidence reasons; FAIL carries at least one contradiction. Anything else is malformed.
 */
export function coherentCoachingResult(verdict: unknown, reasons: unknown): boolean {
    if (!Array.isArray(reasons) || reasons.some((r) => !COACHING_RECEIPT_REASONS.includes(r as CoachingReceiptReason))) return false;
    const list = reasons as CoachingReceiptReason[];
    if (verdict === 'PASS') return list.length === 0;
    if (verdict === 'HOLD') return list.length > 0 && list.every((r) => HOLD_REASONS.has(r));
    if (verdict === 'FAIL') return list.some((r) => !HOLD_REASONS.has(r));
    return false;
}
