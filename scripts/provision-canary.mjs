#!/usr/bin/env node
/**
 * Canary User Provisioning Script (Senior Architect Edition)
 * 
 * Purpose:
 *   Reliably provision the deploy-health canary user in Supabase as a clean Free tier.
 *   Uses an idempotent "Attempt Create -> On Conflict Sync" pattern.
 *   
 * DESIGN PATTERN:
 * 1. SUPPRESS "Already Registered" errors via robust handling.
 * 2. SYNC credentials (password) even if user exists.
 * 3. SYNC profile (subscription_status) to ensure 'free' tier.
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
    console.log(`Target: ${CANARY_EMAIL} (Tier: free)`);

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
    // The deploy-health canary runs the tier-agnostic Native-STT smoke (smoke.canary.spec.ts), so it
    // should exercise the realistic Free / new-user path — not a misleading DB-'pro' state with no
    // real Stripe subscription (which is effectively Free anyway). The Cloud/Pro high-fidelity canary
    // (user-filler-words) needs a SEPARATE real Stripe-backed Pro account, tracked as an owner-gated
    // follow-up; never fabricate a Stripe subscription here.
    console.log('\nSTEP 3: 🔄 Synchronizing database profile...');
    const { error: profileError } = await supabase.from('user_profiles').upsert({
        id: userId,
        subscription_status: 'free'
    }, { onConflict: 'id' });

    if (profileError) {
        console.error(`  ❌ Profile sync failed: ${profileError.message}`);
        process.exit(1);
    }
    console.log('  [OK] Tier verified: free');

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

    // STEP 5: Enforce the canary account ceiling — exactly ONE stable canary should ever exist.
    // Reuse, never accumulate. Counts canary@ + any canary-<runid>@ strays and compares to
    // CANARY_MAX (default 1). Warn-only by default so canary keeps passing while the legacy
    // canary-<runid> residue is being cleaned up; set CANARY_ENFORCE=fail afterward to make the
    // invariant hard (the job fails if a stray ever reappears).
    console.log('\nSTEP 5: 📊 Enforcing canary account ceiling...');
    const CANARY_MAX = Number(process.env.CANARY_MAX || '1');
    const ENFORCE = (process.env.CANARY_ENFORCE || 'warn').toLowerCase() === 'fail';
    const canaryRe = /^canary(-.+)?@speaksharp\.app$/i;
    const canaryEmails = [];
    let checked = true;
    for (let page = 1; ; page++) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (error) { console.warn(`  ⚠️  ceiling check skipped (listUsers failed: ${error.message})`); checked = false; break; }
        const batch = data?.users || [];
        for (const u of batch) if (u.email && canaryRe.test(u.email)) canaryEmails.push(u.email.toLowerCase());
        if (batch.length < 200) break;
    }
    if (checked) {
        const strays = canaryEmails.filter(e => e !== CANARY_EMAIL.toLowerCase());
        console.log(`  canary-like accounts: ${canaryEmails.length} (max ${CANARY_MAX}); legacy strays: ${strays.length}`);
        if (canaryEmails.length > CANARY_MAX) {
            const msg = `canary ceiling exceeded: ${canaryEmails.length} > ${CANARY_MAX} (${strays.length} legacy canary-<runid> strays pending cleanup)`;
            if (ENFORCE) { console.error(`  ❌ ${msg}`); process.exit(1); }
            console.warn(`  ⚠️  ${msg} — warn-only; set CANARY_ENFORCE=fail after the legacy delete.`);
        } else {
            console.log('  [OK] canary account ceiling satisfied.');
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Canary Infrastructure Stabilized');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
