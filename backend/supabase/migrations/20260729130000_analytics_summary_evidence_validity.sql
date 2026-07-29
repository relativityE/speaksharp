-- #1045 / PR #1091 — get_analytics_summary (v4): evidence validity for server-side aggregates.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR. Requires separate Product Owner migration approval before deploy.
-- Do not run this against any hosted environment without that approval.
--
-- WHY THIS EXISTS
-- ---------------
-- `useAnalytics` switches to this RPC once a user has more than 20 sessions
-- (`shouldUseRPC = totalSessionsCount > 20 && !sessionId`). Every fix PR #1091 made to the CLIENT
-- aggregate (`calculateOverallStats` in frontend/src/lib/analyticsUtils.ts) is therefore invisible to
-- exactly the users who have enough history to care — including the Product Owner account with 59
-- sessions that reported "Clear Delivery 0%".
--
-- The v3 function (20260213000000_analytics_rpc.sql) computed:
--
--     coalesce(sum(coalesce(clarity_score, accuracy * 100, 0)), 0) / v_total_sessions
--
-- i.e. it divided by ALL sessions while folding every missing measurement in as a hard ZERO. A NULL
-- `clarity_score` is not an anomaly: session persistence is a non-atomic three-phase save, and phase 2c
-- (the `updateSession` in SpeechRuntimeController that writes total_words / filler_words /
-- pause_metrics / wpm / clarity_score) is EXPLICITLY allowed to fail while the session row is kept —
-- the user is told "Your transcript was saved, but some analysis metrics could not be updated yet."
-- Those rows are a routine, expected state. Averaging them in as zeros manufactures a false low score
-- out of missing evidence, and no client guard can undo it: once the server has collapsed the sum and
-- divided by the wrong denominator, the true average is unrecoverable downstream.
--
-- The same defect applies to `avgWpm` (numerator skips NULLs, denominator counts every session) and to
-- `avgFillerWordsPerMin` (a rate over elapsed time that has no transcribed-word requirement, so a
-- wordless take reports a confident, flattering "0.0"). All three are fixed here; none is left behind.
--
-- CANONICAL CLIENT RULE BEING MIRRORED
-- ------------------------------------
-- frontend/src/utils/sessionAnalysis.ts:
--     isClarityScorable = wordCount >= ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS   (= 3)
-- frontend/src/lib/analyticsUtils.ts (calculateOverallStats):
--     a session contributes to the clarity average ONLY when `sessionMetrics.isClarityScorable`;
--     the average is totalClarity / clarityContributors, and is `null` when there are no contributors.
--     Delivery clarity is `clarity_score` ONLY — the STT `accuracy` column is a transcription-quality
--     measure, is NOT clarity, and the client never substitutes it. The v3 `accuracy * 100` fallback is
--     removed here for the same reason.
--     averageWPM   = round(totalWords / totalMinutes), null unless BOTH words > 0 and minutes > 0.
--     fillerRate   = fillers / minutes,                null unless BOTH words > 0 and duration > 0.
--
-- Server-side mirror, using the columns this function can actually see:
--     clarity contributor  <=>  clarity_score IS NOT NULL AND coalesce(total_words, 0) >= 3
--
-- Two deliberate, documented divergences from the client, both erring toward EXCLUDING evidence
-- (which degrades to "Not enough data") and never toward fabricating a number:
--   1. The client uses max(transcript-derived word count, total_words); this function uses total_words
--      alone rather than re-implementing the client's Unicode word regex in SQL. In practice this is
--      near-lossless because `clarity_score` and `total_words` are written by the SAME phase-2c
--      statement, so a non-NULL clarity_score implies total_words was written with it. A legacy row
--      with a clarity_score but no total_words is excluded rather than guessed at.
--   2. The client recounts filler words from the transcript when persisted filler_words is malformed;
--      this function cannot, so the filler total here is a lower bound. It is never inflated.
--
-- CONTRACT ADDITIONS (additive — no existing key is renamed or removed)
-- ---------------------------------------------------------------------
--   avgClarity                  NEW. The corrected clarity average as text, or JSON null.
--   avgAccuracy                 KEPT for compatibility; historically held clarity, not STT accuracy.
--                               Now carries the same corrected value as `avgClarity`, or JSON null.
--   clarityContributorCount     NEW. Number of sessions that actually carry scorable clarity evidence.
--   wpmContributorCount         NEW. Number of sessions carrying both words and duration.
--   fillerRateContributorCount  NEW. Same evidence basis as wpmContributorCount, named per metric.
--
-- The contributor counts let the client tell "this average is genuinely low" apart from "there is no
-- evidence", AND let it detect a database on which this migration has not been applied (the keys are
-- simply absent) so it can degrade to "Not enough data" instead of trusting a contaminated number.
--
-- NO-EVIDENCE VALUES: the v3 `ELSE '0.0'` / `ELSE 0` fallbacks are part of the defect and are replaced
-- with SQL NULL (JSON null). Zero is a measurement; absence is not.
--
-- Rollback: re-run 20260213000000_analytics_rpc.sql to restore the v3 body. This migration changes only
-- a function definition — no table, column, index, or row is touched, and no data can be lost by it.

CREATE OR REPLACE FUNCTION get_analytics_summary(p_user_id UUID)
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
    v_clarity_contributors INT;
    v_word_time_sessions INT;
    v_total_filler_words INT;
    v_avg_clarity TEXT;
    v_avg_wpm NUMERIC;
    v_avg_filler_per_min TEXT;
    -- Mirrors ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS in frontend/src/utils/sessionAnalysis.ts.
    -- Keep these two in sync; the client value is the source of truth.
    c_min_reliable_scoring_words CONSTANT INT := 3;
BEGIN
    -- SECURITY CHECK
    IF p_user_id != auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: You can only access your own analytics.';
    END IF;

    -- Overall stats across ALL sessions.
    -- Totals (sessions / duration / words) legitimately span every row. The clarity sum and its
    -- contributor count are FILTERed to rows that actually carry scorable clarity evidence, so a
    -- phase-2c write failure can no longer be averaged in as a zero.
    SELECT
        count(*),
        coalesce(sum(duration), 0),
        coalesce(sum(total_words), 0),
        coalesce(sum(clarity_score) FILTER (
            WHERE clarity_score IS NOT NULL
              AND coalesce(total_words, 0) >= c_min_reliable_scoring_words
        ), 0),
        count(*) FILTER (
            WHERE clarity_score IS NOT NULL
              AND coalesce(total_words, 0) >= c_min_reliable_scoring_words
        ),
        count(*) FILTER (
            WHERE coalesce(total_words, 0) > 0
              AND coalesce(duration, 0) > 0
        )
    INTO
        v_total_sessions,
        v_total_duration_seconds,
        v_total_words,
        v_sum_clarity,
        v_clarity_contributors,
        v_word_time_sessions
    FROM sessions
    WHERE user_id = p_user_id;

    -- Total filler words (lower bound: rows with absent/malformed filler_words contribute nothing).
    SELECT coalesce(sum((v.value->>'count')::int), 0)
    INTO v_total_filler_words
    FROM sessions s,
         jsonb_each(s.filler_words) AS v(key, value)
    WHERE s.user_id = p_user_id
      AND v.key != 'total';

    -- Clarity: average over CONTRIBUTORS, never over all sessions. NULL when nothing qualifies.
    v_avg_clarity := CASE
        WHEN v_clarity_contributors > 0
            THEN (v_sum_clarity / v_clarity_contributors)::numeric(10,1)::text
        ELSE NULL
    END;

    -- Pace: mirrors the client's aggregate rule (total words over total speaking minutes), which needs
    -- BOTH a numerator and a denominator. "0 WPM" would read as "you spoke impossibly slowly" rather
    -- than "we transcribed nothing", so absence is reported as NULL.
    v_avg_wpm := CASE
        WHEN v_total_duration_seconds > 0 AND v_total_words > 0
            THEN round(v_total_words / (v_total_duration_seconds / 60.0))
        ELSE NULL
    END;

    -- Filler rate: a rate needs transcribed words, not merely elapsed time. Without words the old
    -- "0.0/min" decoded to the POSITIVE label "Low" — silence praised as clean delivery. A real take
    -- with words and no fillers still reports 0.0; that is genuine evidence and stays.
    v_avg_filler_per_min := CASE
        WHEN v_total_duration_seconds > 0 AND v_total_words > 0
            THEN (v_total_filler_words / (v_total_duration_seconds / 60.0))::numeric(10,1)::text
        ELSE NULL
    END;

    v_overall_stats := jsonb_build_object(
        'totalSessions', v_total_sessions,
        'totalPracticeTime', round(v_total_duration_seconds / 60.0),
        'avgWpm', v_avg_wpm,
        'avgFillerWordsPerMin', v_avg_filler_per_min,
        'avgClarity', v_avg_clarity,
        -- Compatibility alias. This key has ALWAYS held clarity, never STT accuracy; existing consumers
        -- read it, so it keeps the same (now corrected) value rather than being renamed away.
        'avgAccuracy', v_avg_clarity,
        'clarityContributorCount', v_clarity_contributors,
        'wpmContributorCount', v_word_time_sessions,
        'fillerRateContributorCount', v_word_time_sessions
    );

    -- Top 2 Filler Words
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

    -- Chart Data (last 10 sessions) — UNCHANGED from v3 on purpose. This is a per-point series, not an
    -- aggregate, and its `coalesce(clarity_score, ... , 100)` fabricates a per-session value rather than
    -- contaminating an average. It is a separate defect and is tracked separately; changing the series
    -- shape here would expand this fix beyond the aggregate contract it is scoped to.
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

    -- Accuracy Data (last 10 sessions with engine)
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

    -- Weekly Sessions Count (last 7 days)
    SELECT count(*) INTO v_weekly_sessions_count
    FROM sessions
    WHERE user_id = p_user_id AND created_at >= now() - interval '7 days';

    -- Weekly Activity (Current Week starting Sunday in JS terms)
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

    -- Filler Word Trends (Last 10 sessions, compare 0-5 and 5-10)
    WITH last_10_sessions AS (
        SELECT id, created_at, row_number() OVER (ORDER BY created_at DESC) as rn
        FROM sessions
        WHERE user_id = p_user_id
        LIMIT 10
    ),
    filler_counts AS (
        SELECT
            l.rn,
            v.key as word,
            (v.value->>'count')::int as count
        FROM last_10_sessions l
        JOIN sessions s ON s.id = l.id
        CROSS JOIN LATERAL jsonb_each(s.filler_words) AS v(key, value)
        WHERE v.key != 'total'
    ),
    averages AS (
        SELECT
            word,
            avg(count) FILTER (WHERE rn <= 5) as current_avg,
            avg(count) FILTER (WHERE rn > 5) as previous_avg
        FROM filler_counts
        GROUP BY word
    )
    SELECT coalesce(jsonb_object_agg(word, jsonb_build_object('current', coalesce(current_avg, 0), 'previous', coalesce(previous_avg, 0))), '{}'::jsonb)
    INTO v_filler_word_trends
    FROM averages;

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

-- Grant permissions (idempotent; unchanged from v3).
GRANT EXECUTE ON FUNCTION get_analytics_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_analytics_summary(UUID) TO service_role;
