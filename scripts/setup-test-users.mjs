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

// Get new user counts from env vars (set by workflow inputs)
function getNewUserCounts() {
    return {
        newFreeCount: parseInt(process.env.NEW_FREE_COUNT || '0', 10),
        newProCount: parseInt(process.env.NEW_PRO_COUNT || '0', 10),
    };
}

// Read CONCURRENT_USER_COUNT from config (max target users)
function getMaxUsersFromConfig() {
    const configPath = path.resolve(process.cwd(), 'tests/constants.ts');
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        // Match FREE_USER_COUNT + PRO_USER_COUNT or CONCURRENT_USER_COUNT
        const freeMatch = content.match(/FREE_USER_COUNT\s*=\s*(\d+)/);
        const proMatch = content.match(/PRO_USER_COUNT\s*=\s*(\d+)/);
        if (freeMatch && proMatch) {
            return parseInt(freeMatch[1], 10) + parseInt(proMatch[1], 10);
        }
        const concurrentMatch = content.match(/CONCURRENT_USER_COUNT\s*=\s*(\d+)/);
        if (concurrentMatch) {
            return parseInt(concurrentMatch[1], 10);
        }
    } catch (e) {
        console.warn('⚠️ Could not read user counts from config');
    }
    return 10; // Default
}


// ============================================
// Core Functions
// ============================================

async function listExistingSoakUsers(showLog = true) {
    if (showLog) console.log('\n📊 Querying Supabase...');

    const { data: users, error } = await supabase.auth.admin.listUsers();
    if (error) throw error;

    const soakUsers = users.users.filter(u =>
        u.email?.startsWith('soak-test') && u.email?.endsWith('@test.com')
    );

    // Fetch tiers from profiles
    const userIds = soakUsers.map(u => u.id);
    const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, subscription_status')
        .in('id', userIds);

    const tierMap = new Map(profiles?.map(p => [p.id, p.subscription_status]) || []);

    // Enrich users with tier
    const enrichedUsers = soakUsers.map(u => ({
        ...u,
        tier: tierMap.get(u.id) || 'free'
    }));

    if (showLog) {
        console.log(`Found ${enrichedUsers.length} soak users in Supabase:`);
        enrichedUsers.forEach(u => console.log(`  - ${u.email} (${u.tier})`));
    }

    return enrichedUsers;
}

async function renameOldUser(existingUsers) {
    // Check if old-style soak-test@test.com exists (without index)
    const oldUser = existingUsers.find(u => u.email === 'soak-test@test.com');
    if (!oldUser) return false;

    console.log('\n🔄 Renaming soak-test@test.com → soak-test0@test.com');

    const { error } = await supabase.auth.admin.updateUserById(oldUser.id, {
        email: 'soak-test0@test.com'
    });

    if (error) {
        console.error('❌ Failed to rename user:', error.message);
        throw error;
    }

    console.log('✅ User renamed successfully');
    return true;
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

async function createUserWithTier(email, tier) {
    console.log(`  Creating ${email} (${tier})...`);

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: SOAK_TEST_PASSWORD,
        email_confirm: true
    });

    if (error) {
        console.error(`❌ Failed to create ${email}:`, error.message);
        return null;
    }

    // Create profile with specified tier
    await supabase.from('user_profiles').upsert({
        id: data.user.id,
        subscription_status: tier
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

    const maxTarget = getMaxUsersFromConfig();
    const { newFreeCount, newProCount } = getNewUserCounts();

    // Step 1: List existing users
    let existingUsers = await listExistingSoakUsers();

    // Step 2: Rename old-style user if exists (returns true if renamed)
    const didRename = await renameOldUser(existingUsers);

    // Re-query only if rename happened
    if (didRename) {
        existingUsers = await listExistingSoakUsers();
    }
    const existingCount = existingUsers.length;

    // Calculate how many we can create
    const maxToCreate = maxTarget - existingCount;
    const requested = newFreeCount + newProCount;

    console.log(`\n📊 Status:`);
    console.log(`  Max target (from config): ${maxTarget}`);
    console.log(`  Existing users: ${existingCount}`);
    console.log(`  Max to create: ${maxToCreate}`);
    console.log(`  Requested: ${newFreeCount} free + ${newProCount} pro = ${requested}`);

    // Step 3: Update passwords for existing users
    console.log('\n🔐 Updating passwords to shared password...');
    let passwordsUpdated = 0;
    for (const user of existingUsers) {
        const success = await updateUserPassword(user.id, user.email);
        if (success) passwordsUpdated++;
    }
    console.log(`✅ ${passwordsUpdated}/${existingUsers.length} passwords updated`);

    // Step 4: Create new users based on workflow inputs
    if (maxToCreate > 0 && (newFreeCount > 0 || newProCount > 0)) {
        // Calculate padding: if requested < maxToCreate, fill rest with free
        const padFreeCount = Math.max(0, maxToCreate - requested);
        const totalFree = newFreeCount + padFreeCount;
        const totalPro = Math.min(newProCount, maxToCreate - totalFree);

        if (padFreeCount > 0) {
            console.log(`\n📌 Padding with ${padFreeCount} additional free users to meet target`);
        }

        console.log(`\n📝 Creating ${totalFree + totalPro} new users (${totalFree} free, ${totalPro} pro)...`);

        // Find next available index
        const existingIndices = new Set(existingUsers.map(u => {
            const match = u.email.match(/soak-test(\d+)@/);
            return match ? parseInt(match[1], 10) : -1;
        }));

        let createdFree = 0;
        let createdPro = 0;

        for (let i = 0; i < maxTarget && (createdFree < totalFree || createdPro < totalPro); i++) {
            if (!existingIndices.has(i)) {
                const email = getEmailForIndex(i);
                // Create free first, then pro
                const tier = createdFree < totalFree ? 'free' : 'pro';
                const user = await createUserWithTier(email, tier);
                if (user) {
                    if (tier === 'free') createdFree++;
                    else createdPro++;
                }
            }
        }
        console.log(`✅ Created ${createdFree} free + ${createdPro} pro users`);
    } else if (maxToCreate === 0) {
        console.log(`\n✅ Already at max (${existingCount}/${maxTarget}). No creation needed.`);
    } else {
        console.log(`\n✅ No new users requested.`);
    }

    // Step 5: Verify logins for all existing + new users
    const allUsers = await listExistingSoakUsers();
    console.log('\n🔑 Verifying logins...');
    const results = [];
    for (const user of allUsers) {
        const result = await verifyLogin(user.email);
        results.push({ email: user.email, ...result });
        console.log(result.success ? `  ✅ ${user.email}` : `  ❌ ${user.email}: ${result.error}`);
    }

    // Summary
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total users: ${allUsers.length}/${maxTarget}`);
    console.log(`Verified logins: ${passed}/${allUsers.length}`);

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
