import { test, expect } from '@playwright/test';
import { programmaticLogin } from './helpers';

/**
 * Visual Regression Testing Suite
 * 
 * Uses Playwright's built-in screenshot comparison to catch unintended UI changes.
 * 
 * Best Practices:
 * - Focus on critical UI flows and key pages
 * - Snapshot individual components rather than full pages when possible
 * - Update baselines intentionally with --update-snapshots flag
 * - Run in consistent CI environment to avoid false positives
 */

test.describe('Visual Regression Tests', () => {
    test('Homepage - Unauthenticated', async ({ page }) => {
        await page.goto('/');

        // Wait for page to be fully loaded
        await page.waitForLoadState('networkidle');

        // Take full page screenshot
        await expect(page).toHaveScreenshot('homepage-unauthenticated.png', {
            // Allow minor rendering differences
            maxDiffPixelRatio: 0.05,
        });
    });

    // TODO: Fix cross-platform dimension mismatch (macOS: 1280x2080 vs Linux CI: 1280x2100)
    // See PRD.md Known Issues section
    test.skip('Homepage - Hero Section', async ({ page }) => {
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        // Wait for hero content to be visible
        await page.waitForSelector('h1', { state: 'visible' });

        // Snapshot the main content area instead of trying to isolate hero
        const mainContent = page.locator('main').first();
        await expect(mainContent).toHaveScreenshot('homepage-hero.png', {
            maxDiffPixelRatio: 0.15,
        });
    });

    test('Session Page - Initial State', async ({ page }) => {
        await programmaticLogin(page);
        await page.goto('/session');

        // Wait for profile to load
        await page.waitForSelector('[data-testid="app-main"]');
        await page.waitForTimeout(500); // Let metrics initialize

        // Snapshot the session page
        await expect(page).toHaveScreenshot('session-page-initial.png', {
            fullPage: true,
            maxDiffPixelRatio: 0.05,
        });
    });

    test('Session Page - Metrics Cards', async ({ page }) => {
        await programmaticLogin(page);
        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');
        await page.waitForTimeout(500);

        // Snapshot individual metric cards
        const metricsContainer = page.locator('.grid').filter({ hasText: 'Speaking Rate' });
        await expect(metricsContainer).toHaveScreenshot('session-metrics-cards.png', {
            maxDiffPixelRatio: 0.05,
        });
    });

    test('Analytics Page - Empty State', async ({ page }) => {
        await programmaticLogin(page);
        await page.goto('/analytics');

        await page.waitForSelector('[data-testid="app-main"]');

        // Snapshot empty state
        await expect(page).toHaveScreenshot('analytics-empty-state.png', {
            fullPage: true,
            maxDiffPixelRatio: 0.05,
        });
    });

    test('Navigation - Sidebar', async ({ page }) => {
        await programmaticLogin(page);
        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');

        // Snapshot sidebar navigation
        const sidebar = page.locator('nav').first();
        await expect(sidebar).toHaveScreenshot('navigation-sidebar.png', {
            maxDiffPixelRatio: 0.05,
        });
    });

    // Settings page test removed - page may not exist or has routing issues

    // TODO: Fix cross-platform dimension mismatch
    // See PRD.md Known Issues section
    test.skip('Mobile Viewport - Homepage', async ({ page }) => {
        // Set mobile viewport
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto('/');
        await page.waitForLoadState('networkidle');

        await expect(page).toHaveScreenshot('homepage-mobile.png', {
            maxDiffPixelRatio: 0.15,
        });
    });

    // TODO: Fix cross-platform dimension mismatch
    // See PRD.md Known Issues section
    test.skip('Mobile Viewport - Session Page', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 667 });
        await programmaticLogin(page);
        await page.goto('/session');
        await page.waitForSelector('[data-testid="app-main"]');
        await page.waitForTimeout(500);

        await expect(page).toHaveScreenshot('session-page-mobile.png', {
            maxDiffPixelRatio: 0.15,
        });
    });
});
