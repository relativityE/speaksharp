-- #1314 C1+C2 — POST-APPLICATION READBACK for the atomic completion migration. READ-ONLY.
-- Run AFTER the migration is applied (separately authorized). Returns ONE ROW, semicolon-separated.
--
-- Predictions, so this can refute as well as confirm:
--   A_OVERLOADS  exactly TWO complete_session entries, BOTH PRE-EXISTING AND UNCHANGED: the legacy
--                (uuid,text,text,int,text) and the Stage-A (uuid,text,int,text,jsonb,...). This migration is
--                purely additive and adds NO complete_session overload — the atomic RPC is separately named
--                complete_session_v2, reported by A2_V2. Anything other than those two means something dropped
--                or added an overload, i.e. the migration was not additive.
--                (An earlier revision of this header described a same-name 11-arg overload; that design was
--                rejected precisely because a defaulted same-name overload makes subset named calls ambiguous.)
--   B_CALLERS    complete_session_v2 MUST now appear as a caller of converge_transcript_retention. Before this
--                migration only the legacy overload and create_session_and_update_usage did; that missing edge
--                is the defect being fixed, so its presence here is the proof.
--   C_LIMIT      the DUAL bound is installed: max_persisted_transcript_chars() = 50000 AND
--                max_persisted_transcript_bytes() = 200000. A single number here means the byte bound
--                is missing and a multi-byte transcript can defeat the storage limit.
--   D_TRIGGERS   the server-owned transcript_state derivation and both invariants are still enabled — the
--                migration must not have disturbed them.
--   E_GRANTS     For ALL THREE created functions: EXECUTE granted to authenticated + service_role, and NOT to
--                PUBLIC. PostgreSQL grants EXECUTE to PUBLIC on a new function by default, so a missing REVOKE
--                is a real exposure, not a formality. Any PUBLIC entry here is a FAIL.

WITH overloads AS (
  SELECT string_agg(p.oid::regprocedure::text, '; ' ORDER BY p.oid::regprocedure::text) AS v
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_session'
),
v2 AS (
  SELECT string_agg(p.oid::regprocedure::text, '; ' ORDER BY p.oid::regprocedure::text) AS v
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_session_v2'
),
callers AS (
  SELECT string_agg(sig, '; ' ORDER BY sig) AS v FROM (
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND p.proname <> 'converge_transcript_retention'
      -- pg_get_functiondef, NOT prosrc: prosrc is NULL for SQL-standard-body functions, and a false "no
      -- callers" here would look exactly like a refutation of the fix.
      AND pg_get_functiondef(p.oid) ILIKE '%converge_transcript_retention%'
  ) s
),
lim AS (
  -- INTROSPECT the constants, never INVOKE them. Calling public.max_persisted_transcript_chars() directly makes
  -- this whole readback fail to parse once the function is dropped — i.e. it could not verify a rollback, which
  -- is precisely the moment it is needed. Reading the literal out of prosrc reports ABSENT instead of erroring.
  SELECT 'chars=' || COALESCE((SELECT NULLIF(regexp_replace(p.prosrc, '\D', '', 'g'), '')
                               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname='public' AND p.proname='max_persisted_transcript_chars'), 'ABSENT')
      || ' bytes=' || COALESCE((SELECT NULLIF(regexp_replace(p.prosrc, '\D', '', 'g'), '')
                               FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                               WHERE n.nspname='public' AND p.proname='max_persisted_transcript_bytes'), 'ABSENT') AS v
),
trigs AS (
  SELECT string_agg(t.tgname || '=' ||
           CASE t.tgenabled WHEN 'O' THEN 'enabled' WHEN 'D' THEN 'DISABLED'
                            WHEN 'R' THEN 'replica-only' WHEN 'A' THEN 'always'
                            ELSE 'unknown(' || t.tgenabled::text || ')' END, '; ' ORDER BY t.tgname) AS v
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.sessions'::regclass AND NOT t.tgisinternal
),
grants AS (
  SELECT string_agg(DISTINCT routine_name || '->' || grantee, '; ' ORDER BY routine_name || '->' || grantee) AS v
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name IN ('complete_session_v2',
                         'max_persisted_transcript_chars', 'max_persisted_transcript_bytes')
)
SELECT 'A_OVERLOADS=[' || COALESCE(o.v, 'NONE') || ']'
    || ' ;; A2_V2=[' || COALESCE(w.v, 'NONE') || ']'
    || ' ;; B_CALLERS_OF_COORDINATOR=[' || COALESCE(c.v, 'NONE') || ']'
    || ' ;; C_TRANSCRIPT_LIMIT=[' || l.v || ']'
    || ' ;; D_TRIGGERS=[' || COALESCE(t.v, 'NONE') || ']'
    || ' ;; E_GRANTS=[' || COALESCE(g.v, 'NONE') || ']'
  AS readback
FROM overloads o, v2 w, callers c, lim l, trigs t, grants g;
