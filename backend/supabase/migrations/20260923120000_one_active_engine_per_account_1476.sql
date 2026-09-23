-- #1476 — ONE ACCOUNT MAY ONLY RUN ONE STT ENGINE AT A TIME, across tabs and devices (PO rule, 2026-09-23).
--
-- Authority: the account-keyed `active_recording_lease` (20260607040000), which the recording flow never used. This
-- migration makes the SERVER enforce it, because a client cannot fence another device, an old bundle, or itself once
-- displaced:
--   1. `create_session_and_update_usage` admits a TAKE only under the caller's live lease (current clients pass it in
--      `p_session_data.lease_id`); an old client with no lease gets an implicit lease, or `max_concurrent_sessions_reached`
--      while another take is live. Abandoned takes (lease stale, never released) are closed as `abandoned_device` (#1360).
--   2. `_ss_fence_session_writes_1476` rejects every write to a DISPLACED take (another holder is live and this take's
--      lease was never released), every revival of an abandoned take, and any direct insert of an active take that does
--      not carry the caller's live lease. A take released normally (Stop, then its save or Retry Save) is never fenced.
--   3. `release_recording_lease` stamps its take `lease_released_at`, which is what separates a normal Stop from a
--      displacement.
-- Offline devices cannot be stopped remotely: what this guarantees is ONE AUTHORIZED engine — the displaced device's
-- server writes are refused when it reconnects.
--
-- Additive and backward compatible: no new RPC argument, so a client that sends `lease_id` works against the previous
-- definition (which ignores it) and an old client works against this one. Merge is not apply: applying this migration
-- to Production requires its own exact PO authorization.

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS lease_id uuid;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS lease_released_at timestamptz;

CREATE OR REPLACE FUNCTION public.create_session_and_update_usage(
    p_session_data JSONB,
    p_engine_type TEXT DEFAULT 'private',
    p_idempotency_key UUID DEFAULT NULL,
    p_engine_version TEXT DEFAULT NULL,
    p_model_name TEXT DEFAULT NULL,
    p_device_type TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_session_id UUID;
    v_new_session_id UUID := gen_random_uuid();
    v_duration INT;
    v_usage_check JSONB;
    v_user_tier TEXT;
    v_max_concurrent INT;
    v_active_sessions INT;
    v_retention JSONB;
    -- #1436 P1 — does THIS call carry real transcript text? The late-create recovery path does; an
    -- ordinary placeholder create does not, and its existing pending/error behaviour must not change.
    v_writes_transcript BOOLEAN;
    v_initial_at_cap BOOLEAN;
    -- #1476 one account, one authorized active engine.
    v_is_take BOOLEAN;
    v_lease_text TEXT;
    v_lease_id UUID;
    v_lease public.active_recording_lease%ROWTYPE;
    v_lease_live BOOLEAN := false;
    v_legacy_take BOOLEAN := false;
BEGIN
    SET LOCAL statement_timeout = '3000ms';

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_session_id
        FROM public.sessions
        WHERE idempotency_key = p_idempotency_key AND user_id = auth.uid();

        IF v_existing_session_id IS NOT NULL THEN
            /*
             * #1436 P1 — A TRANSCRIPT-BEARING REPLAY STILL OWES CONVERGENCE.
             *
             * This returned before taking the profile lock or invoking retention. Production enters
             * this migration with newest-TWO rows still readable and relies on later writer calls to
             * converge them, so replaying a successful transcript-bearing create could keep reporting
             * success with two readable transcripts indefinitely — the duplicate is idempotent about
             * the ROW, and was silently idempotent about the RETENTION too. `complete_session_v2`
             * deliberately avoids this same early-return so a replay can retry convergence.
             *
             * The fast path is preserved for transcript-free placeholders, which owe nothing.
             */
            /*
             * #1436 P1 — THE STORED ROW DECIDES, NOT THE CALLER'S PAYLOAD.
             *
             * This tested `p_session_data`. A retry that omits `transcript`, or sends it blank, then
             * took the fast path and returned duplicate success without converging — leaving the
             * legacy two-transcript cohort readable. The duplicate's obligation comes from what was
             * PERSISTED under that idempotency key, which the caller cannot revoke by sending less.
             */
            IF EXISTS (
                SELECT 1 FROM public.sessions
                WHERE id = v_existing_session_id
                  AND transcript IS NOT NULL
                  AND transcript ~ '[^[:space:]]'
            ) THEN
                v_retention := public.converge_transcript_retention(auth.uid());
                /*
                 * `deferred` is an ANSWER, not a failure. An unarmed user's transcripts are governed by
                 * the policy they were saved under, so there is nothing for this replay to converge and
                 * nothing to report as broken — raising here would turn a legacy user's harmless retry
                 * into a hard save error. What the replay owes is to ASK; the verdict travels back in
                 * `retention` either way. Any other non-converged status still means it asked, was
                 * allowed to act, and did not finish, which stays a retryable failure.
                 */
                IF COALESCE(v_retention->>'status', 'error') NOT IN ('converged', 'deferred') THEN
                    RAISE EXCEPTION 'create_session_and_update_usage: replayed transcript retention did not converge (status=%)',
                        COALESCE(v_retention->>'status', 'error')
                        USING ERRCODE = '55000';
                END IF;
                RETURN jsonb_build_object(
                    'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_existing_session_id),
                    'usage_exceeded', false,
                    'is_duplicate', true,
                    'retention', v_retention
                );
            END IF;
            RETURN jsonb_build_object(
                'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_existing_session_id),
                'usage_exceeded', false,
                'is_duplicate', true
            );
        END IF;
    END IF;

    SELECT public.effective_subscription_tier(
        subscription_status,
        trial_expires_at,
        stripe_subscription_id,
        subscription_id,
        commercial_trial_granted_at
    )
    INTO v_user_tier
    FROM public.user_profiles
    WHERE id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', 'profile_not_found'
        );
    END IF;

    SELECT max_concurrent_sessions INTO v_max_concurrent
    FROM public.tier_configs
    WHERE tier_name = COALESCE(v_user_tier, 'free');
    IF v_max_concurrent IS NULL THEN
        v_max_concurrent := 1;
    END IF;

    UPDATE public.sessions
    SET status = 'failed', updated_at = now()
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at <= now();

    /*
     * #1476 — ONE ACCOUNT MAY ONLY RUN ONE STT ENGINE AT A TIME, across tabs and devices (PO rule).
     *
     * The account-keyed `active_recording_lease` is the authority for a TAKE (an `active` create). An at-cap create
     * (duration 600) is a completed recovery save, not engine work, and is not fenced here.
     *  - A current client sends the lease it acquired before engine preparation in `p_session_data.lease_id`
     *    (the existing JSONB: no new argument, so an older server simply ignores it). It must be the caller's LIVE
     *    lease, or the take is refused with `lease_not_held`.
     *  - An OLD client sends no lease. If another take is live it is refused with `max_concurrent_sessions_reached`,
     *    the code every shipped bundle already renders; otherwise it records under an IMPLICIT lease keyed to the new
     *    session id, which `_ss_fence_session_writes_1476` keeps alive on its heartbeats and releases on completion.
     *  - #1360 bounded recovery: a take whose lease was never released and is no longer live belongs to a device that
     *    stopped responding. It is closed here as `failed`/`abandoned_device` instead of blocking for the full
     *    session expiry. A take released normally (Stop, then a pending save) is never closed by this.
     * Pro and Free alike: this check, not the tier's session cap, is what holds an account to one engine.
     */
    v_is_take := COALESCE((p_session_data->>'duration')::INT, 0) <> 600;
    IF v_is_take THEN
        v_lease_text := p_session_data->>'lease_id';
        IF v_lease_text IS NOT NULL
           AND v_lease_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'lease_not_held');
        END IF;
        v_lease_id := v_lease_text::uuid;

        SELECT * INTO v_lease FROM public.active_recording_lease WHERE user_id = auth.uid() FOR UPDATE;
        v_lease_live := FOUND AND v_lease.heartbeat_at >= now() - interval '15 seconds';

        UPDATE public.sessions
        SET status = 'failed', status_reason = 'abandoned_device', updated_at = now()
        WHERE user_id = auth.uid()
          AND status = 'active'
          AND lease_id IS NOT NULL
          AND lease_released_at IS NULL
          AND NOT (v_lease_live AND lease_id = v_lease.lease_id);

        IF v_lease_id IS NOT NULL THEN
            IF NOT (v_lease_live AND v_lease.lease_id = v_lease_id) THEN
                RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'lease_not_held');
            END IF;
        ELSIF v_lease_live THEN
            RETURN jsonb_build_object(
                'new_session', null,
                'usage_exceeded', true,
                'error', 'max_concurrent_sessions_reached',
                'active_sessions', 1,
                'max_concurrent_sessions', 1
            );
        ELSE
            v_legacy_take := true;
        END IF;
    END IF;

    SELECT COUNT(*) INTO v_active_sessions
    FROM public.sessions
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now());

    IF v_active_sessions >= v_max_concurrent THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', 'max_concurrent_sessions_reached',
            'active_sessions', v_active_sessions,
            'max_concurrent_sessions', v_max_concurrent
        );
    END IF;

    v_duration := COALESCE((p_session_data->>'duration')::INT, 0);
    IF v_duration < 0 OR v_duration > 600 THEN
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', false,
            'error', 'technical_duration_cap_exceeded',
            'max_duration_seconds', 600
        );
    END IF;
    v_initial_at_cap := (v_duration = 600);

    IF v_legacy_take THEN
        -- The OLD client's implicit lease, written BEFORE the take row so the insert fence sees it. Its heartbeat_session runs every ~30 s, so the lease is kept 30 s ahead of
        -- now; the 15 s staleness window then tolerates the old cadence.
        INSERT INTO public.active_recording_lease (user_id, lease_id, holder_label, state, started_at, heartbeat_at)
        VALUES (auth.uid(), v_new_session_id, 'an older version of SpeakSharp', 'recording', now(), now() + interval '30 seconds')
        ON CONFLICT (user_id) DO UPDATE
          SET lease_id = EXCLUDED.lease_id, holder_label = EXCLUDED.holder_label, state = 'recording',
              started_at = now(), heartbeat_at = EXCLUDED.heartbeat_at;
    END IF;

    INSERT INTO public.sessions (
        id, user_id, title, duration, total_words, filler_words, accuracy, ground_truth,
        transcript, engine, clarity_score, wpm, idempotency_key, engine_version,
        model_name, device_type, status, expires_at, lease_id
    ) VALUES (
        v_new_session_id,
        auth.uid(),
        p_session_data->>'title',
        v_duration,
        COALESCE((p_session_data->>'total_words')::INT, 0),
        COALESCE((p_session_data->'filler_words')::JSONB, '{}'::JSONB),
        (p_session_data->>'accuracy')::FLOAT8,
        p_session_data->>'ground_truth',
        p_session_data->>'transcript',
        p_engine_type,
        (p_session_data->>'clarity_score')::FLOAT8,
        (p_session_data->>'wpm')::FLOAT8,
        p_idempotency_key,
        p_engine_version,
        p_model_name,
        p_device_type,
        CASE WHEN v_initial_at_cap THEN 'completed' ELSE 'active' END,
        CASE WHEN v_initial_at_cap THEN NULL ELSE now() + interval '1 hour' END,
        CASE WHEN NOT v_is_take THEN NULL
             WHEN v_legacy_take THEN v_new_session_id
             ELSE v_lease_id END
    );

    IF v_initial_at_cap THEN
        UPDATE public.sessions
        SET status_reason = 'technical_duration_cap', updated_at = now()
        WHERE id = v_new_session_id AND user_id = auth.uid();
    END IF;

    v_usage_check := public.update_user_usage(v_duration, p_engine_type, v_new_session_id);
    IF NOT (v_usage_check->>'success')::BOOLEAN THEN
        DELETE FROM public.sessions
        WHERE id = v_new_session_id AND user_id = auth.uid();
        RETURN jsonb_build_object(
            'new_session', null,
            'usage_exceeded', true,
            'error', v_usage_check->>'error'
        );
    END IF;

    /*
     * #1436 P1 — the at-cap create is a completed save, and arms only once it has SUCCEEDED.
     * Placed after the usage check: the rejection branch above deletes the session and returns, and
     * arming before that point left an arming row behind for a save that never happened.
     */
    v_writes_transcript := COALESCE(p_session_data->>'transcript', '') ~ '[^[:space:]]';
    IF v_initial_at_cap AND v_writes_transcript THEN
        PERFORM public.arm_transcript_retention_for_save(auth.uid(), v_new_session_id);
    END IF;

    IF v_duration > 0 THEN
        INSERT INTO public.usage_checkpoints (session_id, user_id, incremental_seconds, engine_type)
        VALUES (v_new_session_id, auth.uid(), v_duration, p_engine_type);
    END IF;

    /**
     * #1436 P1 — A TRANSCRIPT-WRITING CREATE IS ATOMIC WITH ITS RETENTION.
     *
     * This inserted the row, then swallowed every convergence failure — and also accepted a
     * `pending`/`non_converged` status — without undoing the insert. Under newest-ONE that leaves TWO
     * readable transcripts whenever the prior one lacks terminal evidence, which is precisely the
     * state the policy exists to prevent, reached through the recovery path rather than the normal one.
     *
     * Placeholder creates are unaffected: they write no text, so they cannot create a second one, and
     * their pending/error reporting is preserved exactly.
     *
     * When text IS written, a non-converged outcome raises inside the SAME transaction, so the new
     * row, the usage checkpoint and any partial retention writes roll back together. The controller
     * then receives a retryable save failure and keeps its recovery draft — which is the honest
     * outcome. NULLing the new transcript and reporting success would tell the user their words were
     * saved while discarding them.
     */
    /*
     * #1436 P1 — A PLACEHOLDER MUST NOT EXPIRE ANYTHING. RECORDING START IS NOT A SAVE.
     *
     * This called the coordinator unconditionally. On the first application of this migration to a
     * user who still holds two legacy transcripts whose older row already has terminal evidence, the
     * ordinary transcript-free create AT RECORDING START reached that call and irreversibly expired
     * the older transcript — before the new take had captured a word. The user could then cancel or
     * fail that take and be left with strictly less readable text than before they pressed record,
     * which contradicts this migration's own "next completed save" boundary.
     *
     * Retention converges on COMPLETION, where a new transcript actually exists to supersede the old
     * one. A placeholder reports `deferred` and expires nothing; `complete_session_v2` and the
     * transcript-bearing create below remain the only paths that can retire a transcript.
     *
     * My casualty 4 could not catch this: it deliberately leaves the candidate PENDING so the
     * coordinator has nothing it is allowed to expire, so the destructive branch never ran. The new
     * casualty gives the older row terminal evidence — the state in which convergence WOULD act — and
     * asserts the placeholder still expires nothing.
     */
    /*
     * #1436 P1 — AN ACTIVE RECOVERY CREATE IS NOT A SAVE EITHER.
     *
     * `v_initial_at_cap` gated only whether a non-converged result RAISES; every transcript-bearing
     * create still called the coordinator. A sub-600s recovery create inserts an `active` row, and for
     * an already-armed user whose retained transcript carries terminal evidence that new row ranks
     * first — so the coordinator immediately expired the previously saved transcript. If the recovery
     * take was then abandoned, or its `complete_session_v2` failed, the user was left with strictly
     * less readable text than before they started, and the loss is irreversible.
     *
     * The rule the placeholder branch already states applies here unchanged: retention converges on
     * COMPLETION. The at-cap create is the only create that IS a completion; everything else defers
     * and expires nothing, and the real convergence happens when `complete_session_v2` runs.
     */
    IF NOT v_writes_transcript THEN
        v_retention := jsonb_build_object('status', 'deferred', 'reason', 'placeholder_create');
    ELSIF NOT v_initial_at_cap THEN
        v_retention := jsonb_build_object('status', 'deferred', 'reason', 'create_not_completed');
    ELSE
        BEGIN
            v_retention := public.converge_transcript_retention(auth.uid());
        EXCEPTION
            WHEN query_canceled THEN
                RAISE;
            WHEN OTHERS THEN
                RAISE;
        END;
    END IF;

    /*
     * #1436 P1 — A LATE-CREATE RECOVERY MUST REACH `complete_session_v2`.
     *
     * The missing-session recovery path supplies a real transcript with an ordinary sub-600s duration,
     * so the row is inserted ACTIVE and retention legitimately defers. Treating that deferral as a
     * failure rolled the row back and returned no session id, so the controller never reached the
     * authoritative completion transaction and never installed its full-save retry — the recovery
     * path was broken by the guard meant to protect it.
     *
     * Only a create that is ITSELF a completed save owes convergence. An active create defers, keeps
     * its row, and converges when completion arms and runs it.
     */
    IF v_writes_transcript
       AND v_initial_at_cap
       AND COALESCE(v_retention->>'status', 'error') NOT IN ('converged', 'pending', 'non_converged')
       AND NOT (
         v_retention->>'status' = 'deferred'
         AND v_retention->>'reason' IN ('retention_not_activated', 'retention_not_armed')
       ) THEN
        RAISE EXCEPTION 'create_session_and_update_usage: transcript retention did not converge (status=%)',
            COALESCE(v_retention->>'status', 'error')
            USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
        'new_session', (SELECT row_to_json(s) FROM public.sessions s WHERE s.id = v_new_session_id),
        'usage_exceeded', false,
        'at_cap', v_initial_at_cap,
        'max_duration_seconds', 600,
        'retention', v_retention
    );
END;
$$;

-- #1476 — FENCE EVERY WRITE PATH. Old clients complete with a direct RLS update and heartbeat through
-- `heartbeat_session`; `complete_session_v2` updates the same row. One trigger covers them all, including a client that
-- skips the RPCs entirely.
CREATE OR REPLACE FUNCTION public._ss_fence_session_writes_1476()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_lease public.active_recording_lease%ROWTYPE;
    v_found BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'active' THEN
            SELECT * INTO v_lease FROM public.active_recording_lease WHERE user_id = NEW.user_id;
            v_found := FOUND;
            IF NEW.lease_id IS NULL
               OR NOT (v_found AND v_lease.lease_id = NEW.lease_id AND v_lease.heartbeat_at >= now() - interval '15 seconds')
            THEN
                RAISE EXCEPTION 'lease_not_held: an active take must be created under this account''s live recording lease'
                    USING ERRCODE = 'P0001';
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- UPDATE
    IF OLD.lease_id IS NULL THEN
        RETURN NEW; -- created before this fence: unchanged behaviour
    END IF;

    -- Codex P1 on dae853fb: CLOSING a take is never recording work. A displaced or abandoned take may always be marked
    -- `failed` (transcript unchanged) — that is how its device resolves it (Discard) instead of being locked behind a
    -- Retry Save the server will never accept. Completing it, or changing its transcript, stays refused.
    IF NEW.status = 'failed' AND NEW.transcript IS NOT DISTINCT FROM OLD.transcript THEN
        RETURN NEW;
    END IF;

    -- A leased take that has FAILED (abandoned, displaced and discarded, or closed by its own device) stays closed:
    -- it can never be revived, completed or given a transcript later.
    IF OLD.status = 'failed'
       AND (NEW.status IS DISTINCT FROM OLD.status
            OR NEW.duration IS DISTINCT FROM OLD.duration
            OR NEW.transcript IS DISTINCT FROM OLD.transcript) THEN
        RAISE EXCEPTION 'lease_revoked: this take is closed and cannot be revived'
            USING ERRCODE = 'P0001';
    END IF;

    IF OLD.status IS DISTINCT FROM 'active' THEN
        RETURN NEW;
    END IF;

    -- The server's own #1360 closure of an abandoned take.
    IF NEW.status = 'failed' AND NEW.status_reason = 'abandoned_device' THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_lease FROM public.active_recording_lease WHERE user_id = OLD.user_id;
    v_found := FOUND;

    IF v_found AND v_lease.lease_id <> OLD.lease_id
       AND v_lease.heartbeat_at >= now() - interval '15 seconds'
       AND OLD.lease_released_at IS NULL THEN
        RAISE EXCEPTION 'lease_revoked: another device took over this recording'
            USING ERRCODE = 'P0001';
    END IF;

    -- An OLD client's implicit lease (lease_id = session id): alive while it heartbeats, released when the take ends.
    IF v_found AND v_lease.lease_id = OLD.id THEN
        IF NEW.status IS DISTINCT FROM 'active' THEN
            DELETE FROM public.active_recording_lease WHERE user_id = OLD.user_id AND lease_id = OLD.id;
        ELSE
            UPDATE public.active_recording_lease SET heartbeat_at = now() + interval '30 seconds'
            WHERE user_id = OLD.user_id AND lease_id = OLD.id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._ss_fence_session_writes_1476() FROM PUBLIC;

DROP TRIGGER IF EXISTS fence_session_writes_1476 ON public.sessions;
CREATE TRIGGER fence_session_writes_1476
    BEFORE INSERT OR UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public._ss_fence_session_writes_1476();

-- #1476 — A NORMAL STOP IS NOT A DISPLACEMENT. Releasing the lease stamps the take it covered, so its later save (or
-- Retry Save) is accepted even after another device has started. A displaced holder's release finds no row (the lease
-- was taken over), stamps nothing, and stays fenced.
CREATE OR REPLACE FUNCTION public.release_recording_lease(p_lease_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (select auth.uid());
  v_released boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('released', false, 'reason', 'unauthenticated');
  END IF;

  DELETE FROM public.active_recording_lease WHERE user_id = v_uid AND lease_id = p_lease_id;
  v_released := FOUND;
  IF v_released THEN
    UPDATE public.sessions SET lease_released_at = now()
    WHERE user_id = v_uid AND lease_id = p_lease_id AND status = 'active' AND lease_released_at IS NULL;
  END IF;
  RETURN jsonb_build_object('released', v_released);
END;
$$;

GRANT EXECUTE ON FUNCTION public.release_recording_lease(uuid) TO authenticated;

-- #1476 — PROGRESS IS OWED PER COMPLETED SESSION, AND THE SERVER OWNS THE TRUTH.
--
-- A browser queue cannot be cross-device (or cross-version) truth: an old tab's later write erased a verified v1
-- signal. The server already knows which of an account's completed takes have no `session_progress_evaluations` row,
-- so every device reads its obligations from here:
--   owed     — attribution is TERMINAL (an authority row or a definitive unattributed marker, the exact predicate
--              `record_progress_evaluation` uses) and no evaluation exists: settle it with that RPC now;
--   pending  — attribution is not terminal: the RPC returns NULL and writes nothing. That is NOT settlement; the take
--              stays listed until a real row exists.
-- A take with an evaluation row is terminal and not listed. Evaluation is order-independent (baseline/previous are
-- chosen by persisted created_at), so settling late — from any device — yields the same row.
-- Bounded: the caller's own takes only, newest first, at most 50, within the last 14 days.
CREATE OR REPLACE FUNCTION public.get_progress_obligations(p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object('session_id', o.id, 'state', o.state) ORDER BY o.created_at DESC, o.id)
        FROM (
            SELECT s.id, s.created_at,
                   CASE WHEN EXISTS (SELECT 1 FROM public.session_attribution_authority a
                                     WHERE a.session_id = s.id AND a.user_id = v_uid)
                          OR EXISTS (SELECT 1 FROM public.session_attribution_unattributed u
                                     WHERE u.session_id = s.id AND u.user_id = v_uid)
                        THEN 'owed' ELSE 'pending' END AS state
            FROM public.sessions s
            WHERE s.user_id = v_uid
              AND s.status = 'completed'
              AND s.created_at >= now() - interval '14 days'
              AND NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations e WHERE e.session_id = s.id)
            ORDER BY s.created_at DESC, s.id
            LIMIT least(greatest(COALESCE(p_limit, 20), 1), 50)
        ) o
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_progress_obligations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_progress_obligations(integer) TO authenticated;
