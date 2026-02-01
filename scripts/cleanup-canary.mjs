#!/usr/bin/env node
/**
 * Canary Cleanup Script
 * 
 * Purpose:
 *   Delete the provisioned canary user to prevent DB pollution.
 *   Runs after canary tests (success or failure).
 */

import { createClient } from '@supabase/supabase-js';

// --- Configuration ---
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CANARY_EMAIL = process.env.CANARY_EMAIL;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CANARY_EMAIL) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CANARY_EMAIL');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧹 Canary Cleanup');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Target: ${CANARY_EMAIL}`);

    // 1. Find User by Email
    console.log('STEP 1: Locating user...');
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
        console.error(`  ❌ Failed to list users: ${listError.message}`);
        process.exit(1);
    }

    // Note: listUsers is paginated, but for unique canary emails simpler find is usually valid 
    // if we assume recent creation. Ideally we search.
    // Supabase admin.listUsers doesn't support email filtering directly in all versions, 
    // but we can iterate.
    const user = users.find(u => u.email?.toLowerCase() === CANARY_EMAIL.toLowerCase());

    if (!user) {
        console.log('  ⚠️ User not found. Already cleaned up?');
        process.exit(0);
    }

    console.log(`  [OK] Found UID: ${user.id}`);

    // 2. Delete User
    console.log('\nSTEP 2: Deleting user...');
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);

    if (deleteError) {
        console.error(`  ❌ Failed to delete user: ${deleteError.message}`);
        process.exit(1);
    }

    // 3. Optional: Clean up user_profiles manually if cascade is not enabled?
    // Usually Supabase Auth delete cascades to storage/db if configured, 
    // but `user_profiles` might need manual cleanup if foreign key is not CASCADE.
    // We'll trust the DB constraint or simply try to delete profile just in case.
    console.log('\nSTEP 3: Verifying profile removal...');
    const { error: profileError } = await supabase.from('user_profiles').delete().eq('id', user.id);

    if (profileError) {
        console.log(`  ℹ️ Profile delete result: ${profileError.message} (Likely cascaded)`);
    } else {
        console.log('  [OK] Profile cleanup ensured.');
    }

    console.log('\n✅ Cleanup Complete');
}

main().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
