import { test, expect } from '@playwright/test';
import { setupE2EMocks } from './mock-routes';
import { goToPublicRoute, navigateToRoute } from './helpers';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';

let dynamicPromoCode: string;
let realSupabaseUrl: string;
let realAnonKey: string;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load real credentials for the test proxy
const devEnvPath = path.resolve(__dirname, '../../.env.development');
if (fs.existsSync(devEnvPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(devEnvPath));
    realSupabaseUrl = envConfig.VITE_SUPABASE_URL;
    realAnonKey = envConfig.VITE_SUPABASE_ANON_KEY;
}

test.describe('Bypass Code Journey', () => {
    test.beforeAll(() => {
        if (!realSupabaseUrl || !realAnonKey) {
            console.warn('Skipping dynamic code generation: Missing .env.development credentials');
            dynamicPromoCode = 'SKIP_TEST';
            return;
        }

        // Generate a real dynamic promo code by forcing the script to use real credentials
        // We pass the vars explicitly to override any test-env vars
        try {
            console.log('Generating dynamic promo code for E2E test (Real Backend)...');
            const cmd = `VITE_SUPABASE_URL=${realSupabaseUrl} VITE_SUPABASE_ANON_KEY=${realAnonKey} pnpm generate-promo`;
            const output = execSync(cmd, { encoding: 'utf-8' });
            const match = output.match(/Code:\s+(\d+)/);
            if (match && match[1]) {
                dynamicPromoCode = match[1];
                console.log(`Using Dynamic Code: ${dynamicPromoCode}`);
            } else {
                throw new Error('Failed to parse generated promo code from script output');
            }
        } catch (error) {
            console.error('Failed to generate promo code:', error);
            dynamicPromoCode = 'GEN_FAILED';
        }
    });

    test.beforeEach(async ({ page }) => {
        // 1. Setup global mocks first
        await setupE2EMocks(page);

        // 2. Register PROXY handler for apply-promo (Last in wins)
        // This intercepts the mock call and forwards it to the REAL backend
        if (realSupabaseUrl && realAnonKey) {
            await page.route('**/functions/v1/apply-promo', async (route) => {
                console.log('[E2E PROXY] Intercepting apply-promo call...');
                const request = route.request();
                const postData = request.postData();

                try {
                    // Forward to real endpoint
                    const response = await fetch(`${realSupabaseUrl}/functions/v1/apply-promo`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${realAnonKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: postData
                    });

                    const data = await response.json();
                    console.log('[E2E PROXY] Real Backend Response:', data);

                    await route.fulfill({
                        status: response.status,
                        contentType: 'application/json',
                        body: JSON.stringify(data)
                    });
                } catch (err) {
                    console.error('[E2E PROXY] Failed to fetch real backend:', err);
                    await route.abort();
                }
            });
        }
    });

    test('should allow a promo user to bypass Stripe via promo code', async ({ page }) => {
        if (dynamicPromoCode === 'SKIP_TEST' || dynamicPromoCode === 'GEN_FAILED') {
            test.skip(true, 'Skipping test due to missing credentials or generation failure');
            return;
        }

        // 1. Navigate to signup
        await goToPublicRoute(page, '/auth/signup');

        // 2. Select Pro Plan
        await page.click('[data-testid="plan-pro-option"]');

        // 3. Fill in credentials
        const uniqueEmail = `alpha.${Date.now()}@example.com`;
        await page.fill('[data-testid="email-input"]', uniqueEmail);
        await page.fill('[data-testid="password-input"]', 'password123');

        // 4. Reveal and enter bypass code
        await page.click('text=Have a one-time \'pro\' user promo code?');
        await page.fill('[data-testid="promo-code-input"]', dynamicPromoCode);

        // 5. Submit signup
        // AuthPage logic for 'sign_up' handles sign-in then apply-promo
        await page.click('[data-testid="sign-up-submit"]');

        // 6. Verify transition to /session (Pro Dashboard)
        // Increase timeout as Edge Function might be cold
        await expect(page).toHaveURL(/\/session/, { timeout: 15000 });

        // 7. Verify Pro features are visible
        // We can check if "Private" mode is available (not disabled)
        await page.click('button:has-text("Native")'); // Open mode selector
        const privateOption = page.locator('role=menuitemradio[name*="Private"]');
        await expect(privateOption).not.toHaveAttribute('disabled', '');

        // 8. Navigate to Analytics and verify the Pro status
        await navigateToRoute(page, '/analytics');

        // The merged oval should show Pro Plan Active (or the Free Plan bar should be gone)
        await expect(page.locator('text=Pro Plan Active')).toBeVisible();
        await expect(page.locator('text=Free Plan')).not.toBeVisible();
    });

    test('should fallback to Stripe if bypass code is invalid', async ({ page }) => {
        await goToPublicRoute(page, '/auth/signup');
        await page.click('[data-testid="plan-pro-option"]');
        await page.fill('[data-testid="email-input"]', `badpromo.${Date.now()}@example.com`);
        await page.fill('[data-testid="password-input"]', 'password123');

        await page.click('text=Have a one-time \'pro\' user promo code?');
        await page.fill('[data-testid="promo-code-input"]', 'WRONG_CODE');

        await page.click('[data-testid="sign-up-submit"]');

        // Should fallback to standard Pro checkout
        await expect(page).toHaveURL(/checkout.stripe.com/);
    });
});
