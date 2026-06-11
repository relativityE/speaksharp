import { test, expect } from '../fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from '../helpers';
import logger from '../../../frontend/src/lib/logger';

test('SPA startup diagnostic', async ({ page }) => {

  page.on('console', msg => {
    logger.info({ type: msg.type(), text: msg.text() }, '[BROWSER]');
  });

  page.on('pageerror', err => {
    logger.error({ message: err.message }, '[PAGE ERROR]');
  });

  page.on('request', req => {
    logger.info({ url: req.url(), method: req.method() }, '[REQUEST]');
  });

  page.on('requestfailed', req => {
    logger.warn({ url: req.url() }, '[REQUEST FAILED]');
  });

  logger.info('Navigating to app...');

  // Install the centralized E2E auth + bridge before loading the app.
  // The runtime intentionally rejects mock auth without this manifest.
  await programmaticLoginWithRoutes(page, { userType: 'free' });

  // Use navigateToRoute to satisfy lint and exercise the canonical readiness path.
  await navigateToRoute(page, '/');

  const html = await page.content();
  logger.info({ length: html.length }, 'HTML length:');

  // detect redirect loops
  const url = page.url();
  logger.info({ url }, 'Final URL:');

  // detect hydration
  const rootExists = await page.locator('#root').count();
  logger.info({ rootExists }, 'Root node exists:');
  expect(rootExists, 'React root should be present after navigation').toBeGreaterThan(0);

  // detect readiness signal
  const readyAttr = await page.locator('html[data-app-ready]').count();
  logger.info({ readyAttr }, 'Ready attribute count:');
  expect(readyAttr, 'App readiness attribute should be present').toBeGreaterThan(0);

  const visibleReadyAttr = await page.locator('html[data-app-visible-ready="true"]').count();
  logger.info({ visibleReadyAttr }, 'Visible readiness attribute count:');
  expect(visibleReadyAttr, 'Visible readiness attribute should be true before user-visible assertions').toBeGreaterThan(0);

  // detect React render. data-app-ready is set once React mount is initiated,
  // so wait for a visible brand node before sampling body text.
  await expect(page.getByText('SpeakSharp').first()).toBeVisible({ timeout: 15000 });
  const bodyText = await page.textContent('body');
  logger.info({ snippet: bodyText?.slice(0, 120) }, 'Body snippet:');
  expect(bodyText ?? '', 'Page should render user-visible SpeakSharp content').toContain('SpeakSharp');

  // detect boot signal - use unknown as cast instead of any
  const booted = await page.evaluate(() => (window as unknown as { __APP_BOOTED__?: boolean }).__APP_BOOTED__);
  logger.info({ booted }, 'App booted:');
  expect(booted, 'Boot marker should be true').toBe(true);

  // Confirm Net Mocks (API Interception)
  // We check if a request to supabase was intercepted
  const supabaseRequest = await page.waitForRequest(req => 
    req.url().includes('supabase.co') || req.url().includes('supabase.in'),
    { timeout: 5000 }
  ).catch(() => null);

  if (supabaseRequest) {
    logger.info({ url: supabaseRequest.url() }, 'Interception Check: Request Detected');
  } else {
    logger.warn('Interception Check: NO API REQUESTS DETECTED');
  }

  // Network interception is diagnostic-only; boot/readiness assertions above are the gate.
});
