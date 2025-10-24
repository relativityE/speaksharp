import { test, expect } from '@playwright/test';
import { healthCheck } from './shared';

test('smoke test diagnostic', async ({ page }) => {
  await page.goto('/?test=true');

  // Log everything on page load
  const diagnostics = await page.evaluate(() => {
    return {
      url: window.location.href,
      testMode: typeof window.TEST_MODE,
      e2eMode: typeof window.__E2E_MODE__,
      mswReady: typeof window.mswReady,
      hasSetSession: typeof window.__setSupabaseSession,
    }
  });

  console.log('DIAGNOSTICS:', JSON.stringify(diagnostics, null, 2));

  // Now try health check
  await healthCheck(page);
});
