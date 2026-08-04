-- #1161 — Client-DECLARED, SpeakSharp-server-RECORDED, immutable pre-recording MODE INTENT (challenge/replay-bound).
--
-- WHAT THIS IS — AND IS NOT (honest assurance; PO decision 2026-08-04):
--   • It records the engine MODE the client DECLARED before recording, frozen server-side and made immutable,
--     owner-bound, single-use, replay-safe, and consistent with the runtime evidence the client later reports.
--   • It is NOT server-PROVEN engine identity and NOT a certification of which engine actually executed. Private
--     (on-device transformers-js/WASM) runs entirely on-device; Browser (browser/OS-managed Web Speech) SENDS
--     SPEECH TO AN EXTERNAL VENDOR for processing and receives text back — it is externally processed, not local.
--     Both execute client-side; the SpeakSharp backend receives NO trusted receipt proving which engine ran. This
--     record certifies a DECLARATION plus non-tampering (no post-hoc relabel, no replay, no class-swap, no Cloud,
--     no fallback) — never execution.
--   • 'browser' is NEVER an on-device or privacy claim: browser-managed speech is sent off-device to an external
--     vendor. Only 'private' is an on-device mode.
--   (The names `..._authority` / `attest_...` below denote this recorded, immutable declaration — not proof.)
--
-- WHY: `public.sessions.{engine,engine_version,model_name,device_type,attribution_status}` are client-writable
-- today (`GRANT UPDATE ON sessions TO authenticated`), so `attribution_status='verified'` was a bare client
-- assertion that #1045 Progress, G1 Guided and #1117 retention all trusted. This migration moves the verdict to
-- an immutable, server-recorded row written ONLY through challenge-bound, service-role/internal guarded RPCs;
-- the legacy `attribution_status` column becomes advisory.
--
-- ENGINE-SPECIFIC (decision 5175338021): ONE row records the DECLARED `engine_class` — 'private' (on-device
-- transformers-js) OR 'browser' (browser/OS Web Speech). Both are Progress-eligible; ONLY 'private' is Guided- and
-- Private-claim-eligible. Cloud / fallback / unknown → no declaration recorded (no row) → no Progress or Guided.
--
-- SOURCE ONLY — NOT APPLIED. Separate Product Owner authorization required for apply/deploy. No Cloud path, no
-- capability enablement, no legacy promotion/backfill, no customer-data operation. Content-free.
-- ROLLBACK: re-GRANT UPDATE ON sessions TO authenticated; drop the functions, then the two tables.

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Server-owned, single-use pre-session INTENT. The trusted server path issues an intent keyed on the client
--    RECORDING KEY (the recording's idempotency id) BEFORE the producing engine starts — when NO session row
--    exists yet (a session is persisted only if the recording actually reaches RECORDING, preserving the #1033
--    discard safeguard). The frozen engine class + model provenance is thus captured pre-capture; the intent is
--    later ATOMICALLY BOUND to the session that the recording produces. Ownership (user_id), expiry (expires_at),
--    single-use lifecycle (consumed_at), single-bind replay protection (session_id set once) are all enforced.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_attribution_challenge (
    challenge_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- The pre-session handle: the client-generated recording idempotency key. The intent is frozen against THIS
    -- before any session exists; binding later attaches the produced session_id. Unique per (user, recording).
    recording_key text NOT NULL,
    -- The client-DECLARED, server-RECORDED, immutable engine-class + model mode intent, frozen at recording START
    -- (before any capture or transcript exists). Written only through the guarded service-role issue RPC (no client
    -- write path); it records what the client declared — it does NOT prove which engine executed.
    engine_class  text NOT NULL,                  -- 'private' | 'browser'
    expected_model text,                          -- required non-blank for Private; NULL for Browser
    issued_at     timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,           -- TTL: an intent can be bound only before it expires (replay/expiry)
    -- Bound ATOMICALLY to the produced session on recording success; NULL while pre-session. Set exactly once
    -- (single-bind replay protection). A partial UNIQUE index guarantees one intent per session.
    session_id    uuid REFERENCES public.sessions(id) ON DELETE CASCADE,
    bound_at      timestamptz,
    consumed_at   timestamptz,                    -- set once when redeemed by attest; the intent is single-use
    CONSTRAINT session_attribution_challenge_class_chk CHECK (engine_class IN ('private', 'browser')),
    -- a Private intent MUST carry a non-blank model provenance (a blank Private model is not verifiable)
    CONSTRAINT session_attribution_challenge_private_model_chk
        CHECK (engine_class <> 'private' OR (expected_model IS NOT NULL AND btrim(expected_model) <> '')),
    -- one open intent per (user, recording key): a re-issue for the same recording is idempotent, not a duplicate
    CONSTRAINT session_attribution_challenge_recording_key UNIQUE (user_id, recording_key)
);
-- one intent per session (only once bound); NULL session_id rows (pre-session/unbound) are exempt
CREATE UNIQUE INDEX IF NOT EXISTS session_attribution_challenge_session_key
    ON public.session_attribution_challenge(session_id) WHERE session_id IS NOT NULL;
ALTER TABLE public.session_attribution_challenge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_attribution_challenge_select_own" ON public.session_attribution_challenge
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.session_attribution_challenge TO authenticated;  -- read-own only; no client write path

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. The recorded verdict (`..._authority` = the recorded immutable DECLARATION, not proof of execution).
--    Immutable, server-written; one row per session. Consumers gate on authority_version, NOT on
--    the client-writable legacy sessions columns. No client write path (SELECT-own only).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_attribution_authority (
    session_id       uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    authority_version text NOT NULL DEFAULT 'attrib_v1',
    engine_class     text NOT NULL,               -- the DECLARED engine class: 'private' | 'browser'
    engine           text NOT NULL,
    engine_version   text,
    model_id         text,
    provider         text NOT NULL,               -- instantiated engine provider (transformers-js[-v4] | web-speech)
    resolved_device  text,
    attested_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_attribution_authority_version_chk CHECK (authority_version = 'attrib_v1'),
    -- One row, engine-specific: Private is the on-device transformers-js engine; Browser is the browser/OS Web
    -- Speech engine (externally processed, NOT on-device). Cloud/fallback/unknown never reach this table (attest
    -- rejects them → no row).
    CONSTRAINT session_attribution_authority_class_chk CHECK (
        (engine_class = 'private' AND lower(provider) LIKE 'transformers-js%')
        OR (engine_class = 'browser' AND lower(provider) IN ('web-speech', 'native', 'browser'))
    )
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
--    columns are intentionally EXCLUDED — they are server-written or set only at INSERT.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON public.sessions FROM authenticated;
GRANT UPDATE (
    title, duration, total_words, filler_words, custom_words, accuracy, ground_truth, transcript,
    clarity_score, wpm, status, status_reason, pause_metrics, transcript_state, ai_suggestions, updated_at
) ON public.sessions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3b. MONOTONIC LIFECYCLE (P1): `status` stays client-writable for FORWARD transitions, but once a session is
--     terminal ('completed'/'failed') its status can NEVER revert to a non-terminal state. This makes the
--     pre-recording registration gate un-bypassable — an authenticated caller cannot reset completed→active to
--     re-open the register window. Server-enforced at the DB, independent of the column grant.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_session_status_monotonic()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF OLD.status IN ('completed', 'failed')
       AND NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('completed', 'failed') THEN
        RAISE EXCEPTION 'sessions: status "%" is terminal and cannot revert to "%"', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_session_status_monotonic ON public.sessions;
CREATE TRIGGER trg_session_status_monotonic
    BEFORE UPDATE OF status ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_session_status_monotonic();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3c. DEFINITIVE NO-AUTHORITY RESOLUTION (P1): a terminal, server-written marker that a completed session will
--     NEVER gain an authority (Cloud / rejected evidence / never-registered). It distinguishes "transient
--     (attest not yet resolved)" from "definitively unattributed", so #1045 never freezes a premature ineligible
--     row and #1117 retention is never stuck on an indefinitely-pending session. No client write path.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_attribution_unattributed (
    session_id  uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reason      text,
    resolved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.session_attribution_unattributed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session_attribution_unattributed_select_own" ON public.session_attribution_unattributed
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT SELECT ON public.session_attribution_unattributed TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. PRE-SESSION INTENT ISSUE — service-role/internal only. Called at recording START, BEFORE the producing
--    engine can capture a sample and BEFORE any session row exists. Freezes the immutable expected engine class
--    + model provenance against the client RECORDING KEY. Owner (p_user_id) is the JWT-authenticated caller,
--    passed by the guarded edge function (there is no session yet to derive ownership from). Never callable by
--    `authenticated` (EXECUTE revoked). The class/model are written ONLY through this guarded path; the client
--    cannot seed them via a direct INSERT. Idempotent per (user, recording_key). No session is created here.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_attribution_intent_v1(
    p_user_id uuid, p_recording_key text, p_engine_class text, p_expected_model text DEFAULT NULL,
    p_ttl_seconds integer DEFAULT 900)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_challenge uuid; v_class text := lower(coalesce(p_engine_class, '')); v_key text := btrim(coalesce(p_recording_key, ''));
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'attribution: intent requires an owner' USING ERRCODE = 'check_violation';
    END IF;
    IF v_key = '' THEN
        RAISE EXCEPTION 'attribution: intent requires a non-blank recording key' USING ERRCODE = 'check_violation';
    END IF;
    IF v_class NOT IN ('private', 'browser') THEN
        RAISE EXCEPTION 'attribution: invalid engine class "%"', p_engine_class USING ERRCODE = 'check_violation';
    END IF;
    IF v_class = 'private' AND (p_expected_model IS NULL OR btrim(p_expected_model) = '') THEN
        RAISE EXCEPTION 'attribution: a Private intent requires a non-blank model provenance'
            USING ERRCODE = 'check_violation';
    END IF;
    -- Idempotent + IMMUTABLE: one intent per (user, recording_key); re-issue returns the existing one unchanged
    -- (a later call cannot alter a frozen class/model, nor extend the expiry, nor re-open a bound/consumed intent).
    INSERT INTO public.session_attribution_challenge(user_id, recording_key, engine_class, expected_model, expires_at)
        VALUES (p_user_id, v_key, v_class, nullif(btrim(coalesce(p_expected_model, '')), ''),
                now() + make_interval(secs => greatest(1, coalesce(p_ttl_seconds, 900))))
        ON CONFLICT (user_id, recording_key) DO NOTHING;
    SELECT challenge_id INTO v_challenge
        FROM public.session_attribution_challenge
        WHERE user_id = p_user_id AND recording_key = v_key;
    RETURN v_challenge;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_attribution_intent_v1(uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_attribution_intent_v1(uuid, text, text, text, integer) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4b. ATOMIC SESSION BINDING — service-role/internal only. Called immediately after the session row is persisted
--     (i.e. only once the recording reached RECORDING). ATOMICALLY attaches the pre-session intent to the produced
--     session in a single guarded UPDATE. All mandatory guards are enforced in that one statement:
--       • OWNERSHIP  — the intent's user_id MUST equal the session's owner (an intent cannot bind a foreign session);
--       • EXPIRY     — now() < expires_at (a stale/expired intent can never bind);
--       • REPLAY     — session_id is set exactly once (the WHERE clause requires it be unbound OR already this same
--                      session), so an intent cannot be re-bound to a DIFFERENT session; the partial UNIQUE(session_id)
--                      index also forbids two intents on one session;
--       • LIFECYCLE  — the session must still be pre-terminal ('active'); a completed/failed session cannot acquire
--                      a class after the fact (mirrors the prior post-completion registration denial). FOR UPDATE on
--                      the session row serializes bind-vs-complete so exactly one wins.
--     Returns the bound challenge_id, or NULL when no unbound/unexpired owned intent matched (⇒ the session stays
--     unregistered and attest resolves it definitively unattributed). Idempotent: re-binding the SAME session is a
--     no-op success.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bind_attribution_intent_v1(p_session_id uuid, p_recording_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user uuid; v_status text; v_challenge uuid; v_key text := btrim(coalesce(p_recording_key, ''));
BEGIN
    SELECT user_id, status INTO v_user, v_status FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'attribution: session % not found', p_session_id USING ERRCODE = 'no_data_found';
    END IF;
    -- LIFECYCLE GATE: bind only a pre-terminal session (bind happens right after the placeholder save, while
    -- 'active'). A terminal session can never acquire an intent after the fact.
    IF v_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'attribution: session % is not in the pre-recording state (status=%) — binding denied',
            p_session_id, coalesce(v_status, '<null>') USING ERRCODE = 'check_violation';
    END IF;
    -- Single atomic guarded UPDATE: ownership + expiry + single-bind replay + idempotency all in the WHERE.
    UPDATE public.session_attribution_challenge
        SET session_id = p_session_id, bound_at = coalesce(bound_at, now())
        WHERE user_id = v_user
          AND recording_key = v_key
          AND consumed_at IS NULL
          AND now() < expires_at
          AND (session_id IS NULL OR session_id = p_session_id)
        RETURNING challenge_id INTO v_challenge;
    RETURN v_challenge;   -- NULL ⇒ no bindable owned intent (expired / missing / already bound elsewhere)
END;
$$;
REVOKE ALL ON FUNCTION public.bind_attribution_intent_v1(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_attribution_intent_v1(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. ATTESTATION — service-role/internal only, SECURITY DEFINER, the SOLE writer of authority.
--    - Concurrency-safe: FOR UPDATE on the session row serializes racing attestations (G1 pattern).
--    - Terminal-completion gated: authority requires the owned session's DURABLE status='completed'.
--    - Class from the client-DECLARED, server-RECORDED pre-session intent BOUND to this session: v_class is the
--      immutable engine_class the client DECLARED at recording START via the guarded issue RPC and atomically
--      bound via bind_attribution_intent_v1 — NOT any client-writable column and NOT the attest-time payload.
--      Attest NEVER issues nor binds; if no BOUND unconsumed intent exists for this session it fails closed, so
--      completion cannot mint a class and a caller cannot seed it via a direct INSERT. (This binds the recorded
--      DECLARATION; it does not prove which engine executed.)
--    - Evidence is CONSISTENCY evidence only: no fallback, no Cloud, and the evidence provider's class MUST equal
--      the challenge class (Browser→Private / Private→Browser / direct-POST swaps denied). It never sets the
--      class or the identity. Private requires the declaration to name a non-blank model (completeness only; the
--      server does not judge which model actually ran).
--    - Browser is Progress-eligible but NEVER Guided nor a Private claim (get_session_engine_class_v1 + CHECK).
--    - Idempotent/replay-safe: a second valid call returns the existing version; a consumed challenge fails closed.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.attest_session_engine_v1(
    p_session_id uuid, p_runtime_evidence jsonb
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_user uuid; v_engine text; v_engine_version text; v_model text; v_device text; v_status text;
    v_provider text; v_fallback boolean; v_cloud boolean; v_existing text;
    v_challenge uuid; v_consumed timestamptz; v_class text; v_expected_model text; v_ev_class text; v_reason text;
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
    SELECT challenge_id, engine_class, expected_model, consumed_at
        INTO v_challenge, v_class, v_expected_model, v_consumed
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

-- The DECLARED engine CLASS ('private'|'browser', or NULL when pending) for an owned session. Progress consumers
-- accept any non-NULL class; Guided consumers MUST require 'private' (Browser is never Guided-eligible — and
-- 'browser' is NOT an on-device claim: browser speech is externally processed). NULL fail-closed for
-- Cloud/fallback/unknown/pending. This is the seam #1158/G2 Guided consumes at the clean boundary.
CREATE OR REPLACE FUNCTION public.get_session_engine_class_v1(p_session_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
    SELECT engine_class FROM public.session_attribution_authority
    WHERE session_id = p_session_id AND user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.get_session_engine_class_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_engine_class_v1(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 7. CONSUMER INTEGRATION — #1045 Progress eligibility gates on the server-RECORDED declaration verdict.
--    Additive redefinition (the #1045/#1091 pattern): re-emits public.record_progress_evaluation VERBATIM from
--    20260731120000_session_progress_evaluations.sql, changing ONLY (a) the attribution eligibility gate and
--    (b) the recorded attribution_status — both from the client-writable sessions.attribution_status to the
--    owner+version-scoped session_attribution_authority verdict. (b) is required so an eligible row satisfies
--    the pre-existing spe_eligible_payload CHECK (eligible => attribution_status='verified').
--    G1/G2 Guided-consumer + #1117 retention are intentionally NOT touched: retention ranks newest-two globally
--    (no attribution gate); the Guided consumer waits for the corrected #1158 intent interface (deferred).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_progress_evaluation(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid        uuid := auth.uid();
    v_formula    constant text := 'clarity_v1';
    v_min_secs   constant numeric := 30;    -- §4 STRUCTURAL eligibility gate (not product policy)
    v_min_words  constant integer := 75;    -- §4 STRUCTURAL eligibility gate (not product policy)
    s            public.sessions%ROWTYPE;
    v_reasons    text[] := ARRAY[]::text[];
    v_eligible   boolean;
    v_words      integer;
    v_fillers    integer;
    v_errors     integer;                    -- DERIVED from the persisted transcript; never hardcoded
    v_has_filler_evidence boolean;           -- present, usable filler evidence (a valid zero counts; NULL/empty does not)
    v_wpm        double precision;
    v_has_clarity boolean;
    v_clarity    double precision;
    v_cohort     text;
    v_baseline   uuid;
    v_previous   uuid;
    v_id         uuid;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;

    -- OWNERSHIP: the session must belong to the caller. This is the check an RLS WITH CHECK cannot make.
    SELECT * INTO s FROM public.sessions WHERE id = p_session_id AND user_id = v_uid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'session not found for this user' USING ERRCODE = '42501';
    END IF;

    -- #1161 (P1): attribution must be TERMINAL before writing the IMMUTABLE evaluation. If neither an authority
    -- nor a definitive unattributed marker exists yet, attribution is still PENDING — DEFER (write nothing) so a
    -- later successful authority still yields the eligible row (ON CONFLICT DO NOTHING can't freeze a premature
    -- ineligible row). A definitive unattributed marker falls through and records exactly one terminal ineligible.
    IF NOT EXISTS (SELECT 1 FROM public.session_attribution_authority a
                   WHERE a.session_id = p_session_id AND a.user_id = v_uid)
       AND NOT EXISTS (SELECT 1 FROM public.session_attribution_unattributed u
                       WHERE u.session_id = p_session_id AND u.user_id = v_uid) THEN
        RETURN NULL;   -- attribution pending; a later call re-evaluates
    END IF;

    v_words := COALESCE(s.total_words, 0);
    v_wpm := s.wpm;

    -- FILLER EVIDENCE (must never be imputed). filler_words is {word:{count:N}} with a 'total' aggregate
    -- key. Evidence is USABLE only when the object exists AND carries a numeric total.count OR at least one
    -- numeric entry — mirroring frontend isUsableFillerCounts(). A missing/blank/malformed object is
    -- ABSENT evidence, not zero fillers.
    v_has_filler_evidence := s.filler_words IS NOT NULL AND jsonb_typeof(s.filler_words) = 'object' AND (
        (jsonb_typeof(s.filler_words->'total') = 'object'
            AND (s.filler_words->'total' ? 'count')
            AND jsonb_typeof(s.filler_words->'total'->'count') = 'number')
        OR EXISTS (
            SELECT 1 FROM jsonb_each(s.filler_words) AS v(key, value)
            WHERE v.key <> 'total' AND jsonb_typeof(v.value) = 'object'
              AND (v.value ? 'count') AND jsonb_typeof(v.value->'count') = 'number')
    );

    -- Filler total, derived ONLY when evidence is present: prefer the persisted total.count (mirrors
    -- frontend getFillerTotal), else sum the non-total entries. NULL when evidence is absent — clarity
    -- is then never computed and the session is excluded with reason 'no_filler_evidence'.
    IF v_has_filler_evidence THEN
        v_fillers := COALESCE(
            NULLIF(s.filler_words->'total'->>'count', '')::int,
            (SELECT SUM((v.value->>'count')::int)
             FROM jsonb_each(s.filler_words) AS v(key, value)
             WHERE v.key <> 'total' AND jsonb_typeof(v.value) = 'object' AND (v.value ? 'count')),
            0);
    ELSE
        v_fillers := NULL;
    END IF;

    -- ERROR MARKERS: DERIVED server-side from the persisted transcript with the SAME pattern as the
    -- frontend ERROR_TAG_REGEX. This is a real clarity input; it is never hardcoded to zero.
    v_errors := (
        SELECT count(*)::int FROM regexp_matches(
            COALESCE(s.transcript, ''),
            '\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]',
            'gi') AS m
    );

    v_has_clarity := (s.transcript IS NOT NULL AND length(btrim(s.transcript)) > 0)
                     AND v_words > 0 AND v_wpm IS NOT NULL AND v_has_filler_evidence;

    -- §4 gates, evaluated SERVER-SIDE; deterministic reasons recorded for audit.
    IF s.status IS DISTINCT FROM 'completed'            THEN v_reasons := array_append(v_reasons, 'not_completed'); END IF;
    IF COALESCE(s.duration, 0) < v_min_secs             THEN v_reasons := array_append(v_reasons, 'too_short'); END IF;
    IF v_words < v_min_words                            THEN v_reasons := array_append(v_reasons, 'too_few_words'); END IF;
    IF s.transcript IS NULL OR length(btrim(s.transcript)) = 0
                                                        THEN v_reasons := array_append(v_reasons, 'no_transcript'); END IF;
    -- Missing filler evidence is a MISSING CLARITY INPUT (v_has_clarity depends on it), reported with the
    -- canonical §4 reason 'no_clarity_evidence' — never imputed to zero, and no separate reason token.
    IF NOT v_has_clarity                                THEN v_reasons := array_append(v_reasons, 'no_clarity_evidence'); END IF;
    -- #1161: eligibility gates on the server-RECORDED declaration verdict (version-locked, owner-scoped),
    -- NOT the client-writable sessions.attribution_status. Fail-closed: no attrib_v1 record => unverified.
    IF NOT EXISTS (SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_session_id AND a.user_id = v_uid AND a.authority_version = 'attrib_v1')
    THEN v_reasons := array_append(v_reasons, 'unverified_attribution'); END IF;
    -- Engine identity must be COMPLETE and non-blank (null OR empty/whitespace is incomplete); the
    -- canonical §4 reason for an unusable identity is 'engine_not_comparable'.
    IF s.engine IS NULL OR btrim(s.engine) = ''
       OR s.engine_version IS NULL OR btrim(s.engine_version) = ''
       OR s.model_name IS NULL OR btrim(s.model_name) = ''
                                                        THEN v_reasons := array_append(v_reasons, 'engine_not_comparable'); END IF;

    SELECT ARRAY(SELECT DISTINCT unnest(v_reasons) ORDER BY 1) INTO v_reasons;
    v_eligible := cardinality(v_reasons) = 0;

    IF v_eligible THEN
        -- Clear delivery, UNROUNDED, from persisted columns. Mirrors frontend computeClarityRaw();
        -- a SQL↔TS parity test asserts they agree.
        v_clarity := GREATEST(0, LEAST(100,
            100
            - ((v_fillers::double precision / v_words) * 100 * 1.5)
            - (v_errors * 3)
            - CASE
                WHEN v_wpm > 170 THEN LEAST(20, (v_wpm - 170) / 3)
                WHEN v_wpm > 0 AND v_wpm < 90 THEN LEAST(15, (90 - v_wpm) / 3)
                ELSE 0
              END
        ));
        v_cohort := concat_ws('|', s.engine, s.engine_version, s.model_name, v_formula);

        -- Baseline / previous chosen by PERSISTED created_at within the CALLER'S OWN cohort. Cannot
        -- reference another user's session (user_id = v_uid) and cannot be caller-ordered.
        SELECT e.session_id INTO v_baseline
        FROM public.session_progress_evaluations e
        JOIN public.sessions cs ON cs.id = e.session_id
        WHERE e.user_id = v_uid AND e.eligible AND e.cohort_key = v_cohort AND e.session_id <> p_session_id
        ORDER BY cs.created_at ASC
        LIMIT 1;

        SELECT e.session_id INTO v_previous
        FROM public.session_progress_evaluations e
        JOIN public.sessions cs ON cs.id = e.session_id
        WHERE e.user_id = v_uid AND e.eligible AND e.cohort_key = v_cohort AND e.session_id <> p_session_id
        ORDER BY cs.created_at DESC
        LIMIT 1;
    END IF;

    INSERT INTO public.session_progress_evaluations (
        user_id, session_id, formula_version, duration_seconds, word_count,
        clarity_evidence_available, engine, engine_version, model_name, attribution_status,
        eligible, exclusion_reasons,
        clarity_raw, filler_count, error_marker_count, wpm, cohort_key,
        baseline_session_id, previous_comparable_session_id
    ) VALUES (
        v_uid, p_session_id, v_formula, COALESCE(s.duration, 0), v_words,
        -- #1161 P1 (terminal-retention): the stored attribution_status is derived SOLELY from the server-recorded
        -- declaration verdict, NEVER from the client-writable s.attribution_status. By the defer guard above, this
        -- INSERT is only reached once attribution is RESOLVED — so a recorded row ⇒ 'verified', and its definitive
        -- absence (an unattributed marker exists) ⇒ a hard 'unverified'. Echoing s.attribution_status here would let
        -- a forged 'verified' survive into the evaluation row; drop that fallback entirely.
        v_has_clarity, s.engine, s.engine_version, s.model_name, CASE WHEN EXISTS (SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_session_id AND a.user_id = v_uid AND a.authority_version = 'attrib_v1')
          THEN 'verified' ELSE 'unverified' END,
        v_eligible, v_reasons,
        CASE WHEN v_eligible THEN v_clarity END,
        CASE WHEN v_eligible THEN v_fillers END,
        CASE WHEN v_eligible THEN v_errors END,
        CASE WHEN v_eligible THEN v_wpm END,
        CASE WHEN v_eligible THEN v_cohort END,
        v_baseline, v_previous
    )
    ON CONFLICT (session_id, formula_version) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.session_progress_evaluations
        WHERE session_id = p_session_id AND formula_version = v_formula;
    END IF;

    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_progress_evaluation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_progress_evaluation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_progress_evaluation(uuid) TO authenticated;
