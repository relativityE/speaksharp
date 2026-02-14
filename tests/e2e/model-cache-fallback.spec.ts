import { test, expect } from '@playwright/test';
import { programmaticLoginWithRoutes, navigateToRoute } from './helpers';
import { ROUTES, TEST_IDS } from '../constants';

test.describe('Model Cache Fallback', () => {
    test.beforeEach(async ({ page }) => {
        // 1. Programmatic Login to bypass auth UI
        await programmaticLoginWithRoutes(page, { subscriptionStatus: 'pro' });
    });

    test('should fallback to CDN if local models missing', async ({ page }) => {
        // Intercept /models/ requests to simulate missing files (SW not ready or files removed)
        await page.route('**/models/tiny-q8g16.bin', route => {
            console.log('[TEST] Aborting local model request:', route.request().url());
            route.abort('failed');
        });

        await page.route('**/models/tokenizer.json', route => {
            console.log('[TEST] Aborting local tokenizer request:', route.request().url());
            route.abort('failed');
        });

        // Monitor for CDN fallback requests
        const cdnRequests: string[] = [];
        page.on('request', req => {
            if (req.url().includes('rmbl.us') || req.url().includes('huggingface.co')) {
                console.log('[TEST] CDN Fallback Request:', req.url());
                cdnRequests.push(req.url());
            }
        });

        // Navigate and select Private STT
        await navigateToRoute(page, ROUTES.SESSION);

        // Ensure mode selector is visible and click it
        const modeSelect = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
        await modeSelect.click();
        await page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).click();

        // Should see status indicating download (since local failed)
        // The whisper-turbo logs should show fallback warnings in console if we could see them
        await expect(page.locator('[data-testid="model-status-indicator"]')).toBeVisible({ timeout: 10000 });

        // Eventually should succeed via CDN
        await expect(page.locator('[data-testid="model-status-indicator"]')).toContainText(
            /Ready|Loading/i,
            { timeout: 90000 }
        );

        // Verify CDN requests were made
        expect(cdnRequests.length).toBeGreaterThan(0);
        expect(cdnRequests.some(url => url.includes('rmbl.us'))).toBe(true);
    });

    test('should use local cache when available', async ({ page }) => {
        // Allow /models/ to work normally
        await navigateToRoute(page, ROUTES.SESSION);

        // Monitor network to verify NO CDN requests are made
        const cdnRequests: string[] = [];
        page.on('request', req => {
            if (req.url().includes('rmbl.us') || req.url().includes('huggingface.co')) {
                cdnRequests.push(req.url());
            }
        });

        // Select Private STT
        const modeSelect = page.getByTestId(TEST_IDS.STT_MODE_SELECT);
        await modeSelect.click();
        await page.getByTestId(TEST_IDS.STT_MODE_PRIVATE).click();

        // Should reach Ready state (assuming SW has them or they are in public/models)
        await expect(page.locator('[data-testid="model-status-indicator"]')).toContainText(
            'Ready',
            { timeout: 20000 }
        );

        // Verify NO CDN requests (pure cache/local hit)
        expect(cdnRequests).toHaveLength(0);
    });
});
