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

  test('denies missing auth before minting AssemblyAI token', async () => {
    const result = await requestAssemblyTokenWithoutAuth();
    const evidence = {
      missingAuth: summarizeTokenResult(result),
    };
    console.log(`LIVE_CLOUD_TOKEN_MISSING_AUTH_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(result.status, JSON.stringify(evidence)).toBe(401);
    expect(result.body?.token, JSON.stringify(evidence)).toBeFalsy();
  });

  test('allows paid Pro and denies Free, active trial, and over-quota Pro before minting AssemblyAI token', async () => {
    const freeUser = await createLiveUser(admin, `cloud-free-${RUN_ID}@example.com`, {
      subscription_status: 'free',
      trial_started_at: '2024-01-01T00:00:00.000Z',
      trial_expires_at: '2024-01-01T01:00:00.000Z',
      daily_usage_seconds: 0,
      native_usage_seconds: 0,
      cloud_usage_seconds: 0,
      stripe_subscription_id: null,
      subscription_id: null,
    });
    createdUsers.push(freeUser);

    const activeTrialUser = await createLiveUser(admin, `cloud-trial-${RUN_ID}@example.com`, {
      subscription_status: 'free',
      trial_started_at: new Date(Date.now() - 60_000).toISOString(),
      trial_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      daily_usage_seconds: 0,
      native_usage_seconds: 0,
      cloud_usage_seconds: 0,
      stripe_subscription_id: null,
      subscription_id: null,
    });
    createdUsers.push(activeTrialUser);

    const paidProUser = await createLiveUser(admin, `cloud-paid-pro-${RUN_ID}@example.com`, {
      subscription_status: 'pro',
      trial_started_at: null,
      trial_expires_at: null,
      daily_usage_seconds: 0,
      native_usage_seconds: 0,
      cloud_usage_seconds: 0,
      stripe_subscription_id: `sub_live_gate_paid_${RUN_ID}`,
      subscription_id: null,
    });
    createdUsers.push(paidProUser);

    const overQuotaUser = await createLiveUser(admin, `cloud-over-quota-${RUN_ID}@example.com`, {
      subscription_status: 'pro',
      trial_started_at: new Date(Date.now() - 60_000).toISOString(),
      trial_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      daily_usage_seconds: 999_999,
      native_usage_seconds: 0,
      cloud_usage_seconds: 999_999,
      stripe_subscription_id: `sub_live_gate_over_quota_${RUN_ID}`,
      subscription_id: null,
    });
    createdUsers.push(overQuotaUser);

    const freeResult = await requestAssemblyToken(freeUser.email);
    const activeTrialResult = await requestAssemblyToken(activeTrialUser.email);
    const paidProResult = await requestAssemblyToken(paidProUser.email);
    const overQuotaResult = await requestAssemblyToken(overQuotaUser.email);

    const evidence = {
      free: summarizeTokenResult(freeResult),
      activeTrial: summarizeTokenResult(activeTrialResult),
      paidPro: summarizeTokenResult(paidProResult),
      overQuota: summarizeTokenResult(overQuotaResult),
    };
    console.log(`LIVE_CLOUD_TOKEN_GATE_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(freeResult.status, JSON.stringify(evidence)).toBe(403);
    expect(freeResult.body?.error, JSON.stringify(evidence)).toMatch(/Cloud STT is available (?:with Pro|as a Pro feature)|pro trial or subscription required/i);
    expect(freeResult.body?.token, JSON.stringify(evidence)).toBeFalsy();
    expect(activeTrialResult.status, JSON.stringify(evidence)).toBe(403);
    expect(activeTrialResult.body?.error, JSON.stringify(evidence)).toMatch(/Cloud STT is available (?:with Pro|as a Pro feature)|Trial access includes Private STT/i);
    expect(activeTrialResult.body?.token, JSON.stringify(evidence)).toBeFalsy();
    expect(paidProResult.status, JSON.stringify(evidence)).toBe(200);
    expect(paidProResult.body?.token, JSON.stringify(evidence)).toBeTruthy();
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

async function requestAssemblyTokenWithoutAuth() {
  const context = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
  try {
    const response = await context.post('/functions/v1/assemblyai-token', {
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
