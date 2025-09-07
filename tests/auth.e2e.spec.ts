// tests/auth.e2e.spec.ts - FIXED VERSION
import { expect } from '@playwright/test';
import { test } from './setup';
import { stubThirdParties } from './sdkStubs';
import { waitForAppReady } from './helpers';
import { mockGetUserMedia } from './mockMedia';

const mockProUser = {
  id: 'pro-user-id',
  email: 'pro@example.com',
  user_metadata: { subscription_status: 'pro' },
};

const mockProSession = {
  access_token: 'mock-pro-access-token',
  refresh_token: 'mock-pro-refresh-token',
  user: mockProUser,
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
};

test.describe('Authenticated User Flows', () => {
  test.beforeEach(async ({ page }) => {
    // Enhanced logging for debugging
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('ERROR')) {
        console.log('BROWSER ERROR:', msg.text());
      }
    });
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    page.on('requestfailed', req => console.log('FAILED REQUEST:', req.url()));

    // Clear all storage first
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      if (window.indexedDB && window.indexedDB.databases) {
        window.indexedDB.databases().then(dbs =>
          dbs.forEach(db => window.indexedDB.deleteDatabase(db.name))
        );
      }
    });

    await page.addInitScript(() => {
      window.__E2E_MODE__ = true;
      window.__APP_READY__ = false;
      window.__TRANSCRIPTION_SERVICE_READY__ = false;
    });

    await mockGetUserMedia(page);
  });

  test('a Pro user can access the session page without limits', async ({ page }) => {
    await stubThirdParties(page);

    // Enhanced session setup
    await page.addInitScript((session) => {
      window.__E2E_MOCK_SESSION__ = session;
      // Ensure profile is immediately available
      window.__PROFILE_DATA__ = {
        id: session.user.id,
        subscription_status: session.user.user_metadata?.subscription_status || 'free',
        email: session.user.email
      };
      window.__SESSION_READY__ = true;
    }, mockProSession);

    await page.goto('/?e2e=1');

    // Wait for complete initialization
    await page.waitForFunction(() => {
      return window.__SESSION_READY__ === true &&
             document.querySelector('a[href*="session"]') !== null;
    }, { timeout: 15000 });

    await expect(page.getByRole('link', { name: /Session/i })).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Sign In/i })).not.toBeVisible();

    await page.getByRole('link', { name: /Session/i }).click();
    await expect(page).toHaveURL(/.*\/session/);

    // Wait for session page to be fully ready
    await page.waitForFunction(() => {
      const button = document.querySelector('button[name*="Start Session"]');
      return button && !button.disabled;
    }, { timeout: 10000 });

    await expect(page.getByRole('button', { name: /Start Session/i })).toBeVisible();
    await expect(page.getByText(/Upgrade to Pro/i)).not.toBeVisible();
  });

  test('a Free user is shown an upgrade prompt when they hit their usage limit', async ({ page }) => {
    const mockFreeUser = {
      id: 'free-user-id',
      email: 'free@example.com',
      user_metadata: { subscription_status: 'free' },
    };
    const mockFreeSession = {
      access_token: 'mock-free-access-token',
      refresh_token: 'mock-free-refresh-token',
      user: mockFreeUser,
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    await stubThirdParties(page, { usageExceeded: true });

    // Enhanced session setup with proper timing
    await page.addInitScript((session) => {
      window.__E2E_MOCK_SESSION__ = session;
      window.__PROFILE_DATA__ = {
        id: session.user.id,
        subscription_status: session.user.user_metadata?.subscription_status || 'free',
        email: session.user.email
      };
      window.__SESSION_READY__ = true;

      // Mock transcription service readiness
      window.__TRANSCRIPTION_READY__ = false;
    }, mockFreeSession);

    await page.goto('/session?e2e=1');

    // Wait for session page initialization
    await page.waitForFunction(() => {
      return window.__SESSION_READY__ === true &&
             document.querySelector('button[name*="Start Session"]') !== null;
    }, { timeout: 15000 });

    // Ensure Start Session button is enabled
    await page.waitForFunction(() => {
      const button = document.querySelector('button[name*="Start Session"]');
      return button && !button.disabled;
    }, { timeout: 10000 });

    await page.getByRole('button', { name: /Start Session/i }).click();

    // Wait for transcription to be ready before checking Stop button
    await page.waitForFunction(() => {
      // Check if transcription service is initialized
      const hasService = window.transcriptionServiceRef && window.transcriptionServiceRef.current;
      const hasStopButton = document.querySelector('button[name*="Stop Session"]');
      return hasService && hasStopButton;
    }, { timeout: 20000 });

    await expect(page.getByRole('button', { name: /Stop Session/i })).toBeVisible({ timeout: 5000 });

    // Add small delay to ensure transcription is fully started
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: /Stop Session/i }).click();

    // Wait for session end processing with better timeout
    await expect(page.getByRole('heading', { name: 'Session Ended' })).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'Go to Analytics' }).click();

    await expect(page.getByRole('heading', { name: "You've Reached Your Free Limit" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/You've used all your free practice time for this month/)).toBeVisible();
  });
});
