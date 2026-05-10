import { test, expect, request as playwrightRequest } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;

test('deployed Stripe webhook is configured and rejects unsigned events cleanly', async () => {
  test.skip(!SUPABASE_URL, 'SUPABASE_URL is required for deployed Stripe webhook readiness.');

  const context = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  try {
    const response = await context.post('/functions/v1/stripe-webhook', {
      data: {
        id: `evt_live_readiness_${Date.now()}`,
        type: 'checkout.session.completed',
        data: { object: { metadata: { userId: 'readiness-only' }, subscription: 'sub_readiness' } },
      },
    });
    const body = await response.json().catch(() => null) as {
      error?: { code?: string; message?: string; details?: Record<string, unknown> };
    } | null;

    const evidence = {
      status: response.status(),
      code: body?.error?.code ?? null,
      message: body?.error?.message ?? null,
      reason: body?.error?.details?.reason ?? null,
    };
    console.log(`LIVE_STRIPE_WEBHOOK_READINESS_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(response.status(), JSON.stringify(evidence)).toBe(400);
    expect(body?.error?.code, JSON.stringify(evidence)).toBe('STRIPE_WEBHOOK_INVALID');
    expect(JSON.stringify(body), JSON.stringify(evidence)).not.toMatch(/not configured|Missing required environment variable|CONFIG_MISSING_ENV/i);
  } finally {
    await context.dispose();
  }
});
