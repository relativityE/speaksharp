// tests/setup/verifyOnlyStepTracker.ts
import { test as base, Page, expect as baseExpect } from '@playwright/test';

type VerifyOnlyTest = {
  page: Page;
};

// By extending the base `test` object, we can create a robust, global setup
// that applies to every test file. This is the single source of truth for test setup.
export const test = base.extend<VerifyOnlyTest & { auto: void }>({
  // This 'auto' fixture will run before every test, automatically.
  // By typing it as `void`, we signal that it doesn't return a value to the test function.
  auto: [
    async ({ page }, use) => {
      // This beforeEach hook is now applied globally.

      // 1. Log network requests for easier debugging.
      page.on("request", (req) => console.log(`[E2E Request] ${req.method()} ${req.url()}`));

      // 2. Navigate to the root of the application.
      await page.goto('/');

      // 3. Wait for the Mock Service Worker to be ready.
      await page.waitForFunction(() => (window as any).mswReady);

      // 4. Verify that no MSW initialization error occurred.
      const mswError = await page.evaluate(() => (window as any).__E2E_MSW_ERROR || false);
      // The .toBeFalsy() matcher does not accept an argument. Custom messages
      // are typically handled by wrapping the assertion or using a different library.
      // For now, we remove the argument to fix the TypeScript error.
      baseExpect(mswError).toBeFalsy();

      await use(); // This continues the test execution.
    },
    { auto: true }, // This option makes the fixture run automatically for every test.
  ],

  page: async ({ page }, use, testInfo) => {
    // Listen for all console events and log them to the test output.
    // This is critical for debugging silent client-side failures.
    page.on('console', msg => {
      const type = msg.type().toUpperCase();
      const text = msg.text();
      // Ignore routine Vite HMR messages to keep the log clean.
      if (text.includes('[vite]')) return;
      console.log(`[BROWSER ${type}]: ${text}`);
    });

    let lastStep: string | undefined;

    // Wrap page.goto
    const originalGoto = page.goto.bind(page);
    page.goto = async (url, options) => {
      lastStep = `Goto ${url}`;
      console.log(`---STEP_START---${lastStep}---STEP_END---`);
      return originalGoto(url, options);
    };

    // Helper to wrap common actions
    const wrapAction = (actionName: string, original: Function) => {
      return async (...args: any[]) => {
        lastStep = `${actionName} ${args[0] ?? ''}`;
        console.log(`---STEP_START---${lastStep}---STEP_END---`);
        return original(...args);
      };
    };

    // Wrap actions
    page.click = wrapAction('Click', page.click.bind(page));
    page.fill = wrapAction('Fill', page.fill.bind(page));
    page.type = wrapAction('Type', page.type.bind(page));

    await use(page);

    // After each test: print last successful step
    if (testInfo.status !== testInfo.expectedStatus) {
      console.log(`---LAST_SUCCESSFUL_STEP---${lastStep ?? 'none'}---LAST_SUCCESSFUL_STEP_END---`);

      // Optional ephemeral screenshot (Base64, in-memory only)
      try {
        const screenshotBuffer = await page.screenshot();
        const screenshot = screenshotBuffer.toString('base64');
        console.log(`---DEBUG_SCREENSHOT_BASE64_START---${screenshot}---DEBUG_SCREENSHOT_BASE64_END---`);
      } catch (e) {
        console.log(`---DEBUG_SCREENSHOT_FAILED---`);
      }
    }
  },
});

// Wrap expect to log automatically
export const expect = new Proxy(baseExpect, {
  get(target, prop: string) {
    if (typeof target[prop as keyof typeof target] === 'function') {
      return (...args: any[]) => {
        console.log(`---STEP_START---Expect ${prop} ${args[0]}---STEP_END---`);
        return (target[prop as keyof typeof target] as Function)(...args);
      };
    }
    return target[prop as keyof typeof target];
  },
});