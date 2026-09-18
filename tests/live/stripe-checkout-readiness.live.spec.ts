import { test, expect, request as playwrightRequest } from '@playwright/test';
import { resolveCheckoutCredentials } from '../helpers/checkoutCredentials';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;

/**
 * #1492 — the identity comes from the dedicated checkout pair or this proof fails.
 *
 * The previous two independent `??` chains could substitute the Free or Pro reviewer for either half
 * separately, so this gate could run as the wrong role or assemble a mixed pair, and a missing
 * credential SKIPPED it — a release gate reporting green having proven nothing. See
 * `tests/helpers/checkoutCredentials.ts` for why a credential is treated as one atomic pair.
 *
 * The remaining `test.skip` covers Supabase CONFIGURATION only, not credentials, and is left as-is
 * because PM bounded this pass to the credential pair. It is a known remaining skip, not an oversight.
 */
const CHECKOUT_CREDENTIALS = resolveCheckoutCredentials();

test('deployed Stripe checkout can create a hosted checkout session', async () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY,
    'SUPABASE_URL and SUPABASE_ANON_KEY are required to reach the deployed project.'
  );

  // Fail closed, never skip: an absent checkout identity is a configuration defect this gate must report.
  expect(
    CHECKOUT_CREDENTIALS.ok,
    CHECKOUT_CREDENTIALS.ok ? '' : CHECKOUT_CREDENTIALS.reason,
  ).toBe(true);
  if (!CHECKOUT_CREDENTIALS.ok) return;
  const TEST_EMAIL = CHECKOUT_CREDENTIALS.email;
  const TEST_PASSWORD = CHECKOUT_CREDENTIALS.password;

  const authContext = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  const functionContext = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });

  try {
    const authResponse = await authContext.post('/auth/v1/token?grant_type=password', {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
      },
      data: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
    });
    expect(authResponse.status(), await authResponse.text()).toBe(200);

    const authBody = await authResponse.json() as { access_token?: string };
    expect(authBody.access_token).toBeTruthy();

    const checkoutResponse = await functionContext.post('/functions/v1/stripe-checkout', {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${authBody.access_token}`,
        'Content-Type': 'application/json',
      },
      data: {},
    });
    const checkoutText = await checkoutResponse.text();
    const checkoutBody = checkoutText ? JSON.parse(checkoutText) as { checkoutUrl?: string; error?: unknown } : {};

    const evidence = {
      status: checkoutResponse.status(),
      hasCheckoutUrl: typeof checkoutBody.checkoutUrl === 'string',
      checkoutHost: checkoutBody.checkoutUrl ? new URL(checkoutBody.checkoutUrl).hostname : null,
      error: checkoutBody.error ?? null,
    };
    console.log(`LIVE_STRIPE_CHECKOUT_READINESS_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(checkoutResponse.status(), checkoutText).toBe(200);
    expect(checkoutBody.checkoutUrl, checkoutText).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  } finally {
    await authContext.dispose();
    await functionContext.dispose();
  }
});
