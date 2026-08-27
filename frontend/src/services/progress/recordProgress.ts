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
import { useSessionStore } from '@/stores/useSessionStore';
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
/**
 * #1354 — per-attempt NETWORK DEADLINE.
 *
 * Three attempts bound the COUNT, not the TIME. A `supabase.rpc(...)` promise that never settles — a
 * dead connection, a proxy holding the socket open — would hang the whole completion path: the session
 * never finishes saving, the gate stays `resolving` forever, and the user can neither record again nor
 * reach the durable retry that exists precisely for this case. An unbounded await is the one failure
 * the bounded-attempt loop cannot recover from.
 *
 * The obligation is already written and readback-verified BEFORE any attempt runs, so timing out is
 * safe: the debt survives, reconciliation retries it, and the seam reports `queued` rather than pretending.
 */
export const PROGRESS_RPC_ATTEMPT_TIMEOUT_MS = 10_000;

/**
 * Resolve to `null` if `work` has not settled within `ms`.
 *
 * NOTE: this bounds the WAIT, not the request — the underlying call is not cancelled, because it is
 * issued inside the Supabase client and we hold no AbortController for it. A late resolution is simply
 * ignored; it cannot unlock anything, since the gate is published from the value we actually returned.
 */
async function withAttemptDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

async function recordProgressEvaluationWithRetry(sessionId: string, attempts = 3): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
        const id = await withAttemptDeadline(recordProgressEvaluation(sessionId), PROGRESS_RPC_ATTEMPT_TIMEOUT_MS);
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
/**
 * #1354 — the seam's BEHAVIOURAL result.
 *
 * The previous signature was `Promise<void>` and every caller was fire-and-forget, so "the evaluation
 * is durably recorded" was indistinguishable from "the call was made and something happened". That is
 * what let a third recording start while an older session's Progress evidence was still in flight, and
 * the server then correctly refused to retain the new transcript under strict newest-two.
 *
 * Durability is REPORTED, never inferred from the absence of an exception.
 *
 * Content-free by construction: only these discriminants and an optional accepted-reason token cross
 * this boundary — never transcript text, error bodies, or customer content.
 *
 * DELIBERATE DEVIATION from #1354's "at least" list: there is no `already_present` discriminant.
 * `record_progress_evaluation` is idempotent and returns the SAME id whether it created the row or
 * found it, and no client-side read of `progress_evaluations` exists — so the two are indistinguishable
 * here without adding a query and a round-trip to every save. They are also behaviourally identical for
 * this gate: both mean a terminal evaluation is durable, and both unlock the recorder. Shipping a
 * variant that can never occur would be unreachable and therefore unfalsifiable, which is the exact
 * pattern this ticket's falsification requirements exist to eliminate. Flagged for PM acceptance.
 */
export type ProgressEvaluationOutcome =
    /** A terminal evaluation is durably recorded. The next recording may start. */
    | { kind: 'recorded' }
    /** Durably queued for reconciliation. The next recording must NOT start; surface an actionable retry. */
    | { kind: 'queued' }
    /** No evaluation is owed, for an explicitly accepted terminal reason. The next recording may start. */
    | { kind: 'not_applicable'; reason: ProgressNotApplicableReason }
    /** Unknown / still resolving / failed WITHOUT a durable queue. Fail closed: block the next recording. */
    | { kind: 'unresolved'; reason: ProgressUnresolvedReason };

export type ProgressNotApplicableReason = 'not_completed';
export type ProgressUnresolvedReason =
    | 'missing_session'
    | 'metrics_not_persisted'
    | 'attribution_not_terminal'
    | 'queue_unavailable';

/**
 * `not_applicable` and `unresolved` are BOTH "no evaluation was written", and only the first may unlock
 * the recorder. Keeping them as distinct discriminants is the point: a session that legitimately owes no
 * evaluation is not the same as one whose evaluation we simply could not resolve, and collapsing them
 * would silently re-open the defect.
 */
export function progressOutcomeAllowsNextRecording(o: ProgressEvaluationOutcome): boolean {
    return o.kind === 'recorded' || o.kind === 'not_applicable';
}

/**
 * The single deliberate wiring seam into the completed-session save journey. Call this once the session's
 * delivery metrics are persisted AND its attribution has reached a TERMINAL state (`verified` or
 * `unverified`) — NOT while attribution is still `pending`, which would write a premature immutable row.
 *
 * Every completed future session then receives a record: an ELIGIBLE evaluation (verified) OR an
 * AUDITABLE EXCLUSION (e.g. unverified -> `unverified_attribution`). The RPC decides eligibility and is
 * idempotent, so this may be invoked defensively (including from attribution-retry resolution).
 */
export async function wireProgressEvaluationOnSave(ctx: {
    sessionId: string | null | undefined;
    status: string | null | undefined;
    attributionStatus: string | null | undefined;
    metricsPersisted: boolean;
    userId?: string | null;
}): Promise<ProgressEvaluationOutcome> {
    if (!ctx.sessionId) return { kind: 'unresolved', reason: 'missing_session' };
    // An aborted/incomplete session owes no evaluation — an accepted terminal reason, so it unlocks.
    if (ctx.status !== 'completed') return { kind: 'not_applicable', reason: 'not_completed' };
    // Without durable metrics there is nothing to evaluate AND nothing to queue: fail closed.
    if (!ctx.metricsPersisted) return { kind: 'unresolved', reason: 'metrics_not_persisted' };
    // Still resolving. Deferring is correct, but it is NOT terminal, so it must not unlock the recorder.
    if (!isTerminalAttribution(ctx.attributionStatus)) {
        return { kind: 'unresolved', reason: 'attribution_not_terminal' };
    }

    // #1354 WRITE-AHEAD OBLIGATION. The debt is recorded BEFORE the attempt, not after it fails.
    //
    // The previous order — evaluate, then queue only on failure — lost the obligation in two ways.
    // If the tab closed or crashed mid-evaluation nothing had been written, so a reload found an empty
    // queue and concluded nothing was owed. And when the evaluation failed AND the enqueue also failed,
    // the only record was an in-memory gate that a reload erased. In both cases ABSENCE OF AN ENTRY was
    // being read as PROOF OF COMPLETION, which it never was: the session may still owe evidence.
    //
    // Writing first inverts that. From here on, an entry means "this session owes evidence until proven
    // otherwise", and only a VERIFIED removal after terminal evidence may retire it.
    const obligation = ctx.userId
        ? enqueueProgressReconcile(ctx.sessionId, ctx.userId, new Date().toISOString())
        : ({ ok: false } as const);

    const evalId = await recordProgressEvaluationWithRetry(ctx.sessionId);
    if (!evalId) {
        // The evaluation failed. Whether this is retryable depends ENTIRELY on whether the obligation
        // is durable: `queued` promises a retry, so it may only be claimed when one can actually run.
        // Without a durable obligation there is no record of the debt at all — fail closed.
        return obligation.ok
            ? { kind: 'queued' }
            : { kind: 'unresolved', reason: 'queue_unavailable' };
    }
    // A failed CLEAR leaves a stale debt that would re-block a later load, so it is reported: the
    // evaluation is durable, but the queue state is not trustworthy — fail closed on UNLOCKING.
    //
    // It must not, however, skip the downstream work. #1354: evaluation durability — not recommendation
    // creation — controls unlocking, so the recommendation and attempt resolution still run and their
    // outcomes never gate the recorder. An earlier version of this returned early on a failed clear and
    // silently dropped both, which would have made a storage hiccup cost the user their recommendation.
    // Retire the obligation ONLY now that terminal evidence exists — and only if we actually wrote one.
    const cleared = ctx.userId && obligation.ok
        ? clearProgressReconcileEntry(ctx.sessionId, ctx.userId)
        : ({ ok: true } as const);
    await recordRecommendationForEvaluation(ctx.sessionId);
    if (ctx.userId) await resolveOpenAttemptWith(ctx.userId, ctx.sessionId);
    if (!cleared.ok) return { kind: 'unresolved', reason: 'queue_unavailable' };
    return { kind: 'recorded' };
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
 * One authoritative, idempotent recovery path: drain the owner-scoped localStorage queue for sessions whose
 * save path established mode + rich-metrics persistence and then observed a transient evaluation failure.
 * There is deliberately no generic session sweep: absence alone cannot prove a recording's practice mode.
 */
/**
 * Clear the visible gate for one resolved (session, owner) pair.
 *
 * Owner- AND session-scoped: another account's reconciliation, or a different session's, must never
 * unlock the gate a live session is holding.
 */
function releaseProgressGateFor(sessionId: string, userId: string): void {
    const store = useSessionStore.getState();
    const gate = store.progressGate;
    if (gate && gate.sessionId === sessionId && gate.ownerId === userId) store.setProgressGate(null);
}

export async function reconcileProgressEvaluations(
    userId: string,
    sessions: ReconcilableSession[],
): Promise<{ queueDrained: number; swept: number }> {
    let queueDrained = 0;

    // Reload reconciliation retries the exact durable attempt/repeat pair before considering later saves.
    const pendingResolution = getOpenAttemptForUser(userId)?.resolutionSessionId;
    if (pendingResolution) await resolveOpenAttemptWith(userId, pendingResolution);

    // ── Layer 1: drain the durable Open Mic queue (transient eval failures) for this user. ──
    // An UNREADABLE queue is not an empty one. Draining zero entries because storage is unavailable or
    // corrupt would report a clean reconciliation while real Progress debts remain, so the read result
    // is inspected rather than coerced to a list.
    const queued = getQueuedSessionIdsForUser(userId);
    if (!queued.ok) {
        logger.warn({ failure: queued.failure }, '[progress] reconcile queue unreadable — not draining');
    }
    for (const sessionId of (queued.ok ? queued.sessionIds ?? [] : [])) {
        const id = await recordProgressEvaluation(sessionId);
        if (!id) continue; // still failing — the debt stays queued and the gate stays blocked
        // #1354: the clear must be VERIFIED before this counts as drained. An entry that could not be
        // removed survives the next reload, so reporting a clean drain would unlock the recorder on a
        // debt that still exists. The result was previously discarded.
        const cleared = clearProgressReconcileEntry(sessionId, userId);
        if (!cleared.ok) {
            logger.warn({ failure: cleared.failure }, '[progress] evaluation recorded but queue clear FAILED');
            continue;
        }
        queueDrained++;
        // Release the VISIBLE gate only now, and only if it belongs to this exact owner+session.
        // Without this the user stays blocked after a successful retry — the debt is gone but the UI
        // still says otherwise.
        releaseProgressGateFor(sessionId, userId);
        await recordRecommendationForEvaluation(sessionId);
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
