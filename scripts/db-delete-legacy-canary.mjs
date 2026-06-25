// Delete legacy canary-<runid>@speaksharp.app residue. PRODUCTION DELETE of auth.users (FK cascade
// removes profile/sessions/usage; issue reports / trial entitlements are ON DELETE SET NULL).
//
// Strictly targets emails matching ^canary-.+@speaksharp.app$ — NOT the stable canary@speaksharp.app,
// NOT soak/reviewer/any other account. Exports a backup CSV of the affected rows FIRST. Fail-closed:
// aborts unless exactly EXPECTED_COUNT resolve AND none carry any Stripe linkage. Dry-run by default.

import fs from 'node:fs';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EXPECTED = Number(process.env.EXPECTED_COUNT || '959');
const DRY = process.env.DRY_RUN !== '0'; // dry-run unless explicitly DRY_RUN=0
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };
const MAX_ROWS = 100000;

const LEGACY_CANARY = /^canary-.+@speaksharp\.app$/i;   // per-run residue only
const STABLE_CANARY = 'canary@speaksharp.app';

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

async function fetchProfiles(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const inList = `(${ids.slice(i, i + 100).join(',')})`;
    const r = await fetch(`${url}/rest/v1/user_profiles?id=in.${inList}&select=id,subscription_status,stripe_customer_id,stripe_subscription_id,subscription_id`, { headers: H });
    if (!r.ok) throw new Error(`profiles HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    out.push(...await r.json());
  }
  return out;
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

async function main() {
  const authUsers = await listAuthUsers();
  const targets = authUsers
    .filter(u => u.email && LEGACY_CANARY.test(u.email))
    .map(u => ({ id: u.id, email: u.email.toLowerCase(), created_at: u.created_at, last_sign_in_at: u.last_sign_in_at }));

  const lines = ['## Delete legacy canary-<runid> residue', '', `- Matched \`canary-*@speaksharp.app\`: **${targets.length}** (expected ${EXPECTED})`];

  // Hard safety: never include the stable canary account.
  if (targets.some(t => t.email === STABLE_CANARY)) {
    lines.push('', '**ABORT** — stable canary@speaksharp.app matched the legacy filter (should be impossible). No action.');
    finish(lines, 1); return;
  }

  // Backup artifact FIRST (written in both dry-run and apply).
  const backup = ['id,email,created_at,last_sign_in_at', ...targets.map(t =>
    [t.id, t.email, t.created_at, t.last_sign_in_at].map(csvCell).join(','))];
  fs.writeFileSync('db-delete-legacy-canary-backup.csv', backup.join('\n'));
  lines.push(`- Backup written: db-delete-legacy-canary-backup.csv (${targets.length} rows)`);

  // Stripe safety: refuse if any target carries a Stripe linkage.
  const profiles = targets.length ? await fetchProfiles(targets.map(t => t.id)) : [];
  const stripeLinked = profiles.filter(p => (p.stripe_customer_id || '').trim() || ((p.stripe_subscription_id || '').trim() && !(p.stripe_subscription_id || '').startsWith('sub_test_')));
  if (stripeLinked.length > 0) {
    lines.push('', `**ABORT** — ${stripeLinked.length} matched accounts carry a Stripe linkage. No deletion. Investigate.`);
    finish(lines, 1); return;
  }
  lines.push(`- Stripe safety: 0 of ${targets.length} carry Stripe linkage ✅`);

  // Fail-closed count guard.
  if (targets.length !== EXPECTED) {
    lines.push('', `**ABORT** — matched ${targets.length} ≠ expected ${EXPECTED}. Backup written; no deletion. Re-confirm the expected count against a fresh audit.`);
    finish(lines, 1); return;
  }

  if (DRY) {
    lines.push('', `**DRY RUN** — guard + safety passed; ${targets.length} accounts WOULD be deleted. No deletion performed. Review the backup artifact, then re-dispatch with mode=apply.`);
    finish(lines, 0); return;
  }

  let deleted = 0, failed = 0;
  for (const t of targets) {
    const r = await fetch(`${url}/auth/v1/admin/users/${t.id}`, { method: 'DELETE', headers: H });
    if (r.ok) deleted++; else { failed++; if (failed <= 5) console.error(`  delete ${t.email} HTTP ${r.status}`); }
  }
  lines.push('', `- Deleted: **${deleted}** / ${targets.length}  (failed: ${failed})`);
  const ok = deleted === EXPECTED && failed === 0;
  lines.push('', `**${ok ? 'DONE' : 'WARNING'}** — ${ok ? `deleted exactly ${deleted} legacy canary accounts.` : `deleted ${deleted}, failed ${failed}; investigate.`}`);
  finish(lines, ok ? 0 : 1);
}

function finish(lines, code) {
  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  process.exit(code);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
