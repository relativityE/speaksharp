-- =========================================================================================================
-- #1258 P0 — RETENTION EXPIRY WITHOUT A SUPERUSER-ONLY SETTING. Forward-only correction of 20260908120000.
--
-- THE FAILURE. A returning user's later saves fail in Production when they reach the expiry. complete_session_v2 calls
-- converge_transcript_retention, which (once an older completed transcript has terminal Progress evidence)
-- calls expire_transcripts_newest_one. That function ran `SET LOCAL session_replication_role = 'replica'`
-- to get its UPDATE past the derivation trigger `trg_sessions_set_transcript_state` (20260801000000), which
-- otherwise rewrites a requested `expired` to `not_captured`. `session_replication_role` is superuser-only.
-- The functions are owned by Supabase's `postgres` role, which is not a superuser, so the SET raised 42501,
-- the whole completion rolled back, and PostgREST returned 403. Every PGlite suite ran as a superuser, where
-- the SET is allowed, so nothing caught it. A first save never reaches the expiry. A later save reaches it when
-- retention is active and armed and an older completed transcript's Progress evidence has settled; saves that
-- defer on pending evidence, or have no older transcript, return before the SET and are unaffected.
--
-- THE FIX. The bypass is replaced by a narrow exemption INSIDE the derivation trigger, authorized by DATA no
-- caller can write rather than by a setting any caller can set. An UPDATE may keep a requested `expired` only
-- when all of these hold:
--   1. it executes as the owner of expire_transcripts_newest_one — a client's UPDATE runs as `authenticated`
--      and never matches;
--   2. a row in transcript_retention_expiry_grants names THIS transaction and THIS session. Only
--      expire_transcripts_newest_one writes that table (no role holds any privilege on it), and it deletes its
--      grants as soon as its UPDATE is done, so a grant never outlives the statement it authorizes and a
--      rollback takes it with everything else. A custom setting was rejected: any caller can set one, and a
--      nested SECURITY DEFINER write would then satisfy condition 1;
--   3. the new row has no text, and the old row's exact text is already preserved in
--      transcript_retention_tombstones for that user — the same proof the mutation's own UPDATE requires.
-- Anything else derives exactly as before, and an expired row stays sticky exactly as before.
--
-- WHAT ELSE CHANGES, AND WHY IT IS INTENDED. `replica` silenced EVERY ordinary trigger on sessions for the
-- UPDATE, not only the derivation. Without it:
--   * trg_sessions_purge_derived_on_expire (20260810120000) now fires, so an expired row's ai_suggestions are
--     nulled with its transcript — that migration's stated contract, which the bypass silently skipped;
--   * the #1476 write fence and the #1258 product guard run; neither refuses a transcript-only change to a
--     completed row;
--   * foreign keys are enforced for the UPDATE, as they already were for the tombstone INSERT.
-- Ranking, batching, bounds, fail-closed guards, tombstones, the content-free result and EXECUTE grants are
-- unchanged. No other function is redefined: converge_transcript_retention and complete_session_v2 reach the
-- mutation by name.
--
-- OPERATIONAL IMPACT. Applying the migration touches no row. Afterwards the expiry succeeds where it now fails:
-- an armed user's next save that reaches it expires their older completed transcripts (newest-one, at most 500
-- per call), preserving each exact text in the service-only tombstone, and nulls those rows' ai_suggestions.
-- A terminal Progress evaluation that reaches it through trg_spe_converge_retention (which swallows errors, so
-- today it silently expires nothing) does the same.
--
-- ROLLBACK. A further forward migration re-creating the 20260908120000 definitions of both functions, then
-- dropping transcript_retention_expiry_grants. That restores the 42501 on saves that reach the expiry. Text
-- expired in between is recoverable from transcript_retention_tombstones.
--
-- NOT APPLIED BY MERGE. Applying this migration is a separate, PO-authorized step.
-- =========================================================================================================

-- 1) Per-transaction, per-session authority for the retention mutation's one UPDATE. Transient by construction:
--    rows are inserted and deleted inside expire_transcripts_newest_one's own transaction. No foreign key, so
--    the grant never adds a lock or cascade to the sessions write it authorizes.
CREATE TABLE IF NOT EXISTS public.transcript_retention_expiry_grants (
  txid       bigint NOT NULL,
  session_id uuid   NOT NULL,
  PRIMARY KEY (txid, session_id)
);

ALTER TABLE public.transcript_retention_expiry_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transcript_retention_expiry_grants FROM PUBLIC, anon, authenticated, service_role;

-- 2) The derivation trigger, with the retention mutation's exemption.
CREATE OR REPLACE FUNCTION public.sessions_set_transcript_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- STICKY + INVARIANT (unchanged): an expired row stays expired and its transcript stays NULL, so a later
  -- ordinary re-save can never reintroduce retention-removed text.
  IF TG_OP = 'UPDATE' AND OLD.transcript_state = 'expired' THEN
    NEW.transcript_state := 'expired';
    NEW.transcript := NULL;
    RETURN NEW;
  END IF;

  -- Condition 1. Nothing here reads a table a client can't read, so an ordinary client UPDATE is unaffected.
  IF TG_OP = 'UPDATE'
     AND NEW.transcript_state = 'expired'
     AND NEW.transcript IS NULL
     AND current_user = (
       SELECT pg_catalog.pg_get_userbyid(p.proowner)
       FROM pg_catalog.pg_proc p
       WHERE p.oid = pg_catalog.to_regprocedure('public.expire_transcripts_newest_one(uuid, integer)')
     ) THEN
    -- Conditions 2 and 3, as their own statement so only the owner ever reads these service-only tables.
    IF EXISTS (
      SELECT 1 FROM public.transcript_retention_expiry_grants g
      WHERE g.txid = pg_catalog.txid_current() AND g.session_id = OLD.id
    ) AND EXISTS (
      SELECT 1 FROM public.transcript_retention_tombstones t
      WHERE t.session_id = OLD.id AND t.user_id = OLD.user_id AND t.transcript = OLD.transcript
    ) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Server-owned derivation (unchanged): a client can never self-assert a state, least of all `expired`.
  IF NEW.transcript IS NOT NULL AND NEW.transcript ~ '[^[:space:]]' THEN
    NEW.transcript_state := 'available';
  ELSE
    NEW.transcript_state := 'not_captured';
  END IF;
  RETURN NEW;
END;
$$;

-- 3) The bounded mutation: identical to 20260908120000 except that the superuser-only setting is replaced by
--    the per-transaction grants the trigger above honours.
CREATE OR REPLACE FUNCTION public.expire_transcripts_newest_one(
  p_user_id uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_viol     record;
  v_affected integer := 0;
  v_has_more boolean := false;
BEGIN
  -- Argument bounds (fail closed), IDENTICAL to newest-two. p_batch_size = 1 is the exact minimum
  -- boundary and MUST succeed; the 5000 ceiling bounds how much this destructive statement can scrub
  -- in one transaction. Dropping the ceiling made an unbounded batch legal against a function whose
  -- whole job is NULLing user transcripts.
  IF p_batch_size IS NULL OR p_batch_size <= 0 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_one: p_batch_size % out of bounds (1..5000)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- Fail closed on any pre-existing contradiction in scope (empty-on-available / expired-with-text /
  -- not_captured-with-real-text / unknown state). NEVER scrub an inconsistent cohort: if the stored
  -- state and the stored text already disagree, this function cannot tell which one is the truth, and
  -- expiring on top of that destroys the evidence needed to find out. Checked BEFORE the expiry
  -- marker and before any destructive write.
  SELECT * INTO v_viol FROM public.transcript_retention_invariant_violations(p_user_id);
  IF v_viol.expired_with_text > 0
     OR v_viol.available_without_text > 0
     OR v_viol.not_captured_with_text > 0
     OR v_viol.unknown_state > 0 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_one: invariant violations in scope (expired_with_text=%, available_without_text=%, not_captured_with_text=%, unknown_state=%); refusing to run',
      v_viol.expired_with_text, v_viol.available_without_text, v_viol.not_captured_with_text, v_viol.unknown_state
      USING ERRCODE = '23514';
  END IF;

  -- A tombstone is immutable evidence for one exact live transcript. Refuse a contradiction rather than
  -- overwrite either copy or destroy the only known-good one.
  IF EXISTS (
    SELECT 1
    FROM public.sessions s
    JOIN public.transcript_retention_tombstones t ON t.session_id = s.id
    WHERE s.transcript IS NOT NULL
      AND (t.user_id IS DISTINCT FROM s.user_id OR t.transcript IS DISTINCT FROM s.transcript)
      AND (p_user_id IS NULL OR s.user_id = p_user_id)
  ) THEN
    RAISE EXCEPTION 'expire_transcripts_newest_one: tombstone contradiction in scope; refusing to run'
      USING ERRCODE = '23514';
  END IF;

  WITH ranked AS (
    SELECT id, user_id, transcript,
           row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.sessions
    WHERE status = 'completed'
      AND transcript IS NOT NULL
      AND transcript ~ '[^[:space:]]'
      AND (p_user_id IS NULL OR user_id = p_user_id)
  ),
  batch AS MATERIALIZED (
    SELECT id, user_id, transcript FROM ranked WHERE rn > 1 ORDER BY id LIMIT p_batch_size
  )
  INSERT INTO public.transcript_retention_tombstones
    (session_id, user_id, transcript, policy_version)
  SELECT id, user_id, transcript, public.transcript_retention_policy_version()
  FROM batch
  ON CONFLICT (session_id) DO NOTHING;

  -- The sessions state transition is the only write the derivation trigger must let through: grant exactly the
  -- rows the UPDATE below will expire (same ranking, same tombstone proof), for this transaction only.
  WITH ranked AS (
    SELECT id, user_id, transcript,
           row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.sessions
    WHERE status = 'completed'
      AND transcript IS NOT NULL
      AND transcript ~ '[^[:space:]]'
      AND (p_user_id IS NULL OR user_id = p_user_id)
  ),
  batch AS MATERIALIZED (
    SELECT id, user_id, transcript FROM ranked WHERE rn > 1 ORDER BY id LIMIT p_batch_size
  )
  INSERT INTO public.transcript_retention_expiry_grants (txid, session_id)
  SELECT pg_catalog.txid_current(), b.id
  FROM batch b
  WHERE EXISTS (
    SELECT 1 FROM public.transcript_retention_tombstones t
    WHERE t.session_id = b.id AND t.user_id = b.user_id AND t.transcript = b.transcript
  )
  ON CONFLICT DO NOTHING;

  WITH ranked AS (
    SELECT id, user_id, transcript,
           row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.sessions
    WHERE status = 'completed'
      AND transcript IS NOT NULL
      AND transcript ~ '[^[:space:]]'
      AND (p_user_id IS NULL OR user_id = p_user_id)
  ),
  batch AS MATERIALIZED (
    SELECT id, user_id, transcript FROM ranked WHERE rn > 1 ORDER BY id LIMIT p_batch_size
  )
  UPDATE public.sessions s
  SET transcript = NULL,
      transcript_state = 'expired'
  FROM batch b
  WHERE s.id = b.id
    AND EXISTS (
      SELECT 1 FROM public.transcript_retention_tombstones t
      WHERE t.session_id = b.id AND t.user_id = b.user_id AND t.transcript = b.transcript
    );
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  -- The grants authorized that one statement and nothing after it.
  DELETE FROM public.transcript_retention_expiry_grants WHERE txid = pg_catalog.txid_current();

  -- Remaining-work indicator, computed AFTER this batch. Idempotent by construction: a second run over a
  -- converged user expires 0 and reports has_more false.
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
      FROM public.sessions
      WHERE status = 'completed'
        AND transcript IS NOT NULL
        AND transcript ~ '[^[:space:]]'
        AND (p_user_id IS NULL OR user_id = p_user_id)
    ) r WHERE r.rn > 1
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'policy_version', public.transcript_retention_policy_version(),
    'scope',          CASE WHEN p_user_id IS NULL THEN 'all_users' ELSE 'single_user' END,
    'expired_count',  v_affected,
    'has_more',       v_has_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_transcripts_newest_one(uuid, integer)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_transcripts_newest_one(uuid, integer) TO service_role;
