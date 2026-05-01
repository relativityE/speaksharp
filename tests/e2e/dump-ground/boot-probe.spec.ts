import { test } from '@playwright/test';
import { goToApp } from '../helpers';

test('forensic boot probe', async ({ page }) => {
  const logs: string[] = [];
  page.on('console', msg => {
    const text = `[BROWSER ${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(text);
  });
  
  page.on('requestfailed', request => {
    const text = `[REQUEST FAILED] ${request.method()} ${request.url()} - ${request.failure()?.errorText}`;
    logs.push(text);
    console.log(text);
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      const text = `[HTTP ERROR] ${response.status()} ${response.url()}`;
      logs.push(text);
      console.log(text);
    }
  });

  console.log('🚀 Starting boot probe...');
  await goToApp(page, '/');
  
  // Wait for 10 seconds to see if signals appear
  await page.waitForTimeout(10000);
  
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  console.log('--- DOM SNAPSHOT ---');
  console.log(html);
  console.log('--------------------');
  
  const appReady = await page.getAttribute('html', 'data-app-ready');
  console.log(`FINAL data-app-ready: ${appReady}`);
});
