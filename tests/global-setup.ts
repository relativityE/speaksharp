// tests/global-setup.ts
import { chromium, type FullConfig } from '@playwright/test';

const port = process.env.PORT || '5173';
const baseURL = `http://localhost:${port}`;

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Aggressive timeouts for "fail fast"
  let retries = 3;
  const retryDelay = 2000; // 2 seconds

  console.log(`[GlobalSetup] Starting fast health check for ${baseURL}...`);

  while (retries > 0) {
    try {
      await page.goto(baseURL, { timeout: 5000 });
      await page.waitForSelector('[data-testid="app-main"]', { state: 'attached', timeout: 5000 });
      console.log(`[GlobalSetup] Health check PASSED. Application is fully rendered at ${baseURL}.`);
      await browser.close();
      return; // Success
    } catch (error) {
      console.warn(`[GlobalSetup] Health check failed. Retrying in ${retryDelay / 1000} seconds... (${retries} retries left)`);
      retries--;
      if (retries > 0) {
        await new Promise(res => setTimeout(res, retryDelay));
      }
    }
  }

  await page.screenshot({ path: 'debug-global-setup-failure.png', fullPage: true });
  await browser.close();
  throw new Error(`[GlobalSetup] FATAL: Application at ${baseURL} did not become ready in time after multiple retries.`);
}

export default globalSetup;
