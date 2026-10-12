/**
 * #1258 (PM 6114590729) — adapter from the #1589 coaching diagnostics to the #1590 feedback-diagnostic contract.
 *
 * Inputs are what the run itself observed: the generation exchanges captured at the request boundary
 * (`CoachingGenerationTap`: the ids the page sent + the Edge `diagnostics` it answered) and the stored Share Feedback
 * report read back by id. The request → session binding comes from the request the page SENT, never from tap order or
 * from the report. The adapter only maps; `validateFeedbackDiagnostics` judges. A shape it cannot map is returned as an
 * unmappable record so the contract FAILs it, rather than being dropped.
 */
import type { CoachingExchange } from './coachingGenerationTap';
import { createHash } from 'node:crypto';
import { validateFeedbackDiagnostics } from './feedbackDiagnosticContract';
import type {
    AiRequestDiagnostic, AiRequestOutcome, DiagnosticExpectation, FeedbackDiagnosticLookup, FeedbackReportDiagnostic,
    ReportAssociation, ReportStorage,
} from './feedbackDiagnosticContract';

type StatusClass = AiRequestDiagnostic['statusClass'];

const PROVIDER_ERROR = new Set(['provider_http_4xx', 'provider_http_5xx']);
const INVALID_RESPONSE = new Set(['missing_text', 'invalid_shape', 'over_character_ceiling', 'missing_model_version']);
const SERVER_ERROR = new Set(['invalid_request', 'auth_failed', 'profile_unavailable', 'session_not_found', 'product_mismatch',
    'focus_context_unavailable', 'transcript_unavailable', 'product_unknown', 'service_configuration', 'entitlement_unavailable',
    'access_denied', 'quota_unavailable', 'authority_unverified', 'persist_failed', 'internal_error']);

export function statusClass(status: unknown): StatusClass {
    if (!Number.isInteger(status)) return 'none';
    const s = Number(status);
    return s >= 200 && s < 300 ? '2xx' : s >= 400 && s < 500 ? '4xx' : s >= 500 && s < 600 ? '5xx' : 'none';
}

/**
 * The contract outcome for one exchange. `null` = intermediate (`retrying`): not a terminal result of the request.
 * `'unmappable'` = a terminal shape outside the closed table; the caller still reports it so the contract FAILs it.
 */
export function contractOutcome(exchange: CoachingExchange): AiRequestOutcome | null | 'unmappable' {
    if (exchange.status === null) return 'client_network';
    const d = exchange.diagnostics;
    if (!d) return 'unmappable';
    if (d.outcome === 'retrying') return null;
    if (d.outcome === 'success') return 'success';
    if (d.outcome !== 'failure' || typeof d.reason !== 'string') return 'unmappable';
    if (PROVIDER_ERROR.has(d.reason)) return 'provider_error';
    if (d.reason === 'provider_timeout') return 'timeout';
    if (d.reason === 'provider_transport') return 'transport_error';
    if (INVALID_RESPONSE.has(d.reason)) return 'invalid_response';
    if (d.reason === 'quota_exceeded') return 'rate_limited';
    if (SERVER_ERROR.has(d.reason)) return 'server_error';
    return 'unmappable';
}

const nonNegInt = (v: unknown): number | null => (Number.isInteger(v) && Number(v) >= 0 ? Number(v) : null);

/**
 * PM RETURN 6115025110: the request's identity is what the page SENT at the boundary — never the response being verified.
 * An answered exchange whose echoed request or attempt id differs from the sent one is inconsistent evidence; it is kept
 * (never dropped) and poisons its request's record so the contract FAILs it.
 */
export function echoMismatch(exchange: CoachingExchange): 'request' | 'attempt' | null {
    if (exchange.status === null || !exchange.diagnostics) return null;
    if (exchange.diagnostics.request_id !== exchange.sent.requestId) return 'request';
    if (exchange.diagnostics.attempt_id !== exchange.sent.attemptId) return 'attempt';
    return null;
}

/** One exchange as the contract's request record. `failureCategory` is the product category the page reported. */
export function toAiRequestDiagnostic(exchange: CoachingExchange, failureCategory: string | null, poisoned = echoMismatch(exchange) !== null): AiRequestDiagnostic {
    const outcome = contractOutcome(exchange);
    const d = exchange.diagnostics ?? {};
    const clientNetwork = outcome === 'client_network';
    const providerAttempts = nonNegInt(d.provider_attempts) ?? 0;
    return {
        // Identity from the sent request (the boundary); the echoed ids are checked by `echoMismatch`, never trusted.
        requestId: exchange.sent.requestId ?? '',
        attemptId: exchange.sent.attemptId ?? '',
        sessionId: exchange.sent.sessionId ?? '',
        // An inconsistent echo, or an unmappable terminal shape, is passed through under a non-contract label so the
        // contract rejects the record (`request_field_invalid`) instead of the adapter dropping it.
        outcome: (poisoned ? 'unmapped:echo_mismatch'
            : outcome === null || outcome === 'unmappable' ? `unmapped:${String(d.outcome)}` : outcome) as AiRequestOutcome,
        failureCategory: outcome === 'success' ? null : failureCategory,
        serverReason: clientNetwork ? null : typeof d.reason === 'string' ? d.reason : null,
        statusClass: statusClass(exchange.status),
        providerStatusClass: statusClass(d.provider_status),
        retryCount: nonNegInt(d.retry_count) ?? 0,
        totalMs: clientNetwork ? exchange.clientMs ?? -1 : nonNegInt(d.total_duration_ms) ?? -1,
        providerMs: providerAttempts > 0 ? nonNegInt(d.provider_duration_ms) : null,
        configuredModel: typeof d.configured_model === 'string' ? d.configured_model : '',
        observedModel: typeof d.observed_model === 'string' ? d.observed_model : null,
        source: d.source === 'fresh' || d.source === 'cache' ? d.source : 'unknown',
    };
}

/**
 * One record per SENT request id: its last terminal exchange (`retrying` is intermediate). A request any of whose
 * exchanges echoed a different request/attempt id is poisoned (its record FAILs the contract) — including a request whose
 * only inconsistent exchange was an intermediate retry. An exchange the page sent without a request id keeps its own
 * record. A consistent request with no terminal exchange is omitted: a report linking it resolves to nothing (HOLD).
 */
export function terminalRequests(exchanges: readonly CoachingExchange[], failureCategory: (e: CoachingExchange) => string | null): AiRequestDiagnostic[] {
    const groups = new Map<string, { terminal: CoachingExchange | null; latest: CoachingExchange; poisoned: boolean }>();
    exchanges.forEach((e, index) => {
        const key = e.sent.requestId ?? `unsent:${index}`;
        const group = groups.get(key) ?? { terminal: null, latest: e, poisoned: false };
        group.latest = e;
        if (echoMismatch(e) !== null) group.poisoned = true;
        if (contractOutcome(e) !== null) group.terminal = e;
        groups.set(key, group);
    });
    return [...groups.values()]
        .filter((g) => g.terminal !== null || g.poisoned)
        .map((g) => { const e = g.terminal ?? g.latest; return toAiRequestDiagnostic(e, failureCategory(e), g.poisoned); });
}

export interface StoredReportReadback {
    id: string;
    sessionId: string | null;
    /** `user_issue_reports.metadata.coaching_diagnostic_ref`, or null when the report carries none. */
    coachingDiagnosticRef: string | null;
    /** Rows stored for this run's submission (exactly one is the contract). */
    storedRows: number;
}

export function reportAssociation(sessionId: string | null, currentSessionId: string | null): ReportAssociation {
    if (sessionId === null) return 'no_session';
    return sessionId === currentSessionId ? 'current_take' : 'selected_older_session';
}

export function toReportDiagnostic(
    report: StoredReportReadback, currentSessionId: string | null, acknowledgementVisible: boolean, telemetryReceived: boolean,
): FeedbackReportDiagnostic {
    const storage: ReportStorage = report.storedRows === 1 ? 'stored_once' : report.storedRows > 1 ? 'stored_duplicate' : 'not_stored';
    return {
        reportId: report.id,
        sessionId: report.sessionId,
        association: reportAssociation(report.sessionId, currentSessionId),
        linkedRequestId: report.coachingDiagnosticRef,
        storage,
        acknowledgementVisible,
        telemetryReceived,
    };
}

export function buildFeedbackLookup(input: {
    report: StoredReportReadback;
    currentSessionId: string | null;
    acknowledgementVisible: boolean;
    telemetryReceived: boolean;
    exchanges: readonly CoachingExchange[];
    failureCategory: (e: CoachingExchange) => string | null;
}): FeedbackDiagnosticLookup {
    return {
        report: toReportDiagnostic(input.report, input.currentSessionId, input.acknowledgementVisible, input.telemetryReceived),
        requests: terminalRequests(input.exchanges, input.failureCategory),
    };
}

/**
 * What a report about the CURRENT take must resolve to: the current take's terminal request, from the request the page
 * sent for that saved session. Null when the run never sent a request for it (the caller reports HOLD, not a guess).
 */
export function currentTakeExpectation(input: {
    reportId: string;
    currentSessionId: string;
    exchanges: readonly CoachingExchange[];
    configuredModel: string;
}): DiagnosticExpectation | null {
    const forTake = input.exchanges.filter((e) => e.sent.sessionId === input.currentSessionId && contractOutcome(e) !== null);
    const terminal = forTake[forTake.length - 1];
    if (!terminal) return null;
    const outcome = contractOutcome(terminal);
    // The expectation is the independently captured boundary: the ids the page SENT, never the response's echo.
    const requestId = terminal.sent.requestId ?? '';
    return {
        reportId: input.reportId,
        association: 'current_take',
        sessionId: input.currentSessionId,
        requestId,
        outcome: outcome === 'unmappable' || outcome === null ? null : outcome,
        attemptId: terminal.sent.attemptId ?? '',
        failureCategory: null,
        serverReason: null,
        configuredModel: input.configuredModel,
        currentRequestId: requestId,
    };
}

interface ReceiptLike {
    readonly rows: ReadonlyArray<{ step: string; verdict: string }>;
    row(step: string, verdict: 'PASS' | 'FAIL' | 'HOLD', detail: string, evidence?: Record<string, string | number | boolean | null>): void;
}
type ReportReader = {
    from(table: string): { select(c: string): { eq(c: string, v: string): { eq(c: string, v: string): PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { code?: string } | null }> } } };
};

/**
 * Row `feedback diagnostic chain`: the stored report (read back by id, scoped to the run-owned account) must resolve to
 * the exact coaching request the page SENT for the reported take. Closed reason codes only leave this row. RECEIVED
 * telemetry is the deployed PostHog readback; no readback stage carries `ai_coaching_diagnostic` yet, so this in-run row
 * never claims it and stays HOLD `telemetry_not_received` until that stage exists (named gap).
 */
export async function feedbackDiagnosticChainRow(input: {
    receipt: ReceiptLike;
    admin: ReportReader;
    userId: string;
    reportId: string | null;
    currentSessionId: string | null;
    exchanges: readonly CoachingExchange[];
    configuredModel: string;
    product: 'open_mic' | 'focus_points';
}): Promise<void> {
    const { receipt } = input;
    if (!input.reportId || !input.currentSessionId) {
        receipt.row('feedback diagnostic chain', 'HOLD', 'no stored report or no saved take to resolve',
            { reasons: input.reportId ? 'no_saved_take' : 'report_not_found' });
        return;
    }
    const expected = currentTakeExpectation({ reportId: input.reportId, currentSessionId: input.currentSessionId, exchanges: input.exchanges, configuredModel: input.configuredModel });
    if (!expected) {
        receipt.row('feedback diagnostic chain', 'HOLD', 'the run sent no coaching request for the reported take', { reasons: 'request_not_found' });
        return;
    }
    const { data, error } = await input.admin.from('user_issue_reports').select('id, session_id, metadata').eq('id', input.reportId).eq('user_id', input.userId);
    if (error) throw new Error(`feedback report read failed (fail closed): ${error.code ?? 'unknown'}`);
    const row = (data ?? [])[0];
    const ref = (row?.metadata as { coaching_diagnostic_ref?: unknown } | null | undefined)?.coaching_diagnostic_ref;
    const lookup = row ? buildFeedbackLookup({
        report: { id: String(row.id), sessionId: typeof row.session_id === 'string' ? row.session_id : null, coachingDiagnosticRef: typeof ref === 'string' ? ref : null, storedRows: (data ?? []).length },
        currentSessionId: input.currentSessionId,
        // The existing `feedback` row PASSes only when the acknowledgement was shown AND the report stored exactly once.
        acknowledgementVisible: receipt.rows.some((r) => r.step === 'feedback' && r.verdict === 'PASS'),
        telemetryReceived: false,
        exchanges: input.exchanges,
        failureCategory: () => null,
    }) : null;
    const v = validateFeedbackDiagnostics(lookup, expected);
    // Echoed-id evidence is preserved as a count (content-free); a mismatch already FAILs the request's record.
    const echoMismatches = input.exchanges.filter((e) => echoMismatch(e) !== null).length;
    // H1 (PM 6115110576): when ONLY received telemetry is missing, record what the PostHog readback must bind to — SHA-256
    // digests of the SENT request and terminal attempt ids (never the ids), the product and the configured model.
    // Finalization settles the row from that independent readback; any other HOLD or FAIL carries no binding.
    const sha = (v: string) => createHash('sha256').update(v, 'utf8').digest('hex');
    const settleable = v.verdict === 'HOLD' && v.reasons.length === 1 && v.reasons[0] === 'telemetry_not_received'
        && expected.outcome === 'success' && expected.requestId !== null && expected.requestId !== '' && expected.attemptId !== null && expected.attemptId !== '';
    receipt.row('feedback diagnostic chain', v.verdict,
        v.verdict === 'PASS' ? 'the report resolves to the exact coaching request for this take'
            : v.verdict === 'FAIL' ? 'the report and the coaching request contradict each other' : 'the chain is incomplete',
        {
            reasons: v.reasons.join(',') || 'none', echoMismatches,
            ...(settleable ? {
                expectedRequestSha256: sha(expected.requestId!), expectedAttemptSha256: sha(expected.attemptId!),
                expectedProduct: input.product, expectedConfiguredModel: input.configuredModel, expectedOutcome: 'success',
            } : {}),
        });
}
