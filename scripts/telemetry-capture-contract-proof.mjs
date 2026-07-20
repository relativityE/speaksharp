#!/usr/bin/env node
/* eslint-env node */
/**
 * LIVE capture-contract proof for the telemetry worker's PostHog delivery path.
 *
 * Proves the ACTUAL contract end-to-end (a mocked 200 is insufficient): it POSTs to the same PROVEN
 * ingest path the worker uses — POST {ingestHost}/capture/ — with the worker's exact payload shape,
 * then reads the event back through the PostHog Query API querying SOLELY by the unique $insert_id.
 *
 * Timestamp/window: uses a UNIQUE run nonce and a RECENT timestamp (a few minutes in the past — proves
 * historical replay while staying inside any reasonable query window). The old proof combined a fixed
 * 2026-07-18 timestamp with a last-day query and could never pass; this one queries by $insert_id.
 *
 * Dedupe honesty: two RAW rows with the same $insert_id are duplicate delivery — count=2 is NOT
 * dedupe. The proof asserts a SINGLE send yields exactly one stored event, then separately sends the
 * SAME $insert_id again and reports PostHog's raw count HONESTLY. The primary send-once guarantee is
 * the OUTBOX (a row marked 'sent' is never re-claimed — proven by the DB behavioral harness); PostHog
 * $insert_id dedupe is only a secondary net, and this proof reports whether it actually holds.
 *
 * Marked automated_test provenance. Runs in the activation sequence (post-deploy) via a
 * workflow_dispatch proof workflow; stdout evidence is uploaded with retention-days: 1.
 */
import { randomUUID } from 'node:crypto';

const req = (k, alts = []) => {
  for (const key of [k, ...alts]) { if (process.env[key]) return process.env[key]; }
  throw new Error(`PROOF_NOT_RUNNABLE: ${k} required`);
};

const projectKey = req('POSTHOG_PROJECT_API_KEY', ['VITE_POSTHOG_KEY']);
const personalKey = req('POSTHOG_PERSONAL_API_KEY');
const projectId = req('POSTHOG_PROJECT_ID');
const ingestHost = req('POSTHOG_INGEST_HOST', ['VITE_POSTHOG_HOST']).replace(/\/$/, '');
const apiHost = (process.env.POSTHOG_API_HOST ?? 'https://us.posthog.com').replace(/\/$/, '');
const serverVerifiedSha = process.env.TELEMETRY_WORKER_RELEASE_SHA ?? process.env.GITHUB_SHA ?? 'proof-local';

const nonce = `gha-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}-${randomUUID().slice(0, 8)}`;
const EVENT = 'telemetry_worker_capture_proof'; // dedicated proof event — does not pollute product streams
const distinctId = `automated_test-${nonce}`;
const insertId = `capture_proof:${nonce}`;
const historicalTs = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // recent past → within window, proves historical

const expected = {
  event: EVENT, distinct_id: distinctId, $insert_id: insertId, timestamp: historicalTs,
  data_origin: 'automated_test', cohort_id: 'internal_diagnostics', test_run_id: nonce,
  test_suite: 'telemetry_capture_contract', server_verified_release_sha: serverVerifiedSha,
};

const payload = {
  api_key: projectKey, event: EVENT, distinct_id: distinctId, timestamp: historicalTs,
  properties: {
    $insert_id: insertId, server_replayed: true, data_origin: 'automated_test',
    cohort_id: 'internal_diagnostics', test_run_id: nonce, test_suite: 'telemetry_capture_contract',
    environment: 'production', server_verified_release_sha: serverVerifiedSha,
  },
};

async function capture(label) {
  const res = await fetch(`${ingestHost}/capture/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`capture(${label}) rejected HTTP ${res.status}: ${body.slice(0, 200)}`);
  console.log(`CAPTURE_PROOF capture ${label} accepted status=${res.status}`);
}

async function hogql(sql) {
  const res = await fetch(`${apiHost}/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: 'POST', headers: { Authorization: `Bearer ${personalKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query: sql } }),
  });
  if (!res.ok) throw new Error(`query API HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json())?.results ?? [];
}

async function poll(fn, { tries = 20, delayMs = 3000 } = {}) {
  for (let i = 0; i < tries; i++) { const r = await fn(); if (r) return r; await new Promise((res) => setTimeout(res, delayMs)); }
  throw new Error('readback timed out');
}

// RAW rows for this $insert_id (no GROUP — so count reflects real stored rows, not logical groups).
const rawRowsSql = `SELECT event, distinct_id, properties.$insert_id, toString(timestamp),
    properties.data_origin, properties.cohort_id, properties.test_run_id, properties.test_suite,
    properties.server_verified_release_sha
  FROM events WHERE properties.$insert_id = '${insertId}'`;

async function main() {
  const failures = [];

  // 1. SINGLE send → exactly one stored event with correct fields (the real-world path).
  await capture('single');
  const rows1 = await poll(async () => { const r = await hogql(rawRowsSql); return r.length ? r : null; });
  if (rows1.length !== 1) failures.push(`single send: expected exactly 1 stored event, got ${rows1.length}`);
  const [event, did, iid, ts, origin, cohort, runId, suite, sha] = rows1[0];
  const check = (name, got, want) => { if (String(got) !== String(want)) failures.push(`${name}: expected ${want}, got ${got}`); };
  check('event', event, expected.event);
  check('distinct_id', did, expected.distinct_id);
  check('$insert_id', iid, expected.$insert_id);
  check('data_origin', origin, expected.data_origin);
  check('cohort_id', cohort, expected.cohort_id);
  check('test_run_id', runId, expected.test_run_id);
  check('test_suite', suite, expected.test_suite);
  check('server_verified_release_sha', sha, expected.server_verified_release_sha);
  if (new Date(ts).getTime() !== new Date(expected.timestamp).getTime()) failures.push(`timestamp: expected historical ${expected.timestamp}, got ${ts}`);

  // 2. NEGATIVE controls — wrong event / identity must NOT satisfy the query.
  const wrongEvent = await hogql(`SELECT count() FROM events WHERE properties.$insert_id='${insertId}' AND event='not_${EVENT}'`);
  if (Number(wrongEvent[0]?.[0] ?? 0) !== 0) failures.push('negative control: wrong event name matched');
  const wrongId = await hogql(`SELECT count() FROM events WHERE properties.$insert_id='${insertId}' AND distinct_id='someone-else'`);
  if (Number(wrongId[0]?.[0] ?? 0) !== 0) failures.push('negative control: wrong distinct_id matched');

  // 3. REPLAY the SAME $insert_id, then POLL to a conclusion: either two raw rows appear (proving NO
  // dedupe) OR the documented maximum observation window expires with exactly one row. Six seconds is
  // not enough to conclusively claim dedupe, so we poll to the window. PostHog dedupe is only OBSERVED
  // secondary behavior — the authoritative guarantee is outbox send-once.
  await capture('replay-same-insert-id');
  const MAX_OBSERVE_MS = Number(process.env.CAPTURE_PROOF_MAX_OBSERVE_MS ?? '120000');
  const observeStart = Date.now();
  let rawCount = 0;
  for (;;) {
    const raw = await hogql(`SELECT count() FROM events WHERE properties.$insert_id='${insertId}'`);
    rawCount = Number(raw[0]?.[0] ?? 0);
    if (rawCount >= 2) break;                                  // conclusive: NO dedupe
    if (Date.now() - observeStart >= MAX_OBSERVE_MS) break;    // window elapsed with ≤1 row
    await new Promise((res) => setTimeout(res, 5000));
  }
  const posthogDedupes = rawCount === 1; // after the full window, still exactly one → dedupe observed

  console.log(`CAPTURE_PROOF_EVIDENCE ${JSON.stringify({
    nonce, expected, single_send_stored: rows1.length, replay_raw_count: rawCount,
    observation_window_ms: MAX_OBSERVE_MS,
    posthog_insert_id_dedupes_observed: posthogDedupes, // OBSERVED secondary behavior only
    primary_guarantee: 'outbox_send_once (a sent row is never re-claimed; proven by the DB harness)',
    failures,
  })}`);
  if (!posthogDedupes) {
    // Honest: PostHog stored duplicates. NOT a proof failure — the outbox never actually re-sends a
    // sent row, so real delivery is send-once regardless of PostHog's secondary dedupe.
    console.log(`CAPTURE_PROOF NOTE: PostHog stored ${rawCount} rows for one $insert_id → PostHog dedupe is NOT reliable; the guarantee is outbox send-once.`);
  }

  if (failures.length) { console.error(`CAPTURE_PROOF FAILED:\n - ${failures.join('\n - ')}`); process.exit(1); }
  console.log('CAPTURE_PROOF PASSED: ingest accepted + single-send readback (exactly one) + all fields + negative controls; replay dedupe reported honestly.');
}

main().catch((e) => { console.error('CAPTURE_PROOF ERROR:', e.message); process.exit(2); });
