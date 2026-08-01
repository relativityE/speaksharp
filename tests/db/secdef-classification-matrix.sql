-- #1097 PR-A — SECURITY DEFINER classification matrix.
--
-- Runs AFTER the prelude + every committed migration has been applied VERBATIM to a throwaway container.
-- It introspects the effective, post-migration privilege state — it does NOT re-declare or modify anything.
--
-- For each SECURITY DEFINER function in schema `public` it records:
--   • the exact overloaded signature (regprocedure),
--   • the effective search_path (proconfig) and whether pg_temp is exposed,
--   • effective EXECUTE authority for PUBLIC (proacl default), anon, and authenticated.
--
-- It fails closed (non-zero exit under ON_ERROR_STOP) if the harness is not trustworthy — the request roles
-- must exist, the classification must be non-vacuous, and it must DISCRIMINATE (detect both a locked and an
-- anon-reachable function) so a blind/broken harness cannot read as a pass. The full table is emitted as
-- NOTICEs and a completion banner is printed for the CI job to assert.
--
-- NOTE on `search_path = public` (no explicit pg_temp): PostgreSQL still implicitly searches pg_temp FIRST
-- for table/type resolution, so `= public` does NOT neutralise temp-object shadowing. Only an explicit
-- `pg_temp` placed LAST (e.g. `pg_catalog, public, pg_temp`) or `search_path = ''` with full qualification is
-- safe. This matrix reports pg_temp exposure accordingly.

\set ON_ERROR_STOP on

DO $$
DECLARE
  r                RECORD;
  n_total          int := 0;
  n_anon           int := 0;
  n_no_searchpath  int := 0;
  n_locked         int := 0;
  sp               text;
  pg_temp_note     text;
  anon_exec        boolean;
  auth_exec        boolean;
  public_exec      boolean;
BEGIN
  -- Harness integrity: the request roles must exist or every privilege check is meaningless.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'HARNESS BROKEN: anon/authenticated roles missing — classification would be vacuous';
  END IF;

  RAISE NOTICE '=== #1097 SECURITY DEFINER classification (schema public) ===';

  FOR r IN
    SELECT p.oid,
           p.oid::regprocedure::text AS signature,
           COALESCE(array_to_string(p.proconfig, ' | '), '(none)') AS proconfig,
           -- EFFECTIVE PUBLIC EXECUTE, not ACL nullness: PUBLIC can execute when the ACL is the default
           -- (NULL ⇒ PostgreSQL's implicit GRANT EXECUTE TO PUBLIC) OR an explicit PUBLIC (grantee 0) grant
           -- exists. `proacl IS NULL` alone would falsely report an explicit `GRANT … TO PUBLIC` as locked.
           (p.proacl IS NULL
             OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS public_can_execute
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
    ORDER BY p.oid::regprocedure::text
  LOOP
    n_total := n_total + 1;
    sp := (SELECT COALESCE(array_to_string(pp.proconfig, ' | '), '(none)') FROM pg_proc pp WHERE pp.oid = r.oid);
    anon_exec := has_function_privilege('anon', r.oid, 'EXECUTE');
    auth_exec := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    public_exec := r.public_can_execute;  -- effective PUBLIC EXECUTE (default OR explicit grantee-0 grant)

    IF sp = '(none)' THEN
      pg_temp_note := 'NO search_path set (caller-controlled; pg_temp searched FIRST)';
      n_no_searchpath := n_no_searchpath + 1;
    ELSIF sp ~ '(^|[=,| ])pg_temp($|[,| ])' THEN
      pg_temp_note := 'pg_temp explicitly listed';
    ELSE
      pg_temp_note := 'pg_temp NOT listed (still implicitly first for tables/types)';
    END IF;

    IF anon_exec THEN n_anon := n_anon + 1; END IF;
    IF NOT anon_exec THEN n_locked := n_locked + 1; END IF;

    RAISE NOTICE 'fn=% | search_path=% [%] | EXECUTE anon=% authenticated=% public=%',
      r.signature, sp, pg_temp_note, anon_exec, auth_exec, public_exec;
  END LOOP;

  RAISE NOTICE '--- summary: % SECURITY DEFINER functions; anon-executable=%; no-search_path=%; anon-locked=% ---',
    n_total, n_anon, n_no_searchpath, n_locked;

  -- Non-vacuity + discrimination: a trustworthy classification must find functions AND distinguish
  -- anon-reachable from locked. If either class is empty the harness is not proving anything.
  IF n_total = 0 THEN
    RAISE EXCEPTION 'VACUOUS: no SECURITY DEFINER functions found — migrations did not apply as expected';
  END IF;
  IF n_locked = 0 THEN
    RAISE EXCEPTION 'NON-DISCRIMINATING: every SECURITY DEFINER function reads as anon-executable — privilege introspection is not working';
  END IF;
  IF n_anon = 0 THEN
    RAISE EXCEPTION 'CHARACTERIZATION CHANGED: no anon-executable SECURITY DEFINER functions detected. If this is due to a remediation (PR-B), update this matrix; otherwise the harness is not seeing PUBLIC grants';
  END IF;

  RAISE NOTICE 'ANON-EXECUTABLE SECDEF COUNT = %', n_anon;
  RAISE NOTICE 'SECDEF CLASSIFICATION COMPLETE';
END $$;
