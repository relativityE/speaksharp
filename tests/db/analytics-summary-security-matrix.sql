-- #1091 SECURITY — portable eight-item authorization matrix for public.get_analytics_summary.
--
-- Pure SQL, no client library, runnable by `psql` against ANY PostgreSQL server. Its purpose is to
-- verify the parts of the contract that depend on the SERVER — roles, GRANT/REVOKE, SECURITY DEFINER
-- and RLS interaction — on the same PostgreSQL major version production runs, which an in-process
-- engine cannot vouch for.
--
-- Run against a DISPOSABLE database only. It creates roles and seeds synthetic rows.
-- Expects the bootstrap and the migration to have been applied first (see the workflow).
--
-- Every check RAISEs on failure, so a non-zero psql exit is the pass/fail signal. Use psql -v ON_ERROR_STOP=1.
--
-- Content-free: synthetic UUIDs only.

\set ON_ERROR_STOP on

\echo '=== server under test ==='
SELECT version();
SELECT current_setting('server_version_num') AS server_version_num;

-- ---------------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------------
INSERT INTO auth.users (id) VALUES
    ('11111111-1111-4111-8111-111111111111'),
    ('22222222-2222-4222-8222-222222222222')
ON CONFLICT DO NOTHING;

INSERT INTO public.sessions (user_id, created_at, duration, total_words, clarity_score, wpm, accuracy, engine, filler_words)
VALUES ('11111111-1111-4111-8111-111111111111', '2026-07-01T10:00:00Z', 600, 900, 91, 90, 0.95, 'private-v2', '{"um":{"count":3},"total":{"count":3}}'),
       ('11111111-1111-4111-8111-111111111111', '2026-07-02T10:00:00Z', 600, 900, 89, 90, 0.95, 'private-v2', '{"um":{"count":3},"total":{"count":3}}');

-- The app role PostgREST switches into. Everything below runs through the same grants production uses.
GRANT authenticated TO CURRENT_USER;
GRANT anon TO CURRENT_USER;
GRANT service_role TO CURRENT_USER;

\echo '=== effective EXECUTE grants (expect: authenticated + service_role; NOT anon/PUBLIC) — #1096 ACL ==='
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'get_analytics_summary' AND privilege_type = 'EXECUTE'
ORDER BY grantee;

\echo '=== has_function_privilege probes ==='
SELECT
    has_function_privilege('authenticated', 'public.get_analytics_summary(uuid)', 'EXECUTE') AS authenticated_can_execute,
    has_function_privilege('anon',          'public.get_analytics_summary(uuid)', 'EXECUTE') AS anon_can_execute,
    has_function_privilege('service_role',  'public.get_analytics_summary(uuid)', 'EXECUTE') AS service_role_can_execute;

\echo '=== running the eight-item matrix ==='
DO $matrix$
DECLARE
    v_victim   uuid := '11111111-1111-4111-8111-111111111111';
    v_attacker uuid := '22222222-2222-4222-8222-222222222222';
    v_result   jsonb;
    v_ok       boolean;
    v_direct   int;
BEGIN
    -- ---- 0. preconditions ---------------------------------------------------------------------
    IF NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'get_analytics_summary') THEN
        RAISE EXCEPTION 'PRECONDITION FAILED: function is not SECURITY DEFINER';
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sessions'::regclass) THEN
        RAISE EXCEPTION 'PRECONDITION FAILED: RLS is not enabled on public.sessions';
    END IF;
    RAISE NOTICE 'PASS 0  preconditions: SECURITY DEFINER set, RLS enabled on public.sessions';

    -- ---- 1. authenticated caller, own analytics -> ALLOWED ------------------------------------
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
    v_result := public.get_analytics_summary(v_victim);
    IF (v_result->'overallStats'->>'totalSessions')::int <> 2 THEN
        RAISE EXCEPTION 'FAIL 1: owner did not receive their own 2 sessions (got %)',
            v_result->'overallStats'->>'totalSessions';
    END IF;
    IF (v_result->'overallStats'->>'clarityContributorCount')::int <> 2 THEN
        RAISE EXCEPTION 'FAIL 1: contributor count wrong (got %)',
            v_result->'overallStats'->>'clarityContributorCount';
    END IF;
    RESET ROLE;
    RAISE NOTICE 'PASS 1  authenticated caller reads its OWN analytics (2 sessions, avgClarity=%)',
        v_result->'overallStats'->>'avgClarity';

    -- ---- 2. authenticated caller, ANOTHER user -> REJECTED ------------------------------------
    v_ok := false;
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claim.sub', v_attacker::text, true);
        PERFORM public.get_analytics_summary(v_victim);
    EXCEPTION WHEN raise_exception THEN
        v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 2: cross-user request was NOT rejected'; END IF;
    RAISE NOTICE 'PASS 2  authenticated caller requesting ANOTHER user is rejected';

    -- ---- 3. NULL identity -> REJECTED (the defect) --------------------------------------------
    v_ok := false;
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claim.sub', '', true);   -- auth.uid() IS NULL
        PERFORM public.get_analytics_summary(v_victim);
    EXCEPTION WHEN raise_exception THEN
        v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'FAIL 3: NULL identity was NOT rejected — the fail-open defect is still present';
    END IF;
    RAISE NOTICE 'PASS 3  NULL identity is rejected';

    -- ---- 4. NULL p_user_id -> REJECTED --------------------------------------------------------
    v_ok := false;
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
        PERFORM public.get_analytics_summary(NULL);
    EXCEPTION WHEN raise_exception THEN
        v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 4: NULL p_user_id was NOT rejected'; END IF;

    -- and NULL identity together with NULL p_user_id (the explicit p_user_id IS NULL check must catch this — NULL <> NULL is not TRUE)
    v_ok := false;
    BEGIN
        SET LOCAL ROLE authenticated;
        PERFORM set_config('request.jwt.claim.sub', '', true);
        PERFORM public.get_analytics_summary(NULL);
    EXCEPTION WHEN raise_exception THEN
        v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 4b: NULL identity + NULL p_user_id was NOT rejected'; END IF;
    RAISE NOTICE 'PASS 4  NULL p_user_id is rejected (with and without an identity)';

    -- ---- 5. anonymous role -> CANNOT EXECUTE --------------------------------------------------
    IF has_function_privilege('anon', 'public.get_analytics_summary(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 5: anon still holds EXECUTE — the PUBLIC grant was not revoked';
    END IF;
    v_ok := false;
    BEGIN
        SET LOCAL ROLE anon;
        PERFORM set_config('request.jwt.claim.sub', v_victim::text, true);
        PERFORM public.get_analytics_summary(v_victim);
    EXCEPTION WHEN insufficient_privilege THEN
        v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN RAISE EXCEPTION 'FAIL 5: anon was able to execute the function'; END IF;
    RAISE NOTICE 'PASS 5  anon cannot execute (privilege denied, not merely guard-rejected)';

    -- ---- 6. service_role -> RETAINS EXECUTE (per #1096's ACL) but is guard-rejected without an identity
    -- #1096 owns the ACL and kept service_role's grant; #1091 consumes that decision, it does not re-make
    -- it. The safety of keeping the grant rests on the null-safe guard: a service_role caller carries no
    -- request.jwt.claim.sub, so auth.uid() IS NULL and the guard rejects the call. This item proves BOTH:
    -- the grant is present (matches #1096, not narrowed) AND the guard makes it harmless.
    IF NOT has_function_privilege('service_role', 'public.get_analytics_summary(uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL 6: service_role lost EXECUTE — #1091 must not narrow #1096''s ACL';
    END IF;
    v_ok := false;
    BEGIN
        SET LOCAL ROLE service_role;
        PERFORM set_config('request.jwt.claim.sub', '', true);   -- no identity -> auth.uid() IS NULL
        PERFORM public.get_analytics_summary(v_victim);
    EXCEPTION WHEN raise_exception THEN
        v_ok := true;
    END;
    RESET ROLE;
    IF NOT v_ok THEN
        RAISE EXCEPTION 'FAIL 6: service_role read another user''s analytics through the customer RPC';
    END IF;
    RAISE NOTICE 'PASS 6  service_role keeps EXECUTE (per #1096) but the null-safe guard rejects the keyless call';

    -- ---- 7. RLS / SECURITY DEFINER interaction ------------------------------------------------
    -- RLS blocks a DIRECT read of another user's rows...
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', v_attacker::text, true);
    SELECT count(*) INTO v_direct FROM public.sessions WHERE user_id = v_victim;
    RESET ROLE;
    IF v_direct <> 0 THEN
        RAISE EXCEPTION 'FAIL 7: RLS did not block a direct cross-user SELECT (got % rows)', v_direct;
    END IF;
    -- ...but the SECURITY DEFINER function is NOT constrained by that policy, which is exactly why the
    -- in-function guard has to be fail-closed. Item 2 above already proved the guard rejects this caller.
    RAISE NOTICE 'PASS 7  RLS blocks the direct read; the SECURITY DEFINER path is gated only by the guard';

    -- ITEM 8 — the effective search_path MUST include pg_temp explicitly, and pg_temp must NOT be first.
    -- Without this, an unqualified `sessions` reference resolves against the caller's temporary schema
    -- first, letting an authenticated caller with TEMP shadow public.sessions (proven in #1096). This item
    -- FAILS if the function is left on `SET search_path = public` — the exact regression where a later
    -- migration silently reverts #1096's fix.
    DECLARE
        v_sp text;
    BEGIN
        SELECT array_to_string(proconfig, ',') INTO v_sp
        FROM pg_proc WHERE proname = 'get_analytics_summary' LIMIT 1;
        IF v_sp IS NULL OR position('search_path=public, pg_temp' in replace(v_sp, ' ', '')||'') = 0 THEN
            -- normalise spaces before comparing so 'public, pg_temp' and 'public,pg_temp' both pass
            IF position('search_path=public,pg_temp' in replace(v_sp, ' ', '')) = 0 THEN
                RAISE EXCEPTION 'FAIL 8: search_path must be exactly "public, pg_temp" (got: %)', v_sp;
            END IF;
        END IF;
        RAISE NOTICE 'PASS 8  search_path is public, pg_temp (pg_temp explicit and last)';
    END;

    RAISE NOTICE '=== ALL EIGHT MATRIX ITEMS PASSED ===';
END
$matrix$;

\echo '=== response contract on the authorized path ==='
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
SELECT jsonb_pretty(
    (public.get_analytics_summary('11111111-1111-4111-8111-111111111111'::uuid)->'overallStats') - 'chartData'::text
) AS overall_stats;
RESET ROLE;

\echo '=== SECURITY MATRIX COMPLETE ==='
