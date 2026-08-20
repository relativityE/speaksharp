// Non-destructive deployed-checkout probe for the billing-freeze gate (P0.1).
//
// Proves the DEPLOYED beta cannot initiate checkout. Issues ONE anonymous POST to the stripe-checkout
// Edge Function. Because the function is behind Supabase JWT verification, BOTH the `apikey` and
// `Authorization: Bearer <anon>` headers carry the ANON key (no user token) so the request reaches the
// handler; the fail-closed guard then runs before any auth/Stripe logic. This can NEVER create a
// Checkout Session or risk a charge: there is no valid user token, and even if the guard were
// unexpectedly open, the subsequent in-handler user authentication would still fail for an anon caller.
//
// FAIL-CLOSED: only a confirmed `403 payments_disabled` is CLOSED (pass). Everything else — an open
// checkout, an unexpected status, a network error, or missing config — is a failure (or NOT_RUNNABLE).

export const CHECKOUT_PROBE = Object.freeze({
  CLOSED: 'CLOSED', // 403 + payments_disabled — deployed guard confirmed closed
  OPEN: 'OPEN', // 2xx checkout URL — payments are initiable (hard violation)
  UNCONFIRMED: 'UNCONFIRMED', // 401/404/429/5xx/unexpected — closure not proven → fail closed
  ERROR: 'ERROR', // timeout/network/body-read failure → fail closed
  NOT_RUNNABLE: 'NOT_RUNNABLE', // required config missing → exit 2, never pass
});

/** Redact anything token-like from a short body snippet; never store headers/secrets. */
export function redactSnippet(text) {
  return String(text ?? '')
    .slice(0, 200)
    .replace(/sk_[a-z]+_[A-Za-z0-9]+/g, '[redacted]')
    .replace(/eyJ[A-Za-z0-9._-]+/g, '[jwt]')
    .replace(/pk_[a-z]+_[A-Za-z0-9]+/g, '[redacted]');
}

/**
 * PURE classifier — the single source of truth for the deployed-checkout gate. Fail-closed: only a
 * confirmed 403 payments_disabled is CLOSED. Any other status, or a network error, is a failure.
 * @param {{ status?: number|null, bodySnippet?: string, networkError?: unknown }} input
 * @returns {string} one of CHECKOUT_PROBE.*
 */
export function classifyCheckoutProbe({ status = null, bodySnippet = '', networkError = null } = {}) {
  if (networkError) return CHECKOUT_PROBE.ERROR;
  if (typeof status !== 'number') return CHECKOUT_PROBE.ERROR;
  const body = String(bodySnippet ?? '');
  if (status >= 200 && status < 300 && /checkouturl/i.test(body)) return CHECKOUT_PROBE.OPEN;
  if (status === 403 && /payments_disabled/i.test(body)) return CHECKOUT_PROBE.CLOSED;
  return CHECKOUT_PROBE.UNCONFIRMED; // 401/404/429/5xx/2xx-without-url/unexpected → fail closed
}

const DETAIL = {
  [CHECKOUT_PROBE.CLOSED]: '403 payments_disabled (deployed guard confirmed closed, before any Stripe call)',
  [CHECKOUT_PROBE.OPEN]: 'checkout endpoint returned a checkout URL — payments are OPEN',
  [CHECKOUT_PROBE.UNCONFIRMED]: 'endpoint did not return payments_disabled — closure NOT confirmed (fail closed)',
  [CHECKOUT_PROBE.ERROR]: 'network/timeout/body-read failure — closure NOT confirmed (fail closed)',
  [CHECKOUT_PROBE.NOT_RUNNABLE]: 'SUPABASE_URL / SUPABASE_ANON_KEY not set — probe cannot run',
};

/**
 * Run the probe. `fetchImpl`/`sanitizeError` injectable for tests. Returns a sanitized result object
 * containing ONLY status + redacted snippet + classification — never the anon key or request headers.
 */
export async function probeCheckoutClosed({ baseUrl, anonKey, fetchImpl = globalThis.fetch, sanitizeError = String } = {}) {
  if (!baseUrl || !anonKey) {
    return { classification: CHECKOUT_PROBE.NOT_RUNNABLE, detail: DETAIL[CHECKOUT_PROBE.NOT_RUNNABLE] };
  }
  try {
    const res = await fetchImpl(`${String(baseUrl).replace(/\/$/, '')}/functions/v1/stripe-checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`, // ANON key only — no user token; JWT-verify passes the gateway
      },
      body: JSON.stringify({ plan: 'pro', probe: 'billing-freeze' }),
    });
    const status = res.status;
    const bodySnippet = redactSnippet(await res.text().catch(() => ''));
    const classification = classifyCheckoutProbe({ status, bodySnippet });
    return { classification, status, bodySnippet, detail: DETAIL[classification] };
  } catch (err) {
    return { classification: CHECKOUT_PROBE.ERROR, detail: `${DETAIL[CHECKOUT_PROBE.ERROR]}: ${sanitizeError(err?.message ?? err)}` };
  }
}
