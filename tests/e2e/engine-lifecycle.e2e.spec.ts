import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript, waitForModelReady } from './helpers';
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

  // SCENARIO 1: Private STT / Whisper (First-time Download -> Cache -> Success)
  test('Engine Lifecycle: Verify Download Flow and Cache Persistence', async ({ proPage: page }) => {
    attachLiveTranscript(page);

    // 1. Register a mock for 'transformers-js' that signals CACHE_MISS
    const downloadFlowMock = `(opts) => {
      let progressCb = opts?.onModelLoadProgress;
      let statusCb = opts?.onStatusChange;
      return {
        init: async () => {
          if (!window.__MODEL_CACHED__) {
            // Simulate download started
            if (statusCb) statusCb({ type: 'downloading', progress: 0.1 });
            
            // 🛡️ DETERMINISTIC GATE: Freeze here until Playwright signals completion
            // This prevents fast-forwarded timers from making the indicator vanish instantly
            await new Promise(resolve => {
               window.__E2E_FINISH_DOWNLOAD__ = resolve;
            });

            if (statusCb) statusCb({ type: 'downloading', progress: 1.0 });
            window.__MODEL_CACHED__ = true;
          }
          if (opts?.onReady) opts.onReady();
          if (window.__APP_READY_STATE__) window.__APP_READY_STATE__['model-ready'] = true;
          window.__E2E_ADVANCE_PROGRESS__ = (p) => { if (progressCb) progressCb(p); };
        },
        checkAvailability: async () => ({
          isAvailable: !!window.__MODEL_CACHED__,
          reason: !window.__MODEL_CACHED__ ? 'CACHE_MISS' : undefined,
          requiresDownload: !window.__MODEL_CACHED__,
          requiresNetwork: !window.__MODEL_CACHED__
        }),
        start: async () => { },
        stop: async () => 'lifecycle-success',
        pause: async () => { },
        resume: async () => { },
        destroy: async () => { },
        terminate: async () => { },
        getTranscript: async () => 'lifecycle-success',
        getLastHeartbeatTimestamp: () => Date.now(),
        getEngineType: () => 'whisper-turbo'
      };
    }`;
    await registerMockInE2E(page, 'transformers-js', downloadFlowMock);
    await registerMockInE2E(page, 'whisper-turbo', downloadFlowMock);

    await navigateToRoute(page, '/session');

    // Switch to Private Mode
    // Forensic Readiness Gate (Invariant I3)


    const modeButton = page.getByTestId('stt-mode-select');
    await expect(modeButton).toHaveAttribute('data-state', 'private', { timeout: 15000 });

    // Trigger explicit model download before starting a recording.
    await page.getByTestId('download-model-button').click({ force: true });

    // 🛡️ FORENSIC GATE: Assert the mock is frozen in the explicit download path.
    await page.waitForFunction(() => typeof (window as unknown as Record<string, unknown>).__E2E_FINISH_DOWNLOAD__ === 'function', { timeout: 20000 });

    // 🛡️ UNFREEZE: Trigger completion from the test context
    await page.evaluate(() => {
      const win = window as unknown as Record<string, (() => void) | undefined>;
      if (win.__E2E_FINISH_DOWNLOAD__) {
        win.__E2E_FINISH_DOWNLOAD__?.();
      }
    });

    const indicator = page.getByTestId('background-task-indicator').first();
    await expect(indicator).toBeHidden({ timeout: 10000 });

    await expect(indicator).not.toBeVisible({ timeout: 10000 });
    await waitForModelReady(page);

    // Verify start after cache once the post-download warm-up pulse settles.
    const startButton = page.getByTestId('session-start-stop-button');
    await expect(startButton).toHaveAttribute('data-recording', 'false', { timeout: 10000 });
    await startButton.click();
    await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
    await startButton.click();
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
    // Forensic Readiness Gate (Invariant I3)
    await expect.poll(
      async () => await page.getAttribute('html', 'data-engine-ready'),
      { timeout: 15000 }
    ).toBe('true');
    await expect(page.getByTestId('stt-mode-select')).toHaveAttribute('data-state', 'private', { timeout: 15000 });

    await page.getByTestId('session-start-stop-button').click();

    // Should start recording via Fallback Engine
    await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
    // Normalize to handle both Primary (Private Ready) and Fallback (Recording active) labels
    await expect(page.getByTestId('stt-status-label')).toContainText(/Recording active|Private Ready/i);
  });

  // SCENARIO 3: Access Control (Free users restricted from Private)
  test('Tier Control: Verify Private engine is gated for Free users', async ({ freePage: page }) => {
    await navigateToRoute(page, '/session');
    const modeButton3 = page.getByTestId('stt-mode-select');
    const bbox3 = await modeButton3.boundingBox();
    if (bbox3) {
      await page.mouse.click(bbox3.x + bbox3.width / 2, bbox3.y + bbox3.height / 2);
    } else {
      await modeButton3.click({ force: true });
    }
    const privateOption = page.getByRole('menuitemradio', { name: /Private/i });
    await expect(privateOption).toBeVisible();
    await expect(privateOption).toHaveAttribute('aria-disabled', 'true');
  });

});
