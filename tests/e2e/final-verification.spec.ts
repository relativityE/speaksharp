import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';
import { MOCK_SESSIONS } from './fixtures/mockData';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCREENSHOT_PATH = path.join(__dirname, 'final-dashboard.png');

test.use({
  trace: 'on-first-retry',
  video: 'retain-on-failure',
});

test.describe('Final UI and Data Verification', () => {
  test('should render the themed, populated dashboard on the analytics page', async ({ page }) => {
    await programmaticLogin(page);

    await page.goto('/analytics');

    // Check that a key data-driven element is visible
    const speakingPaceCard = page.locator('[data-testid="speaking-pace"]');
    await expect(speakingPaceCard).toBeVisible({ timeout: 20000 });

    // Optional sanity check against empty state
    const emptyState = page.locator('text="Start practicing"');
    await expect(emptyState).not.toBeVisible();

    // Quick verification that the first session from mock data is present
    const firstSessionText = page.locator(`text="${MOCK_SESSIONS[0].id}"`);
    await expect(firstSessionText).toBeVisible();

    // Capture screenshot
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    console.log(`Screenshot of populated dashboard captured at ${SCREENSHOT_PATH}`);
  });
});
