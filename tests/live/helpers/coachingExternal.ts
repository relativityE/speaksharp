/**
 * #1258 — COACHING PROVIDER UNAVAILABILITY IS EXTERNAL, NEVER A PASS (PO 2026-10-14; PM 6171519534, A+B+C with D1).
 *
 * PO: "We should not fail our app due to Google answering 503 … This should not prevent us from moving forward." The
 * provider's capacity is outside the product, so a PROVED provider outage is recorded as `EXTERNAL`: non-blocking, named,
 * and never counted as working coaching. Everything the app itself owns stays PASS/FAIL as before.
 *
 * Proof is narrow and request-bound:
 *   • PROVIDER OUTCOME — the Edge response for the coaching request names `reason: provider_http_5xx` with an integer
 *     `diagnostics.provider_status` in 500–599, or `reason: provider_timeout`. An Edge 502 alone, a missing/malformed/
 *     unknown reason, `provider_transport`, or a browser/harness timeout is NOT proof.
 *   • GRACEFUL APP — independently: the exact take is saved exactly once, the review card settles on `error` with the
 *     unavailable message, and Try again is present and enabled (it is not pressed: a press would be another provider
 *     request). The failure-path telemetry (requested + failed) left the page.
 * Only then is the parent row EXTERNAL; the rows that assert a SUCCESSFUL answer become EXTERNAL "not exercised".
 * Request provenance, session binding, saves, cleanup, identity and every other row are judged on their own.
 */
import type { ReceiptRow, Verdict } from './rwtAcceptance';
import type { CoachingExchange } from './coachingGenerationTap';
import { bindFailureReports, type ObservedEvent } from './coachingFeedbackAdapter';

/**
 * #1258 — the closed failure reasons `get-ai-suggestions` returns in its 502 body. Read so a failed coaching row names its
 * cause in the receipt itself. Anything outside the closed set reads 'unrecognized', so no free text enters the receipt.
 */
export const COACHING_FAILURE_REASONS = [
    'provider_http_4xx', 'provider_http_5xx', 'provider_transport', 'provider_timeout', 'missing_text', 'invalid_shape',
    'over_character_ceiling', 'missing_model_version',
] as const;
export function coachingFailureReason(body: unknown): string | null {
    const reason = body && typeof body === 'object' ? (body as { reason?: unknown }).reason : undefined;
    if (reason === undefined || reason === null) return null;
    return typeof reason === 'string' && (COACHING_FAILURE_REASONS as readonly string[]).includes(reason) ? reason : 'unrecognized';
}


/** The closed provider-outcome classes that may prove an external outage. */
export type ExternalProviderOutcome = 'provider_5xx' | 'provider_timeout';

/** Allowlisted scalars read once from the failed coaching response (nothing else from the body is kept). */
export interface CoachingFailureEvidence {
    /** The HTTP status of OUR Edge function's response. */
    httpStatus: number | null;
    /** The closed failure reason the Edge function named (or `unrecognized` / `unknown` / null). */
    reason: string | null;
    /** `diagnostics.provider_status` — the provider's own HTTP status, when it is an integer in 100–599. */
    providerStatus: number | null;
}

/** Read `diagnostics.provider_status` from a parsed failure body: an integer in 100–599, else null. */
export function providerStatusFrom(body: unknown): number | null {
    const diagnostics = body && typeof body === 'object' ? (body as { diagnostics?: unknown }).diagnostics : undefined;
    const value = diagnostics && typeof diagnostics === 'object' ? (diagnostics as { provider_status?: unknown }).provider_status : undefined;
    return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

/** The external outcome the request-bound evidence PROVES, or null when it proves nothing. */
export function provenExternalOutcome(e: CoachingFailureEvidence): ExternalProviderOutcome | null {
    if (e.httpStatus !== 502) return null; // the Edge function answers a provider failure with 502, and only then
    if (e.reason === 'provider_http_5xx' && e.providerStatus !== null && e.providerStatus >= 500 && e.providerStatus <= 599) return 'provider_5xx';
    if (e.reason === 'provider_timeout') return 'provider_timeout';
    return null;
}

/** The app's own handling of the failure, observed independently of the provider evidence. */
export interface GracefulDegradation {
    /** The exact take this request coached is saved, exactly once, and bound to this account. */
    savedTakeProven: boolean;
    /** `data-review-state` the card settled on. */
    reviewState: string | null;
    /** The unavailable message is the visible headline. */
    unavailableShown: boolean;
    /** Try again is rendered and enabled. */
    retryEnabled: boolean;
    /** The coaching request was made for this exact saved session (request body `sessionId` === saved id). */
    requestBoundToSession: boolean;
}

export const UNAVAILABLE_HEADLINE = "The review didn't load. Your session is saved.";

/** Which graceful-degradation checks failed, by name (empty = all held). */
export function gracefulFailures(g: GracefulDegradation): string[] {
    const failures: string[] = [];
    if (!g.savedTakeProven) failures.push('the saved take is not proven');
    if (!g.requestBoundToSession) failures.push('the coaching request is not bound to the saved session');
    if (g.reviewState !== 'error') failures.push(`the review card settled on ${String(g.reviewState)}, not error`);
    if (!g.unavailableShown) failures.push('the unavailable message is not shown');
    if (!g.retryEnabled) failures.push('Try again is missing or disabled');
    return failures;
}

export interface CoachingParentVerdict { verdict: Verdict; detail: string; external: ExternalProviderOutcome | null }

/**
 * The parent "coaching rendered" verdict. A rendered pair is PASS. A failure is EXTERNAL only when the provider outcome
 * is proved AND every graceful check holds; otherwise FAIL, naming what was not proved.
 */
export function coachingParentVerdict(args: {
    rendered: boolean;
    evidence: CoachingFailureEvidence;
    graceful: GracefulDegradation;
}): CoachingParentVerdict {
    if (args.rendered) return { verdict: 'PASS', detail: 'exactly two coaching phrases rendered without any click', external: null };
    const outcome = provenExternalOutcome(args.evidence);
    const base = `coaching did not render (state=${String(args.graceful.reviewState)}, http=${String(args.evidence.httpStatus)}`
        + `, reason=${String(args.evidence.reason)}, provider_status=${String(args.evidence.providerStatus)})`;
    if (!outcome) return { verdict: 'FAIL', detail: `${base}; the cause is not proved external`, external: null };
    const failed = gracefulFailures(args.graceful);
    if (failed.length > 0) return { verdict: 'FAIL', detail: `${base}; the provider was unavailable but the app did not degrade gracefully: ${failed.join('; ')}`, external: null };
    return {
        verdict: 'EXTERNAL',
        detail: `external provider unavailable (${outcome === 'provider_5xx' ? `provider ${String(args.evidence.providerStatus)}` : 'provider timeout'}) — non-blocking per PO; the take stayed saved, the unavailable message and an enabled Try again were shown. Successful coaching was not exercised.`,
        external: outcome,
    };
}

/**
 * A row that asserts something only a SUCCESSFUL answer can produce. Under an EXTERNAL parent it is "not exercised";
 * otherwise its own verdict stands unchanged.
 */
export function successDependentRow(parent: CoachingParentVerdict, own: { verdict: Verdict; detail: string }): { verdict: Verdict; detail: string } {
    if (parent.verdict !== 'EXTERNAL') return own;
    return { verdict: 'EXTERNAL', detail: 'not exercised: the coaching provider was unavailable (external, non-blocking per PO)' };
}

/**
 * The coaching failure telemetry the page SENT for one request (PM 6173420642 §2, 6174134686 §2). Both are required and
 * both are bound to the request's own `diagnostic_request_id`: its terminal `ai_coaching_diagnostic`, AND the app's
 * `practice_loop_review_failed` report, bound to that diagnostic by the page's provable same-boot emission order
 * (`bindFailureReports`, the existing authority). Whole-run counts are never used.
 *   • `bound`        — exactly one in-vocabulary report provably follows this request's failure diagnostic;
 *   • `absent`       — no report is bound to this request (including when its failure diagnostic never left) → FAIL;
 *   • `invalid`      — a report bound to it carried an out-of-vocabulary reason → FAIL;
 *   • `ambiguous`    — the order cannot be proven, or more than one report could be its → unproven (HOLD);
 *   • `unbindable`   — the request carried no diagnostic id → FAIL.
 */
export type FailureTelemetryBinding = 'bound' | 'absent' | 'invalid' | 'ambiguous' | 'unbindable';

export function failureTelemetryBinding(events: readonly ObservedEvent[], diagnosticRequestId: string | null): FailureTelemetryBinding {
    if (!diagnosticRequestId) return 'unbindable';
    const binding = bindFailureReports(events).get(diagnosticRequestId);
    if (!binding) return 'absent';
    return binding.state === 'bound' ? 'bound' : binding.state === 'observed_invalid' ? 'invalid' : 'ambiguous';
}

/**
 * The coaching telemetry row. Success requires completed + persisted + rendered (+ the review_rendered stage) —
 * unchanged. Under an EXTERNAL parent, only a `bound` failure report for this exact request is EXTERNAL; ambiguity is
 * unproven (HOLD); anything else is FAIL. Success events are never assumed.
 */
export function coachingTelemetryVerdict(parent: CoachingParentVerdict, failure: FailureTelemetryBinding,
    successVerdict: Verdict, successDetail: string,
    /**
     * Codex P1 r4277621594 (PM 6182054477): the FIRST take's `practice_loop_review_requested` proof, from the existing
     * first-take window and blind-beacon policy (`exactCountVerdict(count, 1, …)`): PASS = exactly one decoded request;
     * HOLD = an opaque beacon in that window leaves the count unproven; FAIL = none or more than one.
     */
    firstTakeRequest: 'PASS' | 'FAIL' | 'HOLD'): { verdict: Verdict; detail: string } {
    if (parent.verdict !== 'EXTERNAL') return { verdict: successVerdict, detail: successDetail };
    switch (failure) {
        case 'bound':
            if (firstTakeRequest === 'HOLD') return { verdict: 'HOLD', detail: 'the first take\'s review request event cannot be proven: an analytics beacon body in its window was not exposed by the browser' };
            // Anything but an explicit PASS fails closed (a missing proof is never a proved request).
            if (firstTakeRequest !== 'PASS') return { verdict: 'FAIL', detail: 'the first take\'s practice_loop_review_requested event did not leave the page exactly once' };
            return { verdict: 'EXTERNAL', detail: 'the first take\'s review request, this request\'s failure diagnostic and the app\'s failure report (bound by emission order) left the page; success telemetry not exercised — external provider outage' };
        case 'ambiguous':
            return { verdict: 'HOLD', detail: 'the app\'s failure report for this request cannot be proven (ambiguous emission order or more than one candidate)' };
        case 'invalid':
            return { verdict: 'FAIL', detail: 'the app\'s failure report for this request carried a reason outside its vocabulary' };
        case 'unbindable':
            return { verdict: 'FAIL', detail: 'the request carried no diagnostic id, so its failure telemetry cannot be bound to it' };
        default:
            return { verdict: 'FAIL', detail: 'the coaching provider was unavailable, but no app failure report bound to this exact request left the page' };
    }
}

/**
 * PM 6173420642 §3 / 6175763509 §1 — ONE TERMINAL EXCHANGE PER TAKE, from the EXISTING request-boundary authority
 * (`CoachingGenerationTap`): each coaching POST is joined to its own response by the request object and recorded once.
 *
 * One review lifecycle (one `diagnostic_request_id`) can legitimately make several POSTs: a `425 focus_results_pending`
 * answer is waited out and re-sent, and a network failure earns one automatic retry. (A provider 5xx does NOT — the page
 * treats `unavailable` as terminal.) So the take's exchanges are grouped by lifecycle and the TERMINAL attempt is selected
 * by declared authority, never by arrival order:
 *   • exactly one lifecycle for the saved take — several lifecycles are unproven (which one does the row describe?);
 *   • every exchange's server echo (`diagnostics.request_id` / `attempt_id`, when present) matches what was sent;
 *   • non-terminal attempts are dropped: a 425 wait, or a request with no answer (network failure);
 *   • the terminal attempt is the one with the highest declared `client_attempt`; two terminal answers at that attempt
 *     are duplicate terminal evidence → unproven.
 * Anything unresolved proves nothing (`unique: false`).
 */
const UNPROVEN = { evidence: { httpStatus: null, reason: null, providerStatus: null }, diagnosticRequestId: null, unique: false } as const;

export function takeExchangeEvidence(forSession: readonly CoachingExchange[]): {
    evidence: CoachingFailureEvidence;
    diagnosticRequestId: string | null;
    unique: boolean;
} {
    if (forSession.length === 0) return { ...UNPROVEN };
    const lifecycles = new Set(forSession.map((e) => e.sent.requestId));
    if (lifecycles.size !== 1) return { ...UNPROVEN };
    const lifecycle = forSession[0].sent.requestId;
    if (!lifecycle) return { ...UNPROVEN };
    const echoConflicts = forSession.some((e) => {
        const echoedRequest = e.diagnostics?.request_id;
        const echoedAttempt = e.diagnostics?.attempt_id;
        return (typeof echoedRequest === 'string' && echoedRequest !== lifecycle)
            || (typeof echoedAttempt === 'string' && e.sent.attemptId !== null && echoedAttempt !== e.sent.attemptId);
    });
    if (echoConflicts) return { ...UNPROVEN };
    const terminal = forSession.filter((e) => e.status !== null && e.status !== 425);
    if (terminal.length === 0) return { ...UNPROVEN };
    const attemptOf = (e: CoachingExchange) => e.sent.clientAttempt ?? 0;
    const last = Math.max(...terminal.map(attemptOf));
    const atLast = terminal.filter((e) => attemptOf(e) === last);
    if (atLast.length !== 1) return { ...UNPROVEN };
    // An answered attempt AFTER the terminal one would mean the lifecycle did not end there.
    if (forSession.some((e) => e.status !== null && attemptOf(e) > last)) return { ...UNPROVEN };
    const exchange = atLast[0];
    const reason = exchange.diagnostics?.reason;
    return {
        evidence: {
            httpStatus: exchange.status,
            // PM 6174134686 §1: ONLY the closed coaching failure vocabulary (else `unrecognized`) — a shape check would publish an
            // arbitrary slug into the receipt and the row detail. Absent diagnostics stay null; neither proves anything.
            reason: exchange.diagnostics ? coachingFailureReason({ reason }) ?? 'unrecognized' : null,
            providerStatus: providerStatusFrom({ diagnostics: exchange.diagnostics }),
        },
        diagnosticRequestId: lifecycle,
        unique: true,
    };
}

/**
 * Request provenance, judged on its own on every path (PM 6171519534 §4): PASS when an observed coaching request named
 * this saved take, FAIL when answered requests were observed but none named it, HOLD when none was observed.
 */
export function coachingRequestBindingRow(tap: { sentCount: number; exchanges: readonly CoachingExchange[]; forSession(id: string): CoachingExchange[] },
    sessionId: string): { verdict: Verdict; detail: string; bound: boolean | null } {
    if (tap.forSession(sessionId).length > 0) return { verdict: 'PASS', detail: 'the coaching request named this saved take', bound: true };
    if (tap.exchanges.length > 0) return { verdict: 'FAIL', detail: 'coaching requests were observed, but none named the saved take', bound: false };
    return { verdict: 'HOLD', detail: tap.sentCount > 0 ? 'the coaching request has no observed answer yet' : 'no coaching request was observed for this take', bound: null };
}

/**
 * #1258 (Codex P1 r4276817126) — what the take's persisted `ai_suggestions` column holds. ONLY a null/absent column is
 * a confirmed absence. A complete pair of non-blank strings is a saved pair; anything else (non-strings, blank strings,
 * one field, a non-object) is MALFORMED — an app persistence defect, never "absent" and never a provider outage.
 */
export type SavedCoachingState = { state: 'absent' } | { state: 'pair'; well: string; next: string } | { state: 'malformed' };

export function classifySavedCoaching(raw: unknown): SavedCoachingState {
    if (raw === null || raw === undefined) return { state: 'absent' };
    if (typeof raw !== 'object' || Array.isArray(raw)) return { state: 'malformed' };
    const { what_worked: well, what_to_try_next: next } = raw as { what_worked?: unknown; what_to_try_next?: unknown };
    if (typeof well === 'string' && typeof next === 'string' && well.trim() !== '' && next.trim() !== '') {
        return { state: 'pair', well: well.trim(), next: next.trim() };
    }
    return { state: 'malformed' };
}

/**
 * PM 6173420642 §1 — under an EXTERNAL Focus parent, the success-dependent rows are settled only after the exact
 * owner/session saved coaching is read: an answer saved for a failed request (whole, partial or malformed) is FAIL, an
 * unreadable read is HOLD (unproven) — never "not exercised". Only a confirmed ABSENCE (a null column) lets them be
 * "not exercised".
 */
export async function focusExternalDependentRows(
    parent: CoachingParentVerdict,
    readSavedCoaching: () => Promise<{ ok: true; raw: unknown } | { ok: false }>,
    /** Codex P1 r4277621600: confirmed VISIBLE absence of both phrases (`visibleCoachingAbsence`); null = unproven. */
    visibleCoachingAbsent: boolean | null,
): Promise<Array<{ step: string; verdict: Verdict; detail: string; evidence?: ReceiptRow['evidence'] }>> {
    if (parent.verdict !== 'EXTERNAL') return [];
    const read = await readSavedCoaching().catch(() => ({ ok: false as const }));
    const saved = read.ok ? classifySavedCoaching(read.raw) : null;
    const notExercised = successDependentRow(parent, { verdict: 'FAIL', detail: 'no coaching answer' });
    // Codex P1 r4276518654: the saved-coaching rows carry what the read proved — true only for a confirmed absence.
    const savedRows = (verdict: Verdict, detail: string) => {
        const savedCoachingAbsent = saved === null ? null : saved.state === 'absent';
        // Codex P1 r4277621600: "visible = saved" is "not exercised" only when NOTHING is shown either — a visible phrase
        // with nothing saved is the app's own defect (FAIL); an unproven visible read is HOLD.
        const visible = verdict !== notExercised.verdict ? { verdict, detail }
            : visibleCoachingAbsent === true ? { verdict, detail }
                : visibleCoachingAbsent === false ? { verdict: 'FAIL' as const, detail: 'a coaching phrase is visible but no coaching was saved for this take' }
                    : { verdict: 'HOLD' as const, detail: 'whether a coaching phrase is visible could not be read, so its absence is unproven' };
        return [
            { step: 'Focus coaching provenance', verdict, detail, evidence: { savedCoachingAbsent } },
            { step: 'Focus coaching visible = saved', ...visible, evidence: { savedCoachingAbsent, visibleCoachingAbsent } },
        ];
    };
    const answerRows = ['Focus coaching length', 'Focus coaching distinct', 'Focus coaching makes no omission claim', 'Focus coaching server receipt']
        .map((step) => ({ step, ...notExercised }));
    if (saved === null) return [...answerRows, ...savedRows('HOLD', 'the saved coaching for this take could not be read, so its absence is unproven')];
    if (saved.state === 'pair') return [...answerRows, ...savedRows('FAIL', 'a coaching response was saved for a request whose provider was unavailable')];
    if (saved.state === 'malformed') return [...answerRows, ...savedRows('FAIL', 'the saved coaching value is malformed (an app persistence defect), not absent')];
    return [...answerRows, ...savedRows(notExercised.verdict, notExercised.detail)];
}

/** True when a receipt row records a proved external coaching outcome (for summaries). */
export const isExternalRow = (r: ReceiptRow): boolean => r.verdict === 'EXTERNAL';
