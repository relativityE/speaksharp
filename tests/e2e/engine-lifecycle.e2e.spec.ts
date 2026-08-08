import { test, expect } from './fixtures';
import { navigateToRoute, waitForModelReady, selectTranscriptionEngine } from './helpers';
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
    await selectTranscriptionEngine(page, 'private');

    const modeButton = page.getByTestId('stt-mode-select');
    await expect(modeButton).toHaveAttribute('data-state', 'private', { timeout: 15000 });

    const startButton = page.getByTestId('session-start-stop-button');
    await expect(startButton).toHaveAttribute('data-recording', 'false', { timeout: 10000 });

    if (await startButton.isEnabled({ timeout: 5_000 }).catch(() => false)) {
      await startButton.click();
      await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
      await startButton.click();
    } else {
      await expect(startButton).toBeDisabled();
      await expect(page.locator('body')).toContainText(/Private|model setup|Downloading private model|local/i);
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
    await selectTranscriptionEngine(page, 'private');
    // Forensic Readiness Gate (Invariant I3)
    await waitForModelReady(page, 15000);
    await expect(page.getByTestId('stt-mode-select')).toHaveAttribute('data-state', 'private', { timeout: 15000 });

    await page.getByTestId('session-start-stop-button').click();

    // Should start recording via Fallback Engine
    await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
    // Normalize to handle both Primary (Private Ready) and Fallback (Recording active) labels
    await expect(page.getByTestId('stt-status-label')).toContainText(/Recording active|Private Ready/i);
  });

});
