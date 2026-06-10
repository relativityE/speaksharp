import { test, expect, request as playwrightRequest, type Frame, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID;
const BASE_URL = process.env.BASE_URL ?? 'https://speaksharp-public.vercel.app';
const RUN_ID = Date.now();
const PASSWORD = `SpeakSharp-Paid-Runtime-${RUN_ID}!`;
const RAW_STRIPE_RUNTIME_MODE = (process.env.STRIPE_RUNTIME_MODE ??
  (STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'live' : 'test')).toLowerCase();
const STRIPE_RUNTIME_MODE = RAW_STRIPE_RUNTIME_MODE === 'live' ? 'live' : 'test';
const IS_LIVE_MODE = STRIPE_RUNTIME_MODE === 'live';
const ALLOW_SYNTHETIC_LIVE_WEBHOOK = process.env.STRIPE_ALLOW_SYNTHETIC_LIVE_WEBHOOK === 'true';
const CAN_POST_SYNTHETIC_WEBHOOK = !IS_LIVE_MODE || ALLOW_SYNTHETIC_LIVE_WEBHOOK;
const COMPLETE_HOSTED_CHECKOUT = process.env.STRIPE_COMPLETE_HOSTED_CHECKOUT === 'true' && !IS_LIVE_MODE;

type CreatedUser = {
  id: string;
  email: string;
};

type ProfileSnapshot = {
  subscription_status: string | null;
  stripe_subscription_id: string | null;
  subscription_id: string | null;
  stripe_customer_id: string | null;
};

type StripeJson = Record<string, unknown>;

const requiredEnvMissing = () => !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  !SUPABASE_SERVICE_ROLE_KEY ||
  !STRIPE_SECRET_KEY ||
  !STRIPE_WEBHOOK_SECRET ||
  !STRIPE_PRO_PRICE_ID;

const redactId = (value: unknown) => {
  if (typeof value !== 'string') return null;
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
};

const normalizeStripeObjectId = (value: unknown) => {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  }
  return null;
};

const postStripeForm = async (path: string, body: URLSearchParams) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = await response.json().catch(() => ({})) as StripeJson;
  if (!response.ok) {
    throw new Error(`Stripe ${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
};

const deleteStripeJson = async (path: string) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  });
  const json = await response.json().catch(() => ({})) as StripeJson;
  if (!response.ok) {
    throw new Error(`Stripe DELETE ${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
};

const getStripeJson = async (path: string) => {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  });
  const json = await response.json().catch(() => ({})) as StripeJson;
  if (!response.ok) {
    throw new Error(`Stripe ${path} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
};

const deleteStripeCustomer = async (customerId: string) => {
  await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(customerId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  }).catch(() => undefined);
};

const createStripeCustomer = async (email: string) => {
  const body = new URLSearchParams();
  body.set('email', email);
  body.set(
    'metadata[speaksharp_test]',
    IS_LIVE_MODE ? 'paid_soft_launch_live_runtime_smoke' : 'paid_soft_launch_runtime'
  );
  body.set('metadata[run_id]', String(RUN_ID));
  const customer = await postStripeForm('customers', body);
  expect(customer.id, JSON.stringify({ customer })).toMatch(/^cus_/);
  return customer.id as string;
};

const createLiveUser = async (
  admin: SupabaseClient,
  email: string,
  profile: Partial<ProfileSnapshot>
): Promise<CreatedUser> => {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create ${email}: ${error?.message ?? 'no user returned'}`);
  }

  const { error: profileError } = await admin.from('user_profiles').upsert({
    id: data.user.id,
    subscription_status: 'free',
    stripe_subscription_id: null,
    subscription_id: null,
    stripe_customer_id: null,
    ...profile,
  }, { onConflict: 'id' });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw new Error(`Failed to seed profile for ${email}: ${profileError.message}`);
  }

  return { id: data.user.id, email };
};

const authTokenFor = async (email: string) => {
  const authContext = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  try {
    const response = await authContext.post('/auth/v1/token?grant_type=password', {
      headers: {
        apikey: SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
      },
      data: { email, password: PASSWORD },
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json() as { access_token?: string };
    expect(body.access_token).toBeTruthy();
    return body.access_token!;
  } finally {
    await authContext.dispose();
  }
};

const readProfile = async (admin: SupabaseClient, userId: string): Promise<ProfileSnapshot> => {
  const { data, error } = await admin
    .from('user_profiles')
    .select('subscription_status,stripe_subscription_id,subscription_id,stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) {
    throw new Error(`Failed to read profile for ${userId}: ${error?.message ?? 'not found'}`);
  }
  return data as ProfileSnapshot;
};

const waitForProfile = async (
  admin: SupabaseClient,
  userId: string,
  predicate: (profile: ProfileSnapshot) => boolean
) => {
  let last: ProfileSnapshot | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    last = await readProfile(admin, userId);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Profile did not reach expected state: ${JSON.stringify(last)}`);
};

const signStripePayload = (payload: string) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', STRIPE_WEBHOOK_SECRET!)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
};

const parseCheckoutSessionId = (checkoutUrl: string) => {
  const match = checkoutUrl.match(/\/(cs_(?:test|live)_[^/?#]+)/);
  return match?.[1] ?? null;
};

const getContexts = (page: Page): Array<Page | Frame> => [page, ...page.frames()];

const fillAny = async (page: Page, selectors: string[], value: string, label: string) => {
  const deadline = Date.now() + 30_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    for (const context of getContexts(page)) {
      for (const selector of selectors) {
        const locator = context.locator(selector).first();
        if (await locator.count().catch(() => 0)) {
          try {
            await locator.fill(value, { timeout: 2_000 });
            return;
          } catch (error) {
            lastError = error;
          }
        }
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Could not fill Stripe Checkout ${label}: ${String(lastError)}`);
};

const clickAny = async (page: Page, selectors: string[], label: string) => {
  const deadline = Date.now() + 30_000;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    for (const context of getContexts(page)) {
      for (const selector of selectors) {
        const locator = context.locator(selector).first();
        if (await locator.count().catch(() => 0)) {
          try {
            await locator.click({ timeout: 2_000 });
            return;
          } catch (error) {
            lastError = error;
          }
        }
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`Could not click Stripe Checkout ${label}: ${String(lastError)}`);
};

const completeHostedStripeCheckout = async (page: Page, checkoutUrl: string, email: string) => {
  await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await fillAny(page, [
    'input[name="email"]',
    'input[type="email"]',
    'input[autocomplete="email"]',
  ], email, 'email').catch(() => undefined);
  await fillAny(page, [
    'input[name="cardNumber"]',
    'input[autocomplete="cc-number"]',
    'input[placeholder*="1234"]',
    'input[aria-label*="card number" i]',
  ], '4242424242424242', 'card number');
  await fillAny(page, [
    'input[name="cardExpiry"]',
    'input[autocomplete="cc-exp"]',
    'input[placeholder*="MM"]',
    'input[aria-label*="expiration" i]',
  ], '1234', 'expiration');
  await fillAny(page, [
    'input[name="cardCvc"]',
    'input[autocomplete="cc-csc"]',
    'input[placeholder*="CVC" i]',
    'input[aria-label*="security code" i]',
  ], '123', 'CVC');
  await fillAny(page, [
    'input[name="billingName"]',
    'input[autocomplete="cc-name"]',
    'input[aria-label*="name" i]',
  ], 'SpeakSharp Test', 'cardholder name').catch(() => undefined);
  await fillAny(page, [
    'input[name="billingPostalCode"]',
    'input[autocomplete="postal-code"]',
    'input[placeholder*="ZIP" i]',
    'input[aria-label*="ZIP" i]',
    'input[aria-label*="postal" i]',
  ], '94105', 'ZIP');
  await fillAny(page, [
    'input[name="phoneNumber"]',
    'input[type="tel"]',
    'input[autocomplete="tel"]',
    'input[aria-label*="phone" i]',
  ], '2015550123', 'phone number').catch(() => undefined);
  await clickAny(page, [
    'button[type="submit"]',
    'button:has-text("Subscribe")',
    'button:has-text("Pay")',
  ], 'submit');
  await page.waitForURL(/checkout=success/, { timeout: 90_000 });
};

const latestInvoicePaymentIntent = async (subscriptionId: string) => {
  const subscription = await getStripeJson(
    `subscriptions/${encodeURIComponent(subscriptionId)}?expand[]=latest_invoice.payment_intent`
  );
  const latestInvoice = subscription.latest_invoice as StripeJson | string | undefined;
  const paymentIntent = typeof latestInvoice === 'object'
    ? latestInvoice.payment_intent as StripeJson | string | undefined
    : undefined;
  return typeof paymentIntent === 'string' ? paymentIntent : typeof paymentIntent?.id === 'string' ? paymentIntent.id : null;
};

const latestSucceededPaymentIntentForCustomer = async (customerId: string) => {
  const paymentIntents = await getStripeJson(`payment_intents?customer=${encodeURIComponent(customerId)}&limit=10`);
  const data = Array.isArray(paymentIntents.data) ? paymentIntents.data as StripeJson[] : [];
  const succeeded = data.find((paymentIntent) =>
    paymentIntent.status === 'succeeded' &&
    typeof paymentIntent.id === 'string' &&
    typeof paymentIntent.amount_received === 'number' &&
    paymentIntent.amount_received > 0
  );
  return typeof succeeded?.id === 'string' ? succeeded.id : null;
};

const refundPaymentIntent = async (paymentIntentId: string) => {
  const body = new URLSearchParams();
  body.set('payment_intent', paymentIntentId);
  body.set('metadata[speaksharp_test]', 'paid_soft_launch_refund_proof');
  body.set('metadata[run_id]', String(RUN_ID));
  return postStripeForm('refunds', body);
};

test.describe.serial(`Stripe ${STRIPE_RUNTIME_MODE}-mode paid soft launch runtime proof @live @stripe`, () => {
  let admin: SupabaseClient;
  const createdUsers: CreatedUser[] = [];
  const createdStripeCustomers: string[] = [];

  test.beforeAll(() => {
    test.skip(requiredEnvMissing(), 'Supabase and Stripe runtime secrets are required.');
    expect(['test', 'live'], 'STRIPE_RUNTIME_MODE must be test or live.').toContain(RAW_STRIPE_RUNTIME_MODE);
    expect(
      STRIPE_SECRET_KEY,
      `This proof is running in ${STRIPE_RUNTIME_MODE} mode and must use the matching Stripe secret key.`
    ).toMatch(IS_LIVE_MODE ? /^sk_live_/ : /^sk_test_/);
    expect(STRIPE_WEBHOOK_SECRET, 'Webhook proof requires a Stripe webhook signing secret.').toMatch(/^whsec_/);
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  test.afterAll(async () => {
    await Promise.allSettled(createdUsers.map((user) => admin.auth.admin.deleteUser(user.id)));
    await Promise.allSettled(createdStripeCustomers.map((customerId) => deleteStripeCustomer(customerId)));
  });

  test(`${STRIPE_RUNTIME_MODE}-mode checkout, entitlement, portal, and downgrade path`, async ({ page }) => {
    const email = `paid-soft-launch-${RUN_ID}@example.com`;
    const customerId = await createStripeCustomer(email);
    createdStripeCustomers.push(customerId);

    const user = await createLiveUser(admin, email, {
      subscription_status: 'free',
      stripe_customer_id: customerId,
      stripe_subscription_id: null,
      subscription_id: null,
    });
    createdUsers.push(user);

    const initialProfile = await readProfile(admin, user.id);
    expect(initialProfile.subscription_status).toBe('free');
    expect(initialProfile.stripe_subscription_id).toBeNull();
    expect(initialProfile.stripe_customer_id).toBe(customerId);

    const token = await authTokenFor(email);
    const functionContext = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
    try {
      const price = await getStripeJson(`prices/${encodeURIComponent(STRIPE_PRO_PRICE_ID!)}?expand[]=product`);
      expect(price.id).toBe(STRIPE_PRO_PRICE_ID);
      expect(price.active).toBe(true);
      expect(
        price.livemode,
        `This proof is running in ${STRIPE_RUNTIME_MODE} mode and must use a matching Stripe price.`
      ).toBe(IS_LIVE_MODE);

      const checkoutResponse = await functionContext.post('/functions/v1/stripe-checkout', {
        headers: {
          apikey: SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        data: {
          plan: 'pro',
          conversionSource: 'paid_soft_launch_runtime',
          utm: {
            source: 'runtime-proof',
            medium: 'playwright',
            campaign: 'paid-soft-launch',
          },
        },
      });
      const checkoutText = await checkoutResponse.text();
      const checkoutBody = checkoutText ? JSON.parse(checkoutText) as { checkoutUrl?: string } : {};
      expect(checkoutResponse.status(), checkoutText).toBe(200);
      expect(checkoutBody.checkoutUrl, checkoutText).toMatch(/^https:\/\/checkout\.stripe\.com\//);

      const checkoutSessionId = parseCheckoutSessionId(checkoutBody.checkoutUrl!);
      expect(checkoutSessionId, checkoutBody.checkoutUrl).toBeTruthy();
      const checkoutSession = await getStripeJson(`checkout/sessions/${encodeURIComponent(checkoutSessionId!)}`);
      expect(checkoutSession.mode).toBe('subscription');
      expect(
        checkoutSession.livemode,
        `Checkout session must be created in ${STRIPE_RUNTIME_MODE} mode.`
      ).toBe(IS_LIVE_MODE);
      expect(checkoutSession.customer).toBe(customerId);
      expect(checkoutSession.customer_email ?? null).toBeNull();
      expect(checkoutSession.client_reference_id).toBe(user.id);

      const profileAfterCheckout = await readProfile(admin, user.id);
      expect(profileAfterCheckout.subscription_status).toBe('free');
      expect(profileAfterCheckout.stripe_subscription_id).toBeNull();
      expect(profileAfterCheckout.stripe_customer_id).toBe(customerId);

      if (!CAN_POST_SYNTHETIC_WEBHOOK) {
        const evidence = {
          runId: RUN_ID,
          proofKind: 'live-key-checkout-smoke',
          stripeMode: STRIPE_RUNTIME_MODE,
          baseUrl: BASE_URL,
          price: {
            id: redactId(price.id),
            livemode: price.livemode,
            active: price.active,
            amount: price.unit_amount,
            currency: price.currency,
            interval: (price.recurring as { interval?: unknown } | undefined)?.interval ?? null,
          },
          checkout: {
            status: checkoutResponse.status(),
            sessionId: redactId(checkoutSessionId),
            sessionLivemode: checkoutSession.livemode,
            reusedCustomer: checkoutSession.customer === customerId,
            customerEmailOmitted: (checkoutSession.customer_email ?? null) === null,
            clientReferenceMatchesUser: checkoutSession.client_reference_id === user.id,
          },
          entitlement: {
            remainedFreeBeforeWebhook: profileAfterCheckout.subscription_status === 'free',
            subscriptionStillNull: profileAfterCheckout.stripe_subscription_id === null,
            customerStored: profileAfterCheckout.stripe_customer_id === customerId,
          },
          webhook: {
            skipped: true,
            reason: 'Live mode requires a real completed payment/webhook, or STRIPE_ALLOW_SYNTHETIC_LIVE_WEBHOOK=true for entitlement-code-only proof.',
          },
          billingPortal: {
            skipped: true,
            reason: 'Paid customer portal proof requires completed entitlement.',
          },
        };
        console.log(`STRIPE_PAID_SOFT_LAUNCH_RUNTIME_EVIDENCE ${JSON.stringify(evidence)}`);
        return;
      }

      let hostedCheckoutCompleted = false;
      let realWebhookPromotedBeforeSynthetic = false;
      let realSubscriptionId: string | null = null;
      let refundCreated = false;
      let cancellationCreated = false;
      let realWebhookDowngradedBeforeSynthetic = false;

      if (COMPLETE_HOSTED_CHECKOUT) {
        await completeHostedStripeCheckout(page, checkoutBody.checkoutUrl!, email);
        hostedCheckoutCompleted = /checkout=success/.test(page.url());
        const completedCheckoutSession = await getStripeJson(`checkout/sessions/${encodeURIComponent(checkoutSessionId!)}`);
        realSubscriptionId = normalizeStripeObjectId(completedCheckoutSession.subscription);
        try {
          await waitForProfile(admin, user.id, (profile) =>
            profile.subscription_status === 'pro' &&
            Boolean(profile.stripe_subscription_id) &&
            profile.stripe_customer_id === customerId
          );
          realWebhookPromotedBeforeSynthetic = true;
        } catch {
          realWebhookPromotedBeforeSynthetic = false;
        }
      }

      const subscriptionId = realSubscriptionId ?? `sub_paid_runtime_${RUN_ID}`;
      const webhookPayload = JSON.stringify({
        id: `evt_paid_runtime_${RUN_ID}`,
        object: 'event',
        api_version: '2024-06-20',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        livemode: IS_LIVE_MODE,
        data: {
          object: {
            id: checkoutSessionId,
            object: 'checkout.session',
            mode: 'subscription',
            customer: customerId,
            subscription: subscriptionId,
            metadata: {
              userId: user.id,
              plan: 'pro',
            },
          },
        },
      });

      const webhookResponse = await functionContext.post('/functions/v1/stripe-webhook', {
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': signStripePayload(webhookPayload),
        },
        data: Buffer.from(webhookPayload, 'utf8'),
      });
      const webhookText = await webhookResponse.text();
      const webhookBody = webhookText ? JSON.parse(webhookText) as { received?: boolean; error?: unknown } : {};
      expect(webhookResponse.status(), webhookText).toBe(200);
      expect(webhookBody.received, webhookText).toBe(true);
      expect(webhookBody.error, webhookText).toBeUndefined();

      const paidProfile = await waitForProfile(admin, user.id, (profile) =>
        profile.subscription_status === 'pro' &&
        profile.stripe_subscription_id === subscriptionId &&
        profile.stripe_customer_id === customerId
      );

      const portalResponse = await functionContext.post('/functions/v1/stripe-billing-portal', {
        headers: {
          apikey: SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      const portalText = await portalResponse.text();
      const portalBody = portalText ? JSON.parse(portalText) as { portalUrl?: string; error?: unknown } : {};
      expect(portalResponse.status(), portalText).toBe(200);
      expect(portalBody.portalUrl, portalText).toMatch(/^https:\/\/billing\.stripe\.com\//);

      if (realSubscriptionId) {
        const paymentIntentId =
          await latestInvoicePaymentIntent(realSubscriptionId) ??
          await latestSucceededPaymentIntentForCustomer(customerId);
        if (paymentIntentId) {
          const refund = await refundPaymentIntent(paymentIntentId);
          refundCreated = typeof refund.id === 'string' && refund.id.startsWith('re_');
        }
        expect(refundCreated, 'A completed Stripe test Checkout should create a refundable test payment.').toBe(true);
        const cancellation = await deleteStripeJson(`subscriptions/${encodeURIComponent(realSubscriptionId)}`);
        cancellationCreated = Boolean(cancellation.deleted) || cancellation.status === 'canceled';
        try {
          await waitForProfile(admin, user.id, (profile) =>
            profile.subscription_status === 'free' &&
            profile.stripe_subscription_id === null
          );
          realWebhookDowngradedBeforeSynthetic = true;
        } catch {
          realWebhookDowngradedBeforeSynthetic = false;
        }
      }

      const downgradePayload = JSON.stringify({
        id: `evt_paid_runtime_downgrade_${RUN_ID}`,
        object: 'event',
        api_version: '2024-06-20',
        type: 'customer.subscription.deleted',
        created: Math.floor(Date.now() / 1000),
        livemode: IS_LIVE_MODE,
        data: {
          object: {
            id: subscriptionId,
            object: 'subscription',
            customer: customerId,
            status: 'canceled',
          },
        },
      });

      const downgradeResponse = await functionContext.post('/functions/v1/stripe-webhook', {
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': signStripePayload(downgradePayload),
        },
        data: Buffer.from(downgradePayload, 'utf8'),
      });
      const downgradeText = await downgradeResponse.text();
      const downgradeBody = downgradeText ? JSON.parse(downgradeText) as { received?: boolean; error?: unknown } : {};
      expect(downgradeResponse.status(), downgradeText).toBe(200);
      expect(downgradeBody.received, downgradeText).toBe(true);
      expect(downgradeBody.error, downgradeText).toBeUndefined();

      const downgradedProfile = await waitForProfile(admin, user.id, (profile) =>
        profile.subscription_status === 'free' &&
        profile.stripe_subscription_id === null &&
        profile.stripe_customer_id === customerId
      );

      const evidence = {
        runId: RUN_ID,
        proofKind: IS_LIVE_MODE ? 'live-key-synthetic-webhook' : 'test-mode-full-spine',
        stripeMode: STRIPE_RUNTIME_MODE,
        baseUrl: BASE_URL,
        price: {
          id: redactId(price.id),
          livemode: price.livemode,
          active: price.active,
          amount: price.unit_amount,
          currency: price.currency,
          interval: (price.recurring as { interval?: unknown } | undefined)?.interval ?? null,
        },
        checkout: {
          status: checkoutResponse.status(),
          sessionId: redactId(checkoutSessionId),
          sessionLivemode: checkoutSession.livemode,
          hostedCheckoutAttempted: COMPLETE_HOSTED_CHECKOUT,
          hostedCheckoutCompleted,
          realWebhookPromotedBeforeSynthetic,
          reusedCustomer: checkoutSession.customer === customerId,
          customerEmailOmitted: (checkoutSession.customer_email ?? null) === null,
          clientReferenceMatchesUser: checkoutSession.client_reference_id === user.id,
        },
        webhook: {
          status: webhookResponse.status(),
          synthetic: IS_LIVE_MODE,
          eventLivemode: IS_LIVE_MODE,
          received: webhookBody.received ?? null,
          profileStatus: paidProfile.subscription_status,
          subscriptionStored: paidProfile.stripe_subscription_id === subscriptionId,
          customerStored: paidProfile.stripe_customer_id === customerId,
        },
        billingPortal: {
          status: portalResponse.status(),
          host: portalBody.portalUrl ? new URL(portalBody.portalUrl).hostname : null,
        },
        cancellation: {
          realSubscriptionId: redactId(realSubscriptionId),
          refundCreated,
          cancellationCreated,
          realWebhookDowngradedBeforeSynthetic,
          syntheticDowngradeStatus: downgradeResponse.status(),
          profileStatus: downgradedProfile.subscription_status,
          subscriptionCleared: downgradedProfile.stripe_subscription_id === null,
          customerPreserved: downgradedProfile.stripe_customer_id === customerId,
        },
      };
      console.log(`STRIPE_PAID_SOFT_LAUNCH_RUNTIME_EVIDENCE ${JSON.stringify(evidence)}`);
      if (!IS_LIVE_MODE) {
        console.log(`STRIPE_TESTMODE_PAID_SOFT_LAUNCH_RUNTIME_EVIDENCE ${JSON.stringify(evidence)}`);
      }
    } finally {
      await functionContext.dispose();
    }
  });
});
