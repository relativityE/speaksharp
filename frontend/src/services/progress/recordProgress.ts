/**
 * #1045 — the consumer that connects the Progress records to the real save journey.
 *
 * Thin wrappers over the guarded RPCs. All authority lives in the database (ownership, eligibility, the
 * clarity computation, lifecycle transitions) — these functions pass only ids, so a compromised or buggy
 * client can neither claim another user's session nor self-assert eligibility.
 *
 * WHEN TO CALL `recordProgressEvaluation`: ONLY after a session is fully persisted with its delivery
 * metrics AND its attribution has resolved to `verified`. Calling earlier would write an immutable
 * `ineligible / no_clarity_evidence` row that could never be corrected. `wireProgressEvaluationOnSave`
 * below is the single, deliberate seam; it is a no-op unless the save reached that state.
 */
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';
import { PROGRESS_FORMULA_VERSION, type ProgressEvaluation } from './buildProgressEvaluation';
import { buildTakeaways } from './progressPresentation';
import {
    enqueueProgressReconcile,
    getQueuedSessionIdsForUser,
    clearProgressReconcileEntry,
} from './progressReconcileQueue';
import { getOpenAttemptForUser, clearOpenAttempt, setOpenAttempt } from './openAttempt';

/** A minimal view of a persisted session — the fields the on-load reconciler needs. */
export interface ReconcilableSession {
    id: string;
    status?: string | null;
    attribution_status?: string | null;
    created_at?: string | null;
}

/** Record (or return the existing) Progress evaluation for a completed, metrics-persisted session. */
export async function recordProgressEvaluation(sessionId: string): Promise<string | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('record_progress_evaluation', { p_session_id: sessionId });
    if (error) {
        // Progress recording must NEVER break the save journey — log and move on.
        logger.warn({ error, sessionId }, '[progress] record_progress_evaluation failed (non-fatal)');
        return null;
    }
    return (data as string | null) ?? null;
}

/**
 * Create the immutable recommendation tied to an eligible evaluation of the caller's own session. The
 * source metric value is NOT passed — the RPC DERIVES it from the persisted evaluation, so a later
 * comparison is always against the number the evaluation actually recorded (never a client value).
 */
export async function recordProgressRecommendation(args: {
    sourceSessionId: string;
    targetMetric: 'filler_rate' | 'pace' | 'clear_delivery';
    targetDirection: 'decrease' | 'increase' | 'maintain';
    targetValue: number;
    targetUnits: string;
    shownText: string;
}): Promise<string | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('record_progress_recommendation', {
        p_source_session_id: args.sourceSessionId,
        p_target_metric: args.targetMetric,
        p_target_direction: args.targetDirection,
        p_target_value: args.targetValue,
        p_target_units: args.targetUnits,
        p_shown_text: args.shownText,
    });
    if (error) { logger.warn({ error }, '[progress] record_progress_recommendation failed'); return null; }
    return (data as string | null) ?? null;
}

/** Accept a recommendation ("Practice this next"): create one pending attempt. */
export async function recordRecommendationAttempt(recommendationId: string): Promise<string | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('record_recommendation_attempt', {
        p_recommendation_id: recommendationId,
    });
    if (error) { logger.warn({ error }, '[progress] record_recommendation_attempt failed'); return null; }
    return (data as string | null) ?? null;
}

export type PendingAttemptReadback =
    | { status: 'none' }
    | { status: 'one'; attemptId: string }
    | { status: 'blocked' };

/** Owner-scoped/RLS readback used before retrying acceptance after an uncertain RPC response. */
export async function readPendingRecommendationAttempt(recommendationId: string): Promise<PendingAttemptReadback> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('progress_recommendation_attempts')
        .select('id, recommendation_id, lifecycle')
        .eq('recommendation_id', recommendationId)
        .eq('lifecycle', 'pending')
        .limit(2);
    if (error || !data) return { status: 'blocked' };
    const matches = (data as Array<{ id?: unknown; recommendation_id?: unknown; lifecycle?: unknown }>)
        .filter((row) => typeof row.id === 'string'
            && row.recommendation_id === recommendationId && row.lifecycle === 'pending');
    if (matches.length === 0) return { status: 'none' };
    if (matches.length !== 1) return { status: 'blocked' };
    return { status: 'one', attemptId: matches[0].id as string };
}

/**
 * Advance an attempt through a validated lifecycle transition. The OUTCOME is never supplied by the client
 * — the RPC derives `moved`/`did_not_move` by comparing the recommendation's recorded source value against
 * the next eligible, same-cohort evaluation, and returns the derived outcome (null on failure).
 */
export async function advanceRecommendationAttempt(args: {
    attemptId: string;
    lifecycle: 'completed' | 'not_comparable' | 'abandoned';
    practiceSessionId?: string | null;
    nextComparableSessionId?: string | null;
}): Promise<string | null> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('advance_recommendation_attempt', {
        p_attempt_id: args.attemptId,
        p_lifecycle: args.lifecycle,
        p_practice_session_id: args.practiceSessionId ?? null,
        p_next_comparable_session_id: args.nextComparableSessionId ?? null,
    });
    if (error) { logger.warn({ error }, '[progress] advance_recommendation_attempt failed'); return null; }
    return (data as string | null) ?? null;
}

type AttemptAdvanceResult =
    | { ok: true; outcome: string }
    | { ok: false; kind: 'not_comparable' | 'technical' };

async function advanceRecommendationAttemptResult(args: Parameters<typeof advanceRecommendationAttempt>[0]): Promise<AttemptAdvanceResult> {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('advance_recommendation_attempt', {
        p_attempt_id: args.attemptId,
        p_lifecycle: args.lifecycle,
        p_practice_session_id: args.practiceSessionId ?? null,
        p_next_comparable_session_id: args.nextComparableSessionId ?? null,
    });
    if (!error && data) return { ok: true, outcome: data as string };
    const message = typeof error === 'object' && error && 'message' in error ? String(error.message) : '';
    const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
    const authoritativeMismatch = code === '22023' && message.includes('use not_comparable');
    const alreadyTerminal = code === '22023' && message.includes('attempt already resolved');
    if (alreadyTerminal) {
        const { data: row, error: readError } = await supabase
            .from('progress_recommendation_attempts')
            .select('id, lifecycle, outcome, practice_session_id, next_comparable_session_id')
            .eq('id', args.attemptId)
            .maybeSingle();
        if (!readError && row && row.id === args.attemptId) {
            const practiceMatches = row.practice_session_id === (args.practiceSessionId ?? null);
            const completed = row.lifecycle === 'completed'
                && practiceMatches
                && row.next_comparable_session_id === (args.nextComparableSessionId ?? null)
                && (row.outcome === 'moved' || row.outcome === 'did_not_move');
            const notComparable = row.lifecycle === 'not_comparable'
                && practiceMatches && row.outcome === 'not_comparable';
            const abandoned = row.lifecycle === 'abandoned';
            if (completed || notComparable || abandoned) return { ok: true, outcome: String(row.outcome ?? row.lifecycle) };
        }
    }
    logger.warn({ error, attemptId: args.attemptId }, '[progress] advance_recommendation_attempt failed');
    return { ok: false, kind: authoritativeMismatch ? 'not_comparable' : 'technical' };
}

/** Terminally abandon a server attempt when its local handoff could not be established. */
export async function abandonRecommendationAttempt(attemptId: string): Promise<boolean> {
    const result = await advanceRecommendationAttemptResult({ attemptId, lifecycle: 'abandoned' });
    return result.ok;
}

/** #1033 attribution reaches a TERMINAL state at `verified` or `unverified` (`pending` is not terminal). */
function isTerminalAttribution(status: string | null | undefined): boolean {
    return status === 'verified' || status === 'unverified';
}

/**
 * Record the evaluation, retrying a NONFATAL failure a few times. Progress recording must never break the
 * save journey, but a transient RPC error must not silently drop the record either. The RPC is idempotent
 * per (session, formula_version), so a retry can never create a duplicate.
 */
async function recordProgressEvaluationWithRetry(sessionId: string, attempts = 3): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
        const id = await recordProgressEvaluation(sessionId);
        if (id) return id;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
    return null;
}

/**
 * If the persisted evaluation is ELIGIBLE, derive the deterministic recommendation from it and record it.
 * The action (metric + direction + target + copy) comes from the provisional policy in
 * `buildTakeaways`; the SOURCE metric value is derived server-side by the RPC. No-op when the evaluation
 * is missing or ineligible (an ineligible session has no comparison and no action to record).
 */
export async function reconcileProgressRecommendation(sessionId: string): Promise<string | null> {
    const supabase = getSupabaseClient();
    const readExisting = async (): Promise<string | null> => {
        const { data, error } = await supabase
            .from('progress_recommendations')
            .select('id')
            .eq('source_session_id', sessionId)
            .eq('formula_version', PROGRESS_FORMULA_VERSION)
            .maybeSingle();
        if (error) return null;
        return typeof (data as { id?: unknown } | null)?.id === 'string'
            ? (data as { id: string }).id
            : null;
    };

    // Avoid a duplicate write on ordinary retries. The RPC also enforces uniqueness, so a concurrent
    // creator remains safe; the final readback is the authority for both normal and lost-success replies.
    const existingId = await readExisting();
    if (existingId) return existingId;

    const { data, error } = await supabase
        .from('session_progress_evaluations')
        .select('eligible, word_count, filler_count, wpm, clarity_raw, cohort_key, engine, engine_version, model_name, attribution_status')
        .eq('session_id', sessionId)
        .eq('formula_version', PROGRESS_FORMULA_VERSION)
        .maybeSingle();
    if (error || !data || !data.eligible) return null;

    const current: ProgressEvaluation = {
        sessionId,
        userId: '',
        formulaVersion: PROGRESS_FORMULA_VERSION,
        snapshotOrigin: 'at_save',
        durationSeconds: 0,
        wordCount: data.word_count ?? 0,
        clarityEvidenceAvailable: true,
        engine: data.engine ?? null,
        engineVersion: data.engine_version ?? null,
        modelName: data.model_name ?? null,
        attributionStatus: data.attribution_status ?? null,
        eligible: true,
        exclusionReasons: [],
        clarityRaw: data.clarity_raw ?? null,
        fillerCount: data.filler_count ?? null,
        errorMarkerCount: null,
        wpm: data.wpm ?? null,
        cohortKey: data.cohort_key ?? null,
    };

    const { target, practiceThisNext } = buildTakeaways(current, null);
    await recordProgressRecommendation({
        sourceSessionId: sessionId,
        targetMetric: target.metric,
        targetDirection: target.direction,
        targetValue: target.targetValue,
        targetUnits: target.units,
        shownText: practiceThisNext,
    });
    return readExisting();
}

async function recordRecommendationForEvaluation(sessionId: string): Promise<void> {
    await reconcileProgressRecommendation(sessionId);
}

/**
 * The single deliberate wiring seam into the completed-session save journey. Call this once the session's
 * delivery metrics are persisted AND its attribution has reached a TERMINAL state (`verified` or
 * `unverified`) — NOT while attribution is still `pending`, which would write a premature immutable row.
 *
 * Every completed future session then receives a record: an ELIGIBLE evaluation (verified) OR an
 * AUDITABLE EXCLUSION (e.g. unverified → `unverified_attribution`). The RPC decides eligibility and is
 * idempotent, so this may be invoked defensively (including from attribution-retry resolution).
 */
export async function wireProgressEvaluationOnSave(ctx: {
    sessionId: string | null | undefined;
    status: string | null | undefined;
    attributionStatus: string | null | undefined;
    metricsPersisted: boolean;
    userId?: string | null;
}): Promise<void> {
    if (!ctx.sessionId) return;
    if (ctx.status !== 'completed') return;
    if (!ctx.metricsPersisted) return;
    if (!isTerminalAttribution(ctx.attributionStatus)) return; // still pending — defer, do not write early
    const evalId = await recordProgressEvaluationWithRetry(ctx.sessionId);
    if (!evalId) {
        // In-memory retries exhausted. DURABLY queue the session so a later authenticated load reattempts
        // it — a closed tab or longer outage must not permanently drop the immutable record. Owner-scoped.
        if (ctx.userId) enqueueProgressReconcile(ctx.sessionId, ctx.userId, new Date().toISOString());
        return;
    }
    if (ctx.userId) clearProgressReconcileEntry(ctx.sessionId, ctx.userId);
    await recordRecommendationForEvaluation(ctx.sessionId);
    if (ctx.userId) await resolveOpenAttemptWith(ctx.userId, ctx.sessionId);
}

/**
 * Close the "Practice this next" loop: if the user accepted a recommendation and has now saved a new
 * session, resolve that pending attempt against this session. The RPC derives the outcome and enforces
 * comparability; when the new session is not an eligible same-cohort comparison the attempt is resolved as
 * `not_comparable` — either way the practice session is associated and the attempt is closed exactly once.
 */
async function resolveOpenAttemptWith(userId: string, newSessionId: string): Promise<void> {
    const open = getOpenAttemptForUser(userId);
    if (!open || open.sourceSessionId === newSessionId) return; // never resolve a recommendation against itself
    const resolutionSessionId = open.resolutionSessionId ?? newSessionId;
    if (!open.resolutionSessionId && !setOpenAttempt({ ...open, resolutionSessionId })) {
        logger.warn({ attemptId: open.attemptId, resolutionSessionId }, '[progress] resolution binding could not be persisted');
        return;
    }
    const result = await advanceRecommendationAttemptResult({
        attemptId: open.attemptId,
        lifecycle: 'completed',
        practiceSessionId: resolutionSessionId,
        nextComparableSessionId: resolutionSessionId,
    });
    if (!result.ok && result.kind === 'not_comparable') {
        const terminal = await advanceRecommendationAttemptResult({
            attemptId: open.attemptId,
            lifecycle: 'not_comparable',
            practiceSessionId: resolutionSessionId,
        });
        if (terminal.ok) clearOpenAttempt();
        return;
    }
    // Technical/storage/network failure remains pending and retryable; never falsify it as a speaking result.
    if (result.ok) clearOpenAttempt();
}

/**
 * DURABLE on-load recovery. Called once per authenticated user after their session list is available.
 *
 * Two layers, both idempotent (the RPC no-ops on an already-recorded session):
 *  1. Drains the owner-scoped localStorage queue — sessions a save KNEW it failed to record (incl. the
 *     first-ever session, before any evaluation exists).
 *  2. A bounded sweep of the loaded sessions: records any completed + terminal-attribution session that has
 *     no evaluation yet, but ONLY within the ACTIVE ERA (created at/after the earliest existing evaluation)
 *     so pre-activation history is never retro-fitted (§5 future-only). Capped; the remainder carries over.
 */
export async function reconcileProgressEvaluations(
    userId: string,
    sessions: ReconcilableSession[],
): Promise<{ queueDrained: number; swept: number }> {
    let queueDrained = 0;

    // Reload reconciliation retries the exact durable attempt/repeat pair before considering later saves.
    const pendingResolution = getOpenAttemptForUser(userId)?.resolutionSessionId;
    if (pendingResolution) await resolveOpenAttemptWith(userId, pendingResolution);

    // ── Layer 1: drain the durable Open Mic queue (transient eval failures) for this user. ──
    for (const sessionId of getQueuedSessionIdsForUser(userId)) {
        const id = await recordProgressEvaluation(sessionId);
        if (id) {
            clearProgressReconcileEntry(sessionId, userId);
            queueDrained++;
            await recordRecommendationForEvaluation(sessionId);
        }
    }

    // #1265: the generic active-era sweep was REMOVED. It evaluated any completed session missing an
    // evaluation, but it CANNOT positively identify the practice mode before writing the IMMUTABLE
    // evaluation — so a Focus Points recording whose objective registration failed or was unconfirmed could
    // be permanently stamped 'freeform'. "No evaluation" is safer than false provenance. Recovery is limited
    // to the owner-scoped durable queue above, which is authoritative about mode by construction: a Focus
    // Points session is enqueued ONLY after its objective registration succeeds (so a later re-evaluation is
    // correctly cohorted 'objective' — record_progress_evaluation reads objective_source_recording), while a
    // registration failure writes and enqueues nothing. There is no objective-registration retry in this MVP,
    // so a failed registration means Progress is simply unavailable for that take — never mislabeled.
    void sessions; // retained for API compatibility; no longer swept (see above)
    return { queueDrained, swept: 0 };
}
