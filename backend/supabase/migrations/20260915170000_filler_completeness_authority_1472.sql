-- #1472 — persisted filler-evidence completeness authority (additive). NOT applied to Production by merging.
--
-- WHAT: sessions.filler_completeness, a CLOSED state ('complete' | 'unobservable' | 'no_speech'), written by the one
-- authoritative completion RPC. An empty filler map cannot say whether a zero was observed; this column is the
-- separate authority every consumer (Session, Analytics, PDF, Progress, telemetry) reads instead of guessing.
--
-- LEGACY: the column is NULLABLE with no default and no backfill. Every existing row, and every save from a client
-- older than this migration, stays NULL, and consumers treat NULL as unobservable (fail closed). Historical `{}` rows
-- are never promoted to a verified zero.
--
-- FUNCTION: complete_session_v2 gains ONE trailing argument, p_filler_completeness TEXT DEFAULT NULL. The 11-argument
-- overload is DROPPED first, so PostgREST can never resolve a call against two candidates. Body generated from
-- 20260908120000_transcript_retention_newest_one.sql with four asserted replacements (signature, strict
-- idempotency, closed-state validation, session write); everything else is verbatim, and the three grants are
-- restated on the new signature.
--
-- ROLLOUT (no deploy deadlock):
--   old client + new DB: works — its 11 named arguments resolve to the 12-argument function (the new one defaults NULL).
--   new client + old DB: FAILS (PostgREST cannot find p_filler_completeness). So this migration is applied, under a
--   separate exact Product Owner authorization, BEFORE any client that sends the argument is deployed.
--
-- ROLLBACK: DROP FUNCTION public.complete_session_v2(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION,
--   JSONB, JSONB, TEXT, TEXT); re-run the 11-argument definition and its three grants from 20260908120000; then
--   ALTER TABLE public.sessions DROP COLUMN filler_completeness (only after every client stops sending the argument).

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS filler_completeness TEXT
    CONSTRAINT sessions_filler_completeness_closed
        CHECK (filler_completeness IS NULL OR filler_completeness IN ('complete', 'unobservable', 'no_speech'));

DROP FUNCTION IF EXISTS public.complete_session_v2(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.complete_session_v2(
    p_session_id UUID,
    p_status TEXT DEFAULT 'completed',
    p_final_duration INT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_next_action JSONB DEFAULT NULL,
    p_total_words INT DEFAULT NULL,
    p_clarity_score DOUBLE PRECISION DEFAULT NULL,
    p_wpm DOUBLE PRECISION DEFAULT NULL,
    p_filler_counts JSONB DEFAULT NULL,
    p_pause_metrics JSONB DEFAULT NULL,
    p_final_transcript TEXT DEFAULT NULL,
    p_filler_completeness TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_session public.sessions%ROWTYPE;
    v_effective_tier TEXT;
    v_final_duration INT;
    v_retention JSONB := NULL;
    v_idempotent BOOLEAN := false;
    v_eligible BOOLEAN := false;
    v_wrote_transcript BOOLEAN := false;
    v_retention_status TEXT := NULL;
    v_effective_status TEXT;
    v_outcome TEXT;
BEGIN
    -- OWNERSHIP + SERIALIZATION. Locking the caller's own profile row is what serializes concurrent completions
    -- for a user, and it is the SAME row converge_transcript_retention locks, so retention inherits the lock
    -- rather than taking a second one and risking a different acquisition order.
    SELECT public.effective_subscription_tier(
        subscription_status, trial_expires_at, stripe_subscription_id, subscription_id, commercial_trial_granted_at
    ) INTO v_effective_tier FROM public.user_profiles WHERE id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'profile_not_found'); END IF;

    -- Ownership is enforced by the predicate, not by a client-supplied user id: another user's session id is
    -- indistinguishable from a nonexistent one.
    SELECT * INTO v_session FROM public.sessions
    WHERE id = p_session_id AND user_id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_not_found'); END IF;

    IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN
        RETURN jsonb_build_object('success', false, 'error', 'trial_expired');
    END IF;

    -- BOUND THE TRANSCRIPT BEFORE ANYTHING ELSE, on BOTH axes. Rejected, never truncated.
    IF p_final_transcript IS NOT NULL THEN
        IF length(p_final_transcript) > public.max_persisted_transcript_chars() THEN
            RAISE EXCEPTION '#1314: transcript exceeds the persisted character limit'
                USING ERRCODE = '22001';   -- string_data_right_truncation
        END IF;
        IF octet_length(p_final_transcript) > public.max_persisted_transcript_bytes() THEN
            RAISE EXCEPTION '#1314: transcript exceeds the persisted byte limit'
                USING ERRCODE = '54000';   -- program_limit_exceeded
        END IF;
    END IF;

    v_final_duration := LEAST(600, GREATEST(0, COALESCE(p_final_duration, v_session.duration, 0)));

    IF v_session.status = 'completed' THEN
        -- STRICT idempotency: an identical replay is a no-op; ANY mismatch conflicts, never a partial update.
        -- A NULL parameter means "unchanged", so a retry that omits a field never conflicts. The transcript
        -- participates on exactly the same terms as every metric — otherwise a replay carrying different text
        -- would silently overwrite what the user already has.
        IF p_status = v_session.status
           AND v_final_duration IS NOT DISTINCT FROM v_session.duration
           AND COALESCE(p_reason, v_session.status_reason) IS NOT DISTINCT FROM v_session.status_reason
           AND p_next_action IS NOT DISTINCT FROM v_session.next_action_signal
           AND COALESCE(p_total_words, v_session.total_words)      IS NOT DISTINCT FROM v_session.total_words
           AND COALESCE(p_clarity_score, v_session.clarity_score)  IS NOT DISTINCT FROM v_session.clarity_score
           AND COALESCE(p_wpm, v_session.wpm)                      IS NOT DISTINCT FROM v_session.wpm
           AND COALESCE(p_filler_counts, v_session.filler_counts)  IS NOT DISTINCT FROM v_session.filler_counts
           AND COALESCE(p_pause_metrics, v_session.pause_metrics)  IS NOT DISTINCT FROM v_session.pause_metrics
           AND COALESCE(p_filler_completeness, v_session.filler_completeness) IS NOT DISTINCT FROM v_session.filler_completeness
           AND COALESCE(p_final_transcript, v_session.transcript)  IS NOT DISTINCT FROM v_session.transcript
        THEN
            -- Do NOT return here. An early return is what made retention convergence unreachable on replay:
            -- a guarded failure could never be retried because the retry short-circuited before the coordinator.
            -- Flag it and fall through to the ONE common exit that both fresh completions and replays traverse.
            v_idempotent := true;
        ELSE
        RAISE EXCEPTION '#1306: idempotency conflict — a completed session cannot be re-completed with different final metrics/duration/status/reason/next-action/transcript'
            USING ERRCODE = '40003';
        END IF;
    END IF;

    -- Validations apply only to a FRESH completion. A verified-identical replay has already satisfied them.
    IF NOT v_idempotent THEN
        IF p_status = 'completed' AND p_next_action IS NULL THEN
            RAISE EXCEPTION '#1306: a completed session requires exactly one structured next action' USING ERRCODE = '23514';
        END IF;

        -- Zero-vs-missing: `{}` means "measured, zero fillers" and must be sent explicitly. NULL means "not
        -- measured" and is REJECTED for a completion — never coerced to `{}`, which would fabricate a
        -- flattering measured zero.
        IF p_status = 'completed' AND COALESCE(p_filler_counts, v_session.filler_counts) IS NULL THEN
            RAISE EXCEPTION '#1306: a completed session requires a measured filler_counts map (send {} for a genuine zero, never null)'
                USING ERRCODE = '23514';
        END IF;

        -- #1472: the completeness authority is a CLOSED state. NULL means "not stated" (a client older than this
        -- migration); consumers read NULL as unobservable, so an omitted state can never become a clean result.
        IF p_filler_completeness IS NOT NULL
           AND p_filler_completeness NOT IN ('complete', 'unobservable', 'no_speech') THEN
            RAISE EXCEPTION '#1472: filler_completeness must be complete, unobservable or no_speech'
                USING ERRCODE = '23514';
        END IF;

        -- (1) THE SESSION WRITE — metrics, filler snapshot, the one next action, duration, status.
        -- This is the write that MUST SURVIVE a retention failure, so it deliberately carries NO transcript and
        -- sits OUTSIDE the subtransaction below. "Completed but missing its metrics" stops being reachable.
        UPDATE public.sessions
        SET status = p_status,
            status_reason = COALESCE(p_reason, status_reason),
            duration = v_final_duration,
            total_words   = COALESCE(p_total_words, total_words),
            clarity_score = COALESCE(p_clarity_score, clarity_score),
            wpm           = COALESCE(p_wpm, wpm),
            filler_counts = COALESCE(p_filler_counts, filler_counts),
            filler_completeness = COALESCE(p_filler_completeness, filler_completeness),
            pause_metrics = COALESCE(p_pause_metrics, pause_metrics),
            next_action_signal = CASE WHEN p_status = 'completed' THEN p_next_action ELSE next_action_signal END,
            updated_at = now()
        WHERE id = p_session_id AND user_id = auth.uid();
    END IF;

    -- ELIGIBILITY. Retention convergence belongs to COMPLETED saves and their replays only. A `failed`,
    -- cancelled or otherwise non-completed transition must never rotate anybody's transcripts as a side effect
    -- of ending a recording badly.
    v_effective_status := CASE WHEN v_idempotent THEN v_session.status ELSE p_status END;
    v_eligible := (v_effective_status = 'completed');

    -- (2) TRANSCRIPT + RETENTION, TOGETHER, IN ONE SUBTRANSACTION.
    --
    -- The transcript, metrics and retention decision belong to ONE RPC transaction. If active retention cannot
    -- converge, the function raises below and PostgreSQL rolls all of them back. The caller therefore receives a
    -- retryable failure and keeps its recovery draft; it is never told that discarded words were saved.
    IF v_eligible THEN
        BEGIN
            IF p_final_transcript IS NOT NULL AND NOT v_idempotent THEN
                -- transcript_state is NOT set here: trg_sessions_set_transcript_state owns it, derives it from
                -- the text actually persisted, and enforces sticky expiry so a late replay cannot resurrect
                -- retention-removed text.
                UPDATE public.sessions
                SET transcript = p_final_transcript, updated_at = now()
                WHERE id = p_session_id AND user_id = auth.uid();
                v_wrote_transcript := true;
            END IF;
            -- #1436 P1 — THE ARMING SIGNAL, WRITTEN BY THE AUTHORITATIVE COMPLETION ITSELF.
            --
            -- Inside this subtransaction and after the transcript write, so it shares the fate of the
            -- save: a convergence failure below rolls the transcript AND the arming back together, and
            -- a user is never armed by a save that did not land. A client cannot reach this without
            -- going through the RPC, which is what the removed row-shape trigger could not guarantee.
            /*
             * #1436 P1 — DECIDED BY THE STORED ROW, NOT BY THE ARGUMENT.
             *
             * `v_wrote_transcript` means only that a non-NULL argument was supplied and an UPDATE was
             * attempted. A completion carrying blank text ('   ') set it true, the transcript-state
             * trigger classified the row `not_captured` — nothing was retained — and this armed the
             * user anyway. Convergence then SUCCEEDED and expired an unarmed legacy user's older
             * transcript, and because the outcome was `converged` the cleanup below never ran, so the
             * false arming stayed too. A save that kept no words is not the completed save that arms.
             */
            IF v_wrote_transcript AND EXISTS (
                SELECT 1 FROM public.sessions
                WHERE id = p_session_id AND user_id = auth.uid()
                  AND transcript IS NOT NULL
                  AND transcript ~ '[^[:space:]]'
            ) THEN
                PERFORM public.arm_transcript_retention_for_save(auth.uid(), p_session_id);
            END IF;
            v_retention := public.converge_transcript_retention(auth.uid());
            v_retention_status := v_retention->>'status';
        END;

        -- Installing the definition is intentionally inert until PO/Ops activates it after the real-world test.
        -- Once active, anything short of convergence is a SAVE FAILURE and rolls back the whole RPC.
        IF v_wrote_transcript
           AND COALESCE(v_retention_status, 'error') NOT IN ('converged', 'pending', 'non_converged')
           AND NOT (
             v_retention_status = 'deferred'
             AND v_retention->>'reason' IN ('retention_not_activated', 'retention_not_armed')
           ) THEN
            RAISE EXCEPTION 'complete_session_v2: transcript retention did not converge (status=%)',
              COALESCE(v_retention_status, 'error') USING ERRCODE = '55000';
        END IF;
    END IF;

    -- RE-READ. The outcome is derived from what the server ACTUALLY holds, never predicted. Rollback does not
    -- always mean `not_captured`: a row with a pre-existing retained transcript still reads `available`, and an
    -- already-expired row still reads `expired`. Hard-coding either would report a state the row does not have.
    SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id AND user_id = auth.uid();

    -- TYPED, MUTUALLY EXCLUSIVE OUTCOME. Not a boolean: "the subtransaction did not throw" is not the same
    -- claim as "this transcript is retained", and a client must be able to switch exhaustively rather than
    -- infer from an absence.
    v_outcome := CASE
        WHEN v_session.transcript_state = 'expired'       THEN 'expired'
        WHEN v_session.transcript_state = 'available'     THEN 'retained'
        WHEN p_final_transcript IS NULL                   THEN 'not_provided'
        ELSE 'not_captured'   -- text was supplied but was blank/unusable; the server says so plainly
    END;

    RETURN jsonb_build_object(
        'success', true,
        'session_saved', true,
        'idempotent', v_idempotent,
        'final_status', v_effective_status,
        'next_action_signal', v_session.next_action_signal,
        'transcript_state', v_session.transcript_state,
        'transcript_outcome', v_outcome,
        'transcript_retained', (v_outcome = 'retained'),
        'retention', COALESCE(
            v_retention,
            jsonb_build_object('status', 'skipped', 'reason', 'not_an_eligible_completion'))
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_session_v2(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_session_v2(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_session_v2(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB, TEXT, TEXT) TO service_role;
