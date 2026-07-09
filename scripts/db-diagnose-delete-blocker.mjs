// READ-ONLY diagnostic for the persistent HTTP 500 on deleting the promo/codex/pl006 auth users.
// SELECT-ONLY. No DELETE/UPDATE/INSERT/ALTER/DROP, no auth delete, no Stripe. Uses the Supabase
// Management API SQL endpoint (access token) for catalog introspection and the service-role REST
// only to resolve which frozen ids still exist (to sample failed ids).
//
// Answers: (1) every FK to auth.users/user_profiles + its ON DELETE action (finds non-cascade FKs
// not visible in migrations); (2) non-internal triggers on those tables; (3) for 5 sample failed
// ids, which child tables actually hold their rows (the blocker = a holder with a non-cascade FK).

import { listAuthUsers } from './db-hygiene-audit.mjs';
import fs from 'node:fs';

const ref = process.env.SUPABASE_PROJECT_ID || '';
const token = process.env.SUPABASE_ACCESS_TOKEN || '';
const FROZEN_FILE = process.env.FROZEN_IDS_FILE || 'scripts/data/phase2-delete-184-ids.txt';
if (!ref || !token) { console.error('Missing SUPABASE_PROJECT_ID or SUPABASE_ACCESS_TOKEN'); process.exit(2); }

const DELMAP = { a: 'NO ACTION (blocks!)', r: 'RESTRICT (blocks!)', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

// Read-only guard: refuse to run anything that is not a single SELECT.
async function sql(query) {
  if (!/^\s*select\b/i.test(query) || /\b(delete|update|insert|alter|drop|truncate|create|grant|revoke)\b/i.test(query)) {
    throw new Error('refusing non-SELECT query: ' + query.slice(0, 60));
  }
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`mgmt API HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const out = [];
const log = (s = '') => out.push(s);

async function main() {
  // Sample 5 failed ids = frozen-184 ids that still exist.
  const frozen = new Set(fs.readFileSync(FROZEN_FILE, 'utf8').split(/\s+/).map(s => s.trim()).filter(Boolean));
  const authUsers = await listAuthUsers();
  const stillExist = authUsers.filter(u => frozen.has(u.id));
  const sample = stillExist.slice(0, 5);
  log('## Delete-blocker diagnostic (read-only)');
  log();
  log(`Frozen ids still existing: **${stillExist.length}**; sampling **${sample.length}**:`);
  for (const u of sample) log(`- \`${u.id}\` ${u.email}`);
  const idArray = `ARRAY[${sample.map(u => `'${u.id}'`).join(',')}]::uuid[]`;

  // (1) FKs to auth.users / user_profiles + ON DELETE action.
  log(''); log('### (1) Foreign keys → auth.users / public.user_profiles');
  const fks = await sql(`
    SELECT con.conname,
           (con.conrelid::regclass)::text AS child_table,
           (con.confrelid::regclass)::text AS parent_table,
           att.attname AS fk_column,
           con.confdeltype AS del
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.confrelid IN ('auth.users'::regclass, 'public.user_profiles'::regclass)
    ORDER BY con.confdeltype, child_table`);
  for (const f of fks) log(`- ${f.child_table}.${f.fk_column} → ${f.parent_table} : **${DELMAP[f.del] || f.del}**`);
  const blockingFks = fks.filter(f => f.del === 'a' || f.del === 'r');
  log(); log(`Non-cascade (blocking) FKs: **${blockingFks.length}**`);

  // (2) Non-internal triggers on those tables.
  log(''); log('### (2) Triggers on auth.users / public.user_profiles');
  const trg = await sql(`
    SELECT tgname, (tgrelid::regclass)::text AS tbl, tgenabled
    FROM pg_trigger
    WHERE tgrelid IN ('auth.users'::regclass, 'public.user_profiles'::regclass)
      AND NOT tgisinternal
    ORDER BY tbl, tgname`);
  if (!trg.length) log('- (none non-internal)');
  for (const t of trg) log(`- ${t.tbl}: ${t.tgname} (enabled=${t.tgenabled})`);

  // (3) Which child tables actually hold the sample ids' rows?
  log(''); log('### (3) Child tables holding the sampled failed ids');
  const holders = [];
  for (const f of fks) {
    try {
      const res = await sql(`SELECT count(*)::int AS n FROM ${f.child_table} WHERE ${f.fk_column} = ANY(${idArray})`);
      const n = res?.[0]?.n ?? 0;
      if (n > 0) { holders.push({ ...f, n }); log(`- ${f.child_table}.${f.fk_column}: **${n}** rows  (ON DELETE ${DELMAP[f.del] || f.del})`); }
    } catch (e) { log(`- ${f.child_table}: query error (${(e.message || e).slice(0, 60)})`); }
  }
  if (!holders.length) log('- none of the FK children hold these ids → blocker is likely a trigger or auth-internal, not a public FK.');

  // Verdict.
  log(''); log('### Verdict');
  const blockingHolders = holders.filter(h => h.del === 'a' || h.del === 'r');
  if (blockingHolders.length) {
    log(`**Blocker = non-cascade FK(s):** ${blockingHolders.map(h => `${h.child_table}.${h.fk_column}`).join(', ')} — fix: ON DELETE CASCADE (or delete those dependent rows by id).`);
  } else if (holders.length) {
    log('All holder FKs are CASCADE/SET NULL, yet delete 500s → blocker is NOT a public FK. Inspect the triggers above / auth-schema state.');
  } else {
    log('No public child rows for these ids → blocker is a trigger or auth-internal path, not a public FK.');
  }

  const text = out.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
