-- #1117 R1 — Deterministic, SOURCE-ONLY newest-two transcript-retention SQL contract.
--
-- Builds on #1131 (20260801000000_sessions_transcript_state.sql), which established the server-owned
-- `transcript_state` ('available' | 'expired' | 'not_captured'), the BEFORE-write derivation trigger
-- `trg_sessions_set_transcript_state`, the sticky/`expired`⇒NULL invariant, and the CHECK constraints.
-- #1131 deliberately made `expired` UNREACHABLE by any ordinary write: "`expired` is set ONLY by the
-- retention mutation owned by #1117". THIS migration is that owner. It adds — additively, without editing
-- #1131's file or its trigger — the versioned predicate + the single authorized retention mutation.
--
-- PRODUCT CONTRACT (locked invariant, #1117):
--   * Ranking cohort = transcript-bearing rows = `transcript IS NOT NULL AND transcript ~ '[^[:space:]]'`
--     (a NULL/empty/whitespace transcript carries no usable text and is NOT a retention candidate; this is
--     exactly #1131's "usable text" test, so a `not_captured` row is never ranked or relabeled).
--   * Rank globally PER USER by `created_at DESC, id DESC` — no partition by mode/project/engine/status/
--     surface. Freestyle and Guided share one global pool.
--   * Retain ranks 1–2 (stay `available`, transcript intact). For rank > 2, atomically set
--     `transcript = NULL` and server-owned `transcript_state = 'expired'`.
--   * `expired` always implies NULL and is sticky (enforced by #1131). `not_captured` is never changed to
--     `expired`. Empty string is invalid, never "retained" — a blank transcript paired with a non
--     `not_captured` state is a contradiction and is REJECTED (fail closed), not silently scrubbed.
--   * Session rows, measurements, evaluations, recommendations, attempts, FKs and every non-transcript
--     relationship/aggregate are preserved — only `transcript` and `transcript_state` change, never a delete.
--
-- SOURCE-ONLY: this migration is NOT applied to production by R1, runs no production query, performs no
-- scrub, and does not close #1117. R2 (future-save enforcement) and R3 (aggregate preflight) reuse the
-- SAME versioned predicate and version marker defined here.
--
-- ---------------------------------------------------------------------------------------------------------
-- PAIRED SOURCE ROLLBACK (schema/function reversal; the historical transcript deletion the mutation would
-- perform is separately irreversible and has NO content backup — that is a later, separately-authorized op):
--   DROP FUNCTION IF EXISTS public.expire_transcripts_newest_two(uuid, integer, integer);
--   DROP FUNCTION IF EXISTS public.transcript_retention_invariant_violations(uuid);
--   DROP FUNCTION IF EXISTS public.transcript_sessions_to_expire(uuid);
--   DROP FUNCTION IF EXISTS public.transcript_retention_policy_version();
-- ---------------------------------------------------------------------------------------------------------

-- 1) Versioned policy marker. One shared version string so R2/R3 pin the exact contract they enforce/preflight.
CREATE OR REPLACE FUNCTION public.transcript_retention_policy_version()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$ SELECT 'newest_two_v1'::text $$;

-- 2) THE shared, versioned, deterministic predicate. Given a user, returns the session ids whose transcript
--    must be expired (transcript-bearing rank > 2). Newest-two (rank 1,2 by created_at DESC, id DESC) are
--    never returned. Pure read; identical logic is reused by the mutation below and by R2 per-save.
CREATE OR REPLACE FUNCTION public.transcript_sessions_to_expire(p_user_id uuid)
RETURNS TABLE(session_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM (
    SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn
    FROM public.sessions
    WHERE user_id = p_user_id
      AND transcript IS NOT NULL
      AND transcript ~ '[^[:space:]]'
  ) ranked
  WHERE rn > 2
$$;

-- 3) Content-free invariant validator (aggregate counts only — never a transcript). Fail-closed precondition
--    for the mutation and reusable by the R3 aggregate preflight. Blank-on-not_captured is #1131-legitimate
--    and is intentionally NOT a violation.
CREATE OR REPLACE FUNCTION public.transcript_retention_invariant_violations(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(
  expired_with_text        bigint,
  available_without_text   bigint,
  not_captured_with_text   bigint,
  unknown_state            bigint
)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*) FILTER (WHERE transcript_state = 'expired'
                       AND transcript IS NOT NULL),
    count(*) FILTER (WHERE transcript_state = 'available'
                       AND (transcript IS NULL OR transcript !~ '[^[:space:]]')),
    count(*) FILTER (WHERE transcript_state = 'not_captured'
                       AND transcript IS NOT NULL AND transcript ~ '[^[:space:]]'),
    count(*) FILTER (WHERE transcript_state NOT IN ('available', 'expired', 'not_captured'))
  FROM public.sessions
  WHERE (p_user_id IS NULL OR user_id = p_user_id)
$$;

-- 4) THE single authorized retention mutation. Deterministic, idempotent, bounded, fail-closed.
--    * p_user_id NULL  -> all users (historical-foundation scope). Non-null -> one user (R2 per-save reuse).
--    * Establishes `expired` past #1131's derivation trigger via a SESSION-SCOPED, superuser-only bypass
--      (`session_replication_role = 'replica'`) around ONLY its bounded UPDATE — a path no client can call
--      (EXECUTE revoked from PUBLIC; granted to service_role only) nor reproduce (setting the GUC is
--      superuser-only). The CHECK constraints (incl. #1131's `expired`⇒NULL) remain enforced under replica.
--    * Never logs, returns or attaches transcript text; the JSON result is aggregate counts only.
CREATE OR REPLACE FUNCTION public.expire_transcripts_newest_two(
  p_user_id     uuid DEFAULT NULL,
  p_batch_size  integer DEFAULT 500,
  p_max_batches integer DEFAULT 100000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_viol        record;
  v_expired     bigint := 0;
  v_work_batches integer := 0;
  v_guard       integer := 0;
  v_affected    integer;
BEGIN
  -- Argument bounds (fail closed).
  IF p_batch_size IS NULL OR p_batch_size <= 0 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_two: p_batch_size % out of bounds (1..5000)', p_batch_size
      USING ERRCODE = '22023';
  END IF;
  IF p_max_batches IS NULL OR p_max_batches <= 0 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_two: p_max_batches % out of bounds', p_max_batches
      USING ERRCODE = '22023';
  END IF;

  -- Bounded resource guards / explicit stop conditions.
  PERFORM set_config('statement_timeout', '120000', true);
  PERFORM set_config('lock_timeout', '5000', true);
  PERFORM set_config('idle_in_transaction_session_timeout', '120000', true);

  -- Fail closed on any pre-existing contradiction in scope (reject empty-on-available / expired-with-text /
  -- not_captured-with-real-text / unknown state). Never scrub an inconsistent cohort.
  SELECT * INTO v_viol FROM public.transcript_retention_invariant_violations(p_user_id);
  IF v_viol.expired_with_text > 0
     OR v_viol.available_without_text > 0
     OR v_viol.not_captured_with_text > 0
     OR v_viol.unknown_state > 0 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_two: invariant violations in scope (expired_with_text=%, available_without_text=%, not_captured_with_text=%, unknown_state=%); refusing to run',
      v_viol.expired_with_text, v_viol.available_without_text, v_viol.not_captured_with_text, v_viol.unknown_state
      USING ERRCODE = '23514';
  END IF;

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > p_max_batches THEN
      RAISE EXCEPTION 'expire_transcripts_newest_two: exceeded p_max_batches=% (stop condition)', p_max_batches
        USING ERRCODE = '54000';
    END IF;

    -- Authorized, session-scoped trigger bypass for THIS bounded write only, restored immediately after.
    SET LOCAL session_replication_role = 'replica';

    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
      FROM public.sessions
      WHERE transcript IS NOT NULL
        AND transcript ~ '[^[:space:]]'
        AND (p_user_id IS NULL OR user_id = p_user_id)
    ),
    batch AS (
      SELECT id FROM ranked WHERE rn > 2 ORDER BY id LIMIT p_batch_size
    )
    UPDATE public.sessions s
    SET transcript = NULL,
        transcript_state = 'expired'
    WHERE s.id IN (SELECT id FROM batch);
    GET DIAGNOSTICS v_affected = ROW_COUNT;

    SET LOCAL session_replication_role = 'origin';

    EXIT WHEN v_affected = 0;
    v_expired := v_expired + v_affected;
    v_work_batches := v_work_batches + 1;
  END LOOP;

  -- Aggregate-only result. NEVER contains transcript text.
  RETURN jsonb_build_object(
    'policy_version', public.transcript_retention_policy_version(),
    'scope',          CASE WHEN p_user_id IS NULL THEN 'all_users' ELSE 'single_user' END,
    'expired_count',  v_expired,
    'batches_executed', v_work_batches
  );
END;
$$;

-- 5) PRIVILEGES — least privilege, fail closed. CREATE grants EXECUTE to PUBLIC by default; revoke it on
--    every new function, then grant EXECUTE to the intended server caller (service_role) ONLY. No anon /
--    authenticated / PUBLIC grant anywhere — a client can neither run the mutation nor read the predicate.
REVOKE ALL ON FUNCTION public.transcript_retention_policy_version()            FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transcript_sessions_to_expire(uuid)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transcript_retention_invariant_violations(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_transcripts_newest_two(uuid, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.transcript_retention_policy_version()            TO service_role;
GRANT EXECUTE ON FUNCTION public.transcript_sessions_to_expire(uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION public.transcript_retention_invariant_violations(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_transcripts_newest_two(uuid, integer, integer) TO service_role;
