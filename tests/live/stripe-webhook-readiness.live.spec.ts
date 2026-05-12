import { test, expect, request as playwrightRequest } from '@playwright/test';
import { createHash, createHmac } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

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

test('deployed Stripe webhook accepts a signed no-op Stripe event', async () => {
  test.skip(
    !SUPABASE_URL || !STRIPE_WEBHOOK_SECRET,
    'SUPABASE_URL and STRIPE_WEBHOOK_SECRET are required for signed Stripe webhook proof.'
  );

  const context = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  try {
    const eventId = `evt_live_signed_${Date.now()}`;
    const payload = JSON.stringify({
      id: eventId,
      object: 'event',
      api_version: '2024-06-20',
      type: 'customer.subscription.updated',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      data: {
        object: {
          id: `sub_live_signed_${Date.now()}`,
          object: 'subscription',
          status: 'active',
        },
      },
    });
    expect(STRIPE_WEBHOOK_SECRET, 'GitHub STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret.').toMatch(/^whsec_/);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', STRIPE_WEBHOOK_SECRET!)
      .update(`${timestamp}.${payload}`, 'utf8')
      .digest('hex');
    const payloadSha256 = createHash('sha256').update(payload, 'utf8').digest('hex');

    const response = await context.post('/functions/v1/stripe-webhook', {
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': `t=${timestamp},v1=${signature}`,
      },
      data: payload,
    });
    const body = await response.json().catch(() => null) as {
      received?: boolean;
      skipped?: boolean;
      error?: { code?: string; message?: string };
    } | null;

    const evidence = {
      status: response.status(),
      eventId,
      payloadBytes: Buffer.byteLength(payload, 'utf8'),
      payloadSha256,
      received: body?.received ?? null,
      skipped: body?.skipped ?? false,
      errorCode: body?.error?.code ?? null,
      errorMessage: body?.error?.message ?? null,
    };
    console.log(`LIVE_STRIPE_SIGNED_WEBHOOK_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(response.status(), JSON.stringify(evidence)).toBe(200);
    expect(body?.received, JSON.stringify(evidence)).toBe(true);
    expect(body?.error, JSON.stringify(evidence)).toBeUndefined();
  } finally {
    await context.dispose();
  }
});
