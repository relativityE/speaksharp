/**
 * Node script that uses Playwright's library to dump [data-testid] elements on /auth.
 * This script prints a JSON object to stdout.
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5173/auth', { waitUntil: 'networkidle' });
  const els = await page.$$('[data-testid]');
  const dump = {};
  for (const el of els) {
    const id = await el.getAttribute('data-testid');
    const html = await el.evaluate(e => e.outerHTML);
    dump[id] = html;
  }
  console.log(JSON.stringify(dump, null, 2));
  await browser.close();
})();
