import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const BASE_URL = process.env.BASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RUN_ID = Date.now();
const EMAIL = `expired-promo-denial-${RUN_ID}@example.com`;
const PASSWORD = `SpeakSharp-Expired-${RUN_ID}!`;

test.describe.serial('Live expired promo denial @live', () => {
  let admin: SupabaseClient;
  let userId: string | null = null;

  test.beforeAll(() => {
    test.skip(
      !BASE_URL || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY,
      'BASE_URL and Supabase live secrets are required.'
    );

    admin = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  test.afterAll(async () => {
    if (userId) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  });

  test('expired promo-only Pro is downgraded, shown dismissible dialog, and forced to Free STT mode', async ({ page }) => {
    userId = await createExpiredPromoUser(admin);

    const usageLimitResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/functions/v1/check-usage-limit') &&
      response.request().method() === 'POST'
    );

    await signIn(page);
    await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });

    const usageLimitResponse = await usageLimitResponsePromise;
    const usageLimitBody = await usageLimitResponse.json().catch(() => null) as {
      promo_just_expired?: boolean
      subscription_status?: string
      is_pro?: boolean
      can_start?: boolean
    } | null;

    await expect(page.getByTestId('promo-expired-continue-free')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('promo-expired-upgrade-button')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('promo-expired-continue-free').click();
    await expect(page.getByTestId('promo-expired-continue-free')).not.toBeVisible({ timeout: 10_000 });

    const modeSelect = page.getByTestId('stt-mode-select');
    await expect(modeSelect).toHaveAttribute('data-state', 'native', { timeout: 20_000 });
    await expect(page.getByTestId('pro-badge')).not.toBeVisible({ timeout: 10_000 });

    const profile = await readProfile(admin, userId);

    const evidence = {
      checkUsageStatus: usageLimitResponse.status(),
      promoJustExpired: usageLimitBody?.promo_just_expired ?? null,
      effectiveSubscriptionStatus: usageLimitBody?.subscription_status ?? null,
      isPro: usageLimitBody?.is_pro ?? null,
      canStart: usageLimitBody?.can_start ?? null,
      storedSubscriptionStatus: profile.subscription_status,
      storedPromoExpired: new Date(profile.promo_expires_at).getTime() < Date.now(),
      dialogDismissed: true,
      sttMode: await modeSelect.getAttribute('data-state'),
    };

    console.log(`LIVE_EXPIRED_PROMO_DENIAL_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(evidence.checkUsageStatus, JSON.stringify(evidence)).toBe(200);
    expect(evidence.promoJustExpired, JSON.stringify(evidence)).toBe(true);
    expect(evidence.effectiveSubscriptionStatus, JSON.stringify(evidence)).toBe('free');
    expect(evidence.isPro, JSON.stringify(evidence)).toBe(false);
    expect(evidence.storedSubscriptionStatus, JSON.stringify(evidence)).toBe('free');
    expect(evidence.sttMode, JSON.stringify(evidence)).toBe('native');
  });
});

async function createExpiredPromoUser(admin: SupabaseClient) {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`Failed to create expired promo user: ${error?.message ?? 'no user returned'}`);
  }

  const { error: profileError } = await admin.from('user_profiles').upsert({
    id: data.user.id,
    subscription_status: 'pro',
    promo_expires_at: '2024-01-01T00:00:00.000Z',
    daily_usage_seconds: 0,
    native_usage_seconds: 0,
    cloud_usage_seconds: 0,
    stripe_subscription_id: null,
    subscription_id: null,
  }, { onConflict: 'id' });

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
    throw new Error(`Failed to seed expired promo profile: ${profileError.message}`);
  }

  return data.user.id;
}

async function signIn(page: Page) {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(EMAIL);
  await page.getByTestId('password-input').fill(PASSWORD);
  await page.getByTestId('sign-in-submit').click();
}

async function readProfile(admin: SupabaseClient, id: string) {
  const { data, error } = await admin
    .from('user_profiles')
    .select('subscription_status,promo_expires_at')
    .eq('id', id)
    .single();

  if (error || !data) {
    throw new Error(`Failed to read expired promo profile: ${error?.message ?? 'no profile returned'}`);
  }

  return data as { subscription_status: string; promo_expires_at: string };
}
