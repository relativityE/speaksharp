import { Page } from '@playwright/test';
import logger from '../../frontend/src/lib/logger';

const BLOCKED_DOMAINS = [
  'sentry.io',
  'posthog.com',
  'google.com',
  'googleapis.com',
  'gstatic.com',
];

export async function stubThirdParties(page: Page) {
  for (const domain of BLOCKED_DOMAINS) {
    await page.route(`**/*.${domain}/*`, (route) => {
      logger.error({ url: route.request().url() }, `[STUB] Blocked external request to ${domain}`);
      return route.abort('connectionrefused');
    });
  }

  await page.route('**/*.stripe.com/*', (route) => {
    logger.info({ url: route.request().url() }, '[STUB] Mocked Stripe request');
    return route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* Mock Stripe.js */' });
  });
}