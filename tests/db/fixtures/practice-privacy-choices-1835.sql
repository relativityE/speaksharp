\set ON_ERROR_STOP on
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.fixture_uid',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.user_profiles(id uuid PRIMARY KEY);
CREATE TABLE public.sessions(id uuid PRIMARY KEY, user_id uuid, transcript text, status text, coaching jsonb);
GRANT SELECT,INSERT,UPDATE ON public.sessions TO authenticated;
CREATE FUNCTION public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)
RETURNS jsonb LANGUAGE sql AS $$ UPDATE public.sessions SET coaching=$5 WHERE id=$3 AND user_id=$4 RETURNING coaching $$;
GRANT EXECUTE ON FUNCTION public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer) TO service_role;
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
INSERT INTO public.user_profiles SELECT id FROM auth.users;
INSERT INTO public.sessions VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','old value','completed',null);
\i :migration
SET ROLE authenticated;
SET app.fixture_uid='11111111-1111-4111-8111-111111111111';
DO $$
DECLARE u uuid := '11111111-1111-4111-8111-111111111111';
DECLARE old uuid := '33333333-3333-4333-8333-333333333333';
DECLARE new_session uuid := '44444444-4444-4444-8444-444444444444';
DECLARE rev integer;
BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.practice_privacy_choices), 'must start unknown';
  ASSERT to_regprocedure('public.set_practice_privacy_choices_v1(boolean,boolean)') IS NULL, 'unconditional write overload remains';
  BEGIN
    UPDATE public.sessions SET transcript='changed' WHERE id=old;
    RAISE EXCEPTION 'unknown transcript write allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    ASSERT SQLERRM = 'transcript_consent_required', SQLERRM;
  END;
  INSERT INTO public.sessions (id,user_id,status) VALUES(new_session,u,'completed');
  ASSERT EXISTS(SELECT 1 FROM public.sessions WHERE id=new_session AND transcript IS NULL AND status='completed'), 'metrics-only write missing';
  ASSERT EXISTS(SELECT 1 FROM public.sessions WHERE id=old AND transcript='old value'), 'history changed';
  BEGIN
    PERFORM public.set_practice_privacy_choices_v1(false,true,NULL);
    RAISE EXCEPTION 'AI without saving allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  SELECT choice_revision INTO rev FROM public.set_practice_privacy_choices_v1(true,true,NULL);
  ASSERT rev=1, 'unexpected initial revision';
  SELECT choice_revision INTO rev FROM public.set_practice_privacy_choices_v1(true,true,1);
  ASSERT rev=1, 'idempotent call invalidated a grant';
  UPDATE public.sessions SET transcript='new positive' WHERE id=new_session;
  ASSERT EXISTS(SELECT 1 FROM public.sessions WHERE id=new_session AND transcript='new positive'), 'opted-in write failed';
  SELECT choice_revision INTO rev FROM public.set_practice_privacy_choices_v1(false,false,1);
  ASSERT rev=2, 'revocation did not invalidate revision';
  BEGIN
    -- Tab B still sees rev 1 and only turns coaching off; it cannot restore saving revoked by tab A.
    PERFORM public.set_practice_privacy_choices_v1(true,false,1);
    RAISE EXCEPTION 'stale tab restored saving';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'privacy_choices_changed', SQLERRM;
  END;
  ASSERT EXISTS(SELECT 1 FROM public.practice_privacy_choices
                 WHERE user_id=u AND NOT transcript_save AND NOT ai_coaching AND choice_revision=2),
      'stale write changed consent';
  BEGIN
    UPDATE public.sessions SET transcript='late unconsented edit' WHERE id=new_session;
    RAISE EXCEPTION 'revoked write allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    ASSERT SQLERRM = 'transcript_consent_required', SQLERRM;
  END;
  ASSERT EXISTS(SELECT 1 FROM public.sessions WHERE id=new_session AND transcript='new positive'), 'revoking erased past data';
END $$;
SET app.fixture_uid='22222222-2222-4222-8222-222222222222';
DO $$ BEGIN
  ASSERT NOT EXISTS(SELECT 1 FROM public.practice_privacy_choices), 'foreign choice visible';
  BEGIN
    PERFORM public.set_practice_privacy_choices_v1(true,true,1);
    RAISE EXCEPTION 'expected a conflict, not an upsert, for a missing row at revision 1';
  EXCEPTION WHEN raise_exception THEN
    ASSERT SQLERRM = 'privacy_choices_changed', SQLERRM;
  END;
  ASSERT NOT EXISTS(SELECT 1 FROM public.practice_privacy_choices), 'update path inserted a first choice';
  BEGIN
    INSERT INTO public.practice_privacy_choices(user_id,transcript_save,ai_coaching)
    VALUES('11111111-1111-4111-8111-111111111111',true,true);
    RAISE EXCEPTION 'foreign choice insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE service_role;
DO $$ BEGIN
  ASSERT NOT has_function_privilege(current_user,'public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)','EXECUTE'), 'old coaching persist remains callable';
  BEGIN
    PERFORM public.persist_account_coaching_with_consent_v1(null,true,'33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111','{"answer":true}','test','model','test',current_date,1,1,1);
    RAISE EXCEPTION 'stale coaching persist allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    ASSERT SQLERRM = 'coaching_consent_required', SQLERRM;
  END;
END $$;
RESET ROLE;
UPDATE public.practice_privacy_choices SET transcript_save=true, ai_coaching=true WHERE user_id='11111111-1111-4111-8111-111111111111';
SET ROLE service_role;
DO $$ BEGIN
  ASSERT public.persist_account_coaching_with_consent_v1(null,true,'33333333-3333-4333-8333-333333333333',
      '11111111-1111-4111-8111-111111111111','{"answer":true}','test','model','test',current_date,1,1,3) = '{"answer":true}', 'current valid consent did not allow coaching persistence';
END $$;
