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

-- #1131 review corrections 3 + 4 — the AUTHORITATIVE, validated total filler count for one session.
--  * Total-authoritative (correction 3): a valid `total.count` wins outright, INCLUDING a genuine 0 and a
--    total-only snapshot `{ "total": { "count": N } }` with no per-word breakdown. Otherwise sum the per-word
--    (non-total) entries that carry a valid count.
--  * Validated (correction 4): a "valid" count is a NON-NEGATIVE INTEGER of at most 9 digits (kept inside int
--    range). A fractional (2.5), negative (-1), non-numeric, or out-of-range value is malformed — excluded via
--    a regex guard BEFORE any ::int cast, so a bad count can never crash the cast nor fabricate a flattering 0.
-- Returns NULL when the session carries no valid filler evidence at all (null / non-object / empty {} /
-- malformed), so callers EXCLUDE the row instead of inventing a measurement. Mirrors client validatedFillerTotal().
-- Pure jsonb/text logic (no table access): IMMUTABLE with a pinned search_path, SECURITY INVOKER (default).
CREATE OR REPLACE FUNCTION public._ss_valid_filler_total(fw JSONB)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE
    WHEN fw IS NULL OR jsonb_typeof(fw) <> 'object' THEN NULL
    WHEN (fw->'total'->>'count') ~ '^[0-9]{1,9}$' THEN (fw->'total'->>'count')::int
    WHEN EXISTS (
      SELECT 1 FROM jsonb_each(fw) e
      WHERE e.key <> 'total' AND (e.value->>'count') ~ '^[0-9]{1,9}$'
    ) THEN (
      SELECT sum((e.value->>'count')::int)::int FROM jsonb_each(fw) e
      WHERE e.key <> 'total' AND (e.value->>'count') ~ '^[0-9]{1,9}$'
    )
    ELSE NULL
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
    v_accuracy_data JSONB;
    v_weekly_activity JSONB;
    v_weekly_sessions_count INT;
    v_total_sessions INT;
    v_total_duration_seconds INT;
    -- #1047 U1 (review correction): rate DENOMINATORS are METRIC-SPECIFIC. v_total_duration_seconds stays
    -- all-session (feeds only totalPracticeTime). Each rate uses the duration of rows that actually persist
    -- ITS metric, so an expired row with duration but no persisted words cannot deflate WPM, and a row
    -- without persisted fillers cannot dilute the filler rate.
    v_wpm_duration_seconds INT;
    v_filler_duration_seconds INT;
    v_total_words INT;
    v_sum_clarity FLOAT8;
    v_clarity_contributors INT;
    -- #1047 U1: per-metric contributor counts (rows whose duration enters each rate's denominator).
    v_wpm_contributors INT;
    v_filler_contributors INT;
    v_total_filler_words INT;
    -- #1047 U1: number of filler-metric-eligible rows. A "trend" is a comparison and needs at least TWO such
    -- measurements; with fewer we report NO trend (mirrors the client calculateFillerWordTrends >= 2 gate).
    v_eligible_filler_count INT;
    -- #1131 correction 2: size of the "current" (more-recent) trend window. The most-recent min(eligible,10)
    -- rows are split at floor(k/2) so BOTH windows are nonempty for every k >= 2 (never an invented zero
    -- baseline); at k = 10 this is the classic 5/5 split. Mirrors client calculateFillerWordTrends.
    v_trend_current_count INT;
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
        -- #1047 U1: WPM-metric-eligible duration — a row contributes ITS speaking time to the WPM denominator
        -- only when the WPM value is genuinely persisted (a real word count) AND its provenance is showable
        -- (not a not_captured sentinel). This is the exact client rule for every row that exists in production:
        -- an `available` row always carries words, and an `expired` row contributes only if a word count
        -- survived retention. (transcript_state is one of the three concrete values — 20260801000000 backfill.)
        coalesce(sum(duration) FILTER (
            WHERE transcript_state IS DISTINCT FROM 'not_captured'
              AND total_words IS NOT NULL AND total_words > 0), 0),
        -- #1047 U1: filler-metric-eligible duration — same rule for fillers (real persisted filler data +
        -- showable provenance). Matches the client hasRealFillerData gate (filler_words present, not '{}').
        coalesce(sum(duration) FILTER (
            WHERE transcript_state IS DISTINCT FROM 'not_captured'
              AND public._ss_valid_filler_total(filler_words) IS NOT NULL), 0),
        -- Transcript-derived WPM numerator: SAME eligibility as its denominator above, so numerator and
        -- denominator always describe the identical set of rows.
        coalesce(sum(total_words) FILTER (
            WHERE transcript_state IS DISTINCT FROM 'not_captured'
              AND total_words IS NOT NULL AND total_words > 0), 0),
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
        -- #1047 U1: METRIC-SPECIFIC contributor counts. WPM and filler no longer share one "words+duration"
        -- count — each reports exactly the rows whose speaking time entered ITS rate denominator (same
        -- eligibility as v_wpm_duration_seconds / v_filler_duration_seconds above, requiring real elapsed time).
        count(*) FILTER (
            WHERE coalesce(duration, 0) > 0
              AND transcript_state IS DISTINCT FROM 'not_captured'
              AND total_words IS NOT NULL AND total_words > 0
        ),
        count(*) FILTER (
            WHERE coalesce(duration, 0) > 0
              AND transcript_state IS DISTINCT FROM 'not_captured'
              AND public._ss_valid_filler_total(filler_words) IS NOT NULL
        )
    INTO
        v_total_sessions,
        v_total_duration_seconds,
        v_wpm_duration_seconds,
        v_filler_duration_seconds,
        v_total_words,
        v_sum_clarity,
        v_clarity_contributors,
        v_wpm_contributors,
        v_filler_contributors
    FROM sessions
    WHERE user_id = p_user_id;

    -- Total filler words — the filler-rate NUMERATOR. #1047 review: excludes not_captured rows (their
    -- persisted filler_words are a sentinel). #1131 corrections 2–4: one validated, total-authoritative count
    -- per session via _ss_valid_filler_total (a valid `total.count` wins, including a total-only snapshot;
    -- else the sum of valid per-word counts; malformed/fractional/negative excluded, no crash). Drawn from
    -- the SAME row set as the denominator — every eligible row has a non-null validated total, and only those.
    SELECT coalesce(sum(public._ss_valid_filler_total(s.filler_words)), 0)
    INTO v_total_filler_words
    FROM sessions s
    WHERE s.user_id = p_user_id
      AND s.transcript_state IS DISTINCT FROM 'not_captured'
      AND public._ss_valid_filler_total(s.filler_words) IS NOT NULL;

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
        WHEN v_wpm_duration_seconds > 0 AND v_total_words > 0
            THEN round(v_total_words / (v_wpm_duration_seconds / 60.0))
        ELSE NULL
    END;

    -- Filler rate. #1131 review correction 1: the rate must NOT depend on word-count / WPM evidence. Its
    -- denominator is the FILLER-metric-eligible speaking time (v_filler_duration_seconds), which already
    -- includes ONLY rows carrying genuine persisted filler data (a real numeric count) — a silent/wordless
    -- take contributes no such evidence and is excluded upstream, so it can never be praised as a flattering
    -- 0.0/min. A real take with genuine fillers but unpersisted words still reports its rate. A real take with
    -- words and genuinely zero fillers still reports 0.0 — that is evidence and stays.
    v_avg_filler_per_min := CASE
        WHEN v_filler_duration_seconds > 0
            THEN (v_total_filler_words / (v_filler_duration_seconds / 60.0))::numeric(10,1)::text
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
        'wpmContributorCount', v_wpm_contributors,
        'fillerRateContributorCount', v_filler_contributors
    );

    -- Top 2 Filler Words (per-word breakdown; a total-only snapshot legitimately has no per-word entries).
    -- #1047 review: a not_captured row's persisted filler map is a sentinel — exclude it so stale counts
    -- never appear in the top-filler list. #1131 correction 4: the regex guards the ::int cast so a
    -- fractional/negative/malformed per-word count never crashes it or fabricates a count.
    SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO v_top_filler_words
    FROM (
        SELECT v.key as word, sum((v.value->>'count')::int) as count
        FROM sessions s,
             jsonb_each(s.filler_words) AS v(key, value)
        WHERE s.user_id = p_user_id
          AND s.transcript_state IS DISTINCT FROM 'not_captured'
          AND v.key != 'total'
          AND (v.value->>'count') ~ '^[0-9]{1,9}$'
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
            -- #1047 U1: plot a filler rate ONLY when THIS row's filler evidence is showable — the exact client
            -- fillerMetricEligible gate (available always; expired only with real persisted filler data). A
            -- not_captured row (stale sentinel) OR an expired row whose filler data did not survive retention
            -- emits NULL (omitted point), never a fabricated 0.00.
            CASE
                WHEN filler_eligible AND duration > 0
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
                -- #1047 U1 / #1131 correction 2: precompute the client's fillerMetricEligible gate for the FW/min
                -- point — showable provenance (not not_captured) AND GENUINE persisted filler data: at least one
                -- key with a real numeric count. Mirrors client hasRealFillerData, so an empty `{}` or a
                -- malformed `{um:{}}` / `{um:{count:null}}` is NOT evidence and never charts a fabricated 0.00.
                (s.transcript_state IS DISTINCT FROM 'not_captured'
                 AND public._ss_valid_filler_total(s.filler_words) IS NOT NULL) as filler_eligible,
                -- #1131 corrections 3 + 4: the plotted filler count is the validated, total-authoritative value.
                coalesce(public._ss_valid_filler_total(s.filler_words), 0) as fw_count
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
          -- #1047 review: a not_captured row's retained accuracy is a sentinel, not a measurement.
          AND transcript_state IS DISTINCT FROM 'not_captured'
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

    -- Filler Word Trends (compare the most-recent 5 vs the prior 5 FILLER-ELIGIBLE sessions).
    -- #1047 U1: the trend window is a recency slice of the FILLER-metric-eligible history — the exact client
    -- gate (available always; expired only with real persisted filler data). A not_captured row (stale
    -- sentinel) or an expired row whose filler data did not survive retention never occupies a window slot.
    -- A trend also needs >= 2 eligible measurements; with fewer we emit NO trend ('{}'), never a phantom
    -- direction derived from a single point. Mirrors client calculateFillerWordTrends.
    SELECT count(*) INTO v_eligible_filler_count
    FROM sessions
    WHERE user_id = p_user_id
      AND transcript_state IS DISTINCT FROM 'not_captured'
      AND public._ss_valid_filler_total(filler_words) IS NOT NULL;

    IF v_eligible_filler_count >= 2 THEN
        -- #1131 correction 2: split the most-recent min(eligible,10) rows into two NONEMPTY windows at
        -- floor(k/2) — the "current" (more recent) window gets the larger half. Never an empty "previous"
        -- window compared against an invented zero baseline. Integer division floors.
        v_trend_current_count := LEAST(v_eligible_filler_count, 10) - (LEAST(v_eligible_filler_count, 10) / 2);

        WITH eligible_filler_sessions AS (
            SELECT id, row_number() OVER (ORDER BY created_at DESC) as rn
            FROM sessions
            WHERE user_id = p_user_id
              AND transcript_state IS DISTINCT FROM 'not_captured'
              AND public._ss_valid_filler_total(filler_words) IS NOT NULL
        ),
        last_10_sessions AS (
            SELECT id, rn FROM eligible_filler_sessions WHERE rn <= 10
        ),
        filler_counts AS (
            -- #1131 correction 4: only per-word entries with a VALID non-negative integer count contribute;
            -- the regex guards the ::int cast so a fractional/negative/malformed count never crashes it.
            SELECT
                l.rn,
                v.key as word,
                (v.value->>'count')::int as count
            FROM last_10_sessions l
            JOIN sessions s ON s.id = l.id
            CROSS JOIN LATERAL jsonb_each(s.filler_words) AS v(key, value)
            WHERE v.key != 'total'
              AND (v.value->>'count') ~ '^[0-9]{1,9}$'
        ),
        averages AS (
            SELECT
                word,
                avg(count) FILTER (WHERE rn <= v_trend_current_count) as current_avg,
                avg(count) FILTER (WHERE rn > v_trend_current_count) as previous_avg
            FROM filler_counts
            GROUP BY word
        )
        SELECT coalesce(jsonb_object_agg(word, jsonb_build_object('current', coalesce(current_avg, 0), 'previous', coalesce(previous_avg, 0))), '{}'::jsonb)
        INTO v_filler_word_trends
        FROM averages;
    ELSE
        v_filler_word_trends := '{}'::jsonb;
    END IF;

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

-- #1131: the pure filler-count helper is invoked only from within get_analytics_summary (SECURITY DEFINER),
-- so it runs as the function owner regardless of caller privileges. Least privilege: no one else needs it.
REVOKE EXECUTE ON FUNCTION public._ss_valid_filler_total(JSONB) FROM PUBLIC;
