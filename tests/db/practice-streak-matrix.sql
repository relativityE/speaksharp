-- Portable proof matrix for the practice-streak functions. Pure SQL, runnable by psql against ANY
-- PostgreSQL on the major version production runs. Every check RAISEs on failure; use -v ON_ERROR_STOP=1.
-- Run against a DISPOSABLE database only. Expects the bootstrap + the migration applied first.
-- Content-free: synthetic UUIDs only.

\set ON_ERROR_STOP on

\echo '=== server under test ==='
SELECT version();

-- Fixtures: a victim and an unrelated other user.
INSERT INTO auth.users (id) VALUES
    ('11111111-1111-4111-8111-111111111111'),
    ('22222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_profiles (id) VALUES
    ('11111111-1111-4111-8111-111111111111'),
    ('22222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;

-- The app role PostgREST switches into.
GRANT authenticated TO CURRENT_USER;
GRANT anon TO CURRENT_USER;

\echo '=== effective EXECUTE grants (expect: authenticated only; NOT anon/PUBLIC) ==='
SELECT g.routine_name, g.grantee
FROM information_schema.role_routine_grants g
WHERE g.routine_name IN ('get_practice_streak', 'set_user_timezone') AND g.privilege_type = 'EXECUTE'
ORDER BY 1, 2;

-- Seed helper: one session for `who` at local NOON on local date `d` (DST-safe: noon never lands on a
-- skipped/duplicated wall-clock hour), with `words` total_words. Called while role is the superuser, so
-- inserts bypass RLS for setup only; every read below goes through authenticated + RLS.
CREATE PROCEDURE pg_temp.seed(who uuid, d date, words int, st text DEFAULT 'completed')
LANGUAGE plpgsql AS $seed$
BEGIN
    INSERT INTO public.sessions (user_id, total_words, status, created_at)
    VALUES (who, words, st, (d + time '12:00') AT TIME ZONE 'America/New_York');
END;
$seed$;

DO $matrix$
DECLARE
    v_victim   uuid := '11111111-1111-4111-8111-111111111111';
    v_other    uuid := '22222222-2222-4222-8222-222222222222';
    v_tz       text := 'America/New_York';
    v_res      jsonb;
    v_ok       boolean;
    v_today    date;
BEGIN
    -- ---- 0. preconditions -----------------------------------------------------------------------
    -- Reader is INVOKER (RLS confines reads to the caller); setter is DEFINER (must write under the
    -- production SELECT-only profile policy, but tightly scoped — proven by item 15).
    IF (SELECT prosecdef FROM pg_proc WHERE proname = 'get_practice_streak') THEN
        RAISE EXCEPTION 'PRECONDITION: get_practice_streak must be SECURITY INVOKER, not DEFINER';
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'set_user_timezone') THEN
        RAISE EXCEPTION 'PRECONDITION: set_user_timezone must be SECURITY DEFINER (writes under SELECT-only RLS)';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sessions'::regclass)
       OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_profiles'::regclass) THEN
        RAISE EXCEPTION 'PRECONDITION: RLS must be enabled on sessions AND user_profiles';
    END IF;
    -- search_path pins pg_temp explicitly and last, on both functions.
    IF (SELECT count(*) FROM pg_proc
        WHERE proname IN ('get_practice_streak','set_user_timezone')
          AND array_to_string(proconfig,',') LIKE '%search_path=public, pg_temp%') <> 2 THEN
        RAISE EXCEPTION 'PRECONDITION: both functions must SET search_path = public, pg_temp';
    END IF;
    RAISE NOTICE 'PASS 0  SECURITY INVOKER, RLS on both tables, safe search_path on both functions';

    -- ---- 1. anon cannot execute either function (PUBLIC/anon revoked) ----------------------------
    IF has_function_privilege('anon', 'public.get_practice_streak()', 'EXECUTE')
       OR has_function_privilege('anon', 'public.set_user_timezone(text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 1: anon holds EXECUTE — a PUBLIC/anon grant was not revoked';
    END IF;
    v_ok := false;
    BEGIN
        SET LOCAL ROLE anon;
        PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
        PERFORM public.get_practice_streak();
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 1: anon executed get_practice_streak'; END IF;
    RAISE NOTICE 'PASS 1  anon cannot execute either function (privilege denied)';

    -- ---- 2. setter is authenticated-only and initializes ONCE -----------------------------------
    v_ok := false;
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claim.sub', '', true);   -- no identity
        PERFORM public.set_user_timezone('America/New_York');
    EXCEPTION WHEN insufficient_privilege OR raise_exception THEN v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 2: setter did not reject a null identity'; END IF;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    IF public.set_user_timezone('America/New_York') <> 'America/New_York' THEN
        RAISE EXCEPTION 'FAIL 2: first set did not persist America/New_York';
    END IF;
    -- second call must NOT overwrite the established value
    IF public.set_user_timezone('Asia/Tokyo') <> 'America/New_York' THEN
        RAISE EXCEPTION 'FAIL 2: setter silently changed an established timezone';
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 2  setter: auth-only, initializes once, never silently overwrites';

    -- ---- 3. invalid / null timezone -> "unavailable" --------------------------------------------
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);  -- v_other tz still NULL
    v_res := public.get_practice_streak();
    IF v_res->>'state' <> 'unavailable' THEN
        RAISE EXCEPTION 'FAIL 3: NULL timezone did not yield "unavailable" (got %)', v_res;
    END IF;
    -- a stored-but-invalid tz (forced directly) also reads as unavailable, never a silent default
    RESET ROLE;
    UPDATE public.user_profiles SET timezone = 'Not/AZone' WHERE id = v_other;
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    IF public.get_practice_streak()->>'state' <> 'unavailable' THEN
        RAISE EXCEPTION 'FAIL 3: invalid stored timezone did not yield "unavailable"';
    END IF;
    RESET ROLE;
    UPDATE public.user_profiles SET timezone = NULL WHERE id = v_other;
    RAISE NOTICE 'PASS 3  null and invalid timezone both surface "unavailable"';

    -- Helper to read the victim's streak as the authenticated victim.
    -- (inlined below via SET ROLE; v_today is the victim's local "today")
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_today := (now() AT TIME ZONE v_tz)::date;
    RESET ROLE;

    -- ---- 4. no qualifying sessions -> "none" ----------------------------------------------------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    IF public.get_practice_streak()->>'state' <> 'none' THEN
        RAISE EXCEPTION 'FAIL 4: empty history was not "none"';
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 4  no qualifying sessions -> none';

    -- ---- 5. 25-word eligibility floor -----------------------------------------------------------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today, 24);   -- below floor
    CALL pg_temp.seed(v_victim, v_today, NULL); -- null words
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    IF public.get_practice_streak()->>'state' <> 'none' THEN
        RAISE EXCEPTION 'FAIL 5: sub-floor / null-word sessions counted as a streak';
    END IF;
    RESET ROLE;
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today, 25);   -- exactly the floor qualifies
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_res := public.get_practice_streak();
    IF v_res->>'state' <> 'active' OR (v_res->>'count')::int <> 1 THEN
        RAISE EXCEPTION 'FAIL 5: exactly 25 words did not yield an active 1-day streak (got %)', v_res;
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 5  eligibility: 24/NULL excluded, exactly 25 included';

    -- ---- 6. duplicate same-day sessions count ONCE ----------------------------------------------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today, 30);
    CALL pg_temp.seed(v_victim, v_today, 40);   -- same local day
    CALL pg_temp.seed(v_victim, v_today - 1, 30);
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_res := public.get_practice_streak();
    IF (v_res->>'count')::int <> 2 THEN
        RAISE EXCEPTION 'FAIL 6: duplicate same-day sessions inflated the count (got %)', v_res;
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 6  multiple sessions on one local day count once (2-day streak)';

    -- ---- 7. many consecutive days, anchored today -> active N -----------------------------------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today, 30);
    CALL pg_temp.seed(v_victim, v_today - 1, 30);
    CALL pg_temp.seed(v_victim, v_today - 2, 30);
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_res := public.get_practice_streak();
    IF v_res->>'state' <> 'active' OR (v_res->>'count')::int <> 3 THEN
        RAISE EXCEPTION 'FAIL 7: 3 consecutive days did not yield active count 3 (got %)', v_res;
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 7  three consecutive days incl. today -> active, count 3';

    -- ---- 8. anchored YESTERDAY is still active (grace day) ---------------------------------------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today - 1, 30);
    CALL pg_temp.seed(v_victim, v_today - 2, 30);
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_res := public.get_practice_streak();
    IF v_res->>'state' <> 'active' OR (v_res->>'count')::int <> 2 THEN
        RAISE EXCEPTION 'FAIL 8: a streak ending yesterday should still be active (got %)', v_res;
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 8  streak ending yesterday is still active (grace day)';

    -- ---- 9. a calendar gap BREAKS the streak; a stale run is "none" (lapsed) ---------------------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today, 30);       -- today
    CALL pg_temp.seed(v_victim, v_today - 2, 30);    -- gap at yesterday
    CALL pg_temp.seed(v_victim, v_today - 3, 30);
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_res := public.get_practice_streak();
    IF v_res->>'state' <> 'active' OR (v_res->>'count')::int <> 1 THEN
        RAISE EXCEPTION 'FAIL 9a: a gap did not reset the current run to 1 (got %)', v_res;
    END IF;
    RESET ROLE;
    -- most recent qualifying day is 3 days ago -> lapsed -> none
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today - 3, 30);
    CALL pg_temp.seed(v_victim, v_today - 4, 30);
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_res := public.get_practice_streak();
    IF v_res->>'state' <> 'none' THEN
        RAISE EXCEPTION 'FAIL 9b: a run that ended 3 days ago should be lapsed/none (got %)', v_res;
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 9  a gap breaks the streak; a stale run lapses to none';

    -- ---- 10. cross-user isolation: another user's sessions never count ---------------------------
    DELETE FROM public.sessions WHERE user_id IN (v_victim, v_other);
    CALL pg_temp.seed(v_other, v_today, 500);       -- lots of qualifying activity for the OTHER user
    CALL pg_temp.seed(v_other, v_today - 1, 500);
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    IF public.get_practice_streak()->>'state' <> 'none' THEN
        RAISE EXCEPTION 'FAIL 10: another user''s sessions leaked into this streak';
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 10  RLS/INVOKER: another user''s sessions never count';

    -- ---- 11. DST boundary: local dates stay correct across a spring-forward ----------------------
    -- 2026-03-08 is the US spring-forward (02:00 -> 03:00 in America/New_York). Noon-seeded sessions on
    -- Mar 7/8/9 must resolve to three DISTINCT consecutive local dates despite the 23-hour day.
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, DATE '2026-03-07', 30);
    CALL pg_temp.seed(v_victim, DATE '2026-03-08', 30);
    CALL pg_temp.seed(v_victim, DATE '2026-03-09', 30);
    IF (SELECT count(DISTINCT (created_at AT TIME ZONE v_tz)::date)
        FROM public.sessions WHERE user_id = v_victim) <> 3 THEN
        RAISE EXCEPTION 'FAIL 11: DST day collapsed two local dates into one';
    END IF;
    DELETE FROM public.sessions WHERE user_id = v_victim;
    RAISE NOTICE 'PASS 11  DST spring-forward preserves distinct consecutive local dates';

    -- ---- 12. a FUTURE-dated session is clamped out (cannot anchor an active streak) --------------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today, 30);        -- real: today
    CALL pg_temp.seed(v_victim, v_today + 1, 30);     -- forged: tomorrow (local)
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_res := public.get_practice_streak();
    IF v_res->>'state' <> 'active' OR (v_res->>'count')::int <> 1
       OR v_res->>'lastQualifyingDate' <> to_char(v_today, 'YYYY-MM-DD') THEN
        RAISE EXCEPTION 'FAIL 12: a future-dated session was not clamped out (got %)', v_res;
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 12  future-dated sessions are clamped out (no future anchor)';

    -- ---- 13. active result reports the correct lastQualifyingDate AND timezone -------------------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today, 30);
    CALL pg_temp.seed(v_victim, v_today - 1, 30);
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_res := public.get_practice_streak();
    IF v_res->>'timezone' <> v_tz
       OR v_res->>'lastQualifyingDate' <> to_char(v_today, 'YYYY-MM-DD')
       OR (v_res->>'count')::int <> 2 THEN
        RAISE EXCEPTION 'FAIL 13: active output fields wrong (got %)', v_res;
    END IF;
    RESET ROLE;
    DELETE FROM public.sessions WHERE user_id = v_victim;
    RAISE NOTICE 'PASS 13  active result reports correct lastQualifyingDate + timezone';

    -- ---- 14. ONLY status='completed' counts (active / failed / expired never build a streak) ------
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today,     30, 'active');
    CALL pg_temp.seed(v_victim, v_today - 1, 30, 'failed');
    CALL pg_temp.seed(v_victim, v_today - 2, 30, 'expired');
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    IF public.get_practice_streak()->>'state' <> 'none' THEN
        RAISE EXCEPTION 'FAIL 14: active/failed/expired sessions built a streak';
    END IF;
    RESET ROLE;
    DELETE FROM public.sessions WHERE user_id = v_victim;
    CALL pg_temp.seed(v_victim, v_today, 30, 'completed');
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    IF public.get_practice_streak()->>'state' <> 'active' THEN
        RAISE EXCEPTION 'FAIL 14: a completed session did not count';
    END IF;
    RESET ROLE;
    DELETE FROM public.sessions WHERE user_id = v_victim;
    RAISE NOTICE 'PASS 14  only completed sessions count (active/failed/expired excluded)';

    -- ---- 15. production RLS: authenticated cannot write user_profiles directly; timezone ONLY via the
    --         DEFINER setter, and no entitlement field is reachable. Proves the setter works under the
    --         SELECT-only policy AND that it is not a write-anything escalation. --------------------
    UPDATE public.user_profiles SET timezone = NULL, subscription_status = 'basic' WHERE id = v_other;
    v_ok := false;
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
        UPDATE public.user_profiles SET subscription_status = 'pro' WHERE id = v_other;  -- must be denied
    EXCEPTION WHEN insufficient_privilege THEN v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 15: a direct profile UPDATE by authenticated was NOT denied'; END IF;
    IF (SELECT subscription_status FROM public.user_profiles WHERE id = v_other) <> 'basic' THEN
        RAISE EXCEPTION 'FAIL 15: an entitlement field was modified by a direct write';
    END IF;
    -- ...but the DEFINER setter can still initialize the caller's own timezone under that same policy.
    SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claim.sub', v_other::text, true);
    IF public.set_user_timezone('Europe/London') <> 'Europe/London' THEN
        RAISE EXCEPTION 'FAIL 15: the setter could not initialize timezone under the SELECT-only policy';
    END IF;
    RESET ROLE;
    IF (SELECT subscription_status FROM public.user_profiles WHERE id = v_other) <> 'basic' THEN
        RAISE EXCEPTION 'FAIL 15: the setter touched an entitlement field';
    END IF;
    UPDATE public.user_profiles SET timezone = NULL WHERE id = v_other;
    RAISE NOTICE 'PASS 15  authenticated cannot write the profile directly; timezone only via the scoped setter';

    RAISE NOTICE '=== ALL FIFTEEN STREAK MATRIX ITEMS PASSED ===';
END
$matrix$;

\echo '=== SECURITY MATRIX COMPLETE ==='
