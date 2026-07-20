#!/usr/bin/env node
/* eslint-env node */
/* global console, process */
/**
 * END-TO-END proof that the PROOF-ONLY telemetry worker delivers ITS claimed outbox record correctly
 * (distinct from telemetry-capture-contract-proof.mjs, which only proves the transport endpoint).
 *
 * This script does the PROOF only. It writes the created ids to $PROOF_STATE_FILE so a SEPARATE
 * workflow cleanup step (telemetry-proof-worker-cleanup.mjs, run with `if: always()`) expires the actor,
 * deletes the synthetic session/outbox rows, and VERIFIES deletion — failing the workflow on any
 * cleanup error. Cleanup is NOT best-effort inside this script.
 *
 * Assertions:
 *   - register a synthetic automated_test actor (unique test_run_id);
 *   - create ONE synthetic completed session → the trigger enqueues one automated_test session_saved row;
 *   - snapshot the ids+status of all OTHER pending outbox rows;
 *   - invoke the worker in PROOF mode; validate the HTTP STATUS before any body assertion;
 *   - assert proof_mode=true, claimed=1, sent=1, result=success;
 *   - PostHog: EXACTLY ONE event for `session_saved:<record_id>` (count==1 — two rows = duplicate);
 *   - compare the PostHog event timestamp with the AUTHORITATIVE outbox event_timestamp;
 *   - validate event name + all provenance fields + server_verified_release_sha;
 *   - assert NO other pending outbox row changed status.
 *
 * Evidence: content-free; raw ids are HASHED where the raw value is unnecessary.
 */
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
const STATE_FILE = process.env.PROOF_STATE_FILE ?? '/tmp/proof-worker-state.json';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const runId = `proof-${process.env.GITHUB_RUN_ID ?? 'local'}-${randomUUID().slice(0, 8)}`;
const hash = (s) => 'h' + createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
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

async function main() {
  const userId = await resolveUser(PROOF_EMAIL);
  // persist state IMMEDIATELY so the always() cleanup can act even if we throw mid-run.
  const state = { userId, sessionId: null, runId };
  const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state));
  saveState();

  const { error: regErr } = await supabase.rpc('register_observability_actor', {
    p_user_id: userId, p_data_origin: 'automated_test', p_cohort_id: 'proof', p_test_run_id: runId, p_test_suite: 'telemetry_proof_worker_e2e', p_ttl: '1 hour',
  });
  if (regErr) throw new Error(`register: ${regErr.message}`);

  // snapshot OTHER pending rows BEFORE creating ours
  const before = new Map(((await supabase.from('telemetry_outbox').select('id,status').eq('status', 'pending')).data ?? []).map((r) => [r.id, r.status]));

  const ins = await supabase.from('sessions').insert({ user_id: userId, status: 'completed', engine: 'Private', duration: 123, total_words: 200, wpm: 97, clarity_score: 88 }).select('id').single();
  if (ins.error) throw new Error(`insert session: ${ins.error.message}`);
  state.sessionId = ins.data.id; saveState();
  const sessionId = ins.data.id;
  const insertId = `session_saved:${sessionId}`;

  // authoritative outbox event_timestamp for this record (what the worker MUST send as the event ts)
  const authRow = (await supabase.from('telemetry_outbox').select('event_timestamp').eq('event_type', 'session_saved').eq('record_id', sessionId).maybeSingle()).data;
  const authTs = authRow?.event_timestamp ?? null;
  check(!!authTs, 'authoritative outbox event_timestamp missing');

  // invoke the worker in PROOF mode — validate HTTP STATUS before body
  const wres = await fetch(WORKER_URL, {
    method: 'POST',
    headers: { 'x-telemetry-worker-secret': WORKER_SECRET, 'x-telemetry-proof-record': sessionId, 'x-telemetry-proof-event': 'session_saved', 'content-type': 'application/json' },
    body: '{}',
  });
  check(wres.status === 200, `worker HTTP status!=200 (${wres.status})`);
  let wbody = {};
  if (wres.status === 200) {
    wbody = await wres.json().catch(() => ({}));
    check(wbody.proof_mode === true, `proof_mode!=true`);
    check(Number(wbody.claimed) === 1, `claimed!=1 (${wbody.claimed})`);
    check(Number(wbody.sent) === 1, `sent!=1 (${wbody.sent})`);
    check(wbody.result === 'success', `result!=success (${wbody.result})`);
  }

  // PostHog readback — require EXACTLY ONE event; count==2 is duplicate delivery, not success.
  let rows = [];
  for (let i = 0; i < 20; i++) {
    rows = await hogql(`SELECT event, toString(timestamp), properties.data_origin, properties.cohort_id, properties.test_run_id, properties.test_suite, properties.environment, properties.server_verified_release_sha, count() AS n
      FROM events WHERE properties.$insert_id = '${insertId}'
      GROUP BY event, toString(timestamp), properties.data_origin, properties.cohort_id, properties.test_run_id, properties.test_suite, properties.environment, properties.server_verified_release_sha`);
    const total = (await hogql(`SELECT count() FROM events WHERE properties.$insert_id='${insertId}'`))[0]?.[0] ?? 0;
    if (Number(total) >= 1) { check(Number(total) === 1, `expected EXACTLY 1 stored event, got ${total}`); break; }
    await sleep(3000);
  }
  check(rows.length === 1, `expected 1 logical event group, got ${rows.length}`);
  if (rows.length === 1) {
    const [event, ts, origin, cohort, trid, suite, env, sha] = rows[0];
    check(event === 'session_saved', `event!=session_saved (${event})`);
    check(origin === 'automated_test', `data_origin!=automated_test (${origin})`);
    check(cohort === 'proof', `cohort!=proof`);
    check(trid === runId, `test_run_id mismatch`);
    check(suite === 'telemetry_proof_worker_e2e', `test_suite mismatch`);
    check(env === 'production', `environment!=production (${env})`);
    if (EXPECTED_SHA) check(sha === EXPECTED_SHA, `server_verified_release_sha mismatch`);
    if (authTs) check(new Date(ts).getTime() === new Date(authTs).getTime(), `PostHog ts != authoritative outbox ts (${ts} vs ${authTs})`);
  }

  // no OTHER pending row changed status
  const after = new Map(((await supabase.from('telemetry_outbox').select('id,status').in('id', [...before.keys()])).data ?? []).map((r) => [r.id, r.status]));
  let leaked = 0;
  for (const [id, st] of before) if (after.get(id) !== st) leaked++;
  check(leaked === 0, `${leaked} other pending row(s) changed status`);

  console.log(`PROOF_WORKER_E2E_EVIDENCE ${JSON.stringify({
    run: hash(runId), record: hash(sessionId), insert_id: hash(insertId),
    worker: { http: wres.status, proof_mode: wbody.proof_mode, claimed: wbody.claimed, sent: wbody.sent, result: wbody.result },
    readback_logical_groups: rows.length, other_pending_unchanged: leaked === 0, failures,
  })}`);
  if (failures.length) { console.error(`PROOF_WORKER_E2E FAILED:\n - ${failures.join('\n - ')}`); process.exit(1); }
  console.log('PROOF_WORKER_E2E PASSED');
}

main().catch((e) => { console.error('PROOF_WORKER_E2E ERROR:', e.message); process.exit(2); });
