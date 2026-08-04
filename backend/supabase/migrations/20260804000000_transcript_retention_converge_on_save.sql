-- #1117 R2 — Automatic, evidence-gated transcript-retention enforcement on save (Option A).
--
-- Builds on merged R1 (20260803000000): reuses R1's EXACT version marker, predicate and mutation — no fork
-- of newest-two ranking. R2 adds one shared server-side COORDINATOR that every transcript-persisting server
-- path (create_session_and_update_usage, complete_session) invokes, and that also runs after a terminal
-- Progress evaluation persists — so an older transcript converges to expiry automatically once, and only
-- once, its transcript-dependent Progress evidence is durably terminal.
--
-- OPTION A CONTRACT (PM disposition):
--   * NEVER expire a candidate whose terminal Progress evaluation is not yet durable. `pending` attribution
--     or a missing evaluation => RETENTION PENDING (defer), never delete. A temporary rank>2 transcript is
--     allowed only while its required terminal evaluation is genuinely pending, and converges automatically.
--   * A valid session save is NEVER rolled back for retention non-convergence (the coordinator is invoked in
--     a guarded sub-block by the save paths; only the retention operation reports pending/non-converged).
--   * Do NOT write a premature immutable evaluation, do NOT make evaluations upgradable, do NOT port
--     recommendation/UI copy into SQL (recommendation derives from the durable evaluation, is
--     transcript-independent, and stays client-derived/reconcile-only).
--   * Content-free status only: converged | pending | non_converged, candidate counts, has_more — never
--     transcript or customer content.
--   * #1161 later moves attribution authority server-side and MUST reuse this same coordinator; R2 does not
--     wait for #1161 and does not trust a client-writable "verified" as new authority.
--
-- SOURCE-ONLY: not applied to production by R2; runs no production query/scrub; does not close #1117.
--
-- PAIRED SOURCE ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_spe_converge_retention ON public.session_progress_evaluations;
--   DROP FUNCTION IF EXISTS public.spe_converge_retention();
--   -- and restore create_session_and_update_usage / complete_session to their pre-R2 bodies (20260610210500 / 20260610143000)
--   DROP FUNCTION IF EXISTS public.converge_transcript_retention(uuid);

-- 1) THE evidence-gated retention coordinator. One shared implementation; reuses R1 verbatim.
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
  IF public.transcript_retention_policy_version() IS DISTINCT FROM 'newest_two_v1' THEN
    RAISE EXCEPTION 'converge_transcript_retention: unexpected retention policy version %',
      public.transcript_retention_policy_version() USING ERRCODE = '55000';
  END IF;

  -- Per-user serialization on the SAME profile row both save paths already lock (no lossy UUID hash). When
  -- invoked inside a save RPC this lock is already held; re-locking in-txn is a no-op.
  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;

  -- Outgoing candidates = R1 predicate (transcript-bearing rank > 2), reused verbatim.
  SELECT count(*) INTO v_candidates FROM public.transcript_sessions_to_expire(p_user_id);

  IF v_candidates = 0 THEN
    RETURN jsonb_build_object('status','converged','policy_version','newest_two_v1',
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
    RETURN jsonb_build_object('status','pending','policy_version','newest_two_v1',
      'eligible_candidate_count', v_candidates - v_pending, 'pending_evidence_count', v_pending,
      'expired_count',0,'has_more',false);
  END IF;

  -- Every outgoing candidate has durable terminal evidence: ONE bounded R1 mutation (reused verbatim).
  v_r1 := public.expire_transcripts_newest_two(p_user_id, 500);
  v_expired  := (v_r1->>'expired_count')::integer;
  v_has_more := (v_r1->>'has_more')::boolean;

  -- has_more => a historical backlog beyond one bounded batch: report NON-CONVERGED for R3/authorized
  -- cleanup. Do NOT loop and do NOT roll back the save that invoked us.
  RETURN jsonb_build_object(
    'status', CASE WHEN v_has_more THEN 'non_converged' ELSE 'converged' END,
    'policy_version','newest_two_v1',
    'eligible_candidate_count', v_candidates,
    'pending_evidence_count', 0,
    'expired_count', v_expired,
    'has_more', v_has_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.converge_transcript_retention(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.converge_transcript_retention(uuid) TO service_role;

-- 2) Automatic convergence hook #2: when a TERMINAL Progress evaluation persists, re-attempt convergence for
--    that user so a previously blocked (pending-evidence) candidate expires immediately — without touching
--    or reproducing record_progress_evaluation. Guarded so a convergence issue never fails the evaluation.
CREATE OR REPLACE FUNCTION public.spe_converge_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.attribution_status IS DISTINCT FROM 'pending' THEN
    BEGIN
      PERFORM public.converge_transcript_retention(NEW.user_id);
    EXCEPTION WHEN OTHERS THEN
      -- Convergence is best-effort here; the durable evaluation is authoritative and must not be lost.
      NULL;
    END;
  END IF;
  RETURN NULL;  -- AFTER trigger
END;
$$;

DROP TRIGGER IF EXISTS trg_spe_converge_retention ON public.session_progress_evaluations;
CREATE TRIGGER trg_spe_converge_retention
  AFTER INSERT ON public.session_progress_evaluations
  FOR EACH ROW
  EXECUTE FUNCTION public.spe_converge_retention();

REVOKE ALL ON FUNCTION public.spe_converge_retention() FROM PUBLIC;
