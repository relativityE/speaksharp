import { Page } from '@playwright/test';
import { programmaticLogin } from './helpers';

export async function healthCheck(page: Page) {
  await programmaticLogin(page);
  await page.screenshot({ path: 'test-results/health-check-success.png' });
}
