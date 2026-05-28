#!/usr/bin/env node
/**
 * Read-only live test-user verifier.
 *
 * Confirms configured reviewer/test accounts have both:
 * - a Supabase auth user
 * - a public.user_profiles row with the expected subscription_status
 *
 * This script intentionally performs no writes.
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

function normalizeTier(value, fallback = 'free') {
  const tier = String(value || fallback).trim().toLowerCase();
  if (tier === 'basic') return 'basic';
  if (tier === 'pro') return 'pro';
  return 'free';
}

function maskEmail(email) {
  const [local = '', domain = ''] = email.split('@');
  const safeLocal = local.length <= 2 ? `${local[0] || '*'}*` : `${local[0]}***${local.at(-1)}`;
  return domain ? `${safeLocal}@${domain}` : safeLocal;
}

function addCandidate(candidates, { label, email, expectedTier, source }) {
  if (!email) return;
  const normalizedEmail = email.toLowerCase();
  if (candidates.some((candidate) => candidate.email.toLowerCase() === normalizedEmail)) {
    return;
  }
  candidates.push({
    label,
    email,
    expectedTier: normalizeTier(expectedTier),
    source,
  });
}

function configuredCandidates() {
  const candidates = [];

  const free = firstEnv(['FREE_TEST_EMAIL', 'E2E_FREE_EMAIL', 'BASIC_TEST_EMAIL', 'E2E_BASIC_EMAIL']);
  if (free) {
    addCandidate(candidates, {
      label: 'free reviewer',
      email: free.value,
      expectedTier: 'free',
      source: free.name,
    });
  }

  const pro = firstEnv(['PRO_TEST_EMAIL', 'E2E_PRO_EMAIL']);
  if (pro) {
    addCandidate(candidates, {
      label: 'pro reviewer',
      email: pro.value,
      expectedTier: 'pro',
      source: pro.name,
    });
  }

  const created = firstEnv(['CREATE_USER_EMAIL']);
  if (created) {
    addCandidate(candidates, {
      label: 'created test user',
      email: created.value,
      expectedTier: process.env.CREATE_USER_TIER || 'free',
      source: created.name,
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

function statusLine(status, result) {
  const prefix = status === 'PASS' ? 'PASS' : 'FAIL';
  const details = [
    `auth user ${result.authUserExists ? 'exists' : 'missing'}`,
    result.profileRowExists ? 'profile row exists' : 'profile row missing',
  ];

  if (result.subscriptionStatus) {
    details.push(`status=${result.subscriptionStatus}`);
  }

  if (result.expectedTier && result.subscriptionStatus && result.subscriptionStatus !== result.expectedTier) {
    details.push(`expected=${result.expectedTier}`);
  }

  return `${prefix} ${result.label}: ${details.join(', ')}`;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('FAIL verifier config: missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const candidates = configuredCandidates();
  if (candidates.length === 0) {
    console.error('FAIL verifier config: no test-user email env vars configured');
    console.error('Set FREE_TEST_EMAIL/E2E_FREE_EMAIL/BASIC_TEST_EMAIL or PRO_TEST_EMAIL/E2E_PRO_EMAIL.');
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

  const foundAuthUsers = candidates
    .map((candidate) => authByEmail.get(candidate.email.toLowerCase()))
    .filter(Boolean);

  const profileById = new Map();
  if (foundAuthUsers.length > 0) {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, subscription_status')
      .in('id', foundAuthUsers.map((user) => user.id));

    if (error) throw new Error(`Failed to query user_profiles: ${error.message}`);
    for (const profile of data || []) {
      profileById.set(profile.id, profile);
    }
  }

  const results = candidates.map((candidate) => {
    const authUser = authByEmail.get(candidate.email.toLowerCase());
    const profile = authUser ? profileById.get(authUser.id) : null;
    const subscriptionStatus = profile?.subscription_status || null;
    const pass = Boolean(authUser && profile && subscriptionStatus === candidate.expectedTier);

    return {
      label: candidate.label,
      source: candidate.source,
      email: maskEmail(candidate.email),
      expectedTier: candidate.expectedTier,
      authUserExists: Boolean(authUser),
      profileRowExists: Boolean(profile),
      subscriptionStatus,
      pass,
    };
  });

  console.log('Test user profile verification');
  for (const result of results) {
    console.log(statusLine(result.pass ? 'PASS' : 'FAIL', result));
  }

  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));

  if (results.some((result) => !result.pass)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`FAIL verifier runtime: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
