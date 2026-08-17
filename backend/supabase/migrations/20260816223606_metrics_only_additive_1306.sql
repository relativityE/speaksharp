-- #1306 STAGE A — PRE-DEPLOY, ADDITIVE ONLY. Safe to apply BEFORE the metrics-only frontend deploys.
--
-- It ADDS the nullable structured next action column + its strict validation, and ADDS the new
-- transcript-free `complete_session(uuid,text,int,text,jsonb)` overload ALONGSIDE the existing
-- `complete_session(uuid,text,text,int,text)`. It does NOT drop the old RPC, does NOT block/drop content
-- columns, and does NOT install DB-wide content triggers — so the currently-live frontend keeps working while
-- the compatible frontend rolls out. Enforcement/removal happens only in STAGE B (post-deploy).
--
-- Authorized sequence: [A here] -> deploy metrics-only frontend (uses the new RPC exclusively) -> [Stage B].
--
-- PAIRED SOURCE ROLLBACK:
--   DROP FUNCTION IF EXISTS public.complete_session(uuid, text, integer, text, jsonb);
--   ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_next_action_signal_shape;
--   ALTER TABLE public.sessions DROP COLUMN IF EXISTS next_action_signal;

-- The ONE structured next action. Strictly enum/numeric; the CHECK rejects unknown keys and free-form strings
-- (mirrors the frontend validateNextActionSignal contract), so prose cannot be stored here.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS next_action_signal JSONB;
-- Standard-key numeric filler tally (replaces the loosely-typed filler_words). Strict validation is installed
-- in Stage B (after the metrics-only frontend, which writes the strict shape, is live).
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS filler_counts JSONB;
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_next_action_signal_shape;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_next_action_signal_shape CHECK (
  next_action_signal IS NULL OR (
    jsonb_typeof(next_action_signal) = 'object'
    AND next_action_signal ?& array['reasonCode','actionCode','metric','value','comparator','templateVersion']
    AND (next_action_signal - array['reasonCode','actionCode','metric','value','comparator','templateVersion']) = '{}'::jsonb
    AND next_action_signal->>'reasonCode' = ANY (ARRAY['HIGH_FILLER_RATE','PACE_TOO_FAST','PACE_TOO_SLOW','EXTENDED_PAUSES','CLARITY_BELOW_BASELINE','ESTABLISH_BASELINE','ON_TRACK'])
    AND next_action_signal->>'actionCode' = ANY (ARRAY['REDUCE_FILLERS','SLOW_DOWN','SPEED_UP','TIGHTEN_PAUSES','IMPROVE_CLARITY','RECORD_BASELINE','MAINTAIN'])
    AND next_action_signal->>'metric' = ANY (ARRAY['filler_rate','wpm','extended_pauses','clarity_score','none'])
    AND next_action_signal->>'comparator' = ANY (ARRAY['above_baseline','below_baseline','above_target','below_target','within_target','no_baseline'])
    AND next_action_signal->>'templateVersion' = 'rec_v1'
    AND jsonb_typeof(next_action_signal->'value') = 'number'
  )
);

-- New transcript-free RPC. Self-enforcing: completing requires a next action; completion writes EVERY
-- retained final metric (duration, total_words, clarity_score, wpm, filler_counts, pause_metrics) + the one
-- next action ATOMICALLY (one transaction); an invalid next action is rejected by the CHECK on the
-- UPDATE (rolls the whole completion back). STRICT idempotency: an already-completed session accepts an
-- IDENTICAL replay (same status/duration/reason/next-action AND every metric) as a no-op, and RAISES an
-- idempotency-conflict on ANY mismatch — never a partial update. A NULL metric param means "unchanged" (so a
-- retry that omits metrics still matches), while a differing non-null metric conflicts.
CREATE OR REPLACE FUNCTION public.complete_session(
    p_session_id UUID,
    p_status TEXT DEFAULT 'completed',
    p_final_duration INT DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_next_action JSONB DEFAULT NULL,
    p_total_words INT DEFAULT NULL,
    p_clarity_score DOUBLE PRECISION DEFAULT NULL,
    p_wpm DOUBLE PRECISION DEFAULT NULL,
    p_filler_counts JSONB DEFAULT NULL,
    p_pause_metrics JSONB DEFAULT NULL
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
        -- Idempotent replay: identical completion (incl. EVERY retained metric) -> no-op; ANY mismatch ->
        -- conflict (no partial write). A NULL param means "unchanged", so it never conflicts.
        IF p_status = v_session.status
           AND v_final_duration IS NOT DISTINCT FROM v_session.duration
           AND COALESCE(p_reason, v_session.status_reason) IS NOT DISTINCT FROM v_session.status_reason
           AND p_next_action IS NOT DISTINCT FROM v_session.next_action_signal
           AND COALESCE(p_total_words, v_session.total_words)      IS NOT DISTINCT FROM v_session.total_words
           AND COALESCE(p_clarity_score, v_session.clarity_score)  IS NOT DISTINCT FROM v_session.clarity_score
           AND COALESCE(p_wpm, v_session.wpm)                      IS NOT DISTINCT FROM v_session.wpm
           AND COALESCE(p_filler_counts, v_session.filler_counts)  IS NOT DISTINCT FROM v_session.filler_counts
           AND COALESCE(p_pause_metrics, v_session.pause_metrics)  IS NOT DISTINCT FROM v_session.pause_metrics
        THEN
            RETURN jsonb_build_object('success', true, 'final_status', 'completed', 'idempotent', true,
                                      'next_action_signal', v_session.next_action_signal);
        END IF;
        RAISE EXCEPTION '#1306: idempotency conflict — a completed session cannot be re-completed with different final metrics/duration/status/reason/next-action'
            USING ERRCODE = '40003';
    END IF;

    IF p_status = 'completed' AND p_next_action IS NULL THEN
        RAISE EXCEPTION '#1306: a completed session requires exactly one structured next action' USING ERRCODE = '23514';
    END IF;

    -- #1306 zero-vs-missing: a completed session MUST persist a measured filler map — `{}` means "measured,
    -- zero fillers" and MUST be sent explicitly by the writer. NULL means "not measured" and is REJECTED for a
    -- completion (never coerced to `{}`, which would fabricate a flattering measured zero). Incomplete/failed
    -- sessions may remain NULL.
    IF p_status = 'completed' AND COALESCE(p_filler_counts, v_session.filler_counts) IS NULL THEN
        RAISE EXCEPTION '#1306: a completed session requires a measured filler_counts map (send {} for a genuine zero, never null)'
            USING ERRCODE = '23514';
    END IF;

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

    RETURN jsonb_build_object('success', true, 'final_status', p_status,
        'next_action_signal', CASE WHEN p_status = 'completed' THEN p_next_action ELSE v_session.next_action_signal END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB) TO service_role;
