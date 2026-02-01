#!/usr/bin/env node
/**
 * Soak Test User Setup Script
 * 
 * This script manages soak test users in Supabase:
 * 1. Queries existing soak-test* users
 * 2. Renames old users if needed
 * 3. Updates all passwords to shared SOAK_TEST_PASSWORD
 * 4. Creates missing users to meet targets
 * 5. Syncs subscription tiers (Free/Pro)
 * 6. Verifies login for all users
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================
// Configuration
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOAK_TEST_PASSWORD = process.env.SOAK_TEST_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

if (!SOAK_TEST_PASSWORD) {
    console.error('❌ Missing required env var: SOAK_TEST_PASSWORD');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

// ============================================
// Helper Functions
// ============================================

function getEmailForIndex(index) {
    return `soak-test${index}@test.com`;
}

function getNewUserCounts() {
    return {
        newFreeCount: parseInt(process.env.NEW_FREE_COUNT || '0', 10),
        newProCount: parseInt(process.env.NEW_PRO_COUNT || '0', 10)
    };
}

async function getConfigCounts() {
    try {
        const constantsPath = path.resolve(process.cwd(), 'tests/constants.ts');
        const content = fs.readFileSync(constantsPath, 'utf8');

        // Extract defaults using robust regex
        const freeMatch = content.match(/FREE_USER_COUNT = getEnvNum\('.*', (\d+)\)/);
        const proMatch = content.match(/PRO_USER_COUNT = getEnvNum\('.*', (\d+)\)/);
        const maxMatch = content.match(/MAX_TOTAL_TEST_USERS = (\d+)/);

        const free = freeMatch ? parseInt(freeMatch[1], 10) : 7;
        const pro = proMatch ? parseInt(proMatch[1], 10) : 3;
        const max = maxMatch ? parseInt(maxMatch[1], 10) : 100;

        return { total: free + pro, free, pro, max };
    } catch (e) {
        return { total: 10, free: 7, pro: 3, max: 100 };
    }
}

async function listExistingSoakUsers(log = true) {
    if (log) console.log('📊 Querying Supabase...');

    let allUsers = [];
    let pageNum = 1;

    while (true) {
        if (log) console.log(`  Scanning page ${pageNum}...`);
        const { data, error } = await supabase.auth.admin.listUsers({
            page: pageNum,
            perPage: 100
        });

        if (error) {
            console.error('❌ Failed to list users:', error.message);
            process.exit(1);
        }

        const users = data?.users || [];
        allUsers = allUsers.concat(users);

        if (users.length < 100) break;
        pageNum++;
    }

    const soakUsers = allUsers.filter(u => u.email && u.email.match(/^soak-test\d*@test\.com$/));

    if (soakUsers.length === 0) return [];

    // Senior architectural choice: Filter profiles by ID to avoid loading the entire table
    const { data: profiles, error: profileError } = await supabase
        .from('user_profiles')
        .select('id, subscription_status')
        .in('id', soakUsers.map(u => u.id));

    if (profileError) {
        console.warn(`  ⚠️ Could not fetch profiles: ${profileError.message}`);
    }

    const profileMap = new Map(profiles?.map(p => [p.id, p.subscription_status]) || []);

    return soakUsers.map(u => ({
        id: u.id,
        email: u.email,
        tier: profileMap.get(u.id) || 'unknown'
    }));
}

async function renameOldUser(users) {
    const oldUser = users.find(u => u.email === 'soak-test@test.com');
    if (oldUser) {
        console.log('🔄 Renaming soak-test@test.com to soak-test0@test.com...');
        const { error } = await supabase.auth.admin.updateUserById(oldUser.id, {
            email: 'soak-test0@test.com'
        });
        if (error) {
            console.error('❌ Failed to rename user:', error.message);
            return false;
        }
        return true;
    }
    return false;
}

async function updateUserPassword(id, email) {
    const { error } = await supabase.auth.admin.updateUserById(id, {
        password: SOAK_TEST_PASSWORD
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
        password: SOAK_TEST_PASSWORD,
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
        password: SOAK_TEST_PASSWORD
    });

    if (error) {
        return { success: false, error: error.message };
    }

    // Sign out (fail-safe)
    try { await supabase.auth.signOut(); } catch (e) { }

    return { success: true };
}

async function syncUserTiers(users, targetFree, targetPro) {
    let synced = 0;
    const total = targetFree + targetPro;

    for (let i = 0; i < total; i++) {
        const email = getEmailForIndex(i);
        const expectedTier = i < targetFree ? 'free' : 'pro';
        const user = users.find(u => u.email === email);

        if (user && user.tier !== expectedTier) {
            console.log(`  [SYNC] ${email}: ${user.tier} -> ${expectedTier}`);

            // Try Update first (more surgical, avoids some permission traps)
            const { error: updateError } = await supabase
                .from('user_profiles')
                .update({ subscription_status: expectedTier })
                .eq('id', user.id);

            if (updateError) {
                console.error(`  ⚠️ Schema Access Failed for ${email}: ${updateError.message}`);
                console.log(`  🔄 Falling back to upsert for ${email}...`);

                const { error: upsertError } = await supabase.from('user_profiles').upsert({
                    id: user.id,
                    subscription_status: expectedTier
                }, { onConflict: 'id' });

                if (upsertError) {
                    console.error(`  ❌ Sync FAILED for ${email}: ${upsertError.message}`);
                } else {
                    synced++;
                }
            } else {
                synced++;
            }
        }
    }
    if (synced > 0) console.log(`  ✅ ${synced} user profiles updated`);
    else console.log('  ✅ All profiles are already in sync with target tiers');
}

// ============================================
// Main
// ============================================

async function main() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 Test User Registry Setup');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const MODE = process.env.MODE || 'e2e';
    const { newFreeCount: inputFree, newProCount: inputPro } = getNewUserCounts();

    console.log('Step 1: 📋 Initializing configuration...');
    const config = await getConfigCounts();

    // Determine final counts
    let finalFree = config.free;
    let finalPro = config.pro;
    const isOverride = inputFree > 0 || inputPro > 0;

    if (MODE === 'e2e') {
        console.log('  Mode: E2E (Single User Enforcement)');
        finalPro = inputPro > 0 ? 1 : 0;
        finalFree = finalPro === 1 ? 0 : 1;
        console.log(`  Adjusted counts: ${finalFree} free, ${finalPro} pro`);
    } else if (isOverride) {
        console.log('  Mode: Soak (Manual Override Applied)');
        finalFree = inputFree;
        finalPro = inputPro;
    } else {
        console.log('  Mode: Soak (Using Defaults)');
    }

    const totalRequested = finalFree + finalPro;
    if (totalRequested > config.max) {
        console.error(`\n❌ SAFETY LIMIT EXCEEDED: Requested ${totalRequested} users, but MAX_TOTAL_TEST_USERS is ${config.max}.`);
        console.error(`   To provision more users, please update MAX_TOTAL_TEST_USERS in tests/constants.ts.`);
        process.exit(1);
    }

    console.log(`  Target: ${finalFree} free, ${finalPro} pro (Total: ${totalRequested})`);

    console.log('\nStep 2: 📊 Registering existing users...');
    let existingUsers = await listExistingSoakUsers();
    await renameOldUser(existingUsers);
    existingUsers = await listExistingSoakUsers(false);
    console.log(`  Found ${existingUsers.length} soak users in database`);

    console.log('\nStep 3: 🔐 Synchronizing passwords...');
    let pwUpdated = 0;
    for (const user of existingUsers) {
        const success = await updateUserPassword(user.id, user.email);
        if (success) pwUpdated++;
    }
    console.log(`  ✅ ${pwUpdated}/${existingUsers.length} passwords synchronized`);

    console.log('\nStep 4: 👤 Provisioning missing slots...');
    const totalNeeded = finalFree + finalPro;
    const existingIndices = new Set(existingUsers.map(u => {
        const match = u.email.match(/soak-test(\d+)@/);
        return match ? parseInt(match[1], 10) : -1;
    }));

    let created = 0;
    for (let i = 0; i < totalNeeded; i++) {
        if (!existingIndices.has(i)) {
            const email = getEmailForIndex(i);
            const tier = i < finalFree ? 'free' : 'pro';
            console.log(`  [+] Provisioning User [${i}]: ${email} (${tier})...`);

            // Try to create
            const { data, error } = await supabase.auth.admin.createUser({
                email,
                password: SOAK_TEST_PASSWORD,
                email_confirm: true
            });

            if (error) {
                if (error.message.includes('already been registered')) {
                    console.log(`      User already exists, skipping creation.`);
                    created++; // Count as "available"
                } else {
                    console.error(`      ❌ Failed to create ${email}:`, error.message);
                }
            } else {
                console.log(`      ✅ Created ${data.user.id}`);
                created++;
            }
        }
    }
    if (created > 0) console.log(`  ✅ Successfully created ${created} users`);
    else console.log('  ✅ Registry coverage sufficient (no new users created)');

    console.log('\nStep 5: 🔄 Synchronizing subscription tiers...');
    const updatedUsers = await listExistingSoakUsers(false);
    await syncUserTiers(updatedUsers, finalFree, finalPro);

    console.log('\nStep 6: 🔑 Final Login Verification...');
    const finalUsers = await listExistingSoakUsers(false);
    const targetUsers = finalUsers.sort((a, b) => {
        const idxA = parseInt(a.email.match(/soak-test(\d+)@/)?.[1] || '-1', 10);
        const idxB = parseInt(b.email.match(/soak-test(\d+)@/)?.[1] || '-1', 10);
        return idxA - idxB;
    }).slice(0, finalFree + finalPro);

    let verified = 0;
    for (const user of targetUsers) {
        const result = await verifyLogin(user.email);
        if (result.success) {
            console.log(`  [OK] ${user.email.padEnd(25)} | Tier: ${user.tier.padEnd(5)} | Auth: Passed`);
            verified++;
        } else {
            console.error(`  [FAIL] ${user.email.padEnd(25)} | Tier: ${user.tier.padEnd(5)} | Auth: ${result.error}`);
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🎉 Setup Complete: ${verified}/${targetUsers.length} users verified`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (verified < targetUsers.length) process.exit(1);
}

main().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
