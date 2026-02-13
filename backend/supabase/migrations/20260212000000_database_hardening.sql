-- 1. Atomic Usage Update (Fixes Domain 7, Area 13)
-- Replaces non-atomic read-modify-write with a single atomic increment.

CREATE OR REPLACE FUNCTION public.update_user_usage(session_duration_seconds int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Perform atomic update
  UPDATE public.user_profiles
  SET 
    usage_seconds = usage_seconds + session_duration_seconds,
    updated_at = now()
  WHERE id = auth.uid();

  -- Return true if the user was found and updated
  RETURN FOUND;
END;
$$;

-- 2. Orphan Protection (Fixes Domain 7, Area 14)
-- Ensures sessions and profiles are deleted when a user is removed.

-- First, drop existing constraints to recreate them with CASCADE
ALTER TABLE public.user_profiles 
DROP CONSTRAINT IF EXISTS user_profiles_id_fkey;

ALTER TABLE public.user_profiles
ADD CONSTRAINT user_profiles_id_fkey 
FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.sessions
DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;

ALTER TABLE public.sessions
ADD CONSTRAINT sessions_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
