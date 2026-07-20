-- P0 (incident) — SERVER-ASSIGNED provenance registry.
--
-- The browser must never choose privileged provenance. This protected registry maps an authenticated
-- account to its data_origin (and optional cohort/test metadata). The server (triggers / service
-- role) derives provenance for new telemetry from THIS table — never from a client field. An
-- account that is NOT explicitly registered (or whose assignment expired) resolves to
-- 'legacy_unclassified' — NEVER production_user. Only an explicit trusted registry row may produce a
-- classified value (including production_user).
--
-- RLS enabled with NO policies → only the service role may read/write. Normal users cannot see or
-- change their own provenance.

CREATE TABLE IF NOT EXISTS public.observability_actor_registry (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data_origin text NOT NULL,
  cohort_id text,
  test_run_id text,
  test_suite text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CONSTRAINT observability_actor_data_origin_safe CHECK (
    data_origin IN (
      'automated_test',
      'seed_fixture',
      'owner_manual_test',
      'beta_tester',
      'production_user',
      'synthetic_monitor',
      'legacy_unclassified'
    )
  )
);

ALTER TABLE public.observability_actor_registry ENABLE ROW LEVEL SECURITY;
-- Intentionally NO policies: service-role only. Explicit table grants (belt-and-suspenders).
REVOKE ALL ON TABLE public.observability_actor_registry FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.observability_actor_registry TO service_role;

-- Resolve the server-assigned data_origin for an account: the registry value when present AND
-- unexpired, else 'legacy_unclassified' (NOT production_user — ambiguous identities stay
-- unclassified). SECURITY DEFINER + service-role-only.
CREATE OR REPLACE FUNCTION public.resolve_data_origin(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT COALESCE(
    (SELECT r.data_origin
       FROM public.observability_actor_registry r
      WHERE r.user_id = p_user_id
        AND (r.expires_at IS NULL OR r.expires_at > now())),
    'legacy_unclassified'
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_actor_provenance(p_user_id uuid)
RETURNS TABLE (data_origin text, cohort_id text, test_run_id text, test_suite text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
STABLE
AS $$
  SELECT
    COALESCE(r.data_origin, 'legacy_unclassified') AS data_origin,
    r.cohort_id,
    r.test_run_id,
    r.test_suite
  FROM (SELECT 1) one
  LEFT JOIN public.observability_actor_registry r
    ON r.user_id = p_user_id
   AND (r.expires_at IS NULL OR r.expires_at > now());
$$;

-- Registration helper for automated workflows: a run REGISTERS its provenance (server-side, trusted)
-- BEFORE it writes any session/report, and EXPIRES it after. Upsert by user_id with a TTL. IMPORTANT
-- concurrency contract: the registry PK is user_id, so a single account can hold only ONE active
-- test_run_id at a time — concurrent runs sharing one account WOULD overwrite each other. Callers MUST
-- either use a UNIQUE ephemeral account per run (preferred) or SERIALIZE the data-producing workflows
-- for a shared account (a workflow concurrency group). Service-role only (the browser can never call
-- this — provenance is never client-assigned).
CREATE OR REPLACE FUNCTION public.register_observability_actor(
  p_user_id uuid, p_data_origin text, p_cohort_id text, p_test_run_id text, p_test_suite text,
  p_ttl interval DEFAULT interval '6 hours'
)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  INSERT INTO public.observability_actor_registry
    (user_id, data_origin, cohort_id, test_run_id, test_suite, expires_at, created_by, updated_at)
  VALUES (p_user_id, p_data_origin, p_cohort_id, p_test_run_id, p_test_suite, now() + p_ttl, 'register_observability_actor', now())
  ON CONFLICT (user_id) DO UPDATE
    SET data_origin = EXCLUDED.data_origin, cohort_id = EXCLUDED.cohort_id,
        test_run_id = EXCLUDED.test_run_id, test_suite = EXCLUDED.test_suite,
        expires_at = EXCLUDED.expires_at, updated_at = now();
$$;

CREATE OR REPLACE FUNCTION public.expire_observability_actor(p_user_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  DELETE FROM public.observability_actor_registry WHERE user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_data_origin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_actor_provenance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_observability_actor(uuid, text, text, text, text, interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_observability_actor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_data_origin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_actor_provenance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_observability_actor(uuid, text, text, text, text, interval) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_observability_actor(uuid) TO service_role;
