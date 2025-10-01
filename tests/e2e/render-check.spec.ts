import { test, expect } from '@playwright/test';

test.describe('Minimal Render Check', () => {
  test('should load the page and render the application', async ({ page }) => {
    // Set up listeners to catch any errors during page load and execution.
    page.on('console', msg => console.log(`[Browser Console]: ${msg.text()}`));
    page.on('pageerror', err => console.error(`[Browser Page Error]: ${err.message}`));

    // Navigate to the root URL directly.
    await page.goto('/');

    // A short wait to allow for async rendering.
    await page.waitForTimeout(1000);

    // Check if the root div has any content.
    const rootElementContent = await page.locator('#root').innerHTML();
    console.log('Root element HTML length:', rootElementContent.length);
    expect(rootElementContent.length).toBeGreaterThan(100); // Expect more than an empty div.

    // Final check for a key piece of content.
    const isSignInPresent = await page.locator('text=Sign In').isVisible();
    console.log('Sign-in button visible:', isSignInPresent);
    expect(isSignInPresent).toBe(true);
  });
});