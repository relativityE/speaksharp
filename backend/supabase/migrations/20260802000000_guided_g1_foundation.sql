-- #1046 G1 — Guided practice hard-off data/evidence foundation (schema + RLS + RPCs).
--
-- Accepted criteria: PR #1046 comment 5161246966. ONE PR, MIGRATION SOURCE ONLY — no apply, UI, route,
-- capability enablement, Gemini, Cloud, waitlist, deployment, or activation. Guided is globally HARD-OFF and
-- requires a SERVER-DERIVED account capability; client/PostHog state can never grant it.
--
-- ── WHY CLIENTS CANNOT WRITE (mirrors #1045 session_progress_evaluations) ──
-- RLS `WITH CHECK (auth.uid() = user_id)` only proves a row CLAIMS the caller; it cannot stop a caller from
-- referencing another user's project/brief/session, self-asserting an evidence verdict, or choosing an action.
-- Therefore evidence/action/attempt tables grant SELECT only, and every write goes through a SECURITY DEFINER
-- RPC that derives the owner from `auth.uid()`, verifies ownership + immutable identity, computes verdicts and
-- the single deterministic action SERVER-SIDE, resolves ordering by PERSISTED columns (never caller ordering),
-- and is idempotent. Literal/cue evidence is `detected | not_detected | unavailable`; `not_detected` only under
-- the approved versioned predicate, else `unavailable`.
--
-- NOT APPLIED TO PRODUCTION BY THIS MIGRATION. Requires separate Product Owner authorization.
-- ROLLBACK: drop the functions, then the tables, in reverse dependency order. Additive; nothing else reads them.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 0. SERVER-DERIVED capability. Guided is hard-off; a row here is the ONLY thing that unlocks Guided for an
--    account, and only the service role can write it (no client/PostHog path). Absence = Guided unavailable.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guided_account_capability (
    user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    enabled     boolean     NOT NULL DEFAULT false,
    granted_at  timestamptz NOT NULL DEFAULT now(),
    grant_note  text
);
ALTER TABLE public.guided_account_capability ENABLE ROW LEVEL SECURITY;
-- A user may READ their own capability; NO client write path exists (service role bypasses RLS).
CREATE POLICY "guided_capability_select_own" ON public.guided_account_capability
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.guided_account_capability TO authenticated;

-- No UID parameter: a SECURITY DEFINER function that accepted an arbitrary uid would let any authenticated
-- caller enumerate other users' capability state (bypassing the owner-only RLS). It ALWAYS resolves auth.uid().
CREATE OR REPLACE FUNCTION public.has_guided_capability()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE((SELECT enabled FROM public.guided_account_capability WHERE user_id = auth.uid()), false);
$$;
REVOKE ALL ON FUNCTION public.has_guided_capability() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_guided_capability() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Owner-scoped Guided project (visible owner-deletion contract via ON DELETE CASCADE from the owner).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guided_project (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title       text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    archived_at timestamptz,
    CONSTRAINT guided_project_title_nonblank CHECK (btrim(title) <> '')
);
ALTER TABLE public.guided_project ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guided_project_select_own" ON public.guided_project
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.guided_project TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Immutable, VERSIONED brief. An edit creates a NEW version row (never rewrites). Points are ordered and
--    typed required/optional; validated inputs (event/goal, audience, time budget); duplicate/collision policy
--    is normalized at write time by the guarded RPC. A brief version is frozen once any session references it.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guided_brief (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid NOT NULL REFERENCES public.guided_project(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    version       integer NOT NULL,
    event_goal    text    NOT NULL,
    audience      text,
    time_budget_seconds integer NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT guided_brief_version_key UNIQUE (project_id, version),
    CONSTRAINT guided_brief_version_positive CHECK (version >= 1),
    CONSTRAINT guided_brief_goal_nonblank CHECK (btrim(event_goal) <> ''),
    CONSTRAINT guided_brief_budget_positive CHECK (time_budget_seconds > 0)
);
ALTER TABLE public.guided_brief ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guided_brief_select_own" ON public.guided_brief
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.guided_brief TO authenticated;

-- Ordered required/optional points. `sort_order` is the IMMUTABLE brief order used for deterministic
-- required-point tie-breaking (then point id). Optional points never outrank required ones.
CREATE TABLE IF NOT EXISTS public.guided_brief_point (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id    uuid NOT NULL REFERENCES public.guided_brief(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    sort_order  integer NOT NULL,
    is_required boolean NOT NULL,
    label       text    NOT NULL,
    cue         text,
    CONSTRAINT guided_point_order_key UNIQUE (brief_id, sort_order),
    CONSTRAINT guided_point_label_nonblank CHECK (btrim(label) <> ''),
    CONSTRAINT guided_point_order_nonneg CHECK (sort_order >= 0)
);
ALTER TABLE public.guided_brief_point ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guided_point_select_own" ON public.guided_brief_point
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.guided_brief_point TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Immutable pre-save practice IDENTITY. Everything an evaluation depends on is FROZEN here BEFORE any
--    evidence/action can exist: practice domain (Guided-only — Freestyle is a different domain and cannot
--    attach), project, the exact brief VERSION, the linked practice session, the VERIFIED Private engine
--    (privacy invariant — Guided is on-device Private only, never Browser/Cloud), the detector + formula
--    versions, the authoritative persisted duration + budget snapshot, and an idempotency identity. There is
--    NO client write path and NO UPDATE path: the row is insert-once via the guarded RPC and never mutated.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guided_session (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id              uuid NOT NULL REFERENCES public.guided_project(id) ON DELETE CASCADE,
    brief_id                uuid NOT NULL REFERENCES public.guided_brief(id) ON DELETE CASCADE,
    -- Snapshot of the brief VERSION used (immutable identity; the guarded RPC copies it from the brief row,
    -- so the recorded identity survives even conceptual reasoning about "which version was practiced").
    brief_version           integer NOT NULL,
    -- Link to the underlying practice recording (public.sessions). REQUIRED at creation by the guarded RPC,
    -- which READS this row's CURRENTLY-PERSISTED attribution (attribution_status='verified' + Private engine)
    -- under a TRANSITIONAL contract — those columns are client-writable today, so hardening them into a
    -- tamper-proof server-owned attestation is the external activation dependency #1161, NOT claimed here.
    -- ON DELETE SET NULL (not CASCADE) so deleting the recording is never blocked AND the Guided session's
    -- already-captured snapshot (engine_version, brief_version, detector_version, duration) survives for audit.
    source_session_id       uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
    -- Domain isolation: Guided identity is ALWAYS 'guided'. Freestyle data lives in its own tables and can
    -- never be attached here (CHECK + the RPC refusing any non-'guided' domain).
    practice_domain         text NOT NULL DEFAULT 'guided',
    -- Verified on-device Private engine identity, captured at save. Privacy invariant: Guided is Private-only.
    speech_runtime          text NOT NULL,
    engine_version          text NOT NULL,
    detector_version        text NOT NULL,   -- literal/cue evidence predicate version
    formula_version         text NOT NULL,   -- deterministic action selector version (guided_action_v1)
    -- Authoritative persisted duration + the budget snapshot the overtime rule is measured against.
    time_budget_seconds     integer NOT NULL,
    actual_duration_seconds integer NOT NULL,
    -- Idempotency identity: a caller-stable key makes finalize/retry return the SAME session, never a duplicate.
    idempotency_key         text NOT NULL,
    -- Finalization latch: evidence/action may be derived exactly once, when this flips true (guarded RPC).
    finalized_at            timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT guided_session_idem_key       UNIQUE (user_id, idempotency_key),
    CONSTRAINT guided_session_domain_guided  CHECK (practice_domain = 'guided'),
    CONSTRAINT guided_session_runtime_private CHECK (speech_runtime = 'private'),
    CONSTRAINT guided_session_budget_positive CHECK (time_budget_seconds > 0),
    CONSTRAINT guided_session_duration_nonneg CHECK (actual_duration_seconds >= 0),
    CONSTRAINT guided_session_brief_version_positive CHECK (brief_version >= 1)
);
ALTER TABLE public.guided_session ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guided_session_select_own" ON public.guided_session
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.guided_session TO authenticated;
CREATE INDEX IF NOT EXISTS idx_guided_session_project ON public.guided_session (project_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Literal/cue EVIDENCE — server-derived only. The client NEVER chooses the verdict or its provenance: the
--    guarded RPC classifies each brief point from raw detection signals under the approved detector predicate.
--    `not_detected` is emitted ONLY under the approved versioned predicate; under any other/unknown predicate
--    the honest verdict is `unavailable` ("I couldn't verify that you covered [point]."). One verdict per
--    (session, point); a session's evidence set is written atomically and exactly once.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE public.guided_evidence_verdict AS ENUM ('detected', 'not_detected', 'unavailable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.guided_evidence (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid NOT NULL REFERENCES public.guided_session(id) ON DELETE CASCADE,
    user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    brief_point_id      uuid NOT NULL REFERENCES public.guided_brief_point(id) ON DELETE CASCADE,
    verdict             public.guided_evidence_verdict NOT NULL,
    -- The detector predicate version actually applied. `not_detected` is valid ONLY when this equals the
    -- approved version (enforced in the RPC); otherwise the RPC records `unavailable`.
    predicate_version   text NOT NULL,
    -- Offset where a cue was detected (synthetic count only; never cue/transcript content). Present iff detected.
    detected_at_seconds integer,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT guided_evidence_point_key UNIQUE (session_id, brief_point_id),
    CONSTRAINT guided_evidence_detected_offset CHECK (
        (verdict = 'detected'   AND detected_at_seconds IS NOT NULL AND detected_at_seconds >= 0)
     OR (verdict <> 'detected'  AND detected_at_seconds IS NULL)
    )
);
ALTER TABLE public.guided_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guided_evidence_select_own" ON public.guided_evidence
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.guided_evidence TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. The single deterministic next ACTION (guided_action_v1). EXACTLY ONE row per session (UNIQUE), computed
--    server-side by the guarded RPC in this fixed priority order:
--      (1) unmet_required     — a required brief point whose verdict is NOT 'detected' (not_detected OR
--                               unavailable → "couldn't verify you covered it"); ties by immutable brief
--                               sort_order then point id. Optional points NEVER qualify.
--      (2) material_time      — persisted overtime STRICTLY greater than max(15s, 10% of budget); equality
--                               is NOT material.
--      (3) clarity_improvement— the highest-impact #1045 clarity recommendation for the linked session
--                               (referenced from public.progress_recommendations; never re-implemented).
--      (4) neutral_repeat     — nothing above applies; encourage another rehearsal.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE public.guided_action_kind AS ENUM
        ('unmet_required', 'material_time', 'clarity_improvement', 'neutral_repeat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.guided_action (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id             uuid NOT NULL REFERENCES public.guided_session(id) ON DELETE CASCADE,
    user_id                uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    formula_version        text NOT NULL,
    kind                   public.guided_action_kind NOT NULL,
    -- For unmet_required: the point the action addresses. For clarity: the #1045 recommendation + metric.
    target_brief_point_id  uuid REFERENCES public.guided_brief_point(id) ON DELETE SET NULL,
    clarity_recommendation_id uuid REFERENCES public.progress_recommendations(id) ON DELETE SET NULL,
    clarity_metric         text,
    -- Lifecycle: 'active' until the user disputes ("I covered this"), which abandons THIS action and advances.
    lifecycle              text NOT NULL DEFAULT 'active',
    created_at             timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT guided_action_lifecycle_check CHECK (lifecycle IN ('active', 'abandoned')),
    -- Shape integrity per kind. A clarity action requires the RETAINED `clarity_metric` snapshot to be non-null;
    -- `clarity_recommendation_id` is a nullable live link (ON DELETE SET NULL), so deleting the underlying #1045
    -- recommendation nulls the link WITHOUT violating this constraint or blocking the recording's deletion.
    CONSTRAINT guided_action_kind_shape CHECK (
        (kind = 'unmet_required'      AND target_brief_point_id IS NOT NULL AND clarity_recommendation_id IS NULL AND clarity_metric IS NULL)
     OR (kind = 'clarity_improvement' AND clarity_metric IS NOT NULL AND target_brief_point_id IS NULL)
     OR (kind IN ('material_time', 'neutral_repeat') AND target_brief_point_id IS NULL AND clarity_recommendation_id IS NULL AND clarity_metric IS NULL)
    )
);
ALTER TABLE public.guided_action ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guided_action_select_own" ON public.guided_action
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.guided_action TO authenticated;
-- "Exactly one deterministic action" = at most one ACTIVE action per session at a time; abandoned actions are
-- retained as history so a dispute can advance to the next eligible one without ever rewriting the past.
CREATE UNIQUE INDEX IF NOT EXISTS uq_guided_action_one_active
    ON public.guided_action (session_id) WHERE lifecycle = 'active';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. "I covered this" DISPUTE — separate, NON-AUTHORITATIVE feedback. It NEVER rewrites evidence or the
--    action's verdict; it only marks the disputed action 'abandoned' (advancing the loop) and records the
--    user's claim for later human/product review. One dispute per action.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guided_action_dispute (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_id               uuid NOT NULL UNIQUE REFERENCES public.guided_action(id) ON DELETE CASCADE,
    user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    disputed_brief_point_id uuid REFERENCES public.guided_brief_point(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.guided_action_dispute ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guided_dispute_select_own" ON public.guided_action_dispute
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.guided_action_dispute TO authenticated;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════
-- GUARDED RPCs. Every write goes through one of these SECURITY DEFINER functions: the owner is ALWAYS derived
-- from auth.uid() (never caller input), search_path is pinned, PUBLIC is revoked and EXECUTE granted only to
-- authenticated. Fail-closed: capability, ownership, immutable identity, Private engine and predicate are all
-- verified server-side, and verdict/action are COMPUTED here — the client supplies raw signals only.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════

-- The single approved detector predicate. `not_detected` is only an honest verdict under THIS exact version;
-- under any other/unknown predicate the RPC records `unavailable` ("I couldn't verify that you covered [point].").
CREATE OR REPLACE FUNCTION public.guided_approved_predicate_version()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'cue_v1'::text $$;

-- ── guided_assert_start_identity — the immutable-identity comparison, reused by the pre-check AND the
--    idempotency-race loser branch so BOTH validate every field null-safely (IS DISTINCT FROM). ──
CREATE OR REPLACE FUNCTION public.guided_assert_start_identity(
    v_existing public.guided_session, p_project_id uuid, p_brief_id uuid, p_brief_version integer,
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

-- ── guided_start_session_v1 — insert-once immutable identity; idempotent by (user, idempotency_key) ──
-- The engine identity AND the authoritative duration are READ from the persisted source recording's
-- currently-stored fields — NOT from caller values (so duration cannot be used to suppress/manufacture an
-- overtime action). TRANSITIONAL contract: `attribution_status`/`engine` are client-writable today (external
-- activation dependency #1161); G1 checks them as-persisted and does NOT claim they are server-verified or
-- spoof-proof. Only the fixed 'guided_action_v1' formula is accepted. A replayed key must carry the SAME
-- immutable identity (null-safe compare), including in the concurrent-race loser branch.
CREATE OR REPLACE FUNCTION public.guided_start_session_v1(
    p_project_id uuid, p_brief_id uuid, p_source_session_id uuid,
    p_detector_version text, p_formula_version text, p_idempotency_key text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_brief public.guided_brief%ROWTYPE;
    v_src RECORD;
    v_engine_version text;
    v_duration integer;
    v_existing public.guided_session%ROWTYPE;
    v_session_id uuid;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;
    IF NOT public.has_guided_capability() THEN
        RAISE EXCEPTION 'guided capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    -- Only the fixed v1 selector actually runs; reject any other formula so recorded provenance is truthful.
    IF p_formula_version IS DISTINCT FROM 'guided_action_v1' THEN
        RAISE EXCEPTION 'unsupported action formula version' USING errcode = '22023';
    END IF;
    -- Brief must belong to the caller AND to the named project (server-verified; no cross-owner spoofing).
    SELECT * INTO v_brief FROM public.guided_brief
        WHERE id = p_brief_id AND user_id = v_uid AND project_id = p_project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'brief not found for owner/project' USING errcode = '42501'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.guided_project WHERE id = p_project_id AND user_id = v_uid) THEN
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
    v_engine_version := COALESCE(v_src.engine_version, v_src.engine);
    v_duration := COALESCE(v_src.duration, 0);  -- authoritative persisted duration; the caller never supplies it.

    -- Idempotent replay pre-check (null-safe on every immutable field).
    SELECT * INTO v_existing FROM public.guided_session
        WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        PERFORM public.guided_assert_start_identity(v_existing, p_project_id, p_brief_id, v_brief.version,
            p_source_session_id, p_detector_version, p_formula_version, v_duration);
        RETURN v_existing.id;  -- true idempotent replay: same identity, same row.
    END IF;

    INSERT INTO public.guided_session (
        user_id, project_id, brief_id, brief_version, source_session_id, practice_domain,
        speech_runtime, engine_version, detector_version, formula_version,
        time_budget_seconds, actual_duration_seconds, idempotency_key
    ) VALUES (
        v_uid, p_project_id, p_brief_id, v_brief.version, p_source_session_id, 'guided',
        'private', v_engine_version, p_detector_version, p_formula_version,
        v_brief.time_budget_seconds, v_duration, p_idempotency_key
    )
    ON CONFLICT (user_id, idempotency_key) DO NOTHING
    RETURNING id INTO v_session_id;

    IF v_session_id IS NULL THEN
        -- Lost the concurrent insert race on this key: load the FULL winning row and re-validate identity, so a
        -- racing mismatched request is rejected instead of silently receiving another identity's session.
        SELECT * INTO v_existing FROM public.guided_session
            WHERE user_id = v_uid AND idempotency_key = p_idempotency_key;
        PERFORM public.guided_assert_start_identity(v_existing, p_project_id, p_brief_id, v_brief.version,
            p_source_session_id, p_detector_version, p_formula_version, v_duration);
        v_session_id := v_existing.id;
    END IF;
    RETURN v_session_id;
END $$;
REVOKE ALL ON FUNCTION public.guided_start_session_v1(uuid,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guided_start_session_v1(uuid,uuid,uuid,text,text,text) TO authenticated;

-- ── guided_finalize_evidence_v1 — server-derives one verdict per point, exactly once (finalize latch) ──
-- The client supplies RAW signals only ([{brief_point_id, detected_at_seconds|null}]); it can NEVER assert a
-- verdict/provenance NOR the predicate. The predicate is the session's FROZEN detector_version: detected ⇐ a
-- signal offset is present; not_detected ⇐ no signal AND the frozen detector is the approved version; otherwise
-- unavailable. Concurrent/retry callers that lose the latch never re-insert (no partial/duplicate).
CREATE OR REPLACE FUNCTION public.guided_finalize_evidence_v1(
    p_session_id uuid, p_signals jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_session public.guided_session%ROWTYPE;
    v_approved text := public.guided_approved_predicate_version();
    v_predicate text;
    v_count integer;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;
    -- Re-check capability on every mutation: a server-revoked/deleted capability must immediately make Guided
    -- unavailable, even for a session that was started while enabled (revocation is honored, not bypassed).
    IF NOT public.has_guided_capability() THEN
        RAISE EXCEPTION 'guided capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    SELECT * INTO v_session FROM public.guided_session WHERE id = p_session_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'session not found for owner' USING errcode = '42501'; END IF;
    v_predicate := v_session.detector_version;  -- the immutable predicate captured at session start.

    UPDATE public.guided_session SET finalized_at = now()
        WHERE id = p_session_id AND finalized_at IS NULL;
    IF FOUND THEN
        INSERT INTO public.guided_evidence (session_id, user_id, brief_point_id, verdict, predicate_version, detected_at_seconds)
        SELECT
            p_session_id, v_uid, bp.id,
            CASE
                WHEN sig.detected_at_seconds IS NOT NULL THEN 'detected'::public.guided_evidence_verdict
                WHEN v_predicate = v_approved THEN 'not_detected'::public.guided_evidence_verdict
                ELSE 'unavailable'::public.guided_evidence_verdict
            END,
            v_predicate,
            sig.detected_at_seconds
        FROM public.guided_brief_point bp
        LEFT JOIN LATERAL (
            SELECT (s->>'detected_at_seconds')::int AS detected_at_seconds
            FROM jsonb_array_elements(COALESCE(p_signals, '[]'::jsonb)) s
            WHERE (s->>'brief_point_id')::uuid = bp.id
              AND (s->>'detected_at_seconds') IS NOT NULL
              -- Offset must be within the authoritative recording window [0, duration]. An impossible offset
              -- (negative, or after the recording ended) is NOT a valid detection — it is ignored so it cannot
              -- manufacture a 'detected' verdict, suppress an unmet_required action, or violate the row CHECK.
              AND (s->>'detected_at_seconds')::int >= 0
              AND (s->>'detected_at_seconds')::int <= v_session.actual_duration_seconds
            LIMIT 1
        ) sig ON true
        WHERE bp.brief_id = v_session.brief_id;
    END IF;

    SELECT count(*) INTO v_count FROM public.guided_evidence WHERE session_id = p_session_id;
    RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.guided_finalize_evidence_v1(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guided_finalize_evidence_v1(uuid,jsonb) TO authenticated;

-- ── guided_select_action_v1 — the deterministic single-action selector ──
-- Priority: (1) next unmet REQUIRED point (verdict<>detected), lowest brief order then id, not already actioned;
-- (2) material time overtime STRICTLY > max(15s, 10% budget); (3) highest-impact #1045 clarity recommendation
-- for the linked session; (4) neutral repeat. Idempotent: returns the existing ACTIVE action if one exists.
CREATE OR REPLACE FUNCTION public.guided_select_action_v1(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_session public.guided_session%ROWTYPE;
    v_action_id uuid;
    v_point_id uuid;
    v_overtime numeric;
    v_threshold numeric;
    v_rec_id uuid;
    v_metric text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;
    IF NOT public.has_guided_capability() THEN  -- revocation honored on every mutation
        RAISE EXCEPTION 'guided capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    -- FOR UPDATE serializes concurrent selection/dispute for this session: a racing caller blocks here until
    -- the first commits, then observes the active action below — so idempotency holds instead of one caller
    -- hitting the partial-unique-index violation.
    SELECT * INTO v_session FROM public.guided_session WHERE id = p_session_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'session not found for owner' USING errcode = '42501'; END IF;
    IF v_session.finalized_at IS NULL THEN
        RAISE EXCEPTION 'evidence not finalized' USING errcode = '55000';
    END IF;

    SELECT id INTO v_action_id FROM public.guided_action
        WHERE session_id = p_session_id AND lifecycle = 'active';
    IF FOUND THEN RETURN v_action_id; END IF;

    -- (1) Unmet required point — optional points are excluded, so they never outrank required.
    SELECT bp.id INTO v_point_id
    FROM public.guided_brief_point bp
    LEFT JOIN public.guided_evidence e ON e.session_id = p_session_id AND e.brief_point_id = bp.id
    WHERE bp.brief_id = v_session.brief_id
      AND bp.is_required
      AND (e.verdict IS NULL OR e.verdict <> 'detected')
      AND NOT EXISTS (SELECT 1 FROM public.guided_action a
                       WHERE a.session_id = p_session_id AND a.target_brief_point_id = bp.id)
    ORDER BY bp.sort_order ASC, bp.id ASC
    LIMIT 1;
    IF v_point_id IS NOT NULL THEN
        INSERT INTO public.guided_action (session_id, user_id, formula_version, kind, target_brief_point_id)
            VALUES (p_session_id, v_uid, v_session.formula_version, 'unmet_required', v_point_id)
            RETURNING id INTO v_action_id;
        RETURN v_action_id;
    END IF;

    -- (2) Material time violation — strictly greater; equality is NOT material.
    v_overtime := v_session.actual_duration_seconds - v_session.time_budget_seconds;
    v_threshold := GREATEST(15.0, 0.10 * v_session.time_budget_seconds);
    IF v_overtime > v_threshold
       AND NOT EXISTS (SELECT 1 FROM public.guided_action a WHERE a.session_id = p_session_id AND a.kind = 'material_time') THEN
        INSERT INTO public.guided_action (session_id, user_id, formula_version, kind)
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
           AND NOT EXISTS (SELECT 1 FROM public.guided_action a WHERE a.session_id = p_session_id AND a.kind = 'clarity_improvement') THEN
            INSERT INTO public.guided_action (session_id, user_id, formula_version, kind, clarity_recommendation_id, clarity_metric)
                VALUES (p_session_id, v_uid, v_session.formula_version, 'clarity_improvement', v_rec_id, v_metric)
                RETURNING id INTO v_action_id;
            RETURN v_action_id;
        END IF;
    END IF;

    -- (4) Neutral repeat.
    INSERT INTO public.guided_action (session_id, user_id, formula_version, kind)
        VALUES (p_session_id, v_uid, v_session.formula_version, 'neutral_repeat')
        RETURNING id INTO v_action_id;
    RETURN v_action_id;
END $$;
REVOKE ALL ON FUNCTION public.guided_select_action_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guided_select_action_v1(uuid) TO authenticated;

-- ── guided_dispute_action_v1 — non-authoritative "I covered this"; abandons + advances ──
-- Records the dispute WITHOUT touching guided_evidence or the past action's verdict, abandons the active
-- action, and deterministically selects the next eligible one (the same selector, now excluding this target).
CREATE OR REPLACE FUNCTION public.guided_dispute_action_v1(p_action_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_action public.guided_action%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'auth required' USING errcode = '28000'; END IF;
    IF NOT public.has_guided_capability() THEN  -- revocation honored on every mutation
        RAISE EXCEPTION 'guided capability required (server-derived; client/PostHog cannot grant)' USING errcode = '42501';
    END IF;
    SELECT * INTO v_action FROM public.guided_action WHERE id = p_action_id AND user_id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'action not found for owner' USING errcode = '42501'; END IF;
    -- Idempotent dispute retry: if this action was ALREADY disputed (now abandoned, with a dispute row), a
    -- lost-response retry must not throw — return the session's current active successor, exactly as the first
    -- call did, so the client can always learn the next action.
    IF EXISTS (SELECT 1 FROM public.guided_action_dispute WHERE action_id = p_action_id) THEN
        RETURN public.guided_select_action_v1(v_action.session_id);
    END IF;
    IF v_action.lifecycle <> 'active' THEN
        RAISE EXCEPTION 'action is not active' USING errcode = '55000';
    END IF;
    -- neutral_repeat is the TERMINAL fallback — there is nothing further to advance to, so disputing it would
    -- loop (abandon → selector re-inserts an identical neutral). Reject it: only actionable kinds are disputable.
    IF v_action.kind = 'neutral_repeat' THEN
        RAISE EXCEPTION 'cannot dispute the terminal neutral action' USING errcode = '22023';
    END IF;

    INSERT INTO public.guided_action_dispute (action_id, user_id, disputed_brief_point_id)
        VALUES (p_action_id, v_uid, v_action.target_brief_point_id)
        ON CONFLICT (action_id) DO NOTHING;

    UPDATE public.guided_action SET lifecycle = 'abandoned' WHERE id = p_action_id;
    RETURN public.guided_select_action_v1(v_action.session_id);
END $$;
REVOKE ALL ON FUNCTION public.guided_dispute_action_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guided_dispute_action_v1(uuid) TO authenticated;
