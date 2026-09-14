-- RWT-05 — Focus Points eligibility reads the server-owned attribution authority.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR. Applying it is a separate Product Owner decision.
--
-- WHY. 20260803010000 (#1161) moved engine attribution into public.session_attribution_authority, written only by
-- the service-role attest_session_engine_v1, and removed sessions.attribution_status from the client UPDATE
-- whitelist. No server path writes that column, so it stays at its 'pending' default. The objective functions from
-- 20260807000000 still required attribution_status = 'verified'. Every attested Private recording was therefore
-- refused ("source recording attribution is not verified", surfaced as the objective-register-source 422), while a
-- row carrying a stale 'verified' value and no authority row was accepted.
--
-- WHAT. CREATE OR REPLACE of objective_start_session_v1 and objective_register_source_v1 with one change each: the
-- eligibility check requires an attrib_v1 authority row for the same owner with engine_class = 'private'. Every
-- other check, message, errcode, return value and the idempotency logic are copied verbatim from 20260807000000.
--
-- GRANTS. CREATE OR REPLACE preserves each function's ACL, and the SET search_path clause is re-declared with the
-- identical value, so no GRANT/REVOKE is restated. The pending 20260811143000 hardening stays the only source of the
-- final grants.
--
-- ROLLBACK. Re-run the two CREATE OR REPLACE FUNCTION statements from 20260807000000.

CREATE OR REPLACE FUNCTION public.objective_start_session_v1(
    p_project_id uuid, p_brief_id uuid, p_source_session_id uuid,
    p_detector_version text, p_formula_version text, p_idempotency_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_brief public.objective_brief%ROWTYPE;
    v_src RECORD;
    v_engine_version text;
    v_duration integer;
    v_existing public.objective_session%ROWTYPE;
    v_session_id uuid;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;
    IF NOT public.has_objective_capability() THEN
        RAISE EXCEPTION 'objective capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    -- Only the fixed v1 selector actually runs; reject any other formula so recorded provenance is truthful.
    IF p_formula_version IS DISTINCT FROM 'objective_action_v1' THEN
        RAISE EXCEPTION 'unsupported action formula version' USING errcode = '22023';
    END IF;
    -- Brief must belong to the caller AND to the named project (server-verified; no cross-owner spoofing).
    SELECT * INTO v_brief FROM public.objective_brief
        WHERE id = p_brief_id AND user_id = v_uid AND project_id = p_project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'brief not found for owner/project' USING errcode = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.objective_project WHERE id = p_project_id AND user_id = v_uid) THEN
        RAISE EXCEPTION 'project not found for owner' USING errcode = '42501';
    END IF;

    -- RWT-05: eligibility follows the SERVER-OWNED attribution authority (#1161), never the frozen legacy
    -- sessions.attribution_status column. Only the service-role attest_session_engine_v1 writes the authority, and
    -- only a clean Private attestation qualifies. Ownership and duration still come from the persisted recording.
    SELECT engine, engine_version, duration INTO v_src
        FROM public.sessions WHERE id = p_source_session_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'source session not owned by caller' USING errcode = '42501'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_source_session_id AND a.user_id = v_uid
          AND a.authority_version = 'attrib_v1' AND a.engine_class = 'private'
    ) THEN
        RAISE EXCEPTION 'source recording attribution is not verified' USING errcode = '42501';
    END IF;
    IF v_src.engine IS NULL OR lower(v_src.engine) NOT LIKE 'private%' THEN
        RAISE EXCEPTION 'source recording is not a verified Private engine' USING errcode = '42501';
    END IF;
    -- Requires the recording to be server-registered in objective_source_recording (register_source is
    -- service-role only, so a client cannot self-register). CORRECTION (2026-08-08): the prior comment
    -- overstated this as "verified-Private alone is not Objective intent". In fact there is NO server-
    -- verifiable objective/Freestyle "mode" — `sessions` has no such column, and register_source only
    -- checks verified-Private + ownership, not intent. So this guard proves only "a service-role path
    -- stamped this recording", NOT that it was recorded in Focus Points mode. The Open-Floor-vs-Focus-
    -- Points separation therefore rests on server-side discipline: only stamp recordings that came through
    -- the genuine Focus Points flow (see the objective-register-source Edge Function / its invoker).
    IF NOT EXISTS (SELECT 1 FROM public.objective_source_recording WHERE session_id = p_source_session_id AND user_id = v_uid) THEN
        RAISE EXCEPTION 'source recording is not registered for Objective (a Freestyle recording cannot attach)' USING errcode = '42501';
    END IF;
    v_engine_version := COALESCE(v_src.engine_version, v_src.engine);
    v_duration := COALESCE(v_src.duration, 0);  -- authoritative persisted duration; the caller never supplies it.

    -- Idempotent replay pre-check (null-safe on every immutable field).
    SELECT * INTO v_existing FROM public.objective_session
        WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        PERFORM public.objective_assert_start_identity(v_existing, p_project_id, p_brief_id, v_brief.version,
            p_source_session_id, p_detector_version, p_formula_version, v_duration);
        RETURN v_existing.id;  -- true idempotent replay: same identity, same row.
    END IF;

    INSERT INTO public.objective_session (
        user_id, project_id, brief_id, brief_version, source_session_id, practice_domain,
        speech_runtime, engine_version, detector_version, formula_version,
        time_budget_seconds, actual_duration_seconds, idempotency_key
    ) VALUES (
        v_uid, p_project_id, p_brief_id, v_brief.version, p_source_session_id, 'objective',
        'private', v_engine_version, p_detector_version, p_formula_version,
        v_brief.time_budget_seconds, v_duration, p_idempotency_key
    )
    ON CONFLICT (user_id, idempotency_key) DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
        -- Lost the concurrent insert race on this key: load the FULL winning row and re-validate identity, so a
        -- racing mismatched request is rejected instead of silently receiving another identity's session.
        SELECT * INTO v_existing FROM public.objective_session
            WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
        PERFORM public.objective_assert_start_identity(v_existing, p_project_id, p_brief_id, v_brief.version,
            p_source_session_id, p_detector_version, p_formula_version, v_duration);
        v_session_id := v_existing.id;
    END IF;
    RETURN v_session_id;
END $$;

CREATE OR REPLACE FUNCTION public.objective_register_source_v1(p_source_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_owner uuid;
    v_engine text;
BEGIN
    -- SERVICE-ROLE / INTERNAL ONLY (per decision 5174279093): a client cannot execute this (grants in 20260807000000), so a
    -- capable client can NEVER self-register a Freestyle recording. The owner is derived from the persisted
    -- recording (a service-role caller carries no user auth.uid()); verified-Private required; idempotent.
    -- RWT-05: "verified" means a clean Private attestation in session_attribution_authority (#1161).
    SELECT user_id, engine INTO v_owner, v_engine
        FROM public.sessions WHERE id = p_source_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'source session not found' USING errcode = '42501'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_source_session_id AND a.user_id = v_owner
          AND a.authority_version = 'attrib_v1' AND a.engine_class = 'private'
    ) THEN
        RAISE EXCEPTION 'source recording attribution is not verified' USING errcode = '42501';
    END IF;
    IF v_engine IS NULL OR lower(v_engine) NOT LIKE 'private%' THEN
        RAISE EXCEPTION 'source recording is not a verified Private engine' USING errcode = '42501';
    END IF;
    INSERT INTO public.objective_source_recording (session_id, user_id)
        VALUES (p_source_session_id, v_owner) ON CONFLICT (session_id) DO NOTHING;
    RETURN p_source_session_id;
END $$;
