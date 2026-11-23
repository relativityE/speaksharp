/**
 * stripe-webhook log hygiene: no log line may carry the raw request body, the Stripe-Signature header, or any
 * part of a caught exception — on failed signature verification or on any later failure. Failures log a fixed
 * error code plus a per-request id; the event id appears only after the signature has verified.
 */
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const BODY_MARK = "BODY_SENTINEL_7f3a";
const SIG_MARK = "SIG_SENTINEL_91c2";
const ERR_MARK = "ERR_SENTINEL_4d8e";
const MARKS = [BODY_MARK, SIG_MARK, ERR_MARK];
const UUID = /request=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

const env = (key: string) => ({ STRIPE_PRO_PRICE_ID: "price_pro", STRIPE_PRICE_CURRENCY: "usd" } as Record<string, string>)[key];
const price = { id: "price_pro", active: true, unit_amount: 1000, currency: "usd", recurring: { interval: "month", interval_count: 1 } };
const subscription = { id: "sub_1", status: "active", customer: "cus_1", cancel_at_period_end: false, current_period_end: 3000,
  items: { data: [{ price }] } };

// Shaped like stripe-node's StripeSignatureVerificationError, which keeps the raw payload and signature header.
class SignatureError extends Error {
  type = "StripeSignatureVerificationError";
  constructor(public header: string, public payload: string) {
    super(`No signatures found matching the expected signature for payload ${ERR_MARK}`);
  }
}

const event = (over: Record<string, unknown> = {}) => ({
  id: "evt_ok", type: "customer.subscription.updated",
  data: { object: { id: "sub_1", metadata: { note: BODY_MARK } } }, ...over,
});

const request = (payload: unknown) => new Request("http://localhost", {
  method: "POST",
  headers: { "Stripe-Signature": `t=1,v1=${SIG_MARK}` },
  body: JSON.stringify(payload),
});

type Stripe = Record<string, unknown>;
const stripe = (o: { verify?: "sync-throw" | "async-reject"; retrieveFails?: boolean } = {}): Stripe => ({
  webhooks: o.verify === "async-reject"
    ? { constructEventAsync: (body: string, sig: string) => Promise.reject(new SignatureError(sig, body)) }
    : { constructEvent: (body: string, sig: string) => {
        if (o.verify === "sync-throw") throw new SignatureError(sig, body);
        return JSON.parse(body);
      } },
  subscriptions: { retrieve: () => o.retrieveFails
    ? Promise.reject(Object.assign(new Error(`stripe down ${ERR_MARK}`), { raw: { body: BODY_MARK } }))
    : Promise.resolve(subscription) },
  prices: { retrieve: () => Promise.resolve(price) },
});

const LEVELS = ["log", "error", "warn", "info", "debug"] as const;

/** Runs the handler with every console level captured; returns the status and each call's raw arguments. */
async function run(stripeClient: Stripe, database: unknown, payload: unknown = event()) {
  const calls: unknown[][] = [];
  const saved = LEVELS.map((level) => console[level]);
  LEVELS.forEach((level) => { console[level] = (...args: unknown[]) => { calls.push(args); }; });
  try {
    const res = await handler(request(payload), stripeClient, database, "whsec_test", env);
    return { status: res.status, calls };
  } finally {
    LEVELS.forEach((level, i) => { console[level] = saved[i]; });
  }
}

/** Every logged argument is a plain string and none carries the body, signature, or exception text. */
function assertClean(calls: unknown[][]): string[] {
  const lines = calls.map((args) => {
    for (const arg of args) assertEquals(typeof arg, "string", "a log argument is not a fixed string");
    return args.join(" ");
  });
  for (const line of lines) for (const mark of MARKS) assert(!line.includes(mark), `log leaked ${mark}: ${line}`);
  return lines;
}

const okDb = { rpc: () => Promise.resolve({ data: { success: true, entitlement: "pro" }, error: null }) };

Deno.test("stripe-webhook log hygiene", async (t) => {
  for (const verify of ["sync-throw", "async-reject"] as const) {
    await t.step(`failed verification (${verify}) logs only the fixed code and request id`, async () => {
      const { status, calls } = await run(stripe({ verify }), okDb);
      assertEquals(status, 400);
      const lines = assertClean(calls);
      assertEquals(lines.length, 1);
      assertMatch(lines[0], /signature verification failed \(code=STRIPE_WEBHOOK_INVALID\)/);
      assertMatch(lines[0], UUID);
      assert(!lines[0].includes("event="), "event id logged before verification");
      assert(!lines[0].includes("evt_ok"), "unverified event id logged");
    });
  }

  await t.step("a processing failure after verification logs the event id, never the exception", async () => {
    const db = { rpc: () => Promise.reject(Object.assign(new Error(`db exploded ${ERR_MARK}`), { details: BODY_MARK })) };
    const { status, calls } = await run(stripe(), db);
    assertEquals(status, 400);
    const lines = assertClean(calls);
    const failure = lines.find((l) => l.includes("processing failed"));
    assert(failure, "no processing-failure line");
    assertMatch(failure, /code=STRIPE_WEBHOOK_INVALID\) event=evt_ok request=/);
  });

  await t.step("a subscription retrieve failure logs the fixed code, never the Stripe error", async () => {
    const { status, calls } = await run(stripe({ retrieveFails: true }), okDb);
    assertEquals(status, 502);
    const lines = assertClean(calls);
    assert(lines.some((l) => /retrieve failed \(code=STRIPE_API_ERROR\) event=evt_ok request=/.test(l)));
  });

  await t.step("a snapshot RPC error logs the fixed code, never the database error", async () => {
    const db = { rpc: () => Promise.resolve({ data: null, error: { message: ERR_MARK, details: BODY_MARK, code: "XX000" } }) };
    const { status, calls } = await run(stripe(), db);
    assertEquals(status, 500);
    const lines = assertClean(calls);
    assert(lines.some((l) => /snapshot application failed \(code=DATABASE_ERROR\) event=evt_ok request=/.test(l)));
  });

  await t.step("one request id ties a request's lines together; a new request gets a new id", async () => {
    const db = { rpc: () => Promise.resolve({ data: null, error: { message: "x" } }) };
    const first = assertClean((await run(stripe(), db)).calls).map((l) => l.match(UUID)?.[0]);
    const second = assertClean((await run(stripe(), db)).calls).map((l) => l.match(UUID)?.[0]);
    assert(first.length >= 2 && first.every((id) => id && id === first[0]), "lines of one request disagree on the id");
    assert(second[0] && second[0] !== first[0], "request id reused across requests");
  });

  await t.step("a verified event id or type that is not a plain token is replaced, not printed", async () => {
    const { calls } = await run(stripe(), okDb, event({ id: `evt_1\n${BODY_MARK}`, type: `x ${BODY_MARK}` }));
    const lines = assertClean(calls);
    assert(lines.some((l) => l.includes("Received event: unrecognized (unrecognized)")));
  });
});
