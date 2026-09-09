-- =========================================================================================================
-- NEWEST-ONE TRANSCRIPT RETENTION — forward-only correction of the shipped newest-two behaviour.
--
-- WHAT CHANGES. The product requirement is that a user keeps the transcript of their NEWEST completed
-- session only. The shipped implementation retains the newest TWO. This migration moves the whole contract
-- to newest-one.
--
-- WHY FORWARD-ONLY. 20260803000000 and 20260804000000 are already applied. Editing an applied migration
-- changes nothing on a database that has run it and leaves the ledger describing a file that no longer
-- matches what executed. The correction is a new migration redefining the same functions.
--
-- WHY FIVE OBJECTS AND NOT ONE. The rank threshold is not the only thing encoding the policy. A version
-- marker is pinned by two independent fail-closed checks, and the coordinator hard-raises on an unexpected
-- version. That design is why a partial change cannot silently half-apply — it fails loudly instead — and it
-- is also why the correction has to move all five together:
--
--   1. transcript_retention_policy_version()      'newest_two_v1' -> 'newest_one_v1'
--   2. transcript_sessions_to_expire(uuid)        rank > 2 -> rank > 1
--   3. expire_transcripts_newest_one(uuid,int)    NEW; replaces expire_transcripts_newest_two
--   4. converge_transcript_retention(uuid)        version pin, emitted policy strings, mutation callee
--   5. transcript_retention_preflight(...)        version pin, candidate rank, retained rank, R3 aggregate
--
-- The old mutation is DROPPED rather than left behind with its original body: a function still reachable
-- under its old name would keep the newest-two rule alive for any caller that reaches it.
--
-- complete_session_v2 is untouched. It CALLS converge_transcript_retention rather than reimplementing the
-- rule, so the atomic completion path inherits this correction. No client ships the count — the application
-- reads transcript_state only.
--
-- DELIBERATELY NOT TOUCHED: the several analytics functions containing `LIMIT 2`. Those are a recent-session
-- projection for the dashboard, not retention. Changing them would be a different defect.
--
-- ---------------------------------------------------------------------------------------------------------
-- OPERATIONAL IMPACT — Dev authors and tests this; PO/Ops applies it.
--
--   * Every user with two or more transcript-bearing sessions currently has a SECOND-NEWEST transcript they
--     can open and export. This expires it on that user's next convergence.
--   * The expiry is IRREVERSIBLE from within the schema: `transcript` is set to NULL, not flagged.
--   * It takes effect on each user's NEXT completed save, because convergence runs inside
--     complete_session_v2. A backfill sweep is a separate, explicitly authorized action.
--
--   REQUIRED BEFORE APPLICATION:
--     1. Back up `sessions.id, user_id, transcript` for rows at rank > 1, retained long enough to restore.
--     2. Run the dry-run below; have the affected-row total reviewed.
--     3. Confirm `supabase migration list` records this migration as applied — applying SQL directly writes
--        no ledger row.
--
--   DRY RUN (read-only):
--     SELECT count(*) AS rows_that_would_expire
--     FROM (
--       SELECT row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
--       FROM public.sessions
--       WHERE transcript IS NOT NULL AND transcript ~ '[^[:space:]]'
--     ) r WHERE r.rn > 1;
--
--   ROLLBACK: a further forward-only migration restoring the newest-two definitions, THEN restoring text
--   from the step-1 backup. Reverting the functions alone does not bring back expired transcripts.
-- =========================================================================================================

-- 1) Policy marker.
CREATE OR REPLACE FUNCTION public.transcript_retention_policy_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT 'newest_one_v1'::text $$;

-- 2) The shared predicate: which sessions must have their transcript expired for one user.
--    Rank 1 (newest by created_at DESC, id DESC) is never returned.
CREATE OR REPLACE FUNCTION public.transcript_sessions_to_expire(p_user_id uuid)
RETURNS TABLE(session_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM (
    SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn
    FROM public.sessions
    WHERE user_id = p_user_id
      AND transcript IS NOT NULL
      AND transcript ~ '[^[:space:]]'
  ) ranked
  WHERE rn > 1
$$;

-- 3) The bounded mutation. Same batching, same authorized trigger bypass and restore, same content-free
--    aggregate result, same PARTITION BY user_id — so per-user isolation holds by construction and one
--    user's rows can never affect another's ranking. Only the threshold differs.
CREATE OR REPLACE FUNCTION public.expire_transcripts_newest_one(
  p_user_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_viol     record;
  v_affected integer := 0;
  v_has_more boolean := false;
BEGIN
  -- Argument bounds (fail closed), IDENTICAL to newest-two. p_batch_size = 1 is the exact minimum
  -- boundary and MUST succeed; the 5000 ceiling bounds how much this destructive statement can scrub
  -- in one transaction. Dropping the ceiling made an unbounded batch legal against a function whose
  -- whole job is NULLing user transcripts.
  IF p_batch_size IS NULL OR p_batch_size <= 0 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_one: p_batch_size % out of bounds (1..5000)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- Fail closed on any pre-existing contradiction in scope (empty-on-available / expired-with-text /
  -- not_captured-with-real-text / unknown state). NEVER scrub an inconsistent cohort: if the stored
  -- state and the stored text already disagree, this function cannot tell which one is the truth, and
  -- expiring on top of that destroys the evidence needed to find out. Checked BEFORE the trigger
  -- bypass and before any destructive write, exactly as newest-two does.
  SELECT * INTO v_viol FROM public.transcript_retention_invariant_violations(p_user_id);
  IF v_viol.expired_with_text > 0
     OR v_viol.available_without_text > 0
     OR v_viol.not_captured_with_text > 0
     OR v_viol.unknown_state > 0 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_one: invariant violations in scope (expired_with_text=%, available_without_text=%, not_captured_with_text=%, unknown_state=%); refusing to run',
      v_viol.expired_with_text, v_viol.available_without_text, v_viol.not_captured_with_text, v_viol.unknown_state
      USING ERRCODE = '23514';
  END IF;

  SET LOCAL session_replication_role = 'replica';

  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.sessions
    WHERE transcript IS NOT NULL
      AND transcript ~ '[^[:space:]]'
      AND (p_user_id IS NULL OR user_id = p_user_id)
  ),
  batch AS (
    SELECT id FROM ranked WHERE rn > 1 ORDER BY id LIMIT p_batch_size
  )
  UPDATE public.sessions s
  SET transcript = NULL,
      transcript_state = 'expired'
  WHERE s.id IN (SELECT id FROM batch);
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  SET LOCAL session_replication_role = 'origin';

  -- Remaining-work indicator, computed AFTER this batch. Idempotent by construction: a second run over a
  -- converged user expires 0 and reports has_more false.
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
      FROM public.sessions
      WHERE transcript IS NOT NULL
        AND transcript ~ '[^[:space:]]'
        AND (p_user_id IS NULL OR user_id = p_user_id)
    ) r WHERE r.rn > 1
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'policy_version', public.transcript_retention_policy_version(),
    'scope',          CASE WHEN p_user_id IS NULL THEN 'all_users' ELSE 'single_user' END,
    'expired_count',  v_affected,
    'has_more',       v_has_more
  );
END;
$$;

-- 4) The coordinator, derived from the shipped definition. Its version pin, its emitted policy strings
--    and its mutation callee all move together. The evidence gate, the per-user profile-row lock and
--    the deferral on pending evaluations are unchanged: only the policy identity moves.
/*
 * #1436 P1 — RETENTION IS ARMED BY A COMPLETED POST-ROLLOUT SAVE, AND BY NOTHING ELSE.
 *
 * Deploying this migration must delete nothing. A user's existing transcripts were saved under the
 * previous policy and they did not agree to lose one by our shipping a migration. Newest-one begins to
 * apply to a user only once they complete and save a NEW session after rollout — that successful save
 * is the arming signal, and it is durable so a later replay, retry or delayed evaluation cannot
 * manufacture one.
 *
 * Armed by the completion transactions themselves — `complete_session_v2` and the at-cap branch of
 * `create_session_and_update_usage` — and never by a trigger on `sessions`. A row that LOOKS like a
 * completed save is not proof of one, and authenticated users hold direct UPDATE on `sessions`. Both
 * call sites arm only after their write has succeeded, inside the caller's transaction, so a
 * completion that rolls back takes its arming with it: only a SUCCESSFUL save arms.
 *
 * `ON CONFLICT DO NOTHING` keeps the first arming instant, which is the fact worth retaining.
 */
CREATE TABLE IF NOT EXISTS public.transcript_retention_arming (
    user_id           uuid PRIMARY KEY,
    armed_at          timestamptz NOT NULL DEFAULT now(),
    armed_by_session  uuid
);

ALTER TABLE public.transcript_retention_arming ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transcript_retention_arming FROM PUBLIC;

/*
 * #1436 P1 — ARMING LIVES INSIDE THE TRUSTED SUCCESSFUL-SAVE BOUNDARY, NOT IN A ROW-SHAPE TRIGGER.
 *
 * The trigger this replaces armed on any `sessions` row that merely LOOKED like a completed save.
 * That is not proof of a save. Authenticated users retain direct UPDATE on `sessions.status` and
 * `sessions.transcript` (20260803010000_session_attribution_authority.sql), so an entitled client
 * could arm a legacy user by rewriting a pre-rollout completed row's transcript — even to the same
 * value — and a later evaluation would then irreversibly expire their older text. The at-cap create
 * had a second false-positive: it inserted a completed row and armed, and when `update_user_usage`
 * rejected the request the session was deleted while the arming row stayed committed.
 *
 * Arming is therefore performed only by the transactions that actually complete a save:
 * `complete_session_v2` and the at-cap branch of `create_session_and_update_usage`, in both cases
 * AFTER the write has succeeded. A client cannot reach either without going through the RPC, and a
 * transaction that rolls back takes its arming with it.
 */
CREATE OR REPLACE FUNCTION public.arm_transcript_retention_for_save(p_user_id uuid, p_session_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    INSERT INTO public.transcript_retention_arming (user_id, armed_by_session)
    VALUES (p_user_id, p_session_id)
    ON CONFLICT (user_id) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.arm_transcript_retention_for_save(uuid, uuid) FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sessions_arm_retention ON public.sessions;
DROP FUNCTION IF EXISTS public.arm_transcript_retention();

CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_formula  constant text := 'clarity_v1';   -- authoritative Progress evaluation formula version
  v_candidates integer;
  v_pending    integer;
  v_r1         jsonb;
  v_expired    integer := 0;
  v_has_more   boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'converge_transcript_retention: p_user_id is required' USING ERRCODE = '22004';
  END IF;

  -- Fail closed on an unknown/forked retention policy version (R1 is the single authority). #1161 authority
  -- versions must extend this check explicitly; an unknown version never silently proceeds.
  /*
   * #1436 P1 — THE SINGLE ARMING CHECK, HERE SO EVERY CALLER INHERITS IT.
   *
   * Triggers, retries, replays and the create path all reach retention through this function. Gating
   * each of them separately is how the first three P1s in this lane happened: I closed the door that
   * was named and left the others open. There is one door now.
   *
   * Until this user has completed a save under the new policy, convergence is a no-op that reports
   * why. Deploying the migration deletes nothing; an old evaluation settling deletes nothing; starting
   * or cancelling a session deletes nothing.
   */
  IF NOT EXISTS (SELECT 1 FROM public.transcript_retention_arming WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object(
      'status', 'deferred',
      'reason', 'retention_not_armed',
      'policy_version', public.transcript_retention_policy_version()
    );
  END IF;

  IF public.transcript_retention_policy_version() IS DISTINCT FROM 'newest_one_v1' THEN
    RAISE EXCEPTION 'converge_transcript_retention: unexpected retention policy version %',
      public.transcript_retention_policy_version() USING ERRCODE = '55000';
  END IF;

  -- Per-user serialization on the SAME profile row both save paths already lock (no lossy UUID hash). When
  -- invoked inside a save RPC this lock is already held; re-locking in-txn is a no-op.
  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;

  -- Outgoing candidates = R1 predicate (transcript-bearing rank > 1), reused verbatim.
  SELECT count(*) INTO v_candidates FROM public.transcript_sessions_to_expire(p_user_id);

  IF v_candidates = 0 THEN
    RETURN jsonb_build_object('status','converged','policy_version','newest_one_v1',
      'eligible_candidate_count',0,'pending_evidence_count',0,'expired_count',0,'has_more',false);
  END IF;

  -- A candidate has DURABLE TERMINAL evidence iff a Progress evaluation row exists at the authoritative
  -- formula version whose RECORDED attribution is terminal (non-pending). Otherwise its evidence is pending.
  SELECT count(*) INTO v_pending
  FROM public.transcript_sessions_to_expire(p_user_id) c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.session_progress_evaluations e
    WHERE e.session_id = c.session_id
      AND e.formula_version = c_formula
      AND e.attribution_status IS DISTINCT FROM 'pending'
  );

  IF v_pending > 0 THEN
    -- At least one outgoing candidate awaits terminal evidence: DEFER — never expire pending evidence. The
    -- transcript persists temporarily and converges when the laggard's evaluation becomes durable (invoked
    -- again from the evaluation-persistence trigger). R3 reports any residual pending backlog.
    RETURN jsonb_build_object('status','pending','policy_version','newest_one_v1',
      'eligible_candidate_count', v_candidates - v_pending, 'pending_evidence_count', v_pending,
      'expired_count',0,'has_more',false);
  END IF;

  -- Every outgoing candidate has durable terminal evidence: ONE bounded R1 mutation (reused verbatim).
  v_r1 := public.expire_transcripts_newest_one(p_user_id, 500);
  v_expired  := (v_r1->>'expired_count')::integer;
  v_has_more := (v_r1->>'has_more')::boolean;

  -- has_more => a historical backlog beyond one bounded batch: report NON-CONVERGED for R3/authorized
  -- cleanup. Do NOT loop and do NOT roll back the save that invoked us.
  RETURN jsonb_build_object(
    'status', CASE WHEN v_has_more THEN 'non_converged' ELSE 'converged' END,
    'policy_version','newest_one_v1',
    'eligible_candidate_count', v_candidates,
    'pending_evidence_count', 0,
    'expired_count', v_expired,
    'has_more', v_has_more
  );
END;
$$;

-- 5) R3 preflight, derived from the shipped definition with the policy pin, candidate rank, retained rank
--    and aggregate names moved to newest-one.
CREATE OR REPLACE FUNCTION public.transcript_retention_preflight(
  p_scope   text DEFAULT 'all_users',   -- 'all_users' | 'single_user'
  p_user_id uuid DEFAULT NULL,
  p_run_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE                    -- read-only: performs only SELECTs
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_policy  constant text := 'newest_one_v1';
  c_formula constant text := 'clarity_v1';
  v_viol    record;
  v_counts  jsonb;
  v_sim     jsonb;
  v_bytes   jsonb;
  v_blocked boolean := false;
BEGIN
  -- Bounded, fail-closed resource guards (also armed by the caller/workflow; harmless to re-assert).
  PERFORM set_config('statement_timeout', '30000', true);
  PERFORM set_config('lock_timeout', '2000', true);

  -- STRUCTURAL fail-closed: version + required R1/R2 objects must match the reviewed contract.
  IF public.transcript_retention_policy_version() IS DISTINCT FROM c_policy THEN
    RAISE EXCEPTION 'transcript_retention_preflight: unexpected policy version %',
      public.transcript_retention_policy_version() USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('public.transcript_sessions_to_expire(uuid)') IS NULL
     OR to_regprocedure('public.expire_transcripts_newest_one(uuid, integer)') IS NULL
     OR to_regprocedure('public.converge_transcript_retention(uuid)') IS NULL
     OR to_regprocedure('public.transcript_retention_invariant_violations(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='sessions' AND column_name='transcript_state') THEN
    RAISE EXCEPTION 'transcript_retention_preflight: required R1/R2 schema objects missing (schema drift)'
      USING ERRCODE = '42883';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('all_users','single_user') THEN
    RAISE EXCEPTION 'transcript_retention_preflight: invalid scope %', p_scope USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'single_user' AND p_user_id IS NULL THEN
    RAISE EXCEPTION 'transcript_retention_preflight: single_user requires p_user_id' USING ERRCODE = '22023';
  END IF;

  -- Contradiction counts (reuse the R2 content-free validator).
  SELECT * INTO v_viol FROM public.transcript_retention_invariant_violations(
    CASE WHEN p_scope='single_user' THEN p_user_id ELSE NULL END);
  IF v_viol.expired_with_text > 0 OR v_viol.available_without_text > 0
     OR v_viol.not_captured_with_text > 0 OR v_viol.unknown_state > 0 THEN
    v_blocked := true;
  END IF;

  -- One read-only pass computes every aggregate. `bearing` = transcript-bearing (non-null, non-blank) —
  -- the R1 ranking cohort. `rn` mirrors the R1 predicate (per user, created_at DESC, id DESC).
  WITH ranked AS (
    SELECT s.id, s.user_id, s.transcript_state, s.transcript,
           row_number() OVER (PARTITION BY s.user_id ORDER BY s.created_at DESC, s.id DESC) AS rn
    FROM public.sessions s
    WHERE (p_scope='all_users' OR s.user_id = p_user_id)
      AND s.transcript IS NOT NULL AND s.transcript ~ '[^[:space:]]'
  ),
  -- Outgoing candidates = transcript-bearing rank > 1 (would be expired by the authorized scrub).
  -- The published field is `rank_gt1_eligible`: under newest-ONE the cohort is rank > 1, and carrying
  -- the inherited `rank_gt2_eligible` name over a rank > 1 count would have told an operator reading
  -- the preflight JSON that they were looking at the newest-two cohort.
  cand AS (
    SELECT r.id, r.user_id FROM ranked r WHERE r.rn > 1
  ),
  cand_pending AS (  -- candidates WITHOUT a durable terminal evaluation (R2 evidence gate) => retention pending
    SELECT c.id, c.user_id FROM cand c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.session_progress_evaluations e
      WHERE e.session_id = c.id AND e.formula_version = c_formula AND e.attribution_status IS DISTINCT FROM 'pending')
  ),
  per_user_retained AS (  -- transcript-bearing rows RETAINED after the simulated scrub = min(bearing, 1)
    SELECT user_id, count(*) FILTER (WHERE rn <= 1) AS retained FROM ranked GROUP BY user_id
  ),
  base AS (
    SELECT
      (SELECT count(*) FROM public.sessions WHERE (p_scope='all_users' OR user_id=p_user_id))::bigint AS sessions_total,
      (SELECT count(*) FROM public.sessions WHERE (p_scope='all_users' OR user_id=p_user_id) AND transcript_state='available')::bigint AS state_available,
      (SELECT count(*) FROM public.sessions WHERE (p_scope='all_users' OR user_id=p_user_id) AND transcript_state='expired')::bigint AS state_expired,
      (SELECT count(*) FROM public.sessions WHERE (p_scope='all_users' OR user_id=p_user_id) AND transcript_state='not_captured')::bigint AS state_not_captured,
      (SELECT count(*) FROM ranked)::bigint AS transcript_bearing,
      (SELECT count(DISTINCT user_id) FROM public.sessions WHERE (p_scope='all_users' OR user_id=p_user_id))::bigint AS users_total,
      (SELECT count(DISTINCT user_id) FROM cand)::bigint AS users_with_candidates,
      (SELECT count(*) FROM cand)::bigint AS rank_gt1_eligible,
      (SELECT count(*) FROM cand_pending)::bigint AS pending_evidence_backlog,
      (SELECT count(DISTINCT user_id) FROM cand_pending)::bigint AS users_pending_backlog,
      (SELECT coalesce(max(retained),0) FROM per_user_retained)::bigint AS simulated_max_retained_per_user,
      (SELECT count(*) FROM per_user_retained WHERE retained > 1)::bigint AS users_over_retained_after
  )
  SELECT
    jsonb_build_object(
      'sessions_total', sessions_total, 'state_available', state_available, 'state_expired', state_expired,
      'state_not_captured', state_not_captured, 'transcript_bearing', transcript_bearing,
      'users_total', users_total, 'users_with_candidates', users_with_candidates,
      'rank_gt1_eligible', rank_gt1_eligible, 'pending_evidence_backlog', pending_evidence_backlog,
      'users_pending_backlog', users_pending_backlog),
    jsonb_build_object(
      'simulated_expire_count', rank_gt1_eligible,
      'simulated_max_retained_per_user', simulated_max_retained_per_user,
      'users_over_retained_after', users_over_retained_after,
      'newest_one_violations', users_over_retained_after)
  INTO v_counts, v_sim FROM base;

  IF (v_sim->>'simulated_max_retained_per_user')::bigint > 1 OR (v_sim->>'users_over_retained_after')::bigint > 0 THEN
    v_blocked := true;
  END IF;

  -- Pending-evidence backlog MUST block readiness. R2 automatic convergence defers those candidates, so a
  -- separately-authorized scrub must NOT expire a transcript whose terminal Progress evaluation is not yet
  -- durable (Option A — would destroy transcript-dependent evidence). The operator lets auto-convergence
  -- drain the backlog to zero, then re-runs the preflight for a 'ready' verdict.
  IF (v_counts->>'pending_evidence_backlog')::bigint > 0 THEN
    v_blocked := true;
  END IF;

  -- Logical bytes + physical allocation (allocation reported WITHOUT any physical-shrink claim). Byte counts
  -- only — never transcript content. octet_length gives true BYTES (multibyte-safe), matching the key name.
  v_bytes := jsonb_build_object(
    'logical_transcript_bytes',
      (SELECT coalesce(sum(octet_length(transcript)),0)::bigint FROM public.sessions
       WHERE (p_scope='all_users' OR user_id=p_user_id) AND transcript IS NOT NULL),
    'sessions_relation_bytes', pg_relation_size('public.sessions'::regclass)::bigint,
    'sessions_total_relation_bytes', pg_total_relation_size('public.sessions'::regclass)::bigint);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_blocked THEN 'blocked' ELSE 'ready' END,
    'policy_version', c_policy,
    'formula_version', c_formula,
    'scope', p_scope,
    'run_id', p_run_id,
    'counts', v_counts,
    'contradictions', jsonb_build_object(
      'expired_with_text', v_viol.expired_with_text, 'available_without_text', v_viol.available_without_text,
      'not_captured_with_text', v_viol.not_captured_with_text, 'unknown_state', v_viol.unknown_state),
    'simulation', v_sim,
    'bytes', v_bytes,
    'identity', jsonb_build_object('schema_ok', true, 'read_only', true, 'physical_shrink_claimed', false)
  );
END;
$$;

-- 6) PRIVILEGES — least privilege, fail closed. CREATE grants EXECUTE to PUBLIC by default.
REVOKE ALL ON FUNCTION public.transcript_retention_policy_version()          FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transcript_sessions_to_expire(uuid)            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_transcripts_newest_one(uuid, integer)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.converge_transcript_retention(uuid)            FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.transcript_retention_policy_version()        TO service_role;
GRANT EXECUTE ON FUNCTION public.transcript_sessions_to_expire(uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_transcripts_newest_one(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.converge_transcript_retention(uuid)          TO service_role;

-- 7) Retire the superseded mutation LAST, after every caller above has been repointed. Leaving it in place
--    would keep the newest-two rule reachable under its own name.

-- =========================================================================================
-- #1436 P1 — the late-create transcript writer is failure-atomic under newest-ONE.
--
-- Redefines the EXACT active signature rather than adding an overload: a new overload would leave
-- the old body reachable and PostgREST could resolve either, which is the silent no-op failure mode
-- this program has already been bitten by once.
-- =========================================================================================

/*
 * #1436 P1 — THE TRIGGER IS A SECOND DOOR TO THE SAME DATA LOSS, AND IT WAS LEFT OPEN.
 *
 * `trg_spe_converge_retention` fires on EVERY terminal evaluation insert and called the coordinator
 * with only the user id. For a user still holding two legacy transcripts whose older row already has
 * terminal evidence, inserting an evaluation for a preexisting or even still-active session reached
 * the expiry path and irreversibly retired the older transcript — without the completed save this
 * migration promises as the boundary. Deferring the placeholder create closed the writer door; this
 * one stayed open.
 *
 * Convergence is now armed only by an evaluation whose OWN session is a completed save that actually
 * holds transcript text — which is what "next completed save" means. Everything else records its
 * durable evaluation and expires nothing; the next real save converges.
 */
CREATE OR REPLACE FUNCTION public.spe_converge_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_completed_save BOOLEAN;
BEGIN
    IF NEW.attribution_status IS DISTINCT FROM 'pending' THEN
        SELECT (s.status = 'completed'
                AND s.transcript IS NOT NULL
                AND s.transcript ~ '[^[:space:]]')
          INTO v_completed_save
          FROM public.sessions s
         WHERE s.id = NEW.session_id;

        IF COALESCE(v_completed_save, false) THEN
            BEGIN
                PERFORM public.converge_transcript_retention(NEW.user_id);
            EXCEPTION
                -- Unchanged from #1117 R2: a retention statement/lock timeout must NOT roll back this
                -- terminal-evaluation INSERT. The durable evaluation is authoritative and is never lost.
                WHEN query_canceled THEN NULL;
                WHEN OTHERS THEN NULL;
            END;
        END IF;
    END IF;
    RETURN NULL;  -- AFTER trigger
END;
$$;

REVOKE ALL ON FUNCTION public.spe_converge_retention() FROM PUBLIC;

/*
 * #1436 P1 — `complete_session_v2` IS REDEFINED HERE, and the header note above is superseded.
 *
 * It was previously untouched by this migration, and that was the right default. Option A requires
 * arming to be written by the transaction that actually completes a save, and this is that
 * transaction — so the redefinition is the cost of putting the signal where it cannot be forged. The
 * body is reproduced verbatim from 20260819120000 with exactly one addition: the arming call inside
 * the existing transcript subtransaction, shown above.
 */
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
            -- #1436 P1 — THE ARMING SIGNAL, WRITTEN BY THE AUTHORITATIVE COMPLETION ITSELF.
            --
            -- Inside this subtransaction and after the transcript write, so it shares the fate of the
            -- save: a convergence failure below rolls the transcript AND the arming back together, and
            -- a user is never armed by a save that did not land. A client cannot reach this without
            -- going through the RPC, which is what the removed row-shape trigger could not guarantee.
            IF v_wrote_transcript THEN
                PERFORM public.arm_transcript_retention_for_save(auth.uid(), p_session_id);
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
            /*
             * #1436 P1 — AND THE ARMING GOES WITH IT.
             *
             * Arming is written inside the subtransaction, so the EXCEPTION path already reverts it.
             * This is the no-exception path: convergence RETURNED `pending`/`non_converged`, the
             * subtransaction committed, and the transcript is being withdrawn out here. Leaving the
             * arming row would arm the user on a save that retained no text — the exact "a failed save
             * cannot leave arming behind" boundary — and the next settling evaluation would then expire
             * their older transcript on the strength of a save that kept nothing.
             *
             * Scoped to `armed_by_session`: if this user was already armed by an EARLIER successful
             * save, that arming is a fact about that save and must survive this one.
             */
            DELETE FROM public.transcript_retention_arming
            WHERE user_id = auth.uid() AND armed_by_session = p_session_id;
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

CREATE OR REPLACE FUNCTION public.create_session_and_update_usage(
    p_session_data JSONB,
    p_engine_type TEXT DEFAULT 'private',
    p_idempotency_key UUID DEFAULT NULL,
    p_engine_version TEXT DEFAULT NULL,
    p_model_name TEXT DEFAULT NULL,
    p_device_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_session_id UUID;
    v_new_session_id UUID := gen_random_uuid();
    v_duration INT;
    v_usage_check JSONB;
    v_user_tier TEXT;
    v_max_concurrent INT;
    v_active_sessions INT;
    v_retention JSONB;
    -- #1436 P1 — does THIS call carry real transcript text? The late-create recovery path does; an
    -- ordinary placeholder create does not, and its existing pending/error behaviour must not change.
    v_writes_transcript BOOLEAN;
    v_initial_at_cap BOOLEAN;
BEGIN
    SET LOCAL statement_timeout = '3000ms';

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_session_id
        FROM public.sessions
        WHERE idempotency_key = p_idempotency_key AND user_id = auth.uid();

        IF v_existing_session_id IS NOT NULL THEN
            /*
             * #1436 P1 — A TRANSCRIPT-BEARING REPLAY STILL OWES CONVERGENCE.
             *
             * This returned before taking the profile lock or invoking retention. Production enters
             * this migration with newest-TWO rows still readable and relies on later writer calls to
             * converge them, so replaying a successful transcript-bearing create could keep reporting
             * success with two readable transcripts indefinitely — the duplicate is idempotent about
             * the ROW, and was silently idempotent about the RETENTION too. `complete_session_v2`
             * deliberately avoids this same early-return so a replay can retry convergence.
             *
             * The fast path is preserved for transcript-free placeholders, which owe nothing.
             */
            /*
             * #1436 P1 — THE STORED ROW DECIDES, NOT THE CALLER'S PAYLOAD.
             *
             * This tested `p_session_data`. A retry that omits `transcript`, or sends it blank, then
             * took the fast path and returned duplicate success without converging — leaving the
             * legacy two-transcript cohort readable. The duplicate's obligation comes from what was
             * PERSISTED under that idempotency key, which the caller cannot revoke by sending less.
             */
            IF EXISTS (
                SELECT 1 FROM public.sessions
                WHERE id = v_existing_session_id
                  AND transcript IS NOT NULL
                  AND transcript ~ '[^[:space:]]'
            ) THEN
                v_retention := public.converge_transcript_retention(auth.uid());
                /*
                 * `deferred` is an ANSWER, not a failure. An unarmed user's transcripts are governed by
                 * the policy they were saved under, so there is nothing for this replay to converge and
                 * nothing to report as broken — raising here would turn a legacy user's harmless retry
                 * into a hard save error. What the replay owes is to ASK; the verdict travels back in
                 * `retention` either way. Any other non-converged status still means it asked, was
                 * allowed to act, and did not finish, which stays a retryable failure.
                 */
                IF COALESCE(v_retention->>'status', 'error') NOT IN ('converged', 'deferred') THEN
                    RAISE EXCEPTION 'create_session_and_update_usage: replayed transcript retention did not converge (status=%)',
                        COALESCE(v_retention->>'status', 'error')
                        USING ERRCODE = '55000';
                END IF;
                RETURN jsonb_build_object(
                    'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_existing_session_id),
                    'usage_exceeded', false,
                    'is_duplicate', true,
                    'retention', v_retention
                );
            END IF;
            RETURN jsonb_build_object(
                'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_existing_session_id),
                'usage_exceeded', false,
                'is_duplicate', true
            );
        END IF;
    END IF;

    SELECT public.effective_subscription_tier(
        subscription_status,
        trial_expires_at,
        stripe_subscription_id,
        subscription_id,
        commercial_trial_granted_at
    )
    INTO v_user_tier
    FROM public.user_profiles
    WHERE id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', 'profile_not_found'
        );
    END IF;

    SELECT max_concurrent_sessions INTO v_max_concurrent
    FROM public.tier_configs
    WHERE tier_name = COALESCE(v_user_tier, 'free');
    IF v_max_concurrent IS NULL THEN
        v_max_concurrent := 1;
    END IF;

    UPDATE public.sessions
    SET status = 'failed', updated_at = now()
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= now();

    SELECT COUNT(*) INTO v_active_sessions
    FROM public.sessions
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now());

    IF v_active_sessions >= v_max_concurrent THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', 'max_concurrent_sessions_reached',
            'active_sessions', v_active_sessions,
            'max_concurrent_sessions', v_max_concurrent
        );
    END IF;

    v_duration := COALESCE((p_session_data->>'duration')::INT, 0);
    IF v_duration < 0 OR v_duration > 600 THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', false,
            'error', 'technical_duration_cap_exceeded',
            'max_duration_seconds', 600
        );
    END IF;
    v_initial_at_cap := (v_duration = 600);

    INSERT INTO public.sessions (
        id, user_id, title, duration, total_words, filler_words, accuracy, ground_truth,
        transcript, engine, clarity_score, wpm, idempotency_key, engine_version,
        model_name, device_type, status, expires_at
    ) VALUES (
        v_new_session_id,
        auth.uid(),
        p_session_data->>'title',
        v_duration,
        COALESCE((p_session_data->>'total_words')::INT, 0),
        COALESCE((p_session_data->'filler_words')::JSONB, '{}'::JSONB),
        (p_session_data->>'accuracy')::FLOAT8,
        p_session_data->>'ground_truth',
        p_session_data->>'transcript',
        p_engine_type,
        (p_session_data->>'clarity_score')::FLOAT8,
        (p_session_data->>'wpm')::FLOAT8,
        p_idempotency_key,
        p_engine_version,
        p_model_name,
        p_device_type,
        CASE WHEN v_initial_at_cap THEN 'completed' ELSE 'active' END,
        CASE WHEN v_initial_at_cap THEN NULL ELSE now() + interval '1 hour' END
    );

    IF v_initial_at_cap THEN
        UPDATE public.sessions
        SET status_reason = 'technical_duration_cap', updated_at = now()
        WHERE id = v_new_session_id AND user_id = auth.uid();
    END IF;

    v_usage_check := public.update_user_usage(v_duration, p_engine_type, v_new_session_id);
    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        DELETE FROM public.sessions
        WHERE id = v_new_session_id AND user_id = auth.uid();
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', v_usage_check->>'error'
        );
    END IF;

    /*
     * #1436 P1 — the at-cap create is a completed save, and arms only once it has SUCCEEDED.
     * Placed after the usage check: the rejection branch above deletes the session and returns, and
     * arming before that point left an arming row behind for a save that never happened.
     */
    v_writes_transcript := COALESCE(p_session_data->>'transcript', '') ~ '[^[:space:]]';
    IF v_initial_at_cap AND v_writes_transcript THEN
        PERFORM public.arm_transcript_retention_for_save(auth.uid(), v_new_session_id);
    END IF;

    IF v_duration > 0 THEN
        INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
        VALUES (v_new_session_id, auth.uid(), v_duration, p_engine_type);
    END IF;

    /**
     * #1436 P1 — A TRANSCRIPT-WRITING CREATE IS ATOMIC WITH ITS RETENTION.
     *
     * This inserted the row, then swallowed every convergence failure — and also accepted a
     * `pending`/`non_converged` status — without undoing the insert. Under newest-ONE that leaves TWO
     * readable transcripts whenever the prior one lacks terminal evidence, which is precisely the
     * state the policy exists to prevent, reached through the recovery path rather than the normal one.
     *
     * Placeholder creates are unaffected: they write no text, so they cannot create a second one, and
     * their pending/error reporting is preserved exactly.
     *
     * When text IS written, a non-converged outcome raises inside the SAME transaction, so the new
     * row, the usage checkpoint and any partial retention writes roll back together. The controller
     * then receives a retryable save failure and keeps its recovery draft — which is the honest
     * outcome. NULLing the new transcript and reporting success would tell the user their words were
     * saved while discarding them.
     */
    /*
     * #1436 P1 — A PLACEHOLDER MUST NOT EXPIRE ANYTHING. RECORDING START IS NOT A SAVE.
     *
     * This called the coordinator unconditionally. On the first application of this migration to a
     * user who still holds two legacy transcripts whose older row already has terminal evidence, the
     * ordinary transcript-free create AT RECORDING START reached that call and irreversibly expired
     * the older transcript — before the new take had captured a word. The user could then cancel or
     * fail that take and be left with strictly less readable text than before they pressed record,
     * which contradicts this migration's own "next completed save" boundary.
     *
     * Retention converges on COMPLETION, where a new transcript actually exists to supersede the old
     * one. A placeholder reports `deferred` and expires nothing; `complete_session_v2` and the
     * transcript-bearing create below remain the only paths that can retire a transcript.
     *
     * My casualty 4 could not catch this: it deliberately leaves the candidate PENDING so the
     * coordinator has nothing it is allowed to expire, so the destructive branch never ran. The new
     * casualty gives the older row terminal evidence — the state in which convergence WOULD act — and
     * asserts the placeholder still expires nothing.
     */
    IF NOT v_writes_transcript THEN
        v_retention := jsonb_build_object('status', 'deferred', 'reason', 'placeholder_create');
    ELSE
        BEGIN
            v_retention := public.converge_transcript_retention(auth.uid());
        EXCEPTION
            WHEN query_canceled THEN
                RAISE;
            WHEN OTHERS THEN
                RAISE;
        END;
    END IF;

    /*
     * #1436 P1 — A LATE-CREATE RECOVERY MUST REACH `complete_session_v2`.
     *
     * The missing-session recovery path supplies a real transcript with an ordinary sub-600s duration,
     * so the row is inserted ACTIVE and retention legitimately defers. Treating that deferral as a
     * failure rolled the row back and returned no session id, so the controller never reached the
     * authoritative completion transaction and never installed its full-save retry — the recovery
     * path was broken by the guard meant to protect it.
     *
     * Only a create that is ITSELF a completed save owes convergence. An active create defers, keeps
     * its row, and converges when completion arms and runs it.
     */
    IF v_writes_transcript
       AND v_initial_at_cap
       AND COALESCE(v_retention->>'status', 'error') <> 'converged' THEN
        RAISE EXCEPTION 'create_session_and_update_usage: transcript retention did not converge (status=%)',
            COALESCE(v_retention->>'status', 'error')
            USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
        'usage_exceeded', false,
        'at_cap', v_initial_at_cap,
        'max_duration_seconds', 600,
        'retention', v_retention
    );
END;
$$;

DROP FUNCTION IF EXISTS public.expire_transcripts_newest_two(uuid, integer);
