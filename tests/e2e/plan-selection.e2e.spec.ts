import { test, expect } from '@playwright/test';
import { goToPublicRoute } from './helpers';

test.describe('Plan Selection at Signup', () => {
    test('should display plan selection cards on signup page', async ({ page }) => {
        // Navigate to signup page using approved helper
        await goToPublicRoute(page, '/auth/signup');

        // Wait for page to load
        await page.waitForLoadState('networkidle');

        // Check for "Create Account" header in the Card title
        const createAccountHeading = page.getByRole('heading', { name: 'Create Account' });
        await expect(createAccountHeading).toBeVisible({ timeout: 10000 });

        // Check for Free plan option
        const freeOption = page.getByText('Free');
        await expect(freeOption.first()).toBeVisible();

        // Check for Pro plan option
        const proOption = page.getByText('Pro');
        await expect(proOption.first()).toBeVisible();

        // Check for "Choose Your Plan" label
        const planLabel = page.getByText('Choose Your Plan');
        await expect(planLabel).toBeVisible();

        // Check for Submit button
        const submitButton = page.getByRole('button', { name: 'Submit' });
        await expect(submitButton).toBeVisible();

        // Take screenshot for verification
        await page.screenshot({ path: 'test-results/plan-selection-signup.png', fullPage: true });
    });
});
