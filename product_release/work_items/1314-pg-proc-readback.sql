-- #1314 PR2 GATING EVIDENCE — production readback. READ-ONLY: applies nothing, mutates nothing, reads no row data.
-- Run in the Supabase SQL Editor and paste the single output row on #1314 BEFORE any retention/completion change.
--
-- Returns ONE ROW, semicolon-separated, so the whole result pastes as a single line and no section can be lost to
-- an editor that shows only the last statement's result set.
--
-- Each section states its PREDICTION from source analysis. The purpose is to CONFIRM OR REFUTE that prediction
-- against the live database — the last diagnosis reasoned from source without a readback had to be retracted.
--
--   A_OVERLOADS  predicted TWO: the LEGACY complete_session(uuid,text,text,int,text) whose 3rd arg
--                p_final_transcript WRITES a transcript, and the CUTOVER 10-arg overload with no transcript
--                parameter. Only the cutover one => ledger C8 (legacy bypass) is REFUTED.
--   B_RETENTION  predicted PRESENT: no migration ever drops converge_transcript_retention.
--   C_CALLERS    the live call graph. Predicted: the LEGACY overload and create_session_and_update_usage
--                reference the coordinator; the CUTOVER overload does NOT. That missing edge is the whole
--                finding — retention is severed, not deleted.
--   D_COLUMNS    predicted: transcript still exists AND the Stage-A metrics columns exist (confirming Stage-A
--                was applied, and that a transcript could still be stored if a writer sent one).
--   E_TRIGGERS   sessions triggers with DECODED enabled state — a disabled validator is a silent hole.
--
-- NOTE ON C_CALLERS: it inspects pg_get_functiondef, NOT prosrc. A function written with a modern SQL-standard
-- body (LANGUAGE sql BEGIN ATOMIC ...) stores its body in prosqlbody and leaves prosrc NULL, so a prosrc scan
-- silently returns "no callers" — which here would look exactly like a refutation of the finding. Verified
-- against a local PostgreSQL 17 fixture: prosrc found 0, pg_get_functiondef found 1.
--
-- VALIDATION (executed, not eyeballed) against a local PostgreSQL 17 cluster loaded with a fixture mirroring the
-- predicted production shape — both overloads, the coordinator, the trigger:
--   * runs clean, exit 0, and returns EXACTLY ONE ROW;
--   * returns one row of [NONE] placeholders against an empty database — never zero rows, never an error, so a
--     missing object reads as evidence instead of looking like a failed query;
--   * the refutation case behaves: with the legacy overload dropped, A_OVERLOADS lists only the cutover one and
--     C_CALLERS correctly loses it;
--   * a disabled trigger reads `=DISABLED`, not the raw `O`/`D` char;
--   * runs unchanged inside `BEGIN READ ONLY` — it cannot write even by accident.
-- Two bugs were found and fixed by running it: `t.tgenabled` is type "char", so `||` was ambiguous
-- ("operator is not unique") and needed an explicit ::text cast; and the original prosrc scan silently missed
-- SQL-standard-body callers.

WITH overloads AS (
  SELECT string_agg(p.oid::regprocedure::text, '; ' ORDER BY p.oid::regprocedure::text) AS v
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'complete_session'
),
retention AS (
  SELECT string_agg(p.oid::regprocedure::text || ' [secdef=' || p.prosecdef::text || ']', '; '
                    ORDER BY p.oid::regprocedure::text) AS v
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('converge_transcript_retention', 'create_session_and_update_usage',
                      'validate_filler_counts_1306', 'validate_next_action_signal_1306')
),
callers AS (
  SELECT string_agg(sig, '; ' ORDER BY sig) AS v FROM (
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'                       -- pg_get_functiondef errors on aggregate/window entries
      AND p.proname <> 'converge_transcript_retention'
      AND pg_get_functiondef(p.oid) ILIKE '%converge_transcript_retention%'
  ) s
),
cols AS (
  SELECT string_agg(column_name || ':' || data_type, '; ' ORDER BY column_name) AS v
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sessions'
    AND column_name IN ('transcript', 'transcript_state', 'next_action_signal', 'filler_counts',
                        'wpm', 'clarity_score', 'total_words', 'pause_metrics')
),
trigs AS (
  SELECT string_agg(t.tgname || '=' ||
           CASE t.tgenabled WHEN 'O' THEN 'enabled'
                            WHEN 'D' THEN 'DISABLED'
                            WHEN 'R' THEN 'replica-only'
                            WHEN 'A' THEN 'always'
                            ELSE 'unknown(' || t.tgenabled::text || ')' END, '; ' ORDER BY t.tgname) AS v
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.sessions'::regclass AND NOT t.tgisinternal
)
SELECT 'A_OVERLOADS=[' || COALESCE(o.v, 'NONE') || ']'
    || ' ;; B_RETENTION_FNS=[' || COALESCE(r.v, 'NONE') || ']'
    || ' ;; C_CALLERS_OF_COORDINATOR=[' || COALESCE(c.v, 'NONE') || ']'
    || ' ;; D_COLUMNS=[' || COALESCE(d.v, 'NONE') || ']'
    || ' ;; E_TRIGGERS=[' || COALESCE(g.v, 'NONE') || ']'
  AS readback
FROM overloads o, retention r, callers c, cols d, trigs g;
