-- #1643 bounded lease-admission successor; depends on inactive pending schema.
-- No destructive authority, worker drain, save/completion or heartbeat change.
BEGIN;
DO $$ BEGIN
  IF to_regprocedure('public.begin_account_closure_pending(uuid,text,boolean)') IS NULL THEN
    RAISE EXCEPTION 'account pending predecessor required';
  END IF;
  IF to_regprocedure('public._ss_acquire_recording_lease_1476(uuid,text,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'recording admission helper name already exists';
  END IF;
END $$;

-- Retain the exact existing one-engine/takeover/fencing implementation. The
-- wrapper adds the profile-first transaction boundary already used by pending,
-- session creation and completion; never acquire recording then profile.
ALTER FUNCTION public.acquire_recording_lease(uuid,text,boolean)
  RENAME TO _ss_acquire_recording_lease_1476;
REVOKE ALL ON FUNCTION public._ss_acquire_recording_lease_1476(uuid,text,boolean)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.acquire_recording_lease(p_lease_id uuid,p_holder_label text DEFAULT NULL,p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('acquired',false,'reason','unauthenticated'); END IF;
  PERFORM 1 FROM public.user_profiles WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('acquired',false,'reason','account_unavailable'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||v_uid::text,0));
  IF EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=v_uid AND phase<>'open')
    OR EXISTS(SELECT 1 FROM public.account_closure_attempts WHERE user_id=v_uid AND phase<>'failed') THEN
    RETURN jsonb_build_object('acquired',false,'reason','account_closure_pending');
  END IF;
  RETURN public._ss_acquire_recording_lease_1476(p_lease_id,p_holder_label,p_force);
END $$;
REVOKE ALL ON FUNCTION public.acquire_recording_lease(uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.acquire_recording_lease(uuid,text,boolean) TO authenticated;

-- Old clients acquire an implicit lease inside create_session_and_update_usage.
-- That RPC already holds profile before the recording lock. Check new lease
-- identities there too, without rejecting accepted-lease heartbeats/Stop/save.
CREATE FUNCTION public._ss_recording_admission_1643()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
    AND NEW.lease_id IS NOT DISTINCT FROM OLD.lease_id THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.user_profiles WHERE id=NEW.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account unavailable' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||NEW.user_id::text,0));
  IF EXISTS(SELECT 1 FROM public.account_billing_fences WHERE user_id=NEW.user_id AND phase<>'open')
    OR EXISTS(SELECT 1 FROM public.account_closure_attempts WHERE user_id=NEW.user_id AND phase<>'failed') THEN
    RAISE EXCEPTION 'account closure pending' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._ss_recording_admission_1643() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ss_recording_admission_1643
  BEFORE INSERT OR UPDATE OF user_id,lease_id ON public.active_recording_lease
  FOR EACH ROW EXECUTE FUNCTION public._ss_recording_admission_1643();

-- Only the RPCs write client leases. The old own-row ALL policy alone is not an
-- admission gate; do not let a client bypass the wrapper or lock ordering.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.active_recording_lease
  FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.active_recording_lease TO authenticated;
COMMIT;
