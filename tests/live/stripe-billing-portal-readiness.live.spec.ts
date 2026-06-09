import { test, expect, request as playwrightRequest } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const TEST_EMAIL =
  process.env.BILLING_PORTAL_TEST_EMAIL ??
  process.env.PRO_TEST_EMAIL ??
  process.env.E2E_PRO_EMAIL;
const TEST_PASSWORD =
  process.env.BILLING_PORTAL_TEST_PASSWORD ??
  process.env.PRO_TEST_PASSWORD ??
  process.env.E2E_PRO_PASSWORD;
const RUN_ID = Date.now();

type AuthBody = {
  access_token?: string;
  user?: {
    id?: string;
  };
};

type ProfileSnapshot = {
  stripe_customer_id: string | null;
};

type StripeJson = Record<string, unknown>;

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
  body.set('metadata[speaksharp_test]', 'billing_portal_readiness');
  body.set('metadata[run_id]', String(RUN_ID));
  const customer = await postStripeForm('customers', body);
  expect(customer.id, JSON.stringify({ customer })).toMatch(/^cus_/);
  return customer.id as string;
};

const readProfile = async (
  admin: SupabaseClient,
  userId: string
): Promise<ProfileSnapshot> => {
  const { data, error } = await admin
    .from('user_profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to read profile: ${error.message}`);
  }

  return {
    stripe_customer_id:
      typeof data?.stripe_customer_id === 'string' ? data.stripe_customer_id : null,
  };
};

const updateStripeCustomerId = async (
  admin: SupabaseClient,
  userId: string,
  stripeCustomerId: string | null
) => {
  const { error } = await admin
    .from('user_profiles')
    .update({ stripe_customer_id: stripeCustomerId })
    .eq('id', userId);

  if (error) {
    throw new Error(`Failed to update stripe_customer_id: ${error.message}`);
  }
};

test('deployed Stripe billing portal opens for a paid Stripe customer', async () => {
  test.skip(
    !SUPABASE_URL ||
      !SUPABASE_ANON_KEY ||
      !SUPABASE_SERVICE_ROLE_KEY ||
      !STRIPE_SECRET_KEY ||
      !TEST_EMAIL ||
      !TEST_PASSWORD,
    'SUPABASE_URL, SUPABASE keys, STRIPE_SECRET_KEY, and a paid/pro billing portal test account are required.'
  );

  const admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const authContext = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  const functionContext = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  let createdCustomerId: string | null = null;
  let userId: string | null = null;
  let previousProfile: ProfileSnapshot | null = null;

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

    const authBody = await authResponse.json() as AuthBody;
    expect(authBody.access_token).toBeTruthy();
    userId = authBody.user?.id ?? null;
    expect(userId, 'Supabase password auth response should include user.id.').toBeTruthy();

    previousProfile = await readProfile(admin, userId!);
    createdCustomerId = await createStripeCustomer(TEST_EMAIL!);
    await updateStripeCustomerId(admin, userId!, createdCustomerId);

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
      seededStripeCustomer: Boolean(createdCustomerId),
      previousCustomerPresent: Boolean(previousProfile.stripe_customer_id),
      error: portalBody.error ?? null,
    };
    console.log(`LIVE_STRIPE_BILLING_PORTAL_READINESS_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(portalResponse.status(), portalText).toBe(200);
    expect(portalBody.portalUrl, portalText).toMatch(/^https:\/\/billing\.stripe\.com\//);
  } finally {
    if (userId && previousProfile) {
      await updateStripeCustomerId(admin, userId, previousProfile.stripe_customer_id).catch(() => undefined);
    }
    if (createdCustomerId) {
      await deleteStripeCustomer(createdCustomerId);
    }
    await authContext.dispose();
    await functionContext.dispose();
  }
});
