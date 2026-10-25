-- Forward-only retention repair. Installation performs no content cleanup or activation.
-- A trusted successful replacement captures only numeric/boolean text evidence, then erases
-- superseded live/recovery plaintext atomically. No provider, worker, or terminal attribution is invented.
-- Rollback: snapshot-aware forward correction or explicit replacement HOLD. Never restore old
-- tombstone-dependent definitions, remove snapshots, or reconstruct erased plaintext.
BEGIN;

CREATE TABLE public.session_progress_content_evidence (
  session_id uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capture_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  replacement_session_id uuid NOT NULL,
  format_version integer NOT NULL CHECK (format_version = 1),
  formula_version text NOT NULL CHECK (formula_version = 'clarity_v1'),
  marker_pattern_version text NOT NULL CHECK (marker_pattern_version = 'error_tags_v1'),
  cohort_digest text NOT NULL,
  has_nonblank boolean NOT NULL,
  error_marker_count integer NOT NULL CHECK (error_marker_count >= 0),
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.session_progress_content_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.session_progress_content_evidence FROM PUBLIC, anon, authenticated, service_role;

-- This is transaction authority, not the first historical arming row or a caller-supplied flag.
CREATE TABLE public.transcript_retention_replacement_context (
  txid bigint NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  PRIMARY KEY (txid, user_id)
);
ALTER TABLE public.transcript_retention_replacement_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transcript_retention_replacement_context FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.transcript_retention_expiry_grants ADD COLUMN capture_id uuid;
REVOKE ALL ON public.transcript_retention_expiry_grants FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.transcript_retention_function_pins (
  signature text PRIMARY KEY,
  definition_md5 text NOT NULL
);
ALTER TABLE public.transcript_retention_function_pins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.transcript_retention_function_pins FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public._ss_retention_content_cohort(s public.sessions)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT md5(jsonb_build_array(s.user_id, s.engine, s.engine_version, s.model_name, s.product)::text)
$$;
REVOKE ALL ON FUNCTION public._ss_retention_content_cohort(public.sessions) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.retention_content_free_compatible()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT count(*) = 8 AND coalesce(bool_and(
    to_regprocedure(signature) IS NOT NULL
    AND md5(pg_get_functiondef(to_regprocedure(signature))) = definition_md5
  ), false) FROM public.transcript_retention_function_pins
$$;
REVOKE ALL ON FUNCTION public.retention_content_free_compatible() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.retention_content_free_compatible() TO authenticated, service_role;

-- Authenticated direct writes acquire the same profile lock BEFORE any session row lock.
CREATE FUNCTION public._ss_retention_content_statement_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    PERFORM 1 FROM public.user_profiles WHERE id = auth.uid() FOR UPDATE;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public._ss_retention_content_statement_lock() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aa_retention_content_statement_lock
  BEFORE INSERT OR UPDATE OF transcript, transcript_state, user_id, status, created_at, engine, engine_version, model_name, product OR DELETE ON public.sessions
  FOR EACH STATEMENT EXECUTE FUNCTION public._ss_retention_content_statement_lock();

-- An independent sticky fence also survives a rollback of the old state-derivation function.
CREATE FUNCTION public._ss_retention_content_row_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id = NEW.user_id FOR UPDATE;
  IF TG_OP = 'UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'retention_owner_immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT public.retention_content_free_compatible() THEN
    RAISE EXCEPTION 'retention_snapshot_incompatible' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.transcript_state = 'expired' THEN
    NEW.transcript := NULL;
    NEW.transcript_state := 'expired';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._ss_retention_content_row_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aa_retention_content_row_guard
  BEFORE INSERT OR UPDATE OF transcript, transcript_state, user_id, status, created_at, engine, engine_version, model_name, product ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public._ss_retention_content_row_guard();

-- The old AFTER-expiry purge cannot stop a later W1/W2 reply from restoring derived plaintext.
-- This invoker guard touches only NEW; it adds no opposite profile/session lock ordering to coaching.
CREATE FUNCTION public._ss_retention_expired_derived_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.transcript_state = 'expired' THEN NEW.ai_suggestions := NULL; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._ss_retention_expired_derived_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aa_retention_expired_derived_guard
  BEFORE UPDATE OF ai_suggestions ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public._ss_retention_expired_derived_guard();

-- No participating old writer may create a phantom recovery copy after the replacement's scan.
-- Existing recovery rows are still readable until a successful replacement; DELETE/cascade is serialized.
CREATE FUNCTION public._ss_retention_recovery_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM 1 FROM public.user_profiles WHERE id = OLD.user_id FOR UPDATE;
    RETURN OLD;
  END IF;
  PERFORM 1 FROM public.user_profiles WHERE id = NEW.user_id FOR UPDATE;
  RAISE EXCEPTION 'retention_plaintext_recovery_write_refused' USING ERRCODE = '55000';
END;
$$;
REVOKE ALL ON FUNCTION public._ss_retention_recovery_write_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER aa_retention_recovery_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.transcript_retention_tombstones
  FOR EACH ROW EXECUTE FUNCTION public._ss_retention_recovery_write_guard();

CREATE OR REPLACE FUNCTION public.arm_transcript_retention_for_save(p_user_id uuid, p_session_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.sessions
    WHERE id = p_session_id AND user_id = p_user_id AND status = 'completed'
      AND transcript IS NOT NULL AND transcript ~ '[^[:space:]]') THEN
    RAISE EXCEPTION 'retention_replacement_not_saved' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.transcript_retention_arming(user_id, armed_by_session)
    VALUES(p_user_id, p_session_id) ON CONFLICT(user_id) DO NOTHING;
  IF public.transcript_retention_is_active() THEN
    INSERT INTO public.transcript_retention_replacement_context(txid, user_id, session_id)
      VALUES(pg_catalog.txid_current(), p_user_id, p_session_id)
      ON CONFLICT(txid, user_id) DO UPDATE SET session_id = EXCLUDED.session_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.arm_transcript_retention_for_save(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sessions_set_transcript_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.transcript_state = 'expired' THEN
    NEW.transcript_state := 'expired';
    NEW.transcript := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.transcript_state = 'expired' AND NEW.transcript IS NULL
    AND current_user = (SELECT pg_get_userbyid(proowner) FROM pg_proc
      WHERE oid = to_regprocedure('public.expire_transcripts_newest_one(uuid,integer)')) THEN
    IF EXISTS (SELECT 1 FROM public.transcript_retention_expiry_grants g
      JOIN public.session_progress_content_evidence e
        ON e.capture_id = g.capture_id AND e.session_id = g.session_id
      WHERE g.txid = pg_catalog.txid_current() AND g.session_id = OLD.id
        AND e.user_id = OLD.user_id AND e.format_version = 1
        AND e.formula_version = 'clarity_v1' AND e.marker_pattern_version = 'error_tags_v1'
        AND e.cohort_digest = public._ss_retention_content_cohort(OLD)) THEN
      RETURN NEW;
    END IF;
  END IF;
  NEW.transcript_state := CASE WHEN NEW.transcript IS NOT NULL AND NEW.transcript ~ '[^[:space:]]'
    THEN 'available' ELSE 'not_captured' END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_transcripts_newest_one(p_user_id uuid DEFAULT NULL, p_batch_size integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_keeper public.sessions%ROWTYPE;
  v_row public.sessions%ROWTYPE;
  v_text text;
  v_recovery public.transcript_retention_tombstones%ROWTYPE;
  v_evidence public.session_progress_content_evidence%ROWTYPE;
  v_ids uuid[] := '{}'::uuid[];
  v_id uuid;
  v_errors integer;
  v_nonblank boolean;
  v_viol record;
  v_count integer := 0;
BEGIN
  IF p_user_id IS NULL OR p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 500 THEN
    RAISE EXCEPTION 'retention_replacement_scope_or_bound_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT public.retention_content_free_compatible() THEN
    RAISE EXCEPTION 'retention_snapshot_incompatible' USING ERRCODE = '55000';
  END IF;
  IF NOT public.transcript_retention_is_active() OR NOT EXISTS(
    SELECT 1 FROM public.transcript_retention_replacement_context c
    JOIN public.sessions s ON s.id = c.session_id AND s.user_id = c.user_id
    WHERE c.txid = pg_catalog.txid_current() AND c.user_id = p_user_id
      AND s.status = 'completed' AND s.transcript IS NOT NULL AND s.transcript ~ '[^[:space:]]'
  ) THEN
    RAISE EXCEPTION 'retention_successful_replacement_required' USING ERRCODE = '55000';
  END IF;
  IF public.transcript_retention_policy_version() IS DISTINCT FROM 'newest_one_v1' THEN
    RAISE EXCEPTION 'retention_policy_incompatible' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_viol FROM public.transcript_retention_invariant_violations(p_user_id);
  IF v_viol.expired_with_text > 0 OR v_viol.available_without_text > 0
    OR v_viol.not_captured_with_text > 0 OR v_viol.unknown_state > 0 THEN
    RAISE EXCEPTION 'retention_state_contradiction' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_keeper FROM public.sessions
    WHERE user_id = p_user_id AND status = 'completed'
      AND transcript IS NOT NULL AND transcript ~ '[^[:space:]]'
    ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
  -- Count the UNION of distinct session ids, not a separate 500 allowance for each store.
  SELECT coalesce(array_agg(q.id ORDER BY q.id), '{}'::uuid[]) INTO v_ids FROM (
    SELECT s.id FROM public.sessions s
    LEFT JOIN public.transcript_retention_tombstones t ON t.session_id = s.id
    WHERE s.user_id = p_user_id AND s.status = 'completed'
      AND (s.created_at, s.id) < (v_keeper.created_at, v_keeper.id)
      AND (s.transcript IS NOT NULL OR t.session_id IS NOT NULL)
    ORDER BY s.id LIMIT 501
  ) q;
  IF cardinality(v_ids) > p_batch_size THEN
    RAISE EXCEPTION 'retention_outgoing_limit_exceeded' USING ERRCODE = '54000';
  END IF;
  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT * INTO STRICT v_row FROM public.sessions WHERE id = v_id AND user_id = p_user_id FOR UPDATE;
    SELECT * INTO v_recovery FROM public.transcript_retention_tombstones WHERE session_id = v_id FOR UPDATE;
    IF v_recovery.session_id IS NOT NULL AND
      (v_recovery.user_id IS DISTINCT FROM p_user_id OR v_recovery.policy_version <> 'newest_one_v1'
       OR (v_row.transcript IS NOT NULL AND v_recovery.transcript IS DISTINCT FROM v_row.transcript)) THEN
      RAISE EXCEPTION 'retention_recovery_source_mismatch' USING ERRCODE = '23514';
    END IF;
    v_text := coalesce(v_row.transcript, v_recovery.transcript);
    IF v_text IS NULL THEN
      RAISE EXCEPTION 'retention_content_source_missing' USING ERRCODE = '55000';
    END IF;
    v_nonblank := length(btrim(v_text)) > 0;
    SELECT count(*)::integer INTO v_errors FROM regexp_matches(v_text,
      '\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]', 'gi');
    INSERT INTO public.session_progress_content_evidence
      (session_id,user_id,replacement_session_id,format_version,formula_version,marker_pattern_version,
       cohort_digest,has_nonblank,error_marker_count)
      VALUES(v_id,p_user_id,v_keeper.id,1,'clarity_v1','error_tags_v1',
        public._ss_retention_content_cohort(v_row),v_nonblank,v_errors)
      ON CONFLICT(session_id) DO NOTHING;
    SELECT * INTO STRICT v_evidence FROM public.session_progress_content_evidence WHERE session_id = v_id;
    IF v_evidence.user_id IS DISTINCT FROM p_user_id OR v_evidence.format_version <> 1
      OR v_evidence.formula_version <> 'clarity_v1' OR v_evidence.marker_pattern_version <> 'error_tags_v1'
      OR v_evidence.cohort_digest IS DISTINCT FROM public._ss_retention_content_cohort(v_row)
      OR v_evidence.has_nonblank IS DISTINCT FROM v_nonblank OR v_evidence.error_marker_count <> v_errors THEN
      RAISE EXCEPTION 'retention_content_evidence_contradiction' USING ERRCODE = '23514';
    END IF;
    INSERT INTO public.transcript_retention_expiry_grants(txid,session_id,capture_id)
      VALUES(pg_catalog.txid_current(),v_id,v_evidence.capture_id);
    UPDATE public.sessions SET transcript = NULL, transcript_state = 'expired'
      WHERE id = v_id AND user_id = p_user_id;
    DELETE FROM public.transcript_retention_tombstones WHERE session_id = v_id AND user_id = p_user_id;
    IF EXISTS(SELECT 1 FROM public.sessions WHERE id = v_id AND
        (transcript IS NOT NULL OR transcript_state <> 'expired'))
      OR EXISTS(SELECT 1 FROM public.transcript_retention_tombstones WHERE session_id = v_id) THEN
      RAISE EXCEPTION 'retention_plaintext_removal_incomplete' USING ERRCODE = '55000';
    END IF;
    v_count := v_count + 1;
  END LOOP;
  DELETE FROM public.transcript_retention_expiry_grants WHERE txid = pg_catalog.txid_current();
  DELETE FROM public.transcript_retention_replacement_context
    WHERE txid = pg_catalog.txid_current() AND user_id = p_user_id;
  RETURN jsonb_build_object('policy_version','newest_one_v1','scope','single_user',
    'expired_count',v_count,'has_more',false);
END;
$$;
REVOKE ALL ON FUNCTION public.expire_transcripts_newest_one(uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_transcripts_newest_one(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.converge_transcript_retention(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'retention_owner_required' USING ERRCODE = '22004'; END IF;
  PERFORM 1 FROM public.user_profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT public.transcript_retention_is_active() THEN
    RETURN jsonb_build_object('status','deferred','reason','retention_not_activated','policy_version','newest_one_v1');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.transcript_retention_arming WHERE user_id = p_user_id) THEN
    RETURN jsonb_build_object('status','deferred','reason','retention_not_armed','policy_version','newest_one_v1');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.transcript_retention_replacement_context
      WHERE txid = pg_catalog.txid_current() AND user_id = p_user_id) THEN
    RETURN jsonb_build_object('status','deferred','reason','no_successful_replacement','policy_version','newest_one_v1');
  END IF;
  v_result := public.expire_transcripts_newest_one(p_user_id,500);
  RETURN v_result || jsonb_build_object('status','converged','eligible_candidate_count',
    (v_result->>'expired_count')::integer,'pending_evidence_count',0);
END;
$$;
REVOKE ALL ON FUNCTION public.converge_transcript_retention(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Delayed evaluation no longer performs destructive cleanup. Its original save already removed
-- plaintext after capturing evidence; a late terminal attribution cannot manufacture replacement authority.
CREATE OR REPLACE FUNCTION public.spe_converge_retention()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN RETURN NULL; END;
$$;
REVOKE ALL ON FUNCTION public.spe_converge_retention() FROM PUBLIC,anon,authenticated,service_role;

-- Current complete/create bodies preserve billing, lease, product, idempotency and transcript bounds.
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
           AND COALESCE(v_retention_status, 'error') NOT IN ('converged')
           AND NOT (
             v_retention_status = 'deferred'
             AND v_retention->>'reason' IN ('retention_not_activated', 'retention_not_armed', 'no_successful_replacement')
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
    -- #1476 one account, one authorized active engine.
    v_is_take BOOLEAN;
    v_lease_text TEXT;
    v_lease_id UUID;
    v_lease public.active_recording_lease%ROWTYPE;
    v_written UUID;
    v_lease_live BOOLEAN := false;
    v_legacy_take BOOLEAN := false;
    -- #1476 PM RETURN on 039043877 (F2): a missing-row Retry Save. It asks for LESS than a take — a row that can never
    -- record — so the request is not an authority claim: it takes no lease and no slot, bills the recording's duration
    -- through the ordinary entitlement check, and is bound to the recording's own idempotency identity.
    v_save_only BOOLEAN := COALESCE(p_session_data->>'save_only', '') = 'true';
    -- #1258 durable product marker: read once, validated below BEFORE any lookup, lock, lease, usage write or insert.
    v_product TEXT := p_session_data->>'product';
BEGIN
    SET LOCAL statement_timeout = '3000ms';

    -- #1258: a closed enum. An absent (or JSON null) product is a client that predates the marker: the row is created
    -- with product NULL (legacy/unknown). Anything else outside the enum is refused before this call does anything,
    -- with a generic code and no echo of the caller's payload.
    IF v_product IS NOT NULL AND v_product NOT IN ('open_mic', 'focus_points') THEN
        RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'invalid_product');
    END IF;

    IF v_save_only AND p_idempotency_key IS NULL THEN
        RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'save_only_requires_recording_identity');
    END IF;

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

    /*
     * #1476 — ONE ACCOUNT MAY ONLY RUN ONE STT ENGINE AT A TIME, across tabs and devices (PO rule).
     *
     * The account-keyed `active_recording_lease` is the authority for a TAKE (an `active` create). An at-cap create
     * (duration 600) is a completed recovery save, not engine work, and is not fenced here.
     *  - A current client sends the lease it acquired before engine preparation in `p_session_data.lease_id`
     *    (the existing JSONB: no new argument, so an older server simply ignores it). It must be the caller's LIVE
     *    lease, or the take is refused with `lease_not_held`.
     *  - An OLD client sends no lease. If another take is live it is refused with `max_concurrent_sessions_reached`,
     *    the code every shipped bundle already renders; otherwise it records under an IMPLICIT lease keyed to the new
     *    session id, which `_ss_fence_session_writes_1476` keeps alive on its heartbeats and releases on completion.
     *  - #1360 bounded recovery: a device that stopped responding holds only a STALE lease, which the next Start acquires;
     *    nothing else blocks the returning user. Its take is never closed here — the device that recorded it can still
     *    save it when it reconnects (PM directive: a save failure must stay recoverable).
     * Pro and Free alike: this check, not the tier's session cap, is what holds an account to one engine.
     */
    v_is_take := COALESCE((p_session_data->>'duration')::INT, 0) <> 600 AND NOT v_save_only;
    IF v_is_take THEN
        v_lease_text := p_session_data->>'lease_id';
        IF v_lease_text IS NOT NULL
           AND v_lease_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'lease_not_held');
        END IF;
        v_lease_id := v_lease_text::uuid;

        -- PM RETURN on 54576db9: serialize with `acquire_recording_lease` PER ACCOUNT. On an empty account a row lock
        -- has nothing to lock, so an old client and a current client could each decide the account was free.
        PERFORM pg_advisory_xact_lock(hashtextextended('ss_recording_lease_1476:' || auth.uid()::text, 0));
        SELECT * INTO v_lease FROM public.active_recording_lease WHERE user_id = auth.uid() FOR UPDATE;
        v_lease_live := FOUND AND v_lease.heartbeat_at >= now() - interval '15 seconds';

        IF v_lease_id IS NOT NULL THEN
            IF NOT (v_lease_live AND v_lease.lease_id = v_lease_id) THEN
                RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'lease_not_held');
            END IF;
        ELSIF v_lease_live THEN
            RETURN jsonb_build_object(
                'new_session', null,
                'usage_exceeded', true,
                'error', 'max_concurrent_sessions_reached',
                'active_sessions', 1,
                'max_concurrent_sessions', 1
            );
        ELSE
            v_legacy_take := true;
            -- PM pre-push RETURN (F4) — AN OLD TAB CANNOT SEE ANOTHER DEVICE'S PROGRESS DEBT. A pre-#1525 bundle reads only
            -- its v1 queue, and resumes a Start held on model preparation without re-checking freshness, so its placeholder
            -- create can arrive after a newer device completed a take whose Progress evaluation has not landed. The server
            -- holds that old client exactly as long as a current client holds its own Start on queued debt: its release
            -- bound is 60 s (PROGRESS_DEBT_RELEASE_BOUND_MS); 90 s here adds slack. Bounded, so no old tab is locked out by
            -- a debt that keeps failing; the debt itself stays owed. The old bundle maps this to a failed start (no row).
            -- A current client (it sends its lease) is governed by its own Start gate, which reads the server's obligations.
            IF EXISTS (
                SELECT 1 FROM public.sessions s
                WHERE s.user_id = auth.uid()
                  AND s.status = 'completed'
                  AND GREATEST(COALESCE(s.updated_at, s.created_at),
                               s.created_at + make_interval(secs => COALESCE(s.duration, 0))) >= now() - interval '90 seconds'
                  AND NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations e WHERE e.session_id = s.id)
            ) THEN
                RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'progress_evaluation_pending');
            END IF;
        END IF;
    END IF;

    -- #1476: the tier's session cap now counts only LEGACY takes created before this fence (no lease). A leased take is
    -- governed by the lease above; counting it would hold a returning user (#1360) or a device that took over behind a
    -- take that has already stopped and is only saving.
    -- PM RETURN on 039043877: a fenced row (displaced, or save-only) can never record, so it holds no slot.
    SELECT COUNT(*) INTO v_active_sessions
    FROM public.sessions
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND lease_id IS NULL
      AND recording_fenced_at IS NULL
      AND (expires_at IS NULL OR expires_at > now());

    IF NOT v_save_only AND v_active_sessions >= v_max_concurrent THEN
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
    v_initial_at_cap := (v_duration = 600) AND NOT v_save_only;

    IF v_legacy_take THEN
        -- The OLD client's implicit lease, written BEFORE the take row so the insert fence sees it. Its heartbeat_session runs every ~30 s, so the lease is kept 30 s ahead of
        -- now; the 15 s staleness window then tolerates the old cadence.
        -- Never replaces a LIVE holder (PM RETURN on 54576db9): only a stale lease is taken, and a refused upsert refuses
        -- the take with the code every shipped bundle renders.
        -- A stale holder this take replaces is DISPLACED, permanently (PM RETURN on 039043877, F1).
        IF v_lease.lease_id IS NOT NULL THEN
            UPDATE public.sessions
            SET recording_fenced_at = now(), recording_fenced_reason = 'displaced'
            WHERE user_id = auth.uid() AND lease_id = v_lease.lease_id AND status = 'active'
              AND lease_released_at IS NULL AND recording_fenced_at IS NULL;
        END IF;
        v_written := NULL;
        INSERT INTO public.active_recording_lease AS l (user_id, lease_id, holder_label, state, started_at, heartbeat_at)
        VALUES (auth.uid(), v_new_session_id, 'an older version of SpeakSharp', 'recording', now(), now() + interval '30 seconds')
        ON CONFLICT (user_id) DO UPDATE
          SET lease_id = EXCLUDED.lease_id, holder_label = EXCLUDED.holder_label, state = 'recording',
              started_at = now(), heartbeat_at = EXCLUDED.heartbeat_at
          WHERE l.heartbeat_at < now() - interval '15 seconds'
        RETURNING l.lease_id INTO v_written;
        IF v_written IS NULL THEN
            RETURN jsonb_build_object(
                'new_session', null,
                'usage_exceeded', true,
                'error', 'max_concurrent_sessions_reached',
                'active_sessions', 1,
                'max_concurrent_sessions', 1
            );
        END IF;
    END IF;

    INSERT INTO public.sessions (
        id, user_id, title, duration, total_words, filler_words, accuracy, ground_truth,
        transcript, engine, clarity_score, wpm, idempotency_key, engine_version,
        model_name, device_type, status, expires_at, lease_id, recording_fenced_at, recording_fenced_reason, product
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
        CASE WHEN v_initial_at_cap THEN NULL ELSE now() + interval '1 hour' END,
        CASE WHEN NOT v_is_take THEN NULL
             WHEN v_legacy_take THEN v_new_session_id
             ELSE v_lease_id END,
        CASE WHEN v_save_only THEN now() END,
        CASE WHEN v_save_only THEN 'save_only' END,
        v_product
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
    /*
     * #1436 P1 — AN ACTIVE RECOVERY CREATE IS NOT A SAVE EITHER.
     *
     * `v_initial_at_cap` gated only whether a non-converged result RAISES; every transcript-bearing
     * create still called the coordinator. A sub-600s recovery create inserts an `active` row, and for
     * an already-armed user whose retained transcript carries terminal evidence that new row ranks
     * first — so the coordinator immediately expired the previously saved transcript. If the recovery
     * take was then abandoned, or its `complete_session_v2` failed, the user was left with strictly
     * less readable text than before they started, and the loss is irreversible.
     *
     * The rule the placeholder branch already states applies here unchanged: retention converges on
     * COMPLETION. The at-cap create is the only create that IS a completion; everything else defers
     * and expires nothing, and the real convergence happens when `complete_session_v2` runs.
     */
    IF NOT v_writes_transcript THEN
        v_retention := jsonb_build_object('status', 'deferred', 'reason', 'placeholder_create');
    ELSIF NOT v_initial_at_cap THEN
        v_retention := jsonb_build_object('status', 'deferred', 'reason', 'create_not_completed');
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
       AND COALESCE(v_retention->>'status', 'error') NOT IN ('converged')
       AND NOT (
         v_retention->>'status' = 'deferred'
         AND v_retention->>'reason' IN ('retention_not_activated', 'retention_not_armed', 'no_successful_replacement')
       ) THEN
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

CREATE OR REPLACE FUNCTION public.record_progress_evaluation(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid        uuid := auth.uid();
    v_formula    constant text := 'clarity_v1';
    v_min_secs   constant numeric := 30;    -- §4 STRUCTURAL eligibility gate (not product policy)
    v_min_words  constant integer := 75;    -- §4 STRUCTURAL eligibility gate (not product policy)
    s            public.sessions%ROWTYPE;
    v_content public.session_progress_content_evidence%ROWTYPE;
    v_has_transcript boolean;
    v_reasons    text[] := ARRAY[]::text[];
    v_eligible   boolean;
    v_words      integer;
    v_fillers    integer;
    v_errors     integer;                    -- DERIVED from the persisted transcript; never hardcoded
    v_has_filler_evidence boolean;           -- affirmative filler evidence (a positive valid count; NULL/malformed/zero does not)
    v_filler_total bigint;                   -- #1471: _ss_valid_filler_total(filler_counts); NULL = not measured / malformed
    v_legacy_total numeric;                  -- #1471 Codex P2: the legacy count BEFORE it is judged; numeric so a
                                             -- fractional or out-of-range value can be REJECTED rather than cast and lost
    v_wpm        double precision;
    v_has_clarity boolean;
    v_clarity    double precision;
    v_cohort     text;
    v_mode       text;                       -- #1265: 'objective' (Focus Points) or 'freeform' (Open Mic)
    v_baseline   uuid;
    v_previous   uuid;
    v_id         uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;

    IF NOT public.retention_content_free_compatible() THEN
        RAISE EXCEPTION 'retention_snapshot_incompatible' USING ERRCODE = '55000';
    END IF;
    PERFORM 1 FROM public.user_profiles WHERE id = v_uid FOR UPDATE;
    -- OWNERSHIP: the session must belong to the caller. This is the check an RLS WITH CHECK cannot make.
    SELECT * INTO s FROM public.sessions WHERE id = p_session_id AND user_id = v_uid FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'session not found for this user' USING ERRCODE = '42501';
    END IF;

    -- #1161 (P1): attribution must be TERMINAL before writing the IMMUTABLE evaluation. If neither an authority
    -- nor a definitive unattributed marker exists yet, attribution is still PENDING — DEFER (write nothing) so a
    -- later successful authority still yields the eligible row (ON CONFLICT DO NOTHING can't freeze a premature
    -- ineligible row). A definitive unattributed marker falls through and records exactly one terminal ineligible.
    IF NOT EXISTS (SELECT 1 FROM public.session_attribution_authority a
                   WHERE a.session_id = p_session_id AND a.user_id = v_uid)
       AND NOT EXISTS (SELECT 1 FROM public.session_attribution_unattributed u
                       WHERE u.session_id = p_session_id AND u.user_id = v_uid) THEN
        RETURN NULL;   -- attribution pending; a later call re-evaluates
    END IF;

    -- Existing terminal evaluations are immutable; no missing snapshot may rewrite their verdict.
    SELECT id INTO v_id FROM public.session_progress_evaluations
      WHERE session_id = p_session_id AND user_id = v_uid AND formula_version = v_formula;
    IF FOUND THEN RETURN v_id; END IF;
    -- Focus mode is not inferred from the absence of an asynchronously registered source.
    IF s.product = 'focus_points' AND NOT EXISTS(SELECT 1 FROM public.objective_source_recording
        WHERE session_id = p_session_id AND user_id = v_uid) THEN
      RETURN NULL;
    END IF;
    v_has_transcript := coalesce(s.transcript IS NOT NULL AND length(btrim(s.transcript)) > 0, false);
    IF s.transcript_state = 'expired' THEN
      SELECT * INTO v_content FROM public.session_progress_content_evidence
        WHERE session_id = p_session_id AND user_id = v_uid AND format_version = 1
          AND formula_version = v_formula AND marker_pattern_version = 'error_tags_v1'
          AND cohort_digest = public._ss_retention_content_cohort(s);
      IF NOT FOUND THEN RETURN NULL; END IF;
      v_has_transcript := v_content.has_nonblank;
    END IF;

    v_words := COALESCE(s.total_words, 0);
    v_wpm := s.wpm;

    -- #1471 FILLER EVIDENCE AUTHORITY (must never be imputed).
    -- Current saves persist filler evidence ONLY in sessions.filler_counts (#1306): a flat map of approved keys. The
    -- save writes {} both when the detector observed zero fillers and when it could not observe at all, so {} alone
    -- proves nothing. The legacy filler_words blob is stripped at the save boundary and stored as '{}' — which the old
    -- predicate evaluated to NULL (three-valued logic), so every current save wrote NULL into NOT NULL
    -- clarity_evidence_available and failed 23502.
    -- CURRENT EVIDENCE ALWAYS WINS: a non-null filler_counts is judged only by the shared validity helper
    -- _ss_valid_filler_total (NULL when malformed; {} -> 0; otherwise the sum). Only a POSITIVE total within the integer
    -- range is affirmative evidence; NULL, malformed, out-of-range and ZERO totals are unobservable (#1471 PM RETURN
    -- 5682372478 — a verified zero needs #1472's separate persisted completeness authority). Only when filler_counts IS
    -- NULL (a pre-#1306 row) may evidence fall back to legacy filler_words, and only on an AFFIRMATIVE numeric count:
    -- an empty legacy object is never a clean zero.
    IF s.filler_counts IS NOT NULL THEN
        v_filler_total := public._ss_valid_filler_total(s.filler_counts);
        v_has_filler_evidence := v_filler_total IS NOT NULL AND v_filler_total > 0 AND v_filler_total <= 2147483647;
        v_fillers := CASE WHEN v_has_filler_evidence THEN v_filler_total::int END;
    ELSE
        /*
         * #1471 Codex P2 — THE LEGACY FALLBACK IS JUDGED BY THE SAME RULE AS THE CURRENT PATH.
         *
         * "A number" is not "affirmative evidence". The previous predicate accepted any JSON number, so a
         * legacy `total.count` of 0 was scored as a CLEAN ZERO — precisely the claim this migration exists
         * to refuse on the current path — and a negative, fractional or out-of-range value was accepted and
         * then cast with `::int`, where an oversized value RAISES and recreates the rpc_error Progress debt
         * that holds the next Start. One contract, both paths: POSITIVE, INTEGRAL, within the int range.
         *
         * The total is therefore computed FIRST, as `numeric` (arbitrary precision, so an oversized value
         * survives to be rejected instead of overflowing during the test), and the evidence decision is
         * derived from it. The per-word sum now also requires each `count` to be a number, so one malformed
         * entry can no longer break the cast for the whole row.
         */
        v_legacy_total := CASE
            WHEN s.filler_words IS NULL OR jsonb_typeof(s.filler_words) <> 'object' THEN NULL
            WHEN jsonb_typeof(s.filler_words->'total') = 'object'
                 AND (s.filler_words->'total' ? 'count')
                 AND jsonb_typeof(s.filler_words->'total'->'count') = 'number'
                THEN (s.filler_words->'total'->>'count')::numeric
            /*
             * PM RETURN on the P2 fix — A PARTIAL SUM IS NOT A MEASUREMENT.
             *
             * Filtering the malformed entries OUT and summing the rest looked like resilience and was
             * actually an undercount presented as trustworthy evidence: for
             * `{um:2, uh:1, like:"x"}` the true total is unknown — `like` could be 5 — so reporting 3
             * with `clarity_evidence_available = true` states a number nobody measured. That is the same
             * defect class this migration exists to refuse on the current path, and the one #1472 owns
             * for zeros: absence of a measurement must read as unobservable, never as a tidy figure.
             *
             * So ONE malformed sibling makes the whole legacy map unobservable. The per-word sum is used
             * only when every non-`total` entry is a well-formed numeric count. A map with no usable
             * entries at all sums to NULL, which is also unobservable — an empty legacy object is never a
             * clean zero.
             */
            ELSE (
                SELECT CASE
                    WHEN count(*) FILTER (WHERE NOT v.well_formed) > 0 THEN NULL
                    -- The cast is guarded PER ROW, not by the CASE above: SQL evaluates every aggregate
                    -- over the whole group before CASE chooses a branch, so an unguarded
                    -- SUM(...::numeric) still raises on the malformed sibling it was meant to skip.
                    ELSE SUM(CASE WHEN v.well_formed THEN (v.value->>'count')::numeric END)
                END
                FROM (
                    -- Codex P2 on 669477d9 — EACH SIBLING IS A COUNT, NOT MERELY A NUMBER. Judging only
                    -- "is a JSON number" let malformed siblings SUM to a clean integer: {um:2.5, uh:0.5}
                    -- and {um:5, uh:-2} both became 3 and passed the aggregate checks below. So every
                    -- sibling must itself be non-negative (a word counted zero times is legitimate),
                    -- integral and within the int range. CASE, not AND, orders the evaluation: the cast
                    -- runs only once the value is known to be a JSON number.
                    SELECT e.value,
                           CASE
                               WHEN jsonb_typeof(e.value) = 'object'
                                    AND (e.value ? 'count')
                                    AND jsonb_typeof(e.value->'count') = 'number'
                               THEN (e.value->>'count')::numeric >= 0
                                    AND (e.value->>'count')::numeric = trunc((e.value->>'count')::numeric)
                                    AND (e.value->>'count')::numeric <= 2147483647
                               ELSE false
                           END AS well_formed
                    FROM jsonb_each(s.filler_words) AS e(key, value)
                    WHERE e.key <> 'total'
                ) AS v
            )
        END;
        v_has_filler_evidence := COALESCE(
            v_legacy_total IS NOT NULL
            AND v_legacy_total > 0
            AND v_legacy_total = trunc(v_legacy_total)
            AND v_legacy_total <= 2147483647,
            false);
        v_fillers := CASE WHEN v_has_filler_evidence THEN v_legacy_total::int END;
    END IF;

    -- ERROR MARKERS: DERIVED server-side from the persisted transcript with the SAME pattern as the
    -- frontend ERROR_TAG_REGEX. This is a real clarity input; it is never hardcoded to zero.
    IF s.transcript_state = 'expired' THEN
        v_errors := v_content.error_marker_count;
    ELSE
    v_errors := (
        SELECT count(*)::int FROM regexp_matches(
            COALESCE(s.transcript, ''),
            '\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]',
            'gi') AS m
    );
    END IF;

    -- #1471: explicitly two-valued; no NOT NULL evidence column may ever receive NULL from this predicate.
    v_has_clarity := COALESCE(v_has_transcript
                     AND v_words > 0 AND v_wpm IS NOT NULL AND v_has_filler_evidence, false);

    -- §4 gates, evaluated SERVER-SIDE; deterministic reasons recorded for audit.
    IF s.status IS DISTINCT FROM 'completed'            THEN v_reasons := array_append(v_reasons, 'not_completed'); END IF;
    IF COALESCE(s.duration, 0) < v_min_secs             THEN v_reasons := array_append(v_reasons, 'too_short'); END IF;
    IF v_words < v_min_words                            THEN v_reasons := array_append(v_reasons, 'too_few_words'); END IF;
    IF NOT v_has_transcript
                                                        THEN v_reasons := array_append(v_reasons, 'no_transcript'); END IF;
    -- Missing filler evidence is a MISSING CLARITY INPUT (v_has_clarity depends on it), reported with the
    -- canonical §4 reason 'no_clarity_evidence' — never imputed to zero, and no separate reason token.
    IF NOT v_has_clarity                                THEN v_reasons := array_append(v_reasons, 'no_clarity_evidence'); END IF;
    -- #1161: eligibility gates on the server-RECORDED declaration verdict (version-locked, owner-scoped),
    -- NOT the client-writable sessions.attribution_status. Fail-closed: no attrib_v1 record => unverified.
    IF NOT EXISTS (SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_session_id AND a.user_id = v_uid AND a.authority_version = 'attrib_v1')
    THEN v_reasons := array_append(v_reasons, 'unverified_attribution'); END IF;
    -- Engine identity must be COMPLETE and non-blank (null OR empty/whitespace is incomplete); the
    -- canonical §4 reason for an unusable identity is 'engine_not_comparable'.
    IF s.engine IS NULL OR btrim(s.engine) = ''
       OR s.engine_version IS NULL OR btrim(s.engine_version) = ''
       OR s.model_name IS NULL OR btrim(s.model_name) = ''
                                                        THEN v_reasons := array_append(v_reasons, 'engine_not_comparable'); END IF;

    SELECT ARRAY(SELECT DISTINCT unnest(v_reasons) ORDER BY 1) INTO v_reasons;
    v_eligible := cardinality(v_reasons) = 0;

    IF v_eligible THEN
        -- Clear delivery, UNROUNDED, from persisted columns. Mirrors frontend computeClarityRaw();
        -- a SQL↔TS parity test asserts they agree.
        v_clarity := GREATEST(0, LEAST(100,
            100
            - ((v_fillers::double precision / v_words) * 100 * 1.5)
            - (v_errors * 3)
            - CASE
                WHEN v_wpm > 170 THEN LEAST(20, (v_wpm - 170) / 3)
                WHEN v_wpm > 0 AND v_wpm < 90 THEN LEAST(15, (90 - v_wpm) / 3)
                ELSE 0
              END
        ));
        -- #1265: PRACTICE MODE token. 'objective' iff this recording is server-registered as a Focus
        -- Points source (objective_source_recording); otherwise 'freeform' (Open Mic). Owner-scoped read.
        -- The caller awaits registration before evaluating a Focus Points session, so this read is
        -- authoritative; an unregistered session is genuinely freeform.
        v_mode := CASE WHEN EXISTS (
            SELECT 1 FROM public.objective_source_recording o
            WHERE o.session_id = p_session_id AND o.user_id = v_uid
        ) THEN 'objective' ELSE 'freeform' END;
        v_cohort := concat_ws('|', s.engine, s.engine_version, s.model_name, v_formula, v_mode);

        -- Baseline / previous chosen by PERSISTED created_at within the CALLER'S OWN cohort. Cannot
        -- reference another user's session (user_id = v_uid) and cannot be caller-ordered. The moded
        -- cohort_key now also confines the selection to the SAME practice mode.
        SELECT e.session_id INTO v_baseline
        FROM public.session_progress_evaluations e
        JOIN public.sessions cs ON cs.id = e.session_id
        WHERE e.user_id = v_uid AND e.eligible AND e.cohort_key = v_cohort
          AND (cs.created_at, e.session_id) < (s.created_at, p_session_id)
        ORDER BY cs.created_at ASC, e.session_id ASC
        LIMIT 1;

        SELECT e.session_id INTO v_previous
        FROM public.session_progress_evaluations e
        JOIN public.sessions cs ON cs.id = e.session_id
        WHERE e.user_id = v_uid AND e.eligible AND e.cohort_key = v_cohort
          AND (cs.created_at, e.session_id) < (s.created_at, p_session_id)
        ORDER BY cs.created_at DESC, e.session_id DESC
        LIMIT 1;
    END IF;

    INSERT INTO public.session_progress_evaluations (
        user_id, session_id, formula_version, duration_seconds, word_count,
        clarity_evidence_available, engine, engine_version, model_name, attribution_status,
        eligible, exclusion_reasons,
        clarity_raw, filler_count, error_marker_count, wpm, cohort_key,
        baseline_session_id, previous_comparable_session_id
    ) VALUES (
        v_uid, p_session_id, v_formula, COALESCE(s.duration, 0), v_words,
        -- #1161 P1 (terminal-retention): the stored attribution_status is derived SOLELY from the server-recorded
        -- declaration verdict, NEVER from the client-writable s.attribution_status. By the defer guard above, this
        -- INSERT is only reached once attribution is RESOLVED — so a recorded row ⇒ 'verified', and its definitive
        -- absence (an unattributed marker exists) ⇒ a hard 'unverified'. Echoing s.attribution_status here would let
        -- a forged 'verified' survive into the evaluation row; drop that fallback entirely.
        COALESCE(v_has_clarity, false), s.engine, s.engine_version, s.model_name, CASE WHEN EXISTS (SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_session_id AND a.user_id = v_uid AND a.authority_version = 'attrib_v1')
          THEN 'verified' ELSE 'unverified' END,
        v_eligible, v_reasons,
        CASE WHEN v_eligible THEN v_clarity END,
        CASE WHEN v_eligible THEN v_fillers END,
        CASE WHEN v_eligible THEN v_errors END,
        CASE WHEN v_eligible THEN v_wpm END,
        CASE WHEN v_eligible THEN v_cohort END,
        v_baseline, v_previous
    )
    ON CONFLICT (session_id, formula_version) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.session_progress_evaluations
        WHERE session_id = p_session_id AND formula_version = v_formula;
    END IF;

    RETURN v_id;
END;
$$;

-- Definition identities are an executable rollback/postflight contract, not row-content evidence.
INSERT INTO public.transcript_retention_function_pins(signature,definition_md5)
SELECT signature, md5(pg_get_functiondef(to_regprocedure(signature)))
FROM unnest(ARRAY[
 'public.arm_transcript_retention_for_save(uuid,uuid)',
 'public.sessions_set_transcript_state()',
 'public.expire_transcripts_newest_one(uuid,integer)',
 'public.converge_transcript_retention(uuid)',
 'public.complete_session_v2(uuid,text,integer,text,jsonb,integer,double precision,double precision,jsonb,jsonb,text)',
 'public.create_session_and_update_usage(jsonb,text,uuid,text,text,text)',
 'public.record_progress_evaluation(uuid)'
 ,'public._ss_retention_expired_derived_guard()'
]) AS x(signature);
DO $compatibility$
BEGIN
  IF NOT public.retention_content_free_compatible() THEN
    RAISE EXCEPTION 'retention_snapshot_installation_incompatible';
  END IF;
END;
$compatibility$;
COMMIT;
