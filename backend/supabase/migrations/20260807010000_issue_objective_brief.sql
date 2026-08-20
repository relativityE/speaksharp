-- #1046 G2 — focus-point capture write path.
-- G1/objective foundation left objective_brief / objective_brief_point RLS SELECT-only (no client
-- INSERT). This adds the ONE missing write RPC so a user can persist a brief (their focus points)
-- before a Guided (objective) session. SECURITY DEFINER + pinned search_path + owner-scoped, mirroring
-- the #1163 attribution RPC pattern. Depends on 20260807000000_rename_guided_to_objective.sql.

CREATE OR REPLACE FUNCTION public.issue_objective_brief_v1(
    p_project_id           uuid,
    p_event_goal           text,
    p_time_budget_seconds  integer,
    p_audience             text,
    p_points               jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid      uuid := auth.uid();
    v_brief_id uuid;
    v_version  integer;
    v_point    jsonb;
    v_idx      integer := 0;
    v_label    text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth required' USING errcode = '28000';
    END IF;
    IF NOT public.has_objective_capability() THEN
        RAISE EXCEPTION 'objective capability required' USING errcode = '42501';
    END IF;
    -- Owner-scoped project guard: the caller must own the project the brief attaches to.
    IF NOT EXISTS (SELECT 1 FROM public.objective_project WHERE id = p_project_id AND user_id = v_uid) THEN
        RAISE EXCEPTION 'project not found for owner' USING errcode = '42501';
    END IF;
    IF btrim(coalesce(p_event_goal, '')) = '' THEN
        RAISE EXCEPTION 'event_goal must be non-blank' USING errcode = '22023';
    END IF;
    IF p_time_budget_seconds IS NULL OR p_time_budget_seconds <= 0 THEN
        RAISE EXCEPTION 'time_budget_seconds must be positive' USING errcode = '22023';
    END IF;
    IF p_points IS NULL OR jsonb_typeof(p_points) <> 'array' OR jsonb_array_length(p_points) = 0 THEN
        RAISE EXCEPTION 'at least one focus point is required' USING errcode = '22023';
    END IF;

    -- Immutable, versioned brief: an edit issues the NEXT version (never rewrites an existing one).
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.objective_brief WHERE project_id = p_project_id AND user_id = v_uid;

    INSERT INTO public.objective_brief (project_id, user_id, version, event_goal, audience, time_budget_seconds)
    VALUES (p_project_id, v_uid, v_version, p_event_goal, p_audience, p_time_budget_seconds)
    RETURNING id INTO v_brief_id;

    FOR v_point IN SELECT * FROM jsonb_array_elements(p_points)
    LOOP
        v_label := v_point->>'label';
        IF btrim(coalesce(v_label, '')) = '' THEN
            RAISE EXCEPTION 'focus point label must be non-blank' USING errcode = '22023';
        END IF;
        INSERT INTO public.objective_brief_point (brief_id, user_id, sort_order, is_required, label, cue)
        VALUES (
            v_brief_id, v_uid, v_idx,
            COALESCE((v_point->>'is_required')::boolean, true),
            v_label,
            v_point->>'cue'
        );
        v_idx := v_idx + 1;
    END LOOP;

    RETURN v_brief_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_objective_brief_v1(uuid, text, integer, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.issue_objective_brief_v1(uuid, text, integer, text, jsonb) TO authenticated;

-- Companion write path: a brief requires an owned objective_project, but objective_project is RLS
-- SELECT-only too. This lets a user create a project (the container a brief attaches to). Same
-- SECURITY DEFINER + owner-scoped pattern.
CREATE OR REPLACE FUNCTION public.issue_objective_project_v1(p_title text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_id  uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth required' USING errcode = '28000';
    END IF;
    IF NOT public.has_objective_capability() THEN
        RAISE EXCEPTION 'objective capability required' USING errcode = '42501';
    END IF;
    IF btrim(coalesce(p_title, '')) = '' THEN
        RAISE EXCEPTION 'title must be non-blank' USING errcode = '22023';
    END IF;
    INSERT INTO public.objective_project (user_id, title)
    VALUES (v_uid, p_title)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_objective_project_v1(text) FROM public;
GRANT EXECUTE ON FUNCTION public.issue_objective_project_v1(text) TO authenticated;
