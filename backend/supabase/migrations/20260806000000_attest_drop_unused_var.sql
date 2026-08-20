-- #1163 follow-up — remove the never-read `v_consumed` local from public.attest_session_engine_v1.
--
-- WHY: the production deploy gate runs `supabase db lint --schema public --fail-on warning`. After
-- 20260803010000 applied, the linter flagged attest_session_engine_v1 with `never read variable "v_consumed"`
-- (a plpgsql "warning extra"), which failed the deploy job. The variable is dead code: `consumed_at` was
-- SELECTed into it but never read — the replay/single-resolution guard is the authority-row / unattributed-marker
-- existence check, NOT a consumed_at comparison. Dropping the variable is behavior-preserving and restores a
-- green deploy lint gate. This is CREATE OR REPLACE only — no schema/table/grant change (privileges are
-- preserved; REVOKE/GRANT re-stated for idempotency, identical to 20260803010000).

CREATE OR REPLACE FUNCTION public.attest_session_engine_v1(
    p_session_id uuid, p_runtime_evidence jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_user uuid; v_engine text; v_engine_version text; v_model text; v_device text; v_status text;
    v_provider text; v_fallback boolean; v_cloud boolean; v_existing text;
    v_challenge uuid; v_class text; v_expected_model text; v_ev_class text; v_reason text;
BEGIN
    -- Serialize on the session row (blocks a concurrent attestation of the same session until commit).
    SELECT user_id, engine, engine_version, model_name, device_type, status
        INTO v_user, v_engine, v_engine_version, v_model, v_device, v_status
        FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'attribution: session % not found', p_session_id USING ERRCODE = 'no_data_found';
    END IF;

    -- Idempotent/replay-safe TERMINAL resolutions: a session resolves EXACTLY once — to an authority
    -- (attributed) or to the definitive unattributed marker. Either terminal state short-circuits.
    SELECT authority_version INTO v_existing
        FROM public.session_attribution_authority WHERE session_id = p_session_id;
    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;
    IF EXISTS (SELECT 1 FROM public.session_attribution_unattributed WHERE session_id = p_session_id) THEN
        RETURN 'unattributed';
    END IF;

    -- TERMINAL-COMPLETION GATE (TRANSIENT): a not-yet-completed session is not resolvable — no authority, no
    -- unattributed marker, no challenge consumed. The producer retries after the session durably completes.
    IF v_status IS DISTINCT FROM 'completed' THEN
        RAISE EXCEPTION 'attribution: session % is not durably completed (status=%)',
            p_session_id, coalesce(v_status, '<null>') USING ERRCODE = 'check_violation';
    END IF;

    -- The client-DECLARED, server-RECORDED pre-session intent BOUND to this session is the provenance. A completed
    -- session with NO bound intent was never registered/bound (Cloud, or a failed/absent/expired registration) ⇒
    -- DEFINITIVELY unattributed (a terminal marker, never a stuck pending) — attest never mints nor binds on demand.
    SELECT challenge_id, engine_class, expected_model
        INTO v_challenge, v_class, v_expected_model
        FROM public.session_attribution_challenge
        WHERE session_id = p_session_id FOR UPDATE;
    IF v_challenge IS NULL THEN
        INSERT INTO public.session_attribution_unattributed(session_id, user_id, reason)
            VALUES (p_session_id, v_user, 'never_registered') ON CONFLICT (session_id) DO NOTHING;
        RETURN 'unattributed';
    END IF;

    -- Evidence is CONSISTENCY evidence only: clean single-engine run + provider class MUST match the challenge
    -- class. Any DEFINITIVE failure (fallback / Cloud / unknown / swap / blank Private model) resolves
    -- the completed session terminally UNATTRIBUTED — never a stuck pending.
    v_provider := lower(coalesce(p_runtime_evidence->>'provider', ''));
    v_fallback := coalesce((p_runtime_evidence->>'fallback_occurred')::boolean, true);
    v_cloud    := coalesce((p_runtime_evidence->>'cloud_used')::boolean, true);
    v_ev_class :=
        CASE WHEN v_provider LIKE 'transformers-js%' THEN 'private'
             WHEN v_provider IN ('web-speech', 'native', 'browser') THEN 'browser'
             ELSE NULL END;
    -- CONSISTENCY only (declaration vs the client's OWN evidence) + declaration completeness. We do NOT judge the
    -- REAL model/quality that executed — the server has no execution receipt and cannot disprove a self-consistent
    -- declaration (a tiny-model "quality" gate would only penalize an honest declarer; a forger declares 'base').
    v_reason :=
        CASE
            WHEN v_fallback THEN 'fallback'
            WHEN v_cloud THEN 'cloud'
            WHEN v_ev_class IS NULL THEN 'unknown_provider'
            WHEN v_ev_class IS DISTINCT FROM v_class THEN 'class_swap'
            WHEN v_class = 'private' AND (v_expected_model IS NULL OR btrim(v_expected_model) = '') THEN 'blank_private_model'
            ELSE NULL
        END;

    -- Consume the challenge exactly once (single-use), then write the terminal outcome atomically.
    UPDATE public.session_attribution_challenge SET consumed_at = now() WHERE challenge_id = v_challenge;

    IF v_reason IS NOT NULL THEN
        INSERT INTO public.session_attribution_unattributed(session_id, user_id, reason)
            VALUES (p_session_id, v_user, v_reason) ON CONFLICT (session_id) DO NOTHING;
        RETURN 'unattributed';
    END IF;

    -- Clean run — write the immutable recorded verdict. The engine/model come from the persisted session
    -- (advisory) + the recorded DECLARATION's model; NO caller-evidence promotion. This records the declared
    -- mode; it does NOT prove which engine executed.
    INSERT INTO public.session_attribution_authority(
        session_id, user_id, authority_version, engine_class, engine, engine_version, model_id, provider, resolved_device)
    VALUES (p_session_id, v_user, 'attrib_v1', v_class, coalesce(v_engine, v_class), v_engine_version,
        coalesce(v_expected_model, v_model), v_provider, v_device)
    ON CONFLICT (session_id) DO NOTHING;   -- belt-and-suspenders against a lost-update race

    RETURN 'attrib_v1';
END;
$$;
REVOKE ALL ON FUNCTION public.attest_session_engine_v1(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.attest_session_engine_v1(uuid, jsonb) TO service_role;
