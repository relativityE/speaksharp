-- #1306 STAGE B — POST-DEPLOY ENFORCEMENT + FINAL SCHEMA. Apply ONLY AFTER the metrics-only frontend (uses the
-- new complete_session exclusively, reads no content columns) is deployed. Applying B before that would break
-- the running app.
--
-- Authorized sequence: [Stage A] -> deploy metrics-only frontend -> (optional separately-authorized SCRUB that
-- HARD-DELETES legacy session/issue-report rows — counts only, never reads/backfills content) -> [B here].
--
-- Safety: NO `DROP ... CASCADE`. Known dependencies are removed EXPLICITLY, then columns are dropped without
-- CASCADE, so any UNEXPECTED dependency (view/policy/generated column) fails the migration CLOSED instead of
-- being silently removed.
--
-- No PAIRED ROLLBACK for the column drops — this is the terminal metrics-only schema.

-- 0) CONTENT-FREE PREFLIGHT: after B, a completed session must carry a next action. If any EXISTING
--    completed row (e.g. a legacy canary/test session) lacks one, fail closed and require the authorized scrub
--    first. Counts only — never reads transcript/content.
DO $$
DECLARE v_bad bigint;
BEGIN
    SELECT count(*) INTO v_bad FROM public.sessions WHERE status = 'completed' AND next_action_signal IS NULL;
    IF v_bad > 0 THEN
        RAISE EXCEPTION '#1306 Stage B preflight: % completed session row(s) lack next_action_signal — run the authorized content-free scrub (hard-delete legacy rows) before Stage B', v_bad
            USING ERRCODE = '23514';
    END IF;
END $$;

-- 1) Remove the legacy transcript-accepting RPCs (the transcript-free overload from Stage A remains).
DROP FUNCTION IF EXISTS public.complete_session(uuid, text, text, integer, text);
DROP FUNCTION IF EXISTS public.save_session(jsonb);

-- 2) Retire the transcript-retention machinery (its functions reference the columns dropped below).
DROP FUNCTION IF EXISTS public.transcript_retention_preflight(text, uuid, text);
DROP FUNCTION IF EXISTS public.converge_transcript_retention(uuid);
DROP FUNCTION IF EXISTS public.expire_transcripts_newest_two(uuid, integer);
DROP FUNCTION IF EXISTS public.transcript_sessions_to_expire(uuid);
DROP FUNCTION IF EXISTS public.transcript_retention_invariant_violations(uuid);
DROP FUNCTION IF EXISTS public.transcript_retention_policy_version();

-- 3) Remove the #1131 transcript_state derivation + its CHECK constraints (hard dependencies on `transcript`).
DROP TRIGGER IF EXISTS trg_sessions_set_transcript_state ON public.sessions;
DROP FUNCTION IF EXISTS public.sessions_set_transcript_state();
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_transcript_state_check;
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_expired_transcript_null_check;

-- 3.5) REPOINT ANALYTICS to the strict flat `filler_counts`, retiring the unconstrained `filler_words` and the
--      transcript-provenance gate. Recreated BEFORE the column drops below so the live function never references
--      a dropped column. Semantics (PO forward-only clean reset): filler analytics + cross-session comparison
--      REMAIN, sourced from flat `{key:number}` counts; provenance is now METRIC PRESENCE (a row contributes to
--      a rate iff it actually persists that metric) — the retired `transcript_state`/`not_captured` sentinel no
--      longer gates aggregates. The STT-accuracy series is retired with the `accuracy` column (accuracy is
--      benchmark-only, never a customer row), so `accuracyData` is always an empty series.

-- Flat-shape validated filler total for ONE session: sum of the standard-key numeric counts. NULL when the row
-- carries no valid filler evidence (null / non-object / empty / no numeric value), so callers EXCLUDE the row
-- rather than invent a 0. Non-negative integers up to 9 digits (the regex guards the cast, overflow-safe bigint).
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

-- 4) FINAL SCHEMA: drop the content-bearing columns WITHOUT cascade. Any remaining unexpected dependency
--    raises here (fail-closed) rather than being silently dropped.
ALTER TABLE public.sessions DROP COLUMN IF EXISTS transcript;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS ai_suggestions;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS ground_truth;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS accuracy;
ALTER TABLE public.user_issue_reports DROP COLUMN IF EXISTS transcript_excerpt;
-- The loosely-typed filler tally is replaced by the strict-key `filler_counts` (added in Stage A). `custom_words`
-- moves to dedicated account-level preference storage and is never persisted per session. Both dropped WITHOUT
-- cascade so any unexpected dependency fails closed.
ALTER TABLE public.sessions DROP COLUMN IF EXISTS filler_words;
ALTER TABLE public.sessions DROP COLUMN IF EXISTS custom_words;

-- 5) FIELD-LEVEL PROSE FIREWALL. Every retained TEXT/JSONB customer-session field is pinned to an exact
--    operational schema so arbitrary prose can never be smuggled through a nominally-numeric field:
--      * a COMPLETED session must carry exactly one structured next action (incomplete/failed may be null);
--      * status                -> lifecycle enum;
--      * status_reason         -> known reason code or null (never free-form text);
--      * filler_counts         -> standard filler identifiers only, each a non-negative finite number;
--      * pause_metrics         -> approved aggregate keys only, each a non-negative finite number.
--    (next_action_signal object validity is enforced by the Stage-A shape CHECK; this backstops every writer.)
CREATE OR REPLACE FUNCTION public.validate_session_metrics_only_1306()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  k text; v jsonb;
BEGIN
  IF NEW.status = 'completed' AND NEW.next_action_signal IS NULL THEN
    RAISE EXCEPTION '#1306: a completed session requires exactly one structured next action'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('active','completed','failed') THEN
    RAISE EXCEPTION '#1306: status must be one of active|completed|failed' USING ERRCODE = '23514';
  END IF;

  IF NEW.status_reason IS NOT NULL
     AND NEW.status_reason NOT IN ('user_stopped','auto_stopped','time_limit','silence_timeout','error') THEN
    RAISE EXCEPTION '#1306: status_reason must be a known reason code or null (no free-form text)'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.filler_counts IS NOT NULL THEN
    IF jsonb_typeof(NEW.filler_counts) <> 'object' THEN
      RAISE EXCEPTION '#1306: filler_counts must be a numeric-keyed object' USING ERRCODE = '23514';
    END IF;
    -- Canonical snake_case filler identifiers, mapped 1:1 from the app's FILLER_WORD_KEYS display forms
    -- ('You Know'->you_know, 'I Mean'->i_mean, 'Kind Of'->kind_of, 'Sort Of'->sort_of). No 'total', no custom
    -- words, no free-form keys.
    IF (NEW.filler_counts - array['um','uh','ah','like','you_know','so','actually','oh','i_mean','basically','literally','kind_of','sort_of']) <> '{}'::jsonb THEN
      RAISE EXCEPTION '#1306: filler_counts has unknown/custom keys (standard filler identifiers only)'
        USING ERRCODE = '23514';
    END IF;
    FOR k, v IN SELECT * FROM jsonb_each(NEW.filler_counts) LOOP
      IF jsonb_typeof(v) <> 'number' OR (v::text)::numeric < 0 THEN
        RAISE EXCEPTION '#1306: filler_counts values must be non-negative finite numbers (key %)', k
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  IF NEW.pause_metrics IS NOT NULL THEN
    IF jsonb_typeof(NEW.pause_metrics) <> 'object' THEN
      RAISE EXCEPTION '#1306: pause_metrics must be a numeric-keyed object' USING ERRCODE = '23514';
    END IF;
    IF (NEW.pause_metrics - array['totalPauses','averagePauseDuration','longestPause','pausesPerMinute','silencePercentage','transitionPauses','extendedPauses']) <> '{}'::jsonb THEN
      RAISE EXCEPTION '#1306: pause_metrics has unknown keys (approved aggregate pause fields only)'
        USING ERRCODE = '23514';
    END IF;
    FOR k, v IN SELECT * FROM jsonb_each(NEW.pause_metrics) LOOP
      IF jsonb_typeof(v) <> 'number' OR (v::text)::numeric < 0 THEN
        RAISE EXCEPTION '#1306: pause_metrics values must be non-negative finite numbers (key %)', k
          USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;

  -- APP-SET OPERATIONAL METADATA: written by the app, never by the user, never derived from transcript.
  -- STRUCTURALLY constrained (a single-line length cap still permits prose): title is pinned to the exact
  -- app-generated `Session <ISO-8601>` format; engine/device_type/attribution_status/transcript_state are
  -- exact enums; engine_version/model_name are strict machine-token patterns (no spaces → no prose).
  IF NEW.title IS NOT NULL
     AND NEW.title !~ '^Session [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION '#1306: title must be the app-generated "Session <ISO-8601>" format (no user input/prose)' USING ERRCODE = '23514';
  END IF;
  IF NEW.engine IS NOT NULL AND NEW.engine NOT IN ('native','private','cloud','unknown') THEN
    RAISE EXCEPTION '#1306: engine must be one of native|private|cloud|unknown' USING ERRCODE = '23514';
  END IF;
  IF NEW.device_type IS NOT NULL AND NEW.device_type NOT IN ('browser','cloud','unknown') THEN
    RAISE EXCEPTION '#1306: device_type must be one of browser|cloud|unknown' USING ERRCODE = '23514';
  END IF;
  IF NEW.engine_version IS NOT NULL AND NEW.engine_version !~ '^[A-Za-z0-9._-]{1,64}$' THEN
    RAISE EXCEPTION '#1306: engine_version must be a machine token [A-Za-z0-9._-] <= 64 chars' USING ERRCODE = '23514';
  END IF;
  IF NEW.model_name IS NOT NULL AND NEW.model_name !~ '^[A-Za-z0-9._/-]{1,80}$' THEN
    RAISE EXCEPTION '#1306: model_name must be a machine token [A-Za-z0-9._/-] <= 80 chars' USING ERRCODE = '23514';
  END IF;
  IF NEW.attribution_status IS NOT NULL
     AND NEW.attribution_status NOT IN ('legacy_unknown','pending','verified','unverified') THEN
    RAISE EXCEPTION '#1306: attribution_status must be a known code or null' USING ERRCODE = '23514';
  END IF;
  IF NEW.transcript_state IS NOT NULL
     AND NEW.transcript_state NOT IN ('available','expired','not_captured') THEN
    RAISE EXCEPTION '#1306: transcript_state must be a known code or null' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_require_next_action ON public.sessions;
DROP TRIGGER IF EXISTS trg_sessions_validate_metrics_only ON public.sessions;
CREATE TRIGGER trg_sessions_validate_metrics_only
  BEFORE INSERT OR UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.validate_session_metrics_only_1306();
