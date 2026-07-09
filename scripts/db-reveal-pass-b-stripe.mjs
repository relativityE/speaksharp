// READ-ONLY: reveal the Stripe linkage for the frozen Pass-B set so the owner can verify test-mode in
// Stripe before the destructive Pass B. SELECT-only via PostgREST (service role). No writes of any kind.
// Re-confirms (live): which targets carry a REAL (non-synthetic) stripe_customer_id/subscription_id vs
// a synthetic sub_test_* id, and that no PROTECTED (held) id is present. Emits a CSV artifact + summary.

import fs from 'node:fs';
import { listAuthUsers, isRealStripe, PROTECTED_IDS } from './db-hygiene-audit.mjs';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const FROZEN_FILE = process.env.FROZEN_IDS_FILE || 'scripts/data/passB-stripe-proof-14-ids.txt';
if (!url || !key) { console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
const H = { apikey: key, Authorization: `Bearer ${key}` };

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

const out = [];
const log = (s = '') => out.push(s);

async function main() {
  const frozen = [...new Set(fs.readFileSync(FROZEN_FILE, 'utf8').split(/\s+/).map(s => s.trim()).filter(Boolean))];
  const authUsers = await listAuthUsers();
  const emailById = new Map(authUsers.map(u => [u.id, u.email || '']));
  const present = frozen.filter(id => emailById.has(id));
  const profById = new Map((present.length ? await fetchProfiles(present) : []).map(p => [p.id, p]));

  const rows = present.map(id => {
    const p = profById.get(id) || {};
    const sub = (p.stripe_subscription_id || '').trim();
    const cust = (p.stripe_customer_id || '').trim();
    const synthetic = sub.startsWith('sub_test_');
    return {
      id, email: emailById.get(id) || '', status: p.subscription_status || '',
      cust, sub, synthetic, real: isRealStripe(p), protectedHit: PROTECTED_IDS.has(id),
    };
  });

  const real = rows.filter(r => r.real);
  const synth = rows.filter(r => !r.real);
  const prot = rows.filter(r => r.protectedHit);

  // Full ids to artifact (object references, not secrets — owner needs them for Stripe lookup).
  fs.writeFileSync('pass-b-stripe-reveal.csv',
    ['email,subscription_status,stripe_customer_id,stripe_subscription_id,synthetic,real_stripe,auth_user_id',
      ...rows.map(r => `${r.email},${r.status},${r.cust},${r.sub},${r.synthetic},${r.real},${r.id}`)].join('\n'));

  log('## Pass B — Stripe linkage reveal (read-only)');
  log();
  log(`Frozen set: **${frozen.length}** · still existing: **${present.length}** · PROTECTED (held) present: **${prot.length}** (must be 0)`);
  log(`Real (non-synthetic) Stripe: **${real.length}** · synthetic sub_test_*: **${synth.length}**`);
  log();
  log('### Real-Stripe accounts — VERIFY these in Stripe (test-mode/non-live):');
  log('| email | status | stripe_customer_id | stripe_subscription_id |');
  log('|---|---|---|---|');
  for (const r of real) log(`| \`${r.email}\` | ${r.status} | \`${r.cust || '—'}\` | \`${r.sub || '—'}\` |`);
  log();
  log('### Synthetic accounts — no real Stripe record (no verification needed):');
  for (const r of synth) log(`- \`${r.email}\` — sub \`${r.sub}\``);
  log();
  log('> Full per-account detail is in the `pass-b-stripe-reveal` CSV artifact.');

  const text = out.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  if (prot.length) process.exit(1); // a held id should never be in the Pass-B set
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
