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

// Read user counts from config (max target users)
function getConfigCounts() {
    const configPath = path.resolve(process.cwd(), 'tests/constants.ts');
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        // Match FREE_USER_COUNT = getEnvNum('NEW_FREE_COUNT', 7)
        const freeMatch = content.match(/FREE_USER_COUNT.*?getEnvNum\(.*?,?\s*(\d+)\)/);
        const proMatch = content.match(/PRO_USER_COUNT.*?getEnvNum\(.*?,?\s*(\d+)\)/);

        if (freeMatch && proMatch) {
            const free = parseInt(freeMatch[1], 10);
            const pro = parseInt(proMatch[1], 10);
            return { free, pro, total: free + pro };
        }
    } catch (e) {
        console.warn('⚠️ Could not read user counts from config');
    }
    return { free: 7, pro: 3, total: 10 }; // Default
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

async function syncUserTiers(users, targetFree, targetPro) {
    console.log('\n🔄 Syncing user tiers to match target distribution...');
    let synced = 0;
    const total = targetFree + targetPro;

    for (let i = 0; i < total; i++) {
        const email = getEmailForIndex(i);
        const expectedTier = i < targetFree ? 'free' : 'pro';
        const user = users.find(u => u.email === email);

        if (user && user.tier !== expectedTier) {
            console.log(`  Updating ${email}: ${user.tier} -> ${expectedTier}`);
            const { error } = await supabase.from('user_profiles').upsert({
                id: user.id,
                subscription_status: expectedTier
            }, { onConflict: 'id' });

            if (error) {
                console.error(`  ❌ Failed to sync ${email}:`, error.message);
            } else {
                synced++;
            }
        }
    }
    if (synced === 0) console.log('✅ All existing users already match target tiers');
    else console.log(`✅ ${synced} users updated to correct tiers`);
}

// ============================================
// Main
// ============================================

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 Test User Registry Setup');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const MODE = process.env.MODE || 'e2e';
    const config = getConfigCounts();
    const { newFreeCount: inputFree, newProCount: inputPro } = getNewUserCounts();

    // Determine final counts (override if inputs provided)
    let finalFree = config.free;
    let finalPro = config.pro;
    const isOverride = inputFree > 0 || inputPro > 0;

    if (MODE === 'e2e') {
        // E2E Mode: Enforce 1 user
        console.log('📌 Mode: E2E (Single User)');

        finalPro = inputPro > 0 ? 1 : 0;
        finalFree = finalPro === 1 ? 0 : 1;

        if (inputFree + inputPro > 1) {
            console.log('⚠️  E2E enforcement: Adjusting requested counts to 1 user');
        }

        console.log(`  free selection from ${inputFree} to ${finalFree}`);
        console.log(`  pro selection from ${inputPro} to ${finalPro}`);
    } else {
        // Soak Mode: Use config or overrides
        console.log('📌 Mode: Soak (Batch Operations)');
        if (isOverride) {
            console.log('🔄 Overriding config with workflow inputs:');
            if (inputFree > 0) {
                console.log(`  Free:  ${config.free} -> ${inputFree}`);
                finalFree = inputFree;
            }
            if (inputPro > 0) {
                console.log(`  Pro:   ${config.pro} -> ${inputPro}`);
                finalPro = inputPro;
            }
            console.log(`  Total: ${config.total} -> ${finalFree + finalPro}`);
        } else {
            console.log('📌 Using default config counts');
        }
    }

    const finalTotal = finalFree + finalPro;

    // Step 1: List existing users
    let existingUsers = await listExistingSoakUsers();

    // Step 2: Rename old-style user if exists (returns true if renamed)
    const didRename = await renameOldUser(existingUsers);

    // Re-query only if rename happened
    if (didRename) {
        existingUsers = await listExistingSoakUsers(false);
    }

    // Calculate breakdown of existing
    const existingCount = existingUsers.length;
    const existingFree = existingUsers.filter(u => u.tier === 'free').length;
    const existingPro = existingUsers.filter(u => u.tier === 'pro').length;
    const maxToCreate = Math.max(0, finalTotal - existingCount);

    console.log(`\n📊 Status:`);
    console.log(`  Target:     ${finalTotal} (${finalFree} free, ${finalPro} pro)`);
    console.log(`  Existing:   ${existingCount} (${existingFree} free, ${existingPro} pro)`);
    console.log(`  Need:       ${maxToCreate}`);

    // Step 3: Update passwords for existing users
    console.log('\n🔐 Updating passwords to shared password...');
    let passwordsUpdated = 0;
    for (const user of existingUsers) {
        const success = await updateUserPassword(user.id, user.email);
        if (success) passwordsUpdated++;
    }
    console.log(`✅ ${passwordsUpdated}/${existingUsers.length} passwords updated`);

    // Step 4: Create new users based on final counts
    if (maxToCreate > 0) {
        console.log(`\n📝 Creating ${maxToCreate} new users...`);

        // Find existing indices
        const existingIndices = new Set(existingUsers.map(u => {
            const match = u.email.match(/soak-test(\d+)@/);
            return match ? parseInt(match[1], 10) : -1;
        }));

        let createdFree = 0;
        let createdPro = 0;

        // We need to reach finalFree and finalPro
        const needFree = Math.max(0, finalFree - existingFree);
        const needPro = Math.max(0, finalPro - existingPro);

        for (let i = 0; i < finalTotal && (createdFree < needFree || createdPro < needPro); i++) {
            if (!existingIndices.has(i)) {
                const email = getEmailForIndex(i);
                // Create free first, then pro, up to the required counts
                const tier = createdFree < needFree ? 'free' : 'pro';
                const user = await createUserWithTier(email, tier);
                if (user) {
                    if (tier === 'free') createdFree++;
                    else createdPro++;
                }
            }
        }
        console.log(`✅ Created ${createdFree} free + ${createdPro} pro users`);
    } else {
        console.log(`\n✅ Sufficient users exist. No creation needed.`);
    }

    // Step 5: SYNC TIERS for all users (critical fix)
    // Refresh list after creation
    const currentUsers = await listExistingSoakUsers(false);
    await syncUserTiers(currentUsers, finalFree, finalPro);

    // Step 6: Verify logins for the target users
    const allUsers = await listExistingSoakUsers(false);
    // Sort so we check indices 0 to finalTotal-1
    const sortedUsers = allUsers.sort((a, b) => {
        const idxA = parseInt(a.email.match(/soak-test(\d+)@/)[1], 10);
        const idxB = parseInt(b.email.match(/soak-test(\d+)@/)[1], 10);
        return idxA - idxB;
    }).slice(0, finalTotal);

    console.log('\n🔑 Verifying logins...');
    const results = [];
    for (const user of sortedUsers) {
        const result = await verifyLogin(user.email);
        results.push({ email: user.email, ...result });
        console.log(result.success ? `  ✅ ${user.email} (${user.tier})` : `  ❌ ${user.email}: ${result.error}`);
    }

    // Summary
    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Target users:   ${finalTotal}`);
    console.log(`Verified logins: ${passed}/${finalTotal}`);

    if (failed.length > 0) {
        console.log('\n❌ Failed logins:');
        failed.forEach(f => console.log(`  - ${f.email}: ${f.error}`));
        process.exit(1);
    } else {
        console.log('\n✅ All specified users verified successfully!');
    }
}

main().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
