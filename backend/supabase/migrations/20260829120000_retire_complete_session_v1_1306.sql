-- #1306 Stage B — retire the legacy `complete_session` (v1) overloads.
--
-- WHY THIS IS NOT COSMETIC. The production client cut over to `complete_session_v2` and has no v1 fallback
-- (see frontend/src/lib/storage.ts), and a repository-wide grep finds ZERO production callers of v1 — every
-- remaining reference is a mock that REJECTS v1, a comment, a live test asserting zero v1 calls, or a SQL
-- fixture. But two v1 overloads survived the cutover and BOTH were granted to `authenticated`:
--
--   V1-A  complete_session(UUID, TEXT, TEXT, INT, TEXT)
--         The THIRD argument is the transcript, and any signed-in user can call this directly.
--
--         CORRECTION (PM RETURN, 2026-08-29). An earlier version of this header said V1-A "never invokes
--         the retention coordinator". That was WRONG, and the truth is worse. V1-A does call
--         `converge_transcript_retention` — but only AFTER it has already written the transcript:
--
--             UPDATE public.sessions SET ... transcript = COALESCE(p_final_transcript, transcript) ...
--             BEGIN  v_retention := public.converge_transcript_retention(auth.uid());
--             EXCEPTION WHEN query_canceled THEN v_retention := '{"status":"error"}';
--                       WHEN OTHERS       THEN v_retention := '{"status":"error"}';  END;
--             RETURN jsonb_build_object('success', true, ..., 'retention', v_retention);
--
--         So the transcript is persisted FIRST; every convergence exception is swallowed; a `pending` or
--         non-converged result is accepted as-is; and the call still returns `success: true`. Nothing
--         rolls the transcript back. The newest-two bound can therefore be exceeded through this path
--         while the caller is told the save succeeded.
--
--         It also bypasses the filler-map validation v2 enforces. This is not merely an unused overload:
--         it is a reachable write path that can leave the retention contract violated and say nothing.
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

-- THE SUCCESSOR MUST BE THE RIGHT ONE. Checking only `proname = 'complete_session_v2'` would let ANY
-- overload satisfy this precondition — including a wrong-arity stand-in that cannot accept a transcript.
-- Dropping v1 against that would leave no working completion path while reporting success. The exact
-- identity signature is required.
DO $$
DECLARE v2_oid oid; v2_acl aclitem[]; v2_args oid[];
BEGIN
    -- Identified STRUCTURALLY, not by a rendered signature string. A hardcoded
    -- `pg_get_function_identity_arguments` literal is brittle — one spelling difference and the
    -- precondition fails closed on every database, which is a self-inflicted outage, not a safety check.
    -- Arity plus the first and last argument types are what actually distinguish the real successor from
    -- a stand-in: 11 arguments, keyed by session uuid, ending in the transcript text.
    SELECT p.oid, p.proacl, p.proargtypes::oid[] INTO v2_oid, v2_acl, v2_args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'complete_session_v2' AND p.pronargs = 11;

    IF v2_oid IS NULL THEN
        RAISE EXCEPTION
            'Stage B refused: no 11-argument complete_session_v2 — retiring v1 would leave no completion path';
    END IF;
    IF v2_args[1] <> 'uuid'::regtype::oid OR v2_args[11] <> 'text'::regtype::oid THEN
        RAISE EXCEPTION
            'Stage B refused: complete_session_v2 is not the transcript-accepting successor (arg1 must be uuid, arg11 text)';
    END IF;

    -- The successor must be reachable by the roles that will now depend on it exclusively.
    IF NOT has_function_privilege('authenticated', v2_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Stage B refused: complete_session_v2 is not executable by authenticated';
    END IF;
    IF NOT has_function_privilege('service_role', v2_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Stage B refused: complete_session_v2 is not executable by service_role';
    END IF;

    -- PUBLIC is not an ordinary role and cannot be passed to has_function_privilege. A PUBLIC grant
    -- appears in the ACL as an entry with an EMPTY grantee (`=X/grantor`), so it is detected textually.
    IF v2_acl IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(v2_acl) AS a WHERE split_part(a::text, '=', 1) = ''
    ) THEN
        RAISE EXCEPTION 'Stage B refused: complete_session_v2 carries a PUBLIC grant';
    END IF;
END $$;

COMMIT;
