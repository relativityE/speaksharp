-- Fresh replay already has the consolidated policy from the initial schema.
-- Applied databases may instead have the four legacy policies, or a mixture.
-- Validate only the five named replacement policies before changing anything;
-- replacing an unexpected restrictive/role-specific predicate could broaden access.
DO $$
DECLARE p record; final_exists boolean; legacy_count integer;
  owner_predicates text[] := ARRAY['(auth.uid() = user_id)', '(( SELECT auth.uid() AS uid) = user_id)'];
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.sessions'::regclass) THEN
    RAISE EXCEPTION 'session replay requires enabled RLS';
  END IF;
  SELECT count(*) FILTER (WHERE polname='Users can manage own sessions') > 0,
    count(*) FILTER (WHERE polname<>'Users can manage own sessions')
    INTO final_exists, legacy_count FROM pg_policy WHERE polrelid='public.sessions'::regclass
    AND polname IN ('Users can manage own sessions','Users can view their own sessions',
      'Users can insert their own sessions','Users can update their own sessions','Users can delete their own sessions');
  IF NOT final_exists AND legacy_count<>4 THEN RAISE EXCEPTION 'unexpected session replacement policy set'; END IF;
  FOR p IN SELECT polname,polcmd,polpermissive,polroles,
      pg_get_expr(polqual,polrelid) AS qualifier,pg_get_expr(polwithcheck,polrelid) AS checker
    FROM pg_policy WHERE polrelid='public.sessions'::regclass
    AND polname IN ('Users can manage own sessions','Users can view their own sessions',
      'Users can insert their own sessions','Users can update their own sessions','Users can delete their own sessions') LOOP
    IF NOT p.polpermissive OR p.polroles<>ARRAY[0::oid] OR p.polcmd <> (CASE p.polname
      WHEN 'Users can view their own sessions' THEN 'r'::"char"
      WHEN 'Users can insert their own sessions' THEN 'a'::"char"
      WHEN 'Users can update their own sessions' THEN 'w'::"char"
      WHEN 'Users can delete their own sessions' THEN 'd'::"char" ELSE '*'::"char" END)
      OR (p.polcmd<>'a' AND NOT coalesce(p.qualifier=ANY(owner_predicates),false))
      OR (p.polcmd='a' AND NOT coalesce(p.checker=ANY(owner_predicates),false))
      OR (p.polcmd='a' AND p.qualifier IS NOT NULL)
      OR (p.checker IS NOT NULL AND NOT coalesce(p.checker=ANY(owner_predicates),false)) THEN
      RAISE EXCEPTION 'unexpected session replacement policy shape: %',p.polname;
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Users can view their own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can insert their own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can update their own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can delete their own sessions" ON public.sessions;
DROP POLICY IF EXISTS "Users can manage own sessions" ON public.sessions;

-- Create the new, single, efficient policy
CREATE POLICY "Users can manage own sessions" ON public.sessions
FOR ALL USING ((select auth.uid()) = user_id);
