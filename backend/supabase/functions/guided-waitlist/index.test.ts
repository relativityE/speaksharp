import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler, normalizeAndValidate, CONSENT_VERSION, type WaitlistDeps, type WaitlistUpsert } from './index.ts';

// #1061 Guided waitlist Edge Function — server-side integrity proof (no real DB; the admin client is mocked
// and records the upsert). Dedup/idempotency at the ROW level is enforced by the migration's unique index
// (proven separately in tests/release/guided-waitlist-contract.test.ts).

const GOOD_ENV = (k: string) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'svc-role' : undefined);

function recordingDeps() {
  const upserts: Array<{ row: Record<string, unknown>; opts: { onConflict: string; ignoreDuplicates: boolean } }> = [];
  const admin: WaitlistUpsert = {
    from: (table: string) => {
      assertEquals(table, 'guided_waitlist');
      return { upsert: async (row, opts) => { upserts.push({ row, opts }); return { error: null }; } };
    },
  };
  const deps: WaitlistDeps = { getEnv: GOOD_ENV, createAdmin: () => admin };
  return { deps, upserts };
}

function post(body: unknown): Request {
  // No Origin header → corsGuard permits server-to-server; keeps the test focused on function logic.
  return new Request('https://fn/guided-waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const VALID = { email: 'Me@Example.com ', consent: true, source: 'anonymous_landing', product: 'guided_rehearsal' };

Deno.test('normalizeAndValidate trims + lowercases the email and enforces the allowlists + consent', () => {
  assertEquals(normalizeAndValidate(VALID).valid, true);
  assertEquals(normalizeAndValidate(VALID).emailNormalized, 'me@example.com');
  assertEquals(normalizeAndValidate({ ...VALID, consent: false }).valid, false);        // consent required
  assertEquals(normalizeAndValidate({ ...VALID, email: 'not-an-email' }).valid, false);  // email shape
  assertEquals(normalizeAndValidate({ ...VALID, product: 'other' }).valid, false);       // product allowlist
  assertEquals(normalizeAndValidate({ ...VALID, source: 'hacker' }).valid, false);       // source allowlist
});

Deno.test('valid submission → generic {ok:true} + one idempotent dedup upsert with the normalized email', async () => {
  const { deps, upserts } = recordingDeps();
  const res = await handler(post(VALID), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true }); // generic — no account-existence disclosure, no PII
  assertEquals(upserts.length, 1);
  assertEquals(upserts[0].row.email_normalized, 'me@example.com');    // normalized server-side
  assertEquals(upserts[0].row.product, 'guided_rehearsal');
  assertEquals(upserts[0].row.consent, true);
  assertEquals(upserts[0].row.consent_version, CONSENT_VERSION);
  // Idempotent dedup contract: conflict on (product, normalized email), ignore duplicates.
  assertEquals(upserts[0].opts, { onConflict: 'product,email_normalized', ignoreDuplicates: true });
});

Deno.test('repeated identical submissions stay idempotent (same generic success, dedup upsert each time)', async () => {
  const { deps, upserts } = recordingDeps();
  await handler(post(VALID), deps);
  const res2 = await handler(post(VALID), deps);
  assertEquals(res2.status, 200);
  assertEquals(await res2.json(), { ok: true });
  // Both calls issue the ignoreDuplicates upsert — the DB unique index collapses them to ONE row.
  assert(upserts.every((u) => u.opts.ignoreDuplicates === true && u.opts.onConflict === 'product,email_normalized'));
});

Deno.test('invalid input → 400, NO DB write, and the response never echoes the email (no PII)', async () => {
  const { deps, upserts } = recordingDeps();
  const res = await handler(post({ ...VALID, consent: false }), deps);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.ok, false);
  assert(!JSON.stringify(body).toLowerCase().includes('me@example.com')); // response carries no PII
  assertEquals(upserts.length, 0); // no write on invalid input
});

Deno.test('missing service-role config → 500 fail-closed, no write', async () => {
  const upserts: unknown[] = [];
  const deps: WaitlistDeps = {
    getEnv: () => undefined, // no env
    createAdmin: () => ({ from: () => ({ upsert: async () => { upserts.push(1); return { error: null }; } }) }),
  };
  const res = await handler(post(VALID), deps);
  assertEquals(res.status, 500);
  assertEquals(upserts.length, 0);
});

Deno.test('non-POST is rejected', async () => {
  const { deps } = recordingDeps();
  const res = await handler(new Request('https://fn/guided-waitlist', { method: 'GET' }), deps);
  assertEquals(res.status, 405);
});
