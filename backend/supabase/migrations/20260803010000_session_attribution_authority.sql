-- #1161 — Server-owned, versioned, immutable engine-attribution AUTHORITY (challenge-bound attestation).
--
-- WHY: `public.sessions.{engine,engine_version,model_name,device_type,attribution_status}` are client-writable
-- today (`GRANT UPDATE ON sessions TO authenticated`), so `attribution_status='verified'` is a client-asserted
-- value that #1045 Progress, G1 Guided and #1117 retention all trust. This migration makes the attribution
-- authority server-owned: a separate immutable `session_attribution_authority` row written ONLY through a
-- challenge-bound, service-role/internal guarded RPC; the legacy `attribution_status` column becomes advisory.
--
-- ENGINE-SPECIFIC (decision 5175338021): ONE authority records a trusted `engine_class` — 'private' (on-device
-- transformers-js) OR 'browser' (native Web Speech). Both are Progress-eligible; ONLY 'private' is Guided- and
-- Private-claim-eligible. Cloud / fallback / unknown → no trusted identity (no row) → no Progress or Guided.
--
-- HONEST ASSURANCE: an immutable, server-owned, replay/challenge-bound authority — NOT a cryptographic proof of
-- an untampered browser. A legitimate single-engine on-device (Private) or native (Browser) run is the only
-- positive path; the client can no longer self-assert its engine.
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
    -- The SERVER-OWNED, immutable engine-class + model provenance, frozen at recording START (before any
    -- transcript exists). This — NOT any client-writable sessions column — is what the terminal verdict binds
    -- to. Written only through the guarded service-role issue RPC; the client has no write path.
    engine_class  text NOT NULL,                  -- 'private' | 'browser'
    expected_model text,                          -- required non-blank for Private; NULL for Browser
    issued_at     timestamptz NOT NULL DEFAULT now(),
    consumed_at   timestamptz,                    -- set once when redeemed; a challenge is single-use
    CONSTRAINT session_attribution_challenge_class_chk CHECK (engine_class IN ('private', 'browser')),
    -- a Private intent MUST carry a non-blank model provenance (a blank Private model is not verifiable)
    CONSTRAINT session_attribution_challenge_private_model_chk
        CHECK (engine_class <> 'private' OR (expected_model IS NOT NULL AND btrim(expected_model) <> '')),
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
    engine_class     text NOT NULL,               -- the trusted engine class: 'private' | 'browser'
    engine           text NOT NULL,
    engine_version   text,
    model_id         text,
    provider         text NOT NULL,               -- instantiated engine provider (transformers-js[-v4] | web-speech)
    resolved_device  text,
    attested_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT session_attribution_authority_version_chk CHECK (authority_version = 'attrib_v1'),
    -- One authority, engine-specific: Private is the on-device transformers-js engine; Browser is the native
    -- Web Speech engine. Cloud/fallback/unknown never reach this table (attest rejects them → no row).
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
--    columns are intentionally EXCLUDED — they are server-owned or set only at INSERT.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
REVOKE UPDATE ON public.sessions FROM authenticated;
GRANT UPDATE (
    title, duration, total_words, filler_words, custom_words, accuracy, ground_truth, transcript,
    clarity_score, wpm, status, status_reason, pause_metrics, transcript_state, ai_suggestions, updated_at
) ON public.sessions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. PRE-RECORDING CHALLENGE ISSUE — service-role/internal only. The trusted server path issues (or idempotently
--    returns) the single open challenge for an owned session AT RECORDING START, freezing the immutable expected
--    engine class + model provenance. Never callable by `authenticated` (EXECUTE revoked), mirroring the G1
--    `guided_register_source_v1` precedent. Owner is derived from the persisted session row. The class/model are
--    a policy input written ONLY through this guarded path — the client cannot seed them via a direct INSERT.
--    Completion cannot mint a challenge on demand: attest never issues; it only consumes a pre-existing one.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_attribution_challenge_v1(
    p_session_id uuid, p_engine_class text, p_expected_model text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user uuid; v_status text; v_challenge uuid; v_class text := lower(coalesce(p_engine_class, ''));
BEGIN
    -- Serialize register-vs-complete on the session row (FOR UPDATE). completeSession's status UPDATE takes the
    -- same row lock, so exactly one wins: if completion commits first this SELECT sees the terminal state and
    -- rejects (no challenge); if this commits first the frozen challenge exists BEFORE completion.
    SELECT user_id, status INTO v_user, v_status FROM public.sessions WHERE id = p_session_id FOR UPDATE;
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'attribution: session % not found', p_session_id USING ERRCODE = 'no_data_found';
    END IF;
    IF v_class NOT IN ('private', 'browser') THEN
        RAISE EXCEPTION 'attribution: invalid engine class "%"', p_engine_class USING ERRCODE = 'check_violation';
    END IF;
    -- PRE-RECORDING LIFECYCLE GATE: a challenge is frozen at recording START; a terminal/completed session can
    -- NEVER register one after the fact (which would let completion be forged into a Private/Browser authority).
    IF v_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'attribution: session % is not in the pre-recording state (status=%) — registration denied',
            p_session_id, coalesce(v_status, '<null>') USING ERRCODE = 'check_violation';
    END IF;
    IF v_class = 'private' AND (p_expected_model IS NULL OR btrim(p_expected_model) = '') THEN
        RAISE EXCEPTION 'attribution: a Private challenge requires a non-blank model provenance'
            USING ERRCODE = 'check_violation';
    END IF;
    -- Idempotent + IMMUTABLE: one challenge per session (UNIQUE(session_id)); re-issue returns the existing one
    -- unchanged (a later call cannot alter a frozen class/model).
    INSERT INTO public.session_attribution_challenge(session_id, user_id, engine_class, expected_model)
        VALUES (p_session_id, v_user, v_class, nullif(btrim(coalesce(p_expected_model, '')), ''))
        ON CONFLICT (session_id) DO NOTHING;
    SELECT challenge_id INTO v_challenge
        FROM public.session_attribution_challenge
        WHERE session_id = p_session_id;
    RETURN v_challenge;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_attribution_challenge_v1(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_attribution_challenge_v1(uuid, text, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. ATTESTATION — service-role/internal only, SECURITY DEFINER, the SOLE writer of authority.
--    - Concurrency-safe: FOR UPDATE on the session row serializes racing attestations (G1 pattern).
--    - Terminal-completion gated: authority requires the owned session's DURABLE status='completed'.
--    - Class from the SERVER-CREATED PRE-RECORDING challenge (server-owned provenance): v_class is the immutable
--      engine_class frozen at recording START via the guarded issue RPC — NOT any client-writable column and NOT
--      the attest-time payload. Attest NEVER issues; if no pre-existing unconsumed challenge exists it fails
--      closed, so completion cannot mint a class and a caller cannot seed it via a direct INSERT.
--    - Evidence is CONSISTENCY evidence only: no fallback, no Cloud, and the evidence provider's class MUST equal
--      the challenge class (Browser→Private / Private→Browser / direct-POST swaps denied). It never sets the
--      class or the identity. Private requires the challenge's non-blank, non-tiny model provenance.
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
    v_challenge uuid; v_consumed timestamptz; v_class text; v_expected_model text; v_ev_class text;
BEGIN
    -- Serialize on the session row (blocks a concurrent attestation of the same session until commit).
    SELECT user_id, engine, engine_version, model_name, device_type, status
        INTO v_user, v_engine, v_engine_version, v_model, v_device, v_status
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

    -- TERMINAL-COMPLETION GATE: authority requires the owned session's DURABLE completed state. Pending /
    -- incomplete / failed / not-yet-saved → no authority, and the immutable slot is never consumed.
    IF v_status IS DISTINCT FROM 'completed' THEN
        RAISE EXCEPTION 'attribution: session % is not durably completed (status=%)',
            p_session_id, coalesce(v_status, '<null>') USING ERRCODE = 'check_violation';
    END IF;

    -- The SERVER-CREATED pre-recording challenge is the provenance. It must ALREADY EXIST (created at recording
    -- start via the guarded issue RPC) and be unconsumed — attest never mints one, so completion cannot forge a
    -- class and a pre-seeded sessions row cannot help without a matching server challenge.
    SELECT challenge_id, engine_class, expected_model, consumed_at
        INTO v_challenge, v_class, v_expected_model, v_consumed
        FROM public.session_attribution_challenge
        WHERE session_id = p_session_id FOR UPDATE;
    IF v_challenge IS NULL THEN
        RAISE EXCEPTION 'attribution: no pre-recording challenge for session % — cannot attest', p_session_id
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_consumed IS NOT NULL THEN
        RAISE EXCEPTION 'attribution: challenge for session % already consumed', p_session_id
            USING ERRCODE = 'check_violation';
    END IF;

    -- v_class is the immutable SERVER-owned class from the challenge. Private requires the challenge's non-blank,
    -- non-tiny model provenance (a blank/tiny Private model is not attestable).
    IF v_class = 'private' THEN
        IF v_expected_model IS NULL OR btrim(v_expected_model) = '' THEN
            RAISE EXCEPTION 'attribution: Private challenge has no model provenance' USING ERRCODE = 'check_violation';
        END IF;
        IF lower(v_expected_model) LIKE '%tiny%' THEN
            RAISE EXCEPTION 'attribution: tiny model is not an attestable Private engine' USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    -- Evidence is CONSISTENCY evidence only: clean single-engine run + provider class MUST match the challenge
    -- class (swap denial). It never determines the class or the identity.
    v_provider := lower(coalesce(p_runtime_evidence->>'provider', ''));
    v_fallback := coalesce((p_runtime_evidence->>'fallback_occurred')::boolean, true);
    v_cloud    := coalesce((p_runtime_evidence->>'cloud_used')::boolean, true);
    IF v_fallback THEN
        RAISE EXCEPTION 'attribution: fallback occurred — not a single-engine run' USING ERRCODE = 'check_violation';
    END IF;
    IF v_cloud THEN
        RAISE EXCEPTION 'attribution: cloud used — no trusted local identity' USING ERRCODE = 'check_violation';
    END IF;
    IF v_provider LIKE 'transformers-js%' THEN
        v_ev_class := 'private';
    ELSIF v_provider IN ('web-speech', 'native', 'browser') THEN
        v_ev_class := 'browser';
    ELSE
        RAISE EXCEPTION 'attribution: unknown provider "%" — no trusted identity', v_provider
            USING ERRCODE = 'check_violation';
    END IF;
    IF v_ev_class IS DISTINCT FROM v_class THEN
        RAISE EXCEPTION 'attribution: evidence class % contradicts the server challenge class % — swap denied',
            v_ev_class, v_class USING ERRCODE = 'check_violation';
    END IF;

    -- Consume the challenge and write the immutable authority atomically. Identity is server-owned: engine from
    -- the persisted session (advisory), model from the challenge provenance; NO caller-evidence promotion.
    UPDATE public.session_attribution_challenge SET consumed_at = now() WHERE challenge_id = v_challenge;
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

-- The trusted engine CLASS ('private'|'browser', or NULL when pending) for an owned session. Progress consumers
-- accept any non-NULL class; Guided consumers MUST require 'private' (Browser is never Guided-eligible). NULL
-- fail-closed for Cloud/fallback/unknown/pending. This is the seam #1158/G2 Guided consumes at the clean boundary.
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
-- 7. CONSUMER INTEGRATION — #1045 Progress eligibility gates on the server-owned AUTHORITY.
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
    -- #1161: eligibility gates on the SERVER-OWNED attribution AUTHORITY (version-locked, owner-scoped),
    -- NOT the client-writable sessions.attribution_status. Fail-closed: no attrib_v1 authority => unverified.
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
        v_has_clarity, s.engine, s.engine_version, s.model_name, CASE WHEN EXISTS (SELECT 1 FROM public.session_attribution_authority a
        WHERE a.session_id = p_session_id AND a.user_id = v_uid AND a.authority_version = 'attrib_v1')
          THEN 'verified' ELSE COALESCE(s.attribution_status, 'unverified') END,
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
