import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  buildCapturePayload,
  classifyDeliveryFailure,
  handler,
  type WorkerDeps,
} from './index.ts';

// ---------- pure core ----------

Deno.test('classifyDeliveryFailure: 4xx=ingest_rejected, 429/5xx/network=transport_error', () => {
  assertEquals(classifyDeliveryFailure(400), 'ingest_rejected');
  assertEquals(classifyDeliveryFailure(422), 'ingest_rejected');
  assertEquals(classifyDeliveryFailure(429), 'transport_error');
  assertEquals(classifyDeliveryFailure(500), 'transport_error');
  assertEquals(classifyDeliveryFailure(503), 'transport_error');
  assertEquals(classifyDeliveryFailure(null), 'transport_error');
});

Deno.test('buildCapturePayload: $insert_id dedupe, historical timestamp, untrusted client SHA label', () => {
  const row = {
    id: 'o1', event_type: 'session_saved', record_id: 'r1', insert_id: 'session_saved:r1',
    event_timestamp: '2026-07-19T10:00:00Z', lease_token: 'lt', attempt_count: 1, max_attempts: 8,
    data_origin: 'automated_test', cohort_id: 'c', test_run_id: 'run', test_suite: 'suite',
    client_release_sha: 'client-abc', server_verified_release_sha: null, environment: 'production', backfilled: true,
  } as const;
  const p = buildCapturePayload({ row, distinctId: 'user-1', projectKey: 'phc_x', serverVerifiedSha: 'deploy-1' });
  assertEquals(p.event, 'session_saved');
  assertEquals(p.distinct_id, 'user-1');
  assertEquals(p.timestamp, '2026-07-19T10:00:00Z'); // original event time, not now
  assertEquals(p.properties.$insert_id, 'session_saved:r1');
  assertEquals(p.properties.server_replayed, true);
  assertEquals(p.properties.client_release_sha_untrusted, 'client-abc');
  assertEquals(p.properties.server_verified_release_sha, 'deploy-1');
  assertEquals(p.properties.data_origin, 'automated_test');
  // the client SHA is never surfaced under a "verified" key
  assert(!Object.keys(p.properties).includes('client_release_sha'));
});

// ---------- handler (fakes) ----------

type FakeRow = Record<string, unknown> & { id: string; record_id: string; event_type: string; lease_token: string };

function makeSupabase(opts: {
  rows: FakeRow[]; reconcile?: number; userById?: Record<string, string>;
  statusById?: Record<string, string>; markOwned?: boolean;
}) {
  const calls = { rpc: [] as Array<{ name: string; args: unknown }>, tables: [] as string[] };
  const supa = {
    calls,
    rpc(name: string, args: unknown) {
      calls.rpc.push({ name, args });
      if (name === 'reconcile_telemetry_outbox') return Promise.resolve({ data: opts.reconcile ?? 0, error: null });
      if (name === 'claim_telemetry_batch') return Promise.resolve({ data: opts.rows, error: null });
      if (name === 'mark_telemetry_result') return Promise.resolve({ data: opts.markOwned ?? true, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      calls.tables.push(table);
      return {
        select() {
          return {
            eq(_col: string, val: string) {
              return {
                maybeSingle() {
                  if (table === 'telemetry_outbox') return Promise.resolve({ data: { status: opts.statusById?.[val] ?? 'failed' } });
                  const uid = opts.userById?.[val];
                  return Promise.resolve({ data: uid ? { user_id: uid } : null });
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
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  POSTHOG_PROJECT_KEY: 'phc_key',
  POSTHOG_HOST: 'https://us.i.posthog.com',
  TELEMETRY_WORKER_RELEASE_SHA: 'deploy-777',
  SENTRY_DSN: 'https://pk@o1.ingest.sentry.io/42',
};

function post(secret?: string): Request {
  return new Request('https://edge/telemetry-worker', {
    method: 'POST',
    headers: secret ? { 'x-telemetry-worker-secret': secret } : {},
  });
}

function depsFor(env: Record<string, string | undefined>, supa: unknown, fetchImpl: typeof fetch, sentryCalls: unknown[]): WorkerDeps {
  return {
    getEnv: (k) => env[k],
    // deno-lint-ignore no-explicit-any
    createSupabase: () => supa as any,
    fetchImpl,
    // deno-lint-ignore no-explicit-any
    captureSentry: ((_dsn: string, ev: any) => { sentryCalls.push(ev); return Promise.resolve({ eventId: 'e', status: 200 }); }) as any,
  };
}

Deno.test('handler: wrong/missing secret → 404, never touches the DB', async () => {
  const supa = makeSupabase({ rows: [] });
  const res = await handler(post(undefined), depsFor(BASE_ENV, supa, () => { throw new Error('no fetch'); }, []));
  assertEquals(res.status, 404);
  assertEquals(supa.calls.rpc.length, 0);
});

Deno.test('handler: no PostHog key → 503 config_missing and does NOT claim (never burns attempts)', async () => {
  const supa = makeSupabase({ rows: [{ id: 'o', record_id: 'r', event_type: 'session_saved', lease_token: 'l' }] });
  const env = { ...BASE_ENV, POSTHOG_PROJECT_KEY: undefined };
  const res = await handler(post('sekret'), depsFor(env, supa, () => { throw new Error('no fetch'); }, []));
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error, 'config_missing');
  assertEquals(supa.calls.rpc.length, 0); // no reconcile, no claim
});

Deno.test('handler happy path: delivers, marks sent with worker deploy SHA', async () => {
  const rows: FakeRow[] = [
    { id: 'o1', record_id: 'r1', event_type: 'session_saved', insert_id: 'session_saved:r1', lease_token: 'l1', event_timestamp: '2026-07-19T00:00:00Z', attempt_count: 1, max_attempts: 8, data_origin: 'production_user', cohort_id: null, test_run_id: null, test_suite: null, client_release_sha: null, server_verified_release_sha: null, environment: 'production', backfilled: false },
    { id: 'o2', record_id: 'r2', event_type: 'report_issue_submitted', insert_id: 'report_issue_submitted:r2', lease_token: 'l2', event_timestamp: '2026-07-19T01:00:00Z', attempt_count: 1, max_attempts: 8, data_origin: 'production_user', cohort_id: null, test_run_id: null, test_suite: null, client_release_sha: 'c', server_verified_release_sha: null, environment: 'production', backfilled: false },
  ];
  const supa = makeSupabase({ rows, reconcile: 3, userById: { r1: 'user-1', r2: 'user-2' } });
  const fetchBodies: string[] = [];
  const fetchImpl = ((_url: string, init: RequestInit) => { fetchBodies.push(String(init.body)); return Promise.resolve(new Response('{"status":1}', { status: 200 })); }) as unknown as typeof fetch;
  const sentry: unknown[] = [];
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, fetchImpl, sentry));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.reconciled, 3);
  assertEquals(body.claimed, 2);
  assertEquals(body.sent, 2);
  assertEquals(body.failed, 0);
  assertEquals(sentry.length, 0); // no failures → no alert
  // both marked sent carrying the worker's deploy SHA
  const sentMarks = supa.calls.rpc.filter((c) => c.name === 'mark_telemetry_result');
  assertEquals(sentMarks.length, 2);
  for (const m of sentMarks) {
    const a = m.args as Record<string, unknown>;
    assertEquals(a.p_status, 'sent');
    assertEquals(a.p_server_verified_release_sha, 'deploy-777');
  }
  assert(fetchBodies[0].includes('"$insert_id":"session_saved:r1"'));
});

Deno.test('handler failure path: classifies, dead-letters, sanitized Sentry alert (no distinct_id)', async () => {
  const rows: FakeRow[] = [
    { id: 'oA', record_id: 'rA', event_type: 'session_saved', insert_id: 'session_saved:rA', lease_token: 'lA', event_timestamp: '2026-07-19T00:00:00Z', attempt_count: 1, max_attempts: 8, data_origin: 'production_user', cohort_id: null, test_run_id: null, test_suite: null, client_release_sha: null, server_verified_release_sha: null, environment: 'production', backfilled: false },
    { id: 'oB', record_id: 'rB', event_type: 'session_saved', insert_id: 'session_saved:rB', lease_token: 'lB', event_timestamp: '2026-07-19T00:00:00Z', attempt_count: 8, max_attempts: 8, data_origin: 'production_user', cohort_id: null, test_run_id: null, test_suite: null, client_release_sha: null, server_verified_release_sha: null, environment: 'production', backfilled: false },
  ];
  // rB re-reads as dead_letter after its failed mark.
  const supa = makeSupabase({ rows, userById: { rA: 'user-AAA', rB: 'user-BBB' }, statusById: { oB: 'dead_letter' } });
  let n = 0;
  const fetchImpl = (() => {
    n += 1;
    if (n === 1) return Promise.resolve(new Response('bad', { status: 400 }));   // rA → ingest_rejected
    return Promise.reject(new Error('network down'));                             // rB → transport_error
  }) as unknown as typeof fetch;
  const sentry: Array<Record<string, unknown>> = [];
  const res = await handler(post('sekret'), depsFor(BASE_ENV, supa, fetchImpl, sentry));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.sent, 0);
  assertEquals(body.failed, 2);
  assertEquals(body.dead_lettered, 1);
  assertEquals(body.failure_categories.ingest_rejected, 1);
  assertEquals(body.failure_categories.transport_error, 1);
  // exactly one sanitized alert, and it must NOT contain any distinct_id
  assertEquals(sentry.length, 1);
  const serialized = JSON.stringify(sentry[0]);
  assert(!serialized.includes('user-AAA') && !serialized.includes('user-BBB'), 'Sentry payload must be content-free');
  assert(String((sentry[0] as { message: string }).message).includes('dead-lettered'));
});
