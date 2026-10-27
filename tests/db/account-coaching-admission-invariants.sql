DO $$ DECLARE signature text; role_name text; privilege text; BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.account_coaching_operations'::regclass) THEN
    RAISE EXCEPTION 'coaching operations require RLS';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] LOOP
      IF has_table_privilege(role_name,'public.account_coaching_operations',privilege) THEN
        RAISE EXCEPTION 'direct coaching ledger privilege: % %',role_name,privilege;
      END IF;
    END LOOP;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'public.begin_account_coaching_v1(uuid,uuid,uuid)',
    'public.finish_account_coaching_failure_v1(uuid,uuid,uuid,text)',
    'public.persist_account_coaching_v1(uuid,boolean,uuid,uuid,jsonb,text,text,text,date,integer,integer)'
  ] LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF has_function_privilege(role_name,signature,'EXECUTE') THEN
        RAISE EXCEPTION 'client coaching authority privilege: % %',role_name,signature;
      END IF;
    END LOOP;
    IF NOT has_function_privilege('service_role',signature,'EXECUTE') THEN
      RAISE EXCEPTION 'missing service coaching privilege: %',signature;
    END IF;
  END LOOP;
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.guard_unsettled_account_coaching_delete_v1()'::regprocedure) THEN
    RAISE EXCEPTION 'delete guard requires no definer privilege';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF has_function_privilege(role_name,'public.guard_unsettled_account_coaching_delete_v1()','EXECUTE') THEN
      RAISE EXCEPTION 'delete guard is trigger-only: %',role_name;
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.account_coaching_operations'::regclass
    AND tgname='guard_unsettled_account_coaching_delete' AND tgenabled='O') THEN
    RAISE EXCEPTION 'unsettled delete guard must be enabled';
  END IF;
  RAISE NOTICE 'ACCOUNT COACHING ADMISSION INVARIANTS PASSED';
END $$;
