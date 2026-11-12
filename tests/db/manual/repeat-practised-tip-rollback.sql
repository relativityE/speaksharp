-- Outcome 4 D2: rollback of 20261112010000_repeat_practised_tip.sql.
-- Proved on a throwaway copy of the Supabase database image by tests/db/manual/repeat-practised-tip-supabase-replay.sh:
-- after this runs, the public schema dumps byte-identical to the schema before the migration, and the app's fallback
-- read (without `practised_tip`) works. It drops the copied tips with their columns.
-- If the migration was applied through the Supabase CLI, its row in supabase_migrations.schema_migrations
-- (version 20261112010000) must also be removed, or the CLI will consider it applied.
-- Never run it anywhere without the same authorization that applying the migration needs.
BEGIN;
DROP TRIGGER IF EXISTS trg_prec_att_snapshot_tip ON public.progress_recommendation_attempts;
DROP TRIGGER IF EXISTS trg_prec_att_guard_tip ON public.progress_recommendation_attempts;
DROP TRIGGER IF EXISTS trg_sessions_prec_tip_on_completed ON public.sessions;
DROP TRIGGER IF EXISTS trg_sessions_purge_practised_tip_on_expire ON public.sessions;
DROP FUNCTION IF EXISTS public._prec_att_snapshot_tip();
DROP FUNCTION IF EXISTS public._prec_att_guard_tip();
DROP FUNCTION IF EXISTS public._prec_att_on_session_completed();
DROP FUNCTION IF EXISTS public._prec_att_purge_tip_on_expire();
DROP FUNCTION IF EXISTS public._prec_att_can_hold_tip(public.progress_recommendation_attempts, uuid);
DROP FUNCTION IF EXISTS public._prec_att_review_tip(jsonb);
DROP FUNCTION IF EXISTS public._prec_att_lock_owner(uuid);
DROP INDEX IF EXISTS public.idx_prec_att_tip_session;
ALTER TABLE public.progress_recommendation_attempts
    DROP CONSTRAINT IF EXISTS prec_att_practised_tip_shape,
    DROP COLUMN IF EXISTS tip_session_id,
    DROP COLUMN IF EXISTS practised_tip;
COMMIT;
