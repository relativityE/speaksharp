// Option A: scoped promo cleanup + auth delete for a FROZEN test-user delete set.
// For the exact frozen ids that still exist: delete their promo_attempts + promo_redemptions rows
// (untracked tables — NO global schema change), then delete the auth users (FK cascade handles the
// rest). ID-frozen — never re-derives the population via the state-dependent classifier.
//
// Hard-stop safety before ANY write: count guard (expected still-existing), never the stable canary,
// never a Stripe-linked / real-domain / issue-report account. Dry-run default; backup CSV first.

import fs from 'node:fs';
import { listAuthUsers, isRealStripe, isTestDomain, PROTECTED_IDS } from './db-hygiene-audit.mjs';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const EXPECTED = Number(process.env.EXPECTED_REMAINING || '-1');
const FROZEN_FILE = process.env.FROZEN_IDS_FILE || '';
const DRY = process.env.DRY_RUN !== '0';
// Explicit opt-ins to permit otherwise-blocked accounts in an OWNER-REVIEWED frozen set.
// ALLOW_REAL_DOMAIN: permit real-domain/redacted accounts (reviewed junk).
// ALLOW_STRIPE: permit Stripe-linked accounts (owner has confirmed test-mode/non-live in Stripe).
// The stable-canary and issue-report hard-stops, and the PROTECTED_IDS exclusion, stay UNCONDITIONAL.
const ALLOW_REAL_DOMAIN = process.env.ALLOW_REAL_DOMAIN === '1';
const ALLOW_STRIPE = process.env.ALLOW_STRIPE === '1';
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
if (!FROZEN_FILE) { console.error('Missing FROZEN_IDS_FILE'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };
const STABLE_CANARY = 'canary@speaksharp.app';
// PROTECTED_IDS (the held accounts, e.g. gmail) is imported from the shared module and enforced
// UNCONDITIONALLY below, regardless of any flag.
const MAX_ROWS = 100000;
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

async function fetchAllUserIds(path) {
  const ids = new Set();
  for (let offset = 0; offset < MAX_ROWS; offset += 1000) {
    const r = await fetch(`${url}/rest/v1/${path}?select=user_id&limit=1000&offset=${offset}`, { headers: H });
    if (!r.ok) throw new Error(`${path} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const batch = await r.json();
    for (const x of batch) if (x.user_id) ids.add(x.user_id);
    if (batch.length < 1000) break;
  }
  return ids;
}

// Count rows in a (possibly untracked) public table for a set of user ids — read-only reachability + volume.
async function countTableForIds(table, ids) {
  let total = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const inList = `(${ids.slice(i, i + 100).join(',')})`;
    const r = await fetch(`${url}/rest/v1/${table}?user_id=in.${inList}&select=user_id`, { headers: { ...H, Prefer: 'count=exact' } });
    if (!r.ok) throw new Error(`${table} HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
    total += Number(r.headers.get('content-range')?.split('/')?.[1] ?? '0');
  }
  return total;
}

async function deleteTableForId(table, id) {
  const r = await fetch(`${url}/rest/v1/${table}?user_id=eq.${id}`, { method: 'DELETE', headers: { ...H, Prefer: 'count=exact,return=minimal' } });
  if (!r.ok) throw new Error(`DELETE ${table} HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return Number(r.headers.get('content-range')?.split('/')?.[1] ?? '0');
}

async function deleteUserWithRetry(id) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H });
    if (r.ok) return { ok: true };
    if (r.status >= 500 || r.status === 429) { await sleep(attempt * 1500); continue; }
    return { ok: false, status: r.status };
  }
  return { ok: false, status: 'retries-exhausted' };
}

async function main() {
  const frozen = new Set(fs.readFileSync(FROZEN_FILE, 'utf8').split(/\s+/).map(s => s.trim()).filter(Boolean));
  const authUsers = await listAuthUsers();
  const emailById = new Map(authUsers.map(u => [u.id, (u.email || '').toLowerCase()]));
  const targets = authUsers.filter(u => frozen.has(u.id)).map(u => ({ id: u.id, email: (u.email || '').toLowerCase() }));

  log('## Option A — scoped promo cleanup + auth delete (ID-frozen)');
  log();
  log(`Mode: **${DRY ? 'DRY-RUN (no writes)' : 'APPLY'}**`);
  log(`- Frozen ids: **${frozen.size}** · still existing (targets): **${targets.length}** (expected ${EXPECTED})`);

  // Hard-stop safety (before any write).
  // UNCONDITIONAL: protected ids (held real/probable users) and the stable canary can never be deleted.
  const protectedHit = targets.filter(t => PROTECTED_IDS.has(t.id));
  if (protectedHit.length) { log(); log(`**ABORT** — ${protectedHit.length} protected (held) account(s) in target set. No action.`); finish(1); }
  if (targets.some(t => t.email === STABLE_CANARY)) { log(); log('**ABORT** — stable canary in target set.'); finish(1); }
  // Conditional (explicit owner opt-in): real-domain and Stripe-linked.
  const realDom = targets.filter(t => !isTestDomain(t.email));
  if (realDom.length && !ALLOW_REAL_DOMAIN) { log(); log(`**ABORT** — ${realDom.length} real-domain/redacted accounts in target set (set ALLOW_REAL_DOMAIN to permit).`); finish(1); }
  const profiles = targets.length ? await fetchProfiles(targets.map(t => t.id)) : [];
  const stripeLinked = profiles.filter(isRealStripe);
  if (stripeLinked.length && !ALLOW_STRIPE) { log(); log(`**ABORT** — ${stripeLinked.length} Stripe-linked accounts in target set (set ALLOW_STRIPE to permit, only after confirming test-mode).`); finish(1); }
  // UNCONDITIONAL: issue reports.
  const issueUserIds = await fetchAllUserIds('user_issue_reports');
  const withIssues = targets.filter(t => issueUserIds.has(t.id));
  if (withIssues.length) { log(); log(`**ABORT** — ${withIssues.length} accounts with issue reports in target set.`); finish(1); }
  // Accurate, flag-aware summary (no stale "0" text).
  const tag = (n, allowed) => allowed && n ? `${n} (permitted by flag)` : `${n}`;
  log(`- Safety: 0 protected, 0 stable-canary, real-domain ${tag(realDom.length, ALLOW_REAL_DOMAIN)}, Stripe-linked ${tag(stripeLinked.length, ALLOW_STRIPE)}, 0 issue-report ✅`);
  if (stripeLinked.length && ALLOW_STRIPE) {
    log('- ⚠️ ALLOW_STRIPE: deleting Stripe-linked accounts — owner has confirmed these are Stripe TEST-mode / non-live. Stripe-linked target ids:');
    for (const p of stripeLinked) log(`    - \`${p.id}\``);
  }

  // Count promo rows that will be removed (also confirms the untracked tables are reachable via REST).
  const ids = targets.map(t => t.id);
  const paCount = await countTableForIds('promo_attempts', ids);
  const prCount = await countTableForIds('promo_redemptions', ids);
  log(`- promo_attempts rows for target set: **${paCount}** · promo_redemptions rows: **${prCount}**`);

  fs.writeFileSync('db-delete-frozen-promo-backup.csv', ['id,email', ...targets.map(t => `${t.id},${t.email}`)].join('\n'));
  log(`- Backup written: db-delete-frozen-promo-backup.csv (${targets.length} rows)`);

  if (EXPECTED >= 0 && targets.length !== EXPECTED) { log(); log(`**ABORT** — target count ${targets.length} ≠ expected ${EXPECTED}. No writes.`); finish(1); }

  if (DRY) { log(); log(`**DRY RUN** — guard + safety passed. Would delete ${paCount} promo_attempts + ${prCount} promo_redemptions rows, then ${targets.length} auth users. No writes.`); finish(0); }

  let paDel = 0, prDel = 0, deleted = 0, failed = 0;
  for (const t of targets) {
    paDel += await deleteTableForId('promo_attempts', t.id);
    prDel += await deleteTableForId('promo_redemptions', t.id);
    const res = await deleteUserWithRetry(t.id);
    if (res.ok) deleted++; else { failed++; if (failed <= 5) console.error(`  delete ${t.email} -> ${res.status}`); }
  }
  log(); log(`- promo_attempts rows deleted: **${paDel}** · promo_redemptions rows deleted: **${prDel}**`);
  log(`- auth users deleted: **${deleted}** / ${targets.length} (failed: ${failed})`);
  const ok = deleted === targets.length && failed === 0;
  log(); log(`**${ok ? 'DONE' : 'WARNING'}** — deleted ${deleted}/${targets.length} auth users (failed ${failed}).`);
  finish(ok ? 0 : 1);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
