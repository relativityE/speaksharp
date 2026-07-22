#!/usr/bin/env node
/**
 * Canary account-ceiling HYGIENE — a SEPARATE step from provisioning + the product smoke, so an
 * admin-hygiene problem never masquerades as (or blocks) the tester-equivalent product result, and
 * `CANARY_ENFORCE=fail` can NEVER be silently converted into "healthy".
 *
 * TRUTHFUL enforcement: with CANARY_ENFORCE=fail, this step fails (exit 1) if the ceiling is exceeded
 * OR cannot be checked (admin error). Warn-only (default) never fails. Uses the admin/service-role
 * client only. No secrets/tokens/user records logged.
 */

import { createClient } from '@supabase/supabase-js';
import { enforceCeiling } from './lib/canaryProvision.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CANARY_MAX = Number(process.env.CANARY_MAX || '1');
const ENFORCE = (process.env.CANARY_ENFORCE || 'warn').toLowerCase() === 'fail';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  const msg = 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for the ceiling check';
  if (ENFORCE) { console.error(`❌ ${msg} (CANARY_ENFORCE=fail).`); process.exit(1); }
  console.warn(`⚠️  ${msg} — warn-only; skipping.`); process.exit(0);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

console.log('🧹 Canary account-ceiling hygiene');
const res = await enforceCeiling(admin, { max: CANARY_MAX, enforce: ENFORCE });

if (res.status === 'ok') { console.log(`  [OK] ${res.count}/${res.max} canary-like accounts.`); process.exit(0); }
if (res.status === 'warn') { console.warn(`  ⚠️  ceiling exceeded (${res.count} > ${res.max}) — warn-only; set CANARY_ENFORCE=fail to make it hard.`); process.exit(0); }
if (res.status === 'exceeded') { console.error(`  ❌ ceiling exceeded: ${res.count} > ${res.max} (CANARY_ENFORCE=fail). Delete stray canary-* accounts.`); process.exit(1); }
// skipped (admin error): with enforce=fail this MUST fail — an unverifiable ceiling is not "green".
if (ENFORCE) { console.error(`  ❌ ceiling could NOT be checked (admin ${res.reason ?? 'error'}) and CANARY_ENFORCE=fail — failing (hygiene unverified).`); process.exit(1); }
console.warn(`  ⚠️  ceiling check skipped (admin ${res.reason ?? 'error'}) — warn-only.`); process.exit(0);
