import { test, expect, Request, Response } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('Bootstrap Diagnostic + Network + Unhandled Promise Rejections', async ({ page }) => {
  const diagDir = path.resolve('diagnostics');
  const diagFile = path.join(diagDir, 'bootstrap-network-report.txt');
  if (!fs.existsSync(diagDir)) fs.mkdirSync(diagDir, { recursive: true });

  const logLines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logLines.push(msg);
  };

  const logDivider = (label: string) => log(`\n===== ${label} =====`);

  logDivider('[E2E DIAGNOSTIC] Test Start');
  log(`Timestamp: ${new Date().toISOString()}`);

  // --- Capture browser console output ---
  page.on('console', msg => log(`[BROWSER:${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => log(`[BROWSER:ERROR] ${err.message}`));
  page.on('crash', () => log('[BROWSER:CRASH] Renderer crashed.'));

  // --- Capture unhandled Promise rejections ---
  await page.addInitScript(() => {
    window.__E2E_UNHANDLED_REJECTIONS__ = [];
    window.addEventListener('unhandledrejection', (event) => {
      window.__E2E_UNHANDLED_REJECTIONS__.push({
        reason: event.reason?.toString(),
        promise: event.promise?.toString?.() ?? 'unknown'
      });
    });
  });

  // --- Capture network requests ---
  const requests: { url: string; method: string; status?: number; failed?: string }[] = [];
  page.on('request', (req: Request) => {
    requests.push({ url: req.url(), method: req.method() });
  });
  page.on('requestfailed', (req) => {
    const entry = requests.find(r => r.url === req.url());
    if (entry) entry.failed = req.failure()?.errorText;
    log(`[NETWORK FAILED] ${req.url()} - ${req.failure()?.errorText}`);
  });
  page.on('response', (res: Response) => {
    const entry = requests.find(r => r.url === res.url());
    if (entry) entry.status = res.status();
    if (res.status() >= 400) {
      log(`[NETWORK ERROR] ${res.status()} ${res.url()}`);
    }
  });

  // --- STEP 1: Navigate ---
  logDivider('NAVIGATION');
  await page.goto('/?e2e=true', { waitUntil: 'domcontentloaded' });
  log('Navigation completed');

  // --- STEP 2: Wait a bit for Vite + React + MSW ---
  await page.waitForTimeout(5000);

  // --- STEP 3: Capture global state ---
  logDivider('GLOBAL STATE SNAPSHOT');
  const globals = await page.evaluate(() => ({
    hasRoot: !!document.getElementById('root'),
    rootInnerHTML: document.getElementById('root')?.innerHTML?.slice(0, 400) ?? '(empty)',
    mswReady: (window as any).mswReady,
    testMode: (window as any).TEST_MODE,
    e2eMode: (window as any).__E2E_MODE__,
    speakSharpRootInitialized: (window as any)._speakSharpRootInitialized,
    url: window.location.href,
    unhandledRejections: (window as any).__E2E_UNHANDLED_REJECTIONS__ ?? []
  }));
  log(JSON.stringify(globals, null, 2));

  // --- STEP 4: Capture network snapshot ---
  logDivider('NETWORK SNAPSHOT');
  requests.forEach(r => {
    log(JSON.stringify(r));
  });

  // --- STEP 5: Capture HTML ---
  logDivider('HTML DUMP');
  const html = await page.content();
  log(html.slice(0, 2000)); // first 2k chars for brevity

  // --- STEP 6: Assertions ---
  logDivider('ASSERTIONS');
  expect(globals.hasRoot).toBeTruthy();
  expect(globals.rootInnerHTML).not.toBe('(empty)');
  expect(globals.url).toContain('e2e=true');
  log('Assertions completed successfully');

  // --- STEP 7: Write log to disk ---
  logDivider('WRITE REPORT');
  fs.writeFileSync(diagFile, logLines.join('\n\n'), 'utf8');
  log(`Diagnostic report written to: ${diagFile}`);

  logDivider('[E2E DIAGNOSTIC] Complete');
});
