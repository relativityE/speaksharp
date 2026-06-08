import { test, expect, request as playwrightRequest } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const TEST_EMAIL =
  process.env.BILLING_PORTAL_TEST_EMAIL ??
  process.env.PRO_TEST_EMAIL ??
  process.env.E2E_PRO_EMAIL;
const TEST_PASSWORD =
  process.env.BILLING_PORTAL_TEST_PASSWORD ??
  process.env.PRO_TEST_PASSWORD ??
  process.env.E2E_PRO_PASSWORD;

test('deployed Stripe billing portal opens for a paid Stripe customer', async () => {
  test.skip(
    !SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD,
    'SUPABASE_URL, SUPABASE_ANON_KEY, and a paid/pro billing portal test account are required.'
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
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
    });
    expect(authResponse.status(), await authResponse.text()).toBe(200);

    const authBody = await authResponse.json() as { access_token?: string };
    expect(authBody.access_token).toBeTruthy();

    const portalResponse = await functionContext.post('/functions/v1/stripe-billing-portal', {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${authBody.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    const portalText = await portalResponse.text();
    const portalBody = portalText ? JSON.parse(portalText) as { portalUrl?: string; error?: unknown } : {};

    const evidence = {
      status: portalResponse.status(),
      hasPortalUrl: typeof portalBody.portalUrl === 'string',
      portalHost: portalBody.portalUrl ? new URL(portalBody.portalUrl).hostname : null,
      error: portalBody.error ?? null,
    };
    console.log(`LIVE_STRIPE_BILLING_PORTAL_READINESS_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(portalResponse.status(), portalText).toBe(200);
    expect(portalBody.portalUrl, portalText).toMatch(/^https:\/\/billing\.stripe\.com\//);
  } finally {
    await authContext.dispose();
    await functionContext.dispose();
  }
});
