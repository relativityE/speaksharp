#!/usr/bin/env node
/* eslint-env node */
/* global console, process */
/**
 * END-TO-END proof that the PROOF-ONLY telemetry worker delivers ITS claimed outbox record correctly
 * (distinct from telemetry-capture-contract-proof.mjs, which only proves the transport endpoint).
 *
 * Steps (all service-role; content-free — synthetic session only):
 *   1. register a synthetic automated_test actor (unique test_run_id);
 *   2. create ONE synthetic completed session for that actor → the trigger enqueues one automated_test
 *      session_saved outbox row;
 *   3. snapshot the ids+status of all OTHER pending outbox rows;
 *   4. invoke telemetry-worker in PROOF mode (x-telemetry-worker-secret + x-telemetry-proof-record +
 *      x-telemetry-proof-event); assert proof_mode=true, claimed=1, sent=1, result=success;
 *   5. query PostHog by the WORKER event's exact $insert_id `session_saved:<record_id>` and validate
 *      event name, original timestamp, and all provenance fields;
 *   6. assert NO other pending outbox row changed status;
 *   7. cleanup (best-effort): delete the synthetic row(s) + expire the actor.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEMETRY_WORKER_URL, TELEMETRY_WORKER_SECRET,
 *      POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID, POSTHOG_API_HOST, PROOF_TEST_EMAIL,
 *      TELEMETRY_WORKER_RELEASE_SHA (server-verified sha to expect).
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`PROOF_NOT_RUNNABLE: ${k} required`); return v; };
const SUPABASE_URL = need('SUPABASE_URL');
const SERVICE_KEY = need('SUPABASE_SERVICE_ROLE_KEY');
const WORKER_URL = need('TELEMETRY_WORKER_URL');
const WORKER_SECRET = need('TELEMETRY_WORKER_SECRET');
const PH_KEY = need('POSTHOG_PERSONAL_API_KEY');
const PH_PROJECT = need('POSTHOG_PROJECT_ID');
const PH_API = (process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com').replace(/\/$/, '');
const PROOF_EMAIL = need('PROOF_TEST_EMAIL');
const EXPECTED_SHA = process.env.TELEMETRY_WORKER_RELEASE_SHA ?? null;

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const runId = `proof-${process.env.GITHUB_RUN_ID ?? 'local'}-${randomUUID().slice(0, 8)}`;
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

async function resolveUser(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const u = (data?.users ?? []).find((x) => (x.email ?? '').toLowerCase() === email.toLowerCase());
    if (u) return u.id;
    if ((data?.users ?? []).length < 200) break;
  }
  throw new Error('proof account not found');
}

async function hogql(sql) {
  const res = await fetch(`${PH_API}/api/projects/${encodeURIComponent(PH_PROJECT)}/query/`, {
    method: 'POST', headers: { Authorization: `Bearer ${PH_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
  });
  if (!res.ok) throw new Error(`query API ${res.status}`);
  return (await res.json())?.results ?? [];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let userId, sessionId;
async function main() {
  userId = await resolveUser(PROOF_EMAIL);

  // 1. register automated_test provenance
  const { error: regErr } = await supabase.rpc('register_observability_actor', {
    p_user_id: userId, p_data_origin: 'automated_test', p_cohort_id: 'proof', p_test_run_id: runId, p_test_suite: 'telemetry_proof_worker_e2e', p_ttl: '1 hour',
  });
  if (regErr) throw new Error(`register: ${regErr.message}`);

  // 3. snapshot OTHER pending rows BEFORE creating ours
  const before = new Map(((await supabase.from('telemetry_outbox').select('id,status').eq('status', 'pending')).data ?? []).map((r) => [r.id, r.status]));

  // 2. create ONE synthetic completed session → trigger enqueues the automated_test outbox row
  const ins = await supabase.from('sessions').insert({ user_id: userId, status: 'completed', engine: 'Private', duration: 123, total_words: 200, wpm: 97, clarity_score: 88 }).select('id').single();
  if (ins.error) throw new Error(`insert session: ${ins.error.message}`);
  sessionId = ins.data.id;
  const insertId = `session_saved:${sessionId}`;

  // 4. invoke the worker in PROOF mode
  const wres = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'x-telemetry-worker-secret': WORKER_SECRET, 'x-telemetry-proof-record': sessionId, 'x-telemetry-proof-event': 'session_saved', 'content-type': 'application/json' },
    body: '{}',
  });
  const wbody = await wres.json().catch(() => ({}));
  check(wbody.proof_mode === true, `worker proof_mode!=true (${JSON.stringify(wbody).slice(0, 120)})`);
  check(Number(wbody.claimed) === 1, `claimed!=1 (${wbody.claimed})`);
  check(Number(wbody.sent) === 1, `sent!=1 (${wbody.sent})`);
  check(wbody.result === 'success', `result!=success (${wbody.result})`);

  // 5. PostHog readback by the WORKER event's exact $insert_id
  let row = null;
  for (let i = 0; i < 20 && !row; i++) {
    const r = await hogql(`SELECT event, toString(timestamp), properties.data_origin, properties.cohort_id, properties.test_run_id, properties.test_suite, properties.environment, properties.server_verified_release_sha
      FROM events WHERE properties.$insert_id = '${insertId}'`);
    if (r.length) row = r[0]; else await sleep(3000);
  }
  check(!!row, `no PostHog event for $insert_id ${insertId}`);
  if (row) {
    const [event, , origin, cohort, trid, suite, env, sha] = row;
    check(event === 'session_saved', `event!=session_saved (${event})`);
    check(origin === 'automated_test', `data_origin!=automated_test (${origin})`);
    check(cohort === 'proof', `cohort!=proof (${cohort})`);
    check(trid === runId, `test_run_id!=${runId} (${trid})`);
    check(suite === 'telemetry_proof_worker_e2e', `test_suite mismatch (${suite})`);
    check(env === 'production', `environment!=production (${env})`);
    if (EXPECTED_SHA) check(sha === EXPECTED_SHA, `server_verified_release_sha!=${EXPECTED_SHA} (${sha})`);
  }

  // 6. no OTHER pending row changed status
  const after = new Map(((await supabase.from('telemetry_outbox').select('id,status').in('id', [...before.keys()])).data ?? []).map((r) => [r.id, r.status]));
  for (const [id, st] of before) check(after.get(id) === st, `other pending row ${id} changed ${st}→${after.get(id)}`);

  console.log(`PROOF_WORKER_E2E_EVIDENCE ${JSON.stringify({ runId, record_id: sessionId, insert_id: insertId, worker: { proof_mode: wbody.proof_mode, claimed: wbody.claimed, sent: wbody.sent, result: wbody.result }, readback: !!row, other_pending_unchanged: [...before].every(([id, st]) => after.get(id) === st), failures })}`);
}

async function cleanup() {
  try { if (sessionId) { await supabase.from('telemetry_outbox').delete().eq('record_id', sessionId); await supabase.from('sessions').delete().eq('id', sessionId); } } catch { /* best effort */ }
  try { if (userId) await supabase.rpc('expire_observability_actor', { p_user_id: userId }); } catch { /* best effort */ }
}

main()
  .then(async () => { await cleanup(); if (failures.length) { console.error(`PROOF_WORKER_E2E FAILED:\n - ${failures.join('\n - ')}`); process.exit(1); } console.log('PROOF_WORKER_E2E PASSED'); })
  .catch(async (e) => { await cleanup(); console.error('PROOF_WORKER_E2E ERROR:', e.message); process.exit(2); });
