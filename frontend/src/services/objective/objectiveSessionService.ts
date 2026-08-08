/**
 * #1046 G2 slice 3b — Focus Points session client seam (register → start → finalize).
 *
 * Thin wrappers over the three server steps that turn a finished Private recording into a scored
 * Focus Points session:
 *   1. registerObjectiveSource — calls the `objective-register-source` Edge Function, the trusted
 *      server seam that stamps the recording objective-eligible (service-role; the browser cannot
 *      self-stamp). Required before start.
 *   2. startObjectiveSession — `objective_start_session_v1`: creates the immutable objective_session
 *      bound to the brief + source recording. Detector = the approved predicate so missing points read
 *      an honest "not detected" (not "unavailable"); formula is the only supported v1 selector.
 *   3. finalizeObjectiveEvidence — `objective_finalize_evidence_v1`: records per-point verdicts from
 *      the client-computed detection offsets (see objectiveCoverage.ts). Server derives detected/
 *      not_detected/unavailable; it never sees the transcript.
 *
 * All authority is server-side. Failures return a typed result / null so callers never fabricate a
 * scored session; SQLSTATE codes map to a stable, PII-free reason.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import type { ObjectiveFinalizeSignal } from './objectiveCoverage';

/** The approved coverage predicate — matching `objective_approved_predicate_version()` ('cue_v1'). A
 *  session started under this detector yields honest not_detected verdicts for uncovered points. */
export const OBJECTIVE_DETECTOR_VERSION = 'cue_v1';
/** The only action-selector formula `objective_start_session_v1` accepts. */
export const OBJECTIVE_FORMULA_VERSION = 'objective_action_v1';

export type ObjectiveSessionFailureReason = 'capability' | 'validation' | 'auth' | 'ineligible' | 'error';

function reasonFromError(error: { code?: string } | null | undefined): ObjectiveSessionFailureReason {
    switch (error?.code) {
        case '42501': return 'capability';
        case '28000': return 'auth';
        case '22023': return 'validation';
        default: return 'error';
    }
}

/**
 * Stamp the recording objective-eligible via the Edge Function. Returns ok:false with a reason on any
 * failure (most commonly the recording is not verified-Private → 'ineligible'). Never throws.
 */
export async function registerObjectiveSource(
    sourceSessionId: string,
): Promise<{ ok: boolean; reason?: ObjectiveSessionFailureReason }> {
    try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.functions.invoke('objective-register-source', {
            body: { sessionId: sourceSessionId },
        });
        if (error || !(data as { registered?: boolean } | null)?.registered) {
            logger.warn({ error }, '[objectiveSession] register-source rejected');
            // The Edge Function returns 422 for an ineligible (non-Private) recording; treat any
            // non-registered outcome as ineligible for the caller's purposes (honest fail).
            return { ok: false, reason: 'ineligible' };
        }
        return { ok: true };
    } catch (err) {
        logger.warn({ err }, '[objectiveSession] register-source threw');
        return { ok: false, reason: 'error' };
    }
}

/**
 * Start the objective session for a registered source recording. Returns the objective_session id, or
 * null with a reason on failure. Idempotent by (user, idempotencyKey) server-side.
 */
export async function startObjectiveSession(args: {
    projectId: string;
    briefId: string;
    sourceSessionId: string;
    idempotencyKey: string;
}): Promise<{ ok: boolean; sessionId?: string; reason?: ObjectiveSessionFailureReason }> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('objective_start_session_v1', {
        p_project_id: args.projectId,
        p_brief_id: args.briefId,
        p_source_session_id: args.sourceSessionId,
        p_detector_version: OBJECTIVE_DETECTOR_VERSION,
        p_formula_version: OBJECTIVE_FORMULA_VERSION,
        p_idempotency_key: args.idempotencyKey,
    });
    if (error || !data) {
        logger.warn({ error }, '[objectiveSession] start_session failed');
        return { ok: false, reason: reasonFromError(error) };
    }
    return { ok: true, sessionId: data as string };
}

/**
 * Record per-point verdicts from the client-computed detection offsets. Returns the evidence row count,
 * or null on failure. The RPC rejects the WHOLE payload if any offset is outside [0, duration] — the
 * bridge (objectiveCoverage.ts) clamps offsets to guarantee that.
 */
export async function finalizeObjectiveEvidence(
    objectiveSessionId: string,
    signals: ObjectiveFinalizeSignal[],
): Promise<number | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('objective_finalize_evidence_v1', {
        p_session_id: objectiveSessionId,
        p_signals: signals,
    });
    if (error) {
        logger.warn({ error }, '[objectiveSession] finalize_evidence failed');
        return null;
    }
    return (data as number | null) ?? null;
}
