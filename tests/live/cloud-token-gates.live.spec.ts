import { test, expect, request as playwrightRequest } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RUN_ID = Date.now();
const PASSWORD = `SpeakSharp-Live-${RUN_ID}!`;

type CreatedUser = {
  id: string;
  email: string;
};

test.describe.serial('Live Cloud token abuse gates @live', () => {
  let admin: SupabaseClient;
  const createdUsers: CreatedUser[] = [];

  test.beforeAll(() => {
    test.skip(!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY, 'Supabase live secrets are required.');
    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  test.afterAll(async () => {
    await Promise.allSettled(
      createdUsers.map((user) => admin.auth.admin.deleteUser(user.id))
    );
  });

  test('denies expired promo-only Pro and over-quota Pro before minting AssemblyAI token', async () => {
    const expiredPromoUser = await createLiveUser(admin, `cloud-expired-promo-${RUN_ID}@example.com`, {
      subscription_status: 'pro',
      promo_expires_at: '2024-01-01T00:00:00.000Z',
      daily_usage_seconds: 0,
      native_usage_seconds: 0,
      cloud_usage_seconds: 0,
      stripe_subscription_id: null,
      subscription_id: null,
    });
    createdUsers.push(expiredPromoUser);

    const overQuotaUser = await createLiveUser(admin, `cloud-over-quota-${RUN_ID}@example.com`, {
      subscription_status: 'pro',
      promo_expires_at: null,
      daily_usage_seconds: 999_999,
      native_usage_seconds: 0,
      cloud_usage_seconds: 999_999,
      stripe_subscription_id: null,
      subscription_id: null,
    });
    createdUsers.push(overQuotaUser);

    const expiredResult = await requestAssemblyToken(expiredPromoUser.email);
    const overQuotaResult = await requestAssemblyToken(overQuotaUser.email);

    const evidence = {
      expiredPromo: summarizeTokenResult(expiredResult),
      overQuota: summarizeTokenResult(overQuotaResult),
    };
    console.log(`LIVE_CLOUD_TOKEN_GATE_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(expiredResult.status, JSON.stringify(evidence)).toBe(403);
    expect(expiredResult.body?.error, JSON.stringify(evidence)).toMatch(/promo access expired/i);
    expect(overQuotaResult.status, JSON.stringify(evidence)).toBe(429);
    expect(overQuotaResult.body?.token, JSON.stringify(evidence)).toBeFalsy();
  });
});

async function createLiveUser(
  admin: SupabaseClient,
  email: string,
  profile: Record<string, unknown>
): Promise<CreatedUser> {
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
    ...profile,
  }, { onConflict: 'id' });

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw new Error(`Failed to seed profile for ${email}: ${profileError.message}`);
  }

  return { id: data.user.id, email };
}

async function requestAssemblyToken(email: string) {
  const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session?.access_token) {
    throw new Error(`Failed to sign in ${email}: ${error?.message ?? 'missing session token'}`);
  }

  const context = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  try {
    const response = await context.post('/functions/v1/assemblyai-token', {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      data: {},
    });
    const body = await response.json().catch(() => null) as { error?: string; token?: string } | null;
    return { status: response.status(), body };
  } finally {
    await context.dispose();
  }
}

function summarizeTokenResult(result: Awaited<ReturnType<typeof requestAssemblyToken>>) {
  return {
    status: result.status,
    error: result.body?.error ?? null,
    tokenIssued: Boolean(result.body?.token),
  };
}
