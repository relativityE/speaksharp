// Delete a FROZEN set of auth.users by id — ID-frozen, NO classifier rerun (the classification is
// state-dependent, so we never re-derive the target population). Reads an explicit id list, deletes
// only those still existing, with a count guard and safety checks (never the stable canary, never a
// Stripe-linked or real-domain account). Retry-with-backoff for transient gotrue 5xx/429. Dry-run
// default. Reusable: point FROZEN_IDS_FILE + EXPECTED_REMAINING at any frozen set.

import fs from 'node:fs';
import { listAuthUsers, isRealStripe, isTestDomain } from './db-hygiene-audit.mjs';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EXPECTED = Number(process.env.EXPECTED_REMAINING || '-1');
const FROZEN_FILE = process.env.FROZEN_IDS_FILE || '';
const LABEL = process.env.LABEL || 'frozen-ids';
const DRY = process.env.DRY_RUN !== '0';
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
if (!FROZEN_FILE) { console.error('Missing FROZEN_IDS_FILE'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };
const STABLE_CANARY = 'canary@speaksharp.app';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const out = [];
const log = (s = '') => out.push(s);
function finish(code) {
  const text = out.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  process.exit(code);
}

async function fetchProfiles(ids) {
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    const inList = `(${ids.slice(i, i + 100).join(',')})`;
    const r = await fetch(`${url}/rest/v1/user_profiles?id=in.${inList}&select=id,subscription_status,stripe_customer_id,stripe_subscription_id,subscription_id`, { headers: H });
    if (!r.ok) throw new Error(`profiles HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    rows.push(...await r.json());
  }
  return rows;
}

async function deleteWithRetry(id) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H });
    if (r.ok) return { ok: true };
    if (r.status >= 500 || r.status === 429) { await sleep(attempt * 1500); continue; } // transient → back off
    return { ok: false, status: r.status }; // hard 4xx → don't retry
  }
  return { ok: false, status: 'retries-exhausted' };
}

async function main() {
  const frozen = [...new Set(fs.readFileSync(FROZEN_FILE, 'utf8').split(/\s+/).map(s => s.trim()).filter(Boolean))];
  const authUsers = await listAuthUsers();
  const emailById = new Map(authUsers.map(u => [u.id, (u.email || '').toLowerCase()]));
  const targets = frozen.filter(id => emailById.has(id)).map(id => ({ id, email: emailById.get(id) }));

  log(`## ID-frozen delete — ${LABEL}`);
  log();
  log(`Mode: **${DRY ? 'DRY-RUN (no writes)' : 'APPLY'}**`);
  log(`- Frozen ids: **${frozen.length}** · still existing (targets): **${targets.length}** (expected ${EXPECTED})`);

  // Safety: never the stable canary, never a real-domain account.
  if (targets.some(t => t.email === STABLE_CANARY)) { log(); log('**ABORT** — stable canary in target set. No action.'); finish(1); }
  const realDom = targets.filter(t => !isTestDomain(t.email));
  if (realDom.length) { log(); log(`**ABORT** — ${realDom.length} real-domain accounts in target set. No action.`); finish(1); }

  // Safety: never a Stripe-linked account.
  const profiles = targets.length ? await fetchProfiles(targets.map(t => t.id)) : [];
  const stripeLinked = profiles.filter(isRealStripe);
  if (stripeLinked.length) { log(); log(`**ABORT** — ${stripeLinked.length} Stripe-linked accounts in target set. No action.`); finish(1); }
  log('- Safety: 0 stable-canary, 0 real-domain, 0 Stripe-linked ✅');

  // Backup written first (dry-run and apply).
  fs.writeFileSync('db-delete-frozen-ids-backup.csv', ['id,email', ...targets.map(t => `${t.id},${t.email}`)].join('\n'));
  log(`- Backup written: db-delete-frozen-ids-backup.csv (${targets.length} rows)`);

  if (EXPECTED >= 0 && targets.length !== EXPECTED) { log(); log(`**ABORT** — target count ${targets.length} ≠ expected ${EXPECTED}. No writes.`); finish(1); }

  if (DRY) { log(); log(`**DRY RUN** — guard + safety passed; ${targets.length} accounts WOULD be deleted. No writes.`); finish(0); }

  let deleted = 0, failed = 0;
  for (const t of targets) {
    const res = await deleteWithRetry(t.id);
    if (res.ok) deleted++; else { failed++; if (failed <= 5) console.error(`  delete ${t.email} -> ${res.status}`); }
  }
  log(); log(`- Deleted: **${deleted}** / ${targets.length} (failed: ${failed})`);
  const ok = deleted === targets.length && failed === 0;
  log(); log(`**${ok ? 'DONE' : 'WARNING'}** — deleted ${deleted}/${targets.length} (failed ${failed}).`);
  finish(ok ? 0 : 1);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
