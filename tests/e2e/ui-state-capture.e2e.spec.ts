// tests/e2e/ui-state-capture.e2e.spec.ts
import { test } from '@playwright/test';
import { programmaticLogin, capturePage } from './helpers';

const envPages = process.env.UI_CAPTURE_PAGES;
const pagesFromEnv = envPages ? envPages.split(',').map((p) => p.trim()) : undefined;

test.describe('UI State Capture', () => {
  test('captures requested pages', async ({ page }, testInfo) => {
    // Determine which pages to capture:
    // - default: homepage (unauth + auth)
    // - if env var UI_CAPTURE_PAGES provided: comma-separated pages, e.g. "homepage,sessions,analytics"
    const pagesToCapture = pagesFromEnv ?? ['homepage'];

    const captureForPage = async (which: string) => {
      switch (which) {
        case 'homepage':
          // unauthenticated homepage
          await page.goto('/');
          await capturePage(page, `homepage-unauth-${testInfo.workerIndex}.png`, 'unauth');

          // authenticated homepage
          await programmaticLogin(page);
          await capturePage(page, `homepage-auth-${testInfo.workerIndex}.png`, 'auth');
          break;

        case 'sessions':
          await programmaticLogin(page);
          await page.goto('/sessions');
          await capturePage(page, `sessions-${testInfo.workerIndex}.png`, 'auth');
          break;

        case 'analytics':
          await programmaticLogin(page);
          await page.goto('/analytics');
          await capturePage(page, `analytics-${testInfo.workerIndex}.png`, 'auth');
          break;

        default:
          // fallback: capture unauth homepage
          await page.goto('/');
          await capturePage(page, `unknown-${which}-unauth-${testInfo.workerIndex}.png`, 'unauth');
          break;
      }
    };

    for (const p of pagesToCapture) {
      await captureForPage(p);
    }
  });
});
