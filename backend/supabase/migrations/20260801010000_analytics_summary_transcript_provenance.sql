-- #1047 PR-U1 — ADDITIVE redefinition of get_analytics_summary using EXPLICIT transcript_state provenance.
--
-- This does NOT rewrite the committed 20260729130000 migration. It supersedes the function body so the
-- server aggregate contributor rules gate on the SERVER-OWNED transcript_state (added by
-- 20260801000000_sessions_transcript_state.sql) rather than inferring provenance from total_words > 0.
-- A `not_captured` row is excluded from every transcript-derived aggregate (its persisted evidence is a
-- sentinel), while an `expired` row that still carries genuinely-persisted measurements keeps contributing
-- (`IS DISTINCT FROM 'not_captured'` includes available + expired + any legacy value, excludes not_captured).
--
-- Only the CONTRIBUTOR FILTERs change vs 20260729130000; totals (session count / practice time) still span
-- every row, the authorization guard, search_path, and the REVOKE/GRANT set are reproduced VERBATIM.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR — requires separate Product Owner migration approval before deploy.

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
    v_accuracy_data JSONB;
    v_weekly_activity JSONB;
    v_weekly_sessions_count INT;
    v_total_sessions INT;
    v_total_duration_seconds INT;
    -- #1047 review: the WPM/filler-rate DENOMINATOR must exclude not_captured rows. v_total_duration_seconds
    -- stays all-session (it feeds only totalPracticeTime); this eligible-only duration feeds the rates so a
    -- not_captured row's stale/sentinel duration can never dilute or inflate WPM or filler-per-minute.
    v_eligible_duration_seconds INT;
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
    -- SECURITY CHECK — this migration CONSUMES the authorization + search_path contract owned by
    -- #1096 (20260729120000). Because this file is dated after #1096, its body is what ends up live,
    -- so it must reproduce #1096's controls VERBATIM — never re-decide or weaken them. Guard, REVOKEs
    -- and `SET search_path = public, pg_temp` are copied from #1096 exactly; this PR adds only the
    -- evidence-validity aggregate changes on top.
    IF auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized: You can only access your own analytics.';
    END IF;

    -- Overall stats across ALL sessions.
    -- Totals (sessions / duration / words) legitimately span every row. The clarity sum and its
    -- contributor count are FILTERed to rows that actually carry scorable clarity evidence, so a
    -- phase-2c write failure can no longer be averaged in as a zero.
    SELECT
        count(*),
        coalesce(sum(duration), 0),
        -- All-session duration for total-practice-time only.
        coalesce(sum(duration) FILTER (WHERE transcript_state IS DISTINCT FROM 'not_captured'), 0),
        -- Transcript-derived WPM numerator: provenance-eligible rows only (excludes not_captured sentinels;
        -- keeps available + expired-with-persisted-metrics + legacy).
        coalesce(sum(total_words) FILTER (WHERE transcript_state IS DISTINCT FROM 'not_captured'), 0),
        coalesce(sum(clarity_score) FILTER (
            WHERE clarity_score IS NOT NULL
              AND coalesce(total_words, 0) >= c_min_reliable_scoring_words
              AND transcript_state IS DISTINCT FROM 'not_captured'
        ), 0),
        count(*) FILTER (
            WHERE clarity_score IS NOT NULL
              AND coalesce(total_words, 0) >= c_min_reliable_scoring_words
              AND transcript_state IS DISTINCT FROM 'not_captured'
        ),
        count(*) FILTER (
            WHERE coalesce(total_words, 0) > 0
              AND coalesce(duration, 0) > 0
              AND transcript_state IS DISTINCT FROM 'not_captured'
        )
    INTO
        v_total_sessions,
        v_total_duration_seconds,
        v_eligible_duration_seconds,
        v_total_words,
        v_sum_clarity,
        v_clarity_contributors,
        v_word_time_sessions
    FROM sessions
    WHERE user_id = p_user_id;

    -- Total filler words (lower bound: rows with absent/malformed filler_words contribute nothing).
    -- #1047 review: the filler-rate NUMERATOR excludes not_captured rows — their persisted filler_words are
    -- a sentinel, so counting them would fabricate a rate against a transcript that was never captured.
    SELECT coalesce(sum((v.value->>'count')::int), 0)
    INTO v_total_filler_words
    FROM sessions s,
         jsonb_each(s.filler_words) AS v(key, value)
    WHERE s.user_id = p_user_id
      AND s.transcript_state IS DISTINCT FROM 'not_captured'
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
        WHEN v_eligible_duration_seconds > 0 AND v_total_words > 0
            THEN round(v_total_words / (v_eligible_duration_seconds / 60.0))
        ELSE NULL
    END;

    -- Filler rate: a rate needs transcribed words, not merely elapsed time. Without words the old
    -- "0.0/min" decoded to the POSITIVE label "Low" — silence praised as clean delivery. A real take
    -- with words and no fillers still reports 0.0; that is genuine evidence and stays.
    v_avg_filler_per_min := CASE
        WHEN v_eligible_duration_seconds > 0 AND v_total_words > 0
            THEN (v_total_filler_words / (v_eligible_duration_seconds / 60.0))::numeric(10,1)::text
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

    -- Chart Data (last 10 sessions).
    --
    -- The superseded series did:
    --     coalesce(clarity_score, CASE WHEN duration > 0 THEN 100 - (fw_rate * 2) ELSE 100 END)
    -- so a session with no clarity measurement and no duration was charted as a PERFECT 100. Every other
    -- defect in this migration fabricates a zero — visible, and it makes the speaker look worse than they
    -- are. This one fabricated the MAXIMUM: invisible, flattering, and it would have silently contradicted
    -- the corrected aggregate on the very same sessions (a chart of 100s above a "Not enough data" card).
    -- The duration>0 branch was no better: deriving clarity from filler rate alone is not the clarity
    -- formula, it is a different number wearing the same label.
    --
    -- Missing clarity now yields SQL NULL — an omitted point. No substitute formula is invented to fill
    -- the gap. Eligibility is the same CLARITY CONTRIBUTOR RULE used by the aggregate above, so a session
    -- can never be plotted as scorable while being excluded from the average, or vice versa.
    -- The final comparable-session chart DESIGN is owned by TEMP-PR-06; this only removes fabrication.
    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO v_chart_data
    FROM (
        SELECT
            to_char(created_at, 'MM/DD/YYYY') as date,
            -- #1047 review: a not_captured row's stale filler_words must NOT plot a rate — emit NULL (omitted
            -- point), never a fabricated value, even when a nonzero sentinel count remains. An eligible row
            -- (available / expired-with-persisted-metrics) with real duration still charts its rate.
            CASE
                WHEN transcript_state IS DISTINCT FROM 'not_captured' AND duration > 0
                    THEN (fw_count / (duration / 60.0))::numeric(10,2)::text
                ELSE NULL
            END as "FW/min",
            -- Same provenance gate on clarity: a not_captured row's stale clarity_score is never plotted.
            CASE
                WHEN clarity_score IS NOT NULL
                 AND coalesce(total_words, 0) >= c_min_reliable_scoring_words
                 AND transcript_state IS DISTINCT FROM 'not_captured'
                    THEN clarity_score
                ELSE NULL
            END as clarity
        FROM (
            SELECT
                s.created_at,
                s.duration,
                s.clarity_score,
                s.total_words,
                s.transcript_state,
                coalesce((SELECT sum((v.value->>'count')::int) FROM jsonb_each(s.filler_words) AS v(key, value) WHERE v.key != 'total'), 0) as fw_count
            FROM sessions s
            WHERE s.user_id = p_user_id
            ORDER BY s.created_at DESC
            LIMIT 10
        ) sub
        ORDER BY created_at ASC
    ) d;

    -- Accuracy Data (last 10 sessions with engine).
    --
    -- Same defect class, opposite direction. It returned `coalesce(clarity_score, accuracy * 100)` under a
    -- key named `accuracy`, so a delivery-clarity score was served to the STT-accuracy chart whenever the
    -- real accuracy measurement was missing — the mirror image of the `accuracy * 100` clarity fallback
    -- removed from the aggregate above. Two different quantities were being swapped for each other in both
    -- directions, and the client (`calculateAccuracyData`, which derives accuracy from ground-truth WER)
    -- never did this. This series now reports ONLY the real STT accuracy measurement; sessions without one
    -- are omitted from the series rather than filled in with clarity.
    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO v_accuracy_data
    FROM (
        SELECT
            to_char(created_at, 'MM/DD/YYYY') as date,
            accuracy * 100 as accuracy,
            engine
        FROM sessions
        WHERE user_id = p_user_id
          AND engine IS NOT NULL
          AND accuracy IS NOT NULL
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

-- ---------------------------------------------------------------------------------------------------
-- PRIVILEGES — least privilege. All statements are idempotent and safe to re-run.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default when a function is created, and no migration has ever
-- revoked it for this function. `anon` additionally holds USAGE on schema public
-- (20251219150000_fix_service_role_permissions.sql), so the function has been reachable by an
-- unauthenticated PostgREST caller. That reachability is CONFIRMED, not theorised — see the header.
--
-- The same codebase already applies this exact hardening to process_stripe_webhook_event,
-- create_session_and_update_usage, check_usage_limit, update_user_usage, consume_formatter_quota,
-- consume_ai_suggestion_quota, get_user_id_by_email and others. The pattern existed; this function was
-- missed. The REVOKE below is the pattern, applied.
--
-- ACL: this migration REPRODUCES #1096's grant set VERBATIM — it does not re-decide it. #1096
-- (20260729120000, already on main) is the sole owner of the authorization policy for this function:
-- REVOKE from PUBLIC and anon, GRANT to authenticated and service_role. Re-issuing the identical set
-- here (CREATE OR REPLACE does not reset privileges, but a later definition must not silently narrow
-- them) keeps the two migrations convergent. Whether service_role should keep its grant is #1096's
-- decision, not this migration's; #1096 kept it, and the null-safe guard already makes a keyless
-- service_role call fail closed regardless.
REVOKE EXECUTE ON FUNCTION public.get_analytics_summary(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_analytics_summary(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_analytics_summary(UUID) TO service_role;
