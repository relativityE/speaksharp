#!/usr/bin/env node
/**
 * Canary user provisioning — SIGN-IN-FIRST entry point.
 *
 * The healthy path signs in as the stable canary account via the PUBLIC ANON flow and verifies its own
 * profile — touching NO admin/service-role API. That means a rotated/stale service-role key can no
 * longer fail the canary when the account is healthy (the app's anon key is the one users authenticate
 * with, and it is current). Service-role is used ONLY to recover a genuinely-missing account, and an
 * invalid-JWT / 401 / 403 there is reported as an immediate, actionable "rotate the key" config failure.
 *
 * Orchestration/classification live in scripts/lib/canaryProvision.mjs (unit-tested). This file only
 * wires env → clients → result → exit code. No credentials/tokens/user records are ever logged.
 */

import { createClient } from '@supabase/supabase-js';
import { provisionCanary } from './lib/canaryProvision.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // optional — recovery path only
const CANARY_EMAIL = process.env.CANARY_EMAIL;
const CANARY_PASSWORD = process.env.CANARY_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !CANARY_EMAIL || !CANARY_PASSWORD) {
  console.error('❌ Missing required env: SUPABASE_URL, SUPABASE_ANON_KEY, CANARY_EMAIL, CANARY_PASSWORD');
  process.exit(1);
}

const clientOpts = { auth: { autoRefreshToken: false, persistSession: false } };
const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, clientOpts);
const admin = SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts) : null;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🐤 Canary provisioning (sign-in-first)');
console.log(`Target: ${CANARY_EMAIL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const result = await provisionCanary({ anon, admin, config: { email: CANARY_EMAIL, password: CANARY_PASSWORD } });

if (result.status === 'healthy') {
  console.log(`  [OK] Signed in (uid ${result.userId}); tier=${result.tier ?? 'unknown'}.`);
  console.log('✅ Canary account healthy — no admin provisioning needed.');
  process.exit(0);
}
if (result.status === 'recovered') {
  console.log(`  [OK] Account recovered and re-verified (uid ${result.userId}).`);
  console.log('✅ Canary account recovered.');
  process.exit(0);
}
if (result.status === 'config_error' && result.scope === 'service_role_key') {
  console.error('  ❌ CONFIGURATION FAILURE (not retryable): the SUPABASE_SERVICE_ROLE_KEY is invalid/stale for this project (JWT rejected).');
  console.error('     ACTION: rotate the GitHub secret `SUPABASE_SERVICE_ROLE_KEY` to the current service-role key from the Supabase dashboard.');
  process.exit(1);
}
if (result.status === 'config_error' && result.scope === 'canary_credentials') {
  console.error('  ❌ CONFIGURATION FAILURE (not retryable): canary sign-in was rejected on auth.');
  console.error('     ACTION: verify the CANARY_EMAIL / CANARY_PASSWORD secrets.');
  process.exit(1);
}
console.error(`  ❌ Canary provisioning failed: ${result.message ?? 'unknown'}${result.status_code ? ` [${result.status_code}]` : ''}`);
process.exit(1);
