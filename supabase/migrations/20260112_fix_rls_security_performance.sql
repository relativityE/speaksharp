-- Migration: Fix RLS Performance, Security, and Add Indexes
-- Created: 2026-01-12
-- Fixes: Supabase linter warnings for performance and security
--
-- SCHEMA NOTES (from reviewing existing migrations):
-- - user_profiles uses `id` as primary key (not user_id)
-- - sessions already has optimized RLS with (select auth.uid())
-- - custom_vocabulary was renamed to user_filler_words
-- - check_usage_limit() takes no arguments

-- =============================================
-- PART 1: FIX RLS PERFORMANCE ON user_profiles
-- Original policy uses auth.uid() directly, needs (SELECT auth.uid())
-- Also uses `id` column, not `user_id`
-- =============================================

DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can manage own profile" ON public.user_profiles;
CREATE POLICY "Users can manage own profile" ON public.user_profiles
  FOR ALL TO authenticated
  USING (id = (SELECT auth.uid()));

-- =============================================
-- PART 2: FIX RLS PERFORMANCE ON user_filler_words
-- =============================================

DROP POLICY IF EXISTS "Users can manage own vocabulary" ON public.user_filler_words;
CREATE POLICY "Users can manage own vocabulary" ON public.user_filler_words
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- =============================================
-- PART 3: FIX RLS PERFORMANCE ON user_goals
-- =============================================

DROP POLICY IF EXISTS "Users can manage own goals" ON public.user_goals;
CREATE POLICY "Users can manage own goals" ON public.user_goals
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- =============================================
-- PART 4: FIX RLS ON promo_codes (service_role only)
-- =============================================

DROP POLICY IF EXISTS "Service role has full access" ON public.promo_codes;
CREATE POLICY "Service role has full access" ON public.promo_codes
  FOR ALL TO service_role
  USING (true);

-- =============================================
-- PART 5: FIX RLS ON promo_redemptions (service_role only)
-- =============================================

DROP POLICY IF EXISTS "Service role has full access redemptions" ON public.promo_redemptions;
CREATE POLICY "Service role has full access redemptions" ON public.promo_redemptions
  FOR ALL TO service_role
  USING (true);

-- =============================================
-- PART 6: FIX FUNCTION SEARCH_PATH
-- Note: check_usage_limit takes NO arguments
-- =============================================

ALTER FUNCTION public.update_user_goals_updated_at() 
  SET search_path = public;

ALTER FUNCTION public.handle_new_user() 
  SET search_path = public, auth;

ALTER FUNCTION public.check_usage_limit() 
  SET search_path = public;

-- =============================================
-- PART 7: ADD MISSING INDEX (defensive check)
-- =============================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'promo_redemptions' 
    AND column_name = 'user_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user_id 
      ON public.promo_redemptions(user_id);
    RAISE NOTICE 'Created index idx_promo_redemptions_user_id';
  ELSE
    RAISE NOTICE 'Column user_id not found in promo_redemptions - skipping index creation';
  END IF;
END $$;
