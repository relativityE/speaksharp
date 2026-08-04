-- #1117 R3 — Aggregate-only, READ-ONLY transcript-retention production PREFLIGHT.
--
-- Consumes merged R1 (20260803000000, newest_two_v1 predicate/version) + R2 (20260804000000, evidence-gated
-- coordinator). Proves — WITHOUT writing, deleting, expiring, backfilling, repairing or sampling anything —
-- whether production is ready for a SEPARATELY-AUTHORIZED retention operation. Returns ONE sanitized JSON
-- verdict of counts/booleans/bytes only; never a transcript, email, identifier, row or free-form string.
--
-- SOURCE-ONLY: R3 does NOT apply this migration to production, run a scrub, or query customer content. The
-- function is defined here and proven in the repo PostgreSQL/PGlite harness. It is executed against a real
-- environment ONLY later, under a separate PREFLIGHT GO, by the manual dry-run-only workflow
-- (.github/workflows/transcript-retention-preflight.yml), inside a REPEATABLE READ, READ ONLY transaction.
--
-- FAIL CLOSED: unknown/forked policy version, missing R1/R2 objects (schema drift), or a bad scope RAISE.
-- Data-level contradictions (expired-with-text / available-without-text / not_captured-with-text / unknown
-- state) and any newest-two violation set verdict.status='blocked' (never 'ready'). #1161 authority-version
-- integration stays explicit: an unknown version never proceeds.
--
-- PAIRED SOURCE ROLLBACK: DROP FUNCTION IF EXISTS public.transcript_retention_preflight(text, uuid, text);

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
  c_policy  constant text := 'newest_two_v1';
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
     OR to_regprocedure('public.expire_transcripts_newest_two(uuid, integer)') IS NULL
     OR to_regprocedure('public.converge_transcript_retention(uuid)') IS NULL
     OR to_regprocedure('public.transcript_retention_invariant_violations(uuid)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='sessions' AND column_name='transcript_state') THEN
    RAISE EXCEPTION 'transcript_retention_preflight: required R1/R2 schema objects missing (schema drift)'
      USING ERRCODE = '42883';
  END IF;
  IF p_scope NOT IN ('all_users','single_user') THEN
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
  cand AS (  -- outgoing candidates = transcript-bearing rank > 2 (would be expired by the authorized scrub)
    SELECT r.id, r.user_id FROM ranked r WHERE r.rn > 2
  ),
  cand_pending AS (  -- candidates WITHOUT a durable terminal evaluation (R2 evidence gate) => retention pending
    SELECT c.id, c.user_id FROM cand c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.session_progress_evaluations e
      WHERE e.session_id = c.id AND e.formula_version = c_formula AND e.attribution_status IS DISTINCT FROM 'pending')
  ),
  per_user_retained AS (  -- transcript-bearing rows RETAINED after the simulated scrub = min(bearing, 2)
    SELECT user_id, count(*) FILTER (WHERE rn <= 2) AS retained FROM ranked GROUP BY user_id
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
      (SELECT count(*) FROM cand)::bigint AS rank_gt2_eligible,
      (SELECT count(*) FROM cand_pending)::bigint AS pending_evidence_backlog,
      (SELECT count(DISTINCT user_id) FROM cand_pending)::bigint AS users_pending_backlog,
      (SELECT coalesce(max(retained),0) FROM per_user_retained)::bigint AS simulated_max_retained_per_user,
      (SELECT count(*) FROM per_user_retained WHERE retained > 2)::bigint AS users_over_two_after
  )
  SELECT
    jsonb_build_object(
      'sessions_total', sessions_total, 'state_available', state_available, 'state_expired', state_expired,
      'state_not_captured', state_not_captured, 'transcript_bearing', transcript_bearing,
      'users_total', users_total, 'users_with_candidates', users_with_candidates,
      'rank_gt2_eligible', rank_gt2_eligible, 'pending_evidence_backlog', pending_evidence_backlog,
      'users_pending_backlog', users_pending_backlog),
    jsonb_build_object(
      'simulated_expire_count', rank_gt2_eligible,
      'simulated_max_retained_per_user', simulated_max_retained_per_user,
      'users_over_two_after', users_over_two_after,
      'newest_two_violations', users_over_two_after)
  INTO v_counts, v_sim FROM base;

  IF (v_sim->>'simulated_max_retained_per_user')::bigint > 2 OR (v_sim->>'users_over_two_after')::bigint > 0 THEN
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

-- Least privilege, fail closed: revoke PUBLIC; grant EXECUTE to the intended server caller (service_role)
-- ONLY. anon/authenticated cannot run the preflight.
REVOKE ALL ON FUNCTION public.transcript_retention_preflight(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transcript_retention_preflight(text, uuid, text) TO service_role;
