-- #1033 — Durable STT engine-attribution status contract (Option B).
--
-- Adds an explicit `attribution_status` to public.sessions so a row self-describes whether its
-- persisted STT identity (engine / engine_version / model_name / device_type) was actually confirmed,
-- instead of every analytics/benchmark/audit query having to infer it from engine_version naming.
--
-- Lifecycle (enforced by the app, not this migration):
--   legacy_unknown : existing rows created before this feature (backfilled here). NEVER inferred as verified.
--   pending        : a new recording row was created; finalization identity not yet written (column DEFAULT).
--   verified       : finalization succeeded AND the full producing-engine tuple was written in one atomic update.
--   unverified     : finalization completed but the producing identity could not be resolved (no invented tokens).
-- A failed DB write simply leaves the row `pending` (no state change) so a retry can promote it to verified.
--
-- Evidence rule (enforced by callers): engine-specific analytics / STT benchmarks / evidence include ONLY
-- attribution_status = 'verified'. Do not use engine_version string heuristics.
--
-- Compatibility: this is a purely additive column with a DEFAULT. The currently deployed app never writes or
-- reads it, so new inserts from the old app receive DEFAULT 'pending' and the old app safely ignores the column.
-- Rollback: `ALTER TABLE public.sessions DROP COLUMN IF EXISTS attribution_status;` (drops the column and its
-- CHECK constraint). No data in other columns is affected.
--
-- NOT APPLIED TO PRODUCTION BY THIS PR. Requires separate Product Owner migration approval before deploy.

-- 1) Add nullable so existing rows are untouched initially.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS attribution_status TEXT;

-- 2) Backfill EXISTING rows explicitly to legacy_unknown (never inferred/promoted from engine_version).
UPDATE public.sessions
  SET attribution_status = 'legacy_unknown'
  WHERE attribution_status IS NULL;

-- 3) New rows (from the save RPC / any insert that omits the column) start as `pending`.
ALTER TABLE public.sessions
  ALTER COLUMN attribution_status SET DEFAULT 'pending';

-- 4) Enforce presence + the closed value set.
ALTER TABLE public.sessions
  ALTER COLUMN attribution_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sessions_attribution_status_check'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_attribution_status_check
      CHECK (attribution_status IN ('pending', 'verified', 'unverified', 'legacy_unknown'));
  END IF;
END $$;

-- 5) Partial index to make the verified-only evidence filter cheap.
CREATE INDEX IF NOT EXISTS idx_sessions_attribution_verified
  ON public.sessions (user_id)
  WHERE attribution_status = 'verified';

COMMENT ON COLUMN public.sessions.attribution_status IS
  '#1033 STT attribution lifecycle: legacy_unknown|pending|verified|unverified. Engine-specific evidence uses only verified.';
