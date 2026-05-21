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

test.describe.serial('Live promo abuse throttle @live', () => {
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

  test('blocks the ninth wrong promo-code attempt for one live user', async () => {
    const user = await createLiveUser(admin, `promo-throttle-${RUN_ID}@example.com`);
    createdUsers.push(user);

    const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anon.auth.signInWithPassword({
      email: user.email,
      password: PASSWORD,
    });

    if (error || !data.session?.access_token) {
      throw new Error(`Failed to sign in promo throttle user: ${error?.message ?? 'missing session token'}`);
    }

    const context = await playwrightRequest.newContext({ baseURL: SUPABASE_URL });
    const statuses: number[] = [];
    const errors: Array<string | null> = [];
    try {
      for (let attempt = 1; attempt <= 9; attempt++) {
        const response = await context.post('/functions/v1/apply-promo', {
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
            // Keep the proof isolated from any shared GitHub runner / edge IP history.
            'x-forwarded-for': `203.0.113.${RUN_ID % 200}`,
          },
          data: { promoCode: `wrong-live-${RUN_ID}-${attempt}` },
        });
        const body = await response.json().catch(() => null) as { error?: string } | null;
        statuses.push(response.status());
        errors.push(body?.error ?? null);
      }
    } finally {
      await context.dispose();
    }

    const evidence = {
      attempts: statuses.length,
      statuses,
      lastStatus: statuses.at(-1),
      lastError: errors.at(-1),
    };
    console.log(`LIVE_PROMO_THROTTLE_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(statuses.slice(0, 8), JSON.stringify(evidence)).toEqual(Array(8).fill(400));
    expect(statuses[8], JSON.stringify(evidence)).toBe(429);
    expect(errors[8], JSON.stringify(evidence)).toMatch(/too many promo attempts/i);
  });
});

async function createLiveUser(admin: SupabaseClient, email: string): Promise<CreatedUser> {
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
    subscription_status: 'basic',
    promo_expires_at: null,
    daily_usage_seconds: 0,
    native_usage_seconds: 0,
    cloud_usage_seconds: 0,
  }, { onConflict: 'id' });

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw new Error(`Failed to seed profile for ${email}: ${profileError.message}`);
  }

  return { id: data.user.id, email };
}
