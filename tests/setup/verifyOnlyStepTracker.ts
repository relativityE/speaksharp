// tests/setup/verifyOnlyStepTracker.ts
import { test as base, Page, expect as baseExpect } from '@playwright/test';

type VerifyOnlyTest = {
  page: Page;
};

// Maximum timeouts for page actions (ms)
const ACTION_TIMEOUT = 10000; // 10s
const NAVIGATION_TIMEOUT = 15000; // 15s

export const test = base.extend<VerifyOnlyTest>({
  page: async ({ page }, use, testInfo) => {
    // Log all console messages from the browser
    page.on('console', (msg) => {
      const type = msg.type().toUpperCase();
      const text = msg.text();
      if (text.includes('[vite]')) return; // ignore routine HMR logs
      console.log(`[BROWSER ${type}]: ${text}`);
    });

    let lastStep: string | undefined;

    // Helper to wrap an action with logging + timeout
    const wrapAction = (actionName: string, original: Function, timeout: number) => {
      return async (...args: any[]) => {
        lastStep = `${actionName} ${args[0] ?? ''}`;
        console.log(`---STEP_START---${lastStep}---STEP_END---`);
        return Promise.race([
          original(...args),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`${actionName} timed out after ${timeout}ms`)), timeout)
          ),
        ]);
      };
    };

    // Wrap page.goto with timeout
    page.goto = wrapAction('Goto', page.goto.bind(page), NAVIGATION_TIMEOUT);
    // Wrap other common actions
    page.click = wrapAction('Click', page.click.bind(page), ACTION_TIMEOUT);
    page.fill = wrapAction('Fill', page.fill.bind(page), ACTION_TIMEOUT);
    page.type = wrapAction('Type', page.type.bind(page), ACTION_TIMEOUT);

    await use(page);

    // After each test: print last successful step and optional screenshot
    if (testInfo.status !== testInfo.expectedStatus) {
      console.log(`---LAST_SUCCESSFUL_STEP---${lastStep ?? 'none'}---LAST_SUCCESSFUL_STEP_END---`);

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

// Export plain base test for smoke tests or cases where logging wrapper is not needed
export const plainTest = base;
export const plainExpect = baseExpect;