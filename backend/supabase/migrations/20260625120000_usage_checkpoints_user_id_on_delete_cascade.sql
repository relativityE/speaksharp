-- usage_checkpoints.user_id was created inline (20260309 phase2_integration) referencing
-- auth.users(id) with NO ON DELETE clause, which defaults to NO ACTION (RESTRICT). It is the only
-- user-owned table whose FK blocks deleting an auth user. usage_checkpoints is dependent user data
-- (like public.sessions and public.user_profiles, both already ON DELETE CASCADE), so its FK to the
-- owning user should cascade as well. This aligns the delete semantics with the rest of the
-- user-owned model:  delete auth user -> profile -> sessions -> usage_checkpoints.
--
-- This migration ONLY changes the delete behavior of that one FK. It deletes NO data and preserves
-- the FK target auth.users(id). The drop is name-agnostic so a non-conventional constraint name
-- cannot leave the old RESTRICT FK in place alongside the new CASCADE one.

DO $$
DECLARE
  v_user_col smallint;
  v_conname  text;
BEGIN
  SELECT attnum INTO v_user_col
    FROM pg_attribute
   WHERE attrelid = 'public.usage_checkpoints'::regclass
     AND attname = 'user_id'
     AND NOT attisdropped;

  -- Find the single-column foreign key currently backing usage_checkpoints.user_id, by its real name.
  SELECT conname INTO v_conname
    FROM pg_constraint
   WHERE conrelid = 'public.usage_checkpoints'::regclass
     AND contype = 'f'
     AND conkey = ARRAY[v_user_col];

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.usage_checkpoints DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.usage_checkpoints
  ADD CONSTRAINT usage_checkpoints_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
