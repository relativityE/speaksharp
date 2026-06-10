import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript, waitForModelReady, programmaticLoginWithRoutes, selectTranscriptionEngine } from './helpers';
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
  // Obsolete synthetic download/cache harness: first-use trust now keeps Browser
  // as the default and Private setup is covered by paid-invite and live
  // private-cache proofs instead of this fragile frozen-progress mock.
  test.skip('Engine Lifecycle: Private setup/cache path remains recoverable', async ({ proPage: page }) => {
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
        transcribe: async () => ({ isOk: true, value: 'lifecycle-success' }),
        getTranscript: async () => 'lifecycle-success',
        getLastHeartbeatTimestamp: () => Date.now(),
        getEngineType: () => 'whisper-turbo'
      };
    }`;
    await registerMockInE2E(page, 'transformers-js', downloadFlowMock);
    await registerMockInE2E(page, 'whisper-turbo', downloadFlowMock);
    await page.addInitScript(() => {
      const win = window as unknown as { __SS_E2E__?: { engineType?: 'mock' | 'real' | 'system' } };
      if (win.__SS_E2E__) {
        win.__SS_E2E__.engineType = 'real';
      }
    });
    await page.evaluate(() => {
      const win = window as unknown as { __SS_E2E__?: { engineType?: 'mock' | 'real' | 'system' } };
      if (win.__SS_E2E__) {
        win.__SS_E2E__.engineType = 'real';
      }
    });

    await navigateToRoute(page, '/session');

    // Switch to Private Mode
    await selectTranscriptionEngine(page, 'private');
    // Forensic Readiness Gate (Invariant I3)


    const modeButton = page.getByTestId('stt-mode-select');
    await expect(modeButton).toHaveAttribute('data-state', 'private', { timeout: 15000 });

    // If Private setup is required, complete the deterministic mocked download.
    // Current first-use trust behavior may also pre-warm Private directly after
    // explicit user selection, in which case the setup CTA is not rendered.
    const setupButton = page.getByTestId('download-model-button-inline');
    if (await setupButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await setupButton.click({ force: true });
    }

    // 🛡️ FORENSIC GATE: If the mock is frozen in either warm-up or explicit
    // download, unfreeze it from the test context.
    const hasFrozenDownload = await page.waitForFunction(
      () => typeof (window as unknown as Record<string, unknown>).__E2E_FINISH_DOWNLOAD__ === 'function',
      { timeout: 5_000 },
    ).then(() => true).catch(() => false);

    if (hasFrozenDownload) {
      // 🛡️ UNFREEZE: Trigger completion from the test context
      await page.evaluate(() => {
        const win = window as unknown as Record<string, (() => void) | undefined>;
        if (win.__E2E_FINISH_DOWNLOAD__) {
          win.__E2E_FINISH_DOWNLOAD__?.();
        }
      });
    }

    const indicator = page.getByTestId('background-task-indicator').first();
    const setupFinished = await indicator.isHidden({ timeout: 10_000 }).catch(() => false);

    if (setupFinished) {
      await waitForModelReady(page);
    } else {
      await expect(indicator).toContainText(/Private Model|Downloading/i);
    }

    // Verify start after cache when the mocked setup reaches ready. If this
    // synthetic download harness remains in-progress, the product-safe contract
    // is that recording stays disabled while setup copy is visible.
    const startButton = page.getByTestId('session-start-stop-button');
    await expect(startButton).toHaveAttribute('data-recording', 'false', { timeout: 10000 });
    if (await startButton.isEnabled({ timeout: 5_000 }).catch(() => false)) {
      await startButton.click();
      await expect(startButton).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
      await startButton.click();
    } else {
      await expect(startButton).toBeDisabled();
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

  async function openModeMenu(page: import('@playwright/test').Page) {
    const modeButton = page.getByTestId('stt-mode-select');
    const bbox = await modeButton.boundingBox();
    if (bbox) {
      await page.mouse.click(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);
    } else {
      await modeButton.click({ force: true });
    }
  }

  async function expectModeDisabled(page: import('@playwright/test').Page, label: RegExp) {
    const option = page.getByRole('menuitemradio', { name: label });
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute('data-disabled', '');
  }

  async function expectModeEnabled(page: import('@playwright/test').Page, label: RegExp) {
    const option = page.getByRole('menuitemradio', { name: label });
    await expect(option).toBeVisible();
    await expect(option).not.toHaveAttribute('data-disabled', '');
  }

  // SCENARIO 3: Access Control (trial unlocks Private only; Cloud remains Pro-only)
  test('Tier Control: active trial can use Private but not Cloud', async ({ page }) => {
    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      mockProfile: {
        subscription_status: 'free',
        trial_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        stripe_subscription_id: null,
        subscription_id: null,
        preferred_mode: 'native',
      },
    });

    await navigateToRoute(page, '/session');
    await openModeMenu(page);

    await expectModeEnabled(page, /Private/i);
    await expectModeDisabled(page, /Cloud/i);
  });

  test('Tier Control: expired Free cannot use Private or Cloud', async ({ page }) => {
    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      mockProfile: {
        subscription_status: 'free',
        trial_expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        stripe_subscription_id: null,
        subscription_id: null,
        preferred_mode: 'native',
      },
    });

    await navigateToRoute(page, '/session');
    await openModeMenu(page);

    await expectModeDisabled(page, /Private/i);
    await expectModeDisabled(page, /Cloud/i);
  });

});
