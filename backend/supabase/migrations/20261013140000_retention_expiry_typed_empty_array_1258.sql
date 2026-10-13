-- =========================================================================================================
-- #1258 P0 FOLLOW-UP — TYPE THE EMPTY ARRAY IN THE RETENTION EXPIRY. Forward-only correction of 20261013120000.
--
-- WHY. Applying 20261013120000 to Production (run 38428832342) deployed the reviewed definitions and passed its
-- postflight, but the exact-apply lint gate failed: `supabase db lint` (plpgsql_check) reported a NEW warning on
-- public.expire_transcripts_newest_one, 42804 "target type is different type than source type", cast "text" value to
-- "uuid[]", at the initialization of the local variable `v_new_tombstones uuid[] := '{}'`.
--
-- WHAT. The same function, byte for byte, except two literals are typed: the variable's initializer and the
-- `coalesce` fallback become `'{}'::uuid[]`. At runtime PostgreSQL already coerced both, so behaviour is unchanged;
-- the change exists so the static checker sees the types it expects and Production lint returns to its baseline.
-- Nothing else is redefined: the derivation trigger, the grants table and every ACL stay as 20261013120000 left them.
-- EXECUTE is re-asserted service_role-only.
--
-- OPERATIONAL IMPACT. Touches no row. ROLLBACK: re-running the 20261013120000 definition restores the warning only.
-- NOT APPLIED BY MERGE. Applying this migration is a separate, PO-authorized step.
-- =========================================================================================================

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
  v_new_tombstones uuid[] := '{}'::uuid[];
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
  ),
  inserted AS (
    INSERT INTO public.transcript_retention_tombstones
      (session_id, user_id, transcript, policy_version)
    SELECT id, user_id, transcript, public.transcript_retention_policy_version()
    FROM batch
    ON CONFLICT (session_id) DO NOTHING
    RETURNING session_id
  )
  -- Remember which tombstones THIS run wrote, so any whose row it does not expire can be withdrawn below.
  SELECT coalesce(array_agg(session_id), '{}'::uuid[]) INTO v_new_tombstones FROM inserted;

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

  -- Expire ONLY rows granted above in this transaction, and of those only the ones that are still not the user's newest
  -- and still carry exactly their tombstoned text. Each statement here reads its own READ COMMITTED snapshot, so the
  -- UPDATE must never re-rank its way to a row this transaction did not grant: the trigger would refuse `expired` for it
  -- and the row would lose its text as `not_captured` (PM review 6148401799). The grant set already honours p_batch_size.
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
    SELECT r.id, r.user_id, r.transcript
    FROM ranked r
    JOIN public.transcript_retention_expiry_grants g
      ON g.session_id = r.id AND g.txid = pg_catalog.txid_current()
    WHERE r.rn > 1
  )
  -- The row being updated must still BE the selected version (PM review 6148753844): under READ COMMITTED a row edited
  -- and committed after `batch` was read is re-checked against these predicates on its newer version. Matching by id
  -- alone would null the newer text, which has no tombstone, and the trigger would label it `not_captured`.
  UPDATE public.sessions s
  SET transcript = NULL,
      transcript_state = 'expired'
  FROM batch b
  WHERE s.id = b.id
    AND s.user_id = b.user_id
    AND s.transcript = b.transcript
    AND s.status = 'completed'
    AND EXISTS (
      SELECT 1 FROM public.transcript_retention_tombstones t
      WHERE t.session_id = b.id AND t.user_id = b.user_id AND t.transcript = b.transcript
    );
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  -- A row this run tombstoned but did not expire (edited after selection, or no longer ranked for expiry) keeps its own
  -- text. Its new tombstone holds text the user no longer has there and would make every later expiry for that user
  -- refuse as a contradiction, so it is withdrawn. Tombstones of expired rows, and any written by earlier runs, stay.
  DELETE FROM public.transcript_retention_tombstones t
  USING public.sessions s
  WHERE t.session_id = ANY (v_new_tombstones)
    AND s.id = t.session_id
    AND s.transcript_state <> 'expired';

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
