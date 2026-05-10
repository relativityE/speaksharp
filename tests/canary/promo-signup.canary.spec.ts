import { test, expect, type Page } from '@playwright/test';

const PROMO_CODE = process.env.PROMO_CODE || process.env.VISUAL_TEST_PROMO_CODE;
const TEST_RUN_ID = Date.now();
const TEST_PASSWORD = `SpeakSharp-${TEST_RUN_ID}!`;
const PROMO_EMAIL = `promo-live-${TEST_RUN_ID}@example.com`;
const SECOND_PROMO_EMAIL = `promo-reuse-${TEST_RUN_ID}@example.com`;
const FREE_EMAIL = `free-live-${TEST_RUN_ID}@example.com`;
const EXPECTED_PRIVATE_STARTUP_DIAGNOSTICS = [
  /initializeStrategy already in progress for this mode/i,
  /Unable to determine content-length from response headers/i,
  /CleanUnusedInitializersAndNodeArgs/i,
];

async function collectDiagnostics(page: Page, label: string, expectedPatterns: RegExp[] = []) {
  const diagnostics: string[] = [];
  const isExpected = (text: string) => expectedPatterns.some((pattern) => pattern.test(text));
  page.on('console', (msg) => {
    if (['error', 'warning'].includes(msg.type())) {
      const text = `[${label}] console.${msg.type()}: ${msg.text()}`;
      if (!isExpected(text)) {
        diagnostics.push(text);
      }
    }
  });
  page.on('pageerror', (err) => {
    const text = `[${label}] pageerror: ${err.message}`;
    if (!isExpected(text)) {
      diagnostics.push(text);
    }
  });
  return diagnostics;
}

async function signUp(page: Page, email: string, password: string, promoCode?: string) {
  await page.goto('/auth/signup');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);

  if (promoCode) {
    await page.getByTestId('plan-pro-option').click();
    await page.getByText(/Have a promo code/i).click();
    await page.getByTestId('promo-code-input').fill(promoCode);
  }

  await page.getByTestId('sign-up-submit').click();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.getByTestId('nav-sign-out-button').click();
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
}

test.describe.serial('Live promo signup and tier sanity @canary', () => {
  test.beforeAll(() => {
    test.skip(!PROMO_CODE, 'PROMO_CODE or VISUAL_TEST_PROMO_CODE is required.');
  });

  test('new user can redeem one-time promo and return as existing Pro', async ({ page }) => {
    const diagnostics = await collectDiagnostics(page, 'promo-user', EXPECTED_PRIVATE_STARTUP_DIAGNOSTICS);

    const promoResponse = page.waitForResponse((response) =>
      response.url().includes('/functions/v1/apply-promo') &&
      response.request().method() === 'POST'
    );

    await signUp(page, PROMO_EMAIL, TEST_PASSWORD, PROMO_CODE);

    const response = await promoResponse;
    expect(response.status(), `apply-promo status for ${PROMO_EMAIL}`).toBe(200);
    const body = await response.json();
    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(body.proFeatureMinutes, JSON.stringify(body)).toBeGreaterThan(0);

    await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('stt-mode-select')).toHaveAttribute('data-state', 'private', { timeout: 20_000 });

    await page.goto('/analytics');
    await expect(page.getByText(/Pro Plan Active/i)).toBeVisible({ timeout: 20_000 });

    await signOut(page);
    await signIn(page, PROMO_EMAIL, TEST_PASSWORD);
    await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });

    expect(diagnostics, diagnostics.join('\n')).toEqual([]);
  });

  test('redeemed promo code cannot be reused by a second signup', async ({ page }) => {
    const diagnostics = await collectDiagnostics(page, 'promo-reuse', [
      /server responded with a status of 400/i,
      /Promo code already used/i,
      /Promo bypass failed/i,
    ]);

    const promoResponse = page.waitForResponse((response) =>
      response.url().includes('/functions/v1/apply-promo') &&
      response.request().method() === 'POST'
    );

    await signUp(page, SECOND_PROMO_EMAIL, TEST_PASSWORD, PROMO_CODE);

    const response = await promoResponse;
    expect(response.status(), `reused apply-promo status for ${SECOND_PROMO_EMAIL}`).toBeGreaterThanOrEqual(400);

    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('pro-badge')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /upgrade to pro/i })).toBeVisible({ timeout: 20_000 });

    expect(diagnostics, diagnostics.join('\n')).toEqual([]);
  });

  test('new user without promo lands in current free tier behavior', async ({ page }) => {
    const diagnostics = await collectDiagnostics(page, 'free-user');

    await signUp(page, FREE_EMAIL, TEST_PASSWORD);

    await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pro-badge')).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /upgrade to pro/i })).toBeVisible({ timeout: 20_000 });

    expect(diagnostics, diagnostics.join('\n')).toEqual([]);
  });
});
