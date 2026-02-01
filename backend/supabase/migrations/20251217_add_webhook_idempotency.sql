-- =============================================================================
-- Migration: Stripe Webhook Idempotency Table
-- =============================================================================
-- 
-- PURPOSE: Prevent duplicate webhook processing by tracking event IDs.
-- 
-- HOW TO DEPLOY:
-- 
-- 1. Commit this file to main branch:
--    git add backend/supabase/migrations/20251217_add_webhook_idempotency.sql
--    git commit -m "feat: add webhook idempotency table"
--    git push origin main
--
-- 2. Trigger the migration workflow manually:
--    - Go to: GitHub → Actions → "Deploy Supabase Migrations"
--    - Click "Run workflow"
--    - Type "DEPLOY" to confirm
--    - Wait for workflow to complete
--
-- 3. Verify in Supabase Dashboard:
--    - Go to Table Editor
--    - Confirm "processed_webhook_events" table exists
-- 
-- LOCAL TESTING:
--   supabase db push
-- 
-- ROLLBACK:
--   DROP TABLE IF EXISTS processed_webhook_events;
-- 
-- =============================================================================

-- Tracks processed webhook events to prevent duplicate processing
CREATE TABLE IF NOT EXISTS processed_webhook_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,  -- Stripe event ID (evt_xxx)
    event_type TEXT NOT NULL,        -- Event type (checkout.session.completed, etc.)
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups by event_id
CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_event_id 
ON processed_webhook_events(event_id);

-- Auto-cleanup: Delete events older than 30 days (retention policy)
-- This keeps the table small while maintaining idempotency protection
CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_processed_at 
ON processed_webhook_events(processed_at);

COMMENT ON TABLE processed_webhook_events IS 
'Tracks Stripe webhook events that have been processed to ensure idempotency. 
Events should be cleaned up after 30 days.';
