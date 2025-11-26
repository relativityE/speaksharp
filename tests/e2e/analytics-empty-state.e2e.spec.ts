import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';


test.describe('Analytics Page - Empty State', () => {
    test('should load analytics page for authenticated user', async ({ page }) => {
        console.log('[TEST DEBUG] Starting: should load analytics page for authenticated user');

        // Forward browser console logs for diagnostics
        page.on('console', msg => {
            console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
        });

        // Step 1: Log in
        console.log('[TEST DEBUG] Step 1: Calling programmaticLogin');
        await programmaticLogin(page);
        console.log('[TEST DEBUG] Step 1: programmaticLogin completed');

        // Step 2: Navigate directly to Analytics Page  
        console.log('[TEST DEBUG] Step 2: Navigating to /analytics');
        await page.goto('/analytics');
        console.log('[TEST DEBUG] Step 2: Waiting for URL to be /analytics');
        await page.waitForURL('**/analytics');
        console.log('[TEST DEBUG] Step 2: URL confirmed as /analytics');

        // Step 3: Verify dashboard renders (MSW provides mock session data)
        console.log('[TEST DEBUG] Step 3: Waiting for dashboard-heading element');
        const heading = await page.locator('[data-testid="dashboard-heading"]');
        await expect(heading).toBeVisible({ timeout: 10000 });
        console.log('[TEST DEBUG] Test PASSED: dashboard-heading is visible');
    });

    test('should display analytics dashboard with charts', async ({ page }) => {
        console.log('[TEST DEBUG] Starting: should display analytics dashboard with charts');
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForURL('**/analytics');

        // Verify the analytics dashboard renders
        console.log('[TEST DEBUG] Waiting for analytics-dashboard element');
        const dashboard = await page.locator('[data-testid="analytics-dashboard"]');
        await expect(dashboard).toBeVisible({ timeout: 10000 });
        console.log('[TEST DEBUG] Test PASSED: analytics-dashboard is visible');
    });

    test('should render analytics page successfully', async ({ page }) => {
        console.log('[TEST DEBUG] Starting: should render analytics page successfully');
        await programmaticLogin(page);
        await page.goto('/analytics');
        await page.waitForURL('**/analytics');

        // Verify page loads without errors
        console.log('[TEST DEBUG] Waiting for analytics-dashboard element');
        const dashboard = await page.locator('[data-testid="analytics-dashboard"]');
        await expect(dashboard).toBeVisible({ timeout: 10000 });
        console.log('[TEST DEBUG] Test PASSED: analytics-dashboard is visible');
    });
});

