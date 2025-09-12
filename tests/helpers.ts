import { test as base, Page, expect, Response } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const WATCHDOG_TIMEOUT = 15000; // 15 seconds
const ARTIFACT_DIR = 'test-results/e2e-artifacts';

async function captureArtifacts(page: Page, label: string) {
  const safeLabel = label.replace(/[^a-z0-9-_]/gi, '_');
  const screenshotPath = path.join(ARTIFACT_DIR, `${safeLabel}.png`);
  const htmlPath = path.join(ARTIFACT_DIR, `${safeLabel}.html`);
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch (err) {
    console.error('Failed to take screenshot:', err);
  }

  try {
    const html = await page.content();
    fs.writeFileSync(htmlPath, html, 'utf8');
  } catch (err) {
    console.error('Failed to save page content:', err);
  }

  console.error(`❌ Watchdog captured artifacts for "${label}" at:`);
  console.error(`   - ${screenshotPath}`);
  console.error(`   - ${htmlPath}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withWatchdog<T extends (...args: any[]) => Promise<any>>(page: Page, fn: T, name: string): T {
  return (async (...args: Parameters<T>) => {
    return await Promise.race([
      fn(...args),
      new Promise((_, reject) =>
        setTimeout(async () => {
          await captureArtifacts(page, `watchdog-${name}`);
          reject(new Error(`❌ Watchdog: ${name} took longer than ${WATCHDOG_TIMEOUT / 1000}s`));
        }, WATCHDOG_TIMEOUT)
      )
    ]);
  }) as T;
}

type TestFixtures = {
  page: Page;
};

export const test = base.extend<TestFixtures>({
  page: async ({ page }, use) => {
    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
    page.on('pageerror', err => console.error('BROWSER ERROR:', err));

    const originalGoto = page.goto.bind(page);
    page.goto = withWatchdog(page, originalGoto, 'page.goto');

    const originalWaitForURL = page.waitForURL.bind(page);
    page.waitForURL = withWatchdog(page, originalWaitForURL, 'page.waitForURL');

    const originalWaitForLoadState = page.waitForLoadState.bind(page);
    page.waitForLoadState = withWatchdog(page, originalWaitForLoadState, 'page.waitForLoadState');

    await use(page);
  },
});

export { expect };
export type { Response, Page };
