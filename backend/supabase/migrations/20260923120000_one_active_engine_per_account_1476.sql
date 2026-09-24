-- #1476 — ONE ACCOUNT MAY ONLY RUN ONE STT ENGINE AT A TIME, across tabs and devices (PO rule, 2026-09-23).
--
-- Authority: the account-keyed `active_recording_lease` (20260607040000), which the recording flow never used. This
-- migration makes the SERVER enforce it, because a client cannot fence another device, an old bundle, or itself once
-- displaced:
--   1. `create_session_and_update_usage` admits a TAKE only under the caller's live lease (current clients pass it in
--      `p_session_data.lease_id`); an old client with no lease gets an implicit lease, or `max_concurrent_sessions_reached`
--      while another take is live. A device that stopped responding holds only a stale lease, which the next Start takes;
--      its take is left for that device to save (#1360).
--   2. `_ss_fence_session_writes_1476` refuses any write that keeps a DISPLACED take recording (another holder is live
--      and this take never released its lease) — but the take may still END: its save or Retry Save is accepted, so
--      recorded work stays recoverable. It also refuses reviving a failed take and any direct insert of an active take
--      that does not carry the caller's live lease.
--   3. `release_recording_lease` stamps its take `lease_released_at`, which is what separates a normal Stop from a
--      displacement.
-- Offline devices cannot be stopped remotely: what this guarantees is ONE AUTHORIZED engine — a displaced device can no
-- longer record against the account (its heartbeats are refused), and what it had recorded can still be saved.
--
-- Additive and backward compatible: no new RPC argument, so a client that sends `lease_id` works against the previous
-- definition (which ignores it) and an old client works against this one. Merge is not apply: applying this migration
-- to Production requires its own exact PO authorization.

-- PM RETURN on the 1ca8d72f backfill — FAIL CLOSED ON AN UNIDENTIFIABLE LIVE LEASE, BEFORE ANY CHANGE. The account-lease
-- RPCs predate this migration, so a current client can hold a live lease L while the previous writer (which discarded the
-- payload lease_id) records its take — and on Pro an old client can record beside it, before or after, or while L's holder
-- is still preparing. Nothing in the pre-#1476 data says which active take belongs to L, and a timestamp guess either
-- displaces a healthy take or authorizes two. So if any account holds a live lease with an active take created since that
-- lease started, this migration refuses; retry at a quiet point. Checked first, under the lock and before any DDL, so a
-- refusal by THIS check changes nothing. The Production route applies the whole file in one transaction (the exact-apply
-- workflow, Supabase CLI pinned at 2.101.0), where any refusal rolls everything back. Do not hand-apply this file
-- statement by statement: there, a refusal by the second check below would come after DDL that has already committed.
DO $guard_1476$
BEGIN
    LOCK TABLE public.active_recording_lease IN EXCLUSIVE MODE;
    IF EXISTS (
        SELECT 1
        FROM public.active_recording_lease l
        JOIN public.sessions s ON s.user_id = l.user_id
        WHERE l.heartbeat_at >= now() - interval '15 seconds'
          AND s.status = 'active'
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND (to_jsonb(s) ->> 'lease_id') IS NULL
          AND s.created_at >= l.started_at - interval '5 seconds'
    ) THEN
        RAISE EXCEPTION 'one_active_engine_1476: % account(s) hold a live recording lease with an active take created during it; the pre-#1476 writer did not record which take owns the lease, so it cannot be identified. Nothing was changed — retry this apply at a quiet point (no live lease with an active take).',
            (SELECT count(DISTINCT l.user_id)
             FROM public.active_recording_lease l
             JOIN public.sessions s ON s.user_id = l.user_id
             WHERE l.heartbeat_at >= now() - interval '15 seconds'
               AND s.status = 'active'
               AND (s.expires_at IS NULL OR s.expires_at > now())
               AND (to_jsonb(s) ->> 'lease_id') IS NULL
               AND s.created_at >= l.started_at - interval '5 seconds')
            USING ERRCODE = '55000';
    END IF;
END
$guard_1476$;

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS lease_id uuid;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS lease_released_at timestamptz;
-- #1476 PM RETURN on 039043877 — ONE SERVER-OWNED MARK FOR "THIS ROW CAN NEVER RECORD". Set when a take is DISPLACED (another
-- holder took the account's lease over its take) and when a missing-row Retry Save creates a SAVE-ONLY row. A marked row
-- may END — completed (its save, or a Retry Save), or failed (discard) — but no write may keep it active: no heartbeat,
-- no usage accrual, no resume. Permanent: independent of whatever later happens to the successor's lease.
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS recording_fenced_at timestamptz;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS recording_fenced_reason text;
DO $c$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_recording_fenced_reason_1476') THEN
        ALTER TABLE public.sessions ADD CONSTRAINT sessions_recording_fenced_reason_1476
            CHECK (recording_fenced_reason IS NULL OR recording_fenced_reason IN ('displaced', 'save_only'));
    END IF;
END $c$;

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
BEGIN
    SET LOCAL statement_timeout = '3000ms';

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
        model_name, device_type, status, expires_at, lease_id, recording_fenced_at, recording_fenced_reason
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
        CASE WHEN v_save_only THEN 'save_only' END
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

-- #1476 Codex P1 on 040da46a — RECORDINGS ALREADY RUNNING WHEN THIS APPLIES. A take created by the previous function has
-- no lease_id and no lease row, so it would be invisible to the fence: a new device could take the account's lease and,
-- on Pro (cap 50), record beside it. Backfill: every still-live legacy take gets an implicit lease id (its own session id,
-- exactly what the new writer gives an old client), and the NEWEST such take per account holds the account's lease row,
-- kept 30 s ahead so the old client's own heartbeat (`_ss_fence_session_writes_1476`) keeps it alive. An account that
-- already has a LIVE lease keeps it. Older concurrent legacy takes on the same account are thereby displaced: they may
-- still end (save) but not continue.

-- PM RETURN on 1ca8d72f — ONE SERIALIZED CLASSIFICATION. Taken as a single statement holding the account-lease table in
-- EXCLUSIVE mode, so no lease can be acquired, forced, heartbeated or released while takes are classified. EXCLUSIVE (not
-- SHARE ROW EXCLUSIVE) because an in-flight PRE-migration acquire opens with `SELECT … FOR UPDATE` (ROW SHARE): it must wait
-- here and read the committed state — found on actual PostgreSQL, where a weaker lock let that call overwrite the classified
-- holder once the migration committed. Plain reads are not blocked. No live lease is ever attached by guessing (see the guard
-- at the top): takes created BEFORE a live lease started cannot be its holder's and are legacy; an account with a live lease
-- and an active take created during it refuses this migration.
DO $backfill_1476$
BEGIN
    LOCK TABLE public.active_recording_lease IN EXCLUSIVE MODE;

    -- Re-checked under this block's lock: a defence and a clear error if a live lease with a take appeared after the first
    -- check. It rolls back the whole migration only when the file is applied in one transaction (the Production route); it
    -- cannot undo statements already committed by a statement-by-statement apply.
    IF EXISTS (
        SELECT 1
        FROM public.active_recording_lease l
        JOIN public.sessions s ON s.user_id = l.user_id
        WHERE l.heartbeat_at >= now() - interval '15 seconds'
          AND s.status = 'active'
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND (to_jsonb(s) ->> 'lease_id') IS NULL
          AND s.created_at >= l.started_at - interval '5 seconds'
    ) THEN
        RAISE EXCEPTION 'one_active_engine_1476: % account(s) hold a live recording lease with an active take created during it; the pre-#1476 writer did not record which take owns the lease, so it cannot be identified. Nothing was changed — retry this apply at a quiet point (no live lease with an active take).',
            (SELECT count(DISTINCT l.user_id)
             FROM public.active_recording_lease l
             JOIN public.sessions s ON s.user_id = l.user_id
             WHERE l.heartbeat_at >= now() - interval '15 seconds'
               AND s.status = 'active'
               AND (s.expires_at IS NULL OR s.expires_at > now())
               AND (to_jsonb(s) ->> 'lease_id') IS NULL
               AND s.created_at >= l.started_at - interval '5 seconds')
            USING ERRCODE = '55000';
    END IF;

    UPDATE public.sessions
    SET lease_id = id
    WHERE status = 'active'
      AND lease_id IS NULL
      AND (expires_at IS NULL OR expires_at > now());

    INSERT INTO public.active_recording_lease (user_id, lease_id, holder_label, state, started_at, heartbeat_at)
    SELECT DISTINCT ON (s.user_id) s.user_id, s.id, 'an older version of SpeakSharp', 'recording', now(), now() + interval '30 seconds'
    FROM public.sessions s
    WHERE s.status = 'active'
      AND s.lease_id = s.id
      AND (s.expires_at IS NULL OR s.expires_at > now())
    ORDER BY s.user_id, s.created_at DESC, s.id
    ON CONFLICT (user_id) DO UPDATE
      SET lease_id = EXCLUDED.lease_id, holder_label = EXCLUDED.holder_label, state = 'recording',
          started_at = now(), heartbeat_at = EXCLUDED.heartbeat_at
      WHERE public.active_recording_lease.heartbeat_at < now() - interval '15 seconds';

    -- PM RETURN on 039043877 (F1): the older concurrent legacy takes above are DISPLACED — record that permanently, so a
    -- take is not revived when the lease holder later releases or goes stale.
    UPDATE public.sessions s
    SET recording_fenced_at = now(), recording_fenced_reason = 'displaced'
    WHERE s.status = 'active'
      AND s.lease_id = s.id
      AND s.recording_fenced_at IS NULL
      AND (s.expires_at IS NULL OR s.expires_at > now())
      AND NOT EXISTS (SELECT 1 FROM public.active_recording_lease l WHERE l.user_id = s.user_id AND l.lease_id = s.id);
END
$backfill_1476$;

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
        -- A save-only row (PM RETURN on 039043877, F2) is active only so the ordinary completion path can finish it; it
        -- can never record, so it needs no lease.
        IF NEW.status = 'active' AND NEW.recording_fenced_at IS NULL THEN
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
    -- PM RETURN on 039043877 — THE RECORDING FENCE (displaced, or save-only). Checked before every exemption below.
    IF OLD.recording_fenced_at IS NOT NULL
       AND (NEW.recording_fenced_at IS DISTINCT FROM OLD.recording_fenced_at
            OR NEW.recording_fenced_reason IS DISTINCT FROM OLD.recording_fenced_reason) THEN
        RAISE EXCEPTION 'recording_fenced: this take can no longer record, and that cannot be undone'
            USING ERRCODE = 'P0001';
    END IF;
    IF OLD.recording_fenced_at IS NULL AND NEW.recording_fenced_at IS NOT NULL THEN
        -- The server marking a take displaced: the mark only, nothing else in the same write.
        IF NEW.status IS DISTINCT FROM OLD.status OR NEW.duration IS DISTINCT FROM OLD.duration
           OR NEW.transcript IS DISTINCT FROM OLD.transcript THEN
            RAISE EXCEPTION 'recording_fenced: a fence mark is written on its own'
                USING ERRCODE = 'P0001';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.recording_fenced_at IS NOT NULL THEN
        -- Never RESUME: a fenced row that has ended cannot be reopened.
        IF OLD.status IS DISTINCT FROM 'active' AND NEW.status IS NOT DISTINCT FROM 'active' THEN
            RAISE EXCEPTION 'lease_revoked: this take can no longer record and cannot be reopened'
                USING ERRCODE = 'P0001';
        END IF;
        IF OLD.status = 'active' AND NEW.status IS NOT DISTINCT FROM 'active' THEN
            RAISE EXCEPTION 'lease_revoked: this take can no longer record; it can be saved or discarded'
                USING ERRCODE = 'P0001';
        END IF;
        IF OLD.status = 'failed'
           AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.duration IS DISTINCT FROM OLD.duration
                OR NEW.transcript IS DISTINCT FROM OLD.transcript) THEN
            RAISE EXCEPTION 'lease_revoked: this take is closed and cannot be revived'
                USING ERRCODE = 'P0001';
        END IF;
        -- A save-only row was billed at creation for the recording's duration; its save cannot claim more.
        IF OLD.recording_fenced_reason = 'save_only' AND COALESCE(NEW.duration, 0) > COALESCE(OLD.duration, 0) THEN
            RAISE EXCEPTION 'recording_fenced: a save-only row cannot save more than the duration it was billed for'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF OLD.lease_id IS NULL THEN
        RETURN NEW; -- created before this fence (or save-only): unchanged behaviour
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

    SELECT * INTO v_lease FROM public.active_recording_lease WHERE user_id = OLD.user_id;
    v_found := FOUND;

    -- DISPLACED (another device now holds the account's live lease, and this take never released its own): the take
    -- may END — completed with what it recorded (its save, or a later Retry Save) or failed (discard) — but it may not
    -- CONTINUE: a write that keeps it active (a heartbeat, usage accrual) is recording work the account no longer
    -- authorizes. PM directive on dae853fb: a save failure must stay recoverable, so the save itself is never refused.
    IF v_found AND v_lease.lease_id <> OLD.lease_id
       AND v_lease.heartbeat_at >= now() - interval '15 seconds'
       AND OLD.lease_released_at IS NULL
       AND NEW.status IS NOT DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'lease_revoked: another device took over this recording; it can be saved but not continued'
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

-- #1476 — ACQUIRE MUST NOT OVERWRITE A LIVE HOLDER UNDER A RACE (found on actual PostgreSQL, not PGlite).
-- The original acquire read the row FOR UPDATE and then upserted. When NO row existed yet, two simultaneous Starts both
-- read nothing (nothing to lock), both inserted, and the loser's ON CONFLICT DO UPDATE — after waiting for the winner to
-- commit — overwrote the winner's LIVE lease without re-checking it. Both devices were told `acquired` and both recorded.
-- The conflict update now applies only when the existing row is this same lease, stale, or explicitly taken over; the
-- decision is made under the row lock the upsert holds, and a refused upsert reports the live holder.
CREATE OR REPLACE FUNCTION public.acquire_recording_lease(
  p_lease_id uuid,
  p_holder_label text DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := (select auth.uid());
  v_existing public.active_recording_lease%ROWTYPE;
  v_took_over boolean := false;
  v_written uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('acquired', false, 'reason', 'unauthenticated');
  END IF;

  -- PM RETURN on 54576db9: the same per-account lock `create_session_and_update_usage` takes for an old client's implicit
  -- lease, so the two acquisition paths never both find an empty account free.
  PERFORM pg_advisory_xact_lock(hashtextextended('ss_recording_lease_1476:' || v_uid::text, 0));
  SELECT * INTO v_existing FROM public.active_recording_lease WHERE user_id = v_uid FOR UPDATE;
  v_took_over := FOUND AND v_existing.lease_id <> p_lease_id
                 AND v_existing.heartbeat_at >= now() - interval '15 seconds' AND p_force;

  -- PM RETURN on 039043877 (F1): a lease this acquire REPLACES (forced over a live holder, or a stale one) displaces that
  -- holder's take permanently. Decided under the per-account lock and the row lock, so the upsert below cannot then refuse.
  IF v_existing.lease_id IS NOT NULL AND v_existing.lease_id <> p_lease_id
     AND (p_force OR v_existing.heartbeat_at < now() - interval '15 seconds') THEN
    UPDATE public.sessions
    SET recording_fenced_at = now(), recording_fenced_reason = 'displaced'
    WHERE user_id = v_uid AND lease_id = v_existing.lease_id AND status = 'active'
      AND lease_released_at IS NULL AND recording_fenced_at IS NULL;
  END IF;

  INSERT INTO public.active_recording_lease AS l (user_id, lease_id, holder_label, state, started_at, heartbeat_at)
  VALUES (v_uid, p_lease_id, p_holder_label, 'recording', now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET lease_id = EXCLUDED.lease_id,
        holder_label = EXCLUDED.holder_label,
        state = 'recording',
        started_at = now(),
        heartbeat_at = now()
    WHERE l.lease_id = EXCLUDED.lease_id
       OR l.heartbeat_at < now() - interval '15 seconds'
       OR p_force
  RETURNING l.lease_id INTO v_written;

  IF v_written IS NULL THEN
    SELECT * INTO v_existing FROM public.active_recording_lease WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'acquired', false,
      'reason', 'held_by_other',
      'holder_label', v_existing.holder_label,
      'started_at', v_existing.started_at
    );
  END IF;

  RETURN jsonb_build_object('acquired', true, 'took_over', v_took_over);
END;
$$;

GRANT EXECUTE ON FUNCTION public.acquire_recording_lease(uuid, text, boolean) TO authenticated;

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
