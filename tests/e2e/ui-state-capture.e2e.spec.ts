// tests/e2e/ui-state-capture.e2e.spec.ts
import { test } from './fixtures';
import { capturePage, navigateToRoute, goToPublicRoute } from './helpers';

const envPages = process.env.UI_CAPTURE_PAGES;
const pagesFromEnv = envPages ? envPages.split(',').map((p) => p.trim()) : undefined;

test.describe('UI State Capture', () => {
  test('captures requested pages', async ({ page, userPage }, testInfo) => {
    const pagesToCapture = pagesFromEnv ?? ['homepage', 'sessions', 'analytics'];

    const captureForPage = async (which: string) => {
      switch (which) {
        case 'homepage':
          // unauthenticated homepage
          await goToPublicRoute(page, '/');
          await capturePage(page, `homepage-unauth-${testInfo.workerIndex}.png`, 'unauth');

          // authenticated homepage
          await capturePage(userPage, `homepage-auth-${testInfo.workerIndex}.png`, 'auth');
          break;

        case 'sessions':
          await navigateToRoute(userPage, '/sessions');
          await capturePage(userPage, `sessions-${testInfo.workerIndex}.png`, 'auth');
          break;

        case 'analytics':
          await navigateToRoute(userPage, '/analytics');
          await capturePage(userPage, `analytics-${testInfo.workerIndex}.png`, 'auth');
          break;

        default:
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
