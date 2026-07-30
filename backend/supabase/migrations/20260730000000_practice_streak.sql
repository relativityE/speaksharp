-- #1093 prerequisite — server-authoritative practice streak (derive-on-read).
--
-- Ships INDEPENDENTLY of the Home UI. Adds exactly three things, all bounded:
--   1. a NULLABLE account-level IANA timezone on user_profiles (the ONLY thing persisted);
--   2. an authenticated, initialize-ONCE timezone setter;
--   3. a derive-on-read streak RPC that takes NO caller-supplied user id.
--
-- WHY server-authoritative + persisted timezone (settled with the Product Owner):
--   * The streak COUNT is never stored — a mutable counter would drift from the real sessions. It is
--     always derived on read from durably saved sessions, so there is one source of truth.
--   * The timezone IS persisted, once, per account. A per-call timezone (or a UTC fallback) would make
--     the SAME account's streak change across devices or while travelling, and could present a
--     confidently wrong count. A null/invalid timezone is surfaced honestly as "Streak unavailable",
--     never hidden and never silently defaulted.
--
-- Qualifying day (v1): a local calendar day on which at least one durably saved session reached the
-- 25-word directional-evidence floor (MIN_WORDS_FOR_DIRECTIONAL = 25). Multiple qualifying sessions on
-- one local day count ONCE. An active streak is anchored on today or yesterday (in the account tz),
-- else it is lapsed. No 60-second speech threshold — the product measures recording, not speech.
--
-- SCOPE OF "server-authoritative": this buys ONE account, ONE streak, consistent across the user's
-- devices — the count is computed on the server from durably saved sessions, not a per-device client
-- guess. It is NOT anti-cheat: `public.sessions` is user-writable under its FOR ALL RLS policy, so a
-- determined user can forge rows to inflate their OWN streak. That is an accepted, isolated risk — the
-- functions can never read, mutate, or inflate ANY OTHER user's streak (SECURITY INVOKER + RLS + an
-- explicit auth.uid() predicate on every access). Future-dated rows are clamped out (see the reader).
--
-- INVARIANT: every authenticated user has a user_profiles row (created at signup by the
-- `on_auth_user_created_trial_profile` trigger, migration 20260521100000). A user without one — a
-- pre-trigger legacy account — reads as `unavailable` (fail-safe: no leak, no crash), and the setter
-- below simply no-ops for them; it never fabricates a row.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR. Requires separate Product Owner migration approval.

-- ---------------------------------------------------------------------------------------------------
-- 1. Persisted account-level timezone (nullable; the only stored field).
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.user_profiles.timezone IS
  'Account-level IANA timezone for the practice streak. NULL until initialized once from the '
  'authenticated browser. Never silently changed; validated against pg_timezone_names on write.';

-- ---------------------------------------------------------------------------------------------------
-- 2. Initialize-ONCE authenticated timezone setter.
--    SECURITY INVOKER: runs as the caller, so RLS on user_profiles confines the write to the caller's
--    own row. Identity comes from auth.uid() — there is NO caller-supplied user id. It writes only when
--    the stored timezone is still NULL, so it can never silently change an established value.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_timezone(p_timezone text)
RETURNS text                    -- the effective stored timezone after the call (NULL if none/invalid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Invalid or NULL timezone: write nothing, report the current stored value (may be NULL).
    IF p_timezone IS NULL OR p_timezone NOT IN (SELECT name FROM pg_timezone_names) THEN
        RETURN (SELECT timezone FROM public.user_profiles WHERE id = auth.uid());
    END IF;

    -- Initialize ONCE. `timezone IS NULL` guarantees an established value is never overwritten here.
    UPDATE public.user_profiles
       SET timezone = p_timezone
     WHERE id = auth.uid()
       AND timezone IS NULL;

    RETURN (SELECT timezone FROM public.user_profiles WHERE id = auth.uid());
END;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Derive-on-read streak RPC. No parameters (no caller-supplied user id). SECURITY INVOKER, so RLS
--    on user_profiles AND sessions confines every read to the caller's own rows — the function cannot
--    return another user's streak, and it needs no in-body ownership guard because RLS enforces it.
--    Returns { state, count, lastQualifyingDate, timezone }:
--      state = 'unavailable'  -> timezone NULL or invalid (Home shows "Streak unavailable")
--      state = 'none'         -> no qualifying sessions, or the streak has lapsed ("Start your streak")
--      state = 'active'       -> count >= 1, anchored on today/yesterday ("1-day"/"N-day streak")
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_practice_streak()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_tz     text;
    v_today  date;
    v_anchor date;
    v_count  int;
BEGIN
    SELECT timezone INTO v_tz FROM public.user_profiles WHERE id = auth.uid();

    IF v_tz IS NULL OR v_tz NOT IN (SELECT name FROM pg_timezone_names) THEN
        RETURN jsonb_build_object(
            'state', 'unavailable', 'count', 0, 'lastQualifyingDate', NULL, 'timezone', v_tz);
    END IF;

    v_today := (now() AT TIME ZONE v_tz)::date;

    -- Distinct local qualifying days -> gaps-and-islands. The most recent contiguous run (max end date)
    -- is the current streak candidate; a calendar gap starts a new island and breaks the streak.
    WITH q AS (
        SELECT DISTINCT ((created_at AT TIME ZONE v_tz)::date) AS d
        FROM public.sessions
        WHERE user_id = auth.uid()
          AND COALESCE(total_words, 0) >= 25
          -- Clamp to today's local date. `sessions` is user-writable (RLS is FOR ALL), so without this
          -- a caller could post a future-dated row and anchor an "active" streak on a day that has not
          -- happened. This is cross-device CONSISTENCY hardening, not anti-cheat: a determined user can
          -- still forge past rows on their OWN streak (see header). It cannot affect any OTHER user.
          AND (created_at AT TIME ZONE v_tz)::date <= v_today
    ),
    islands AS (
        SELECT d, (d - ((row_number() OVER (ORDER BY d)) * INTERVAL '1 day'))::date AS grp
        FROM q
    ),
    sized AS (
        SELECT grp, COUNT(*)::int AS cnt, MAX(d) AS mx
        FROM islands
        GROUP BY grp
    )
    SELECT cnt, mx INTO v_count, v_anchor
    FROM sized
    ORDER BY mx DESC
    LIMIT 1;

    IF v_anchor IS NULL THEN
        RETURN jsonb_build_object(
            'state', 'none', 'count', 0, 'lastQualifyingDate', NULL, 'timezone', v_tz);
    END IF;

    -- Active only if the run reaches today or yesterday; otherwise the streak has lapsed.
    IF v_anchor >= v_today - 1 THEN
        RETURN jsonb_build_object(
            'state', 'active', 'count', v_count,
            'lastQualifyingDate', to_char(v_anchor, 'YYYY-MM-DD'), 'timezone', v_tz);
    END IF;

    RETURN jsonb_build_object(
        'state', 'none', 'count', 0,
        'lastQualifyingDate', to_char(v_anchor, 'YYYY-MM-DD'), 'timezone', v_tz);
END;
$$;

-- ---------------------------------------------------------------------------------------------------
-- PRIVILEGES — least privilege. Both functions are customer-facing and derive identity from auth.uid();
-- neither is reachable by an unauthenticated PostgREST caller. Idempotent / safe to re-run.
-- ---------------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.set_user_timezone(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_timezone(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.set_user_timezone(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_practice_streak() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_practice_streak() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_practice_streak() TO authenticated;
