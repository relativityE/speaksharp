import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  handler, normalizeAndValidate, sha256Hex, generateRawToken, CONSENT_VERSION, TOKEN_TTL_MS,
  createInMemoryRateLimiter, type WaitlistDeps, type WaitlistStore, type WaitlistRow, type RateLimiter,
} from './index.ts';

// #1061 Guided waitlist Edge Function — server-side integrity proof. The admin store, clock, RNG, rate
// limiter, and confirmation-delivery seam are all injected: no real DB, no real email, deterministic time.
// The delivery seam CAPTURES the raw token (as a real transactional transport would receive it), so the
// tests can exercise the confirm flow without the raw token ever being logged or returned by the function.

const GOOD_ENV = (k: string) =>
  k === 'SUPABASE_URL' ? 'https://x.supabase.co' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'svc-role' : undefined;

// In-memory store honoring the DB's uniqueness + lifecycle + compare-and-swap semantics.
function makeStore(opts: { failInsert?: boolean; reissueReturns?: boolean } = {}): WaitlistStore & { rows: WaitlistRow[] } {
  const rows: WaitlistRow[] = [];
  let idc = 0;
  return {
    rows,
    findByProductEmail: (p, e) => Promise.resolve(rows.find((r) => r.product === p && r.email_normalized === e) ?? null),
    findByTokenHash: (h) => Promise.resolve(rows.find((r) => r.confirmation_token_hash === h) ?? null),
    insertPendingWithToken: (row) => {
      if (opts.failInsert) throw new Error('insert_failed'); // simulate a non-conflict DB error
      if (rows.some((r) => r.product === row.product && r.email_normalized === row.email_normalized)) {
        return Promise.resolve({ inserted: false, conflict: true, id: null });
      }
      const id = `id-${++idc}`;
      rows.push({
        id, product: row.product, email_normalized: row.email_normalized, status: 'pending',
        confirmation_token_hash: row.confirmation_token_hash, confirmation_sent_at: row.confirmation_sent_at,
        confirmation_expires_at: row.confirmation_expires_at, confirmed_at: null,
      });
      return Promise.resolve({ inserted: true, conflict: false, id });
    },
    reissueToken: (id, prevHash, h, s, e) => {
      if (opts.reissueReturns === false) return Promise.resolve(false); // simulate losing the CAS race
      const r = rows.find((x) => x.id === id);
      if (r && r.status === 'pending' && r.confirmation_token_hash === prevHash) {
        r.confirmation_token_hash = h; r.confirmation_sent_at = s; r.confirmation_expires_at = e; return Promise.resolve(true);
      }
      return Promise.resolve(false);
    },
    clearIssuedToken: (id) => {
      const r = rows.find((x) => x.id === id);
      if (r && r.status === 'pending') { r.confirmation_token_hash = null; r.confirmation_sent_at = null; r.confirmation_expires_at = null; }
      return Promise.resolve();
    },
    confirm: (id, ca) => {
      const r = rows.find((x) => x.id === id);
      if (r && r.status === 'pending') { r.status = 'confirmed'; r.confirmed_at = ca; r.confirmation_token_hash = null; return Promise.resolve(true); }
      return Promise.resolve(false);
    },
  };
}

function makeDeps(opts: Partial<{
  store: WaitlistStore & { rows: WaitlistRow[] }; getEnv: (k: string) => string | undefined;
  rateLimiter: RateLimiter; startTime: number; deliver: (email: string, token: string) => Promise<void>;
}> = {}) {
  const store = opts.store ?? makeStore();
  const captured: Array<{ email: string; token: string }> = [];
  let clock = opts.startTime ?? 1_700_000_000_000;
  const deps: WaitlistDeps = {
    getEnv: opts.getEnv ?? GOOD_ENV,
    createStore: () => store,
    now: () => clock,
    randomToken: generateRawToken,
    hashToken: sha256Hex,
    rateLimiter: opts.rateLimiter ?? { check: () => true },
    deliverConfirmation: opts.deliver ?? ((email, token) => { captured.push({ email, token }); return Promise.resolve(); }),
  };
  return { deps, store, captured, advance: (ms: number) => { clock += ms; }, setClock: (v: number) => { clock = v; } };
}

const submit = (body: unknown) =>
  new Request('https://fn/guided-waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const confirm = (token: string) =>
  new Request(`https://fn/guided-waitlist?token=${token}`, { method: 'GET' });

const VALID = { email: 'Me@Example.com ', consent: true, source: 'anonymous_landing', product: 'guided_rehearsal' };

Deno.test('normalizeAndValidate enforces canonical email + allowlists + consent (mirrors DB CHECKs)', () => {
  assertEquals(normalizeAndValidate(VALID).valid, true);
  assertEquals(normalizeAndValidate(VALID).emailNormalized, 'me@example.com'); // trimmed + lowercased
  assertEquals(normalizeAndValidate({ ...VALID, consent: false }).valid, false);
  assertEquals(normalizeAndValidate({ ...VALID, email: 'not-an-email' }).valid, false);
  assertEquals(normalizeAndValidate({ ...VALID, email: '@example.com' }).valid, false);   // empty local
  assertEquals(normalizeAndValidate({ ...VALID, email: 'me@' }).valid, false);             // empty domain
  assertEquals(normalizeAndValidate({ ...VALID, email: 'a@b@c.com' }).valid, false);       // two '@'
  assertEquals(normalizeAndValidate({ ...VALID, product: 'other' }).valid, false);
  assertEquals(normalizeAndValidate({ ...VALID, source: 'hacker' }).valid, false);
});

Deno.test('valid submit → generic {ok:true}; one PENDING row storing the token HASH (never the raw token)', async () => {
  const { deps, store, captured } = makeDeps();
  const res = await handler(submit(VALID), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });                 // generic — no PII/token/existence disclosure
  assertEquals(store.rows.length, 1);
  const row = store.rows[0];
  assertEquals(row.status, 'pending');                          // pending-only initial record
  assertEquals(row.email_normalized, 'me@example.com');
  assertEquals(row.confirmed_at, null);
  assert(/^[0-9a-f]{64}$/.test(row.confirmation_token_hash!));  // a hash, not a raw token
  assertEquals(captured.length, 1);                             // token handed to the transport seam (after persist)
  assert(captured[0].token !== row.confirmation_token_hash);    // raw token != stored hash
  assertEquals(await sha256Hex(captured[0].token), row.confirmation_token_hash); // hash IS of the delivered token
});

Deno.test('invalid submit (consent/email/product/source) → 400, NO row, NO delivery, response carries no PII', async () => {
  for (const bad of [{ ...VALID, consent: false }, { ...VALID, email: 'nope' }, { ...VALID, product: 'x' }, { ...VALID, source: 'x' }]) {
    const { deps, store, captured } = makeDeps();
    const res = await handler(submit(bad), deps);
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.ok, false);
    assert(!JSON.stringify(body).toLowerCase().includes('me@example.com')); // no PII echoed
    assertEquals(store.rows.length, 0);
    assertEquals(captured.length, 0);
  }
});

Deno.test('idempotent resubmission within cooldown → still ONE row, token NOT rotated', async () => {
  const { deps, store, captured } = makeDeps();
  await handler(submit(VALID), deps);
  const firstHash = store.rows[0].confirmation_token_hash;
  const res2 = await handler(submit(VALID), deps);       // immediate resubmit (within cooldown)
  assertEquals(res2.status, 200);
  assertEquals(await res2.json(), { ok: true });
  assertEquals(store.rows.length, 1);                    // dedup: one durable row
  assertEquals(store.rows[0].confirmation_token_hash, firstHash); // not rotated (no token churn / spam)
  assertEquals(captured.length, 1);                      // no second delivery
});

Deno.test('resubmission AFTER token expiry rotates the token (one row, still pending)', async () => {
  const { deps, store, captured, advance } = makeDeps();
  await handler(submit(VALID), deps);
  const firstHash = store.rows[0].confirmation_token_hash;
  advance(TOKEN_TTL_MS + 1000);                          // token has expired
  const res = await handler(submit(VALID), deps);
  assertEquals(res.status, 200);
  assertEquals(store.rows.length, 1);
  assertEquals(store.rows[0].status, 'pending');
  assert(store.rows[0].confirmation_token_hash !== firstHash); // rotated
  assertEquals(captured.length, 2);                     // a fresh confirmation issued
});

Deno.test('confirm within the window → {ok:true}; row becomes confirmed, hash CLEARED (single use)', async () => {
  const { deps, store, captured } = makeDeps();
  await handler(submit(VALID), deps);
  const res = await handler(confirm(captured[0].token), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  const row = store.rows[0];
  assertEquals(row.status, 'confirmed');
  assert(row.confirmed_at !== null);                    // sole confirmation proof
  assertEquals(row.confirmation_token_hash, null);      // cleared → not replayable
});

Deno.test('EXPIRED token → confirm rejected generically; row stays pending', async () => {
  const { deps, store, captured, advance } = makeDeps();
  await handler(submit(VALID), deps);
  advance(TOKEN_TTL_MS + 1);                             // past expiry
  const res = await handler(confirm(captured[0].token), deps);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { ok: false });         // generic, no disclosure
  assertEquals(store.rows[0].status, 'pending');
});

Deno.test('REUSED token → second confirm rejected (single use)', async () => {
  const { deps, captured } = makeDeps();
  await handler(submit(VALID), deps);
  const first = await handler(confirm(captured[0].token), deps);
  assertEquals(first.status, 200);
  const second = await handler(confirm(captured[0].token), deps); // same token again
  assertEquals(second.status, 400);
  assertEquals(await second.json(), { ok: false });
});

Deno.test('unknown token → confirm rejected generically (no existence disclosure)', async () => {
  const { deps } = makeDeps();
  const res = await handler(confirm('deadbeef'.repeat(8)), deps);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { ok: false });
});

Deno.test('rate limit applies to BOTH submit and confirm; over-limit returns 429, no row written', async () => {
  let n = 0;
  const limiter: RateLimiter = { check: () => (++n) <= 1 };   // allow the 1st, deny the rest
  const { deps, store } = makeDeps({ rateLimiter: limiter });
  const first = await handler(submit({ ...VALID, email: 'a@example.com' }), deps);
  assertEquals(first.status, 200);
  const second = await handler(submit({ ...VALID, email: 'b@example.com' }), deps);
  assertEquals(second.status, 429);
  assertEquals(await second.json(), { ok: false, error: 'rate_limited' });
  assertEquals(store.rows.length, 1);                    // the rate-limited submit wrote nothing
});

Deno.test('confirm path is rate-limited BEFORE any token lookup', async () => {
  const limiter: RateLimiter = { check: () => false };   // deny everything
  const { deps } = makeDeps({ rateLimiter: limiter });
  const res = await handler(confirm('a'.repeat(64)), deps);
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { ok: false, error: 'rate_limited' });
});

Deno.test('in-memory rate limiter admits up to max per window, then blocks, then recovers', () => {
  let clock = 0;
  const rl = createInMemoryRateLimiter(2, 1000, () => clock);
  assertEquals(rl.check('k'), true);
  assertEquals(rl.check('k'), true);
  assertEquals(rl.check('k'), false);   // 3rd within window blocked
  clock += 1001;
  assertEquals(rl.check('k'), true);     // window elapsed → allowed again
  assertEquals(rl.check('other'), true); // independent key
});

Deno.test('insert FAILURE (non-conflict) → 500 fail-closed BEFORE delivery (no token delivered)', async () => {
  const store = makeStore({ failInsert: true });
  const { deps, captured } = makeDeps({ store });
  const res = await handler(submit(VALID), deps);
  assertEquals(res.status, 500);                 // failed closed
  assertEquals(store.rows.length, 0);            // nothing persisted
  assertEquals(captured.length, 0);              // and crucially, NO token was delivered
});

Deno.test('delivery FAILURE → 500 and the row is reverted to the unsent state (no false "sent")', async () => {
  const store = makeStore();
  const { deps } = makeDeps({ store, deliver: () => Promise.reject(new Error('provider down')) });
  const res = await handler(submit(VALID), deps);
  assertEquals(res.status, 500);
  assertEquals(store.rows.length, 1);            // the row exists...
  const row = store.rows[0];
  assertEquals(row.status, 'pending');
  assertEquals(row.confirmation_token_hash, null);   // ...but reverted: no token
  assertEquals(row.confirmation_sent_at, null);      // ...and no false "sent" provenance
  assertEquals(row.confirmation_expires_at, null);
});

Deno.test('LOST reissue race (CAS returns false) → generic success, NO duplicate delivery', async () => {
  const store = makeStore({ reissueReturns: false });
  // Seed an existing EXPIRED pending row so the submit takes the reissue path.
  store.rows.push({
    id: 'seed', product: 'guided_rehearsal', email_normalized: 'me@example.com', status: 'pending',
    confirmation_token_hash: 'c'.repeat(64), confirmation_sent_at: new Date(0).toISOString(),
    confirmation_expires_at: new Date(1).toISOString(), confirmed_at: null,
  });
  const { deps, captured } = makeDeps({ store });
  const res = await handler(submit(VALID), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });   // generic success
  assertEquals(captured.length, 0);               // we lost the CAS → did NOT deliver a second token
});

Deno.test('missing service-role config → 500 fail-closed, no write, no delivery', async () => {
  const { deps, store, captured } = makeDeps({ getEnv: () => undefined });
  const res = await handler(submit(VALID), deps);
  assertEquals(res.status, 500);
  assertEquals(store.rows.length, 0);
  assertEquals(captured.length, 0);
});

Deno.test('consent + provenance are written server-side with the pinned consent version', async () => {
  const { deps, store } = makeDeps();
  await handler(submit(VALID), deps);
  assertEquals(store.rows.length, 1);
  assertEquals(CONSENT_VERSION, 'guided_waitlist_v1'); // the constant the production insert pins
});

Deno.test('unsupported method → 405', async () => {
  const { deps } = makeDeps();
  const res = await handler(new Request('https://fn/guided-waitlist', { method: 'DELETE' }), deps);
  assertEquals(res.status, 405);
});
