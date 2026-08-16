-- #1306 STAGE A — PRE-DEPLOY, ADDITIVE ONLY. Safe to apply BEFORE the metrics-only frontend deploys.
--
-- It ADDS the nullable structured recommendation column + its strict validation, and ADDS the new
-- transcript-free `complete_session(uuid,text,int,text,jsonb)` overload ALONGSIDE the existing
-- `complete_session(uuid,text,text,int,text)`. It does NOT drop the old RPC, does NOT block/drop content
-- columns, and does NOT install DB-wide content triggers — so the currently-live frontend keeps working while
-- the compatible frontend rolls out. Enforcement/removal happens only in STAGE B (post-deploy).
--
-- Authorized sequence: [A here] -> deploy metrics-only frontend (uses the new RPC exclusively) -> [Stage B].
--
-- PAIRED SOURCE ROLLBACK:
--   DROP FUNCTION IF EXISTS public.complete_session(uuid, text, integer, text, jsonb);
--   ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_recommendation_signals_shape;
--   ALTER TABLE public.sessions DROP COLUMN IF EXISTS recommendation_signals;

-- The ONE structured next action. Strictly enum/numeric; the CHECK rejects unknown keys and free-form strings
-- (mirrors the frontend validateRecommendationSignal contract), so prose cannot be stored here.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS recommendation_signals JSONB;
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_recommendation_signals_shape;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_recommendation_signals_shape CHECK (
  recommendation_signals IS NULL OR (
    jsonb_typeof(recommendation_signals) = 'object'
    AND recommendation_signals ?& array['reasonCode','actionCode','metric','value','comparator','templateVersion']
    AND (recommendation_signals - array['reasonCode','actionCode','metric','value','comparator','templateVersion']) = '{}'::jsonb
    AND recommendation_signals->>'reasonCode' = ANY (ARRAY['HIGH_FILLER_RATE','PACE_TOO_FAST','PACE_TOO_SLOW','EXTENDED_PAUSES','CLARITY_BELOW_BASELINE','ESTABLISH_BASELINE','ON_TRACK'])
    AND recommendation_signals->>'actionCode' = ANY (ARRAY['REDUCE_FILLERS','SLOW_DOWN','SPEED_UP','TIGHTEN_PAUSES','IMPROVE_CLARITY','RECORD_BASELINE','MAINTAIN'])
    AND recommendation_signals->>'metric' = ANY (ARRAY['filler_rate','wpm','extended_pauses','clarity_score','none'])
    AND recommendation_signals->>'comparator' = ANY (ARRAY['above_baseline','below_baseline','above_target','below_target','within_target','no_baseline'])
    AND recommendation_signals->>'templateVersion' = 'rec_v1'
    AND jsonb_typeof(recommendation_signals->'value') = 'number'
  )
);

-- New transcript-free RPC. Self-enforcing: completing requires a recommendation; completion writes final
-- metrics + the one recommendation ATOMICALLY (one transaction); an invalid recommendation is rejected by the
-- CHECK on the UPDATE (rolling the whole completion back). STRICT idempotency: an already-completed session
-- accepts an IDENTICAL replay as a no-op, and RAISES an idempotency-conflict on ANY changed
-- status/duration/reason/recommendation — never a partial update.
CREATE OR REPLACE FUNCTION public.complete_session(
    p_session_id UUID,
    p_status TEXT DEFAULT 'completed',
    p_final_duration INT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_recommendation JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_session public.sessions%ROWTYPE;
    v_effective_tier TEXT;
    v_final_duration INT;
BEGIN
    SELECT public.effective_subscription_tier(
        subscription_status, trial_expires_at, stripe_subscription_id, subscription_id, commercial_trial_granted_at
    ) INTO v_effective_tier FROM public.user_profiles WHERE id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'profile_not_found'); END IF;

    SELECT * INTO v_session FROM public.sessions
    WHERE id = p_session_id AND user_id = auth.uid() FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'session_not_found'); END IF;

    IF COALESCE(v_effective_tier, 'free') <> 'pro' THEN
        RETURN jsonb_build_object('success', false, 'error', 'trial_expired');
    END IF;

    v_final_duration := LEAST(600, GREATEST(0, COALESCE(p_final_duration, v_session.duration, 0)));

    IF v_session.status = 'completed' THEN
        -- Idempotent replay: identical completion -> no-op success; ANY difference -> conflict (no partial write).
        IF p_status = v_session.status
           AND v_final_duration IS NOT DISTINCT FROM v_session.duration
           AND COALESCE(p_reason, v_session.status_reason) IS NOT DISTINCT FROM v_session.status_reason
           AND p_recommendation IS NOT DISTINCT FROM v_session.recommendation_signals
        THEN
            RETURN jsonb_build_object('success', true, 'final_status', 'completed', 'idempotent', true,
                                      'recommendation_signals', v_session.recommendation_signals);
        END IF;
        RAISE EXCEPTION '#1306: idempotency conflict — a completed session cannot be re-completed with different metrics/duration/status/reason/recommendation'
            USING ERRCODE = '40003';
    END IF;

    IF p_status = 'completed' AND p_recommendation IS NULL THEN
        RAISE EXCEPTION '#1306: a completed session requires exactly one structured recommendation' USING ERRCODE = '23514';
    END IF;

    UPDATE public.sessions
    SET status = p_status,
        status_reason = COALESCE(p_reason, status_reason),
        duration = v_final_duration,
        recommendation_signals = CASE WHEN p_status = 'completed' THEN p_recommendation ELSE recommendation_signals END,
        updated_at = now()
    WHERE id = p_session_id AND user_id = auth.uid();

    RETURN jsonb_build_object('success', true, 'final_status', p_status,
        'recommendation_signals', CASE WHEN p_status = 'completed' THEN p_recommendation ELSE v_session.recommendation_signals END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, INT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, INT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, INT, TEXT, JSONB) TO service_role;
