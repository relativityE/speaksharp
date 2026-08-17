-- #1306 aggregate-only production preflight — a CONTENT-FREE readiness check run BEFORE authorizing the
-- content-free scrub + applying Stage B enforcement. It returns COUNTS and column-name booleans only; it never
-- reads, returns, or logs any session content (no transcript / prose / filler values). It is read-only and
-- makes no changes. Deploy this with (or before) Stage A so operators can gauge readiness from production
-- without ever touching content.
--
-- `ready` is true when NO completed row is missing its next_action_signal — i.e. the Stage B inline preflight
-- (which fails closed on exactly those rows) would pass. When false, the offending COUNT tells the operator how
-- many legacy rows the authorized scrub must hard-delete first.
CREATE OR REPLACE FUNCTION public.metrics_only_stage_b_readiness()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_bad_completed bigint;
    v_content_cols text[];
BEGIN
    -- Aggregate count only — never selects any content column value.
    SELECT count(*) INTO v_bad_completed
    FROM public.sessions
    WHERE status = 'completed' AND next_action_signal IS NULL;

    -- Which content columns are still present (schema metadata, not row content).
    SELECT COALESCE(array_agg(column_name ORDER BY column_name), ARRAY[]::text[]) INTO v_content_cols
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sessions'
      AND column_name = ANY (ARRAY['transcript','ai_suggestions','ground_truth','accuracy','filler_words','custom_words','transcript_state']);

    RETURN jsonb_build_object(
        'ready', v_bad_completed = 0,
        'completed_without_next_action', v_bad_completed,
        'content_columns_remaining', to_jsonb(v_content_cols)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.metrics_only_stage_b_readiness() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.metrics_only_stage_b_readiness() FROM anon;
REVOKE EXECUTE ON FUNCTION public.metrics_only_stage_b_readiness() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.metrics_only_stage_b_readiness() TO service_role;
