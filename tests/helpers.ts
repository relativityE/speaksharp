import { expect, Page } from '@playwright/test';

export async function waitForAppReady(page: Page) {
  // Wait for any children under #root (basic mount)
  await page.waitForFunction(() => !!document.querySelector('#root')?.children.length, { timeout: 10000 });

  // Then wait specifically for CTA text
  await page.waitForSelector('button:has-text("Start For Free")', { timeout: 15000 }).catch(async (err) => {
    // dump boot milestones to logs before failing
    const milestones = await page.evaluate(() => (window as any).__boot?.history ?? []);
    console.log('BOOT HISTORY:\n' + milestones.join('\n'));
    throw err;
  });
}
