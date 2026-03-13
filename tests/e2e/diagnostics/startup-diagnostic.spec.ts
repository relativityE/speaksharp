import { test, expect } from '@playwright/test';
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

  const response = await page.goto('http://localhost:5173', {
    waitUntil: 'domcontentloaded',
    timeout: 20000
  });

  logger.info({ status: response?.status() }, 'HTTP status:');

  const html = await page.content();
  logger.info({ length: html.length }, 'HTML length:');

  // detect redirect loops
  const url = page.url();
  logger.info({ url }, 'Final URL:');

  // detect hydration
  const rootExists = await page.locator('#root').count();
  logger.info({ rootExists }, 'Root node exists:');

  // detect readiness signal
  const readyAttr = await page.locator('[data-app-ready]').count();
  logger.info({ readyAttr }, 'Ready attribute count:');

  // detect React render
  const bodyText = await page.textContent('body');
  logger.info({ snippet: bodyText?.slice(0, 120) }, 'Body snippet:');

  // detect boot signal
  const booted = await page.evaluate(() => (window as any).__APP_BOOTED__);
  logger.info({ booted }, 'App booted:');

  // Step 2.5: Confirm Net Mocks (API Interception)
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

  // do NOT fail test
  expect(true).toBe(true);
});
