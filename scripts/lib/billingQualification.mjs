/**
 * #1294 — the WEEKLY, automated, no-live-charge Stripe billing lifecycle qualification (test mode + test
 * clocks). This module is the PURE, injectable core: a fail-closed test-mode guard that must pass BEFORE any
 * Stripe object is created, and the required-phase evidence contract. No network here — the runner
 * (scripts/paid-billing-qualification.mjs) wires the live Stripe test-mode calls around these.
 *
 * Safety invariant: this qualification NEVER touches live mode. A live key, a live Price/Customer, or an
 * un-proven `livemode` is a HARD failure before creation — so it can never move real money or charge a card.
 */

// The lifecycle phases the weekly qualification MUST prove. Shared by the runner (which requires evidence for
// each) and the executable contract (which asserts the runner enforces exactly this set) — so the two can
// never silently diverge.
export const REQUIRED_BILLING_PHASES = Object.freeze([
  'checkout',        // test-mode Checkout → subscription binding
  'webhook',         // webhook → server-side entitlement grant
  'renewal',         // test clock advanced one period → renewal invoice paid, entitlement continues
  'payment_failure', // test clock + failing test card → payment failure surfaced
  'cancellation',    // subscription cancelled
  'continuation',    // post-cancellation entitlement behaviour is correct
]);

const isTestSecretKey = (k) => typeof k === 'string' && /^sk_test_/.test(k);
const isLiveSecretKey = (k) => typeof k === 'string' && /^sk_live_/.test(k);

/**
 * Fail closed unless Stripe is provably in TEST mode before ANY object is created. Throws (never returns) on
 * any live/missing/misaligned signal. Pure: the caller fetches the Price/account and passes the observed
 * `livemode` booleans in; this function makes the go/no-go decision.
 *
 * @param {object} cfg
 * @param {string} cfg.secretKey        the Stripe secret key that WOULD be used (must be sk_test_…)
 * @param {boolean} cfg.accountLivemode Stripe account/object `livemode` as reported by the API (must be false)
 * @param {object} cfg.price            the fetched Stripe Price object (must be livemode:false, active, monthly)
 * @returns {{ mode: 'test', livemode: false }} on success
 */
export function assertStripeTestMode({ secretKey, accountLivemode, price } = {}) {
  if (isLiveSecretKey(secretKey)) throw new Error('billing qualification refused: a LIVE Stripe secret key was supplied');
  if (!isTestSecretKey(secretKey)) throw new Error('billing qualification refused: a Stripe TEST secret key (sk_test_…) is required');
  // `livemode` must be PROVEN false by the API before anything is created; a missing/undefined value fails closed.
  if (accountLivemode !== false) throw new Error('billing qualification refused: Stripe did not prove livemode=false');
  if (!price || typeof price !== 'object') throw new Error('billing qualification refused: the Stripe Price could not be read');
  if (price.livemode !== false) throw new Error('billing qualification refused: the configured Price is a LIVE object');
  if (price.active !== true) throw new Error('billing qualification refused: the configured Price is not active');
  if (!price.recurring || price.recurring.interval !== 'month') throw new Error('billing qualification refused: the Price is not a monthly recurring plan');
  return Object.freeze({ mode: 'test', livemode: false });
}

/**
 * Require truthful, complete lifecycle evidence: every REQUIRED_BILLING_PHASES entry must be present and
 * marked proven. Throws on any missing/false phase — a partial run can never be reported as a pass.
 *
 * @param {Record<string, boolean>} evidence phase → proven?
 * @returns {{ proven: string[] }} on success
 */
export function assertAllPhasesProven(evidence = {}) {
  const missing = REQUIRED_BILLING_PHASES.filter((phase) => evidence[phase] !== true);
  if (missing.length > 0) {
    throw new Error(`billing qualification incomplete: unproven lifecycle phase(s): ${missing.join(', ')}`);
  }
  return { proven: [...REQUIRED_BILLING_PHASES] };
}
