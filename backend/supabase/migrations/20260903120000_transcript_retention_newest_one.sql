-- #1306/#1258 — RETAIN EXACTLY ONE TRANSCRIPT, AND STOP DELETING THE PRACTICE LOOP WITH ITS SESSION.
--
-- WHY. SpeakSharp keeps the transcript from the user's most recent saved session so they can review it
-- alongside the next practice action recommended from it. Saving a newer session replaces the retained
-- transcript. Practice metrics and Practice Loop history remain, so progress stays measurable.
--
-- Two independent changes, both required for that sentence to be true:
--
--   1. Retention drops from newest-two to newest-one.
--
--   2. The Practice Loop evidence is DECOUPLED from session lifetime. Today a recommendation is deleted
--      when its source session is deleted, an evaluation is deleted when its session is deleted, and an
--      attempt is deleted when its recommendation goes. Under newest-one, session A is removed as soon
--      as B is saved -- so the A->B measurement would delete itself at the exact moment it became
--      meaningful. Provenance becomes nullable instead: the loop record survives its source, and the
--      link simply becomes unknown rather than taking the evidence with it.
--
-- ADDITIVE. No historical migration is edited. Applying this to any environment is a separate decision.

BEGIN;

-- ── 1. Provenance must not be a lifeline ─────────────────────────────────────────────────────────────
--
-- ON DELETE CASCADE meant "this row exists only while its session does". For coaching evidence that is
-- wrong: the observation, the prescription, the acceptance and the outcome are the durable record, and
-- the session is merely where they came from. SET NULL keeps the record and forgets the origin.

ALTER TABLE public.progress_recommendations
  DROP CONSTRAINT IF EXISTS progress_recommendations_source_session_id_fkey;
ALTER TABLE public.progress_recommendations
  ALTER COLUMN source_session_id DROP NOT NULL;
ALTER TABLE public.progress_recommendations
  ADD CONSTRAINT progress_recommendations_source_session_id_fkey
  FOREIGN KEY (source_session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;

ALTER TABLE public.session_progress_evaluations
  DROP CONSTRAINT IF EXISTS session_progress_evaluations_session_id_fkey;
ALTER TABLE public.session_progress_evaluations
  ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE public.session_progress_evaluations
  ADD CONSTRAINT session_progress_evaluations_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;

-- An attempt records that the user accepted a prescription and what happened next. Losing the
-- recommendation must not erase the attempt: the outcome is the measurement.
ALTER TABLE public.progress_recommendation_attempts
  DROP CONSTRAINT IF EXISTS progress_recommendation_attempts_recommendation_id_fkey;
ALTER TABLE public.progress_recommendation_attempts
  ALTER COLUMN recommendation_id DROP NOT NULL;
ALTER TABLE public.progress_recommendation_attempts
  ADD CONSTRAINT progress_recommendation_attempts_recommendation_id_fkey
  FOREIGN KEY (recommendation_id) REFERENCES public.progress_recommendations(id) ON DELETE SET NULL;

-- ── 2. Newest-ONE retention ──────────────────────────────────────────────────────────────────────────
--
-- Same shape as the newest-two coordinator it replaces: bounded batch, fail-closed on any pre-existing
-- invariant violation, content-free result. The single behavioural difference is the rank boundary.
CREATE OR REPLACE FUNCTION public.expire_transcripts_newest_one(
  p_user_id    uuid DEFAULT NULL,
  p_batch_size integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_viol     record;
  v_affected integer;
  v_has_more boolean;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_one: p_batch_size % out of bounds (1..5000)', p_batch_size
      USING ERRCODE = '22023';
  END IF;

  -- Never scrub an inconsistent cohort: a contradiction in scope means we do not know what is true.
  SELECT * INTO v_viol FROM public.transcript_retention_invariant_violations(p_user_id);
  IF v_viol.expired_with_text > 0
     OR v_viol.available_without_text > 0
     OR v_viol.not_captured_with_text > 0
     OR v_viol.unknown_state > 0 THEN
    RAISE EXCEPTION 'expire_transcripts_newest_one: invariant violations in scope (expired_with_text=%, available_without_text=%, not_captured_with_text=%, unknown_state=%); refusing to run',
      v_viol.expired_with_text, v_viol.available_without_text, v_viol.not_captured_with_text, v_viol.unknown_state
      USING ERRCODE = '23514';
  END IF;

  SET LOCAL session_replication_role = 'replica';

  WITH ranked AS (
    SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
    FROM public.sessions
    WHERE transcript IS NOT NULL
      AND transcript ~ '[^[:space:]]'
      AND (p_user_id IS NULL OR user_id = p_user_id)
  ),
  batch AS (
    -- rn > 1: only the newest transcript-bearing session keeps its text. A BLANK transcript never ranks,
    -- so a failed or discarded save cannot displace a real one.
    SELECT id FROM ranked WHERE rn > 1 ORDER BY id LIMIT p_batch_size
  )
  UPDATE public.sessions s
  SET transcript = NULL,
      transcript_state = 'expired'
  WHERE s.id IN (SELECT id FROM batch);
  GET DIAGNOSTICS v_affected = ROW_COUNT;

  SET LOCAL session_replication_role = 'origin';

  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT row_number() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS rn
      FROM public.sessions
      WHERE transcript IS NOT NULL
        AND transcript ~ '[^[:space:]]'
        AND (p_user_id IS NULL OR user_id = p_user_id)
    ) r WHERE r.rn > 1
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'policy_version', 'newest_one_v1',
    'expired_count', v_affected,
    'has_more', v_has_more
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expire_transcripts_newest_one(uuid, integer) FROM PUBLIC;

COMMENT ON FUNCTION public.expire_transcripts_newest_one(uuid, integer) IS
  'Retains the transcript of the newest transcript-bearing saved session per user; expires older ones. '
  'Blank transcripts never rank. Metrics, recommendations, attempts and outcomes are untouched.';

COMMIT;
