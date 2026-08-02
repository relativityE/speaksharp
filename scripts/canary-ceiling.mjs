#!/usr/bin/env node
/**
 * Canary account-ceiling HYGIENE — a SEPARATE step from provisioning + the product smoke, so an
 * admin-hygiene problem never masquerades as (or blocks) the tester-equivalent product result, and
 * `CANARY_ENFORCE=fail` can NEVER be silently converted into "healthy".
 *
 * TRUTHFUL enforcement: with CANARY_ENFORCE=fail, this step fails (exit 1) if the ceiling is exceeded
 * OR cannot be checked (admin error). Warn-only (default) never fails. Uses the admin/service-role
 * client only. No secrets/tokens/user records logged.
 *
 * #1148 — CANONICAL INJECTED-IDENTITY ENV INVENTORY (names only; values live in GitHub, never in the repo).
 * The domain purge replaced all hard-coded third-party-domain identities with INJECTED configuration:
 *   • CANARY_EMAIL            — defined: `vars.CANARY_EMAIL` (GitHub repo variable);
 *                               consumed: .github/workflows/canary.yml (provision + smoke steps) →
 *                               scripts/provision-canary.mjs (process.env.CANARY_EMAIL). One maintained canary.
 *   • CANARY_CEILING_EXCLUDE  — defined: `vars.CANARY_CEILING_EXCLUDE` (comma-separated exact emails);
 *                               consumed: .github/workflows/canary.yml (ceiling step) → this file →
 *                               enforceCeiling({ exclude }). Exact-identity exclusion of #1146-deferred legacy
 *                               accounts; never a domain wildcard.
 *   • LIVE_TEST_EMAIL_DOMAIN  — defined: `vars.LIVE_TEST_EMAIL_DOMAIN` (reserved example.com fallback);
 *                               consumed: tests/live/*.live.spec.ts + scripts/manual-stt-corpus-proof.mjs.
 * No third-party domain appears in the repository; the zero-reference scanner enforces this on every push.
 */

import { createClient } from '@supabase/supabase-js';
import { enforceCeiling } from './lib/canaryProvision.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CANARY_MAX = Number(process.env.CANARY_MAX || '1');
const ENFORCE = (process.env.CANARY_ENFORCE || 'warn').toLowerCase() === 'fail';
// #1148 P1: EXACT, injected legacy-canary exclusions (comma-separated emails) explicitly deferred to the
// authorized #1146 cleanup. These are NOT counted against CANARY_MAX (they would otherwise fail the ceiling
// every run), but they ARE reported as sanitation debt. Bounded by exact identity — never a domain wildcard.
const CANARY_CEILING_EXCLUDE = (process.env.CANARY_CEILING_EXCLUDE || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  const msg = 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for the ceiling check';
  if (ENFORCE) { console.error(`❌ ${msg} (CANARY_ENFORCE=fail).`); process.exit(1); }
  console.warn(`⚠️  ${msg} — warn-only; skipping.`); process.exit(0);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

console.log('🧹 Canary account-ceiling hygiene');
const res = await enforceCeiling(admin, { max: CANARY_MAX, enforce: ENFORCE, exclude: CANARY_CEILING_EXCLUDE });

if (res.deferred?.length) console.log(`  (deferred #1146 legacy debt, not counted: ${res.deferred.length} account(s))`);
if (res.status === 'ok') { console.log(`  [OK] ${res.count}/${res.max} canary-like accounts.`); process.exit(0); }
if (res.status === 'warn') { console.warn(`  ⚠️  ceiling exceeded (${res.count} > ${res.max}) — warn-only; set CANARY_ENFORCE=fail to make it hard.`); process.exit(0); }
if (res.status === 'exceeded') { console.error(`  ❌ ceiling exceeded: ${res.count} > ${res.max} (CANARY_ENFORCE=fail). Delete stray canary-* accounts.`); process.exit(1); }
// skipped (admin error): with enforce=fail this MUST fail — an unverifiable ceiling is not "green".
if (ENFORCE) { console.error(`  ❌ ceiling could NOT be checked (admin ${res.reason ?? 'error'}) and CANARY_ENFORCE=fail — failing (hygiene unverified).`); process.exit(1); }
console.warn(`  ⚠️  ceiling check skipped (admin ${res.reason ?? 'error'}) — warn-only.`); process.exit(0);
