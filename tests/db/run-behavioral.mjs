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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = resolve(HERE, '../../backend/supabase/migrations');
const sql = (p) => readFileSync(p, 'utf8');

// Driver adapter: DATABASE_URL → real multi-connection postgres (node-postgres); otherwise PGlite
// (PostgreSQL/WASM, fast + hermetic). The SAME suite runs on both — the full behavioral contract must
// hold against the real engine, not only the WASM one.
async function makeDb() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pg = (await import('pg')).default;
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    return { engine: 'postgres:16', exec: (s) => client.query(s), query: (s, p) => client.query(s, p), close: () => client.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite();
  return { engine: 'pglite/wasm', exec: (s) => pglite.exec(s), query: (s, p) => pglite.query(s, p), close: () => pglite.close() };
}

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

let db; // assigned in main() from makeDb() — PGlite or real postgres
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
  db = await makeDb();
  // ---- load schema ----
  await db.exec(sql(resolve(HERE, 'harness/bootstrap.sql')));
  await db.exec(sql(resolve(MIG, '20260720120000_report_alert_deliveries.sql')));
  await db.exec(sql(resolve(MIG, '20260720140000_report_session_ownership_guard.sql')));
  await db.exec(sql(resolve(MIG, '20260720150000_observability_provenance_registry.sql')));
  await db.exec(sql(resolve(MIG, '20260720150100_telemetry_outbox.sql')));
  await db.exec(sql(resolve(MIG, '20260720160000_report_alert_outbox.sql')));
  await db.exec(sql(resolve(MIG, '20260720170000_operator_report_retrieval.sql')));

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
  await expectDenied('C2 anon cannot read observability_actor_registry', 'anon', `SELECT * FROM public.observability_actor_registry LIMIT 1`);
  await expectDenied('C2b authenticated cannot read observability_actor_registry', 'authenticated', `SELECT * FROM public.observability_actor_registry LIMIT 1`);

  // EVERY RPC must be denied to BOTH untrusted roles.
  const RPC_CALLS = {
    reconcile_telemetry_outbox: `SELECT public.reconcile_telemetry_outbox()`,
    claim_telemetry_batch: `SELECT public.claim_telemetry_batch(1,'w')`,
    claim_telemetry_proof_row: `SELECT public.claim_telemetry_proof_row(gen_random_uuid(),'session_saved','w')`,
    mark_telemetry_result: `SELECT public.mark_telemetry_result(gen_random_uuid(),gen_random_uuid(),'sent',NULL)`,
    discard_telemetry_event: `SELECT public.discard_telemetry_event(gen_random_uuid(),gen_random_uuid())`,
    replay_telemetry_deadletter: `SELECT public.replay_telemetry_deadletter(gen_random_uuid())`,
    enqueue_telemetry_event: `SELECT public.enqueue_telemetry_event('session_saved',gen_random_uuid(),gen_random_uuid(),now(),NULL)`,
    operator_telemetry_delivery_status: `SELECT public.operator_telemetry_delivery_status(gen_random_uuid())`,
    resolve_actor_provenance: `SELECT public.resolve_actor_provenance(gen_random_uuid())`,
    resolve_data_origin: `SELECT public.resolve_data_origin(gen_random_uuid())`,
  };
  for (const role of ['anon', 'authenticated']) {
    for (const [fn, callSql] of Object.entries(RPC_CALLS)) {
      await expectDenied(`C3 ${role} cannot EXECUTE ${fn}`, role, callSql);
    }
  }
  // EVERY RPC must be callable by service_role (executes without a permission error; result ignored).
  await check('C4 service_role CAN EXECUTE every worker/operator RPC', async () => {
    await db.exec('SET ROLE service_role');
    try {
      for (const callSql of Object.values(RPC_CALLS)) await q(callSql);
    } finally { await db.exec('RESET ROLE'); }
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
  await check('F6 mark sent persists the WORKER deploy SHA as server_verified (client SHA stays untrusted)', async () => {
    // report row carries a client SHA from metadata; the worker verifies with its OWN deploy sha.
    const id = (await one(`INSERT INTO public.user_issue_reports (user_id,metadata)
      VALUES ('${U1}', '{"appRuntimeConfig":{"release":"client-sha-xyz"}}'::jsonb) RETURNING id`)).id;
    const r = await claimRow(id, 'w1');
    const ok = (await one(`SELECT public.mark_telemetry_result('${r.id}','${r.lease_token}','sent',NULL,'server-verified-deploy-777') AS ok`)).ok;
    eq(ok, true, 'mark sent should succeed');
    const o = await one(`SELECT status,client_release_sha,server_verified_release_sha FROM public.telemetry_outbox WHERE id='${r.id}'`);
    eq(o.status, 'sent', 'sent'); eq(o.client_release_sha, 'client-sha-xyz', 'client sha unchanged/untrusted');
    eq(o.server_verified_release_sha, 'server-verified-deploy-777', 'server-verified = worker deploy sha');
  });
  await check('F5 reconcile also stamps all four provenance fields on a backfilled row', async () => {
    const s = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${UREG}','completed') RETURNING id`);
    await q(`DELETE FROM public.telemetry_outbox WHERE record_id='${s.id}'`);
    await q(`SELECT public.reconcile_telemetry_outbox()`);
    const o = await one(`SELECT data_origin,cohort_id,test_run_id,test_suite,backfilled FROM public.telemetry_outbox WHERE record_id='${s.id}' AND event_type='session_saved'`);
    eq(o.data_origin, 'automated_test', 'origin'); eq(o.cohort_id, 'cohort-x', 'cohort');
    eq(o.test_run_id, 'run-9', 'run'); eq(o.test_suite, 'suite-b', 'suite'); assert(o.backfilled === true, 'backfilled');
  });

  await check('F7 register-before-write: registered provenance flows to a NEW session', async () => {
    const u = 'b0000001-0000-0000-0000-000000000001';
    await db.exec(`INSERT INTO auth.users (id,email) VALUES ('${u}','reg-before')`);
    await q(`SELECT public.register_observability_actor('${u}','automated_test','ci','run-77','suite-x', interval '1 hour')`);
    const s = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${u}','completed') RETURNING id`);
    const o = await one(`SELECT data_origin,test_run_id,test_suite FROM public.telemetry_outbox WHERE record_id='${s.id}' AND event_type='session_saved'`);
    eq(o.data_origin, 'automated_test', 'registered origin flows in'); eq(o.test_run_id, 'run-77', 'run id'); eq(o.test_suite, 'suite-x', 'suite');
  });
  await check('F8 expire_observability_actor reverts new data to legacy_unclassified', async () => {
    const u = 'b0000001-0000-0000-0000-000000000001';
    await q(`SELECT public.expire_observability_actor('${u}')`);
    const p = await one(`SELECT data_origin FROM public.resolve_actor_provenance('${u}')`);
    eq(p.data_origin, 'legacy_unclassified', 'expired registration → default');
  });

  await check('F9 proof claim leases ONLY an automated_test row; refuses others; cannot touch other records', async () => {
    // registered automated_test actor (UREG) → its session row is automated_test.
    const sAuto = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${UREG}','completed') RETURNING id`);
    // an unregistered actor (U1) → legacy_unclassified row.
    const sLegacy = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${U1}','completed') RETURNING id`);
    // refuses the legacy row (returns nothing)
    const legacyClaim = (await q(`SELECT * FROM public.claim_telemetry_proof_row('${sLegacy.id}','session_saved','p')`)).rows;
    eq(legacyClaim.length, 0, 'proof claim must refuse a non-automated_test row');
    eq((await one(`SELECT status FROM public.telemetry_outbox WHERE record_id='${sLegacy.id}' AND event_type='session_saved'`)).status, 'pending', 'legacy row untouched');
    // claims the automated_test row and ONLY it
    const autoClaim = (await q(`SELECT record_id FROM public.claim_telemetry_proof_row('${sAuto.id}','session_saved','p')`)).rows;
    eq(autoClaim.length, 1, 'proof claim leases the automated_test row'); eq(autoClaim[0].record_id, sAuto.id, 'exactly the specified record');
    eq((await one(`SELECT status FROM public.telemetry_outbox WHERE record_id='${sLegacy.id}' AND event_type='session_saved'`)).status, 'pending', 'other records still untouched');
  });

  // ============================ G. operator delivery status ============================
  group('G operator delivery status');
  await check('G1 EXACT per-account counts; zero cross-account leak (fresh isolated users)', async () => {
    const UG1 = 'a0000001-0000-0000-0000-000000000001';
    const UG2 = 'a0000002-0000-0000-0000-000000000002';
    await db.exec(`INSERT INTO auth.users (id,email) VALUES ('${UG1}','g1'),('${UG2}','g2')`);
    // UG1: exactly 2 completed sessions. UG2: exactly 1 completed session + 1 report.
    await q(`INSERT INTO public.sessions (user_id,status) VALUES ('${UG1}','completed'),('${UG1}','completed')`);
    await q(`INSERT INTO public.sessions (user_id,status) VALUES ('${UG2}','completed')`);
    await q(`INSERT INTO public.user_issue_reports (user_id) VALUES ('${UG2}')`);
    const g1 = (await q(`SELECT event_type,status,n FROM public.operator_telemetry_delivery_status('${UG1}')`)).rows;
    const g2 = (await q(`SELECT event_type,status,n FROM public.operator_telemetry_delivery_status('${UG2}')`)).rows;
    // UG1: EXACTLY one row — session_saved/pending/2 — and NOTHING else (proves UG2 never leaks in).
    eq(g1.length, 1, 'UG1 must have exactly one status row');
    eq(g1[0].event_type, 'session_saved', 'UG1 event'); eq(g1[0].status, 'pending', 'UG1 status');
    eq(Number(g1[0].n), 2, 'UG1 EXACT count = 2 (would be 3 if UG2 leaked)');
    // UG2: session_saved=1 AND report_issue_submitted=1.
    const g2s = g2.find((r) => r.event_type === 'session_saved');
    const g2r = g2.find((r) => r.event_type === 'report_issue_submitted');
    assert(g2s && g2r, 'UG2 must see both event types');
    eq(Number(g2s.n), 1, 'UG2 exact session count'); eq(Number(g2r.n), 1, 'UG2 exact report count');
  });

  // ============================ H. hardening / adversarial proofs ============================
  group('H hardening');
  await check('H1 forced enqueue EXCEPTION cannot lose the source row; reconcile repairs it', async () => {
    // Break enqueue so the trigger's PERFORM raises; the EXCEPTION guard must swallow it and still persist.
    await db.exec(`CREATE OR REPLACE FUNCTION public.enqueue_telemetry_event(p_event_type text,p_record_id uuid,p_user_id uuid,p_event_timestamp timestamptz,p_client_release_sha text,p_backfilled boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $x$ BEGIN RAISE EXCEPTION 'forced enqueue failure'; END; $x$;`);
    const s = await one(`INSERT INTO public.sessions (user_id,status) VALUES ('${U1}','completed') RETURNING id`);
    eq((await one(`SELECT count(*)::int c FROM public.sessions WHERE id='${s.id}'`)).c, 1, 'session persists despite enqueue throwing');
    eq((await one(`SELECT count(*)::int c FROM public.telemetry_outbox WHERE record_id='${s.id}'`)).c, 0, 'no outbox row after the failure');
    // Restore the real enqueue (re-exec migration is idempotent) and reconcile → gap repaired.
    await db.exec(sql(resolve(MIG, '20260720150100_telemetry_outbox.sql')));
    await q(`SELECT public.reconcile_telemetry_outbox()`);
    const o = await one(`SELECT backfilled FROM public.telemetry_outbox WHERE record_id='${s.id}' AND event_type='session_saved'`);
    assert(o && o.backfilled === true, 'reconcile must repair the missed enqueue');
  });
  await check('H2 an UNEXPIRED sending row cannot be reclaimed by another worker', async () => {
    const sid = await mkDue();
    const r = await claimRow(sid, 'w1'); assert(r, 'first claim'); // sending, ~5min lease
    const again = await claimRow(sid, 'w2');
    assert(!again, 'a live-leased row must not be handed to a second worker');
  });
  await check('H3 after reclaim: stale token fails, current token succeeds', async () => {
    const sid = await mkDue();
    const a = await claimRow(sid, 'w1');
    await q(`UPDATE public.telemetry_outbox SET lease_expires_at = now() - interval '1 min' WHERE id='${a.id}'`);
    const b = await claimRow(sid, 'w2'); assert(b, 'expired lease reclaimed'); // same row id, new token, fresh lease
    eq((await one(`SELECT public.mark_telemetry_result('${b.id}','${a.lease_token}','sent',NULL) AS ok`)).ok, false, 'stale token must be rejected');
    eq((await one(`SELECT public.mark_telemetry_result('${b.id}','${b.lease_token}','sent',NULL,'sha') AS ok`)).ok, true, 'current token succeeds');
  });
  await check('H4 repeated dead-letter replay returns false (idempotent)', async () => {
    const sid = await mkDue();
    const row0 = await one(`SELECT id FROM public.telemetry_outbox WHERE record_id='${sid}' AND event_type='session_saved'`);
    await q(`UPDATE public.telemetry_outbox SET max_attempts=1 WHERE id='${row0.id}'`);
    const r = await claimRow(sid, 'w1');
    await q(`SELECT public.mark_telemetry_result('${r.id}','${r.lease_token}','failed','unknown')`); // → dead_letter
    eq((await one(`SELECT public.replay_telemetry_deadletter('${r.id}') AS ok`)).ok, true, 'first replay succeeds');
    eq((await one(`SELECT public.replay_telemetry_deadletter('${r.id}') AS ok`)).ok, false, 'second replay (now pending) returns false');
  });
  await expectDenied('H5 anon cannot INSERT the outbox (browser cannot fabricate provenance)', 'anon',
    `INSERT INTO public.telemetry_outbox (event_type,record_id,insert_id,event_timestamp,data_origin) VALUES ('session_saved',gen_random_uuid(),'x',now(),'production_user')`);
  await expectDenied('H6 authenticated cannot EXECUTE enqueue (no client-driven provenance path)', 'authenticated',
    `SELECT public.enqueue_telemetry_event('session_saved',gen_random_uuid(),gen_random_uuid(),now(),NULL)`);
  await check('H7 discard is a terminal tombstone (unexpired lease required; clears lease; not retryable)', async () => {
    const sid = await mkDue();
    const r = await claimRow(sid, 'w1');
    // stale/expired lease cannot discard
    eq((await one(`SELECT public.discard_telemetry_event('${r.id}', gen_random_uuid()) AS ok`)).ok, false, 'wrong token cannot discard');
    // current lease discards → terminal 'discarded' with terminal_failed_at, lease cleared
    eq((await one(`SELECT public.discard_telemetry_event('${r.id}','${r.lease_token}') AS ok`)).ok, true, 'current lease discards');
    const o = await one(`SELECT status,terminal_failed_at,lease_token,claimed_by FROM public.telemetry_outbox WHERE id='${r.id}'`);
    eq(o.status, 'discarded', 'terminal discarded'); assert(o.terminal_failed_at, 'terminal_failed_at set');
    eq(o.lease_token, null, 'lease cleared'); eq(o.claimed_by, null, 'claimed_by cleared');
    // a discarded row is never re-claimed
    const again = await claimRow(sid, 'w2');
    assert(!again, 'discarded row must not be re-claimed');
  });

  // ============================ I. report-alert outbox (server-authoritative) ============================
  group('I report-alert outbox');
  const mkReport = async (u = U1) => (await one(`INSERT INTO public.user_issue_reports (user_id) VALUES ('${u}') RETURNING id`)).id;
  await check('I1 DB trigger enqueues a pending alert row at report insert (server-authoritative)', async () => {
    const rid = await mkReport();
    const d = await one(`SELECT status,attempt_count FROM public.report_alert_deliveries WHERE report_id='${rid}'`);
    assert(d, 'alert row enqueued by trigger'); eq(d.status, 'pending', 'pending'); eq(d.attempt_count, 0, 'attempt 0');
  });
  await check('I2 reconcile_report_alerts repairs a report missing an alert row', async () => {
    const rid = await mkReport();
    await q(`DELETE FROM public.report_alert_deliveries WHERE report_id='${rid}'`);
    const n = (await one(`SELECT public.reconcile_report_alerts() AS n`)).n;
    assert(Number(n) >= 1, 'reconcile repaired at least one');
    assert((await one(`SELECT 1 FROM public.report_alert_deliveries WHERE report_id='${rid}'`)), 'row restored');
  });
  await check('I3 claim leases; mark sent; a sent row is never re-claimed (dedupe)', async () => {
    const rid = await mkReport();
    const token = (await one(`SELECT public.claim_report_alert('${rid}','w1') AS t`)).t;
    assert(token, 'claim returns a lease token');
    eq((await one(`SELECT public.mark_report_alert('${rid}','${token}','sent',NULL) AS ok`)).ok, true, 'mark sent');
    eq((await one(`SELECT public.claim_report_alert('${rid}','w2') AS t`)).t, null, 'a sent alert is not re-claimable');
  });
  await check('I4 crash-safe: an EXPIRED sending lease is reclaimable', async () => {
    const rid = await mkReport();
    const a = (await one(`SELECT public.claim_report_alert('${rid}','w1') AS t`)).t;
    await q(`UPDATE public.report_alert_deliveries SET lease_expires_at=now()-interval '1 min' WHERE report_id='${rid}'`);
    const b = (await one(`SELECT public.claim_report_alert('${rid}','w2') AS t`)).t;
    assert(b && a !== b, 'expired lease reclaimed with a fresh token');
  });
  await check('I5 stale lease token rejected by mark; current token succeeds', async () => {
    const rid = await mkReport();
    const a = (await one(`SELECT public.claim_report_alert('${rid}','w1') AS t`)).t;
    await q(`UPDATE public.report_alert_deliveries SET lease_expires_at=now()-interval '1 min' WHERE report_id='${rid}'`);
    const b = (await one(`SELECT public.claim_report_alert('${rid}','w2') AS t`)).t;
    eq((await one(`SELECT public.mark_report_alert('${rid}','${a}','sent',NULL) AS ok`)).ok, false, 'stale token rejected');
    eq((await one(`SELECT public.mark_report_alert('${rid}','${b}','sent',NULL) AS ok`)).ok, true, 'current token succeeds');
  });
  await check('I6 dead-letter at max_attempts + idempotent replay', async () => {
    const rid = await mkReport();
    await q(`UPDATE public.report_alert_deliveries SET max_attempts=1 WHERE report_id='${rid}'`);
    const t = (await one(`SELECT public.claim_report_alert('${rid}','w1') AS t`)).t; // attempt→1
    eq((await one(`SELECT public.mark_report_alert('${rid}','${t}','failed','transport_error') AS ok`)).ok, true, 'mark failed');
    eq((await one(`SELECT status,terminal_failed_at FROM public.report_alert_deliveries WHERE report_id='${rid}'`)).status, 'dead_letter', 'dead_letter');
    eq((await one(`SELECT public.replay_report_alert_deadletter('${rid}') AS ok`)).ok, true, 'first replay');
    eq((await one(`SELECT public.replay_report_alert_deadletter('${rid}') AS ok`)).ok, false, 'repeated replay false');
  });
  await check('I7 mark input validation (sent+category and failed+bad-category raise)', async () => {
    const rid = await mkReport();
    const t = (await one(`SELECT public.claim_report_alert('${rid}','w1') AS t`)).t;
    let r1 = false, r2 = false;
    try { await q(`SELECT public.mark_report_alert('${rid}','${t}','sent','transport_error')`); } catch { r1 = true; }
    try { await q(`SELECT public.mark_report_alert('${rid}','${t}','failed','not_a_category')`); } catch { r2 = true; }
    assert(r1 && r2, 'invalid mark inputs must raise');
  });
  // permissions: every alert RPC + the table denied to both untrusted roles; service_role allowed.
  await expectDenied('I8 anon cannot read report_alert_deliveries', 'anon', `SELECT * FROM public.report_alert_deliveries LIMIT 1`);
  const ALERT_RPCS = {
    reconcile_report_alerts: `SELECT public.reconcile_report_alerts()`,
    claim_report_alert: `SELECT public.claim_report_alert(gen_random_uuid(),'w')`,
    claim_report_alert_batch: `SELECT public.claim_report_alert_batch(1,'w')`,
    mark_report_alert: `SELECT public.mark_report_alert(gen_random_uuid(),gen_random_uuid(),'sent',NULL)`,
    replay_report_alert_deadletter: `SELECT public.replay_report_alert_deadletter(gen_random_uuid())`,
  };
  for (const role of ['anon', 'authenticated']) {
    for (const [fn, callSql] of Object.entries(ALERT_RPCS)) {
      await expectDenied(`I9 ${role} cannot EXECUTE ${fn}`, role, callSql);
    }
  }
  await check('I10 service_role CAN EXECUTE every alert RPC', async () => {
    await db.exec('SET ROLE service_role');
    try { for (const callSql of Object.values(ALERT_RPCS)) await q(callSql); } finally { await db.exec('RESET ROLE'); }
  });
  // Direct TABLE privileges (final migrated state): untrusted roles denied every DML; service_role ok.
  for (const role of ['anon', 'authenticated']) {
    await expectDenied(`I11 ${role} direct SELECT denied`, role, `SELECT * FROM public.report_alert_deliveries LIMIT 1`);
    await expectDenied(`I11 ${role} direct INSERT denied`, role, `INSERT INTO public.report_alert_deliveries (report_id) VALUES (gen_random_uuid())`);
    await expectDenied(`I11 ${role} direct UPDATE denied`, role, `UPDATE public.report_alert_deliveries SET status='sent'`);
    await expectDenied(`I11 ${role} direct DELETE denied`, role, `DELETE FROM public.report_alert_deliveries`);
  }
  await check('I12 service_role direct SELECT/UPDATE/DELETE/INSERT all succeed (BYPASSRLS + grants)', async () => {
    const rid = await mkReport();          // trigger enqueues its delivery row
    const rid2 = await mkReport();
    await db.exec('SET ROLE service_role');
    try {
      assert(Number((await one(`SELECT count(*)::int c FROM public.report_alert_deliveries WHERE report_id='${rid}'`)).c) >= 1, 'select');
      await q(`UPDATE public.report_alert_deliveries SET claimed_by='svc-test' WHERE report_id='${rid}'`);
      await q(`DELETE FROM public.report_alert_deliveries WHERE report_id='${rid2}'`);
      await q(`INSERT INTO public.report_alert_deliveries (report_id, status) VALUES ('${rid2}','pending')`); // re-insert after delete
    } finally { await db.exec('RESET ROLE'); }
  });

  await check('I13 alert provenance is SNAPSHOTTED at insert and stable through registry expiry/change', async () => {
    const u = 'c0000001-0000-0000-0000-000000000001';
    await db.exec(`INSERT INTO auth.users (id,email) VALUES ('${u}','snap')`);
    await q(`SELECT public.register_observability_actor('${u}','automated_test','ci','run-snap','suite-snap', interval '1 hour')`);
    const rid = (await one(`INSERT INTO public.user_issue_reports (user_id) VALUES ('${u}') RETURNING id`)).id;
    const s1 = await one(`SELECT data_origin,test_run_id,test_suite FROM public.report_alert_deliveries WHERE report_id='${rid}'`);
    eq(s1.data_origin, 'automated_test', 'snapshot at insert'); eq(s1.test_run_id, 'run-snap', 'run snapshotted');
    // registry EXPIRES then a DIFFERENT registration lands AFTER the report was created
    await q(`SELECT public.expire_observability_actor('${u}')`);
    await q(`SELECT public.register_observability_actor('${u}','production_user','x','run-DIFFERENT','s2', interval '1 hour')`);
    // delayed claim + delivery — the snapshot must be UNCHANGED (original marker preserved)
    const token = (await one(`SELECT public.claim_report_alert('${rid}','w') AS t`)).t;
    assert(token, 'claimable'); await q(`SELECT public.mark_report_alert('${rid}','${token}','sent',NULL)`);
    const s2 = await one(`SELECT data_origin,test_run_id FROM public.report_alert_deliveries WHERE report_id='${rid}'`);
    eq(s2.data_origin, 'automated_test', 'snapshot UNCHANGED after registry expiry/change'); eq(s2.test_run_id, 'run-snap', 'run unchanged');
  });
  await check('I14 anonymous report snapshots legacy_unclassified', async () => {
    const rid = (await one(`INSERT INTO public.user_issue_reports (user_id) VALUES (NULL) RETURNING id`)).id;
    eq((await one(`SELECT data_origin FROM public.report_alert_deliveries WHERE report_id='${rid}'`)).data_origin, 'legacy_unclassified', 'anon → legacy');
  });

  // ============================ J. protected operator report retrieval ============================
  group('J operator report retrieval');
  await check('J1 service_role retrieves the FULL report by id (authorized succeeds)', async () => {
    const rid = await mkReport();
    await db.exec('SET ROLE service_role');
    try {
      const row = await one(`SELECT (public.operator_get_report('${rid}')).id AS id`);
      eq(row.id, rid, 'operator retrieval returns the report');
    } finally { await db.exec('RESET ROLE'); }
  });
  await expectDenied('J2 anon cannot EXECUTE operator_get_report (fails closed)', 'anon', `SELECT public.operator_get_report(gen_random_uuid())`);
  await expectDenied('J3 authenticated cannot EXECUTE operator_get_report (fails closed)', 'authenticated', `SELECT public.operator_get_report(gen_random_uuid())`);

  // ---- report ----
  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  console.log(`\n===== BEHAVIORAL HARNESS RESULTS (engine: ${db.engine}) =====`);
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
