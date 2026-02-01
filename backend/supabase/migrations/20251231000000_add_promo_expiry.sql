-- Add promo_expires_at column to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS promo_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.promo_expires_at IS 'Timestamp when the promotional Pro access expires';
