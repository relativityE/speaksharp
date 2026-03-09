-- Tech Debt Remediation: Input length enforcement and migration idempotency
-- ID: TD-015, TD-020

-- 1. Add transcript length enforcement (TD-015)
-- We use a 100k character limit to prevent DB bloat while allowing ~15-20 hours of speech.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.constraint_column_usage
        WHERE table_name = 'sessions' AND constraint_name = 'transcript_length_check'
    ) THEN
        ALTER TABLE public.sessions
        ADD CONSTRAINT transcript_length_check
        CHECK (char_length(transcript) < 100000);
    END IF;
END $$;

-- 2. Audit and harden existing critical tables for idempotency (TD-020)
-- Most tables are created in 20250811062708_initial_schema.sql without IF NOT EXISTS.
-- This migration ensures core structures are present and idempotent.

-- Ensure sessions table has necessary columns with proper types
DO $$
BEGIN
    -- These columns should already exist from 20251219000000_sync_contract.sql
    -- but we ensure they are here for absolute safety.
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='transcript') THEN
        ALTER TABLE public.sessions ADD COLUMN transcript TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='engine') THEN
        ALTER TABLE public.sessions ADD COLUMN engine TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='clarity_score') THEN
        ALTER TABLE public.sessions ADD COLUMN clarity_score FLOAT8;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='wpm') THEN
        ALTER TABLE public.sessions ADD COLUMN wpm FLOAT8;
    END IF;
END $$;

-- Enforce engine type check if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.constraint_column_usage
        WHERE table_name = 'sessions' AND constraint_name = 'sessions_engine_check'
    ) THEN
        ALTER TABLE public.sessions
        ADD CONSTRAINT sessions_engine_check
        CHECK (engine IN ('native', 'cloud', 'private', 'unknown'));
    END IF;
END $$;
