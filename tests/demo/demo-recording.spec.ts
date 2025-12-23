import { test } from '@playwright/test';
import { programmaticLogin, navigateToRoute } from '../e2e/helpers';

/**
 * Demo Recording Test - Shows Cloud AI and Native STT Modes
 * 
 * Run with: pnpm build:test && pnpm exec playwright test --config=playwright.demo.config.ts
 * 
 * Video will be saved to test-results/videos/
 * 
 * This demo showcases:
 * 1. Landing page
 * 2. Sign-in flow
 * 3. Session page with STT mode selector
 * 4. Cloud AI mode recording (Pro feature)
 * 5. Native mode recording (Free feature)
 * 6. Analytics dashboard
 * 
 * Note: On-Device mode skipped as it requires Whisper model download (~30MB)
 */
test.describe('SpeakSharp Demo Recording', () => {
    test('Product demo with Cloud AI and Native modes', async ({ browser }) => {
        // Create context with video recording
        const context = await browser.newContext({
            recordVideo: {
                dir: 'test-results/videos/',
                size: { width: 1280, height: 720 }
            }
        });
        const page = await context.newPage();

        // Helper to select mode, start, record briefly, and stop
        const demoMode = async (modeName: 'Cloud AI' | 'Native', duration: number = 4000) => {
            console.log(`[DEMO] Selecting ${modeName} mode`);

            // Open dropdown
            const modeButton = page.getByRole('button', { name: /Native|Cloud AI|On-Device/ });
            await modeButton.click();
            await page.waitForTimeout(1500); // Pause to show all options

            // Select the mode
            const modeOption = page.getByRole('menuitemradio', { name: modeName });
            await modeOption.click();
            await page.waitForTimeout(500);

            // Start session
            console.log(`[DEMO] Starting ${modeName} session`);
            const startButton = page.getByTestId('session-start-stop-button');
            await startButton.click();

            // Wait for connection and record briefly
            await page.waitForTimeout(duration);

            // Stop session
            console.log(`[DEMO] Stopping ${modeName} session`);
            await startButton.click();
            await page.waitForTimeout(1000);

            // Handle any dialog - stay on page
            const stayButton = page.getByRole('button', { name: 'Stay on Page' });
            if (await stayButton.isVisible({ timeout: 2000 }).catch(() => false)) {
                await stayButton.click();
                await page.waitForTimeout(500);
            }
        };

        // ========================================
        // 1. Landing Page
        // ========================================
        console.log('[DEMO] Step 1: Landing Page');
        await page.goto('/');
        await page.waitForSelector('[data-testid="app-main"]');
        await page.waitForTimeout(2000);
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(1500);

        // ========================================
        // 2. Sign In Page
        // ========================================
        console.log('[DEMO] Step 2: Sign In Page');
        await page.goto('/auth/signin');
        await page.waitForTimeout(2000);

        // ========================================
        // 3. Login as Pro User
        // ========================================
        console.log('[DEMO] Step 3: Logging in');
        await programmaticLogin(page);
        await navigateToRoute(page, '/session');
        await page.waitForSelector('[data-testid="session-start-stop-button"]', { timeout: 10000 });
        await page.waitForTimeout(2000);

        // ========================================
        // 4. Demo Cloud AI Mode (AssemblyAI)
        // ========================================
        console.log('[DEMO] Step 4: Cloud AI Mode');
        await demoMode('Cloud AI', 5000);

        // ========================================
        // 5. Demo Native Mode (Browser Speech API)
        // ========================================
        console.log('[DEMO] Step 5: Native Mode');
        await demoMode('Native', 5000);

        // ========================================
        // 6. Navigate to Analytics Dashboard
        // ========================================
        console.log('[DEMO] Step 6: Analytics Dashboard');
        await navigateToRoute(page, '/analytics');
        await page.waitForTimeout(2000);

        // Scroll to show content
        await page.evaluate(() => window.scrollBy(0, 400));
        await page.waitForTimeout(2000);

        console.log('[DEMO] ✅ Demo recording complete!');
        await context.close();
    });
});
