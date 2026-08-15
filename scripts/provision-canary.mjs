#!/usr/bin/env node
/**
 * Canary health — READ-ONLY. The canary AUTHENTICATES via the PUBLIC anon flow and VERIFIES server-
 * authoritative profile binding for its lane. It NEVER creates an account, resets a password, grants or
 * extends a trial, or repairs entitlement: any sign-in or verification failure FAILS CLOSED. It uses NO
 * service-role key. Account creation/reuse is a separate, explicitly-authorized Admin - Test Users
 * operation; the account ceiling is a separate hygiene step (scripts/canary-ceiling.mjs). No
 * secrets/tokens/user records are logged.
 */

import { createClient } from '@supabase/supabase-js';
import { provisionCanary } from './lib/canaryProvision.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const CANARY_EMAIL = process.env.CANARY_EMAIL;
const CANARY_LANE_PASSWORD = process.env.CANARY_LANE_PASSWORD;
const CANARY_EXPECTED_ACCESS = process.env.CANARY_EXPECTED_ACCESS;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !CANARY_EMAIL || !CANARY_LANE_PASSWORD ||
    !['active-trial', 'paid-continuation'].includes(CANARY_EXPECTED_ACCESS)) {
  console.error('❌ Missing/invalid canary configuration.');
  process.exit(1);
}

// PUBLIC anon client ONLY. The canary path has no service-role client and cannot mutate any account.
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🐤 Canary health (READ-ONLY — no account mutation)');
console.log(`Lane: ${CANARY_EXPECTED_ACCESS}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const result = await provisionCanary({
  anon,
  config: { email: CANARY_EMAIL, password: CANARY_LANE_PASSWORD, lane: CANARY_EXPECTED_ACCESS },
});

if (result.status === 'healthy') {
  console.log(`  [OK] Signed in; lane=${result.lane}; local_profile_binding=true.`);
  console.log('✅ Canary account locally healthy; the browser journey must still prove server-authoritative access.');
  process.exit(0);
}
if (result.status === 'entitlement_error') {
  console.error(`  ❌ Canary local profile-binding verification failed: ${result.message}.`);
  console.error('     CI never grants, resets, or extends entitlement/trial. Fix the account via a separately authorized Admin/Stripe operation.');
  process.exit(1);
}
console.error(`  ❌ Canary sign-in/verification FAILED CLOSED (${result.scope ?? result.status}): ${result.message ?? ''}${result.status_code ? ` [${result.status_code}]` : ''}`);
console.error('     The canary is read-only — no account was created, no password was reset, no trial was changed.');
process.exit(1);
