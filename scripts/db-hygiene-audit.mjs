// Read-only production DB hygiene audit. NO writes, NO deletes, NO updates.
//
// Inventories auth.users joined to user_profiles + session/usage/issue-report signals, then
// classifies every account KEEP / DELETE / NORMALIZE / INVESTIGATE using the agreed rubric
// (incl. the audit-found ephemeral patterns and the synthetic-vs-real Stripe distinction).
// Emits category counts to the job summary and a redacted CSV artifact for owner review.

import fs from 'node:fs';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
const rest = { apikey: key, Authorization: `Bearer ${key}` };

const MAX_ROWS = 100000; // safety cap per table

// Configured reviewer/CI accounts to KEEP (from env; absent ones are simply not matched).
const ENV_KEEP = new Set([
  process.env.CANARY_EMAIL, process.env.PRO_TEST_EMAIL, process.env.BASIC_TEST_EMAIL,
  process.env.FREE_TEST_EMAIL, process.env.E2E_PRO_EMAIL, process.env.E2E_FREE_EMAIL,
  process.env.E2E_BASIC_EMAIL,
].filter(Boolean).map(e => e.toLowerCase()));

async function listAuthUsers() {
  const users = [];
  for (let page = 1; page <= 1000; page++) {
    const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: rest });
    if (!r.ok) throw new Error(`auth admin HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const body = await r.json();
    const batch = Array.isArray(body) ? body : (body.users || []);
    users.push(...batch);
    if (batch.length < 200 || users.length >= MAX_ROWS) break;
  }
  return users;
}

async function fetchAll(path, select) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
    const r = await fetch(`${url}/rest/v1/${path}?select=${select}&limit=1000&offset=${offset}`, { headers: rest });
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}

const countByUser = (rows) => {
  const m = new Map();
  for (const row of rows) { const u = row.user_id; if (u) m.set(u, (m.get(u) || 0) + 1); }
  return m;
};

// Internal test/QA domains — accounts here are never real users. @speaksharp.test and
// @test.speaksharp.dev are internal fixtures; recognizing them keeps them out of the
// "possible real user" bucket so the owner review surface stays the genuine real-domain set.
const TEST_DOMAINS = ['@test.com', '@example.com', '@speaksharp.test', '@test.speaksharp.dev'];
const isTestDomain = (e) => TEST_DOMAINS.some(d => e.endsWith(d)) || e.endsWith('@speaksharp.app');

// Email patterns: each is [regex, classification, justification].
const KEEP_PATTERNS = [
  [/^canary@speaksharp\.app$/, 'canary smoke account (provision-canary)'],
  [/^soak-test\d+@test\.com$/, 'soak registry (setup-test-users)'],
];
const DELETE_PATTERNS = [
  [/^first-time-tester-.+@speaksharp\.app$/, 'first-time-tester residue (no cleanup, accumulates)'],
  [/^account-mutex-.+@speaksharp\.app$/, 'account-mutex residue (+audit; no cleanup)'],
  [/^private-decode-ab-.+@speaksharp\.app$/, 'private-decode-ab residue (+audit; no cleanup)'],
  [/^private-longform-.+@speaksharp\.app$/, 'private-longform residue (+audit; no cleanup)'],
  [/^tester-b-.+@speaksharp\.app$/, 'tester-b residue (+audit; no cleanup)'],
  [/^test-(pro|free)-\d+@test\.com$/, 'make-test-user throwaway (+audit)'],
  [/^cloud-(free|private-sample|paid-pro|over-quota)-.+@example\.com$/, 'cloud-token-gate residue'],
  [/^paid-soft-launch-.+@example\.com$/, 'paid-soft-launch residue'],
  [/^stt-switching-.+@example\.com$/, 'stt-switching residue (+audit)'],
  [/^soak-test@test\.com$/, 'legacy soak-test (renamed to soak-test0)'],
];

function classify(email, profile, sessions, usage, issues) {
  const e = (email || '').toLowerCase();
  const status = (profile?.subscription_status || '').toLowerCase();
  const stripeSub = (profile?.stripe_subscription_id || '').trim();
  const custId = (profile?.stripe_customer_id || '').trim();
  const legacyId = (profile?.subscription_id || '').trim();
  const synthetic = stripeSub.startsWith('sub_test_');
  const realStripe = (stripeSub && !synthetic) || (custId && !custId.startsWith('cus_test_'));

  if (ENV_KEEP.has(e)) return ['KEEP', 'configured reviewer/CI account (env)'];
  for (const [re, why] of KEEP_PATTERNS) if (re.test(e)) return ['KEEP', why];
  for (const [re, why] of DELETE_PATTERNS) if (re.test(e)) return ['DELETE', why];

  if (!profile && sessions === 0 && usage === 0 && issues === 0 && !realStripe) {
    return ['DELETE', 'no profile / sessions / usage / issue reports / real Stripe'];
  }
  if (status === 'pro' && !stripeSub && !legacyId) {
    return ['NORMALIZE', "status='pro' with no Stripe/legacy id → set 'free' (the 1012)"];
  }
  if (realStripe) return ['INVESTIGATE', 'real (non-synthetic) Stripe linkage — reconcile before action'];
  // Phase 0: a recognized test-domain account with zero activity and no real Stripe is residue,
  // not a review item — route it out of INVESTIGATE into DELETE candidates. Stale status=pro rows
  // were already sent to NORMALIZE above; real-domain (possible real user) accounts and any account
  // with sessions/issues are intentionally left in INVESTIGATE for one-by-one review below.
  if (isTestDomain(e) && sessions === 0 && usage === 0 && issues === 0 && !realStripe) {
    return ['DELETE', 'test-domain account, no sessions/usage/issues/real Stripe (residue)'];
  }
  if (sessions > 0 || issues > 0) return ['INVESTIGATE', 'has user-generated sessions / issue reports'];
  if (!isTestDomain(e)) return ['INVESTIGATE', 'non-test-domain email (possible real user)'];
  if (status === 'pro') return ['INVESTIGATE', "status='pro' not in keep/normalize set"];
  return ['INVESTIGATE', 'unclassified — manual review'];
}

const redactEmail = (e) => {
  if (!e) return '(no email)';
  if (isTestDomain(e)) return e; // test patterns are safe to show
  const [, domain] = e.split('@');
  return `***@${domain || 'unknown'}`;
};
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function main() {
  const [authUsers, profiles, sessionRows, usageRows, issueRows] = await Promise.all([
    listAuthUsers(),
    fetchAll('user_profiles', 'id,subscription_status,stripe_customer_id,stripe_subscription_id,subscription_id'),
    fetchAll('sessions', 'user_id'),
    fetchAll('usage_checkpoints', 'user_id'),
    fetchAll('user_issue_reports', 'user_id'),
  ]);

  const profById = new Map(profiles.map(p => [p.id, p]));
  const sessCount = countByUser(sessionRows);
  const usageCount = countByUser(usageRows);
  const issueCount = countByUser(issueRows);

  const counts = { KEEP: 0, DELETE: 0, NORMALIZE: 0, INVESTIGATE: 0 };
  const csv = ['email_or_pattern,auth_user_id,profile_exists,subscription_status,has_stripe_customer,has_stripe_subscription,stripe_synthetic,has_legacy_subscription_id,session_count,usage_count,issue_report_count,created_at,last_sign_in_at,classification,justification'];

  for (const u of authUsers) {
    const p = profById.get(u.id) || null;
    const s = sessCount.get(u.id) || 0;
    const us = usageCount.get(u.id) || 0;
    const iss = issueCount.get(u.id) || 0;
    const [cls, why] = classify(u.email, p, s, us, iss);
    counts[cls] = (counts[cls] || 0) + 1;
    const stripeSub = (p?.stripe_subscription_id || '').trim();
    csv.push([
      redactEmail(u.email), u.id, Boolean(p), p?.subscription_status ?? '',
      Boolean((p?.stripe_customer_id || '').trim()), Boolean(stripeSub), stripeSub.startsWith('sub_test_'),
      Boolean((p?.subscription_id || '').trim()), s, us, iss,
      u.created_at ?? '', u.last_sign_in_at ?? '', cls, why,
    ].map(csvCell).join(','));
  }

  fs.writeFileSync('db-hygiene-audit.csv', csv.join('\n'));

  const total = authUsers.length;
  const summary = [
    '## Production DB hygiene audit (read-only — nothing was modified)',
    '',
    `Total auth.users: **${total}** · user_profiles: **${profiles.length}**`,
    '',
    '| Category | Count |',
    '|---|---:|',
    `| KEEP | ${counts.KEEP} |`,
    `| DELETE | ${counts.DELETE} |`,
    `| NORMALIZE | ${counts.NORMALIZE} |`,
    `| INVESTIGATE | ${counts.INVESTIGATE} |`,
    '',
    '> Per-account detail (redacted emails, full ids) is in the `db-hygiene-audit` CSV artifact.',
    '> NORMALIZE = stale status=pro with no Stripe/legacy id (the ~1012). Soak-pro `sub_test_*` ids are synthetic and KEEP, not real-paid.',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
