#!/usr/bin/env node
/**
 * Soak Test User Setup Script
 * 
 * This script manages soak test users in Supabase:
 * 1. Queries existing soak-test* users
 * 2. Renames soak-test@test.com → soak-test0@test.com (if needed)
 * 3. Updates all passwords to shared SOAK_TEST_PASSWORD
 * 4. Creates missing users to meet CONCURRENT_USERS target
 * 5. Verifies login for all users
 * 
 * Usage:
 *   SUPABASE_URL=xxx SUPABASE_SERVICE_KEY=xxx SOAK_TEST_PASSWORD=xxx node scripts/setup-soak-users.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// ============================================
// Configuration
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SOAK_TEST_PASSWORD = process.env.SOAK_TEST_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY');
    process.exit(1);
}

if (!SOAK_TEST_PASSWORD) {
    console.error('❌ Missing required env var: SOAK_TEST_PASSWORD');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================
// Helper Functions
// ============================================

function getEmailForIndex(index) {
    return `soak-test${index}@test.com`;
}

function getConcurrentUsersFromConfig() {
    const configPath = path.resolve(process.cwd(), 'tests/constants.ts');
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const match = content.match(/CONCURRENT_USERS:\s*(\d+)/);
        if (match) {
            return parseInt(match[1], 10);
        }
    } catch (e) {
        console.warn('⚠️ Could not read CONCURRENT_USERS from config');
    }
    return 10; // Default
}

// ============================================
// Core Functions
// ============================================

async function listExistingSoakUsers() {
    console.log('\n📊 Querying Supabase for soak-test* users...');

    const { data: users, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;

    const soakUsers = users.users.filter(u =>
        u.email?.startsWith('soak-test') && u.email?.endsWith('@test.com')
    );

    console.log(`Found ${soakUsers.length} soak test users:`);
    soakUsers.forEach(u => console.log(`  - ${u.email}`));

    return soakUsers;
}

async function renameOldUser(existingUsers) {
    // Check if old-style soak-test@test.com exists (without index)
    const oldUser = existingUsers.find(u => u.email === 'soak-test@test.com');
    if (!oldUser) return;

    console.log('\n🔄 Renaming soak-test@test.com → soak-test0@test.com');

    const { error } = await supabase.auth.admin.updateUserById(oldUser.id, {
        email: 'soak-test0@test.com'
    });

    if (error) {
        console.error('❌ Failed to rename user:', error.message);
        throw error;
    }

    console.log('✅ User renamed successfully');
}

async function updateUserPassword(userId, email) {
    const { error } = await supabase.auth.admin.updateUserById(userId, {
        password: SOAK_TEST_PASSWORD
    });

    if (error) {
        console.error(`❌ Failed to update password for ${email}:`, error.message);
        return false;
    }
    return true;
}

async function createUser(email) {
    console.log(`  Creating ${email}...`);

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: SOAK_TEST_PASSWORD,
        email_confirm: true
    });

    if (error) {
        console.error(`❌ Failed to create ${email}:`, error.message);
        return null;
    }

    // Create profile
    await supabase.from('user_profiles').upsert({
        id: data.user.id,
        subscription_status: 'free'
    }, { onConflict: 'id' });

    return data.user;
}

async function verifyLogin(email) {
    // Use Supabase client to attempt login
    const { createClient: createAnonClient } = await import('@supabase/supabase-js');
    const anonClient = createAnonClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY || SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    const { data, error } = await anonClient.auth.signInWithPassword({
        email,
        password: SOAK_TEST_PASSWORD
    });

    if (error) {
        return { success: false, error: error.message };
    }

    // Sign out
    await anonClient.auth.signOut();
    return { success: true };
}

// ============================================
// Main
// ============================================

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 Soak Test User Setup');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const targetCount = getConcurrentUsersFromConfig();
    console.log(`\n🎯 Target: ${targetCount} concurrent users (from tests/constants.ts)`);

    // Step 1: List existing users
    let existingUsers = await listExistingSoakUsers();

    // Step 2: Rename old-style user if exists
    await renameOldUser(existingUsers);

    // Re-query after rename
    existingUsers = await listExistingSoakUsers();

    // Step 3: Update passwords for existing users
    console.log('\n🔐 Updating passwords to shared password...');
    let passwordsUpdated = 0;
    for (const user of existingUsers) {
        const success = await updateUserPassword(user.id, user.email);
        if (success) passwordsUpdated++;
    }
    console.log(`✅ ${passwordsUpdated}/${existingUsers.length} passwords updated`);

    // Step 4: Create missing users
    const existingEmails = new Set(existingUsers.map(u => u.email));
    const missingCount = targetCount - existingUsers.length;

    if (missingCount > 0) {
        console.log(`\n📝 Creating ${missingCount} new users...`);
        let created = 0;
        for (let i = 0; i < targetCount; i++) {
            const email = getEmailForIndex(i);
            if (!existingEmails.has(email)) {
                const user = await createUser(email);
                if (user) created++;
            }
        }
        console.log(`✅ ${created} users created`);
    } else {
        console.log(`\n✅ ${existingUsers.length} users exist (${targetCount} requested). No creation needed.`);
    }

    // Step 5: Verify logins
    console.log('\n🔑 Verifying logins...');
    const results = [];
    for (let i = 0; i < targetCount; i++) {
        const email = getEmailForIndex(i);
        const result = await verifyLogin(email);
        results.push({ email, ...result });
        console.log(result.success ? `  ✅ ${email}` : `  ❌ ${email}: ${result.error}`);
    }

    // Summary
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Verified: ${passed}/${targetCount}`);

    if (failed.length > 0) {
        console.log('\n❌ Failed logins:');
        failed.forEach(f => console.log(`  - ${f.email}: ${f.error}`));
        process.exit(1);
    } else {
        console.log('\n✅ All users verified successfully!');
    }
}

main().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
