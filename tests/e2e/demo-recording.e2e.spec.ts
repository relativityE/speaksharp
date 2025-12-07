import { test } from '@playwright/test';
import { programmaticLogin, navigateToRoute } from './helpers';

/**
 * Demo Recording Test
 * 
 * Run with: pnpm exec playwright test tests/e2e/demo-recording.e2e.spec.ts --project=chromium
 * 
 * Video will be saved to test-results/
 */
test.describe('SpeakSharp Demo Recording', () => {
    test('Full product demo walkthrough', async ({ browser }) => {
        // Create context with video recording explicitly enabled
        const context = await browser.newContext({
            recordVideo: {
                dir: 'test-results/videos/',
                size: { width: 1280, height: 720 }
            }
        });
        const page = await context.newPage();

        // Use slow motion for better demo visibility
        // 1. Landing Page
        console.log('[DEMO] Step 1: Landing Page');
        await page.goto('/');
        await page.waitForSelector('[data-testid="app-main"]');
        await page.waitForTimeout(2000);

        // Scroll to show features
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(1500);

        // 2. Sign In Page
        console.log('[DEMO] Step 2: Sign In Page');
        await page.goto('/auth/signin');
        await page.waitForTimeout(2000);

        // 3. Login and go to Session Page
        console.log('[DEMO] Step 3: Session Page (authenticated)');
        await programmaticLogin(page);
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="app-main"]', { timeout: 10000 });
        await page.waitForTimeout(2000);

        // 4. Click Start to show recording state
        console.log('[DEMO] Step 4: Starting session');
        const startButton = page.getByRole('button', { name: /start/i });
        if (await startButton.isVisible()) {
            await startButton.click();
            await page.waitForTimeout(3000);

            // Stop the session
            const stopButton = page.getByRole('button', { name: /stop/i }).first();
            if (await stopButton.isVisible()) {
                await stopButton.click();
                await page.waitForTimeout(1000);
            }
        }

        // 5. Navigate to Analytics
        console.log('[DEMO] Step 5: Analytics Dashboard');
        await navigateToRoute(page, '/analytics');
        await page.waitForSelector('[data-testid="dashboard-heading"]', { timeout: 10000 });
        await page.waitForTimeout(2000);

        // Scroll to show more content
        await page.evaluate(() => window.scrollBy(0, 300));
        await page.waitForTimeout(2000);

        // 6. Show Goals section
        console.log('[DEMO] Step 6: Goals Section');
        const goalsSection = page.getByText('Current Goals');
        if (await goalsSection.isVisible()) {
            await goalsSection.scrollIntoViewIfNeeded();
            await page.waitForTimeout(1500);
        }

        // 7. Scroll to Session History
        console.log('[DEMO] Step 7: Session History');
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(2000);

        console.log('[DEMO] ✅ Demo recording complete!');

        // Close context to ensure video is saved
        await context.close();
    });
});
