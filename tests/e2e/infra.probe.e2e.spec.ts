import { test, expect, type Page } from '@playwright/test';
import { goToApp, programmaticLoginWithRoutes, startRecording, selectTranscriptionEngine } from './helpers';
import type { E2EWindow } from './helpers/setupE2EManifest';

// Local mock runtime smoke. These cases verify the initial app, recording, transcript
// rendering and Private selection, not speech recognition accuracy or model loading.
async function openPrivateSession(page: Page) {
  await programmaticLoginWithRoutes(page, { userType: 'free' });
  await goToApp(page, '/session');
  await selectTranscriptionEngine(page, 'private');
}

test('app boots without uncaught runtime errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPrivateSession(page);
  await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'READY');
  expect(errors, 'uncaught errors before the Private recorder became ready').toEqual([]);
});

test.describe('Core System Validation (Deterministic)', () => {
  test.beforeEach(async ({ page }) => {
    await openPrivateSession(page);
  });

  // 6. FSM Transition (Async Correctness)
  test('FSM transitions correctly', async ({ page }) => {
    await startRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 5000 });
  });

  // 7. Transcription Smoke
  test('mock transcription flows through system', async ({ page }) => {
    await startRecording(page);

    await page.evaluate(async () => {
      const e2eWindow = window as unknown as E2EWindow;
      const bridge = e2eWindow.__SS_E2E__;
      bridge.emitTranscript('Hello', false);
      await new Promise(r => setTimeout(r, 500));
      bridge.emitTranscript('Hello from E2E', true);
    });

    await expect(page.getByTestId('live-transcript'))
      .toContainText(/Hello from E2E/, { timeout: 15000 });
  });

  // 11. Forensic Audit (Identity Guard Verification)
  test('Forensic Audit: negotiator identity guard is active', async ({ page }) => {
    await page.waitForSelector('html[data-runtime-state="READY"]', { timeout: 15000 });

    // DOM-anchored deterministic assertion — no log scraping. #1184: Private is the only engine, so the
    // negotiator resolves Private end-to-end (in E2E the private engine is a mock stub, but it resolves as
    // Private, not the retired native stub).
    await expect(page.locator('html')).toHaveAttribute('data-stt-mode', 'private');
    await expect(page.locator('html')).toHaveAttribute('data-stt-resolved-mode', 'private');
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'READY');
    await expect.poll(async () => page.evaluate(() => {
      const win = window as unknown as E2EWindow;
      return Boolean(win.__SS_E2E__?.isActive && win.__SS_E2E_BRIDGE__?.emitTranscript);
    })).toBe(true);
  });
});
