// tests/e2e/dom-dump.spec.ts
import { test, expect } from '@playwright/test';
import fs from 'fs';

test.describe('DOM and Console Dump', () => {
  const capturedLogs: string[] = [];

  test.beforeEach(async ({ page }) => {
    // Listen to all console events and store them
    page.on('console', msg => {
      capturedLogs.push(`[${msg.type()}] ${msg.text()}`);
    });
  });

  test('should load the homepage and dump the DOM', async ({ page }) => {
    await page.goto('/');

    // Wait for MSW to be ready
    try {
      await page.waitForFunction(() => window.mswReady, null, { timeout: 15000 });
      console.log('MSW is ready.');
    } catch (error) {
      console.error('Timed out waiting for MSW to become ready.');
      // We still proceed to dump the DOM and logs for debugging
    }

    // Dump the DOM content to a file
    const domContent = await page.content();
    fs.writeFileSync('debug-dom.html', domContent);
    console.log('DOM content has been saved to debug-dom.html');

    // The test will pass if it reaches here, its purpose is artifact generation
    expect(domContent.length).toBeGreaterThan(100);
  });

  test.afterEach(() => {
    // Write captured console logs to a file
    fs.writeFileSync('debug-console.log', capturedLogs.join('\\n'));
    console.log('Browser console logs saved to debug-console.log');
  });
});