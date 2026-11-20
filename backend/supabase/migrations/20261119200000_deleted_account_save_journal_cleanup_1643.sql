-- #1643 follow-up (PO 2026-11-19: "make sure save records are deleted"; "you need to clean up after yourself").
--
-- An `account_save_obligations` row has no foreign key to auth.users, and its `completed` rows survive the Auth
-- deletion that live proofs use (`auth.admin.deleteUser`). Only the product's own closure completion
-- (complete_account_pending_completion_v1) removes them, and service_role can neither read nor write the table.
-- So every run-owned proof account that saved a take leaves its finished save-journal rows behind.
--
-- Run ownership (Sam, #1906 review): the deletion must be refused when a run names ANOTHER run's deleted account. The
-- account's own run binding (app_metadata.ct_run for the RWT journeys, app_metadata.canary_run for the canary; written only
-- by the service role) is deleted with the account, so it cannot be checked afterwards. The ownership is therefore made
-- durable BEFORE the deletion, by the database, in a claim that outlives the account:
--   * claim_account_save_journal_cleanup_v1(uid, binding, token): while the account STILL EXISTS, only for a run-owned proof
--     address, and only when the run presents exactly the binding the service role wrote on that account (none for an
--     unbound local account). Records the account, that binding and the SHA-256 of a one-time secret the run generated
--     and never stores. Re-claiming is allowed only while the account still exists and on the same checks (a retried
--     cleanup); once the account is gone, nobody can claim it.
--   * delete_deleted_account_save_journal_v1(uid, token): for an account that NO LONGER EXISTS in Auth and whose claim's
--     secret matches, removes its `completed` rows and returns how many rows of that account remain (0 when clean). It
--     refuses an unclaimed account or a foreign secret, while the account still exists, while any of its rows is unsettled,
--     and while a product closure completion for that account is processing. A clean result removes the claim too, so a
--     finished cleanup leaves nothing behind.
--   * resume_account_save_journal_cleanup_v1(uid, email, binding, token) (Sam, #1906 review: "a run using this new code must
--     still be able to finish its own cleanup after Auth deletion and a restart"): the one-time secret dies with a crashed
--     cleanup, so after the account is GONE the same run may replace the secret of an existing claim, and only on the proof the
--     claim itself recorded: exactly the run binding it was made with (never an unbound claim: an unbound account's only proof was
--     the lost secret) and the same address. Another run's binding, another address, a live account or no claim is refused.
--   * resume_run_account_save_journal_cleanups_v1(binding, token) (Sam, #1906 review: "the actual restarted runner still has to
--     prove it can find that account after deletion"): a restarted process has lost the deleted account's id with its memory, but
--     its run binding (the GitHub run it belongs to) is in its environment and in every claim it made. For exactly that non-null
--     binding, each claim made with it whose account is GONE gets the fresh secret and its id is returned, so the run can finish
--     it. Another run's binding (including another attempt of the same run) finds nothing and changes nothing; an unbound
--     (local) run cannot ask.
--   * list_unfinished_account_save_journal_cleanup_runs_v1(min_age_seconds): the run bindings (never account ids) of claims whose
--     account is gone and that are older than the floor, so the governed interrupted-run recovery can find a run that died before
--     finishing; it finishes a terminated run only through the function above, presenting that run's binding.
--   * count_account_save_journal_v1(uid): read-only count of that account's rows, for an independent readback.
-- No table access is granted to any client role.

CREATE TABLE public.account_save_journal_cleanup_claims (
  user_id uuid PRIMARY KEY,                    -- no FK: the claim must outlive the account it names
  run_binding jsonb CHECK (run_binding IS NULL OR jsonb_typeof(run_binding) = 'object'),
  token_sha256 bytea NOT NULL CHECK (octet_length(token_sha256) = 32),
  email_sha256 bytea NOT NULL CHECK (octet_length(email_sha256) = 32),  -- the claimed address, so a resume names the same account
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.account_save_journal_cleanup_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_save_journal_cleanup_claims FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.claim_account_save_journal_cleanup_v1(p_user_id uuid, p_run_binding jsonb, p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_email text; v_meta jsonb; v_owner jsonb; v_presented jsonb := nullif(p_run_binding,'null'::jsonb);
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'account id required' USING ERRCODE='22004'; END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'cleanup secret required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  SELECT u.email, coalesce(u.raw_app_meta_data,'{}'::jsonb) INTO v_email, v_meta FROM auth.users u WHERE u.id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'account not found' USING ERRCODE='P0002'; END IF;
  IF lower(coalesce(v_email,'')) !~ '^(private-proof-|retention-proof-|rwt-journey-|ctrial-run-)' THEN
    RAISE EXCEPTION 'account is not run-owned' USING ERRCODE='42501';
  END IF;
  IF v_meta ? 'ct_run' AND v_meta ? 'canary_run' THEN RAISE EXCEPTION 'account is not owned by this run' USING ERRCODE='42501'; END IF;
  v_owner := coalesce(v_meta->'ct_run', v_meta->'canary_run');
  IF (v_owner IS NOT NULL AND jsonb_typeof(v_owner) <> 'object') OR v_presented IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'account is not owned by this run' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.account_save_journal_cleanup_claims(user_id, run_binding, token_sha256, email_sha256)
  VALUES (p_user_id, v_owner, sha256(convert_to(p_token,'UTF8')), sha256(convert_to(lower(v_email),'UTF8')))
  ON CONFLICT (user_id) DO UPDATE SET run_binding=excluded.run_binding, token_sha256=excluded.token_sha256,
    email_sha256=excluded.email_sha256, claimed_at=clock_timestamp();
END $$;

CREATE FUNCTION public.resume_account_save_journal_cleanup_v1(p_user_id uuid, p_email text, p_run_binding jsonb, p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_claim public.account_save_journal_cleanup_claims%ROWTYPE; v_presented jsonb := nullif(p_run_binding,'null'::jsonb);
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'account id required' USING ERRCODE='22004'; END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'cleanup secret required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION 'account still exists' USING ERRCODE='55000';
  END IF;
  SELECT * INTO v_claim FROM public.account_save_journal_cleanup_claims c WHERE c.user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no cleanup claim' USING ERRCODE='P0002'; END IF;
  IF v_claim.run_binding IS NULL OR v_presented IS DISTINCT FROM v_claim.run_binding OR p_email IS NULL
     OR v_claim.email_sha256 <> sha256(convert_to(lower(p_email),'UTF8')) THEN
    RAISE EXCEPTION 'account save journal not claimed by this run' USING ERRCODE='42501';
  END IF;
  UPDATE public.account_save_journal_cleanup_claims SET token_sha256=sha256(convert_to(p_token,'UTF8')), claimed_at=clock_timestamp()
  WHERE user_id=p_user_id;
END $$;

CREATE FUNCTION public.resume_run_account_save_journal_cleanups_v1(p_run_binding jsonb, p_token text)
RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_presented jsonb := nullif(p_run_binding,'null'::jsonb); v_user uuid;
BEGIN
  IF v_presented IS NULL OR jsonb_typeof(v_presented) <> 'object' THEN RAISE EXCEPTION 'run binding required' USING ERRCODE='22004'; END IF;
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'cleanup secret required' USING ERRCODE='22023'; END IF;
  FOR v_user IN SELECT c.user_id FROM public.account_save_journal_cleanup_claims c WHERE c.run_binding = v_presented ORDER BY c.user_id LOOP
    -- Same per-account lock as every other step, taken in id order; then re-checked under it.
    PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||v_user::text,0));
    UPDATE public.account_save_journal_cleanup_claims c SET token_sha256=sha256(convert_to(p_token,'UTF8')), claimed_at=clock_timestamp()
    WHERE c.user_id=v_user AND c.run_binding = v_presented AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=v_user);
    IF FOUND THEN RETURN NEXT v_user; END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.list_unfinished_account_save_journal_cleanup_runs_v1(p_min_age_seconds integer)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_min_age_seconds IS NULL OR p_min_age_seconds < 0 THEN RAISE EXCEPTION 'minimum age required' USING ERRCODE='22023'; END IF;
  RETURN QUERY SELECT DISTINCT c.run_binding FROM public.account_save_journal_cleanup_claims c
  WHERE c.run_binding IS NOT NULL AND c.claimed_at <= clock_timestamp() - make_interval(secs => p_min_age_seconds)
    AND NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=c.user_id);
END $$;

CREATE FUNCTION public.delete_deleted_account_save_journal_v1(p_user_id uuid, p_token text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_remaining integer; v_claim bytea;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'account id required' USING ERRCODE='22004'; END IF;
  -- Same per-account lock as the product's closure completion: never interleave with it.
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION 'account still exists' USING ERRCODE='55000';
  END IF;
  SELECT c.token_sha256 INTO v_claim FROM public.account_save_journal_cleanup_claims c WHERE c.user_id=p_user_id FOR UPDATE;
  IF v_claim IS NULL OR p_token IS NULL OR v_claim <> sha256(convert_to(p_token,'UTF8')) THEN
    RAISE EXCEPTION 'account save journal not claimed by this run' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM public.account_completion_executions WHERE user_id=p_user_id AND phase<>'completed') THEN
    RAISE EXCEPTION 'account closure completion in progress' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=p_user_id AND phase<>'completed') THEN
    RAISE EXCEPTION 'account admitted save unsettled' USING ERRCODE='55000';
  END IF;
  DELETE FROM public.account_save_obligations WHERE user_id=p_user_id AND phase='completed';
  SELECT count(*)::integer INTO v_remaining FROM public.account_save_obligations WHERE user_id=p_user_id;
  IF v_remaining = 0 THEN DELETE FROM public.account_save_journal_cleanup_claims WHERE user_id=p_user_id; END IF;
  RETURN v_remaining;
END $$;

CREATE FUNCTION public.count_account_save_journal_v1(p_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT count(*)::integer FROM public.account_save_obligations WHERE user_id=p_user_id
$$;

REVOKE ALL ON FUNCTION public.claim_account_save_journal_cleanup_v1(uuid,jsonb,text),
  public.resume_account_save_journal_cleanup_v1(uuid,text,jsonb,text),
  public.resume_run_account_save_journal_cleanups_v1(jsonb,text),public.list_unfinished_account_save_journal_cleanup_runs_v1(integer),
  public.delete_deleted_account_save_journal_v1(uuid,text),public.count_account_save_journal_v1(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_save_journal_cleanup_v1(uuid,jsonb,text),
  public.resume_account_save_journal_cleanup_v1(uuid,text,jsonb,text),
  public.resume_run_account_save_journal_cleanups_v1(jsonb,text),public.list_unfinished_account_save_journal_cleanup_runs_v1(integer),
  public.delete_deleted_account_save_journal_v1(uuid,text),public.count_account_save_journal_v1(uuid)
  TO service_role;
