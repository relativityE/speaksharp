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

/** One exchange as the contract's request record. `failureCategory` is the product category the page reported. */
export function toAiRequestDiagnostic(exchange: CoachingExchange, failureCategory: string | null): AiRequestDiagnostic {
    const outcome = contractOutcome(exchange);
    const d = exchange.diagnostics ?? {};
    const clientNetwork = outcome === 'client_network';
    const providerAttempts = nonNegInt(d.provider_attempts) ?? 0;
    return {
        // The Edge echoes the client's ids when they are valid; a different id is evidence the contract must see.
        requestId: clientNetwork ? exchange.sent.requestId ?? '' : typeof d.request_id === 'string' ? d.request_id : '',
        attemptId: clientNetwork ? exchange.sent.attemptId ?? '' : typeof d.attempt_id === 'string' ? d.attempt_id : '',
        sessionId: exchange.sent.sessionId ?? '',
        // An unmappable terminal shape is passed through under its raw label so `shapeHolds` rejects it.
        outcome: (outcome === null || outcome === 'unmappable' ? `unmapped:${String(d.outcome)}` : outcome) as AiRequestOutcome,
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

/** The request's identity: the Edge's echoed id when answered, the id the page sent otherwise. */
const requestKey = (e: CoachingExchange): string | null =>
    (e.status !== null && typeof e.diagnostics?.request_id === 'string' ? e.diagnostics.request_id : e.sent.requestId);

/**
 * One terminal record per request id: the LAST exchange of that request whose outcome is terminal (`retrying` is
 * intermediate). Requests with no terminal exchange are omitted — a report linking one resolves to nothing (HOLD).
 */
export function terminalRequests(exchanges: readonly CoachingExchange[], failureCategory: (e: CoachingExchange) => string | null): AiRequestDiagnostic[] {
    const last = new Map<string, CoachingExchange>();
    for (const e of exchanges) {
        const key = requestKey(e);
        if (!key || contractOutcome(e) === null) continue;
        last.set(key, e);
    }
    return [...last.values()].map((e) => toAiRequestDiagnostic(e, failureCategory(e)));
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
    const record = toAiRequestDiagnostic(terminal, null);
    return {
        reportId: input.reportId,
        association: 'current_take',
        sessionId: input.currentSessionId,
        requestId: record.requestId,
        outcome: outcome === 'unmappable' || outcome === null ? null : outcome,
        attemptId: record.attemptId,
        failureCategory: null,
        serverReason: null,
        configuredModel: input.configuredModel,
        currentRequestId: record.requestId,
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
    receipt.row('feedback diagnostic chain', v.verdict,
        v.verdict === 'PASS' ? 'the report resolves to the exact coaching request for this take'
            : v.verdict === 'FAIL' ? 'the report and the coaching request contradict each other' : 'the chain is incomplete',
        { reasons: v.reasons.join(',') || 'none' });
}
