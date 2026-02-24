-- SQL TEST SUITE: Usage Tier Refactor
-- Run this in the Supabase SQL Editor to verify RPC behavior

-- 0. Cleanup/Setup Test User
DO $$
DECLARE
    test_user_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    DELETE FROM public.user_profiles WHERE id = test_user_id;
    INSERT INTO public.user_profiles (id, subscription_status, daily_usage_seconds, native_usage_seconds, cloud_usage_seconds, last_daily_reset)
    VALUES (test_user_id, 'free', 0, 0, 0, now());
END $$;

-- 1. TEST: update_user_usage (Native Engine)
-- Scenario: Free user, 10s native session
SELECT 'TEST 1: Native Engine Increment' as test_case;
SELECT update_user_usage(10, 'native') FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000'; -- Note: auth.uid() mock needed

-- Verify
SELECT daily_usage_seconds, native_usage_seconds, cloud_usage_seconds 
FROM public.user_profiles WHERE id = '00000000-0000-0000-0000-000000000000';

-- 2. TEST: update_user_usage (Cloud Engine)
-- Scenario: Free user, 20s cloud session
SELECT 'TEST 2: Cloud Engine Increment' as test_case;
SELECT update_user_usage(20, 'cloud') FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000';

-- Verify (Daily should be 30, Native 10, Cloud 20)
SELECT daily_usage_seconds, native_usage_seconds, cloud_usage_seconds 
FROM public.user_profiles WHERE id = '00000000-0000-0000-0000-000000000000';

-- 3. TEST: Daily Reset
-- Scenario: Reset triggered by old timestamp
UPDATE public.user_profiles SET last_daily_reset = now() - interval '25 hours' WHERE id = '00000000-0000-0000-0000-000000000000';

SELECT 'TEST 3: Daily Reset Trigger' as test_case;
SELECT update_user_usage(5, 'native') FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000';

-- Verify (Daily should be 5, Native should continue incrementing [10+5=15], Cloud should be 20)
SELECT daily_usage_seconds, native_usage_seconds, cloud_usage_seconds, last_daily_reset 
FROM public.user_profiles WHERE id = '00000000-0000-0000-0000-000000000000';

-- 4. TEST: check_usage_limit
-- Scenario: Check returns correct metrics
SELECT 'TEST 4: check_usage_limit result' as test_case;
SELECT check_usage_limit() FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000';

-- 5. TEST: Limit Enforcement
-- Scenario: Attempt to exceed 3600s
UPDATE public.user_profiles SET daily_usage_seconds = 3600 WHERE id = '00000000-0000-0000-0000-000000000000';

SELECT 'TEST 5: Limit Block' as test_case;
SELECT update_user_usage(1, 'native') FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000000';

-- CLEANUP
DELETE FROM public.user_profiles WHERE id = '00000000-0000-0000-0000-000000000000';
