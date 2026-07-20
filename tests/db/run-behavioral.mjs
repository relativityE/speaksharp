/* global console, process */
/**
 * REAL ephemeral-PostgreSQL behavioral harness for the P0 telemetry-outbox foundation.
 *
 * Engine: PGlite — PostgreSQL's own C source compiled to WASM. It runs the genuine planner/executor,
 * plpgsql, triggers, RLS, roles, GRANT/REVOKE, and SECURITY DEFINER — NOT a JS reimplementation and
 * NOT jsdom/regex/in-memory-fake. The datadir is ephemeral (memory://); nothing persists.
 *
 * It loads: harness/bootstrap.sql (auth schema + auth.users stub, anon/authenticated/service_role
 * roles, minimal sessions + user_issue_reports), then the three incident migrations verbatim from
 * backend/supabase/migrations. It then exercises behavioral cases A–F and prints exact results.
 *
 * Content-free: only synthetic UUIDs/fixtures. No tester content, no secrets.
 *
 * SCOPE / LIMITATION: PGlite is single-connection, so cases D1–D4 prove lease correctness (token
 * ownership, expiry reclaim, wrong/expired-token rejection) but NOT genuine parallel contention. The
 * `FOR UPDATE SKIP LOCKED` disjointness guarantee under two simultaneous workers is proven separately
 * by tests/db/skiplocked-race.mjs against a real multi-connection postgres:16 in CI.
 *
 * Run:  node tests/db/run-behavioral.mjs
 * Exit: 0 iff every case passes.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = resolve(HERE, '../../backend/supabase/migrations');
const sql = (p) => readFileSync(p, 'utf8');

const results = [];
let currentGroup = '';
const group = (g) => { currentGroup = g; };
async function check(name, fn) {
  try {
    await fn();
    results.push({ group: currentGroup, name, ok: true });
  } catch (e) {
    results.push({ group: currentGroup, name, ok: false, detail: String(e && e.message ? e.message : e) });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (String(a) !== String(b)) throw new Error(`${msg}: expected ${b}, got ${a}`); }

const db = new PGlite(); // ephemeral in-WASM datadir
const q = (text, params) => db.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0];
// Claim due rows and return the outbox row for a specific record_id (session/report id). Uses the max
// batch so the target is always included regardless of ordering.
async function claimRow(recordId, worker = 'w1') {
  const rows = (await q(`SELECT * FROM public.claim_telemetry_batch(200, '${worker}')`)).rows;
  return rows.find((r) => r.record_id === recordId);
}
// PGlite's extended protocol rejects multiple commands per query, so switch role via exec() (simple
// protocol) and run the single tested statement via query(). Always RESET ROLE, even on error.
async function expectDenied(name, role, text) {
  await check(name, async () => {
    await db.exec(`SET ROLE ${role}`);
    let denied = false;
    try { await db.query(text); }
    catch (e) { denied = /permission denied|must be|not allowed|no privileges/i.test(String(e.message)); if (!denied) { await db.exec('RESET ROLE'); throw e; } }
    await db.exec('RESET ROLE');
    assert(denied, 'expected a permission error, but the statement succeeded');
  });
}

// Synthetic actors.
const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';
const UREG = '33333333-3333-3333-3333-333333333333';   // registered automated_test actor
const UEXP = '44444444-4444-4444-4444-444444444444';   // expired registry row

async function main() {
  // ---- load schema ----
  await db.exec(sql(resolve(HERE, 'harness/bootstrap.sql')));
  await db.exec(sql(resolve(MIG, '20260720140000_report_session_ownership_guard.sql')));
  await db.exec(sql(resolve(MIG, '20260720150000_observability_provenance_registry.sql')));
  await db.exec(sql(resolve(MIG, '20260720150100_telemetry_outbox.sql')));

  await db.exec(`INSERT INTO auth.users (id,email) VALUES
    ('${U1}','u1'),('${U2}','u2'),('${UREG}','ureg'),('${UEXP}','uexp');`);
  // provenance registrations
  await db.exec(`INSERT INTO public.observability_actor_registry (user_id,data_origin,cohort_id,test_run_id,test_suite)
    VALUES ('${UREG}','automated_test','cohort-x','run-9','suite-b');`);
  await db.exec(`INSERT INTO public.observability_actor_registry (user_id,data_origin,cohort_id,test_run_id,test_suite,expires_at)
    VALUES ('${UEXP}','automated_test','c','r','s', now() - interval '1 day');`);

  // ============================ A. ownership guard ============================
  group('A ownership');
  const sA1 = (await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${U1}','completed') RETURNING id`)).id;
  const sA2 = (await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${U2}','completed') RETURNING id`)).id;

  await check('A1 same-owner session_id retained', async () => {
    const r = await one(`INSERT INTO public.user_issue_reports (user_id,session_id) VALUES ('${U1}','${sA1}') RETURNING session_id`);
    eq(r.session_id, sA1, 'session_id should be kept');
  });
  await check('A2 cross-owner session_id coerced to NULL', async () => {
    const r = await one(`INSERT INTO public.user_issue_reports (user_id,session_id) VALUES ('${U1}','${sA2}') RETURNING session_id`);
    eq(r.session_id, null, 'foreign session must be nulled');
  });
  await check('A3 anonymous report cannot claim a session', async () => {
    const r = await one(`INSERT INTO public.user_issue_reports (user_id,session_id) VALUES (NULL,'${sA1}') RETURNING session_id`);
    eq(r.session_id, null, 'anon report session must be nulled');
  });
  await check('A4 UPDATE user_id to non-owner re-nulls session_id', async () => {
    const id = (await one(`INSERT INTO public.user_issue_reports (user_id,session_id) VALUES ('${U1}','${sA1}') RETURNING id`)).id;
    const r = await one(`UPDATE public.user_issue_reports SET user_id='${U2}' WHERE id='${id}' RETURNING session_id`);
    eq(r.session_id, null, 'ownership must be revalidated on user_id change');
  });

  // ============================ B. enqueue + reconcile ============================
  group('B enqueue/reconcile');
  await check('B1 completed session enqueues session_saved (insert_id + event_timestamp=updated_at)', async () => {
    const s = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${U1}','completed') RETURNING id, updated_at`);
    const o = await one(`SELECT insert_id,event_type,event_timestamp,status FROM public.telemetry_outbox WHERE event_type='session_saved' AND record_id='${s.id}'`);
    assert(o, 'expected an outbox row');
    eq(o.insert_id, `session_saved:${s.id}`, 'insert_id');
    eq(new Date(o.event_timestamp).getTime(), new Date(s.updated_at).getTime(), 'event_timestamp = completion time');
    eq(o.status, 'pending', 'new rows are pending');
  });
  await check('B2 non-completed session does NOT enqueue; UPDATE to completed does', async () => {
    const id = (await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${U1}','recording') RETURNING id`)).id;
    let n = (await one(`SELECT count(*)::int c FROM public.telemetry_outbox WHERE record_id='${id}'`)).c;
    eq(n, 0, 'recording session must not enqueue');
    await q(`UPDATE public.sessions SET status='completed' WHERE id='${id}'`);
    n = (await one(`SELECT count(*)::int c FROM public.telemetry_outbox WHERE record_id='${id}' AND event_type='session_saved'`)).c;
    eq(n, 1, 'completing the session enqueues exactly one row');
  });
  await check('B3 report enqueues with UNTRUSTED client_release_sha from metadata', async () => {
    const id = (await one(`INSERT INTO public.user_issue_reports (user_id,metadata)
      VALUES ('${U1}', '{"appRuntimeConfig":{"release":"abc123"}}'::jsonb) RETURNING id`)).id;
    const o = await one(`SELECT client_release_sha,server_verified_release_sha FROM public.telemetry_outbox WHERE event_type='report_issue_submitted' AND record_id='${id}'`);
    eq(o.client_release_sha, 'abc123', 'client sha from metadata');
    eq(o.server_verified_release_sha, null, 'server-verified must never be filled from client');
  });
  await check('B4 reconcile repairs a deleted outbox row (backfilled=true) and reports count', async () => {
    const s = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${U1}','completed') RETURNING id`);
    await q(`DELETE FROM public.telemetry_outbox WHERE record_id='${s.id}'`); // simulate the incident gap
    const n = (await one(`SELECT public.reconcile_telemetry_outbox() AS n`)).n;
    assert(Number(n) >= 1, 'reconcile should repair at least the deleted row');
    const o = await one(`SELECT backfilled FROM public.telemetry_outbox WHERE record_id='${s.id}' AND event_type='session_saved'`);
    assert(o && o.backfilled === true, 'reconciled row must be flagged backfilled');
  });
  await check('B5 dedupe: trigger + reconcile never double-insert', async () => {
    const s = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${U1}','completed') RETURNING id`);
    await q(`SELECT public.reconcile_telemetry_outbox()`); // would re-insert but for the unique key
    const n = (await one(`SELECT count(*)::int c FROM public.telemetry_outbox WHERE record_id='${s.id}' AND event_type='session_saved'`)).c;
    eq(n, 1, 'exactly one row per (event_type, record_id)');
  });

  // ============================ C. permissions (role boundary) ============================
  group('C permissions');
  await expectDenied('C1 anon cannot read telemetry_outbox', 'anon', `SELECT * FROM public.telemetry_outbox LIMIT 1`);
  await expectDenied('C2 authenticated cannot read observability_actor_registry', 'authenticated', `SELECT * FROM public.observability_actor_registry LIMIT 1`);
  await expectDenied('C3 anon cannot EXECUTE claim_telemetry_batch', 'anon', `SELECT public.claim_telemetry_batch(10,'w')`);
  await check('C4 service_role CAN EXECUTE claim_telemetry_batch', async () => {
    await db.exec('SET ROLE service_role');
    try { await q(`SELECT public.claim_telemetry_batch(1,'svc')`); } finally { await db.exec('RESET ROLE'); }
  });

  // ============================ D. leases / concurrency ============================
  group('D leases');
  const mkDue = async (u = U1) => (await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${u}','completed') RETURNING id`)).id;
  await check('D1 claim leases a due row (sending, token, +5min expiry, attempt++)', async () => {
    const sid = await mkDue();
    const r = await claimRow(sid, 'w1');
    assert(r, 'target row must be claimed'); eq(r.status, 'sending', 'status'); assert(r.lease_token, 'lease_token set');
    assert(new Date(r.lease_expires_at).getTime() > Date.now(), 'lease in the future');
    eq(r.attempt_count, 1, 'attempt incremented'); eq(r.claimed_by, 'w1', 'claimed_by');
  });
  await check('D2 expired sending lease is reclaimed with a fresh token', async () => {
    const sid = await mkDue();
    const a = await claimRow(sid, 'w1');
    await q(`UPDATE public.telemetry_outbox SET lease_expires_at = now() - interval '1 min' WHERE id='${a.id}'`);
    const b = await claimRow(sid, 'w2');
    assert(b, 'expired lease should be re-claimable'); assert(a.lease_token !== b.lease_token, 'new token on reclaim');
    eq(b.attempt_count, 2, 'attempt incremented again');
  });
  await check('D3 mark with WRONG lease token is rejected (returns false, row unchanged)', async () => {
    const sid = await mkDue();
    const r = await claimRow(sid, 'w1');
    const ok = (await one(`SELECT public.mark_telemetry_result('${r.id}', gen_random_uuid(), 'sent', NULL) AS ok`)).ok;
    eq(ok, false, 'wrong token must not own the row');
    eq((await one(`SELECT status FROM public.telemetry_outbox WHERE id='${r.id}'`)).status, 'sending', 'row unchanged');
  });
  await check('D4 mark with EXPIRED lease is rejected even with the right token', async () => {
    const sid = await mkDue();
    const r = await claimRow(sid, 'w1');
    await q(`UPDATE public.telemetry_outbox SET lease_expires_at = now() - interval '1 min' WHERE id='${r.id}'`);
    const ok = (await one(`SELECT public.mark_telemetry_result('${r.id}','${r.lease_token}','sent',NULL) AS ok`)).ok;
    eq(ok, false, 'expired lease must not mark');
  });

  // ============================ E. retry / dead-letter ============================
  group('E retry/dead-letter');
  await check('E1 mark failed → failed, backoff scheduled, category set, lease cleared', async () => {
    const sid = await mkDue();
    const r = await claimRow(sid, 'w1');
    const ok = (await one(`SELECT public.mark_telemetry_result('${r.id}','${r.lease_token}','failed','transport_error') AS ok`)).ok;
    eq(ok, true, 'mark should succeed');
    const o = await one(`SELECT status,last_failure_category,next_retry_at,lease_token,claimed_by FROM public.telemetry_outbox WHERE id='${r.id}'`);
    eq(o.status, 'failed', 'status'); eq(o.last_failure_category, 'transport_error', 'category');
    assert(new Date(o.next_retry_at).getTime() > Date.now(), 'retry scheduled forward');
    eq(o.lease_token, null, 'lease token cleared'); eq(o.claimed_by, null, 'claimed_by cleared');
  });
  let deadOutboxId;
  await check('E2 attempts exhausted → dead_letter with terminal_failed_at', async () => {
    const sid = await mkDue();
    const row0 = await one(`SELECT id FROM public.telemetry_outbox WHERE record_id='${sid}' AND event_type='session_saved'`);
    await q(`UPDATE public.telemetry_outbox SET max_attempts=1 WHERE id='${row0.id}'`);
    const r = await claimRow(sid, 'w1'); // attempt→1, equals max_attempts
    deadOutboxId = r.id;
    const ok = (await one(`SELECT public.mark_telemetry_result('${r.id}','${r.lease_token}','failed','ingest_rejected') AS ok`)).ok;
    eq(ok, true, 'mark should succeed');
    const o = await one(`SELECT status,terminal_failed_at FROM public.telemetry_outbox WHERE id='${r.id}'`);
    eq(o.status, 'dead_letter', 'terminal state'); assert(o.terminal_failed_at, 'terminal_failed_at set');
  });
  await check('E3 mark sent WITH a failure_category raises', async () => {
    const sid = await mkDue();
    const r = await claimRow(sid, 'w1');
    let raised = false;
    try { await q(`SELECT public.mark_telemetry_result('${r.id}','${r.lease_token}','sent','unknown')`); } catch { raised = true; }
    assert(raised, 'sent+category must raise');
  });
  await check('E4 mark failed WITHOUT a category raises', async () => {
    const sid = await mkDue();
    const r = await claimRow(sid, 'w1');
    let raised = false;
    try { await q(`SELECT public.mark_telemetry_result('${r.id}','${r.lease_token}','failed',NULL)`); } catch { raised = true; }
    assert(raised, 'failed without category must raise');
  });
  await check('E5 replay_telemetry_deadletter resets to pending and clears terminal state', async () => {
    const ok = (await one(`SELECT public.replay_telemetry_deadletter('${deadOutboxId}') AS ok`)).ok;
    eq(ok, true, 'replay should succeed');
    const o = await one(`SELECT status,attempt_count,terminal_failed_at,lease_token FROM public.telemetry_outbox WHERE id='${deadOutboxId}'`);
    eq(o.status, 'pending', 'back to pending'); eq(o.attempt_count, 0, 'attempts reset');
    eq(o.terminal_failed_at, null, 'terminal cleared'); eq(o.lease_token, null, 'lease cleared');
  });

  // ============================ F. provenance ============================
  group('F provenance');
  await check('F1 unregistered actor → legacy_unclassified, null cohort/run/suite', async () => {
    const p = await one(`SELECT * FROM public.resolve_actor_provenance('${U1}')`);
    eq(p.data_origin, 'legacy_unclassified', 'default origin');
    eq(p.cohort_id, null, 'cohort'); eq(p.test_run_id, null, 'run'); eq(p.test_suite, null, 'suite');
  });
  await check('F2 registered actor → all four marker fields resolved', async () => {
    const p = await one(`SELECT * FROM public.resolve_actor_provenance('${UREG}')`);
    eq(p.data_origin, 'automated_test', 'origin'); eq(p.cohort_id, 'cohort-x', 'cohort');
    eq(p.test_run_id, 'run-9', 'run'); eq(p.test_suite, 'suite-b', 'suite');
  });
  await check('F3 expired registry row falls back to legacy_unclassified', async () => {
    const p = await one(`SELECT * FROM public.resolve_actor_provenance('${UEXP}')`);
    eq(p.data_origin, 'legacy_unclassified', 'expired → default');
  });
  await check('F4 enqueue stamps ALL four provenance fields on the outbox row', async () => {
    const s = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${UREG}','completed') RETURNING id`);
    const o = await one(`SELECT data_origin,cohort_id,test_run_id,test_suite FROM public.telemetry_outbox WHERE record_id='${s.id}' AND event_type='session_saved'`);
    eq(o.data_origin, 'automated_test', 'origin'); eq(o.cohort_id, 'cohort-x', 'cohort');
    eq(o.test_run_id, 'run-9', 'run'); eq(o.test_suite, 'suite-b', 'suite');
  });
  await check('F5 reconcile also stamps all four provenance fields on a backfilled row', async () => {
    const s = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${UREG}','completed') RETURNING id`);
    await q(`DELETE FROM public.telemetry_outbox WHERE record_id='${s.id}'`);
    await q(`SELECT public.reconcile_telemetry_outbox()`);
    const o = await one(`SELECT data_origin,cohort_id,test_run_id,test_suite,backfilled FROM public.telemetry_outbox WHERE record_id='${s.id}' AND event_type='session_saved'`);
    eq(o.data_origin, 'automated_test', 'origin'); eq(o.cohort_id, 'cohort-x', 'cohort');
    eq(o.test_run_id, 'run-9', 'run'); eq(o.test_suite, 'suite-b', 'suite'); assert(o.backfilled === true, 'backfilled');
  });

  // ---- report ----
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log('\n===== BEHAVIORAL HARNESS RESULTS (PGlite — real PostgreSQL/WASM) =====');
  let g = '';
  for (const r of results) {
    if (r.group !== g) { g = r.group; console.log(`\n[${g}]`); }
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        └─ ${r.detail}`}`);
  }
  console.log(`\n----- ${pass}/${results.length} passed, ${fail} failed -----`);
  await db.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error('HARNESS CRASH:', e); process.exit(2); });
