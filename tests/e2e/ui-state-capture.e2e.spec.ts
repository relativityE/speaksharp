// tests/e2e/ui-state-capture.e2e.spec.ts
import { test, expect } from '@playwright/test';
import { programmaticLogin, capturePage } from './helpers';

test.describe('UI State Capture', () => {
  test('captures requested pages', async ({ page }) => {
    console.log('[UI CAPTURE] Starting unauthenticated capture.');

    // UNAUTHENTICATED STATE
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    console.log('[UI CAPTURE] Page loaded for unauthenticated state.');
    await capturePage(page, 'unauthenticated-homepage.png', 'unauth');

    const signInVisible = await page.getByRole('link', { name: 'Sign In' }).isVisible();
    console.log('[UI CAPTURE] Sign In link visibility:', signInVisible);
    await expect(signInVisible).toBe(true);

    console.log('[UI CAPTURE] Starting authentication.');
    // AUTHENTICATED STATE
    await programmaticLogin(page);

    console.log('[UI CAPTURE] Logged in, capturing authenticated homepage.');
    await capturePage(page, 'authenticated-homepage.png', 'auth');

    const signOutVisible = await page.getByTestId('nav-sign-out-button').isVisible();
    console.log('[UI CAPTURE] Sign Out button visibility:', signOutVisible);
    await expect(signOutVisible).toBe(true);

    // Optional: capture additional pages for visual verification
    const pagesToCapture = [
      { name: 'dashboard', path: '/dashboard' },
      { name: 'profile', path: '/profile' },
      { name: 'sessions', path: '/sessions' },
    ];

    for (const { name, path } of pagesToCapture) {
      console.log(`[UI CAPTURE] Navigating to ${path}`);
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      console.log(`[UI CAPTURE] Capturing ${name} page.`);
      await capturePage(page, `page-${name}.png`, 'auth');
    }

    console.log('[UI CAPTURE] UI state capture completed successfully.');
  });
});
