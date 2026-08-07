-- Forward-only internal-token rename: guided_ -> objective_  (#1149 N2.3, Refs #1046)
-- G1 (20260802000000) tables are hard-off and provably empty (no client INSERT grant,
-- no write RPC, no callers). This renames tables/enums/constraints/policies/index/functions
-- and the practice_domain discriminator value + version tags. No product names remain.
-- Additive & forward-only: the original G1 migration is preserved untouched.

-- 1. Tables
ALTER TABLE public.guided_account_capability RENAME TO objective_account_capability;
ALTER TABLE public.guided_project RENAME TO objective_project;
ALTER TABLE public.guided_brief RENAME TO objective_brief;
ALTER TABLE public.guided_brief_point RENAME TO objective_brief_point;
ALTER TABLE public.guided_session RENAME TO objective_session;
ALTER TABLE public.guided_source_recording RENAME TO objective_source_recording;
ALTER TABLE public.guided_evidence RENAME TO objective_evidence;
ALTER TABLE public.guided_action RENAME TO objective_action;
ALTER TABLE public.guided_action_dispute RENAME TO objective_action_dispute;

-- 2. Enum types
ALTER TYPE public.guided_evidence_verdict RENAME TO objective_evidence_verdict;
ALTER TYPE public.guided_action_kind RENAME TO objective_action_kind;

-- 3. Named constraints (renamed on the now-objective_ tables; domain CHECK handled in step 4)
ALTER TABLE public.objective_project RENAME CONSTRAINT guided_project_title_nonblank TO objective_project_title_nonblank;
ALTER TABLE public.objective_brief RENAME CONSTRAINT guided_brief_version_key TO objective_brief_version_key;
ALTER TABLE public.objective_brief RENAME CONSTRAINT guided_brief_version_positive TO objective_brief_version_positive;
ALTER TABLE public.objective_brief RENAME CONSTRAINT guided_brief_goal_nonblank TO objective_brief_goal_nonblank;
ALTER TABLE public.objective_brief RENAME CONSTRAINT guided_brief_budget_positive TO objective_brief_budget_positive;
ALTER TABLE public.objective_brief_point RENAME CONSTRAINT guided_point_order_key TO objective_point_order_key;
ALTER TABLE public.objective_brief_point RENAME CONSTRAINT guided_point_label_nonblank TO objective_point_label_nonblank;
ALTER TABLE public.objective_brief_point RENAME CONSTRAINT guided_point_order_nonneg TO objective_point_order_nonneg;
ALTER TABLE public.objective_session RENAME CONSTRAINT guided_session_idem_key TO objective_session_idem_key;
ALTER TABLE public.objective_session RENAME CONSTRAINT guided_session_runtime_private TO objective_session_runtime_private;
ALTER TABLE public.objective_session RENAME CONSTRAINT guided_session_budget_positive TO objective_session_budget_positive;
ALTER TABLE public.objective_session RENAME CONSTRAINT guided_session_duration_nonneg TO objective_session_duration_nonneg;
ALTER TABLE public.objective_session RENAME CONSTRAINT guided_session_brief_version_positive TO objective_session_brief_version_positive;
ALTER TABLE public.objective_evidence RENAME CONSTRAINT guided_evidence_point_key TO objective_evidence_point_key;
ALTER TABLE public.objective_evidence RENAME CONSTRAINT guided_evidence_detected_offset TO objective_evidence_detected_offset;
ALTER TABLE public.objective_action RENAME CONSTRAINT guided_action_lifecycle_check TO objective_action_lifecycle_check;
ALTER TABLE public.objective_action RENAME CONSTRAINT guided_action_kind_shape TO objective_action_kind_shape;

-- 4. practice_domain discriminator value guided -> objective (empty tables; value + default + CHECK)
ALTER TABLE public.objective_session ALTER COLUMN practice_domain SET DEFAULT 'objective';
ALTER TABLE public.objective_session DROP CONSTRAINT guided_session_domain_guided;
ALTER TABLE public.objective_session ADD CONSTRAINT objective_session_domain_objective CHECK (practice_domain = 'objective');

-- 5. Indexes
ALTER INDEX public.idx_guided_session_project RENAME TO idx_objective_session_project;

-- 6. RLS policies
ALTER POLICY "guided_capability_select_own" ON public.objective_account_capability RENAME TO "objective_capability_select_own";
ALTER POLICY "guided_project_select_own" ON public.objective_project RENAME TO "objective_project_select_own";
ALTER POLICY "guided_brief_select_own" ON public.objective_brief RENAME TO "objective_brief_select_own";
ALTER POLICY "guided_point_select_own" ON public.objective_brief_point RENAME TO "objective_point_select_own";
ALTER POLICY "guided_session_select_own" ON public.objective_session RENAME TO "objective_session_select_own";
ALTER POLICY "guided_source_recording_select_own" ON public.objective_source_recording RENAME TO "objective_source_recording_select_own";
ALTER POLICY "guided_evidence_select_own" ON public.objective_evidence RENAME TO "objective_evidence_select_own";
ALTER POLICY "guided_action_select_own" ON public.objective_action RENAME TO "objective_action_select_own";
ALTER POLICY "guided_dispute_select_own" ON public.objective_action_dispute RENAME TO "objective_dispute_select_own";

-- 7. Drop old functions (reverse dependency order)
DROP FUNCTION IF EXISTS public.guided_dispute_action_v1;
DROP FUNCTION IF EXISTS public.guided_select_action_v1;
DROP FUNCTION IF EXISTS public.guided_finalize_evidence_v1;
DROP FUNCTION IF EXISTS public.guided_register_source_v1;
DROP FUNCTION IF EXISTS public.guided_start_session_v1;
DROP FUNCTION IF EXISTS public.guided_assert_start_identity;
DROP FUNCTION IF EXISTS public.guided_approved_predicate_version;
DROP FUNCTION IF EXISTS public.has_guided_capability;

-- 8. Recreate as objective_ functions (bodies transformed)
CREATE OR REPLACE FUNCTION public.has_objective_capability()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT enabled FROM public.objective_account_capability WHERE user_id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION public.objective_approved_predicate_version()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'cue_v1'::text $$;

CREATE OR REPLACE FUNCTION public.objective_assert_start_identity(
    v_existing public.objective_session, p_project_id uuid, p_brief_id uuid, p_brief_version integer,
    p_source_session_id uuid, p_detector_version text, p_formula_version text, p_duration integer
) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF v_existing.project_id             IS DISTINCT FROM p_project_id
       OR v_existing.brief_id            IS DISTINCT FROM p_brief_id
       OR v_existing.brief_version       IS DISTINCT FROM p_brief_version
       OR v_existing.source_session_id   IS DISTINCT FROM p_source_session_id
       OR v_existing.detector_version    IS DISTINCT FROM p_detector_version
       OR v_existing.formula_version     IS DISTINCT FROM p_formula_version
       OR v_existing.actual_duration_seconds IS DISTINCT FROM p_duration THEN
        RAISE EXCEPTION 'idempotency key reused with a different session identity' USING errcode = '23505';
    END IF;
END $$;

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

    -- Read the persisted recording's currently-stored attribution + duration (never caller input). G1 checks
    -- attribution_status='verified' + a Private engine as a TRANSITIONAL persisted-field contract — those columns
    -- are client-writable today (#1161), so this is NOT a server-verified/spoof-proof guarantee. It rejects
    -- null/foreign/unverified/non-Private persisted sources; hardening the fields themselves is #1161's scope.
    SELECT engine, engine_version, attribution_status, duration INTO v_src
        FROM public.sessions WHERE id = p_source_session_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'source session not owned by caller' USING errcode = '42501'; END IF;
    IF v_src.attribution_status IS DISTINCT FROM 'verified' THEN
        RAISE EXCEPTION 'source recording attribution is not verified' USING errcode = '42501';
    END IF;
    IF v_src.engine IS NULL OR lower(v_src.engine) NOT LIKE 'private%' THEN
        RAISE EXCEPTION 'source recording is not a verified Private engine' USING errcode = '42501';
    END IF;
    -- Freestyle-vs-Objective isolation: the recording must have been server-registered as a Objective source. A
    -- verified-Private FREESTYLE recording (never registered) cannot attach — verified-Private alone is not
    -- Objective intent.
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
    v_attr text;
BEGIN
    -- SERVICE-ROLE / INTERNAL ONLY (per decision 5174279093): a client cannot execute this (grants below), so a
    -- capable client can NEVER self-register a Freestyle recording. The owner is derived from the persisted
    -- recording (a service-role caller carries no user auth.uid()); verified-Private required; idempotent.
    SELECT user_id, engine, attribution_status INTO v_owner, v_engine, v_attr
        FROM public.sessions WHERE id = p_source_session_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'source session not found' USING errcode = '42501'; END IF;
    IF v_attr IS DISTINCT FROM 'verified' THEN
        RAISE EXCEPTION 'source recording attribution is not verified' USING errcode = '42501';
    END IF;
    IF v_engine IS NULL OR lower(v_engine) NOT LIKE 'private%' THEN
        RAISE EXCEPTION 'source recording is not a verified Private engine' USING errcode = '42501';
    END IF;
    INSERT INTO public.objective_source_recording (session_id, user_id)
        VALUES (p_source_session_id, v_owner) ON CONFLICT (session_id) DO NOTHING;
    RETURN p_source_session_id;
END $$;

CREATE OR REPLACE FUNCTION public.objective_finalize_evidence_v1(
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
    -- Re-check capability on every mutation: a server-revoked/deleted capability must immediately make Objective
    -- unavailable, even for a session that was started while enabled (revocation is honored, not bypassed).
    IF NOT public.has_objective_capability() THEN
        RAISE EXCEPTION 'objective capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    SELECT * INTO v_session FROM public.objective_session WHERE id = p_session_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'session not found for owner' USING errcode = '42501'; END IF;
    v_predicate := v_session.detector_version;  -- the immutable predicate captured at session start.

    -- ATOMIC payload validation FIRST, before any write: every supplied detected offset must fall within the
    -- frozen authoritative recording window [0, actual_duration_seconds]. An out-of-range offset is a malformed
    -- detector payload — reject the ENTIRE finalize (no evidence rows, no action, no finalized_at latch) so a
    -- malformed/incomplete response is never silently discarded into a misleading verdict; a corrected retry can
    -- then finalize normally. The bound is the PERSISTED duration, never a caller-supplied value.
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(p_signals, '[]'::jsonb)) s
        WHERE (s->>'detected_at_seconds') IS NOT NULL
          AND ((s->>'detected_at_seconds')::int < 0
               OR (s->>'detected_at_seconds')::int > v_session.actual_duration_seconds)
    ) THEN
        RAISE EXCEPTION 'malformed detector payload: a detected offset is outside the recording window [0, %]',
            v_session.actual_duration_seconds USING errcode = '22023';
    END IF;

    UPDATE public.objective_session SET finalized_at = now()
        WHERE id = p_session_id AND finalized_at IS NULL;
    IF FOUND THEN
        INSERT INTO public.objective_evidence (session_id, user_id, brief_point_id, verdict, predicate_version, detected_at_seconds)
        SELECT
            p_session_id, v_uid, bp.id,
            CASE
                WHEN sig.detected_at_seconds IS NOT NULL THEN 'detected'::public.objective_evidence_verdict
                WHEN v_predicate = v_approved THEN 'not_detected'::public.objective_evidence_verdict
                ELSE 'unavailable'::public.objective_evidence_verdict
            END,
            v_predicate,
            sig.detected_at_seconds
        FROM public.objective_brief_point bp
        LEFT JOIN LATERAL (  -- offsets are pre-validated in range above, so a present signal is a valid detection
            SELECT (s->>'detected_at_seconds')::int AS detected_at_seconds
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

CREATE OR REPLACE FUNCTION public.objective_select_action_v1(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_session public.objective_session%ROWTYPE;
    v_action_id uuid;
    v_point_id uuid;
    v_overtime numeric;
    v_threshold numeric;
    v_rec_id uuid;
    v_metric text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;
    IF NOT public.has_objective_capability() THEN  -- revocation honored on every mutation
        RAISE EXCEPTION 'objective capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    -- FOR UPDATE serializes concurrent selection/dispute for this session: a racing caller blocks here until
    -- the first commits, then observes the active action below — so idempotency holds instead of one caller
    -- hitting the partial-unique-index violation.
    SELECT * INTO v_session FROM public.objective_session WHERE id = p_session_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'session not found for owner' USING errcode = '42501'; END IF;
    IF v_session.finalized_at IS NULL THEN
        RAISE EXCEPTION 'evidence not finalized' USING errcode = '55000';
    END IF;

    SELECT id INTO v_action_id FROM public.objective_action
        WHERE session_id = p_session_id AND lifecycle = 'active';
    IF FOUND THEN RETURN v_action_id; END IF;

    -- (1) Unmet required point — optional points are excluded, so they never outrank required.
    SELECT bp.id INTO v_point_id
    FROM public.objective_brief_point bp
    LEFT JOIN public.objective_evidence e ON e.session_id = p_session_id AND e.brief_point_id = bp.id
    WHERE bp.brief_id = v_session.brief_id
      AND bp.is_required
      AND (e.verdict IS NULL OR e.verdict <> 'detected')
      AND NOT EXISTS (SELECT 1 FROM public.objective_action a
                       WHERE a.session_id = p_session_id AND a.target_brief_point_id = bp.id)
    ORDER BY bp.sort_order ASC, bp.id ASC
    LIMIT 1;
    IF v_point_id IS NOT NULL THEN
        INSERT INTO public.objective_action (session_id, user_id, formula_version, kind, target_brief_point_id)
            VALUES (p_session_id, v_uid, v_session.formula_version, 'unmet_required', v_point_id)
            RETURNING id INTO v_action_id;
        RETURN v_action_id;
    END IF;

    -- (2) Material time violation — strictly greater; equality is NOT material.
    v_overtime := v_session.actual_duration_seconds - v_session.time_budget_seconds;
    v_threshold := GREATEST(15.0, 0.10 * v_session.time_budget_seconds);
    IF v_overtime > v_threshold
       AND NOT EXISTS (SELECT 1 FROM public.objective_action a WHERE a.session_id = p_session_id AND a.kind = 'material_time') THEN
        INSERT INTO public.objective_action (session_id, user_id, formula_version, kind)
            VALUES (p_session_id, v_uid, v_session.formula_version, 'material_time')
            RETURNING id INTO v_action_id;
        RETURN v_action_id;
    END IF;

    -- (3) Highest-impact #1045 clarity recommendation for the linked session (referenced, not re-implemented).
    IF v_session.source_session_id IS NOT NULL THEN
        SELECT pr.id, pr.target_metric INTO v_rec_id, v_metric
        FROM public.progress_recommendations pr
        WHERE pr.user_id = v_uid AND pr.source_session_id = v_session.source_session_id
        ORDER BY abs(pr.target_value - pr.source_metric_value) DESC, pr.target_metric ASC, pr.id ASC
        LIMIT 1;
        IF v_rec_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM public.objective_action a WHERE a.session_id = p_session_id AND a.kind = 'clarity_improvement') THEN
            INSERT INTO public.objective_action (session_id, user_id, formula_version, kind, clarity_recommendation_id, clarity_metric)
                VALUES (p_session_id, v_uid, v_session.formula_version, 'clarity_improvement', v_rec_id, v_metric)
                RETURNING id INTO v_action_id;
            RETURN v_action_id;
        END IF;
    END IF;

    -- (4) Neutral repeat.
    INSERT INTO public.objective_action (session_id, user_id, formula_version, kind)
        VALUES (p_session_id, v_uid, v_session.formula_version, 'neutral_repeat')
        RETURNING id INTO v_action_id;
    RETURN v_action_id;
END $$;

CREATE OR REPLACE FUNCTION public.objective_dispute_action_v1(p_action_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_action public.objective_action%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;
    IF NOT public.has_objective_capability() THEN  -- revocation honored on every mutation
        RAISE EXCEPTION 'objective capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    SELECT * INTO v_action FROM public.objective_action WHERE id = p_action_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'action not found for owner' USING errcode = '42501'; END IF;
    -- Idempotent dispute retry: if this action was ALREADY disputed (now abandoned, with a dispute row), a
    -- lost-response retry must not throw — return the session's current active successor, exactly as the first
    -- call did, so the client can always learn the next action.
    IF EXISTS (SELECT 1 FROM public.objective_action_dispute WHERE action_id = p_action_id) THEN
        RETURN public.objective_select_action_v1(v_action.session_id);
    END IF;
    IF v_action.lifecycle <> 'active' THEN
        RAISE EXCEPTION 'action is not active' USING errcode = '55000';
    END IF;
    -- neutral_repeat is the TERMINAL fallback — there is nothing further to advance to, so disputing it would
    -- loop (abandon → selector re-inserts an identical neutral). Reject it: only actionable kinds are disputable.
    IF v_action.kind = 'neutral_repeat' THEN
        RAISE EXCEPTION 'cannot dispute the terminal neutral action' USING errcode = '22023';
    END IF;

    INSERT INTO public.objective_action_dispute (action_id, user_id, disputed_brief_point_id)
        VALUES (p_action_id, v_uid, v_action.target_brief_point_id)
        ON CONFLICT (action_id) DO NOTHING;

    UPDATE public.objective_action SET lifecycle = 'abandoned' WHERE id = p_action_id;
    RETURN public.objective_select_action_v1(v_action.session_id);
END $$;

-- 9. Grants
GRANT SELECT ON public.objective_account_capability TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_objective_capability() TO authenticated;
GRANT SELECT ON public.objective_project TO authenticated;
GRANT SELECT ON public.objective_brief TO authenticated;
GRANT SELECT ON public.objective_brief_point TO authenticated;
GRANT SELECT ON public.objective_session TO authenticated;
GRANT SELECT ON public.objective_source_recording TO authenticated;
GRANT SELECT ON public.objective_evidence TO authenticated;
GRANT SELECT ON public.objective_action TO authenticated;
GRANT SELECT ON public.objective_action_dispute TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_start_session_v1(uuid,uuid,uuid,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_register_source_v1(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.objective_finalize_evidence_v1(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_select_action_v1(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.objective_dispute_action_v1(uuid) TO authenticated;

