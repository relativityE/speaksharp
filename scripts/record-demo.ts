import { chromium } from '@playwright/test';
import { PORTS } from './build.config.js';

const BASE_URL = `http://localhost:${PORTS.DEV}`;

(async () => {
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        recordVideo: {
            dir: './demo-recordings/',
            size: { width: 1280, height: 720 }
        }
    });
    const page = await context.newPage();

    console.log('[DEMO] Starting SpeakSharp demo recording...');

    // 1. Landing Page
    console.log('[DEMO] Navigating to landing page...');
    await page.goto(BASE_URL);
    await page.waitForTimeout(2000);

    // 2. Scroll to show features
    console.log('[DEMO] Scrolling to features...');
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(1500);

    // 3. Navigate to Sign In
    console.log('[DEMO] Navigating to Sign In page...');
    await page.goto(`${BASE_URL}/auth/signin`);
    await page.waitForTimeout(2000);

    // 4. Navigate to Session page (using mock auth)
    console.log('[DEMO] Navigating to Session page...');
    await page.goto(`${BASE_URL}/session`);
    await page.waitForTimeout(3000);

    // 5. Navigate to Analytics
    console.log('[DEMO] Navigating to Analytics dashboard...');
    await page.goto(`${BASE_URL}/analytics`);
    await page.waitForTimeout(3000);

    // 6. Scroll to show more analytics
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(2000);

    console.log('[DEMO] Demo recording complete!');

    await context.close();
    await browser.close();

    console.log('[DEMO] Video saved to demo-recordings/');
})();
