-- #1643 follow-up (PO 2026-11-19: "make sure save records are deleted"; "you need to clean up after yourself").
--
-- An `account_save_obligations` row has no foreign key to auth.users, and its `completed` rows survive the Auth
-- deletion that live proofs use (`auth.admin.deleteUser`). Only the product's own closure completion
-- (complete_account_pending_completion_v1) removes them, and service_role can neither read nor write the table.
-- So every run-owned proof account that saved a take leaves its finished save-journal rows behind.
--
-- Two service_role-only functions close that gap without granting any table access:
--   * delete_deleted_account_save_journal_v1(uid): for an account that NO LONGER EXISTS in Auth, removes its
--     `completed` save-journal rows and returns how many rows of that account remain (0 when clean).
--     It refuses while the account still exists, while any of its rows is unsettled, and while a product
--     closure completion for that account is still processing, so it can never touch a live account's
--     journal or race the product's own closure.
--   * count_account_save_journal_v1(uid): read-only count of that account's rows, for an independent readback.

CREATE FUNCTION public.delete_deleted_account_save_journal_v1(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_remaining integer;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'account id required' USING ERRCODE='22004'; END IF;
  -- Same per-account lock as the product's closure completion: never interleave with it.
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||p_user_id::text,0));
  IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_user_id) THEN
    RAISE EXCEPTION 'account still exists' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.account_completion_executions WHERE user_id=p_user_id AND phase<>'completed') THEN
    RAISE EXCEPTION 'account closure completion in progress' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=p_user_id AND phase<>'completed') THEN
    RAISE EXCEPTION 'account admitted save unsettled' USING ERRCODE='55000';
  END IF;
  DELETE FROM public.account_save_obligations WHERE user_id=p_user_id AND phase='completed';
  SELECT count(*)::integer INTO v_remaining FROM public.account_save_obligations WHERE user_id=p_user_id;
  RETURN v_remaining;
END $$;

CREATE FUNCTION public.count_account_save_journal_v1(p_user_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT count(*)::integer FROM public.account_save_obligations WHERE user_id=p_user_id
$$;

REVOKE ALL ON FUNCTION public.delete_deleted_account_save_journal_v1(uuid),public.count_account_save_journal_v1(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.delete_deleted_account_save_journal_v1(uuid),public.count_account_save_journal_v1(uuid)
  TO service_role;
