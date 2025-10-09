const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    console.log('[MSW Verify] Navigating to homepage...');
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    await page.goto('http://localhost:5173/', { timeout: 15000 });

    console.log('[MSW Verify] Waiting for window.mswReady promise to resolve...');
    await page.evaluate(async () => {
      await window.mswReady;
    });
    console.log('[MSW Verify] ✅ Success! window.mswReady promise resolved.');
  } catch (error) {
    console.error('[MSW Verify] ❌ FAILED:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
