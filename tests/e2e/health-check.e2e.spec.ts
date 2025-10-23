import { test, expect } from '@playwright/test';
import { healthCheck } from './shared';

test.describe('Health Check', () => {
  test('should successfully authenticate and display the logged-in state', async ({ page }) => {
    // Use the centralized healthCheck function.
    // This function encapsulates the entire login and verification process.
    await healthCheck(page);

    // The healthCheck function, via programmaticLogin, already confirms that the
    // sign-out button is visible. We can add a final, explicit assertion here
    // for clarity in the test report, ensuring we are on the correct page.
    await expect(page).toHaveURL('/', { timeout: 5000 });
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();

    // Capture a screenshot for verification of the final state.
    await page.screenshot({ path: 'test-results/health-check-success.png' });
  });
});
