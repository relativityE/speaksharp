import { Page, Response, test as base, expect } from '@playwright/test';
import { stubThirdParties } from './sdkStubs';
import fs from 'fs';
import { AuthPage } from './poms/authPage.pom';

export async function dumpPageState(page: Page, name = 'failure') {
  try {
    const html = await page.content();
    const htmlPath = `debug-${name}.html`;
    const screenshotPath = `debug-${name}.png`;

    fs.writeFileSync(htmlPath, html);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved debug state to ${htmlPath} and ${screenshotPath}`);

    if (fs.existsSync(screenshotPath)) {
      const screenshotContent = fs.readFileSync(screenshotPath, { encoding: 'base64' });
      console.log(`--- DEBUG_SCREENSHOT_BASE64_START_${name} ---`);
      console.log(screenshotContent);
      console.log(`--- DEBUG_SCREENSHOT_BASE64_END_${name} ---`);
    }

  } catch (err) {
    console.error('Failed to dump page state', err);
  }
}

// Extend the base test object with our sandboxed page fixture
export const test = base.extend<{
  sandboxPage: void;
  authPage: AuthPage;
}>({
  sandboxPage: [
    async ({ page }, use) => {
      await page.goto('about:blank');
      await stubThirdParties(page);
      await use();
    },
    { auto: true },
  ],
  authPage: async ({ page }, use) => {
    await use(new AuthPage(page));
  },
});

export { expect };

// Re-exporting Response type for convenience in tests
export type { Response };

/**
 * A helper function to log in a user with a given email and password.
 * It handles navigation to the auth page, filling in credentials,

 * and waiting for the redirect back to the app's home page.
 * @param page The Playwright Page object.
 * @param email The user's email.
 * @param password The user's password.
 */
export async function loginUser(page: Page, email: string, password: string) {
  console.log(`Logging in as: ${email}`);
  const authPage = new AuthPage(page);
  await authPage.goto();
  await authPage.login(email, password);
  await page.waitForURL('/');
  console.log('Successfully redirected to home page after login.');
}

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const html = await page.content();
    console.error(`[E2E DEBUG] Page HTML at failure:\n${html.slice(0, 500)}...`);
    await page.screenshot({ path: `debug-${testInfo.title.replace(/\s+/g, '-')}.png` });
  }
});
