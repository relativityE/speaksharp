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
--
-- ROLLBACK: revoke + DROP the two functions. RETAIN the nullable `user_profiles.timezone` column and
-- any timezone values users have populated — dropping it is data loss. The column is inert without the
-- functions (nothing reads or writes it), so leaving it is safe. Only DROP the column BEFORE any user
-- has written a timezone, and only with explicit proof it is empty and separate authorization.

-- ---------------------------------------------------------------------------------------------------
-- 1. Persisted account-level timezone (nullable; the only stored field).
-- ---------------------------------------------------------------------------------------------------
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.user_profiles.timezone IS
  'Account-level IANA timezone for the practice streak. NULL until initialized once from the '
  'authenticated browser. Never silently changed; validated against pg_timezone_names on write.';

-- ---------------------------------------------------------------------------------------------------
-- 2. Initialize-ONCE authenticated timezone setter.
--    SECURITY DEFINER — REQUIRED. Production (20260522090000_harden_runtime_billing_invariants) replaced
--    the user_profiles `FOR ALL` policy with a SELECT-only policy so authenticated users can NOT update
--    their own profile directly (that protects billing/entitlement fields). A SECURITY INVOKER setter
--    would therefore update ZERO rows in production. This DEFINER function runs as the owner (which can
--    write the row) but is tightly scoped so it is not a privilege escalation:
--      * requires a non-null auth.uid() (no anonymous / null-identity write);
--      * touches ONLY the caller's own row (`WHERE id = auth.uid()`) — never another user's;
--      * sets ONLY the `timezone` column — never subscription_status or any entitlement/billing field;
--      * writes ONLY while the stored value is NULL (initialize-once — never a silent change);
--      * validates against pg_timezone_names; invalid/NULL is a no-op returning the current value;
--      * SET search_path = public, pg_temp (pg_temp explicit + last, so a temp object cannot shadow it);
--      * PUBLIC/anon EXECUTE revoked below.
--    This is the SAME pattern the codebase already uses to mutate user_profiles safely (update_user_usage,
--    process_stripe_webhook_event): a scoped DEFINER function, never a broad UPDATE policy.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_timezone(p_timezone text)
RETURNS text                    -- the effective stored timezone after the call (NULL if none/invalid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    -- Invalid or NULL timezone: write nothing, report the current stored value (may be NULL).
    IF p_timezone IS NULL OR p_timezone NOT IN (SELECT name FROM pg_timezone_names) THEN
        RETURN (SELECT timezone FROM public.user_profiles WHERE id = v_uid);
    END IF;

    -- Own row only; timezone column only; initialize-once (`timezone IS NULL`) so an established value
    -- is never overwritten. No other column can be reached through this function.
    UPDATE public.user_profiles
       SET timezone = p_timezone
     WHERE id = v_uid
       AND timezone IS NULL;

    RETURN (SELECT timezone FROM public.user_profiles WHERE id = v_uid);
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
          -- Only FINISHED sessions count. `status` (20260309000000) is one of active/completed/expired/
          -- failed; a streak must not be built from an in-progress ('active'), abandoned/expired, or
          -- 'failed' recording. Only 'completed' is a durably finished session.
          AND status = 'completed'
          AND COALESCE(total_words, 0) >= 25
          -- Clamp to today's local date. `sessions` is user-writable (RLS FOR ALL), so without this a
          -- caller could post a future-dated row and anchor an "active" streak on a day that has not
          -- happened. Cross-device CONSISTENCY hardening, not anti-cheat: a user can still forge past
          -- rows on their OWN streak (see header). It cannot affect any OTHER user.
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
