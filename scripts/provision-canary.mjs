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

const ceilingMax = Number(process.env.CANARY_MAX || '1');
const ceilingEnforce = (process.env.CANARY_ENFORCE || 'warn').toLowerCase() === 'fail';

const result = await provisionCanary({ anon, admin, config: { email: CANARY_EMAIL, password: CANARY_PASSWORD, ceilingMax, ceilingEnforce } });

const ceilingNote = result.ceiling ? ` (ceiling: ${result.ceiling}${typeof result.ceilingCount === 'number' ? ` ${result.ceilingCount}/${ceilingMax}` : ''})` : '';

if (result.status === 'healthy') {
  console.log(`  [OK] Signed in (uid ${result.userId}); tier=${result.tier ?? 'unknown'}.${ceilingNote}`);
  console.log('✅ Canary account healthy — no admin provisioning needed.');
  process.exit(0);
}
if (result.status === 'recovered') {
  console.log(`  [OK] Account recovered and re-verified (uid ${result.userId}); tier=${result.tier ?? 'unknown'}.${ceilingNote}`);
  console.log('✅ Canary account recovered.');
  process.exit(0);
}
if (result.status === 'ceiling_exceeded') {
  console.error(`  ❌ Canary account ceiling exceeded: ${result.count} > ${result.max} (CANARY_ENFORCE=fail). Delete stray canary-* accounts.`);
  process.exit(1);
}
if (result.status === 'config_error' && result.scope === 'service_role_key') {
  console.error('  ❌ Service-role admin call was rejected on auth (invalid-JWT / 401 / 403) — NOT retried.');
  console.error('     The healthy sign-in path avoids admin; this only affects the recovery path. If a same-key control');
  console.error('     (Test User Admin `query`) also fails at the same time, verify SUPABASE_SERVICE_ROLE_KEY; otherwise it is intermittent.');
  process.exit(1);
}
if (result.status === 'config_error') {
  console.error(`  ❌ Configuration failure (${result.scope ?? 'unknown'}): ${result.message ?? ''}`);
  process.exit(1);
}
console.error(`  ❌ Canary provisioning failed: ${result.message ?? 'unknown'}${result.status_code ? ` [${result.status_code}]` : ''}`);
process.exit(1);
