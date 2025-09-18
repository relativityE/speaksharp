-- Migration to consolidate 'premium' users into the 'pro' tier.

-- Step 1: Update all existing 'premium' users to 'pro'.
-- This ensures that all users are migrated to the new, simplified tier structure.
UPDATE user_profiles
SET subscription_status = 'pro'
WHERE subscription_status = 'premium';
