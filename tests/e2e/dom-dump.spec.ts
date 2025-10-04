import { test, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const DUMP_DIR = 'test-results/debug';

// Helper to ensure the debug directory exists
const ensureDumpDir = () => {
  if (!fs.existsSync(DUMP_DIR)) {
    fs.mkdirSync(DUMP_DIR, { recursive: true });
  }
};

// Helper to dump DOM content
const dumpDom = async (page: Page, url: string, filename: string) => {
  await page.goto(url);
  // Using a short, fixed wait is more reliable than 'networkidle' for dev servers.
  await page.waitForTimeout(2000);
  const html = await page.content();
  const dumpFile = path.join(DUMP_DIR, filename);
  fs.writeFileSync(dumpFile, html);
  console.log(`DOM for ${url} dumped to ${dumpFile}`);
};

test.describe('DEBUG: DOM Dump', () => {
  test.beforeAll(ensureDumpDir);

  test('Dumps the DOM of the Home page', async ({ page }) => {
    await dumpDom(page, '/', 'homepage-dom.html');
  });

  test('Dumps the DOM of the Session page', async ({ page }) => {
    await dumpDom(page, '/session', 'session-page-dom.html');
  });

  test('Dumps the DOM of the Analytics page', async ({ page }) => {
    await dumpDom(page, '/analytics', 'analytics-page-dom.html');
  });

  test('Dumps the DOM of the Auth page', async ({ page }) => {
    await dumpDom(page, '/auth', 'auth-page-dom.html');
  });
});