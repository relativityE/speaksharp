#!/usr/bin/env node
/**
 * Canary User Provisioning Script (Senior Architect Edition)
 * 
 * Purpose:
 *   Reliably provision the 'pro' canary user in Supabase.
 *   Uses an idempotent "Attempt Create -> On Conflict Sync" pattern.
 *   
 * DESIGN PATTERN:
 * 1. SUPPRESS "Already Registered" errors via robust handling.
 * 2. SYNC credentials (password) even if user exists.
 * 3. SYNC profile (subscription_status) to ensure 'pro' tier.
 * 4. VERIFY outcome via real login challenge.
 */

import { createClient } from '@supabase/supabase-js';

// --- Configuration ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CANARY_EMAIL = process.env.CANARY_EMAIL;
const CANARY_PASSWORD = process.env.CANARY_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CANARY_PASSWORD || !CANARY_EMAIL) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CANARY_PASSWORD, CANARY_EMAIL');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🐤 Canary Infrastructure Provisioner');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Target: ${CANARY_EMAIL} (Tier: pro)`);

    let userId;

    // STEP 1: Provision Auth User
    console.log('\nSTEP 1: 👤 Provisioning Auth account...');
    const { data: createData, error: createError } = await supabase.auth.admin.createUser({
        email: CANARY_EMAIL,
        password: CANARY_PASSWORD,
        email_confirm: true
    });

    if (createError) {
        if (createError.message.includes('already been registered')) {
            console.log('  [IDEMPOTENT] User already exists. Fetching UID...');

            // Fetch existing user via paginated search (listUsers)
            let pageNum = 1;
            let existingUser = null;

            while (true) {
                console.log(`  Scanning page ${pageNum}...`);
                const { data: userData, error: getError } = await supabase.auth.admin.listUsers({
                    page: pageNum,
                    perPage: 100
                });

                if (getError) {
                    console.error('  ❌ Failed to list users during search.');
                    process.exit(1);
                }

                existingUser = userData?.users.find(u => u.email?.toLowerCase() === CANARY_EMAIL.toLowerCase());
                if (existingUser || (userData?.users || []).length < 100) break;
                pageNum++;
            }

            if (!existingUser) {
                console.error('  ❌ Failed to locate existing user ID.');
                process.exit(1);
            }

            userId = existingUser.id;
            console.log(`  [OK] Found UID: ${userId}`);

            // STEP 2: Force Password Sync
            console.log('\nSTEP 2: 🔐 Synchronizing credentials...');
            const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
                password: CANARY_PASSWORD,
                email_confirm: true
            });
            if (updateError) {
                console.error(`  ❌ Password sync failed: ${updateError.message}`);
                process.exit(1);
            }
            console.log('  [OK] Password synchronized.');
        } else {
            console.error(`  ❌ Provisioning error: ${createError.message}`);
            process.exit(1);
        }
    } else {
        userId = createData.user.id;
        console.log(`  [OK] Created UID: ${userId}`);
    }

    // STEP 3: Sync User Profile (Subscription Tier)
    console.log('\nSTEP 3: 🔄 Synchronizing database profile...');
    const { error: profileError } = await supabase.from('user_profiles').upsert({
        id: userId,
        subscription_status: 'pro'
    }, { onConflict: 'id' });

    if (profileError) {
        console.error(`  ❌ Profile sync failed: ${profileError.message}`);
        process.exit(1);
    }
    console.log('  [OK] Tier verified: pro');

    // STEP 4: High-Fidelity Login Challenge
    console.log('\nSTEP 4: 🔑 Running login challenge...');
    const { error: loginError } = await supabase.auth.signInWithPassword({
        email: CANARY_EMAIL,
        password: CANARY_PASSWORD
    });

    if (loginError) {
        console.error(`  [FAIL] Challenge failed: ${loginError.message}`);
        process.exit(1);
    }
    console.log(`  [PASS] session established.`);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Canary Infrastructure Stabilized');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
