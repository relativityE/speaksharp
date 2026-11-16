-- #1643 missing-Start abandonment (Sam, AHT lane 2026-11-12).
--
-- A Start acquires its lease BEFORE any take exists, and migration 20261020230653 turns that lease into an admitted
-- save obligation that lease release or expiry never settles. A Start that then fails or is cancelled before any take
-- exists left that obligation admitted forever, so the account could never complete closure.
--
-- This adds ONE explicit, account- and exact-lease-bound cancellation for that case:
--  * it serializes with recording admission (profile row, then account-billing, then the #1476 recording lock: the
--    same order as acquire_recording_lease, and the profile row first like create_session_and_update_usage);
--  * it proves no take exists for the identity (no bound session, no session row with that lease or id, phase admitted)
--    and refuses otherwise ("take_exists"), or when the identity is not this account's ("unknown_identity");
--  * it moves the identity out of the admitted journal into a terminal, non-saved record
--    (recording_start_abandonments, outcome 'abandoned_not_recorded'). It never marks the journal completed and never
--    inserts a session or take;
--  * it permanently fences that identity: a later lease acquire, session creation (current or legacy path, including a
--    delayed save-only create) or rebind raises inside the existing obligation triggers;
--  * repeating it is idempotent.
-- No timer, lease release or expiry settles anything here; only this explicit, proven cancellation does.
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.account_save_obligations') IS NULL
    OR to_regprocedure('public._account_save_lease_obligation_v1()') IS NULL
    OR to_regprocedure('public._account_save_session_obligation_v1()') IS NULL THEN
    RAISE EXCEPTION 'account save obligation journal predecessor required';
  END IF;
  IF to_regclass('public.recording_start_abandonments') IS NOT NULL
    OR to_regprocedure('public.abandon_recording_start_v1(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'recording start abandonment already exists';
  END IF;
END $$;

-- Terminal, non-saved outcome for a Start that never produced a take. Content-free (two ids and a time).
-- Removed with the account (the journal it replaces is settled at completion; this has nothing left to settle).
CREATE TABLE public.recording_start_abandonments (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lease_id uuid NOT NULL,
  outcome text NOT NULL DEFAULT 'abandoned_not_recorded' CHECK(outcome='abandoned_not_recorded'),
  abandoned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(user_id,lease_id)
);
ALTER TABLE public.recording_start_abandonments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.recording_start_abandonments FROM PUBLIC,anon,authenticated,service_role;

-- Lease obligation trigger: unchanged, plus the abandonment fence. The check runs AFTER the journal insert so a
-- concurrent abandonment that deleted the admitted row (and that this insert waited on) is always seen.
CREATE OR REPLACE FUNCTION public._account_save_lease_obligation_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='UPDATE' AND (NEW.user_id,NEW.lease_id) IS NOT DISTINCT FROM (OLD.user_id,OLD.lease_id) THEN RETURN NEW; END IF;
  INSERT INTO public.account_save_obligations(user_id,lease_id) VALUES(NEW.user_id,NEW.lease_id)
    ON CONFLICT(user_id,lease_id) DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.account_save_obligations WHERE user_id=NEW.user_id AND lease_id=NEW.lease_id AND phase='completed') THEN
    RAISE EXCEPTION 'completed recording identity cannot be reused';
  END IF;
  IF EXISTS(SELECT 1 FROM public.recording_start_abandonments WHERE user_id=NEW.user_id AND lease_id=NEW.lease_id) THEN
    RAISE EXCEPTION 'abandoned recording identity cannot be reused';
  END IF;
  RETURN NEW;
END $$;

-- Session obligation trigger: unchanged, plus the abandonment fence. Like the lease trigger, it is checked AFTER the
-- journal write, so an abandonment that committed while this insert waited on the admitted row is always seen.
CREATE OR REPLACE FUNCTION public._account_save_session_obligation_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE identity uuid:=coalesce(NEW.lease_id,NEW.id);
BEGIN
  -- Definite atomic completion is monotonic. Failed/fenced/expired rows retain debt; they are not proof a recoverable
  -- take was saved or explicitly abandoned. The exception is a leased or fenced take that has FAILED: the #1476 fence
  -- makes it terminal (never revivable, completable or given a transcript), so its obligation is settled. The session
  -- stays `failed`; settling the debt does not label the take as saved.
  INSERT INTO public.account_save_obligations(user_id,lease_id,session_id,phase)
    VALUES(NEW.user_id,identity,NEW.id,CASE WHEN NEW.status='completed' THEN 'completed'
      WHEN NEW.status='failed' AND (NEW.lease_id IS NOT NULL OR NEW.recording_fenced_at IS NOT NULL) THEN 'completed'
      ELSE 'admitted' END)
    ON CONFLICT(user_id,lease_id) DO UPDATE
      SET session_id=EXCLUDED.session_id,phase=CASE WHEN EXCLUDED.phase='completed' THEN 'completed' ELSE account_save_obligations.phase END
      WHERE account_save_obligations.session_id IS NULL OR account_save_obligations.session_id=EXCLUDED.session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'recording save identity already bound'; END IF;
  IF EXISTS(SELECT 1 FROM public.recording_start_abandonments WHERE user_id=NEW.user_id AND lease_id=identity) THEN
    RAISE EXCEPTION 'abandoned recording identity cannot be bound';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.abandon_recording_start_v1(p_lease_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_uid uuid:=auth.uid(); o public.account_save_obligations;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('abandoned',false,'reason','unauthenticated'); END IF;
  IF p_lease_id IS NULL THEN RETURN jsonb_build_object('abandoned',false,'reason','unknown_identity'); END IF;
  -- Same order as acquire_recording_lease: profile row, account-billing, then the #1476 recording lock.
  PERFORM 1 FROM public.user_profiles WHERE id=v_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('abandoned',false,'reason','account_unavailable'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('account-billing:'||v_uid::text,0));
  PERFORM pg_advisory_xact_lock(hashtextextended('ss_recording_lease_1476:'||v_uid::text,0));
  IF EXISTS(SELECT 1 FROM public.recording_start_abandonments WHERE user_id=v_uid AND lease_id=p_lease_id) THEN
    RETURN jsonb_build_object('abandoned',true,'outcome','abandoned_not_recorded','repeated',true);
  END IF;
  SELECT * INTO o FROM public.account_save_obligations WHERE user_id=v_uid AND lease_id=p_lease_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('abandoned',false,'reason','unknown_identity'); END IF;
  -- Refuse whenever a take exists or could exist for this identity, on any account: a bound or settled journal row,
  -- or any session row recorded under this lease or carrying it as its implicit (legacy) identity.
  IF o.phase<>'admitted' OR o.session_id IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.sessions WHERE lease_id=p_lease_id OR id=p_lease_id) THEN
    RETURN jsonb_build_object('abandoned',false,'reason','take_exists');
  END IF;
  DELETE FROM public.active_recording_lease WHERE user_id=v_uid AND lease_id=p_lease_id;
  DELETE FROM public.account_save_obligations WHERE user_id=v_uid AND lease_id=p_lease_id;
  INSERT INTO public.recording_start_abandonments(user_id,lease_id) VALUES(v_uid,p_lease_id);
  RETURN jsonb_build_object('abandoned',true,'outcome','abandoned_not_recorded','repeated',false);
END $$;
REVOKE ALL ON FUNCTION public.abandon_recording_start_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.abandon_recording_start_v1(uuid) TO authenticated;
COMMIT;
