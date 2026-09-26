-- #1258 — THE SAVED SESSION RECORDS ITS PRODUCT (Open Mic or Focus Points), durably, at creation (PO-authorized design,
-- PM-accepted 2026-09-26; #1535 comments 5848665275 / 5848635933).
--
-- Why: Analytics inferred "Open Mic" from the ABSENCE of Focus Points scoring rows, but a Focus take whose source
-- registration failed (non-fatal, after completion) has no Focus row at all — so it was shown and re-practised as the
-- wrong product. No existing durable field can tell the two apart; this adds one.
--
-- Contract:
--   1. `public.sessions.product` — NULL | 'open_mic' | 'focus_points'. No backfill: a NULL is a row created before this
--      marker (or by a client that predates it) and is read as "product not recorded", never guessed.
--   2. `create_session_and_update_usage` takes the value from `p_session_data.product` (no new argument — an old
--      server ignores the key; an old client omits it), validates it BEFORE any lookup/lock/lease/usage write/insert
--      (`invalid_product`, nothing created or changed), and writes it in the SAME INSERT for normal and save-only
--      creation. An idempotent replay returns the existing row untouched, so the first stored value is kept.
--   3. Immutable after creation, for every role, via `_ss_session_product_guard_1258` (generic errors, no row echo; the
--      CHECK below is defence in depth and is never reached because the BEFORE trigger raises first). The authenticated
--      column-level UPDATE whitelist (20260910193000) does not include `product` and is not widened here.
--
-- Additive and backward compatible. Merge is not apply: applying this migration is a separate, PO-authorized gated step,
-- and the #1535 client writer/reader ships only after it is applied.

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS product text;

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_product_closed_1258;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_product_closed_1258
    CHECK (product IS NULL OR product IN ('open_mic', 'focus_points'));

COMMENT ON COLUMN public.sessions.product IS
    '#1258: the recording''s product at creation — open_mic | focus_points; NULL = not recorded (pre-marker). Immutable.';

CREATE OR REPLACE FUNCTION public._ss_session_product_guard_1258()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.product IS DISTINCT FROM OLD.product THEN
            RAISE EXCEPTION 'product_immutable' USING ERRCODE = '42501';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.product IS NOT NULL AND NEW.product NOT IN ('open_mic', 'focus_points') THEN
        RAISE EXCEPTION 'invalid_product' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._ss_session_product_guard_1258() FROM PUBLIC;

DROP TRIGGER IF EXISTS ss_session_product_guard_1258 ON public.sessions;
CREATE TRIGGER ss_session_product_guard_1258
    BEFORE INSERT OR UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public._ss_session_product_guard_1258();

-- The current definition (20260923120000_one_active_engine_per_account_1476.sql), unchanged except: `v_product` is read
-- and validated first, and written in the single sessions INSERT. Existing EXECUTE grants are preserved by REPLACE.
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
    v_written UUID;
    v_lease_live BOOLEAN := false;
    v_legacy_take BOOLEAN := false;
    -- #1476 PM RETURN on 039043877 (F2): a missing-row Retry Save. It asks for LESS than a take — a row that can never
    -- record — so the request is not an authority claim: it takes no lease and no slot, bills the recording's duration
    -- through the ordinary entitlement check, and is bound to the recording's own idempotency identity.
    v_save_only BOOLEAN := COALESCE(p_session_data->>'save_only', '') = 'true';
    -- #1258 durable product marker: read once, validated below BEFORE any lookup, lock, lease, usage write or insert.
    v_product TEXT := p_session_data->>'product';
BEGIN
    SET LOCAL statement_timeout = '3000ms';

    -- #1258: a closed enum. An absent (or JSON null) product is a client that predates the marker: the row is created
    -- with product NULL (legacy/unknown). Anything else outside the enum is refused before this call does anything,
    -- with a generic code and no echo of the caller's payload.
    IF v_product IS NOT NULL AND v_product NOT IN ('open_mic', 'focus_points') THEN
        RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'invalid_product');
    END IF;

    IF v_save_only AND p_idempotency_key IS NULL THEN
        RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'save_only_requires_recording_identity');
    END IF;

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
     *  - #1360 bounded recovery: a device that stopped responding holds only a STALE lease, which the next Start acquires;
     *    nothing else blocks the returning user. Its take is never closed here — the device that recorded it can still
     *    save it when it reconnects (PM directive: a save failure must stay recoverable).
     * Pro and Free alike: this check, not the tier's session cap, is what holds an account to one engine.
     */
    v_is_take := COALESCE((p_session_data->>'duration')::INT, 0) <> 600 AND NOT v_save_only;
    IF v_is_take THEN
        v_lease_text := p_session_data->>'lease_id';
        IF v_lease_text IS NOT NULL
           AND v_lease_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
            RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'lease_not_held');
        END IF;
        v_lease_id := v_lease_text::uuid;

        -- PM RETURN on 54576db9: serialize with `acquire_recording_lease` PER ACCOUNT. On an empty account a row lock
        -- has nothing to lock, so an old client and a current client could each decide the account was free.
        PERFORM pg_advisory_xact_lock(hashtextextended('ss_recording_lease_1476:' || auth.uid()::text, 0));
        SELECT * INTO v_lease FROM public.active_recording_lease WHERE user_id = auth.uid() FOR UPDATE;
        v_lease_live := FOUND AND v_lease.heartbeat_at >= now() - interval '15 seconds';

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
            -- PM pre-push RETURN (F4) — AN OLD TAB CANNOT SEE ANOTHER DEVICE'S PROGRESS DEBT. A pre-#1525 bundle reads only
            -- its v1 queue, and resumes a Start held on model preparation without re-checking freshness, so its placeholder
            -- create can arrive after a newer device completed a take whose Progress evaluation has not landed. The server
            -- holds that old client exactly as long as a current client holds its own Start on queued debt: its release
            -- bound is 60 s (PROGRESS_DEBT_RELEASE_BOUND_MS); 90 s here adds slack. Bounded, so no old tab is locked out by
            -- a debt that keeps failing; the debt itself stays owed. The old bundle maps this to a failed start (no row).
            -- A current client (it sends its lease) is governed by its own Start gate, which reads the server's obligations.
            IF EXISTS (
                SELECT 1 FROM public.sessions s
                WHERE s.user_id = auth.uid()
                  AND s.status = 'completed'
                  AND GREATEST(COALESCE(s.updated_at, s.created_at),
                               s.created_at + make_interval(secs => COALESCE(s.duration, 0))) >= now() - interval '90 seconds'
                  AND NOT EXISTS (SELECT 1 FROM public.session_progress_evaluations e WHERE e.session_id = s.id)
            ) THEN
                RETURN jsonb_build_object('new_session', null, 'usage_exceeded', false, 'error', 'progress_evaluation_pending');
            END IF;
        END IF;
    END IF;

    -- #1476: the tier's session cap now counts only LEGACY takes created before this fence (no lease). A leased take is
    -- governed by the lease above; counting it would hold a returning user (#1360) or a device that took over behind a
    -- take that has already stopped and is only saving.
    -- PM RETURN on 039043877: a fenced row (displaced, or save-only) can never record, so it holds no slot.
    SELECT COUNT(*) INTO v_active_sessions
    FROM public.sessions
    WHERE user_id = auth.uid()
      AND status = 'active'
      AND lease_id IS NULL
      AND recording_fenced_at IS NULL
      AND (expires_at IS NULL OR expires_at > now());

    IF NOT v_save_only AND v_active_sessions >= v_max_concurrent THEN
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
    v_initial_at_cap := (v_duration = 600) AND NOT v_save_only;

    IF v_legacy_take THEN
        -- The OLD client's implicit lease, written BEFORE the take row so the insert fence sees it. Its heartbeat_session runs every ~30 s, so the lease is kept 30 s ahead of
        -- now; the 15 s staleness window then tolerates the old cadence.
        -- Never replaces a LIVE holder (PM RETURN on 54576db9): only a stale lease is taken, and a refused upsert refuses
        -- the take with the code every shipped bundle renders.
        -- A stale holder this take replaces is DISPLACED, permanently (PM RETURN on 039043877, F1).
        IF v_lease.lease_id IS NOT NULL THEN
            UPDATE public.sessions
            SET recording_fenced_at = now(), recording_fenced_reason = 'displaced'
            WHERE user_id = auth.uid() AND lease_id = v_lease.lease_id AND status = 'active'
              AND lease_released_at IS NULL AND recording_fenced_at IS NULL;
        END IF;
        v_written := NULL;
        INSERT INTO public.active_recording_lease AS l (user_id, lease_id, holder_label, state, started_at, heartbeat_at)
        VALUES (auth.uid(), v_new_session_id, 'an older version of SpeakSharp', 'recording', now(), now() + interval '30 seconds')
        ON CONFLICT (user_id) DO UPDATE
          SET lease_id = EXCLUDED.lease_id, holder_label = EXCLUDED.holder_label, state = 'recording',
              started_at = now(), heartbeat_at = EXCLUDED.heartbeat_at
          WHERE l.heartbeat_at < now() - interval '15 seconds'
        RETURNING l.lease_id INTO v_written;
        IF v_written IS NULL THEN
            RETURN jsonb_build_object(
                'new_session', null,
                'usage_exceeded', true,
                'error', 'max_concurrent_sessions_reached',
                'active_sessions', 1,
                'max_concurrent_sessions', 1
            );
        END IF;
    END IF;

    INSERT INTO public.sessions (
        id, user_id, title, duration, total_words, filler_words, accuracy, ground_truth,
        transcript, engine, clarity_score, wpm, idempotency_key, engine_version,
        model_name, device_type, status, expires_at, lease_id, recording_fenced_at, recording_fenced_reason, product
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
             ELSE v_lease_id END,
        CASE WHEN v_save_only THEN now() END,
        CASE WHEN v_save_only THEN 'save_only' END,
        v_product
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

