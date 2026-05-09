-- Allow the user-visible Private STT mode to persist sessions for Pro users.
-- The browser runtime records the selected mode as `private`; underlying engine
-- metadata still captures whether CPU/Transformers.js or WebGPU handled it.

UPDATE public.tier_configs
SET allowed_engines = ARRAY(
  SELECT DISTINCT engine
  FROM unnest(allowed_engines || ARRAY['private']::text[]) AS engine
)
WHERE tier_name = 'pro'
  AND NOT ('private' = ANY(allowed_engines));

COMMENT ON COLUMN public.sessions.engine IS
  'User-selected STT mode used for the session: native, cloud, or private. Private engine implementation details live in engine metadata.';
