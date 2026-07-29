-- SECURITY HOTFIX: public.get_analytics_summary(UUID)
--
-- STATUS: NOT APPLIED TO PRODUCTION BY THIS PR.
--         Applying this migration to production requires SEPARATE Product Owner authorization.
--
-- VULNERABILITY
--   public.get_analytics_summary(UUID) is SECURITY DEFINER, so it executes with the definer's
--   privileges and bypasses row-level security on public.sessions. Its only authorization control
--   was:
--
--       IF p_user_id != auth.uid() THEN RAISE EXCEPTION 'Unauthorized: ...'; END IF;
--
--   In SQL three-valued logic `<anything> != NULL` evaluates to NULL, not TRUE. An IF whose
--   condition is NULL does not take its branch, so when auth.uid() is NULL — which is exactly the
--   case for an unauthenticated request carrying only the browser-visible publishable key and no
--   user JWT — the RAISE never fires and the function proceeds to read public.sessions.
--
--   Separately, PostgreSQL grants EXECUTE on new functions to PUBLIC by default. No REVOKE was ever
--   issued for this function in any migration, so the `anon` role (which is a member of PUBLIC)
--   held EXECUTE. This repository already applies exactly that REVOKE to
--   process_stripe_webhook_event, create_session_and_update_usage, check_usage_limit,
--   update_user_usage and consume_formatter_quota. This function was missed.
--
--   CONFIRMED: unauthenticated execution of a production SECURITY DEFINER analytics function.
--   The cross-tenant disclosure path is established by the function logic. No customer-data access
--   was exercised or demonstrated.
--
-- FIX
--   This migration re-issues the CURRENTLY DEPLOYED function body from
--   20260522110000_cleanup_stale_schema_lint.sql byte-for-byte, with exactly two changes:
--     1. The authorization guard becomes null-safe (defence in depth).
--     2. EXECUTE is revoked from PUBLIC and from anon (the primary control), and re-granted only to
--        the roles with established legitimate callers.
--   No analytics calculation, no response key, and no returned shape is altered. The response
--   contract is unchanged.
--
-- ROLLBACK POLICY
--   Rolling back MUST NEVER restore anonymous execution. If the function body has to be reverted,
--   the REVOKEs below REMAIN IN PLACE. Revert the body only; never revert the REVOKEs.

-- 1. Remove the default PUBLIC grant and any anon grant. Idempotent: REVOKE of a privilege that is
--    not held is a no-op, so this is safe to re-run and safe to run ahead of the CREATE OR REPLACE.
REVOKE EXECUTE ON FUNCTION public.get_analytics_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_analytics_summary(UUID) FROM anon;

CREATE OR REPLACE FUNCTION public.get_analytics_summary(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
-- 2b. SAFE SEARCH PATH. `SET search_path = public` alone omits pg_temp, and PostgreSQL then searches
--     the TEMPORARY schema FIRST for any unqualified object. A caller who can create temp objects
--     could define pg_temp.sessions and have this SECURITY DEFINER body read that instead of
--     public.sessions. Naming pg_temp explicitly and LAST removes the precedence. This is standard
--     SECURITY DEFINER hardening applied because we are already reissuing this function — it is not a
--     claim that the unsafe form was practically exploitable here, which was deliberately not
--     investigated further. The same pattern elsewhere in the migration tree is recorded in one
--     follow-up security issue rather than fixed piecemeal.
SET search_path = public, pg_temp
AS $$
DECLARE
    v_overall_stats JSONB;
    v_top_filler_words JSONB;
    v_chart_data JSONB;
    v_filler_word_trends JSONB;
    v_accuracy_data JSONB;
    v_weekly_activity JSONB;
    v_weekly_sessions_count INT;
    v_total_sessions INT;
    v_total_duration_seconds INT;
    v_total_words INT;
    v_sum_clarity FLOAT8;
    v_total_filler_words INT;
BEGIN
    -- Null-safe authorization guard. Every one of these three conditions must be explicitly
    -- rejected: a NULL auth.uid() (unauthenticated caller), a NULL p_user_id (which would make the
    -- comparison itself evaluate to NULL), and a mismatch between the two (cross-tenant request).
    IF auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: You can only access your own analytics.';
    END IF;

    SELECT
        count(*),
        coalesce(sum(duration), 0),
        coalesce(sum(total_words), 0),
        coalesce(sum(coalesce(clarity_score, accuracy * 100, 0)), 0)
    INTO
        v_total_sessions,
        v_total_duration_seconds,
        v_total_words,
        v_sum_clarity
    FROM sessions
    WHERE user_id = p_user_id;

    SELECT coalesce(sum((v.value->>'count')::int), 0)
    INTO v_total_filler_words
    FROM sessions s,
         jsonb_each(s.filler_words) AS v(key, value)
    WHERE s.user_id = p_user_id
      AND v.key != 'total';

    v_overall_stats := jsonb_build_object(
        'totalSessions', v_total_sessions,
        'totalPracticeTime', round(v_total_duration_seconds / 60.0),
        'averageSessionLength', CASE WHEN v_total_sessions > 0 THEN round((v_total_duration_seconds / 60.0) / v_total_sessions) ELSE 0 END,
        'avgWpm', CASE WHEN v_total_duration_seconds > 0 THEN round(v_total_words / (v_total_duration_seconds / 60.0)) ELSE 0 END,
        'avgFillerWordsPerMin', CASE WHEN v_total_duration_seconds > 0 THEN (v_total_filler_words / (v_total_duration_seconds / 60.0))::numeric(10,1)::text ELSE '0.0' END,
        'avgAccuracy', CASE WHEN v_total_sessions > 0 THEN (v_sum_clarity / v_total_sessions)::numeric(10,1)::text ELSE '0.0' END
    );

    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO v_top_filler_words
    FROM (
        SELECT v.key as word, sum((v.value->>'count')::int) as count
        FROM sessions s,
             jsonb_each(s.filler_words) AS v(key, value)
        WHERE s.user_id = p_user_id
          AND v.key != 'total'
        GROUP BY v.key
        ORDER BY count DESC
        LIMIT 2
    ) d;

    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO v_chart_data
    FROM (
        SELECT
            to_char(created_at, 'MM/DD/YYYY') as date,
            CASE WHEN duration > 0 THEN (fw_count / (duration / 60.0))::numeric(10,2)::text ELSE '0.00' END as "FW/min",
            coalesce(clarity_score, CASE WHEN duration > 0 THEN 100 - ((fw_count / (duration / 60.0)) * 2) ELSE 100 END) as clarity
        FROM (
            SELECT
                s.created_at,
                s.duration,
                s.clarity_score,
                coalesce((SELECT sum((v.value->>'count')::int) FROM jsonb_each(s.filler_words) AS v(key, value) WHERE v.key != 'total'), 0) as fw_count
            FROM sessions s
            WHERE s.user_id = p_user_id
            ORDER BY s.created_at DESC
            LIMIT 10
        ) sub
        ORDER BY created_at ASC
    ) d;

    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO v_accuracy_data
    FROM (
        SELECT
            to_char(created_at, 'MM/DD/YYYY') as date,
            coalesce(clarity_score, accuracy * 100) as accuracy,
            engine
        FROM sessions
        WHERE user_id = p_user_id
          AND engine IS NOT NULL
          AND (clarity_score IS NOT NULL OR accuracy IS NOT NULL)
        ORDER BY created_at DESC
        LIMIT 10
    ) d;

    SELECT count(*) INTO v_weekly_sessions_count
    FROM sessions
    WHERE user_id = p_user_id AND created_at >= now() - interval '7 days';

    SELECT jsonb_agg(d) INTO v_weekly_activity
    FROM (
        SELECT
            to_char(d, 'Dy') as day,
            (SELECT count(*) FROM sessions WHERE user_id = p_user_id AND created_at::date = d::date) as sessions
        FROM generate_series(
            date_trunc('day', now() - (extract(dow from now()) * interval '1 day')),
            date_trunc('day', now() - (extract(dow from now()) * interval '1 day')) + interval '6 days',
            interval '1 day'
        ) d
    ) d;

    WITH last_10_sessions AS (
        SELECT id, created_at, duration, row_number() OVER (ORDER BY created_at DESC) as rn
        FROM sessions
        WHERE user_id = p_user_id
        LIMIT 10
    ),
    window_minutes AS (
        SELECT
            coalesce(sum(duration) FILTER (WHERE rn <= 5), 0) / 60.0 as current_minutes,
            coalesce(sum(duration) FILTER (WHERE rn > 5), 0) / 60.0 as previous_minutes
        FROM last_10_sessions
    ),
    filler_counts AS (
        SELECT
            v.key as word,
            coalesce(sum((v.value->>'count')::int) FILTER (WHERE l.rn <= 5), 0) as current_count,
            coalesce(sum((v.value->>'count')::int) FILTER (WHERE l.rn > 5), 0) as previous_count
        FROM last_10_sessions l
        JOIN sessions s ON s.id = l.id
        CROSS JOIN LATERAL jsonb_each(s.filler_words) AS v(key, value)
        WHERE v.key != 'total'
        GROUP BY word
    )
    SELECT coalesce(jsonb_object_agg(
        word,
        jsonb_build_object(
            'current', CASE WHEN wm.current_minutes > 0 THEN (current_count / wm.current_minutes)::numeric(10,2) ELSE 0 END,
            'previous', CASE WHEN wm.previous_minutes > 0 THEN (previous_count / wm.previous_minutes)::numeric(10,2) ELSE 0 END
        )
    ), '{}'::jsonb)
    INTO v_filler_word_trends
    FROM filler_counts
    CROSS JOIN window_minutes wm;

    RETURN jsonb_build_object(
        'overallStats', v_overall_stats || jsonb_build_object('chartData', v_chart_data),
        'topFillerWords', v_top_filler_words,
        'fillerWordTrends', v_filler_word_trends,
        'accuracyData', v_accuracy_data,
        'weeklySessionsCount', v_weekly_sessions_count,
        'weeklyActivity', v_weekly_activity
    );
END;
$$;

-- 2. CREATE OR REPLACE does not reset privileges, but re-issue the REVOKEs after it so the
--    end-state is unambiguous regardless of the privilege state this migration started from.
REVOKE EXECUTE ON FUNCTION public.get_analytics_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_analytics_summary(UUID) FROM anon;

-- 3. Retain only the roles with established legitimate callers.
--    authenticated — frontend/src/lib/storage.ts calls this RPC on the end user's own behalf via
--                    the browser Supabase client (user JWT). Guard above restricts it to self.
--    service_role  — RETAINED IN THIS PR, deliberately. The repository audit (see PR body) found
--                    no service_role caller of this RPC anywhere: not in frontend/src, tests,
--                    scripts, .github/workflows, ops-health, nor in any of the ten Edge Functions.
--                    That is grounds for a follow-up removal, but a grep cannot exclude an
--                    out-of-repo caller (SQL editor, BI tool, runbook), so the grant is NOT removed
--                    on the basis of a repository search alone.
--                    Removing it would in any case not reduce administrative capability:
--                    service_role holds BYPASSRLS and public.sessions has no FORCE ROW LEVEL
--                    SECURITY, so an administrative caller can already read the base table directly.
--                    Critically, the null-safe guard above ALREADY closes the dangerous half of
--                    this grant: a service_role call carrying no JWT claims has auth.uid() = NULL
--                    and is now REJECTED (proven by test 6 in the PR evidence table, which returned
--                    a full payload before this migration and raises Unauthorized after it).
--                    Any genuine administrative cross-user aggregation must be added as a
--                    separately named privileged interface (e.g. admin_get_analytics_summary,
--                    granted only to service_role), NOT by weakening this guard.
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(UUID) TO service_role;
