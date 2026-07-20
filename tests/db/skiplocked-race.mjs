/* global console, process */
/**
 * Concurrency proof for claim_telemetry_batch() — the ONE thing a single-connection engine (PGlite)
 * cannot show: that two workers claiming at the SAME TIME never lease the same row twice.
 *
 * Requires a real multi-connection PostgreSQL (a postgres:16 service in CI). Uses node-postgres with
 * two independent client connections racing claim() over a shared pool of due rows, and asserts the
 * claimed sets are DISJOINT (FOR UPDATE SKIP LOCKED) and jointly complete.
 *
 * Run:  DATABASE_URL=postgres://... node tests/db/skiplocked-race.mjs
 * Content-free: synthetic UUIDs only.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = resolve(HERE, '../../backend/supabase/migrations');
const sql = (p) => readFileSync(p, 'utf8');
const URL = process.env.DATABASE_URL;
if (!URL) { console.error('DATABASE_URL required'); process.exit(2); }

const N = 40; // due rows to race over
const U = '55555555-5555-5555-5555-555555555555';

async function main() {
  const admin = new pg.Client({ connectionString: URL });
  await admin.connect();
  await admin.query(sql(resolve(HERE, 'harness/bootstrap.sql')));
  await admin.query(sql(resolve(MIG, '20260720140000_report_session_ownership_guard.sql')));
  await admin.query(sql(resolve(MIG, '20260720150000_observability_provenance_registry.sql')));
  await admin.query(sql(resolve(MIG, '20260720150100_telemetry_outbox.sql')));
  await admin.query(`INSERT INTO auth.users (id,email) VALUES ($1,'race') ON CONFLICT DO NOTHING`, [U]);
  for (let i = 0; i < N; i++) await admin.query(`INSERT INTO public.sessions (user_id,status) VALUES ($1,'completed')`, [U]);

  const claimed = (await admin.query(`SELECT count(*)::int c FROM public.telemetry_outbox WHERE status='pending'`)).rows[0].c;
  if (claimed < N) throw new Error(`expected ${N} pending rows, got ${claimed}`);

  const w1 = new pg.Client({ connectionString: URL });
  const w2 = new pg.Client({ connectionString: URL });
  await w1.connect(); await w2.connect();

  // Race: both workers claim the whole batch concurrently.
  const [r1, r2] = await Promise.all([
    w1.query(`SELECT id FROM public.claim_telemetry_batch($1,'race-w1')`, [N]),
    w2.query(`SELECT id FROM public.claim_telemetry_batch($1,'race-w2')`, [N]),
  ]);
  const s1 = new Set(r1.rows.map((x) => x.id));
  const s2 = new Set(r2.rows.map((x) => x.id));
  const overlap = [...s1].filter((id) => s2.has(id));

  const problems = [];
  if (overlap.length !== 0) problems.push(`SKIP LOCKED violated: ${overlap.length} rows claimed by BOTH workers`);
  if (s1.size + s2.size !== N) problems.push(`expected ${N} total distinct claims, got ${s1.size + s2.size} (w1=${s1.size} w2=${s2.size})`);
  const stillPending = (await admin.query(`SELECT count(*)::int c FROM public.telemetry_outbox WHERE status='pending'`)).rows[0].c;
  if (stillPending !== 0) problems.push(`${stillPending} rows left unclaimed after the race`);

  console.log('===== SKIP LOCKED CONCURRENCY RACE (real postgres, 2 connections) =====');
  console.log(`  rows=${N}  w1_claimed=${s1.size}  w2_claimed=${s2.size}  overlap=${overlap.length}  left_pending=${stillPending}`);
  console.log(problems.length ? `  FAIL:\n   - ${problems.join('\n   - ')}` : '  PASS: disjoint + complete, no double-lease');

  await Promise.all([w1.end(), w2.end(), admin.end()]);
  process.exit(problems.length ? 1 : 0);
}
main().catch((e) => { console.error('RACE CRASH:', e); process.exit(2); });
