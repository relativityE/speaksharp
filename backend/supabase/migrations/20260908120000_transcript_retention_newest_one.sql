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
    v_writes_transcript := COALESCE(p_session_data->>'transcript', '') ~ '[^[:space:]]';

    BEGIN
        v_retention := public.converge_transcript_retention(auth.uid());
    EXCEPTION
        WHEN query_canceled THEN
            IF v_writes_transcript THEN RAISE; END IF;
            v_retention := jsonb_build_object('status', 'error');
        WHEN OTHERS THEN
            IF v_writes_transcript THEN RAISE; END IF;
            v_retention := jsonb_build_object('status', 'error');
    END;

    IF v_writes_transcript
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
