#!/usr/bin/env node
/**
 * Canary User Provisioning Script
 * 
 * Modeled after scripts/setup-test-users.mjs
 * 
 * Purpose:
 *   Reliably provision a single 'pro' user for canary testing.
 *   Uses CANARY_EMAIL and CANARY_PASSWORD env vars.
 *   Ensures the user exists, password is correct, profile is 'pro', and login works.
 */

import { createClient } from '@supabase/supabase-js';

// ============================================
// Configuration (follows setup-test-users.mjs pattern)
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CANARY_EMAIL = process.env.CANARY_EMAIL || 'canary-user@speaksharp.app';
const CANARY_PASSWORD = process.env.CANARY_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY');
    process.exit(1);
}

if (!CANARY_PASSWORD) {
    console.error('❌ Missing required env var: CANARY_PASSWORD');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================
// Helper Functions (from setup-test-users.mjs)
// ============================================

async function updateUserPassword(id, email) {
    const { error } = await supabase.auth.admin.updateUserById(id, {
        password: CANARY_PASSWORD,
        email_confirm: true
    });
    if (error) {
        console.error(`❌ Failed to update password for ${email}:`, error.message);
        return false;
    }
    return true;
}

async function createUserWithTier(email, tier) {
    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: CANARY_PASSWORD,
        email_confirm: true
    });

    if (error) {
        console.error(`❌ Failed to create ${email}:`, error.message);
        return null;
    }

    // Try update first (for profile cleanup) then upsert
    await supabase.from('user_profiles').update({ subscription_status: tier }).eq('id', data.user.id);
    await supabase.from('user_profiles').upsert({ id: data.user.id, subscription_status: tier }, { onConflict: 'id' });

    return data.user;
}

async function verifyLogin(email) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password: CANARY_PASSWORD
    });

    if (error) {
        return { success: false, error: error.message };
    }

    // Sign out (fail-safe)
    try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }

    return { success: true };
}

// ============================================
// Main (follows setup-test-users.mjs pattern)
// ============================================

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🐤 Canary User Provisioning');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Target User: ${CANARY_EMAIL}`);
    console.log(`Tier: pro`);

    // Step 1: Check if user exists
    console.log('\nStep 1: 📊 Checking existing users...');
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;

    const existingUser = users.find(u => u.email === CANARY_EMAIL);
    let userId;

    if (existingUser) {
        console.log(`  Found existing user (${existingUser.id})`);
        userId = existingUser.id;

        // Step 2: Sync password
        console.log('\nStep 2: 🔐 Synchronizing password...');
        const success = await updateUserPassword(userId, CANARY_EMAIL);
        if (!success) process.exit(1);
        console.log('  ✅ Password synchronized');
    } else {
        console.log('  User not found, creating...');

        // Step 2: Create user with pro tier
        console.log('\nStep 2: 👤 Creating user with pro tier...');
        const user = await createUserWithTier(CANARY_EMAIL, 'pro');
        if (!user) process.exit(1);
        userId = user.id;
        console.log(`  ✅ Created user ${userId}`);
    }

    // Step 3: Ensure pro tier (for existing users)
    console.log('\nStep 3: 🔄 Ensuring PRO subscription tier...');
    const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ subscription_status: 'pro' })
        .eq('id', userId);

    if (updateError) {
        console.log(`  Update failed (${updateError.message}), attempting upsert...`);
        const { error: upsertError } = await supabase.from('user_profiles').upsert({
            id: userId,
            subscription_status: 'pro'
        }, { onConflict: 'id' });

        if (upsertError) {
            console.error(`  ❌ Failed: ${upsertError.message}`);
            process.exit(1);
        }
    }
    console.log('  ✅ Profile synchronized');

    // Step 4: Verify login
    console.log('\nStep 4: 🔑 Verifying login...');
    const result = await verifyLogin(CANARY_EMAIL);
    if (result.success) {
        console.log(`  [OK] ${CANARY_EMAIL} | Tier: pro | Auth: Passed`);
    } else {
        console.error(`  [FAIL] ${CANARY_EMAIL} | Auth: ${result.error}`);
        process.exit(1);
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎉 Canary Provisioning Complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
