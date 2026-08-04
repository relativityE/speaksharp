-- #1161 — Server-owned, versioned, immutable Private attribution AUTHORITY (challenge-bound attestation).
--
-- WHY: `public.sessions.{engine,engine_version,model_name,device_type,attribution_status}` are client-writable
-- today (`GRANT UPDATE ON sessions TO authenticated`), so `attribution_status='verified'` is a client-asserted
-- value that #1045 Progress, G1 Guided and #1117 retention all trust. This migration makes the attribution
-- authority server-owned: a separate immutable `session_attribution_authority` row written ONLY through a
-- challenge-bound, service-role/internal guarded RPC; the legacy `attribution_status` column becomes advisory.
--
-- HONEST ASSURANCE (per decision): this is an immutable, server-owned, replay/challenge-bound authority — NOT a
-- cryptographic proof of an untampered browser. Legitimate on-device Private completion is the only positive path.
--
-- SOURCE ONLY — NOT APPLIED. Separate Product Owner authorization required for apply/deploy. No Cloud path, no
-- capability enablement, no legacy promotion/backfill, no customer-data operation. Content-free.
-- ROLLBACK: re-GRANT UPDATE ON sessions TO authenticated; drop the functions, then the two tables.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Server-issued, single-use CHALLENGE. A trusted server path issues a challenge bound to (session, user);
--    the attestation must present the exact unconsumed challenge, so a client cannot replay or forge intent.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_attribution_challenge (
    challenge_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    issued_at     timestamptz NOT NULL DEFAULT now(),
    consumed_at   timestamptz,                    -- set once when redeemed; a challenge is single-use
    CONSTRAINT session_attribution_challenge_session_key UNIQUE (session_id)  -- one open challenge per session
);
ALTER TABLE public.session_attribution_challenge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_attribution_challenge_select_own" ON public.session_attribution_challenge
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.session_attribution_challenge TO authenticated;  -- read-own only; no client write path

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. The AUTHORITY. Immutable, server-owned; one row per session. Consumers gate on authority_version, NOT on
--    the client-writable legacy sessions columns. No client write path (SELECT-own only).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_attribution_authority (
    session_id       uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    authority_version text NOT NULL DEFAULT 'attrib_v1',
    engine           text NOT NULL,
    engine_version   text,
    model_id         text,
    provider         text NOT NULL,               -- instantiated on-device engine provider (transformers-js[-v4])
    resolved_device  text,
    attested_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_attribution_authority_version_chk CHECK (authority_version = 'attrib_v1'),
    CONSTRAINT session_attribution_authority_provider_private CHECK (lower(provider) LIKE 'transformers-js%')
);
ALTER TABLE public.session_attribution_authority ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_attribution_authority_select_own" ON public.session_attribution_authority
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.session_attribution_authority TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Lock the client-writable attribution identity on public.sessions. A column-level REVOKE beneath a
--    table-level UPDATE grant is INSUFFICIENT in PostgreSQL, so REVOKE the table-level UPDATE and re-GRANT
--    UPDATE only on the audited SAFE (operational) column whitelist. The attribution identity columns
--    (engine, engine_version, model_name, device_type, attribution_status) and the immutable identity/system
--    columns are intentionally EXCLUDED — they are server-owned or set only at INSERT.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON public.sessions FROM authenticated;
GRANT UPDATE (
    title, duration, total_words, filler_words, accuracy, ground_truth, transcript,
    clarity_score, wpm, status, status_reason, pause_metrics, transcript_state, ai_suggestions, updated_at
) ON public.sessions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. CHALLENGE ISSUE — service-role/internal only. A trusted server path issues (or idempotently returns) the
--    single open challenge for an owned session. Never callable by `authenticated` (EXECUTE revoked), mirroring
--    the G1 `guided_register_source_v1` service-role precedent (decision 5174279093). Owner is derived from the
--    persisted session row, never from a caller-supplied argument.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_attribution_challenge_v1(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user uuid; v_challenge uuid;
BEGIN
    SELECT user_id INTO v_user FROM public.sessions WHERE id = p_session_id;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'attribution: session % not found', p_session_id USING ERRCODE = 'no_data_found';
    END IF;
    -- Idempotent: one open challenge per session (UNIQUE(session_id)); re-issue returns the existing open one.
    INSERT INTO public.session_attribution_challenge(session_id, user_id)
        VALUES (p_session_id, v_user)
        ON CONFLICT (session_id) DO NOTHING;
    SELECT challenge_id INTO v_challenge
        FROM public.session_attribution_challenge
        WHERE session_id = p_session_id;
    RETURN v_challenge;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_attribution_challenge_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_attribution_challenge_v1(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. CHALLENGE-BOUND ATTESTATION — service-role/internal only, SECURITY DEFINER, the SOLE writer of authority.
--    - Concurrency-safe: FOR UPDATE on the session row serializes racing attestations (G1 pattern).
--    - Challenge-bound: the exact unconsumed challenge for this session must be presented; consumed atomically.
--    - Evidence-gated (fail-closed): legitimate on-device Private completion is the ONLY positive path — the
--      instantiated provider must be transformers-js[-v4], a non-tiny model, with NO fallback and NO Cloud use.
--      Browser / Cloud / fallback / tiny / malformed / missing → NO authority row (exception, zero writes).
--    - Idempotent/replay-safe: a second valid call for an already-attested session returns the existing row's
--      version without mutation; a replay of a consumed challenge fails closed.
--    Owner + engine identity are derived from the SERVER-persisted session row, never from client evidence.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.attest_private_session_v1(
    p_session_id uuid, p_challenge_id uuid, p_runtime_evidence jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_user uuid; v_engine text; v_engine_version text; v_model text; v_device text;
    v_provider text; v_fallback boolean; v_cloud boolean; v_existing text; v_consumed timestamptz;
BEGIN
    -- Serialize on the session row (blocks a concurrent attestation of the same session until commit).
    SELECT user_id, engine, engine_version, model_name, device_type
        INTO v_user, v_engine, v_engine_version, v_model, v_device
        FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'attribution: session % not found', p_session_id USING ERRCODE = 'no_data_found';
    END IF;

    -- Idempotent/replay-safe: already attested ⇒ return existing version, mutate nothing.
    SELECT authority_version INTO v_existing
        FROM public.session_attribution_authority WHERE session_id = p_session_id;
    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- Challenge must exist for THIS session, be UNCONSUMED, and match the presented id (fail-closed on replay).
    SELECT consumed_at INTO v_consumed
        FROM public.session_attribution_challenge
        WHERE session_id = p_session_id AND challenge_id = p_challenge_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'attribution: no challenge % for session %', p_challenge_id, p_session_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_consumed IS NOT NULL THEN
        RAISE EXCEPTION 'attribution: challenge % already consumed', p_challenge_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- Evidence gate (fail-closed). Structured runtime evidence must prove the instantiated on-device engine.
    v_provider := lower(coalesce(p_runtime_evidence->>'provider', ''));
    v_fallback := coalesce((p_runtime_evidence->>'fallback_occurred')::boolean, true);
    v_cloud    := coalesce((p_runtime_evidence->>'cloud_used')::boolean, true);
    IF v_provider NOT LIKE 'transformers-js%' THEN
        RAISE EXCEPTION 'attribution: non-Private provider %', v_provider USING ERRCODE = 'check_violation';
    END IF;
    IF v_fallback THEN
        RAISE EXCEPTION 'attribution: fallback occurred — not a pure Private run' USING ERRCODE = 'check_violation';
    END IF;
    IF v_cloud THEN
        RAISE EXCEPTION 'attribution: cloud used — not a pure Private run' USING ERRCODE = 'check_violation';
    END IF;
    -- Reject a tiny model from EITHER the server session row OR the client evidence — neither may launder it.
    IF lower(coalesce(v_model, '')) LIKE '%tiny%'
       OR lower(coalesce(p_runtime_evidence->>'model_id', '')) LIKE '%tiny%' THEN
        RAISE EXCEPTION 'attribution: tiny model is not an attestable Private engine' USING ERRCODE = 'check_violation';
    END IF;

    -- Consume the challenge and write the immutable authority atomically (identity from the SERVER session row).
    UPDATE public.session_attribution_challenge
        SET consumed_at = now()
        WHERE challenge_id = p_challenge_id;
    INSERT INTO public.session_attribution_authority(
        session_id, user_id, authority_version, engine, engine_version, model_id, provider, resolved_device)
    VALUES (
        p_session_id, v_user, 'attrib_v1', coalesce(v_engine,'private'), v_engine_version,
        coalesce(v_model, p_runtime_evidence->>'model_id'), v_provider,
        coalesce(v_device, p_runtime_evidence->>'resolved_device'))
    ON CONFLICT (session_id) DO NOTHING;   -- belt-and-suspenders against a lost-update race

    RETURN 'attrib_v1';
END;
$$;
REVOKE ALL ON FUNCTION public.attest_private_session_v1(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attest_private_session_v1(uuid, uuid, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. CONSUMER-FACING READ — the versioned authority verdict for an owned session, for #1045 / G1 / #1117 to
--    gate on instead of the client-writable legacy `sessions.attribution_status`. Returns NULL when pending
--    (no authority row) so consumers fail closed. SECURITY DEFINER but owner-scoped via auth.uid().
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_attribution_authority_v1(p_session_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT authority_version FROM public.session_attribution_authority
    WHERE session_id = p_session_id AND user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_attribution_authority_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_attribution_authority_v1(uuid) TO authenticated, service_role;
