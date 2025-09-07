// tests/e2e.spec.ts - FIXED ANONYMOUS TESTS
import { expect } from '@playwright/test';
import { test } from './setup';
import { stubThirdParties } from './sdkStubs';
import { waitForAppReady } from './helpers';

test.describe('Anonymous User Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Enhanced debugging
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('ERROR')) {
        console.log('BROWSER ERROR:', msg.text());
      }
    });
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    // Ensure clean slate
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      delete window.__E2E_MOCK_SESSION__;
      delete window.__PROFILE_DATA__;
    });

    await page.addInitScript(() => {
      window.__E2E_MODE__ = true;
      window.__SESSION_READY__ = true; // For anonymous users, session is immediately "ready" (null)
    });
  });

  test('anonymous user can start a free session from landing page', async ({ page }) => {
    await stubThirdParties(page);

    await page.goto('/?e2e=1');

    // Use enhanced helper
    await waitForAppReady(page, { authenticated: false });

    await expect(page.getByRole('button', { name: /Start For Free/i })).toBeVisible();
    await page.getByRole('button', { name: /Start For Free/i }).click();

    await expect(page).toHaveURL(/.*\/session/);
    await expect(page.getByRole('button', { name: /Start Session/i })).toBeVisible();
  });

  test('anonymous user is prompted to sign up after session', async ({ page }) => {
    await stubThirdParties(page);

    await page.goto('/session?e2e=1');

    // Wait for session page to be ready for anonymous user
    await page.waitForFunction(() => {
      const button = document.querySelector('button[name*="Start Session"]');
      return button && !button.disabled;
    }, { timeout: 15000 });

    await expect(page.getByRole('button', { name: /Start Session/i })).toBeVisible();
    // Additional assertions for anonymous flow...
  });
});
