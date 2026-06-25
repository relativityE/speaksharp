// Phase 1 (NORMALIZE) + Phase 2 (DELETE) production cleanup. Acts on the EXACT audit classification
// (imported gatherAndClassify — single source of truth), with SEPARATE fail-closed guards and
// SEPARATE counts. Dry-run by default. Never touches KEEP or INVESTIGATE rows. Phase 2 additionally
// refuses to delete any Stripe-linked or real-domain account even if it somehow classified DELETE.
//
//   Phase 1: classification == NORMALIZE  -> subscription_status = 'free'   (expected 42)
//   Phase 2: classification == DELETE     -> delete auth user by id (FK cascade)  (expected 184)

import fs from 'node:fs';
import { gatherAndClassify } from './db-hygiene-audit.mjs';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const NORM_EXPECTED = Number(process.env.NORMALIZE_EXPECTED || '42');
const DEL_EXPECTED = Number(process.env.DELETE_EXPECTED || '184');
const DRY = process.env.DRY_RUN !== '0'; // dry-run unless DRY_RUN=0
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };

const out = [];
const log = (s = '') => out.push(s);
function finish(code) {
  const text = out.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  process.exit(code);
}

async function patchToFree(ids) {
  let affected = 0; const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i += 100) {
    const inList = `(${ids.slice(i, i + 100).join(',')})`;
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

async function deleteUsers(ids) {
  let deleted = 0, failed = 0;
  for (const id of ids) {
    const r = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H });
    if (r.ok) deleted++; else { failed++; if (failed <= 5) console.error(`  delete ${id} HTTP ${r.status}`); }
  }
  return { deleted, failed };
}

async function main() {
  const { records } = await gatherAndClassify();
  const norm = records.filter(r => r.classification === 'NORMALIZE');
  const del = records.filter(r => r.classification === 'DELETE');

  // Backup the affected ids first (both phases), written in dry-run and apply.
  const backup = ['phase,id,classification,subscription_status,session_count,usage_count', ...records
    .filter(r => r.classification === 'NORMALIZE' || r.classification === 'DELETE')
    .map(r => `${r.classification === 'NORMALIZE' ? 1 : 2},${r.id},${r.classification},${r.profile?.subscription_status ?? ''},${r.sessions},${r.usage}`)];
  fs.writeFileSync('db-phase1and2-backup.csv', backup.join('\n'));

  log('## Phase 1 (NORMALIZE) + Phase 2 (DELETE) — gated cleanup');
  log();
  log(`Mode: **${DRY ? 'DRY-RUN (no writes)' : 'APPLY'}**`);
  log();

  // ---- Phase 1 guard (NORMALIZE) ----
  log('### Phase 1 — NORMALIZE stale status=pro → free');
  log(`- Target (classification=NORMALIZE): **${norm.length}** (expected ${NORM_EXPECTED})`);
  if (norm.length !== NORM_EXPECTED) { log(); log(`**ABORT** — NORMALIZE count ${norm.length} ≠ ${NORM_EXPECTED}. No writes.`); finish(1); }

  // ---- Phase 2 guard + safety (DELETE) ----
  log('### Phase 2 — DELETE residue');
  log(`- Target (classification=DELETE): **${del.length}** (expected ${DEL_EXPECTED})`);
  const badStripe = del.filter(r => r.realStripe);
  const badDomain = del.filter(r => r.realDomain);
  if (badStripe.length || badDomain.length) {
    log(); log(`**ABORT** — DELETE set contains ${badStripe.length} Stripe-linked and ${badDomain.length} real-domain rows. No writes.`);
    finish(1);
  }
  log('- Safety: 0 Stripe-linked, 0 real-domain in DELETE set ✅');
  if (del.length !== DEL_EXPECTED) { log(); log(`**ABORT** — DELETE count ${del.length} ≠ ${DEL_EXPECTED}. No writes.`); finish(1); }

  log(); log(`- Backup written: db-phase1and2-backup.csv (${norm.length + del.length} rows)`);

  if (DRY) {
    log(); log(`**DRY RUN** — both guards + Phase-2 safety passed. Would normalize ${norm.length} and delete ${del.length}. No writes performed.`);
    finish(0);
  }

  // ---- Apply Phase 1 then Phase 2 (ids fixed from the single classification pass above) ----
  const normAffected = await patchToFree(norm.map(r => r.id));
  log(); log(`- Phase 1: normalized **${normAffected}** / ${norm.length} → free`);
  const { deleted, failed } = await deleteUsers(del.map(r => r.id));
  log(`- Phase 2: deleted **${deleted}** / ${del.length} (failed: ${failed})`);

  const ok = normAffected === NORM_EXPECTED && deleted === DEL_EXPECTED && failed === 0;
  log();
  log(`**${ok ? 'DONE' : 'WARNING'}** — normalize ${normAffected}/${NORM_EXPECTED}, delete ${deleted}/${DEL_EXPECTED} (failed ${failed}).`);
  finish(ok ? 0 : 1);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
