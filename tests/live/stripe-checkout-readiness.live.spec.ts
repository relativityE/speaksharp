import { test, expect, request as playwrightRequest } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const E2E_PRO_EMAIL = process.env.CHECKOUT_TEST_EMAIL ?? process.env.BASIC_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const E2E_PRO_PASSWORD = process.env.CHECKOUT_TEST_PASSWORD ?? process.env.BASIC_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

test('deployed Stripe checkout can create a hosted checkout session', async () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !E2E_PRO_EMAIL || !E2E_PRO_PASSWORD,
    'SUPABASE_URL, SUPABASE_ANON_KEY, and E2E Pro credentials are required for Stripe checkout readiness.'
  );

  const authContext = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  const functionContext = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });

  try {
    const authResponse = await authContext.post('/auth/v1/token?grant_type=password', {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
      },
      data: {
        email: E2E_PRO_EMAIL,
        password: E2E_PRO_PASSWORD,
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
