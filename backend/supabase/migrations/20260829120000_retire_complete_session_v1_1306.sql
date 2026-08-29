-- #1306 Stage B — retire the legacy `complete_session` (v1) overloads.
--
-- WHY THIS IS NOT COSMETIC. The production client cut over to `complete_session_v2` and has no v1 fallback
-- (see frontend/src/lib/storage.ts), and a repository-wide grep finds ZERO production callers of v1 — every
-- remaining reference is a mock that REJECTS v1, a comment, a live test asserting zero v1 calls, or a SQL
-- fixture. But two v1 overloads survived the cutover and BOTH were granted to `authenticated`:
--
--   V1-A  complete_session(UUID, TEXT, TEXT, INT, TEXT)
--         The THIRD argument is the transcript. Any signed-in user could call this directly and persist
--         transcript text WITHOUT the newest-two retention convergence and WITHOUT the filler-map
--         validation that v2 enforces. It is a second, unguarded write path to transcript persistence.
--
--   V1-B  complete_session(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB)
--         The additive Stage-A metrics-only overload, superseded by complete_session_v2.
--
-- REVOKE IS NOT RETIREMENT. Removing the `authenticated` grant alone would leave `service_role` able to
-- reach the transcript path, and would leave the object available to any future SECURITY DEFINER caller.
-- Both overloads are therefore DROPPED, not merely revoked. The REVOKEs are kept ahead of the DROPs so that
-- a partial application (DROP refused for an unexpected dependency) still closes the reachable grant.
--
-- NAMED FAILURE, NOT SILENT FALLTHROUGH. After this migration a v1 call raises
-- `function public.complete_session(...) does not exist` (PostgREST: PGRST202). It must NEVER resolve to v2:
-- a silent redirect would hide exactly the caller this work exists to find.
--
-- WHAT THIS DOES NOT TOUCH. `complete_session_v2` is unchanged — its newest-two transcript/metrics contract,
-- atomic completion, and filler validation all stand. No data is read, written, or migrated.
--
-- ROLLBACK is a CLIENT release rollback, never a data rollback. If an old client must be supported again,
-- restore the prior definition from 20260812041500 (V1-A) / 20260816223606 (V1-B); nothing here destroys data.

BEGIN;

-- V1-A — the transcript-accepting overload.
REVOKE EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, TEXT, INT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.complete_session(UUID, TEXT, TEXT, INT, TEXT);

-- V1-B — the Stage-A metrics-only overload.
REVOKE EXECUTE ON FUNCTION public.complete_session(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION IF EXISTS public.complete_session(UUID, TEXT, INT, TEXT, JSONB, INT, DOUBLE PRECISION, DOUBLE PRECISION, JSONB, JSONB);

-- Historical overloads dropped by earlier migrations; named so a database that skipped one still converges.
DROP FUNCTION IF EXISTS public.complete_session(UUID, TEXT, INT);

-- FAIL CLOSED. If ANY `complete_session` overload survives, the retirement did not happen and this
-- migration must not report success — a partially-retired function is the worst of both states.
DO $$
DECLARE remaining INT;
BEGIN
    SELECT count(*) INTO remaining
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_session';

    IF remaining > 0 THEN
        RAISE EXCEPTION
            'Stage B incomplete: % complete_session overload(s) still present after retirement', remaining;
    END IF;
END $$;

-- The successor must still be there. Dropping v1 while v2 is absent would leave no completion path at all.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'complete_session_v2'
    ) THEN
        RAISE EXCEPTION 'Stage B refused: complete_session_v2 is absent — retiring v1 would leave no completion path';
    END IF;
END $$;

COMMIT;
