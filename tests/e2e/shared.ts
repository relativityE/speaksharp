import { Page } from '@playwright/test';
import { programmaticLogin } from './helpers';

import fs from 'fs';

export async function healthCheck(page: Page) {
  await programmaticLogin(page);

  if (process.env.CREATE_SCREENSHOT === 'true') {
    await page.screenshot({ path: 'test-results/health-check-success.png' });
  }
  if (process.env.DUMP_HTML === 'true') {
    const html = await page.content();
    fs.writeFileSync('test-results/health-check-dom.html', html, 'utf-8');
  }
}
