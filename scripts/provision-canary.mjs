#!/usr/bin/env node
/**
 * Canary user provisioning — SIGN-IN-FIRST health entry (account ceiling is a SEPARATE hygiene step).
 *
 * Evidence-based note (not overstated): a same-key/project read-only control (Test User Admin `query`)
 * PASSED admin.listUsers while the canary FAILED — so the credential/Auth-admin path was NOT globally
 * invalid. The exact transient mechanism of the canary's invalid-JWT is UNPROVEN. Sign-in-first removes
 * unnecessary admin dependency from the healthy path; no credential is rotated or replaced.
 *
 * Orchestration/classification live in scripts/lib/canaryProvision.mjs (unit-tested). Health only here:
 * anon sign-in (bounded retry on transient) + fail-closed Free-tier check + admin recovery (existence-
 * first). No account ceiling here — see scripts/canary-ceiling.mjs. No secrets/tokens/user records logged.
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
console.log('🐤 Canary provisioning (sign-in-first health)');
console.log(`Target: ${CANARY_EMAIL}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const result = await provisionCanary({ anon, admin, config: { email: CANARY_EMAIL, password: CANARY_PASSWORD } });

if (result.status === 'healthy' || result.status === 'recovered') {
  console.log(`  [OK] ${result.status === 'recovered' ? 'Recovered and re-verified' : 'Signed in'}; tier=${result.tier}.`);
  console.log('✅ Canary account healthy.');
  process.exit(0);
}
if (result.status === 'tier_error') {
  console.error(`  ❌ Free-tier verification failed: ${result.message}. The canary must resolve to exactly the Free state.`);
  process.exit(1);
}
if (result.status === 'config_error' && result.scope === 'service_role_key') {
  console.error('  ❌ A recovery-path service-role admin call was rejected on auth (invalid-JWT / 401 / 403) — NOT retried.');
  console.error('     The healthy path avoids admin; this only affects recovery. Run the same-key control (Test User Admin `query`)');
  console.error('     concurrently: if it also fails, investigate project/secret scope; otherwise the failure was intermittent.');
  process.exit(1);
}
if (result.status === 'config_error') {
  console.error(`  ❌ Configuration failure (${result.scope ?? 'unknown'}): ${result.message ?? ''}`);
  process.exit(1);
}
console.error(`  ❌ Canary provisioning failed: ${result.message ?? 'unknown'}${result.status_code ? ` [${result.status_code}]` : ''}`);
process.exit(1);
