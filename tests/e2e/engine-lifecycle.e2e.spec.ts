import { test, expect } from './fixtures';
import { navigateToRoute, waitForModelReady, selectTranscriptionEngine, startRecording, stopRecording } from './helpers';
import { registerMockInE2E, enableTestRegistry } from '../helpers/testRegistry.helpers';


/**
 * CONSOLIDATED ENGINE LIFECYCLE SUITE (v1.6)
 * Sharded suite for Whisper, Private STT, and Fallback Negotiation.
 */

test.describe('Engine Lifecycle & Resilience Matrix', () => {

  test.beforeEach(async ({ page }) => {
    // Environment isolation: Intercept and block real model/WASM downloads
    // Intercept and block real model/WASM downloads to ensure 100% determinism.
    await page.route('**/*.{wasm,onnx,bin}', route => route.fulfill({ status: 200, body: '' }));
    await page.route('**/huggingface.co/**', route => route.fulfill({ status: 200, body: '{}' }));
  });

  test.afterEach(async () => {
  });

  // SCENARIO 1: First-use trust changed the maintained contract. Browser is
  // the default; Private is explicit. Once selected, Private must either be
  // startable or safely blocked behind visible setup/download guidance.
  test('Engine Lifecycle: explicit Private selection shows safe setup or ready state', async ({ proPage: page }) => {
    await navigateToRoute(page, '/session');
    // #1184/#1222: Private is the only engine — there is no `stt-mode-select` and no `data-recording`
    // attribute. selectTranscriptionEngine confirms the Private recorder surface is mounted. Start (before)
    // and stop (during) are split into `mic-start` / `recorder-stop`.
    await selectTranscriptionEngine(page, 'private');

    const startButton = page.getByTestId('mic-start');
    const startReady = (await startButton.isVisible().catch(() => false))
      && (await startButton.isEnabled({ timeout: 5_000 }).catch(() => false));

    if (startReady) {
      await startRecording(page);
      await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 15000 });
      await stopRecording(page);
    } else {
      // Private requires a one-time on-device model download → the page shows the download/setup
      // affordance (`mic-download`) instead of an enabled start, with visible setup guidance.
      await expect(
        page.getByTestId('mic-download').or(page.getByTestId('mic-card')),
      ).toBeVisible();
      await expect(page.locator('body')).toContainText(/Private|model setup|Download|local/i);
    }
  });

  // SCENARIO 2: Fallback Negotiation (Whisper Failure -> transformers.js Success)
  test('Resilience Matrix: Verify Graceful Fallback when Primary Engine fails', async ({ proPage: page }) => {
    await enableTestRegistry();

    // Register FAILING whisper and SUCCESSFUL transformers.js
    await registerMockInE2E(page, 'whisper-turbo', `(opts) => {
      let statusCb = opts?.onStatusChange;
      return {
        init: async () => {
          // Simulate immediate failure to trigger fallback
          if (statusCb) statusCb({ type: 'error', error: 'WHISPER_CRASH' });
          throw new Error('WHISPER_CRASH');
        },
        checkAvailability: async () => ({ isAvailable: false, reason: 'CRASHED' }),
        start: async () => {}, stop: async () => {}, getEngineType: () => 'whisper-turbo'
      };
    }`);

    await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      if (win.__TEST_REGISTRY__) {
        const whisperRegistry = win.__TEST_REGISTRY__;
        whisperRegistry['transformers-js'] = (opts?: { onReady?: () => void }) => ({
          init: async () => {
            if (opts?.onReady) opts.onReady();
            if (win.__APP_READY_STATE__) win.__APP_READY_STATE__['model-ready'] = true;
          },
          checkAvailability: async () => ({ isAvailable: true, requiresDownload: false }),
          start: async () => { },
          stop: async () => "fallback-text",
          getTranscript: async () => "fallback-text",
          getEngineType: () => 'transformers-js'
        });
      }
    });

    await navigateToRoute(page, '/session');
    // #1184/#1222: Private is the only engine (no `stt-mode-select`); confirm the recorder surface is mounted.
    await selectTranscriptionEngine(page, 'private');
    // Forensic Readiness Gate (Invariant I3)
    await waitForModelReady(page, 15000);

    // Should start recording via the Fallback Engine. The new page has no `data-recording` attribute nor
    // an `stt-status-label` pill (that pill lived on the retired legacy recorder card) — the RECORDING
    // runtime signal and the shell's `during` state are the recording truth that the fallback succeeded.
    await startRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 15000 });
    await expect(page.getByTestId('session-shell')).toHaveAttribute('data-session-state', 'during');
  });

});
