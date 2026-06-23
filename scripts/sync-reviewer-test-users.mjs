#!/usr/bin/env node
/**
 * Write-mode reviewer test-user synchronizer.
 *
 * This is intentionally separate from verify-test-users.mjs so the RC gate
 * remains read-only. Use this only from the Test User Admin workflow.
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

function maskEmail(email) {
  const [local = '', domain = ''] = email.split('@');
  const safeLocal = local.length <= 2 ? `${local[0] || '*'}*` : `${local[0]}***${local.at(-1)}`;
  return domain ? `${safeLocal}@${domain}` : safeLocal;
}

function syntheticSubscriptionId(email) {
  const stableEmailSlug = email.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `sub_test_${stableEmailSlug || 'user'}`;
}

function profilePatchForTier(tier, email) {
  const paidSubscriptionId = tier === 'pro' ? syntheticSubscriptionId(email) : null;
  return {
    subscription_status: tier,
    stripe_subscription_id: paidSubscriptionId,
    updated_at: new Date().toISOString(),
  };
}

function configuredCandidates() {
  const candidates = [];

  const free = firstEnv(['FREE_TEST_EMAIL', 'E2E_FREE_EMAIL', 'BASIC_TEST_EMAIL', 'E2E_BASIC_EMAIL']);
  if (free) {
    candidates.push({
      label: 'free reviewer',
      email: free.value,
      tier: 'free',
      source: free.name,
    });
  }

  const pro = firstEnv(['PRO_TEST_EMAIL', 'E2E_PRO_EMAIL']);
  if (pro) {
    candidates.push({
      label: 'pro reviewer',
      email: pro.value,
      tier: 'pro',
      source: pro.name,
    });
  }

  return candidates;
}

async function listAllAuthUsers(supabase) {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);

    const pageUsers = data?.users || [];
    users.push(...pageUsers);
    if (pageUsers.length < 100) return users;
    page += 1;
  }
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('FAIL reviewer sync config: missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const candidates = configuredCandidates();
  if (candidates.length === 0) {
    console.error('FAIL reviewer sync config: no reviewer email env vars configured');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const authUsers = await listAllAuthUsers(supabase);
  const authByEmail = new Map(
    authUsers
      .filter((user) => user.email)
      .map((user) => [user.email.toLowerCase(), user])
  );

  console.log('Reviewer test-user profile sync');

  let failed = false;
  for (const candidate of candidates) {
    const authUser = authByEmail.get(candidate.email.toLowerCase());
    if (!authUser) {
      console.error(`FAIL ${candidate.label}: auth user missing (${candidate.source}=${maskEmail(candidate.email)})`);
      failed = true;
      continue;
    }

    const patch = profilePatchForTier(candidate.tier, candidate.email);
    const { error } = await supabase
      .from('user_profiles')
      .upsert({ id: authUser.id, ...patch }, { onConflict: 'id' });

    if (error) {
      console.error(`FAIL ${candidate.label}: profile sync failed (${error.message})`);
      failed = true;
      continue;
    }

    console.log(`PASS ${candidate.label}: auth user exists, profile row synced, status=${candidate.tier}`);
  }

  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(`FAIL reviewer sync runtime: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
