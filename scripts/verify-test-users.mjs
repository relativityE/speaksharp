#!/usr/bin/env node
/**
 * Read-only live test-user verifier.
 *
 * VERIFY_TARGET=reviewers (default): confirms configured reviewer/test accounts have both
 * - a Supabase auth user
 * - a public.user_profiles row with the expected subscription_status
 * and reports each found account's completed-session count (a head-only count; no session row is read). The count is
 * reported, not a PASS condition: a returning-user journey (#1593 case 15) needs verified history before it runs.
 *
 * VERIFY_TARGET=canaries: strictly read-only canary identity inspection (scripts/lib/canaryReadOnlyVerify.mjs).
 * It never authenticates as a canary, so credential viability is not tested.
 *
 * VERIFY_TARGET=live-journey-accounts: the Cloud test live run's two REQUIRED accounts, by role only, from the private
 * CLOUD_TEST_LIVE_ACCOUNTS bundle (existing-disposable and maintained-read-only, both expected Free; Secret-only transport, masked
 * before any output). It reports per role whether the auth user exists, whether its profile carries the expected tier and whether the
 * account's id equals the bundle's accountId; a role passes only when all three hold.
 * It never prints or returns an email (masked or not), an id, a count or a raw error; it never signs in, so password viability is untested.
 *
 * This script intentionally performs no writes.
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { formatCanaryLine, runCanaryInspection } from './lib/canaryReadOnlyVerify.mjs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERIFY_TARGET = (process.env.VERIFY_TARGET || 'reviewers').trim();

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

function normalizeTier(value, fallback = 'free') {
  const tier = String(value || fallback).trim().toLowerCase();
  if (tier === 'pro') return 'pro';
  return 'free'; // SpeakSharp has no Basic product — only free/pro
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

  const free = firstEnv(['FREE_TEST_EMAIL', 'E2E_FREE_EMAIL']);
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

/**
 * The account's completed-session count, read-only: a head-only exact count, so no session row or content is returned.
 * null when the count cannot be verified (query error or a non-count answer) — never a 0 that reads as "no history".
 */
export async function completedSessionCount(supabase, userId) {
  const { count, error } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'completed');
  return !error && Number.isInteger(count) && count >= 0 ? count : null;
}

export const LIVE_JOURNEY_ROLES = Object.freeze([
  { role: 'existing-disposable', expectedTier: 'free' },
  { role: 'maintained-read-only', expectedTier: 'free' },
]);
export const LIVE_ACCOUNTS_BUNDLE_LIMIT = 4096;
const CONTROL = /[\u0000-\u001f\u007f]/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+$/;

/**
 * The private CLOUD_TEST_LIVE_ACCOUNTS bundle (Sam 1793544453.003099), validated exactly as tools/cloud-test/scripts/init_run_inputs.py
 * does, in the same order and with the same codes (shared vectors in both test suites):
 *   {"version":1,"projectRef":"<20 lower-case alphanumerics>","accounts":{"existing-disposable":{"email","accountId"},
 *    "maintained-read-only":{"email","accountId"}}}
 * Configuration only: any other key (a password, a token) is refused. Errors are fixed codes and never quote the bundle.
 */
export function parseLiveAccountsBundle(raw) {
  const fail = (code) => { throw new Error(`LIVE_JOURNEY_ACCOUNTS_CONFIG: ${code}`); };
  if (typeof raw !== 'string' || !raw.trim()) fail('bundle-missing');
  if (Buffer.byteLength(raw, 'utf8') > LIVE_ACCOUNTS_BUNDLE_LIMIT) fail('bundle-too-large');
  let doc;
  try { doc = JSON.parse(raw); } catch { fail('bundle-not-json'); }
  const exact = (o, keys) => Boolean(o) && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).sort().join('\n') === [...keys].sort().join('\n');
  const roles = LIVE_JOURNEY_ROLES.map((r) => r.role);
  if (!exact(doc, ['version', 'projectRef', 'accounts']) || doc.version !== 1 || !exact(doc.accounts, roles)) fail('bundle-shape');
  for (const role of roles) if (!exact(doc.accounts[role], ['email', 'accountId'])) fail('bundle-shape');
  if (typeof doc.projectRef !== 'string' || !PROJECT_REF.test(doc.projectRef)) fail('bundle-project');
  for (const role of roles) {
    const { email } = doc.accounts[role];
    if (typeof email !== 'string' || email.length > 254 || CONTROL.test(email) || email !== email.trim() || !EMAIL_SHAPE.test(email)) fail('bundle-email');
  }
  for (const role of roles) if (typeof doc.accounts[role].accountId !== 'string' || !UUID_V4.test(doc.accounts[role].accountId)) fail('bundle-account-id');
  const [a, b] = roles.map((role) => doc.accounts[role]);
  if (a.email.toLowerCase() === b.email.toLowerCase() || a.accountId === b.accountId) fail('bundle-duplicate');
  return { projectRef: doc.projectRef, accounts: Object.fromEntries(roles.map((role) => [role, { email: doc.accounts[role].email, accountId: doc.accounts[role].accountId }])) };
}

/**
 * Every value to mask before any other output: the whole raw bundle (even when it is not valid JSON) and, when it parses, each email
 * (as given and lower-cased) and account id.
 */
export function liveJourneyMaskValues(raw) {
  const values = [raw];
  try {
    for (const { email, accountId } of Object.values(parseLiveAccountsBundle(raw).accounts)) values.push(email, email.toLowerCase(), accountId);
  } catch { /* the raw bundle alone is masked; the parse error is reported later as a fixed code */ }
  return values;
}

/**
 * GitHub workflow-command lines that mask each value. Command data is escaped (% -> %25, CR -> %0D, LF -> %0A) so an embedded line break
 * cannot end the command and print the rest of the value; a multi-line value is also masked line by line, because the log is masked per
 * line. Every returned string is exactly one line.
 */
export function maskCommands(values) {
  const escape = (v) => v.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const out = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    out.add(`::add-mask::${escape(value)}`);
    for (const line of value.split(/\r\n|\r|\n/)) if (line.trim() && line !== value) out.add(`::add-mask::${escape(line)}`);
  }
  return [...out];
}

/**
 * Role-only verification of the live run's two required accounts from the private bundle. Read-only: the existing auth-user listing and
 * one user_profiles select. The bundle's project must be the SUPABASE_URL project. Any read failure becomes one fixed code, so no SDK
 * message can carry an email or id. Returns { target, results, allPass } and nothing else: per role { role, authUserExists, tierMatches,
 * idMatches, pass }, where idMatches compares the found account's id with the bundle's accountId and pass needs all three.
 */
export async function verifyLiveJourneyAccounts({ supabase, raw, supabaseUrl, listUsers = listAllAuthUsers }) {
  const bundle = parseLiveAccountsBundle(raw);
  let project = '';
  try { project = new URL(supabaseUrl).hostname.split('.')[0]; } catch { /* refused below */ }
  if (bundle.projectRef !== project) throw new Error('LIVE_JOURNEY_ACCOUNTS_CONFIG: bundle-project-mismatch');
  const wanted = LIVE_JOURNEY_ROLES.map((r) => ({ ...r, email: bundle.accounts[r.role].email.toLowerCase(), accountId: bundle.accounts[r.role].accountId }));
  let byEmail, profiles;
  try {
    byEmail = new Map((await listUsers(supabase)).filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]));
    const found = wanted.map((w) => byEmail.get(w.email)).filter(Boolean);
    profiles = new Map();
    if (found.length) {
      const { data, error } = await supabase.from('user_profiles').select('id, subscription_status').in('id', found.map((u) => u.id));
      if (error) throw new Error('profiles');
      for (const row of data || []) profiles.set(row.id, row);
    }
  } catch {
    throw new Error('LIVE_JOURNEY_ACCOUNTS_READ_FAILED');
  }
  const results = wanted.map((w) => {
    const user = byEmail.get(w.email);
    const profile = user ? profiles.get(user.id) : null;
    const tierMatches = Boolean(profile && profile.subscription_status === w.expectedTier);
    const idMatches = Boolean(user && user.id === w.accountId);
    return { role: w.role, authUserExists: Boolean(user), tierMatches, idMatches, pass: Boolean(user && tierMatches && idMatches) };
  });
  return { target: 'live-journey-accounts', results, allPass: results.every((r) => r.pass) };
}

export function statusLine(status, result) {
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

  if (result.authUserExists) {
    details.push(`completed sessions=${result.completedSessions ?? 'unverified'}`);
  }

  return `${prefix} ${result.label}: ${details.join(', ')}`;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('FAIL verifier config: missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (!['reviewers', 'canaries', 'live-journey-accounts'].includes(VERIFY_TARGET)) {
    console.error(`FAIL verifier config: unknown VERIFY_TARGET '${VERIFY_TARGET}' (expected reviewers, canaries or live-journey-accounts)`);
    process.exit(1);
  }

  if (VERIFY_TARGET === 'live-journey-accounts') {
    // Mask first: the whole bundle (even malformed) and every extracted value, before any other output or error.
    const raw = process.env.CLOUD_TEST_LIVE_ACCOUNTS;
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const command of maskCommands(liveJourneyMaskValues(raw))) process.stdout.write(`${command}\n`);
    }
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    let outcome;
    try {
      outcome = await verifyLiveJourneyAccounts({ supabase: adminClient, raw, supabaseUrl: SUPABASE_URL });
    } catch (error) {
      // Only this module's own fixed codes are printed; anything else is reported as a read failure.
      const message = error instanceof Error && /^LIVE_JOURNEY_ACCOUNTS_[A-Z_]+(: [a-z-]+)?$/.test(error.message) ? error.message : 'LIVE_JOURNEY_ACCOUNTS_READ_FAILED';
      console.error(`FAIL ${message}`);
      process.exit(1);
    }
    console.log('Live-journey account verification (read-only; role only; no sign-in)');
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), ...outcome }, null, 2));
    if (!outcome.allPass) process.exit(1);
    return;
  }

  if (VERIFY_TARGET === 'canaries') {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { results, allEligible } = await runCanaryInspection({ adminClient, env: process.env });
    console.log('Canary identity inspection (read-only; credential viability is not tested)');
    for (const result of results) {
      console.log(formatCanaryLine(result));
    }
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), target: 'canaries', results }, null, 2));
    if (!allEligible) {
      process.exit(1);
    }
    return;
  }

  const candidates = configuredCandidates();
  if (candidates.length === 0) {
    console.error('FAIL verifier config: no test-user email env vars configured');
    console.error('Set FREE_TEST_EMAIL/E2E_FREE_EMAIL or PRO_TEST_EMAIL/E2E_PRO_EMAIL.');
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

  const results = await Promise.all(candidates.map(async (candidate) => {
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
      completedSessions: authUser ? await completedSessionCount(supabase, authUser.id) : null,
      pass,
    };
  }));

  console.log('Test user profile verification');
  for (const result of results) {
    console.log(statusLine(result.pass ? 'PASS' : 'FAIL', result));
  }

  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));

  if (results.some((result) => !result.pass)) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`FAIL verifier runtime: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
