-- #1306/#1258 — RETAIN EXACTLY ONE TRANSCRIPT, THROUGH THE PATH THE PRODUCT ACTUALLY USES.
--
-- WHY. SpeakSharp keeps the transcript of the user's most recent saved session so they can review it
-- alongside the next practice action recommended from it. Saving a newer session replaces the retained
-- transcript. Only the transcript TEXT is removed: the session row, its metrics, its Progress evaluation
-- and its Practice Loop history all remain, so progress stays measurable after the words are gone.
--
-- WHY THIS SHAPE. An earlier draft added a NEW mutation and left everything else pointing at newest-two.
-- Nothing called it. `complete_session_v2` — the only live transcript-persisting save path — reaches
-- retention through `converge_transcript_retention`, which pins the policy VERSION MARKER and calls the
-- newest-two mutation; the R3 preflight pins the same marker and does its own newest-two arithmetic. A
-- parallel function changes no behaviour at all: the deployed product would have gone on retaining two
-- while this file claimed one. Retention is a policy expressed by four shared objects, so the policy is
-- changed in those four objects and the retired mutation is removed rather than left callable.
--
-- WHY NO FOREIGN-KEY CHANGE. An earlier draft also converted three Practice Loop cascades to SET NULL, on
-- the premise that session A is DELETED when B is saved. That premise is false. Retention NULLs a
-- transcript column; it never deletes a session row, so no cascade can fire and no loop record is at risk.
-- Those changes are removed: they loosened durable referential guarantees to solve a problem that does not
-- exist, and a nullable provenance column would have silently admitted orphaned coaching evidence.
--
-- SOURCE-ONLY. No historical migration is edited. Applying this to any environment is a separate decision.
--
-- KNOWN COUPLING, PROVEN IN tests/db/transcript-retention-newest-one.integration.test.ts AND NOT MASKED
-- HERE: Option A (20260804000000) defers expiry while an outgoing candidate's terminal Progress evaluation
-- is still pending, and `complete_session_v2` reverts a newly written transcript whenever retention did not
-- report 'converged'. Under newest-two those two rules first interacted at a user's THIRD save; under
-- newest-one they interact at the SECOND. A user whose first session has no durable terminal evaluation
-- therefore saves session B and keeps no transcript (`transcript_outcome = 'retention_failed'`). That is a
-- product decision about which guarantee wins — never exceed one retained transcript, or never lose the
-- newest one — and it is deliberately NOT decided here.
--
-- PAIRED SOURCE ROLLBACK: re-apply 20260803000000 then 20260804000000 then 20260805000000 in that order
-- (each is CREATE OR REPLACE and restores the newest-two version marker, predicate, mutation, coordinator
-- and preflight), then DROP FUNCTION IF EXISTS public.expire_transcripts_newest_one(uuid, integer).

BEGIN;

-- ── 1. The version marker every retention object pins ────────────────────────────────────────────────
-- This is the fail-closed hinge: the coordinator and the preflight both refuse to run against a version
-- they were not written for. Moving it without moving them would stop retention entirely rather than
-- change it, which is why all four objects move together in this one transaction.
CREATE OR REPLACE FUNCTION public.transcript_retention_policy_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT 'newest_one_v1'::text $$;

-- ── 2. The shared outgoing-candidate predicate ───────────────────────────────────────────────────────
-- Transcript-bearing rank > 1: every transcript-bearing session except the newest. A BLANK transcript is
-- not transcript-bearing and never ranks, so a failed or discarded save cannot displace a real one.
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

-- ── 3. The bounded mutation ──────────────────────────────────────────────────────────────────────────
-- Same shape as the newest-two mutation it replaces: bounded batch, fail-closed on any pre-existing
-- invariant violation, content-free result. The single behavioural difference is the rank boundary.
CREATE OR REPLACE FUNCTION public.expire_transcripts_newest_one(
  p_user_id    uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_viol     record;
  v_affected integer;
  v_has_more boolean;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_one: p_batch_size % out of bounds (1..5000)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- Never scrub an inconsistent cohort: a contradiction in scope means we do not know what is true.
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
    'policy_version', 'newest_one_v1',
    'expired_count', v_affected,
    'has_more', v_has_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_transcripts_newest_one(uuid, integer) FROM PUBLIC;

COMMENT ON FUNCTION public.expire_transcripts_newest_one(uuid, integer) IS
  'Retains the transcript of the newest transcript-bearing saved session per user; expires older ones. '
  'Blank transcripts never rank. Session rows, metrics, evaluations and Practice Loop history are untouched.';

-- ── 4. The coordinator the live save path calls ──────────────────────────────────────────────────────
-- Body reproduced from 20260804000000 with exactly two changes: the pinned version and the mutation it
-- invokes. The Option A evidence gate is deliberately unchanged — deferring while a candidate's terminal
-- Progress evaluation is pending is the rule that stops retention from destroying its own evidence, and it
-- is not this migration's to relax. See the KNOWN COUPLING note in the header.
CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  c_formula  constant text := 'clarity_v1';
  v_candidates integer;
  v_pending    integer;
  v_batch      jsonb;
  v_expired    integer := 0;
  v_has_more   boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'converge_transcript_retention: p_user_id is required' USING ERRCODE = '22004';
  END IF;

  IF public.transcript_retention_policy_version() IS DISTINCT FROM 'newest_one_v1' THEN
    RAISE EXCEPTION 'converge_transcript_retention: unexpected retention policy version %',
      public.transcript_retention_policy_version() USING ERRCODE = '55000';
  END IF;

  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;

  SELECT count(*) INTO v_candidates FROM public.transcript_sessions_to_expire(p_user_id);

  IF v_candidates = 0 THEN
    RETURN jsonb_build_object('status','converged','policy_version','newest_one_v1',
      'eligible_candidate_count',0,'pending_evidence_count',0,'expired_count',0,'has_more',false);
  END IF;

  SELECT count(*) INTO v_pending
  FROM public.transcript_sessions_to_expire(p_user_id) c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.session_progress_evaluations e
    WHERE e.session_id = c.session_id
      AND e.formula_version = c_formula
      AND e.attribution_status IS DISTINCT FROM 'pending'
  );

  IF v_pending > 0 THEN
    RETURN jsonb_build_object('status','pending','policy_version','newest_one_v1',
      'eligible_candidate_count', v_candidates - v_pending, 'pending_evidence_count', v_pending,
      'expired_count',0,'has_more',false);
  END IF;

  v_batch := public.expire_transcripts_newest_one(p_user_id, 500);
  v_expired  := (v_batch->>'expired_count')::integer;
  v_has_more := (v_batch->>'has_more')::boolean;

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

REVOKE ALL ON FUNCTION public.converge_transcript_retention(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.converge_transcript_retention(uuid) TO service_role;

-- ── 5. The read-only production preflight ────────────────────────────────────────────────────────────
-- Body reproduced from 20260805000000 with the rank boundary, the retained-per-user ceiling, the required
-- object list and the version pin moved to newest-one. Left on newest-two it would either refuse to run at
-- all (version mismatch) or, worse, report 'ready' while simulating the wrong policy.
CREATE OR REPLACE FUNCTION public.transcript_retention_preflight(
  p_scope   text DEFAULT 'all_users',
  p_user_id uuid DEFAULT NULL,
  p_run_id  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
  PERFORM set_config('statement_timeout', '30000', true);
  PERFORM set_config('lock_timeout', '2000', true);

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
    RAISE EXCEPTION 'transcript_retention_preflight: required retention schema objects missing (schema drift)'
      USING ERRCODE = '42883';
  END IF;
  IF p_scope IS NULL OR p_scope NOT IN ('all_users','single_user') THEN
    RAISE EXCEPTION 'transcript_retention_preflight: invalid scope %', p_scope USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'single_user' AND p_user_id IS NULL THEN
    RAISE EXCEPTION 'transcript_retention_preflight: single_user requires p_user_id' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_viol FROM public.transcript_retention_invariant_violations(
    CASE WHEN p_scope='single_user' THEN p_user_id ELSE NULL END);
  IF v_viol.expired_with_text > 0 OR v_viol.available_without_text > 0
     OR v_viol.not_captured_with_text > 0 OR v_viol.unknown_state > 0 THEN
    v_blocked := true;
  END IF;

  WITH ranked AS (
    SELECT s.id, s.user_id, s.transcript_state, s.transcript,
           row_number() OVER (PARTITION BY s.user_id ORDER BY s.created_at DESC, s.id DESC) AS rn
    FROM public.sessions s
    WHERE (p_scope='all_users' OR s.user_id = p_user_id)
      AND s.transcript IS NOT NULL AND s.transcript ~ '[^[:space:]]'
  ),
  cand AS (  -- outgoing candidates = transcript-bearing rank > 1
    SELECT r.id, r.user_id FROM ranked r WHERE r.rn > 1
  ),
  cand_pending AS (
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
      (SELECT count(*) FROM per_user_retained WHERE retained > 1)::bigint AS users_over_one_after
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
      'users_over_one_after', users_over_one_after,
      'newest_one_violations', users_over_one_after)
  INTO v_counts, v_sim FROM base;

  IF (v_sim->>'simulated_max_retained_per_user')::bigint > 1 OR (v_sim->>'users_over_one_after')::bigint > 0 THEN
    v_blocked := true;
  END IF;

  IF (v_counts->>'pending_evidence_backlog')::bigint > 0 THEN
    v_blocked := true;
  END IF;

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

REVOKE ALL ON FUNCTION public.transcript_retention_preflight(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transcript_retention_preflight(text, uuid, text) TO service_role;

-- ── 6. Retire the superseded mutation ────────────────────────────────────────────────────────────────
-- Leaving a callable `expire_transcripts_newest_two` would leave two contradictory retention policies
-- executable side by side, and the retired one silently retains a transcript the product says it deleted.
-- Nothing references it after section 4 and section 5.
DROP FUNCTION IF EXISTS public.expire_transcripts_newest_two(uuid, integer);

COMMIT;
