// Phase 1 — normalize stale status='pro' rows to 'free'. PRODUCTION WRITE (UPDATE only; no deletes).
//
// Targets EXACTLY the hygiene audit's NORMALIZE bucket: subscription_status='pro' AND
// stripe_subscription_id IS NULL AND subscription_id IS NULL, MINUS any KEEP/DELETE-pattern account.
// The bare filter also matches canary + the soak-PRO accounts (pro-without-stripe in prod); those are
// KEEP and must NOT be flipped, so they are excluded by id. Fail-closed: aborts unless exactly
// EXPECTED_COUNT rows resolve, and only those specific ids are written.

import fs from 'node:fs';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EXPECTED = Number(process.env.EXPECTED_COUNT || '1001');
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };
const MAX_ROWS = 100000;

// KEEP/DELETE email patterns — identical to the audit, so the normalize set == the audit NORMALIZE bucket.
const ENV_KEEP = new Set([
  process.env.CANARY_EMAIL, process.env.PRO_TEST_EMAIL, process.env.BASIC_TEST_EMAIL,
  process.env.FREE_TEST_EMAIL, process.env.E2E_PRO_EMAIL, process.env.E2E_FREE_EMAIL,
  process.env.E2E_BASIC_EMAIL,
].filter(Boolean).map(e => e.toLowerCase()));
const EXCLUDE_PATTERNS = [
  /^canary@speaksharp\.app$/, /^soak-test\d+@test\.com$/, /^soak-test@test\.com$/,
  /^first-time-tester-.+@speaksharp\.app$/, /^account-mutex-.+@speaksharp\.app$/,
  /^private-decode-ab-.+@speaksharp\.app$/, /^private-longform-.+@speaksharp\.app$/,
  /^tester-b-.+@speaksharp\.app$/, /^test-(pro|free)-\d+@test\.com$/,
  /^cloud-(free|private-sample|paid-pro|over-quota)-.+@example\.com$/,
  /^paid-soft-launch-.+@example\.com$/, /^stt-switching-.+@example\.com$/,
];
const isExcluded = (e) => ENV_KEEP.has(e) || EXCLUDE_PATTERNS.some(r => r.test(e));

async function listAuthUsers() {
  const users = [];
  for (let page = 1; page <= 1000; page++) {
    const r = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: H });
    if (!r.ok) throw new Error(`auth admin HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const body = await r.json();
    const batch = Array.isArray(body) ? body : (body.users || []);
    users.push(...batch);
    if (batch.length < 200 || users.length >= MAX_ROWS) break;
  }
  return users;
}

async function fetchCandidateIds() {
  // The exact owner filter: status='pro' AND stripe_subscription_id IS NULL AND subscription_id IS NULL.
  const q = 'subscription_status=eq.pro&stripe_subscription_id=is.null&subscription_id=is.null&select=id';
  const ids = [];
  for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
    const r = await fetch(`${url}/rest/v1/user_profiles?${q}&limit=1000&offset=${offset}`, { headers: H });
    if (!r.ok) throw new Error(`candidates HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const batch = await r.json();
    ids.push(...batch.map(x => x.id));
    if (batch.length < 1000) break;
  }
  return ids;
}

async function patchToFree(ids) {
  // Only flip rows that are STILL pro (belt-and-suspenders) and exactly these ids.
  let affected = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const inList = `(${batch.join(',')})`;
    const r = await fetch(`${url}/rest/v1/user_profiles?id=in.${inList}&subscription_status=eq.pro`, {
      method: 'PATCH',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'count=exact,return=minimal' },
      body: JSON.stringify({ subscription_status: 'free', updated_at: now }),
    });
    if (!r.ok) throw new Error(`PATCH HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    affected += Number(r.headers.get('content-range')?.split('/')?.[1] ?? '0');
  }
  return affected;
}

async function main() {
  const dryRun = process.env.DRY_RUN === '1';
  const [authUsers, candidateIds] = await Promise.all([listAuthUsers(), fetchCandidateIds()]);
  const emailById = new Map(authUsers.map(u => [u.id, (u.email || '').toLowerCase()]));

  const excluded = candidateIds.filter(id => isExcluded(emailById.get(id) || ''));
  const normalizeIds = candidateIds.filter(id => !isExcluded(emailById.get(id) || ''));

  const lines = [
    '## Phase 1 — normalize stale status=pro → free',
    '',
    `- Bare filter (status=pro · stripe NULL · subscription_id NULL): **${candidateIds.length}**`,
    `- Excluded KEEP/DELETE-pattern accounts (soak-pro, canary, reviewer, ephemeral): **${excluded.length}**`,
    `- Target NORMALIZE set: **${normalizeIds.length}** (expected ${EXPECTED})`,
  ];

  if (normalizeIds.length !== EXPECTED) {
    lines.push('', `**ABORT** — target count ${normalizeIds.length} ≠ expected ${EXPECTED}. No write performed.`);
    const text = lines.join('\n'); console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
    process.exit(1);
  }

  if (dryRun) {
    lines.push('', `**DRY RUN** — guard passed (${normalizeIds.length} rows would be set to free). No write performed.`);
    const text = lines.join('\n'); console.log(text);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
    return;
  }

  const affected = await patchToFree(normalizeIds);
  lines.push('', `- Rows updated to free: **${affected}**`);
  const ok = affected === EXPECTED;
  lines.push('', `**${ok ? 'DONE' : 'WARNING'}** — ${ok ? `normalized exactly ${affected} rows.` : `affected ${affected} ≠ expected ${EXPECTED}; investigate.`}`);
  const text = lines.join('\n'); console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
