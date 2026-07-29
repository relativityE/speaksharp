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
-- The function currently in effect is the one re-issued by 20260522110000_cleanup_stale_schema_lint.sql
-- (NOT 20260213000000_analytics_rpc.sql, which it supersedes). Both carry the identical defect, and this
-- migration replaces the 20260522110000 definition. It computed:
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
-- CANONICAL CLIENT RULE BEING MIRRORED — THE CLARITY CONTRIBUTOR RULE
-- -------------------------------------------------------------------
-- NAMING, precisely: what this migration mirrors is the existing CLARITY CONTRIBUTOR RULE
-- (`isClarityScorable`) — the rule deciding whether a session carries enough transcribed speech for its
-- clarity score to mean anything. It is NOT the #1045 session-eligibility contract, which is a separate
-- and ADDITIONAL gate excluding accidental/insufficient takes from Progress and from both takeaways.
-- That contract is owned by #1045 and is NOT settled, implemented, or approximated here. Do not describe
-- this migration as implementing session eligibility.
--
-- frontend/src/utils/sessionAnalysis.ts:
--     isClarityScorable = wordCount >= ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS   (= 3)
-- frontend/src/lib/analyticsUtils.ts (calculateOverallStats):
--     a session contributes to the clarity average ONLY when `sessionMetrics.isClarityScorable`;
--     the average is totalClarity / clarityContributors, and is `null` when there are no contributors.
--     Delivery clarity is `clarity_score` ONLY — the STT `accuracy` column is a transcription-quality
--     measure, is NOT clarity, and the client never substitutes it. The previous `accuracy * 100`
--     fallback is removed here for the same reason.
--     averageWPM   = round(totalWords / totalMinutes), null unless BOTH words > 0 and minutes > 0.
--     fillerRate   = fillers / minutes,                null unless BOTH words > 0 and duration > 0.
--
-- Server-side mirror of the clarity contributor rule, using the columns this function can see:
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
-- NO-EVIDENCE VALUES: the previous `ELSE '0.0'` / `ELSE 0` fallbacks are part of the defect and are
-- replaced with SQL NULL (JSON null). Zero is a measurement; absence is not.
--
-- THE TWO SERIES ARE FIXED TOO — no fabricated point survives anywhere in this function:
--   chartData.clarity     Previously fabricated a PERFECT 100 for a session with no clarity and no
--                         duration, and derived clarity from filler rate alone when duration > 0. Now
--                         NULL (an omitted
--                         point) unless the session satisfies the same clarity contributor rule as the
--                         aggregate — never 0, never 100, and no substitute formula. Series DESIGN
--                         remains owned by TEMP-PR-06; this only removes fabrication.
--   accuracyData.accuracy Previously served `coalesce(clarity_score, accuracy * 100)` under a key named
--                         `accuracy`, i.e. delivery clarity presented as transcription accuracy — the
--                         mirror image of the clarity fallback removed above. Now the real `accuracy`
--                         measurement only; sessions lacking it are omitted from the series.
--
-- ===================================================================================================
-- SECURITY — SEPARATE FINDING, SEPARATE AUTHORIZATION LINE.
--
-- This section is a distinct defect from the analytics-evidence work above. It is included in the same
-- migration only because this migration REPLACES get_analytics_summary, and shipping a replacement that
-- knowingly reinstated the defective guard would be incoherent. It must be reviewed, and authorized, on
-- its own line — not absorbed into the analytics fix.
--
-- THE DEFECT — a null-unsafe authorization guard with confirmed anon reachability.
--   1. `IF p_user_id != auth.uid() THEN RAISE` evaluates to NULL, not TRUE, when auth.uid() is NULL (no
--      JWT, or a token carrying no `sub` claim). The RAISE therefore never fired.
--   2. The function is SECURITY DEFINER, so its body is not constrained by the RLS policy on
--      public.sessions. That guard was the ONLY barrier.
--   3. EXECUTE was available to PUBLIC — never revoked — and `anon` holds USAGE on schema public.
--
-- EVIDENCE, and its limits. Anon-role EXECUTE against production is CONFIRMED: a request carrying only
-- the browser-visible publishable key and NO user JWT returned HTTP 200 with an analytics payload. That
-- probe used the nil UUID, which owns no rows, so CROSS-TENANT DATA DISCLOSURE IS NOT PROVEN against
-- production and must not be described as a demonstrated exploit. What IS proven — in a disposable local
-- PostgreSQL seeded with synthetic rows, against the superseded definition read verbatim from this repo —
-- is the MECHANISM: an unidentified caller receives another user's aggregates
-- (tests/db/analytics-summary-security.integration.test.ts). service_role is already a privileged
-- credential; nothing it can do is characterised here as an ordinary-user exploit.
--
-- THE CONTRACT IS OWNED BY #1096 (20260729120000). This migration is dated after it and reissues the
-- same function, so it reproduces #1096's controls VERBATIM and adds only evidence-validity changes:
--   a. null-safe guard `auth.uid() IS NULL OR p_user_id IS NULL OR p_user_id <> auth.uid()` (from #1096);
--   b. REVOKE EXECUTE FROM PUBLIC and FROM anon, EXECUTE to `authenticated`/`service_role` (from #1096);
--   c. `SET search_path = public, pg_temp` (from #1096) — critical, since this later migration would
--      otherwise revert #1096's search_path fix.
-- This PR does NOT re-decide any of the above; it consumes them.
--
-- The other SECURITY DEFINER functions lacking a REVOKE ... FROM PUBLIC are owned by #1097 and are
-- deliberately NOT touched here.
-- ===================================================================================================
--
-- Rollback: re-run 20260522110000_cleanup_stale_schema_lint.sql to restore the previous (defective)
-- body. This migration changes only a function definition — no table, column, index, or row is touched,
-- and no data can be lost by it.

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
            CASE WHEN duration > 0 THEN (fw_count / (duration / 60.0))::numeric(10,2)::text ELSE '0.00' END as "FW/min",
            CASE
                WHEN clarity_score IS NOT NULL
                 AND coalesce(total_words, 0) >= c_min_reliable_scoring_words
                    THEN clarity_score
                ELSE NULL
            END as clarity
        FROM (
            SELECT
                s.created_at,
                s.duration,
                s.clarity_score,
                s.total_words,
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
