const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:5173/auth', { waitUntil: 'networkidle' });
    const dataTestIds = await page.evaluate(() => {
      const dump = {};
      const els = document.querySelectorAll('[data-testid]');
      for (const el of els) {
        const id = el.getAttribute('data-testid');
        dump[id] = el.outerHTML;
      }
      return dump;
    });
    console.log(JSON.stringify(dataTestIds, null, 2));
  } catch (error) {
    console.error('Error during DOM inspection:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
