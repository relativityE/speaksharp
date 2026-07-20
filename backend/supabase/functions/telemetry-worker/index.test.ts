import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  anonDistinctId,
  buildCapturePayload,
  buildReportProps,
  buildSessionProps,
  classifyDeliveryFailure,
  handler,
  isApprovedPosthogHost,
  sumFillerWords,
  type WorkerDeps,
} from './index.ts';

// ---------- pure core ----------

Deno.test('classifyDeliveryFailure: 4xx=ingest_rejected, 429/5xx/network=transport_error', () => {
  assertEquals(classifyDeliveryFailure(400), 'ingest_rejected');
  assertEquals(classifyDeliveryFailure(429), 'transport_error');
  assertEquals(classifyDeliveryFailure(503), 'transport_error');
  assertEquals(classifyDeliveryFailure(null), 'transport_error');
});

Deno.test('sumFillerWords: sums the jsonb count-map, tolerates junk', () => {
  assertEquals(sumFillerWords({ um: 3, uh: 2, like: 1 }), 6);
  assertEquals(sumFillerWords({}), 0);
  assertEquals(sumFillerWords(null), null);
  assertEquals(sumFillerWords('nope'), null);
  assertEquals(sumFillerWords({ a: 'x', b: 2 }), 2);
});

Deno.test('buildSessionProps: allowlist only; never leaks transcript/title/ground_truth', () => {
  const src = {
    user_id: 'u', engine: 'Private', duration: 300, total_words: 500, wpm: 100, clarity_score: 88,
    accuracy: 0.97, filler_words: { um: 2, uh: 1 },
    transcript: 'SECRET', title: 'SECRET', ground_truth: 'SECRET', custom_words: { x: 1 },
  };
  const p = buildSessionProps(src);
  assertEquals(p, { mode: 'Private', duration_seconds: 300, word_count: 500, wpm: 100, clarity_score: 88, accuracy: 0.97, filler_count: 3 });
  const keys = Object.keys(p);
  for (const forbidden of ['transcript', 'title', 'ground_truth', 'custom_words', 'user_id']) assert(!keys.includes(forbidden));
});

Deno.test('buildReportProps: allowlist only; never reads description/page_url/userAgent', () => {
  const src = {
    user_id: 'u', category: 'billing_subscription', severity: 'high', session_id: 's',
    metadata: { route: '/session', sttMode: 'Cloud', userAgent: 'SECRET', appRuntimeConfig: { release: 'r' } },
    title: 'SECRET', description: 'SECRET email x@y.com', page_url: 'https://x?token=SECRET',
  };
  const p = buildReportProps(src);
  assertEquals(p, { issue_category: 'billing_subscription', issue_severity: 'high', session_id: 's', route: '/session', mode: 'Cloud' });
  const serialized = JSON.stringify(p);
  assert(!serialized.includes('SECRET') && !serialized.includes('x@y.com'));
});

Deno.test('buildCapturePayload: $insert_id, historical timestamp, untrusted client SHA, product props merged', () => {
  const row = {
    id: 'o', event_type: 'session_saved', record_id: 'r', insert_id: 'session_saved:r',
    event_timestamp: '2026-07-19T10:00:00Z', lease_token: 'lt', attempt_count: 1, max_attempts: 8,
    data_origin: 'production_user', cohort_id: null, test_run_id: null, test_suite: null,
    client_release_sha: 'client-abc', environment: 'production', backfilled: false,
  } as const;
  const p = buildCapturePayload({ row, distinctId: 'u1', productProps: { mode: 'Private', wpm: 99 }, projectKey: 'phc_x', serverVerifiedSha: 'deploy-1' });
  assertEquals(p.event, 'session_saved');
  assertEquals(p.distinct_id, 'u1');
  assertEquals(p.timestamp, '2026-07-19T10:00:00Z');
  const props = p.properties as Record<string, unknown>;
  assertEquals(props.$insert_id, 'session_saved:r');
  assertEquals(props.server_replayed, true);
  assertEquals(props.client_release_sha_untrusted, 'client-abc');
  assertEquals(props.server_verified_release_sha, 'deploy-1');
  assertEquals(props.mode, 'Private');
  assertEquals(props.wpm, 99);
  assert(!Object.keys(props).includes('client_release_sha'));
});

Deno.test('anonDistinctId: stable, non-PII, record-scoped', () => {
  assertEquals(anonDistinctId('rec-1'), 'anon-report-rec-1');
});

Deno.test('isApprovedPosthogHost: HTTPS on posthog.com only', () => {
  assert(isApprovedPosthogHost('https://us.i.posthog.com'));
  assert(isApprovedPosthogHost('https://eu.posthog.com'));
  assert(!isApprovedPosthogHost('http://us.i.posthog.com'));      // not https
  assert(!isApprovedPosthogHost('https://evil.com'));             // wrong host
  assert(!isApprovedPosthogHost('https://posthog.com.evil.com')); // suffix trick
  assert(!isApprovedPosthogHost('not-a-url'));
});

// ---------- handler (fakes) ----------

type FakeRow = Record<string, unknown> & { id: string; record_id: string; event_type: string; lease_token: string };

function makeSupabase(opts: {
  rows: FakeRow[]; reconcile?: number; reconcileErr?: unknown; claimErr?: unknown;
  sources?: Record<string, Record<string, unknown> | null>; statusById?: Record<string, string>;
  markData?: boolean; markErr?: unknown; discardData?: boolean;
  proofRows?: FakeRow[]; proofErr?: unknown;
}) {
  const calls = { rpc: [] as Array<{ name: string; args: Record<string, unknown> }> };
  const supa = {
    calls,
    rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      if (name === 'reconcile_telemetry_outbox') return Promise.resolve({ data: opts.reconcile ?? 0, error: opts.reconcileErr ?? null });
      if (name === 'claim_telemetry_batch') return Promise.resolve({ data: opts.rows, error: opts.claimErr ?? null });
      if (name === 'claim_telemetry_proof_row') return Promise.resolve({ data: opts.proofRows ?? [], error: opts.proofErr ?? null });
      if (name === 'mark_telemetry_result') return Promise.resolve({ data: opts.markData ?? true, error: opts.markErr ?? null });
      if (name === 'discard_telemetry_event') return Promise.resolve({ data: opts.discardData ?? true, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      return {
        select() {
          return {
            eq(_col: string, val: string) {
              return {
                maybeSingle() {
                  if (table === 'telemetry_outbox') return Promise.resolve({ data: { status: opts.statusById?.[val] ?? 'failed' }, error: null });
                  const s = opts.sources?.[val];
                  return Promise.resolve({ data: s === undefined ? null : s, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return supa;
}

const BASE_ENV: Record<string, string> = {
  TELEMETRY_WORKER_SECRET: 'sekret',
  TELEMETRY_WORKER_ENABLED: 'true',
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  POSTHOG_PROJECT_KEY: 'phc_key',
  POSTHOG_HOST: 'https://us.i.posthog.com',
  TELEMETRY_WORKER_RELEASE_SHA: 'deploy-777',
  SENTRY_DSN: 'https://pk@o1.ingest.sentry.io/42',
};

const post = (secret?: string) => new Request('https://edge/telemetry-worker', { method: 'POST', headers: secret ? { 'x-telemetry-worker-secret': secret } : {} });

function depsFor(env: Record<string, string | undefined>, supa: unknown, fetchImpl: typeof fetch, sentryCalls: unknown[]): WorkerDeps {
  return {
    getEnv: (k) => env[k],
    // deno-lint-ignore no-explicit-any
    createSupabase: () => supa as any,
    fetchImpl,
    // deno-lint-ignore no-explicit-any
    captureSentry: ((_dsn: string, ev: any) => { sentryCalls.push(ev); return Promise.resolve({ eventId: 'e', status: 200 }); }) as any,
    now: () => 1_800_000_000_000,
  };
}

const sessionRow = (id: string, rec: string, lease: string): FakeRow => ({
  id, record_id: rec, event_type: 'session_saved', insert_id: `session_saved:${rec}`, lease_token: lease,
  event_timestamp: '2026-07-19T00:00:00Z', attempt_count: 1, max_attempts: 8, data_origin: 'production_user',
  cohort_id: null, test_run_id: null, test_suite: null, client_release_sha: null, environment: 'production', backfilled: false,
});

Deno.test('handler: missing secret → 404, no DB', async () => {
  const supa = makeSupabase({ rows: [] });
  const res = await handler(post(undefined), depsFor(BASE_ENV, supa, () => { throw new Error('no'); }, []));
  assertEquals(res.status, 404);
  assertEquals(supa.calls.rpc.length, 0);
});

Deno.test('handler: any missing required config → 503 with names, never reconcile/claim', async () => {
  for (const k of ['POSTHOG_HOST', 'TELEMETRY_WORKER_RELEASE_SHA', 'SENTRY_DSN']) {
    const supa = makeSupabase({ rows: [sessionRow('o', 'r', 'l')] });
    const env = { ...BASE_ENV, [k]: undefined };
    const res = await handler(post('sekret'), depsFor(env, supa, () => { throw new Error('no'); }, []));
    assertEquals(res.status, 503);
    const body = await res.json();
    assertEquals(body.error, 'config_missing');
    assert((body.missing as string[]).includes(k));
    assertEquals(supa.calls.rpc.length, 0);
  }
});

Deno.test('handler: invalid POSTHOG_HOST → 503 not_runnable, no DB', async () => {
  const supa = makeSupabase({ rows: [] });
  const res = await handler(post('sekret'), depsFor({ ...BASE_ENV, POSTHOG_HOST: 'http://evil.com' }, supa, () => { throw new Error('no'); }, []));
  assertEquals(res.status, 503);
  const body = await res.json();
  assertEquals(body.result, 'not_runnable');
  assertEquals(supa.calls.rpc.length, 0);
});

Deno.test('handler: disabled worker → not_runnable, never claims (overlap-safe)', async () => {
  const supa = makeSupabase({ rows: [sessionRow('o', 'r', 'l')] });
  const res = await handler(post('sekret'), depsFor({ ...BASE_ENV, TELEMETRY_WORKER_ENABLED: undefined }, supa, () => { throw new Error('no'); }, []));
  const body = await res.json();
  assertEquals(body.result, 'not_runnable');
  assertEquals(body.ok, false);
  assertEquals(supa.calls.rpc.length, 0);
});

Deno.test('handler happy path: rolling-window reconcile, /capture/, allowlisted payload, mark sent + SHA', async () => {
  const rows = [sessionRow('o1', 'r1', 'l1')];
  const supa = makeSupabase({ rows, reconcile: 2, sources: { r1: { user_id: 'user-1', engine: 'Private', duration: 300, total_words: 400, wpm: 80, clarity_score: 90, accuracy: 0.95, filler_words: { um: 4 } } } });
  const fetchCalls: Array<{ url: string; body: string }> = [];
  const fetchImpl = ((url: string, init: RequestInit) => { fetchCalls.push({ url: String(url), body: String(init.body) }); return Promise.resolve(new Response('{"status":1}', { status: 200 })); }) as unknown as typeof fetch;
  const sentry: unknown[] = [];
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, fetchImpl, sentry));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.result, 'success');
  assertEquals(body.sent, 1);
  assertEquals(body.reconciled, 2);
  assertEquals(sentry.length, 0);
  // reconcile got a bounded window (never NULL)
  const rec = supa.calls.rpc.find((c) => c.name === 'reconcile_telemetry_outbox')!;
  assert(typeof rec.args.p_since === 'string' && rec.args.p_since.length > 0);
  // hit /capture/ with allowlisted product props + no forbidden keys
  assertEquals(fetchCalls[0].url, 'https://us.i.posthog.com/capture/');
  assert(fetchCalls[0].body.includes('"mode":"Private"') && fetchCalls[0].body.includes('"filler_count":4'));
  assert(!fetchCalls[0].body.includes('transcript'));
  const mark = supa.calls.rpc.find((c) => c.name === 'mark_telemetry_result')!;
  assertEquals(mark.args.p_status, 'sent');
  assertEquals(mark.args.p_server_verified_release_sha, 'deploy-777');
});

Deno.test('handler: source row gone → discard (tombstone), not endless retry', async () => {
  const rows = [sessionRow('o1', 'r-deleted', 'l1')];
  const supa = makeSupabase({ rows, sources: { /* r-deleted absent → null */ } });
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, () => { throw new Error('should not fetch'); }, []));
  const body = await res.json();
  assertEquals(body.discarded, 1);
  assertEquals(body.sent, 0);
  assert(supa.calls.rpc.some((c) => c.name === 'discard_telemetry_event'));
});

Deno.test('handler: anonymous report (null user_id) delivered under stable non-PII id', async () => {
  const rows: FakeRow[] = [{ id: 'o1', record_id: 'rep-1', event_type: 'report_issue_submitted', insert_id: 'report_issue_submitted:rep-1', lease_token: 'l1', event_timestamp: '2026-07-19T00:00:00Z', attempt_count: 1, max_attempts: 8, data_origin: 'legacy_unclassified', cohort_id: null, test_run_id: null, test_suite: null, client_release_sha: null, environment: 'production', backfilled: false }];
  const supa = makeSupabase({ rows, sources: { 'rep-1': { user_id: null, category: 'privacy_data', severity: 'low', session_id: null, metadata: { route: '/x' } } } });
  const bodies: string[] = [];
  const fetchImpl = ((_u: string, init: RequestInit) => { bodies.push(String(init.body)); return Promise.resolve(new Response('{}', { status: 200 })); }) as unknown as typeof fetch;
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, fetchImpl, []));
  assertEquals((await res.json()).sent, 1);
  assert(bodies[0].includes('"distinct_id":"anon-report-rep-1"'));
});

Deno.test('handler failure path: classify, dead-letter, ok:false, sanitized Sentry (no distinct_id)', async () => {
  const rows = [sessionRow('oA', 'rA', 'lA'), sessionRow('oB', 'rB', 'lB')];
  const supa = makeSupabase({ rows, sources: { rA: { user_id: 'user-AAA', engine: 'Private' }, rB: { user_id: 'user-BBB', engine: 'Private' } }, statusById: { oB: 'dead_letter' } });
  let n = 0;
  const fetchImpl = (() => { n += 1; if (n === 1) return Promise.resolve(new Response('bad', { status: 400 })); return Promise.reject(new Error('down')); }) as unknown as typeof fetch;
  const sentry: Array<Record<string, unknown>> = [];
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, fetchImpl, sentry));
  const body = await res.json();
  assertEquals(body.ok, false);
  assertEquals(body.result, 'hard_failure'); // dead_lettered>0
  assertEquals(body.failed, 2);
  assertEquals(body.dead_lettered, 1);
  assertEquals(body.failure_categories.ingest_rejected, 1);
  assertEquals(body.failure_categories.transport_error, 1);
  assertEquals(sentry.length, 1);
  const serialized = JSON.stringify(sentry[0]);
  assert(!serialized.includes('user-AAA') && !serialized.includes('user-BBB'));
});

Deno.test('handler: mark returns false → lease_lost, no double-count, no recursive mark', async () => {
  const rows = [sessionRow('o1', 'r1', 'l1')];
  const supa = makeSupabase({ rows, sources: { r1: { user_id: 'u', engine: 'Private' } }, markData: false });
  const fetchImpl = (() => Promise.resolve(new Response('{}', { status: 200 }))) as unknown as typeof fetch;
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, fetchImpl, []));
  const body = await res.json();
  assertEquals(body.sent, 0);
  assertEquals(body.lease_lost, 1);
  // exactly one mark attempt (no recursive re-mark on a lost lease)
  assertEquals(supa.calls.rpc.filter((c) => c.name === 'mark_telemetry_result').length, 1);
});

Deno.test('handler: retryable failure only (mark ok, no dead-letter) → partial_retry, ok:true', async () => {
  const rows = [sessionRow('o1', 'r1', 'l1')];
  // 500 → transport_error; mark succeeds (default markData true); status re-read = 'failed' (not dead_letter).
  const supa = makeSupabase({ rows, sources: { r1: { user_id: 'u', engine: 'Private' } }, statusById: { o1: 'failed' } });
  const fetchImpl = (() => Promise.resolve(new Response('busy', { status: 503 }))) as unknown as typeof fetch;
  const sentry: unknown[] = [];
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, fetchImpl, sentry));
  const body = await res.json();
  assertEquals(body.result, 'partial_retry');
  assertEquals(body.ok, true);
  assertEquals(body.failed, 1);
  assertEquals(body.dead_lettered, 0);
  assertEquals(sentry.length, 1); // warning-level alert
});

function proofPost(record: string, event: string) {
  return new Request('https://edge/telemetry-worker', {
    method: 'POST',
    headers: { 'x-telemetry-worker-secret': 'sekret', 'x-telemetry-proof-record': record, 'x-telemetry-proof-event': event },
  });
}

Deno.test('handler PROOF mode: delivers exactly the one automated_test row, NO reconcile/batch, bypasses enable gate', async () => {
  const proofRow = { ...sessionRow('op', 'rec-proof', 'lp'), data_origin: 'automated_test' };
  const supa = makeSupabase({ rows: [], proofRows: [proofRow], sources: { 'rec-proof': { user_id: 'u', engine: 'Private' } } });
  const fetchImpl = (() => Promise.resolve(new Response('{}', { status: 200 }))) as unknown as typeof fetch;
  // ENABLED unset → normal mode would be not_runnable, but proof mode bypasses.
  const env = { ...BASE_ENV, TELEMETRY_WORKER_ENABLED: undefined };
  const res = await handler(proofPost('rec-proof', 'session_saved'), depsFor(env, supa, fetchImpl, []));
  const body = await res.json();
  assertEquals(body.proof_mode, true);
  assertEquals(body.sent, 1);
  assertEquals(body.result, 'success');
  // proof mode NEVER reconciles or batch-claims — it can't touch other pending records.
  assert(!supa.calls.rpc.some((c) => c.name === 'reconcile_telemetry_outbox'));
  assert(!supa.calls.rpc.some((c) => c.name === 'claim_telemetry_batch'));
  assert(supa.calls.rpc.some((c) => c.name === 'claim_telemetry_proof_row'));
});

Deno.test('handler PROOF mode: RPC returns nothing (non-automated_test/absent) → not_runnable, no delivery', async () => {
  const supa = makeSupabase({ rows: [], proofRows: [] }); // RPC refuses → empty
  const res = await handler(proofPost('rec-x', 'session_saved'), depsFor({ ...BASE_ENV, TELEMETRY_WORKER_ENABLED: undefined }, supa, () => { throw new Error('no fetch'); }, []));
  const body = await res.json();
  assertEquals(body.result, 'not_runnable');
  assertEquals(body.error, 'no_claimable_automated_test_row');
});

Deno.test('handler PROOF mode: invalid event → 400', async () => {
  const supa = makeSupabase({ rows: [] });
  const res = await handler(proofPost('rec-x', 'not_an_event'), depsFor(BASE_ENV, supa, () => { throw new Error('no'); }, []));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).result, 'not_runnable');
  assert(!supa.calls.rpc.some((c) => c.name === 'claim_telemetry_proof_row'));
});

Deno.test('handler: reconcile RPC error → 500, ok:false, sentry, never claims', async () => {
  const supa = makeSupabase({ rows: [], reconcileErr: { message: 'boom' } });
  const sentry: unknown[] = [];
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, () => { throw new Error('no'); }, sentry));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).ok, false);
  assert(!supa.calls.rpc.some((c) => c.name === 'claim_telemetry_batch'));
  assertEquals(sentry.length, 1);
});
