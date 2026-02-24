-- Migration: Add composite index for optimized session history queries
-- Optimized for: .eq('user_id', userId).order('created_at', { ascending: false })

CREATE INDEX IF NOT EXISTS sessions_user_id_created_at_idx ON public.sessions (user_id, created_at DESC);
