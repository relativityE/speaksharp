-- P0 (incident) — SERVER-ASSIGNED provenance registry.
--
-- The browser must never choose privileged provenance. This protected registry maps an authenticated
-- account to its data_origin (and optional cohort/test metadata). The server (triggers / service
-- role) derives provenance for new sessions/reports/telemetry from THIS table — never from a client
-- field. Unregistered accounts default to production_user (see enqueue trigger).
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
-- Intentionally NO policies: service-role only.

-- Resolve the server-assigned data_origin for an account: the registry value when present and
-- unexpired, else 'production_user'. SECURITY DEFINER so the enqueue trigger can call it; revoked
-- from anon/authenticated so a client can never invoke it to probe/spoof provenance.
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
    'production_user'
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
    COALESCE(r.data_origin, 'production_user') AS data_origin,
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
