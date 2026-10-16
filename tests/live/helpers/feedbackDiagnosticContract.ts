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

/**
 * Terminal outcome of one coaching request (PM 6111008437). `timeout` / `transport_error` are the PROVIDER leg failing after
 * the Edge function was reached (the endpoint still answers, e.g. 502); `client_network` is the client never reaching the
 * endpoint (no endpoint status at all); `server_error` is the endpoint refusing before/around the provider (auth, session,
 * entitlement, quota availability, persistence, internal), with its exact closed `serverReason`.
 */
export type AiRequestOutcome = 'success' | 'provider_error' | 'timeout' | 'transport_error' | 'invalid_response' | 'rate_limited'
    | 'server_error' | 'client_network';
type StatusClass = '2xx' | '4xx' | '5xx' | 'none';
export type ReportAssociation = 'current_take' | 'selected_older_session' | 'no_session';
export type ReportStorage = 'stored_once' | 'stored_duplicate' | 'not_stored';

export interface AiRequestDiagnostic {
    requestId: string;
    attemptId: string;
    sessionId: string;
    outcome: AiRequestOutcome;
    /** The PRODUCT-facing failure category the user saw (AISuggestions' closed reasons); null on success. */
    failureCategory: string | null;
    /** The Edge function's closed diagnostic reason (`DIAGNOSTIC_REASONS`, `none` on success); null only for `client_network`. */
    serverReason: string | null;
    /** HTTP class of the ENDPOINT's answer to the client; `none` only when the client never reached it. */
    statusClass: StatusClass;
    /** HTTP class of the PROVIDER's answer; `none` when the provider was never reached or never answered. */
    providerStatusClass: StatusClass;
    retryCount: number;
    totalMs: number;
    /** Provider leg only; null when the provider was never reached. */
    providerMs: number | null;
    configuredModel: string;
    /** The provider-REPORTED model version; null unless the provider answered. Never the configured value copied over. */
    observedModel: string | null;
    /** `unknown` only for a validated pre-provider failure (no provider answer). */
    source: 'fresh' | 'cache' | 'unknown';
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
    /** The exact server reason the run injected (e.g. `provider_http_5xx`), asserted independently of the category. */
    serverReason: string | null;
    /** The configured target from the coaching contract (`get-ai-suggestions/contract.json`). */
    configuredModel: string;
    /** The current take's request, which a report about any OTHER session must never carry. */
    currentRequestId: string;
}

export type DiagnosticReason =
    | 'report_not_found' | 'request_link_missing' | 'request_not_found' | 'telemetry_not_received' | 'observed_model_missing'
    | 'report_mismatch' | 'association_mismatch' | 'session_mismatch' | 'request_mismatch' | 'attempt_mismatch'
    | 'failure_category_mismatch' | 'server_reason_mismatch' | 'configured_model_mismatch' | 'request_session_mismatch' | 'outcome_mismatch'
    | 'current_attempt_attached_to_other_session' | 'invented_link' | 'storage_not_exactly_once' | 'acknowledgement_not_visible'
    | 'report_field_invalid' | 'request_field_invalid' | 'unexpected_field' | 'failure_category_not_observed'
    | 'failure_category_ambiguous';

/**
 * #1258 R11 (PM RETURN 6144366004) — the page-reported category of a failed request, as the adapter could bind it:
 * `null` = no report bound (unobserved, HOLD); AMBIGUOUS = more than one report bound to the request (HOLD); OBSERVED_INVALID
 * = a report bound to it carried a reason outside the vocabulary (stays invalid → FAIL). The raw reason never travels.
 */
export const FAILURE_CATEGORY_AMBIGUOUS = 'category:ambiguous';
export const FAILURE_CATEGORY_OBSERVED_INVALID = 'category:observed_invalid';

export interface DiagnosticVerdict { verdict: 'PASS' | 'FAIL' | 'HOLD'; reasons: DiagnosticReason[] }

// #1258 R11 (PM 6143804613-review): a failed request whose page-reported category was not CAPTURED is unproven (HOLD) —
// never guessed, and never a field contradiction. A captured category outside FAILURE_CATEGORIES still FAILs.
const HOLD_REASONS = new Set<DiagnosticReason>(['report_not_found', 'request_link_missing', 'request_not_found', 'telemetry_not_received', 'observed_model_missing',
    'failure_category_not_observed', 'failure_category_ambiguous']);
const OUTCOMES: readonly string[] = ['success', 'provider_error', 'timeout', 'transport_error', 'invalid_response', 'rate_limited',
    'server_error', 'client_network'];
const ASSOCIATIONS: readonly string[] = ['current_take', 'selected_older_session', 'no_session'];
const STORAGE: readonly string[] = ['stored_once', 'stored_duplicate', 'not_stored'];
/**
 * What each outcome can truthfully carry (PM 6111008437): endpoint status class, provider status class and the closed server
 * reasons; the source is fixed per outcome by `expectedSource`. A combination outside this table is malformed evidence.
 */
const OUTCOME_SHAPE: Record<string, { status: readonly string[]; provider: readonly string[]; reasons: readonly (string | null)[] }> = {
    // A cache hit makes no provider call (provider `none`); a fresh success must carry the provider's 2xx (see shapeHolds).
    success: { status: ['2xx'], provider: ['2xx', 'none'], reasons: ['none'] },
    provider_error: { status: ['5xx'], provider: ['4xx', '5xx'], reasons: ['provider_http_4xx', 'provider_http_5xx'] },
    // Codex r4290615981 (PM 6207410484): a timeout before any headers has no provider status; a BODY timeout keeps the
    // received 2xx (the Edge function records the status as soon as headers arrive). Nothing else.
    timeout: { status: ['5xx'], provider: ['none', '2xx'], reasons: ['provider_timeout'] },
    transport_error: { status: ['5xx'], provider: ['none'], reasons: ['provider_transport'] },
    invalid_response: { status: ['5xx'], provider: ['2xx'], reasons: ['missing_text', 'invalid_shape', 'over_character_ceiling', 'missing_model_version', 'provider_malformed_response'] },
    rate_limited: { status: ['4xx'], provider: ['none'], reasons: ['quota_exceeded'] },
    server_error: {
        status: ['4xx', '5xx'], provider: ['none', '2xx'],
        reasons: ['invalid_request', 'auth_failed', 'profile_unavailable', 'session_not_found', 'product_mismatch', 'focus_context_unavailable',
            'transcript_unavailable', 'product_unknown', 'service_configuration', 'entitlement_unavailable', 'access_denied',
            'quota_unavailable', 'authority_unverified', 'persist_failed', 'internal_error'],
    },
    client_network: { status: ['none'], provider: ['none'], reasons: [null] },
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
const REQUEST_KEYS = ['requestId', 'attemptId', 'sessionId', 'outcome', 'failureCategory', 'serverReason', 'statusClass',
    'providerStatusClass', 'retryCount', 'totalMs', 'providerMs', 'configuredModel', 'observedModel', 'source'] as const;
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

/**
 * The ONE source each outcome can truthfully report (PM RETURN 6111565683): `cache` only for a cache success (no provider
 * call); `fresh` for any request whose provider leg was attempted (a fresh success, a provider error/timeout/transport loss,
 * an invalid provider answer, or a server failure after the provider answered); `unknown` only for a validated pre-provider
 * or no-response shape (rate limit, a server refusal before the provider, client network loss).
 */
function expectedSource(q: AiRequestDiagnostic): AiRequestDiagnostic['source'] | null {
    switch (q.outcome) {
        case 'success': return q.providerStatusClass === 'none' ? 'cache' : 'fresh';
        case 'provider_error': case 'timeout': case 'transport_error': case 'invalid_response': return 'fresh';
        case 'rate_limited': case 'client_network': return 'unknown';
        case 'server_error': return q.providerStatusClass === 'none' ? 'unknown' : 'fresh';
        default: return null;
    }
}

function shapeHolds(q: AiRequestDiagnostic): boolean {
    const shape = OUTCOME_SHAPE[q.outcome];
    if (!shape) return false;
    return shape.status.includes(q.statusClass) && shape.provider.includes(q.providerStatusClass)
        && shape.reasons.includes(q.serverReason) && q.source === expectedSource(q);
}

function requestValid(q: AiRequestDiagnostic): boolean {
    return nonEmpty(q.requestId) && nonEmpty(q.attemptId) && nonEmpty(q.sessionId) && OUTCOMES.includes(q.outcome)
        && (q.outcome === 'success' ? q.failureCategory === null
            : q.failureCategory === null || q.failureCategory === FAILURE_CATEGORY_AMBIGUOUS || FAILURE_CATEGORIES.includes(q.failureCategory))
        && shapeHolds(q)
        && count(q.retryCount) && duration(q.totalMs)
        // The provider leg is part of the request, so it can never exceed the total (PM RETURN 6111565683).
        && (q.providerMs === null || (duration(q.providerMs) && q.providerMs <= q.totalMs))
        && nonEmpty(q.configuredModel) && (q.observedModel === null || nonEmpty(q.observedModel))
        && ['fresh', 'cache', 'unknown'].includes(q.source);
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
                if (q.outcome !== 'success' && q.failureCategory === null) reasons.add('failure_category_not_observed');
                if (q.outcome !== 'success' && q.failureCategory === FAILURE_CATEGORY_AMBIGUOUS) reasons.add('failure_category_ambiguous');
                if (q.sessionId !== report.sessionId) reasons.add('request_session_mismatch');
                if (expected.outcome !== null && q.outcome !== expected.outcome) reasons.add('outcome_mismatch');
                if (expected.attemptId !== null && q.attemptId !== expected.attemptId) reasons.add('attempt_mismatch');
                if (expected.failureCategory !== null && q.failureCategory !== expected.failureCategory) reasons.add('failure_category_mismatch');
                if (expected.serverReason !== null && q.serverReason !== expected.serverReason) reasons.add('server_reason_mismatch');
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
        if (linked.length === 1 && linked[0].outcome !== 'success') {
            if (linked[0].failureCategory === null) reasons.add('failure_category_not_observed');
            if (linked[0].failureCategory === FAILURE_CATEGORY_AMBIGUOUS) reasons.add('failure_category_ambiguous');
        }
    }

    const list = [...reasons];
    if (list.length === 0) return { verdict: 'PASS', reasons: [] };
    return { verdict: list.some((r) => !HOLD_REASONS.has(r)) ? 'FAIL' : 'HOLD', reasons: list };
}
