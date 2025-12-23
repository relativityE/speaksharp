/**
 * Canary User Setup Script
 * 
 * Usage: 
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/create-canary-user.mjs
 * 
 * Purpose:
 *   Creates or resets the dedicated 'canary-user@speaksharp.app' for use in 
 *   smoke.canary.spec.ts. Sets subscription_status to 'pro'.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CANARY_EMAIL = 'canary-user@speaksharp.app';
const CANARY_PASSWORD = process.env.CANARY_PASSWORD || 'CanaryTest123!';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
    console.log(`🤖 Provisioning Canary User: ${CANARY_EMAIL}...`);

    // 1. Check if user exists
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;

    const existingUser = users.find(u => u.email === CANARY_EMAIL);
    let userId;

    if (existingUser) {
        console.log(`   User exists (${existingUser.id}), resetting password...`);
        const { error: updateError } = await supabase.auth.admin.updateUserById(existingUser.id, {
            password: CANARY_PASSWORD
        });
        if (updateError) throw updateError;
        userId = existingUser.id;
    } else {
        console.log(`   Creating new user...`);
        const { data: { user }, error: createError } = await supabase.auth.admin.createUser({
            email: CANARY_EMAIL,
            password: CANARY_PASSWORD,
            email_confirm: true
        });
        if (createError) throw createError;
        userId = user.id;
    }

    // 2. Set to Pro
    console.log(`   Setting subscription_status to 'pro'...`);

    // Upsert profile
    const { error: profileError } = await supabase.from('user_profiles').upsert({
        id: userId,
        subscription_status: 'pro'
    }, { onConflict: 'id' });

    if (profileError) {
        console.error('❌ Failed to update profile:', profileError);
        process.exit(1);
    }

    console.log(`\n✅ Canary User Ready:`);
    console.log(`   Email:    ${CANARY_EMAIL}`);
    console.log(`   Password: ${CANARY_PASSWORD}`);
    console.log(`\n👉 Set E2E_PRO_EMAIL and E2E_PRO_PASSWORD in your environment.`);
}

main().catch(err => {
    console.error('❌ Script failed:', err);
    process.exit(1);
});
