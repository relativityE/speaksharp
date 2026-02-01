// tests/e2e/ui-state-capture.e2e.spec.ts
import { test } from '@playwright/test';
import { programmaticLoginWithRoutes, capturePage, navigateToRoute, goToPublicRoute } from './helpers';

const envPages = process.env.UI_CAPTURE_PAGES;
const pagesFromEnv = envPages ? envPages.split(',').map((p) => p.trim()) : undefined;

test.describe('UI State Capture', () => {
  test('captures requested pages', async ({ page }, testInfo) => {
    // Determine which pages to capture:
    // - default: homepage (unauth + auth)
    // - if env var UI_CAPTURE_PAGES provided: comma-separated pages, e.g. "homepage,sessions,analytics"
    const pagesToCapture = pagesFromEnv ?? ['homepage', 'sessions', 'analytics'];

    // Track login state to avoid redundant MSW re-initialization
    // Each programmaticLoginWithRoutes() calls page.goto('/') which destroys the MSW context
    // and requires a full service worker re-registration (slow and flaky)
    let isLoggedIn = false;

    const captureForPage = async (which: string) => {
      switch (which) {
        case 'homepage':
          // unauthenticated homepage - page.goto() is intentional for unauth state
          await goToPublicRoute(page, '/');
          await capturePage(page, `homepage-unauth-${testInfo.workerIndex}.png`, 'unauth');

          // authenticated homepage
          await programmaticLoginWithRoutes(page);
          isLoggedIn = true;
          await capturePage(page, `homepage-auth-${testInfo.workerIndex}.png`, 'auth');
          break;

        case 'sessions':
          if (!isLoggedIn) {
            await programmaticLoginWithRoutes(page);
            isLoggedIn = true;
          }
          await navigateToRoute(page, '/sessions');
          await capturePage(page, `sessions-${testInfo.workerIndex}.png`, 'auth');
          break;

        case 'analytics':
          if (!isLoggedIn) {
            await programmaticLoginWithRoutes(page);
            isLoggedIn = true;
          }
          await navigateToRoute(page, '/analytics');
          await capturePage(page, `analytics-${testInfo.workerIndex}.png`, 'auth');
          break;

        default:
          // fallback: capture unauth homepage - page.goto() is intentional for unauth state
          await goToPublicRoute(page, '/');
          await capturePage(page, `unknown-${which}-unauth-${testInfo.workerIndex}.png`, 'unauth');
          break;
      }
    };

    for (const p of pagesToCapture) {
      await captureForPage(p);
    }
  });
});
