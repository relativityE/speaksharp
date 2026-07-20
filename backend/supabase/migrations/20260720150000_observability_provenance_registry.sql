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
SET search_path = public
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
SET search_path = public
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

REVOKE ALL ON FUNCTION public.resolve_data_origin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_actor_provenance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_data_origin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_actor_provenance(uuid) TO service_role;
