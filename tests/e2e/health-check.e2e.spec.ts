import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

test.describe('Health Check', () => {
  test('should successfully authenticate and display the logged-in state on the homepage', async ({ page }) => {
    // The programmaticLogin helper handles the entire authentication flow,
    // including waiting for the UI to update. It contains the core assertion
    // that the 'nav-sign-out-button' becomes visible.
    await programmaticLogin(page);

    // After login, the user should remain on the landing page, but in an
    // authenticated state. We verify the URL has not changed.
    await expect(page).toHaveURL('/', { timeout: 5000 });

    // The final confirmation is that the sign-out button is indeed visible,
    // which is already asserted inside programmaticLogin. For clarity in test
    // reporting, we can assert it again here.
    await expect(page.getByTestId('nav-sign-out-button')).toBeVisible();

    // Capture a screenshot for verification of the final state.
    await page.screenshot({ path: 'test-results/health-check-success.png' });
  });
});
