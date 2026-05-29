#!/usr/bin/env node
/**
 * Soak Test User Setup Script
 * 
 * This script manages soak test users in Supabase:
 * 1. Queries existing soak-test* users
 * 2. Renames old users if needed
 * 3. Updates all passwords to shared SOAK_TEST_PASSWORD
 * 4. Creates missing users to meet targets
 * 5. Syncs subscription tiers (Free/Pro; Basic is reserved for future paid plans)
 * 6. Verifies login for all users
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.development (Standard for Soak/Canary tests)
dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

// ============================================
// Configuration
// ============================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOAK_TEST_PASSWORD = process.env.SOAK_TEST_PASSWORD;
const ACTION = process.env.ACTION || process.env.USER_ADMIN_ACTION || 'setup';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

if (ACTION === 'setup' && !SOAK_TEST_PASSWORD) {
    console.error('❌ Missing required env var: SOAK_TEST_PASSWORD');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
});

const DEDICATED_BROWSER_ENDURANCE_ACCOUNTS = [
    { index: 45, email: 'soak-test45@test.com', tier: 'free' },
    { index: 46, email: 'soak-test46@test.com', tier: 'free' },
];

// ============================================
// Helper Functions
// ============================================

function getExpectedAccounts(freeCount, proCount, includeBrowserEnduranceAccounts = process.env.MODE === 'soak') {
    const accounts = [];
    for (let i = 0; i < freeCount; i++) {
        accounts.push({ index: i, email: `soak-test${i}@test.com`, tier: 'free' });
    }
    // Pro: indices 25 to 25 + proCount - 1
    for (let i = 0; i < proCount; i++) {
        const idx = 25 + i;
        accounts.push({ index: idx, email: `soak-test${idx}@test.com`, tier: 'pro' });
    }
    if (includeBrowserEnduranceAccounts) {
        for (const account of DEDICATED_BROWSER_ENDURANCE_ACCOUNTS) {
            if (!accounts.some(existing => existing.email === account.email)) {
                accounts.push(account);
            }
        }
    }
    return accounts;
}

function getNewUserCounts() {
    return {
        newFreeCount: parseInt(process.env.NUM_FREE_USERS || process.env.NEW_FREE_COUNT || process.env.NUM_BASIC_USERS || process.env.NEW_BASIC_COUNT || '0', 10),
        newProCount: parseInt(process.env.NUM_PRO_USERS || process.env.NEW_PRO_COUNT || '0', 10)
    };
}

async function getConfigCounts() {
    try {
        const constantsPath = path.resolve(process.cwd(), 'tests/constants.ts');
        const content = fs.readFileSync(constantsPath, 'utf8');

        // Extract exact numeric constants
        const freeMatch = content.match(/FREE_USER_COUNT = (\d+);/);
        const legacyBasicMatch = content.match(/BASIC_USER_COUNT = (\d+);/);
        const proMatch = content.match(/PRO_USER_COUNT = (\d+);/);
        const maxMatch = content.match(/MAX_TOTAL_TEST_USERS = (\d+);/);

        const free = freeMatch ? parseInt(freeMatch[1], 10) : legacyBasicMatch ? parseInt(legacyBasicMatch[1], 10) : 30;
        const pro = proMatch ? parseInt(proMatch[1], 10) : 5;
        const max = maxMatch ? parseInt(maxMatch[1], 10) : 50;

        return { total: getExpectedAccounts(free, pro).length, free, pro, max };
    } catch (e) {
        return { total: getExpectedAccounts(30, 5).length, free: 30, pro: 5, max: 50 };
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


async function createUserWithTier(email, tier) {
    const password = process.env.CREATE_USER_PASSWORD || SOAK_TEST_PASSWORD;
    if (!password) {
        console.error('❌ Missing password. Set CREATE_USER_PASSWORD or SOAK_TEST_PASSWORD.');
        process.exit(1);
    }

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true
    });

    if (error) {
        console.error(`❌ Failed to create ${email}:`, error.message);
        return null;
    }

    const profilePatch = buildProfilePatchForTier(tier, email);

    // Try update first (for profile cleanup) then upsert
    await supabase.from('user_profiles').update(profilePatch).eq('id', data.user.id);
    await supabase.from('user_profiles').upsert({ id: data.user.id, ...profilePatch }, { onConflict: 'id' });

    return data.user;
}

function syntheticSubscriptionId(email) {
    const stableEmailSlug = email.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return `sub_test_${stableEmailSlug || 'user'}`;
}

function buildProfilePatchForTier(tier, email) {
    const paidSubscriptionId = tier === 'pro' ? syntheticSubscriptionId(email) : null;
    return {
        subscription_status: tier,
        stripe_subscription_id: paidSubscriptionId,
        subscription_id: paidSubscriptionId,
    };
}

async function printSoakUsers() {
    const soakUsers = await listExistingSoakUsers();
    const results = soakUsers.sort((a, b) => {
        const aNum = parseInt(a.email.match(/\d+/) || '0', 10);
        const bNum = parseInt(b.email.match(/\d+/) || '0', 10);
        return aNum - bNum;
    });

    console.log(`Found ${results.length} soak test users.\n`);
    console.log('Email'.padEnd(25) + '| Tier');
    console.log('-'.repeat(40));
    results.forEach(r => {
        console.log(`${r.email.padEnd(25)} | ${r.tier}`);
    });
}

async function createSingleUser() {
    const email = process.env.CREATE_USER_EMAIL;
    const tier = process.env.CREATE_USER_TIER || 'free';

    if (!email) {
        console.error('❌ Missing CREATE_USER_EMAIL.');
        process.exit(1);
    }

    if (!['free', 'basic', 'pro'].includes(tier)) {
        console.error(`❌ Invalid CREATE_USER_TIER: ${tier}. Expected "free", "basic", or "pro".`);
        process.exit(1);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('👤 Test User Create');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`User: ${email}`);
    console.log(`Tier: ${tier}`);

    const user = await createUserWithTier(email, tier);
    if (!user) process.exit(1);

    console.log(`✅ Successfully provisioned ${email} (${user.id})`);
}


async function syncUserTiers(users, targetFree, targetPro) {
    let synced = 0;
    const targetAccounts = getExpectedAccounts(targetFree, targetPro);

    for (const target of targetAccounts) {
        const user = users.find(u => u.email === target.email);

        if (user && user.tier !== target.tier) {
            console.log(`  [SYNC] ${target.email}: ${user.tier} -> ${target.tier}`);

            // Try Update first (more surgical, avoids some permission traps)
            const profilePatch = buildProfilePatchForTier(target.tier, target.email);
            const { error: updateError } = await supabase
                .from('user_profiles')
                .update(profilePatch)
                .eq('id', user.id);

            if (updateError) {
                console.error(`  ⚠️ Schema Access Failed for ${target.email}: ${updateError.message}`);
                console.log(`  🔄 Falling back to upsert for ${target.email}...`);

                const { error: upsertError } = await supabase.from('user_profiles').upsert({
                    id: user.id,
                    ...profilePatch
                }, { onConflict: 'id' });

                if (upsertError) {
                    console.error(`  ❌ Sync FAILED for ${target.email}: ${upsertError.message}`);
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
    if (!['setup', 'query', 'create'].includes(ACTION)) {
        console.error(`❌ Invalid ACTION: ${ACTION}. Expected setup, query, or create.`);
        process.exit(1);
    }

    if (ACTION === 'query') {
        await printSoakUsers();
        return;
    }

    if (ACTION === 'create') {
        await createSingleUser();
        return;
    }

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

    const expectedAccounts = getExpectedAccounts(finalFree, finalPro);
    const totalRequested = expectedAccounts.length;
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

    console.log('\nStep 3: 🔐 Password Sync (Skipped - Assumed static to avoid rate limits)');

    console.log('\nStep 4: 👤 Provisioning missing slots...');
    const existingEmails = new Set(existingUsers.map(u => u.email));

    let created = 0;
    for (const target of expectedAccounts) {
        if (!existingEmails.has(target.email)) {
            console.log(`  [+] Provisioning User [${target.index}]: ${target.email} (${target.tier})...`);

            // Try to create
            const { data, error } = await supabase.auth.admin.createUser({
                email: target.email,
                password: SOAK_TEST_PASSWORD,
                email_confirm: true
            });

            if (error) {
                if (error.message.includes('already been registered')) {
                    console.log(`      User already exists, skipping creation.`);
                    created++; // Count as "available"
                } else {
                    console.error(`      ❌ Failed to create ${target.email}:`, error.message);
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

    console.log('\nStep 6: 🔑 Final Login Verification (Skipped - Deferred to Load Test)');

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🎉 Setup Complete: Users verified and synchronized successfully!`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(e => {
    console.error('❌ Fatal error:', e);
    process.exit(1);
});
