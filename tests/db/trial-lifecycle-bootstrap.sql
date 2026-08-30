-- #1302 — platform prerequisites for the commercial-lifecycle qualification's ephemeral database.
--
-- `auth.users` is SUPABASE PLATFORM infrastructure, not one of our migrations: nothing in
-- backend/supabase/migrations creates it, because the platform already has. PGlite does not, so the
-- ephemeral DB must supply it before the real trial migrations can apply.
--
-- Only the columns our migrations actually read are declared (id, email), plus created_at for realism.
-- Everything that decides entitlement — the trial window, the resolver, the stamping trigger — comes from
-- the REAL migrations applied on top. This file supplies the platform, never the product logic.
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id         UUID PRIMARY KEY,
  email      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
