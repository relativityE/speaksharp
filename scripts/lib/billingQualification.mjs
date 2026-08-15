/**
 * #1294 — the WEEKLY, automated, no-live-charge Stripe billing lifecycle qualification (test mode + test
 * clocks). PURE, INJECTABLE core: a fail-closed test-mode guard, correct Stripe form encoding, a webhook
 * signer, a bounded poller, and the lifecycle driver. The runner (scripts/paid-billing-qualification.mjs)
 * wires real fetch/Supabase clients; the mock tests inject fakes and assert exact request shapes + ordering.
 *
 * Safety invariant: this qualification NEVER touches live mode. A live key, a live Price/Customer, or an
 * un-proven `livemode` is a HARD failure before creation — so it can never move real money or charge a card.
 */

export const REQUIRED_BILLING_PHASES = Object.freeze([
  'checkout',        // test-mode subscription binding
  'webhook',         // signed test-mode webhook → SpeakSharp grants server-authoritative paid entitlement
  'renewal',         // test clock advanced one period → renewal invoice paid, entitlement continues
  'payment_failure', // test clock + failing test card → dunning/failure surfaced
  'cancellation',    // subscription cancelled
  'continuation',    // SpeakSharp post-cancellation entitlement is correct (not silently still-paid)
]);

const isTestSecretKey = (k) => typeof k === 'string' && /^sk_test_/.test(k);
const isLiveSecretKey = (k) => typeof k === 'string' && /^sk_live_/.test(k);

/**
 * Fail closed unless Stripe is provably in TEST mode before ANY object is created. Pure decision function.
 */
export function assertStripeTestMode({ secretKey, accountLivemode, price } = {}) {
  if (isLiveSecretKey(secretKey)) throw new Error('billing qualification refused: a LIVE Stripe secret key was supplied');
  if (!isTestSecretKey(secretKey)) throw new Error('billing qualification refused: a Stripe TEST secret key (sk_test_…) is required');
  if (accountLivemode !== false) throw new Error('billing qualification refused: Stripe did not prove livemode=false');
  if (!price || typeof price !== 'object') throw new Error('billing qualification refused: the Stripe Price could not be read');
  if (price.livemode !== false) throw new Error('billing qualification refused: the configured Price is a LIVE object');
  if (price.active !== true) throw new Error('billing qualification refused: the configured Price is not active');
  if (!price.recurring || price.recurring.interval !== 'month') throw new Error('billing qualification refused: the Price is not a monthly recurring plan');
  return Object.freeze({ mode: 'test', livemode: false });
}

/** Require every REQUIRED_BILLING_PHASES entry proven; throws on any missing/false phase. */
export function assertAllPhasesProven(evidence = {}) {
  const missing = REQUIRED_BILLING_PHASES.filter((phase) => evidence[phase] !== true);
  if (missing.length > 0) throw new Error(`billing qualification incomplete: unproven lifecycle phase(s): ${missing.join(', ')}`);
  return { proven: [...REQUIRED_BILLING_PHASES] };
}

/**
 * Correct Stripe application/x-www-form-urlencoded encoding, including NESTED ARRAYS OF OBJECTS
 * (`items[0][price]=…`) — the exact case the previous hand-rolled encoder broke (`items=[object Object]`).
 */
export function encodeStripeForm(obj, prefix = '') {
  const parts = [];
  const push = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => push(`${key}[${i}]`, item));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) push(`${key}[${k}]`, v);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
    }
  };
  for (const [k, v] of Object.entries(obj)) push(prefix ? `${prefix}[${k}]` : k, v);
  return parts.join('&');
}

/** Stripe webhook signature header: `t=<ts>,v1=<hmac_sha256(secret, "<ts>.<payload>")>`. */
export function signStripeWebhook(secret, payload, createHmac, nowSec) {
  const timestamp = nowSec;
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

/** Poll an async fetcher until `predicate` holds; fail closed on timeout. Bounded by attempts. */
export async function pollUntil(fetcher, predicate, { attempts = 30, sleep, onTimeout } = {}) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    last = await fetcher();
    if (predicate(last)) return last;
    await sleep(500);
  }
  throw new Error(onTimeout ? onTimeout(last) : `polling timed out; last=${JSON.stringify(last)}`);
}

/**
 * Drive the full no-charge lifecycle against injected clients. ALL Stripe/webhook/profile interactions are
 * injected so this is fully mock-testable; the caller wires the real ones. Test-object cleanup runs in a
 * `finally` so a mid-lifecycle failure never accumulates fixtures.
 *
 * @param {object} io
 * @param {(m,p,b)=>Promise<object>} io.stripe        Stripe API call (already test-mode-guarded)
 * @param {(evt,data)=>Promise<{ok:boolean}>} io.postWebhook  sign+POST a test webhook to the deployed endpoint
 * @param {()=>Promise<object>} io.readProfile          read the SpeakSharp profile for the test user
 * @param {(ms)=>Promise<void>} io.sleep
 * @param {()=>number} io.nowSec
 * @param {object} cfg  { priceId, testPmOk, testPmFail, userId }
 */
export async function runBillingLifecycle(io, cfg) {
  const { stripe, postWebhook, readProfile, sleep } = io;
  const { priceId, testPmOk, testPmFail } = cfg;
  const evidence = Object.fromEntries(REQUIRED_BILLING_PHASES.map((p) => [p, false]));
  const cleanup = [];

  const clockReady = (clockId) => pollUntil(
    () => stripe('GET', `test_helpers/test_clocks/${clockId}`),
    (c) => c.status === 'ready',
    { sleep, onTimeout: (c) => `test clock did not reach ready (last status=${c?.status})` },
  );

  try {
    const clock = await stripe('POST', 'test_helpers/test_clocks', { frozen_time: io.nowSec() });
    cleanup.push(() => stripe('DELETE', `test_helpers/test_clocks/${clock.id}`));
    const customer = await stripe('POST', 'customers', { test_clock: clock.id, description: 'canary weekly billing qualification (test-mode)' });
    await stripe('POST', `payment_methods/${testPmOk}/attach`, { customer: customer.id });
    await stripe('POST', `customers/${customer.id}`, { invoice_settings: { default_payment_method: testPmOk } });

    // checkout: subscription binding (correct `items[0][price]` encoding via encodeStripeForm in the caller).
    const sub = await stripe('POST', 'subscriptions', { customer: customer.id, items: [{ price: priceId }], expand: ['latest_invoice'] });
    if (!['active', 'trialing'].includes(sub.status)) throw new Error(`checkout: subscription status=${sub.status}`);
    evidence.checkout = true;

    // webhook: sign+POST the subscription event to SpeakSharp, then PROVE the profile became server-paid.
    await postWebhook('customer.subscription.updated', { ...sub, customer: customer.id });
    await pollUntil(readProfile, (p) => String(p?.subscription_status).toLowerCase() === 'pro' && !!p?.stripe_subscription_id, {
      sleep, onTimeout: (p) => `webhook: SpeakSharp did not grant paid entitlement (last=${JSON.stringify(p)})`,
    });
    evidence.webhook = true;

    // renewal: advance one month, WAIT for the clock to be ready, then require the renewal invoice paid.
    await stripe('POST', `test_helpers/test_clocks/${clock.id}/advance`, { frozen_time: io.nowSec() + 32 * 24 * 3600 });
    await clockReady(clock.id);
    const renewed = await stripe('GET', `subscriptions/${sub.id}`);
    if (renewed.status !== 'active') throw new Error(`renewal: status=${renewed.status}`);
    evidence.renewal = true;

    // payment_failure: swap to a failing test PM, advance again, wait ready, require dunning/failure state.
    await stripe('POST', `payment_methods/${testPmFail}/attach`, { customer: customer.id });
    await stripe('POST', `customers/${customer.id}`, { invoice_settings: { default_payment_method: testPmFail } });
    await stripe('POST', `test_helpers/test_clocks/${clock.id}/advance`, { frozen_time: io.nowSec() + 64 * 24 * 3600 });
    await clockReady(clock.id);
    const failed = await stripe('GET', `subscriptions/${sub.id}`);
    if (!['past_due', 'unpaid', 'canceled'].includes(failed.status)) throw new Error(`payment_failure: status=${failed.status}`);
    evidence.payment_failure = true;

    // cancellation.
    const canceled = await stripe('DELETE', `subscriptions/${sub.id}`);
    if (canceled.status !== 'canceled') throw new Error(`cancellation: status=${canceled.status}`);
    evidence.cancellation = true;

    // continuation: POST the cancellation webhook, then PROVE SpeakSharp resolved effective access away from paid.
    await postWebhook('customer.subscription.deleted', { ...canceled, customer: customer.id });
    await pollUntil(readProfile, (p) => String(p?.subscription_status).toLowerCase() !== 'pro', {
      sleep, onTimeout: (p) => `continuation: SpeakSharp kept paid access after cancellation (last=${JSON.stringify(p)})`,
    });
    evidence.continuation = true;

    assertAllPhasesProven(evidence);
    return { result: 'PASSED', mode: 'test', livemode: false, phases: [...REQUIRED_BILLING_PHASES] };
  } finally {
    // Run-owned cleanup ALWAYS — even on a mid-lifecycle failure — so a weekly red never accumulates fixtures.
    for (const fn of cleanup.reverse()) {
      try { await fn(); } catch { /* best-effort */ }
    }
  }
}
