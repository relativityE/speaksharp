-- #1314 / #1258 C1+C2 — ATOMIC COMPLETION WITH TRANSCRIPT RETENTION.
--
-- WHY. Today a normal completion writes through TWO tracks: the metrics-only complete_session RPC, then a
-- separate PATCH of the sessions row. Nothing binds them, so a session can end up `completed` with its metrics
-- missing — which is exactly the state the 2026-08-19 run produced. Separately, the metrics-only overload has no
-- transcript parameter and never invokes the retention coordinator, so under the superseding #1258/#1314
-- contract ("the two newest saved sessions retain their transcript for review and PDF") nothing ever feeds
-- retention on the normal path. This migration closes both with ONE server-controlled transaction.
--
-- WHAT IT DOES NOT DO. It does NOT touch the LEGACY transcript-accepting overload
-- `complete_session(uuid,text,text,int,text)`. That bypass is real (it can still complete a session with no
-- metrics) but revoking it is sequenced AFTER the new client path is deployed and proven — dropping it here
-- would break any client still in flight. Tracked separately.
--
-- WHY A DISTINCT NAME (`complete_session_v2`), NOT ANOTHER OVERLOAD — PO ruling.
--
-- An earlier revision added an 11th parameter to `complete_session` and dropped the Stage-A overload to avoid
-- ambiguity. That was the wrong shape. PostgreSQL resolves NAMED-argument calls by argument set, so any call
-- whose set is satisfiable by two defaulted overloads resolves to NEITHER: 42725 "function is not unique",
-- surfaced by PostgREST as 300 Multiple Choices. A defaulted same-name overload is therefore the OPPOSITE of
-- backward compatibility.
--
-- VERIFIED, and worth recording precisely: that ambiguity ALREADY EXISTS IN PRODUCTION TODAY, between the legacy
-- `complete_session(uuid,text,text,int,text)` and the Stage-A `complete_session(uuid,text,int,text,jsonb,...)`.
-- Executed against real PostgreSQL with ONLY those two installed and no #1314 change present, a subset call
-- (p_session_id, p_status, p_reason, p_final_duration) raises 42725. Production is safe ONLY because the single
-- production caller always sends all ten named arguments. This migration did not introduce that hazard; a
-- distinct name is simply immune to it.
--
-- ACTIVE CALLER INVENTORY (exact argument sets), taken before this change:
--   * frontend/src/lib/storage.ts:304 — the ONLY production caller. Sends all TEN named arguments
--     (p_session_id, p_status, p_final_duration, p_reason, p_next_action, p_total_words, p_clarity_score,
--     p_wpm, p_filler_counts, p_pause_metrics), every one explicitly, nulls included. Resolves to Stage-A.
--   * frontend/src/mocks/handlers.ts + frontend/src/lib/mockSupabase.ts — test doubles, not a DB caller.
--   * scripts/private-cdp-cutover-proof.mjs — a URL regex for network capture, not a caller.
--   No Edge Function, workflow, or SQL job calls it.
--
-- THIS MIGRATION IS PURELY ADDITIVE. It creates THREE new functions — complete_session_v2 and the two
-- size-bound helpers max_persisted_transcript_chars()/max_persisted_transcript_bytes() — plus ACLs on those
-- three, and changes NOTHING else: the legacy overload
-- and the Stage-A overload are both left exactly as they are, so every existing caller keeps its current
-- resolution and no in-flight client can break. The client switches to v2 only after this is applied and
-- verified through real PostgREST; the legacy authority is removed later, after deployed proof, leaving one
-- completion authority.
--
-- NOT APPLIED TO PRODUCTION BY THIS CHANGE. Application requires separate, explicit authorization.
--
-- PAIRED SOURCE ROLLBACK — THREE drops, because this migration creates THREE functions. An earlier revision of
-- this header said "a single statement", which was wrong and would have left the two size-bound helpers
-- installed after a supposedly complete rollback:
--   BEGIN;
--     DROP FUNCTION IF EXISTS public.complete_session_v2(uuid, text, integer, text, jsonb, integer,
--       double precision, double precision, jsonb, jsonb, text);
--     DROP FUNCTION IF EXISTS public.max_persisted_transcript_chars();
--     DROP FUNCTION IF EXISTS public.max_persisted_transcript_bytes();
--   COMMIT;
--   Wrapped in a transaction so a blocked drop leaves the COMPLETE applied state rather than a partial teardown.
--   Nothing else to restore: no existing function is dropped or replaced, and no column, constraint or trigger
--   is added. Roll the CLIENT back first if it has adopted v2, or its calls will 404 (PGRST202).
--   See product_release/work_items/1314-atomic-rpc-rollback.sql for the executable version.

-- DUAL upper bound on a persisted transcript (PO ruling). A recording is capped at 600 seconds; even sustained
-- fast speech (~200 wpm) yields well under 15k characters, so 50k retains real headroom without making the
-- anti-abuse ceiling an order of magnitude wider than necessary. The BYTE bound exists because a character
-- bound alone is defeatable by multi-byte-heavy input, which would defeat the storage/resource purpose.
-- EITHER bound rejects. Deliberately a REJECTION, never a silent truncation: half a transcript presented as the
-- user's own words is worse than a failed save they can retry. Distinct SQLSTATEs so logs and the readback can
-- tell which bound tripped.
CREATE OR REPLACE FUNCTION public.max_persisted_transcript_chars()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 50000 $$;

CREATE OR REPLACE FUNCTION public.max_persisted_transcript_bytes()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 200000 $$;

-- ACL for the two helpers. PostgreSQL grants EXECUTE to PUBLIC on a new function BY DEFAULT, so without these
-- they would be callable by unauthenticated requests. They only return constants, so the exposure is disclosure
-- of a configured limit rather than data — but "harmless" is not a reason to skip an ACL, and an unjustified
-- PUBLIC grant is exactly what a security review should catch. Same posture as the RPC below.
--
-- COLLISION NOTE: `CREATE OR REPLACE` on these names would silently REPLACE a pre-existing function of the same
-- name and signature. Both names are namespaced to this feature and the post-apply readback reports their
-- values, so a collision shows up as an unexpected number rather than passing unnoticed.
REVOKE EXECUTE ON FUNCTION public.max_persisted_transcript_chars() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.max_persisted_transcript_bytes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.max_persisted_transcript_chars() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.max_persisted_transcript_bytes() TO authenticated, service_role;

-- No DROP of any kind. Both existing complete_session overloads stay exactly as they are.
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
    p_final_transcript TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_session public.sessions%ROWTYPE;
    v_effective_tier TEXT;
    v_final_duration INT;
    v_retention JSONB := NULL;
    v_retention_error TEXT := NULL;
    v_idempotent BOOLEAN := false;
    v_eligible BOOLEAN := false;
    v_subtxn_failed BOOLEAN := false;
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
    -- Both must be in the SAME subtransaction. If the transcript landed first and convergence then failed, the
    -- row would be transcript-bearing AND unrotated — precisely the third-transcript breach this exists to
    -- prevent. Rolling the two back together is what makes the at-most-two invariant hold on the failure path:
    -- from a valid starting state, a failed convergence CANNOT INCREASE the transcript-bearing row count.
    --
    -- The session write above is already durable, so the user keeps the practice session and its metrics; only
    -- the new transcript is forfeited. The outcome is REPORTED, never swallowed.
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
            v_retention := public.converge_transcript_retention(auth.uid());
            v_retention_status := v_retention->>'status';
        EXCEPTION
            -- query_canceled (57014, statement_timeout/cancel) is NOT caught by WHEN OTHERS and would otherwise
            -- escape this subtransaction, abort the whole function, and roll back the DURABLE session-metrics
            -- write above with it. Catch it explicitly so the savepoint rolls back only the transcript+retention
            -- and the session/metrics survive (verified against real PostgreSQL).
            WHEN query_canceled THEN
                v_subtxn_failed := true; v_retention_error := SQLSTATE;
            WHEN OTHERS THEN
                -- Content-free: SQLSTATE only. A retention error must never echo a transcript or row content.
                v_subtxn_failed := true; v_retention_error := SQLSTATE;
        END;

        -- NEWEST-TWO INVARIANT, enforced on the RESULT, not just on exceptions. converge_transcript_retention
        -- can RETURN 'pending' (Option A: an older session's terminal Progress evidence is not yet durable) or
        -- 'non_converged' (a backlog beyond one bounded batch) WITHOUT raising. In either case it did NOT reduce
        -- to two transcript-bearing rows, so keeping THIS session's newly-written transcript would leave a THIRD
        -- — a direct breach of the at-most-two contract. Revert our transcript write (a durable UPDATE, outside
        -- the subtransaction) so the session and its metrics stay, but the new transcript is not retained. On a
        -- caught exception the savepoint already reverted the transcript; this handles the no-exception,
        -- did-not-converge case the earlier version missed.
        IF v_wrote_transcript AND NOT v_subtxn_failed
           AND COALESCE(v_retention_status, 'error') IS DISTINCT FROM 'converged' THEN
            UPDATE public.sessions SET transcript = NULL, updated_at = now()
            WHERE id = p_session_id AND user_id = auth.uid();
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
        -- A raised failure OR a non-converged retention RESULT both mean "the new transcript is not retained".
        WHEN v_subtxn_failed
          OR (v_wrote_transcript AND COALESCE(v_retention_status, 'error') IS DISTINCT FROM 'converged')
                                                          THEN 'retention_failed'
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
            CASE WHEN v_subtxn_failed
                 THEN jsonb_build_object('status', 'error', 'sqlstate', v_retention_error)
                 ELSE jsonb_build_object('status', 'skipped', 'reason', 'not_an_eligible_completion') END)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_session_v2(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_session_v2(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_session_v2(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB, TEXT) TO service_role;
