-- supabase/seed.sql

-- This script seeds the database with test users for local development.
-- It intentionally omits a 'dev' user, per the new design decision.
-- Local premium testing should be handled via the VITE_DEV_PREMIUM_ACCESS env variable.
--
-- Test credentials:
-- Email: free-user@test.com, Password: password123
-- Email: premium-user@test.com, Password: password123

-- 1. Create Test Users in auth.users
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, recovery_token, recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_sent_at, confirmed_at)
VALUES
    ('00000000-0000-0000-0000-000000000000', '8a069ce3-dafa-4efa-9a2c-67bd83a3d5e8', 'authenticated', 'authenticated', 'free-user@test.com', crypt('password123', gen_salt('bf')), now(), '', NULL, NULL, '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', NULL, now()),
    ('00000000-0000-0000-0000-000000000000', '9a069ce3-dafa-4efa-9a2c-67bd83a3d5e9', 'authenticated', 'authenticated', 'premium-user@test.com', crypt('password123', gen_salt('bf')), now(), '', NULL, NULL, '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', NULL, now());

-- 2. Create Corresponding User Profiles in public.user_profiles
INSERT INTO public.user_profiles (id, subscription_status)
VALUES
    ('8a069ce3-dafa-4efa-9a2c-67bd83a3d5e8', 'free'),
    ('9a069ce3-dafa-4efa-9a2c-67bd83a3d5e9', 'premium');

-- 3. (Optional) Create some sample session data for the users
INSERT INTO public.sessions (user_id, title, duration, total_words, filler_words)
VALUES
    ('8a069ce3-dafa-4efa-9a2c-67bd83a3d5e8', 'My First Practice', 300, 500, '{"um": 5, "uh": 3}'),
    ('9a069ce3-dafa-4efa-9a2c-67bd83a3d5e9', 'Client Presentation Prep', 1200, 2000, '{"so": 10, "like": 15, "you know": 8}');

-- Print a success message
\echo "✅ Database seeded with 2 test users (free, premium) and 2 sample sessions."
