-- #1863 payment wall, server side. PO 2026-11-14: "no usage after 1st month if no payment".
-- After the 30-day trial an unpaid account has no product service and no access to its saved work until payment is
-- confirmed by the server. Access is the canonical #1282 entitlement: effective_subscription_tier(...) = 'pro', which is
-- either a paid Pro profile backed by a real Stripe subscription id, or a marked commercial trial whose
-- trial_expires_at is still in the future (strictly: at the expiry instant access is already closed). A bare 'pro'
-- label without a Stripe subscription id is not payment. Paying restores the same retained rows; nothing is deleted.
--
-- What stays reachable after expiry (not touched here): user_profiles (account and billing), check_usage_limit,
-- account_closure_pending_status and the account-deletion path, issue reports, quotas and usage rows, recording lease
-- release/abandonment, and set_user_timezone. service_role keeps its system access; an Edge function that serves
-- saved work with service_role must check public.account_has_product_access(user_id) itself.
--
-- 1. Direct reads: every owner SELECT policy over saved work additionally requires current product access.
-- 2. SECURITY DEFINER bypasses: each product RPC executable by authenticated is renamed to <name>__unguarded (EXECUTE
--    revoked from every API role) and replaced by a SECURITY DEFINER wrapper of the same signature, defaults, return
--    type, volatility and grants that calls public.require_product_access() first. Bodies are unchanged.

CREATE OR REPLACE FUNCTION public.account_has_product_access(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles AS p
    WHERE p.id = p_user_id
      AND public.effective_subscription_tier(
        p.subscription_status,
        p.trial_expires_at,
        p.stripe_subscription_id,
        p.subscription_id,
        p.commercial_trial_granted_at
      ) = 'pro'
  );
$$;

COMMENT ON FUNCTION public.account_has_product_access(uuid) IS
  '#1863 payment wall: true only while the account is paid (pro + Stripe subscription id) or inside a marked, unexpired '
  'commercial trial. Not executable by end users (it would disclose another account''s entitlement); service_role only.';

REVOKE ALL ON FUNCTION public.account_has_product_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_has_product_access(uuid) TO service_role;

-- The caller's own access, for RLS policies. Reveals nothing beyond the caller's own entitlement.
CREATE OR REPLACE FUNCTION public.current_account_has_product_access()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND public.account_has_product_access(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.current_account_has_product_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_account_has_product_access() TO authenticated, service_role;

-- Raises payment_required for an end-user caller without access. A call with no end-user subject (service_role or a
-- system job) is checked against p_user_id when one is given, and otherwise left to the function it guards.
CREATE OR REPLACE FUNCTION public.require_product_access(p_user_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subject uuid := COALESCE(auth.uid(), p_user_id);
BEGIN
  IF v_subject IS NULL THEN
    RETURN;
  END IF;
  IF NOT public.account_has_product_access(v_subject) THEN
    RAISE EXCEPTION 'payment_required'
      USING ERRCODE = '42501',
            DETAIL = 'trial_expired: product access needs an active trial or a paid subscription',
            HINT = 'Account, billing and account deletion remain available.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.require_product_access(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_product_access(uuid) TO service_role;

-- 1. Direct reads of saved work. Same policy names, roles and owner predicate; current product access is added.
DROP POLICY IF EXISTS "Users can read own sessions" ON public.sessions;
CREATE POLICY "Users can read own sessions" ON public.sessions
FOR SELECT TO authenticated
USING (((SELECT auth.uid()) = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "objective_action_select_own" ON public.objective_action;
CREATE POLICY "objective_action_select_own" ON public.objective_action
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "objective_dispute_select_own" ON public.objective_action_dispute;
CREATE POLICY "objective_dispute_select_own" ON public.objective_action_dispute
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "objective_brief_select_own" ON public.objective_brief;
CREATE POLICY "objective_brief_select_own" ON public.objective_brief
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "objective_point_select_own" ON public.objective_brief_point;
CREATE POLICY "objective_point_select_own" ON public.objective_brief_point
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "objective_evidence_select_own" ON public.objective_evidence;
CREATE POLICY "objective_evidence_select_own" ON public.objective_evidence
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "objective_project_select_own" ON public.objective_project;
CREATE POLICY "objective_project_select_own" ON public.objective_project
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "objective_session_select_own" ON public.objective_session;
CREATE POLICY "objective_session_select_own" ON public.objective_session
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "objective_source_recording_select_own" ON public.objective_source_recording;
CREATE POLICY "objective_source_recording_select_own" ON public.objective_source_recording
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "prec_att_select_own" ON public.progress_recommendation_attempts;
CREATE POLICY "prec_att_select_own" ON public.progress_recommendation_attempts
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "prec_select_own" ON public.progress_recommendations;
CREATE POLICY "prec_select_own" ON public.progress_recommendations
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "session_attribution_authority_select_own" ON public.session_attribution_authority;
CREATE POLICY "session_attribution_authority_select_own" ON public.session_attribution_authority
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "session_attribution_challenge_select_own" ON public.session_attribution_challenge;
CREATE POLICY "session_attribution_challenge_select_own" ON public.session_attribution_challenge
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "session_attribution_unattributed_select_own" ON public.session_attribution_unattributed;
CREATE POLICY "session_attribution_unattributed_select_own" ON public.session_attribution_unattributed
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "spe_select_own" ON public.session_progress_evaluations;
CREATE POLICY "spe_select_own" ON public.session_progress_evaluations
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "Users can view own goals" ON public.user_goals;
CREATE POLICY "Users can view own goals" ON public.user_goals
FOR SELECT TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

-- Practice goals are product data: writes need access too (reads are closed above). These policies previously applied
-- TO public; anon has no goals, so TO authenticated keeps signed-out reads returning nothing instead of an error.
DROP POLICY IF EXISTS "Users can insert own goals" ON public.user_goals;
CREATE POLICY "Users can insert own goals" ON public.user_goals
FOR INSERT TO authenticated
WITH CHECK ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

DROP POLICY IF EXISTS "Users can update own goals" ON public.user_goals;
CREATE POLICY "Users can update own goals" ON public.user_goals
FOR UPDATE TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()))
WITH CHECK ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

-- The custom filler-word vocabulary is a product feature: reads and writes need access.
DROP POLICY IF EXISTS "Users can manage own vocabulary" ON public.user_filler_words;
CREATE POLICY "Users can manage own vocabulary" ON public.user_filler_words
FOR ALL TO authenticated
USING ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()))
WITH CHECK ((auth.uid() = user_id) AND (SELECT public.current_account_has_product_access()));

-- 2. SECURITY DEFINER product RPCs: rename the body, revoke it from every API role, wrap it behind the access check.
--    record_progress_evaluation(uuid) is NOT renamed: its definition is pinned by the content-free retention evidence
--    (transcript_retention_function_pins, 20261025021046) and must stay byte-identical. Its writes are closed by the
--    session_progress_evaluations trigger in section 3 instead, and its reads by the policies in section 1.
ALTER FUNCTION public.get_analytics_summary(p_user_id uuid) RENAME TO get_analytics_summary__unguarded;
REVOKE ALL ON FUNCTION public.get_analytics_summary__unguarded(p_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.get_analytics_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access(p_user_id);
  RETURN public.get_analytics_summary__unguarded(p_user_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_analytics_summary(p_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(p_user_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_progress_obligations(p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) RENAME TO get_progress_obligations__unguarded;
REVOKE ALL ON FUNCTION public.get_progress_obligations__unguarded(p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.get_progress_obligations(p_limit integer DEFAULT 20, p_before_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.get_progress_obligations__unguarded(p_limit, p_before_created_at, p_before_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_progress_obligations(p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_progress_obligations(p_limit integer, p_before_created_at timestamp with time zone, p_before_id uuid) TO authenticated;

ALTER FUNCTION public.get_attribution_authority_v1(p_session_id uuid) RENAME TO get_attribution_authority_v1__unguarded;
REVOKE ALL ON FUNCTION public.get_attribution_authority_v1__unguarded(p_session_id uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.get_attribution_authority_v1(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.get_attribution_authority_v1__unguarded(p_session_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_attribution_authority_v1(p_session_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_attribution_authority_v1(p_session_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.get_session_engine_class_v1(p_session_id uuid) RENAME TO get_session_engine_class_v1__unguarded;
REVOKE ALL ON FUNCTION public.get_session_engine_class_v1__unguarded(p_session_id uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.get_session_engine_class_v1(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.get_session_engine_class_v1__unguarded(p_session_id);
END;
$$;
REVOKE ALL ON FUNCTION public.get_session_engine_class_v1(p_session_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_session_engine_class_v1(p_session_id uuid) TO authenticated, service_role;

ALTER FUNCTION public.issue_objective_project_v1(p_title text) RENAME TO issue_objective_project_v1__unguarded;
REVOKE ALL ON FUNCTION public.issue_objective_project_v1__unguarded(p_title text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.issue_objective_project_v1(p_title text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.issue_objective_project_v1__unguarded(p_title);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_objective_project_v1(p_title text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_objective_project_v1(p_title text) TO authenticated;

ALTER FUNCTION public.issue_objective_brief_v1(p_project_id uuid, p_event_goal text, p_time_budget_seconds integer, p_audience text, p_points jsonb) RENAME TO issue_objective_brief_v1__unguarded;
REVOKE ALL ON FUNCTION public.issue_objective_brief_v1__unguarded(p_project_id uuid, p_event_goal text, p_time_budget_seconds integer, p_audience text, p_points jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.issue_objective_brief_v1(p_project_id uuid, p_event_goal text, p_time_budget_seconds integer, p_audience text, p_points jsonb)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.issue_objective_brief_v1__unguarded(p_project_id, p_event_goal, p_time_budget_seconds, p_audience, p_points);
END;
$$;
REVOKE ALL ON FUNCTION public.issue_objective_brief_v1(p_project_id uuid, p_event_goal text, p_time_budget_seconds integer, p_audience text, p_points jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_objective_brief_v1(p_project_id uuid, p_event_goal text, p_time_budget_seconds integer, p_audience text, p_points jsonb) TO authenticated;

ALTER FUNCTION public.objective_start_session_v1(p_project_id uuid, p_brief_id uuid, p_source_session_id uuid, p_detector_version text, p_formula_version text, p_idempotency_key text) RENAME TO objective_start_session_v1__unguarded;
REVOKE ALL ON FUNCTION public.objective_start_session_v1__unguarded(p_project_id uuid, p_brief_id uuid, p_source_session_id uuid, p_detector_version text, p_formula_version text, p_idempotency_key text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.objective_start_session_v1(p_project_id uuid, p_brief_id uuid, p_source_session_id uuid, p_detector_version text, p_formula_version text, p_idempotency_key text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.objective_start_session_v1__unguarded(p_project_id, p_brief_id, p_source_session_id, p_detector_version, p_formula_version, p_idempotency_key);
END;
$$;
REVOKE ALL ON FUNCTION public.objective_start_session_v1(p_project_id uuid, p_brief_id uuid, p_source_session_id uuid, p_detector_version text, p_formula_version text, p_idempotency_key text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.objective_start_session_v1(p_project_id uuid, p_brief_id uuid, p_source_session_id uuid, p_detector_version text, p_formula_version text, p_idempotency_key text) TO authenticated;

ALTER FUNCTION public.objective_select_action_v1(p_session_id uuid) RENAME TO objective_select_action_v1__unguarded;
REVOKE ALL ON FUNCTION public.objective_select_action_v1__unguarded(p_session_id uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.objective_select_action_v1(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.objective_select_action_v1__unguarded(p_session_id);
END;
$$;
REVOKE ALL ON FUNCTION public.objective_select_action_v1(p_session_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.objective_select_action_v1(p_session_id uuid) TO authenticated;

ALTER FUNCTION public.objective_finalize_evidence_v1(p_session_id uuid, p_signals jsonb) RENAME TO objective_finalize_evidence_v1__unguarded;
REVOKE ALL ON FUNCTION public.objective_finalize_evidence_v1__unguarded(p_session_id uuid, p_signals jsonb) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.objective_finalize_evidence_v1(p_session_id uuid, p_signals jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.objective_finalize_evidence_v1__unguarded(p_session_id, p_signals);
END;
$$;
REVOKE ALL ON FUNCTION public.objective_finalize_evidence_v1(p_session_id uuid, p_signals jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(p_session_id uuid, p_signals jsonb) TO authenticated;

ALTER FUNCTION public.objective_dispute_action_v1(p_action_id uuid) RENAME TO objective_dispute_action_v1__unguarded;
REVOKE ALL ON FUNCTION public.objective_dispute_action_v1__unguarded(p_action_id uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.objective_dispute_action_v1(p_action_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.objective_dispute_action_v1__unguarded(p_action_id);
END;
$$;
REVOKE ALL ON FUNCTION public.objective_dispute_action_v1(p_action_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.objective_dispute_action_v1(p_action_id uuid) TO authenticated;

ALTER FUNCTION public.record_progress_recommendation(p_source_session_id uuid, p_target_metric text, p_target_direction text, p_target_value double precision, p_target_units text, p_shown_text text) RENAME TO record_progress_recommendation__unguarded;
REVOKE ALL ON FUNCTION public.record_progress_recommendation__unguarded(p_source_session_id uuid, p_target_metric text, p_target_direction text, p_target_value double precision, p_target_units text, p_shown_text text) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.record_progress_recommendation(p_source_session_id uuid, p_target_metric text, p_target_direction text, p_target_value double precision, p_target_units text, p_shown_text text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.record_progress_recommendation__unguarded(p_source_session_id, p_target_metric, p_target_direction, p_target_value, p_target_units, p_shown_text);
END;
$$;
REVOKE ALL ON FUNCTION public.record_progress_recommendation(p_source_session_id uuid, p_target_metric text, p_target_direction text, p_target_value double precision, p_target_units text, p_shown_text text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_progress_recommendation(p_source_session_id uuid, p_target_metric text, p_target_direction text, p_target_value double precision, p_target_units text, p_shown_text text) TO authenticated;

ALTER FUNCTION public.record_recommendation_attempt(p_recommendation_id uuid) RENAME TO record_recommendation_attempt__unguarded;
REVOKE ALL ON FUNCTION public.record_recommendation_attempt__unguarded(p_recommendation_id uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.record_recommendation_attempt(p_recommendation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.record_recommendation_attempt__unguarded(p_recommendation_id);
END;
$$;
REVOKE ALL ON FUNCTION public.record_recommendation_attempt(p_recommendation_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_recommendation_attempt(p_recommendation_id uuid) TO authenticated;

ALTER FUNCTION public.advance_recommendation_attempt(p_attempt_id uuid, p_lifecycle text, p_practice_session_id uuid, p_next_comparable_session_id uuid) RENAME TO advance_recommendation_attempt__unguarded;
REVOKE ALL ON FUNCTION public.advance_recommendation_attempt__unguarded(p_attempt_id uuid, p_lifecycle text, p_practice_session_id uuid, p_next_comparable_session_id uuid) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.advance_recommendation_attempt(p_attempt_id uuid, p_lifecycle text, p_practice_session_id uuid DEFAULT NULL::uuid, p_next_comparable_session_id uuid DEFAULT NULL::uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.advance_recommendation_attempt__unguarded(p_attempt_id, p_lifecycle, p_practice_session_id, p_next_comparable_session_id);
END;
$$;
REVOKE ALL ON FUNCTION public.advance_recommendation_attempt(p_attempt_id uuid, p_lifecycle text, p_practice_session_id uuid, p_next_comparable_session_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_recommendation_attempt(p_attempt_id uuid, p_lifecycle text, p_practice_session_id uuid, p_next_comparable_session_id uuid) TO authenticated;

ALTER FUNCTION public.consume_ai_suggestion_quota(p_limit integer) RENAME TO consume_ai_suggestion_quota__unguarded;
REVOKE ALL ON FUNCTION public.consume_ai_suggestion_quota__unguarded(p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.consume_ai_suggestion_quota(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.consume_ai_suggestion_quota__unguarded(p_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_ai_suggestion_quota(p_limit integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_ai_suggestion_quota(p_limit integer) TO authenticated;

ALTER FUNCTION public.consume_formatter_quota(p_limit integer) RENAME TO consume_formatter_quota__unguarded;
REVOKE ALL ON FUNCTION public.consume_formatter_quota__unguarded(p_limit integer) FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION public.consume_formatter_quota(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN public.consume_formatter_quota__unguarded(p_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_formatter_quota(p_limit integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_formatter_quota(p_limit integer) TO authenticated;

-- 3. Progress evaluation writes after expiry. An end-user transaction without product access cannot add or change an
--    evaluation by any path (the pinned record_progress_evaluation included). Rows written with no end-user subject
--    (service_role or system jobs) are unaffected.
CREATE OR REPLACE FUNCTION public._ss_payment_wall_evaluation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_product_access();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._ss_payment_wall_evaluation_guard() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS ss_payment_wall_evaluation_guard ON public.session_progress_evaluations;
CREATE TRIGGER ss_payment_wall_evaluation_guard
  BEFORE INSERT OR UPDATE ON public.session_progress_evaluations
  FOR EACH ROW EXECUTE FUNCTION public._ss_payment_wall_evaluation_guard();
