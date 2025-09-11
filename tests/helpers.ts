// tests/helpers.ts - ENHANCED VERSION
import { Page } from '@playwright/test';

export async function waitForAppReady(page: Page, options: {
  authenticated?: boolean,
  waitForButton?: string
} = {}) {
  // Wait for React root
  await page.waitForFunction(() => !!document.querySelector('#root')?.children.length, { timeout: 10000 });

  // Wait for session initialization if authenticated
  if (options.authenticated) {
    await page.waitForFunction(() => {
      return window.__SESSION_READY__ === true && window.__STUBS_READY__ === true;
    }, { timeout: 15000 });
  }

  // Wait for specific button or default landing button
  const buttonText = options.waitForButton || "Start For Free";
  try {
    await page.waitForSelector(`button:has-text("${buttonText}")`, { timeout: 15000 });
  } catch (err) {
    // Enhanced debugging
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const milestones = await page.evaluate(() => (window as any).__boot?.history ?? []);
    const sessionReady = await page.evaluate(() => window.__SESSION_READY__);
    const stubsReady = await page.evaluate(() => window.__STUBS_READY__);
    const mockSession = await page.evaluate(() => window.__E2E_MOCK_SESSION__);

    console.log('BOOT HISTORY:', milestones.join('\n'));
    console.log('SESSION_READY:', sessionReady);
    console.log('STUBS_READY:', stubsReady);
    console.log('MOCK_SESSION:', !!mockSession);

    throw err;
  }
}
