-- #1306 cutover (additive) — repoint get_analytics_summary to the FLAT filler_counts column.
--
-- The metrics-only client (calculateOverallStats / calculateTopFillerWords / calculateFillerWordTrends) reads
-- the flat filler_counts. For the deployed app to agree with the client, the analytics RPC must aggregate the
-- SAME flat shape. This is ADDITIVE and safe to apply with the cutover: it only CREATE OR REPLACEs the function
-- (reading the filler_counts column already added in Stage A) + re-grants; it drops nothing. Stage B later
-- redefines this function again (idempotent CREATE OR REPLACE) alongside the content-column drops. Accuracy
-- series retired; metric-presence provenance; #1096 authorization preserved verbatim.

CREATE OR REPLACE FUNCTION public._ss_valid_filler_total(fw JSONB)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  -- #1306 zero-vs-missing: NULL / non-object → NULL (not measured, excluded). An OBJECT (including `{}`) is a
  -- measured session → its total is the sum of valid counts, or 0 for `{}` (a genuine measured zero that MUST
  -- count in denominators). Never conflate "not measured" (NULL) with "measured zero" (`{}`).
  SELECT CASE
    WHEN fw IS NULL OR jsonb_typeof(fw) <> 'object' THEN NULL
    ELSE COALESCE((
      SELECT sum((e.value#>>'{}')::bigint) FROM jsonb_each(fw) e
      WHERE jsonb_typeof(e.value) = 'number' AND (e.value#>>'{}') ~ '^[0-9]{1,9}$'
    ), 0)
  END
$$;

CREATE OR REPLACE FUNCTION public.get_analytics_summary(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_overall_stats JSONB;
    v_top_filler_words JSONB;
    v_chart_data JSONB;
    v_filler_word_trends JSONB;
    v_weekly_activity JSONB;
    v_weekly_sessions_count INT;
    v_total_sessions INT;
    v_total_duration_seconds INT;
    v_wpm_duration_seconds INT;
    v_filler_duration_seconds INT;
    v_total_words INT;
    v_sum_clarity FLOAT8;
    v_clarity_contributors INT;
    v_wpm_contributors INT;
    v_filler_contributors INT;
    v_total_filler_words BIGINT;
    v_eligible_filler_count INT;
    v_trend_current_count INT;
    v_avg_clarity TEXT;
    v_avg_wpm NUMERIC;
    v_avg_filler_per_min TEXT;
    c_min_reliable_scoring_words CONSTANT INT := 3;
BEGIN
    -- Authorization + search_path controls reproduced VERBATIM from #1096 (20260729120000).
    IF auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: You can only access your own analytics.';
    END IF;

    -- Overall stats. Totals span every row; each rate's denominator is METRIC-SPECIFIC (a row enters a rate
    -- only when it actually persists that metric). Provenance = metric presence (no transcript_state gate).
    SELECT
        count(*),
        coalesce(sum(duration), 0),
        coalesce(sum(duration) FILTER (WHERE total_words IS NOT NULL AND total_words > 0), 0),
        coalesce(sum(duration) FILTER (WHERE public._ss_valid_filler_total(filler_counts) IS NOT NULL), 0),
        coalesce(sum(total_words) FILTER (WHERE total_words IS NOT NULL AND total_words > 0), 0),
        coalesce(sum(clarity_score) FILTER (
            WHERE clarity_score IS NOT NULL AND coalesce(total_words, 0) >= c_min_reliable_scoring_words), 0),
        count(*) FILTER (
            WHERE clarity_score IS NOT NULL AND coalesce(total_words, 0) >= c_min_reliable_scoring_words),
        count(*) FILTER (
            WHERE coalesce(duration, 0) > 0 AND total_words IS NOT NULL AND total_words > 0),
        count(*) FILTER (
            WHERE coalesce(duration, 0) > 0 AND public._ss_valid_filler_total(filler_counts) IS NOT NULL)
    INTO
        v_total_sessions, v_total_duration_seconds, v_wpm_duration_seconds, v_filler_duration_seconds,
        v_total_words, v_sum_clarity, v_clarity_contributors, v_wpm_contributors, v_filler_contributors
    FROM sessions
    WHERE user_id = p_user_id;

    -- Filler-rate NUMERATOR: one validated flat total per eligible row (same row set as its denominator).
    SELECT coalesce(sum(public._ss_valid_filler_total(s.filler_counts)), 0)
    INTO v_total_filler_words
    FROM sessions s
    WHERE s.user_id = p_user_id
      AND public._ss_valid_filler_total(s.filler_counts) IS NOT NULL;

    v_avg_clarity := CASE
        WHEN v_clarity_contributors > 0 THEN (v_sum_clarity / v_clarity_contributors)::numeric(10,1)::text
        ELSE NULL END;

    v_avg_wpm := CASE
        WHEN v_wpm_duration_seconds > 0 AND v_total_words > 0
            THEN round(v_total_words / (v_wpm_duration_seconds / 60.0))
        ELSE NULL END;

    v_avg_filler_per_min := CASE
        WHEN v_filler_duration_seconds > 0
            THEN round(v_total_filler_words / (v_filler_duration_seconds / 60.0), 1)::text
        ELSE NULL END;

    v_overall_stats := jsonb_build_object(
        'totalSessions', v_total_sessions,
        'totalPracticeTime', round(v_total_duration_seconds / 60.0),
        'avgWpm', v_avg_wpm,
        'avgFillerWordsPerMin', v_avg_filler_per_min,
        'avgClarity', v_avg_clarity,
        'avgAccuracy', v_avg_clarity,   -- compatibility alias: has ALWAYS held clarity, never STT accuracy
        'clarityContributorCount', v_clarity_contributors,
        'wpmContributorCount', v_wpm_contributors,
        'fillerRateContributorCount', v_filler_contributors
    );

    -- Top 2 filler words from the flat counts. Fail closed on a non-object; only standard-key numeric values.
    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO v_top_filler_words
    FROM (
        SELECT v.key as word, sum((v.value#>>'{}')::bigint) as count
        FROM sessions s,
             jsonb_each(CASE WHEN jsonb_typeof(s.filler_counts) = 'object' THEN s.filler_counts ELSE '{}'::jsonb END) AS v(key, value)
        WHERE s.user_id = p_user_id
          AND jsonb_typeof(v.value) = 'number'
          AND (v.value#>>'{}') ~ '^[0-9]{1,9}$'
        GROUP BY v.key
        ORDER BY count DESC
        LIMIT 2
    ) d;

    -- Chart Data (last 10 sessions). Missing clarity/filler evidence yields NULL (omitted point), never a
    -- fabricated value. Filler eligibility = a genuine flat count on THIS row.
    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO v_chart_data
    FROM (
        SELECT
            to_char(created_at, 'MM/DD/YYYY') as date,
            CASE WHEN filler_eligible AND duration > 0
                 THEN round(fw_count / (duration / 60.0), 2)::text ELSE NULL END as "FW/min",
            CASE WHEN clarity_score IS NOT NULL AND coalesce(total_words, 0) >= c_min_reliable_scoring_words
                 THEN clarity_score ELSE NULL END as clarity
        FROM (
            SELECT
                s.created_at, s.duration, s.clarity_score, s.total_words,
                (public._ss_valid_filler_total(s.filler_counts) IS NOT NULL) as filler_eligible,
                coalesce(public._ss_valid_filler_total(s.filler_counts), 0) as fw_count
            FROM sessions s
            WHERE s.user_id = p_user_id
            ORDER BY s.created_at DESC
            LIMIT 10
        ) sub
        ORDER BY created_at ASC
    ) d;

    -- Weekly Sessions Count (last 7 days)
    SELECT count(*) INTO v_weekly_sessions_count
    FROM sessions
    WHERE user_id = p_user_id AND created_at >= now() - interval '7 days';

    -- Weekly Activity (current week)
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

    -- Filler Word Trends (recent vs prior FILLER-ELIGIBLE window; >= 2 eligible measurements required).
    SELECT count(*) INTO v_eligible_filler_count
    FROM sessions
    WHERE user_id = p_user_id
      AND public._ss_valid_filler_total(filler_counts) IS NOT NULL;

    IF v_eligible_filler_count >= 2 THEN
        v_trend_current_count := LEAST(v_eligible_filler_count, 10) - (LEAST(v_eligible_filler_count, 10) / 2);

        WITH eligible_filler_sessions AS (
            SELECT id, duration, row_number() OVER (ORDER BY created_at DESC) as rn
            FROM sessions
            WHERE user_id = p_user_id
              AND public._ss_valid_filler_total(filler_counts) IS NOT NULL
        ),
        last_10_sessions AS (
            SELECT id, duration, rn FROM eligible_filler_sessions WHERE rn <= 10
        ),
        window_minutes AS (
            SELECT
                sum(duration) FILTER (WHERE rn <= v_trend_current_count) / 60.0 AS cur_min,
                sum(duration) FILTER (WHERE rn >  v_trend_current_count) / 60.0 AS prev_min
            FROM last_10_sessions
        ),
        filler_counts_cte AS (
            SELECT l.rn, v.key as word, (v.value#>>'{}')::bigint as count
            FROM last_10_sessions l
            JOIN sessions s ON s.id = l.id
            CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(s.filler_counts) = 'object' THEN s.filler_counts ELSE '{}'::jsonb END) AS v(key, value)
            WHERE jsonb_typeof(v.value) = 'number'
              AND (v.value#>>'{}') ~ '^[0-9]{1,9}$'
        ),
        sums AS (
            SELECT word,
                sum(count) FILTER (WHERE rn <= v_trend_current_count) as cur_sum,
                sum(count) FILTER (WHERE rn >  v_trend_current_count) as prev_sum
            FROM filler_counts_cte
            GROUP BY word
        )
        SELECT coalesce(jsonb_object_agg(word, jsonb_build_object(
            'current',  CASE WHEN w.cur_min  > 0 THEN round(coalesce(s2.cur_sum, 0)  / w.cur_min, 2)  ELSE 0 END,
            'previous', CASE WHEN w.prev_min > 0 THEN round(coalesce(s2.prev_sum, 0) / w.prev_min, 2) ELSE 0 END
        )), '{}'::jsonb)
        INTO v_filler_word_trends
        FROM sums s2 CROSS JOIN window_minutes w;
    ELSE
        v_filler_word_trends := '{}'::jsonb;
    END IF;

    RETURN jsonb_build_object(
        'overallStats', v_overall_stats || jsonb_build_object('chartData', v_chart_data),
        'topFillerWords', v_top_filler_words,
        'fillerWordTrends', v_filler_word_trends,
        -- STT-accuracy series retired with the `accuracy` column (benchmark-only metric, never a customer row).
        'accuracyData', '[]'::jsonb,
        'weeklySessionsCount', v_weekly_sessions_count,
        'weeklyActivity', v_weekly_activity
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_analytics_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_analytics_summary(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public._ss_valid_filler_total(JSONB) FROM PUBLIC;

