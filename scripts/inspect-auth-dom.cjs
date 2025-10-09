const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Ensure the logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto('http://localhost:5173/auth', { waitUntil: 'networkidle' });
    const dataTestIds = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('[data-testid]'));
      const idMap = {};
      for (const el of elements) {
        const id = el.getAttribute('data-testid');
        // Sanitize the outerHTML to prevent issues with control characters in logs
        const html = el.outerHTML.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
        idMap[id] = html;
      }
      return idMap;
    });
    fs.writeFileSync(path.join(logsDir, 'auth-dom.json'), JSON.stringify(dataTestIds, null, 2));
    console.log('DOM inspection successful. Output written to ./logs/auth-dom.json');
  } catch (e) {
    console.error('Playwright script failed:', e.message);
    await page.screenshot({ path: path.join(logsDir, 'auth-dom-inspection-failure.png') });
  } finally {
    await browser.close();
  }
})();