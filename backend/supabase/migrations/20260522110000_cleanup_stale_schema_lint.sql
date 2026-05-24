-- Remove stale RPC overloads and keep app-owned schema lint clean.

DROP FUNCTION IF EXISTS public.create_session_and_update_usage(JSONB, BOOLEAN);

CREATE OR REPLACE FUNCTION public.get_analytics_summary(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    IF p_user_id != auth.uid() THEN
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

GRANT EXECUTE ON FUNCTION public.get_analytics_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(UUID) TO service_role;
