import { test as base, Page, expect as baseExpect } from '@playwright/test';

type VerifyOnlyTest = {
  page: Page;
};

export const test = base.extend<VerifyOnlyTest>({
  page: async ({ page }, use, testInfo) => {
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