/**
 * #1258 RWT-feedback-journey-preparation (PM 6110520212) — THE ACCEPTANCE CONTRACT for "AI failure → Share Feedback →
 * support retrieves the exact diagnostic chain", written before CLI Dev's diagnostics exist so the journey can assert it.
 *
 * Input: the support lookup for one feedback report (the report's diagnostic row and the AI request records it links),
 * mapped to these content-free fields; and what the run itself caused. Verdict:
 *   - HOLD: evidence is missing (no report, no link, linked request absent, telemetry only sent, success without the
 *     provider-reported model) — never a PASS by absence;
 *   - FAIL: evidence contradicts the run (wrong association/session/request/outcome, an older-session or no-session report
 *     carrying the current take's request, duplicate storage, no acknowledgement, malformed fields, or any field outside the
 *     exact content-free schema);
 *   - PASS only when the whole chain is present, consistent and content-free.
 * Reasons are closed tokens. Field names are App Dev's proposal to CLI Dev; the mapping from the real lookup lives with
 * the journey, so a renamed column changes one adapter, not this rule.
 */

export type AiRequestOutcome = 'success' | 'provider_error' | 'transport_error' | 'invalid_response' | 'timeout' | 'rate_limited';
export type ReportAssociation = 'current_take' | 'selected_older_session' | 'no_session';
export type ReportStorage = 'stored_once' | 'stored_duplicate' | 'not_stored';

export interface AiRequestDiagnostic {
    requestId: string;
    attemptId: string;
    sessionId: string;
    outcome: AiRequestOutcome;
    /** Closed product category for a failure (e.g. `unavailable`, `network`); null on success. */
    failureCategory: string | null;
    /** HTTP class of the final answer; `none` when nothing answered (timeout, transport). Must agree with `outcome`. */
    statusClass: '2xx' | '4xx' | '5xx' | 'none';
    retryCount: number;
    totalMs: number;
    /** Provider leg only; null when the provider was never reached. */
    providerMs: number | null;
    configuredModel: string;
    /** The provider-REPORTED model version; null unless the provider answered. Never the configured value copied over. */
    observedModel: string | null;
    source: 'fresh' | 'cache';
}

export interface FeedbackReportDiagnostic {
    reportId: string;
    sessionId: string | null;
    association: ReportAssociation;
    linkedRequestId: string | null;
    storage: ReportStorage;
    acknowledgementVisible: boolean;
    /** The feedback outcome was RECEIVED by telemetry (readback), not merely sent from the page. */
    telemetryReceived: boolean;
}

export interface FeedbackDiagnosticLookup { report: FeedbackReportDiagnostic; requests: AiRequestDiagnostic[] }

/** What the run caused and selected. `requestId`/`outcome` are null when the report should link no request. */
export interface DiagnosticExpectation {
    /** The report the run stored (read back by id), so a lookup cannot answer with some other report. */
    reportId: string;
    association: ReportAssociation;
    sessionId: string | null;
    requestId: string | null;
    outcome: AiRequestOutcome | null;
    /** The attempt the run started (from its sent Start), when a request is expected. */
    attemptId: string | null;
    /** The product category the run provoked (e.g. `unavailable`), when a failure is expected. */
    failureCategory: string | null;
    /** The configured target from the coaching contract (`get-ai-suggestions/contract.json`). */
    configuredModel: string;
    /** The current take's request, which a report about any OTHER session must never carry. */
    currentRequestId: string;
}

export type DiagnosticReason =
    | 'report_not_found' | 'request_link_missing' | 'request_not_found' | 'telemetry_not_received' | 'observed_model_missing'
    | 'report_mismatch' | 'association_mismatch' | 'session_mismatch' | 'request_mismatch' | 'attempt_mismatch'
    | 'failure_category_mismatch' | 'configured_model_mismatch' | 'request_session_mismatch' | 'outcome_mismatch'
    | 'current_attempt_attached_to_other_session' | 'invented_link' | 'storage_not_exactly_once' | 'acknowledgement_not_visible'
    | 'report_field_invalid' | 'request_field_invalid' | 'unexpected_field';

export interface DiagnosticVerdict { verdict: 'PASS' | 'FAIL' | 'HOLD'; reasons: DiagnosticReason[] }

const HOLD_REASONS = new Set<DiagnosticReason>(['report_not_found', 'request_link_missing', 'request_not_found', 'telemetry_not_received', 'observed_model_missing']);
const OUTCOMES: readonly string[] = ['success', 'provider_error', 'transport_error', 'invalid_response', 'timeout', 'rate_limited'];
const ASSOCIATIONS: readonly string[] = ['current_take', 'selected_older_session', 'no_session'];
const STORAGE: readonly string[] = ['stored_once', 'stored_duplicate', 'not_stored'];
/** The HTTP classes each outcome can truthfully carry; a mismatch (e.g. a timeout with a 2xx) is malformed evidence. */
const STATUS_FOR_OUTCOME: Record<string, readonly string[]> = {
    success: ['2xx'], provider_error: ['5xx'], invalid_response: ['2xx', '5xx'], rate_limited: ['4xx'],
    timeout: ['none'], transport_error: ['none'],
};
/** AISuggestions' closed failure reasons (#1473/#1486), plus `timeout` for a request that never answered. */
const FAILURE_CATEGORIES: readonly string[] = ['unavailable', 'network', 'invalid_response', 'timeout', 'rate_limited', 'access_denied',
    'service_configuration', 'not_found', 'transcript_unavailable'];
/**
 * The lookup's COMPLETE schema (PM RETURN 6110940975): every object level has an exact allowed-key set and every value is a
 * scalar. Anything else — an unlisted key (`audio`, `apiKey`, `authorization`, a nested payload) or a nested object/array
 * where a scalar belongs — is `unexpected_field`. Content-freedom is enforced by what is ALLOWED, never by guessing content
 * names. Free-form strings remain only where the schema permits them (opaque ids, the provider-reported model).
 */
const LOOKUP_KEYS = ['report', 'requests'] as const;
const REPORT_KEYS = ['reportId', 'sessionId', 'association', 'linkedRequestId', 'storage', 'acknowledgementVisible', 'telemetryReceived'] as const;
const REQUEST_KEYS = ['requestId', 'attemptId', 'sessionId', 'outcome', 'failureCategory', 'statusClass', 'retryCount', 'totalMs',
    'providerMs', 'configuredModel', 'observedModel', 'source'] as const;
const isScalar = (v: unknown): boolean => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const exactShape = (value: unknown, keys: readonly string[]): boolean =>
    !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((k) => keys.includes(k)) && Object.values(value).every(isScalar);

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const count = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const duration = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function schemaViolation(lookup: unknown): boolean {
    if (!lookup || typeof lookup !== 'object' || Array.isArray(lookup)) return true;
    const top = lookup as Record<string, unknown>;
    if (!Object.keys(top).every((k) => (LOOKUP_KEYS as readonly string[]).includes(k))) return true;
    if (!exactShape(top.report, REPORT_KEYS)) return true;
    if (top.requests !== undefined && !Array.isArray(top.requests)) return true;
    return (Array.isArray(top.requests) ? top.requests : []).some((q) => !exactShape(q, REQUEST_KEYS));
}

function reportValid(r: FeedbackReportDiagnostic): boolean {
    return nonEmpty(r.reportId) && (r.sessionId === null || nonEmpty(r.sessionId)) && ASSOCIATIONS.includes(r.association)
        && (r.linkedRequestId === null || nonEmpty(r.linkedRequestId)) && STORAGE.includes(r.storage)
        && typeof r.acknowledgementVisible === 'boolean' && typeof r.telemetryReceived === 'boolean';
}

function requestValid(q: AiRequestDiagnostic): boolean {
    return nonEmpty(q.requestId) && nonEmpty(q.attemptId) && nonEmpty(q.sessionId) && OUTCOMES.includes(q.outcome)
        && (q.outcome === 'success' ? q.failureCategory === null : FAILURE_CATEGORIES.includes(q.failureCategory ?? ''))
        && STATUS_FOR_OUTCOME[q.outcome]?.includes(q.statusClass)
        && count(q.retryCount) && duration(q.totalMs) && (q.providerMs === null || duration(q.providerMs))
        && nonEmpty(q.configuredModel) && (q.observedModel === null || nonEmpty(q.observedModel))
        && (q.source === 'fresh' || q.source === 'cache');
}

export function validateFeedbackDiagnostics(lookup: FeedbackDiagnosticLookup | null, expected: DiagnosticExpectation): DiagnosticVerdict {
    if (!lookup?.report) return { verdict: 'HOLD', reasons: ['report_not_found'] };
    const reasons = new Set<DiagnosticReason>();
    const { report } = lookup;
    const requests = Array.isArray(lookup.requests) ? lookup.requests : [];
    if (schemaViolation(lookup)) reasons.add('unexpected_field');
    if (!reportValid(report)) reasons.add('report_field_invalid');

    // The report itself: the one the run stored, what the person selected, stored exactly once, and acknowledged.
    if (report.reportId !== expected.reportId) reasons.add('report_mismatch');
    if (report.association !== expected.association) reasons.add('association_mismatch');
    if (report.sessionId !== expected.sessionId) reasons.add('session_mismatch');
    if (report.storage !== 'stored_once') reasons.add('storage_not_exactly_once');
    if (report.acknowledgementVisible !== true) reasons.add('acknowledgement_not_visible');
    if (report.telemetryReceived !== true) reasons.add('telemetry_not_received');

    // Never borrow the current take's request for a report about another session, nor invent one for no session.
    if (expected.association !== 'current_take' && report.linkedRequestId === expected.currentRequestId) {
        reasons.add('current_attempt_attached_to_other_session');
    }
    if (expected.association === 'no_session' && (report.sessionId !== null || report.linkedRequestId !== null)) reasons.add('invented_link');

    if (expected.requestId !== null) {
        if (report.linkedRequestId === null) {
            reasons.add('request_link_missing');
        } else if (report.linkedRequestId !== expected.requestId) {
            reasons.add('request_mismatch');
        } else {
            const linked = requests.filter((q) => q?.requestId === report.linkedRequestId);
            if (linked.length === 0) reasons.add('request_not_found');
            else if (linked.length > 1) reasons.add('request_field_invalid');
            else {
                const q = linked[0];
                if (!requestValid(q)) reasons.add('request_field_invalid');
                if (q.sessionId !== report.sessionId) reasons.add('request_session_mismatch');
                if (expected.outcome !== null && q.outcome !== expected.outcome) reasons.add('outcome_mismatch');
                if (expected.attemptId !== null && q.attemptId !== expected.attemptId) reasons.add('attempt_mismatch');
                if (expected.failureCategory !== null && q.failureCategory !== expected.failureCategory) reasons.add('failure_category_mismatch');
                if (q.configuredModel !== expected.configuredModel) reasons.add('configured_model_mismatch');
                if (q.outcome === 'success' && !nonEmpty(q.observedModel)) reasons.add('observed_model_missing');
            }
        }
    } else if (report.linkedRequestId !== null && expected.association !== 'no_session') {
        // PM RETURN 6110940975: a link the run did not cause (e.g. a report about an older take) must still resolve to ONE
        // retrievable, valid request bound to that report's own session — never PASS on a dangling or malformed reference.
        const linked = requests.filter((q) => q?.requestId === report.linkedRequestId);
        if (linked.length === 0) reasons.add('request_not_found');
        else if (linked.length > 1 || !requestValid(linked[0])) reasons.add('request_field_invalid');
        else if (linked[0].sessionId !== report.sessionId) reasons.add('request_session_mismatch');
    }

    const list = [...reasons];
    if (list.length === 0) return { verdict: 'PASS', reasons: [] };
    return { verdict: list.some((r) => !HOLD_REASONS.has(r)) ? 'FAIL' : 'HOLD', reasons: list };
}
