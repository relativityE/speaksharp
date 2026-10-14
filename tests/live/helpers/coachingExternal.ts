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
 * The coaching telemetry the page SENT. Success requires completed + persisted + rendered (+ the review_rendered stage).
 * Under an EXTERNAL parent the failure path must instead have sent `requested` and `failed`: then EXTERNAL; missing → FAIL.
 * Success events are never assumed.
 */
export function coachingTelemetryVerdict(parent: CoachingParentVerdict, sent: {
    requested: number; completed: number; persisted: number; rendered: number; failed: number; reviewRenderedStage: number;
}, successVerdict: Verdict, successDetail: string): { verdict: Verdict; detail: string } {
    if (parent.verdict !== 'EXTERNAL') return { verdict: successVerdict, detail: successDetail };
    return sent.requested > 0 && sent.failed > 0
        ? { verdict: 'EXTERNAL', detail: 'the failure path left the page (review requested and failed); success telemetry not exercised — external provider outage' }
        : { verdict: 'FAIL', detail: 'the coaching provider was unavailable, but the failure outcome (requested + failed) did not leave the page' };
}

/** True when a receipt row records a proved external coaching outcome (for summaries). */
export const isExternalRow = (r: ReceiptRow): boolean => r.verdict === 'EXTERNAL';
