-- Focus Points: keep a partly-made point ("yellow") yellow when the take is reopened.
--
-- Before this change the saved verdict was binary: any detection offset became 'detected', so a point the speaker
-- only partly made was saved and reopened exactly like a fully made one. This adds ONE optional, content-free field
-- beside the existing verdict. The verdict enum, its derivation, every existing reader (coaching, analytics, cleanup,
-- retention) and every old row are unchanged: `coverage` is NULL unless the client sends it with a detection.
--
-- Allowed values: 'covered' | 'partial' (a closed set; nothing the user said is stored here).


ALTER TABLE public.objective_evidence
  ADD COLUMN IF NOT EXISTS coverage text
  CONSTRAINT objective_evidence_coverage_closed CHECK (coverage IS NULL OR coverage IN ('covered', 'partial'));

-- The guarded wrapper (objective_finalize_evidence_v1 → require_product_access) is untouched; only the unguarded body
-- it calls is replaced, with the same signature, owner, SECURITY DEFINER, search_path and (empty) ACL.
CREATE OR REPLACE FUNCTION public.objective_finalize_evidence_v1__unguarded(
    p_session_id uuid, p_signals jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_session public.objective_session%ROWTYPE;
    v_approved text := public.objective_approved_predicate_version();
    v_predicate text;
    v_count integer;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;
    IF NOT public.has_objective_capability() THEN
        RAISE EXCEPTION 'objective capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    SELECT * INTO v_session FROM public.objective_session WHERE id = p_session_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'session not found for owner' USING errcode = '42501'; END IF;
    v_predicate := v_session.detector_version;

    -- ATOMIC payload validation FIRST, before any write (unchanged): every detected offset inside [0, duration].
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_signals, '[]'::jsonb)) s
        WHERE (s->>'detected_at_seconds') IS NOT NULL
          AND ((s->>'detected_at_seconds')::int < 0
               OR (s->>'detected_at_seconds')::int > v_session.actual_duration_seconds)
    ) THEN
        RAISE EXCEPTION 'malformed detector payload: a detected offset is outside the recording window [0, %]',
            v_session.actual_duration_seconds USING errcode = '22023';
    END IF;
    -- NEW: coverage, when present, must be one of the closed values, and only with a detection offset. A malformed
    -- value rejects the whole finalize (no partial write), like an out-of-range offset.
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_signals, '[]'::jsonb)) s
        WHERE s ? 'coverage' AND s->'coverage' <> 'null'::jsonb
          AND (jsonb_typeof(s->'coverage') <> 'string'
               OR (s->>'coverage') NOT IN ('covered', 'partial')
               OR (s->>'detected_at_seconds') IS NULL)
    ) THEN
        RAISE EXCEPTION 'malformed detector payload: coverage must be covered or partial, and only with a detection'
            USING errcode = '22023';
    END IF;

    UPDATE public.objective_session SET finalized_at = now()
        WHERE id = p_session_id AND finalized_at IS NULL;
    IF FOUND THEN
        INSERT INTO public.objective_evidence (session_id, user_id, brief_point_id, verdict, predicate_version, detected_at_seconds, coverage)
        SELECT
            p_session_id, v_uid, bp.id,
            CASE
                WHEN sig.detected_at_seconds IS NOT NULL THEN 'detected'::public.objective_evidence_verdict
                WHEN v_predicate = v_approved THEN 'not_detected'::public.objective_evidence_verdict
                ELSE 'unavailable'::public.objective_evidence_verdict
            END,
            v_predicate,
            sig.detected_at_seconds,
            CASE WHEN sig.detected_at_seconds IS NOT NULL THEN sig.coverage END
        FROM public.objective_brief_point bp
        LEFT JOIN LATERAL (
            SELECT (s->>'detected_at_seconds')::int AS detected_at_seconds,
                   NULLIF(s->>'coverage', '') AS coverage
            FROM jsonb_array_elements(COALESCE(p_signals, '[]'::jsonb)) s
            WHERE (s->>'brief_point_id')::uuid = bp.id
              AND (s->>'detected_at_seconds') IS NOT NULL
            LIMIT 1
        ) sig ON true
        WHERE bp.brief_id = v_session.brief_id;
    END IF;

    SELECT count(*) INTO v_count FROM public.objective_evidence WHERE session_id = p_session_id;
    RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.objective_finalize_evidence_v1__unguarded(p_session_id uuid, p_signals jsonb) FROM PUBLIC, anon, authenticated, service_role;

