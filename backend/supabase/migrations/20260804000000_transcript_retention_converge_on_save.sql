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

-- 3) Wire the coordinator into EVERY transcript-persisting server path (writer sweep: exactly these two live
--    writers set a non-empty sessions.transcript). Bodies reproduced VERBATIM from 20260610210500 /
--    20260610143000 with ONLY a guarded converge call added on the SUCCESS path — a retention issue never
--    rolls back a valid save (the save's own success is authoritative). Retention status is content-free.

CREATE OR REPLACE FUNCTION public.create_session_and_update_usage(
    p_session_data JSONB,
    p_engine_type TEXT DEFAULT 'native',
    p_idempotency_key UUID DEFAULT NULL,
    p_engine_version TEXT DEFAULT NULL,
    p_model_name TEXT DEFAULT NULL,
    p_device_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_session_id UUID;
    v_new_session_id UUID := gen_random_uuid();
    v_duration INT;
    v_usage_check JSONB;
    v_user_tier TEXT;
    v_max_concurrent INT;
    v_active_sessions INT;
    v_retention JSONB;  -- #1117 R2
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
        subscription_id
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
    SET
        status = 'failed',
        updated_at = now()
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

    INSERT INTO public.sessions (
        id,
        user_id,
        title,
        duration,
        total_words,
        filler_words,
        accuracy,
        ground_truth,
        transcript,
        engine,
        clarity_score,
        wpm,
        idempotency_key,
        engine_version,
        model_name,
        device_type,
        status,
        expires_at
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
        'active',
        now() + interval '1 hour'
    );

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

    -- #1117 R2: evidence-gated retention convergence for the saving user. Guarded — a retention issue never
    -- rolls back a valid save. Under the same in-txn user_profiles FOR UPDATE lock taken above.
    BEGIN
        v_retention := public.converge_transcript_retention(auth.uid());
    EXCEPTION WHEN OTHERS THEN
        v_retention := jsonb_build_object('status', 'error');
    END;

    RETURN jsonb_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
        'usage_exceeded', false,
        'private_sample_seconds_remaining', v_usage_check->'private_sample_seconds_remaining',
        'retention', v_retention
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_session_and_update_usage(JSONB, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_session_and_update_usage(JSONB, TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_session_and_update_usage(JSONB, TEXT, UUID, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_session(
    p_session_id UUID,
    p_status TEXT DEFAULT 'completed',
    p_final_transcript TEXT DEFAULT NULL,
    p_final_duration INT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session public.sessions%ROWTYPE;
    v_effective_tier TEXT;
    v_sample_limit INT;
    v_sample_used INT;
    v_final_duration INT;
    v_is_unpaid_sample BOOLEAN := false;
    v_retention JSONB;  -- #1117 R2
BEGIN
    SELECT * INTO v_session
    FROM public.sessions
    WHERE id = p_session_id AND user_id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'session_not_found');
    END IF;

    SELECT
      public.effective_subscription_tier(
        subscription_status,
        trial_expires_at,
        stripe_subscription_id,
        subscription_id
      ),
      COALESCE(private_sample_limit_seconds, 300),
      COALESCE(private_sample_seconds_used, 0)
    INTO v_effective_tier, v_sample_limit, v_sample_used
    FROM public.user_profiles
    WHERE id = auth.uid()
    FOR UPDATE;

    v_final_duration := GREATEST(0, COALESCE(p_final_duration, v_session.duration, 0));
    v_is_unpaid_sample := (
      v_effective_tier <> 'pro'
      AND lower(COALESCE(v_session.engine, '')) = 'private'
    );

    IF v_is_unpaid_sample THEN
      v_final_duration := LEAST(v_final_duration, v_sample_limit);

      UPDATE public.user_profiles
      SET
        private_sample_session_id = COALESCE(private_sample_session_id, p_session_id),
        private_sample_started_at = COALESCE(private_sample_started_at, v_session.created_at, now()),
        private_sample_seconds_used = LEAST(v_sample_limit, GREATEST(v_sample_used, v_final_duration)),
        private_sample_completed_at = COALESCE(private_sample_completed_at, now()),
        updated_at = now()
      WHERE id = auth.uid();
    END IF;

    UPDATE public.sessions
    SET status = p_status,
        status_reason = COALESCE(p_reason, status_reason),
        transcript = COALESCE(p_final_transcript, transcript),
        duration = CASE
          WHEN v_is_unpaid_sample THEN v_final_duration
          ELSE COALESCE(p_final_duration, duration)
        END,
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();

    -- #1117 R2: evidence-gated retention convergence after the transcript-writing finalize. Guarded — never
    -- rolls back the finalize. Under the same in-txn session + user_profiles FOR UPDATE locks taken above.
    BEGIN
        v_retention := public.converge_transcript_retention(auth.uid());
    EXCEPTION WHEN OTHERS THEN
        v_retention := jsonb_build_object('status', 'error');
    END;

    RETURN jsonb_build_object(
        'success', true,
        'final_status', p_status,
        'private_sample_completed', v_is_unpaid_sample,
        'retention', v_retention
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) TO service_role;
