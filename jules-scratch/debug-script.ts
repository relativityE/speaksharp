import { chromium } from 'playwright';
import { stubThirdParties } from '../tests/e2e/sdkStubs.js';
import { spawn } from 'child_process';
import path from 'path';

const BASE_URL = 'http://localhost:5173';

async function main() {
  let serverProcess;
  let browser;

  try {
    console.log('[DebugScript] Starting Vite server...');
    serverProcess = spawn('pnpm', ['dev'], { stdio: 'pipe' });

    serverProcess.stdout.on('data', (data) => console.log(`[ViteServer] ${data}`));
    serverProcess.stderr.on('data', (data) => console.error(`[ViteServer_ERROR] ${data}`));

    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for server to start

    console.log('[DebugScript] Launching browser...');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log('[DebugScript] Applying network stubs...');
    await stubThirdParties(page);

    console.log(`[DebugScript] Navigating to ${BASE_URL}/auth...`);
    await page.goto(`${BASE_URL}/auth`, { waitUntil: 'networkidle' });

    console.log('[DebugScript] Navigation successful!');
    console.log(`[DebugScript] Page title: ${await page.title()}`);

  } catch (error) {
    console.error('[DebugScript] An error occurred:', error);
  } finally {
    console.log('[DebugScript] Cleaning up...');
    if (browser) await browser.close();
    if (serverProcess) serverProcess.kill();
    process.exit(0);
  }
}

main();