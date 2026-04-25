import { test, expect } from './fixtures';
import { navigateToRoute, attachLiveTranscript, waitForModelReady } from './helpers';
import { registerMockInE2E, enableTestRegistry } from '../helpers/testRegistry.helpers';
import type { E2EWindow } from './helpers/setupE2EManifest';

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

  test.afterEach(async ({ page }) => {
    await page.evaluate(() => {
      document.body.removeAttribute('data-stt-policy');
      window.__TEST_REGISTRY__?.clear();
      // @ts-ignore
      window.__TRANSCRIPTION_SERVICE__?.resetEphemeralState();
    });
  });

  // SCENARIO 1: Private STT / Whisper (First-time Download -> Cache -> Success)
  test('Engine Lifecycle: Verify Download Flow and Cache Persistence', async ({ proPage: page }) => {
    await page.evaluate(() => { (window as unknown as E2EWindow).__MODEL_CACHED__ = false; });
    page.on('console', msg => {
      if (msg.text().includes('[DIAGNOSTIC]')) {
        console.log(`[BROWSER-LOG] ${msg.text()}`);
      }
    });
    attachLiveTranscript(page);

    // 1. Register a mock for 'whisper-turbo' that signals CACHE_MISS
    await registerMockInE2E(page, 'whisper-turbo', `(opts) => {
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
    }`);

    await navigateToRoute(page, '/session');
    
    // Switch to Private Mode
    await page.getByTestId('stt-mode-select').click();
    await page.getByRole('menuitemradio', { name: /Private/i }).click();

    // Trigger Download (Hardened poll)
    await page.getByTestId('session-start-stop-button').click();
    const downloadBtn = page.getByTestId('download-model-button');
    await expect(downloadBtn).toBeVisible({ timeout: 20000 });
    await downloadBtn.click();

    // 🛡️ FORENSIC GATE: Assert visibility while frozen in 'Downloading' state
    const indicator = page.getByTestId('background-task-indicator').first();
    await expect(indicator).toBeVisible({ timeout: 20000 });

    // 🛡️ UNFREEZE: Trigger completion from the test context
    await page.evaluate(() => {
      if ((window as unknown as E2EWindow).__E2E_FINISH_DOWNLOAD__) {
        (window as unknown as E2EWindow).__E2E_FINISH_DOWNLOAD__?.();
      }
    });

    await expect(indicator).toBeHidden({ timeout: 10000 });

    await expect(indicator).not.toBeVisible({ timeout: 10000 });
    await waitForModelReady(page);
    
    // Verify Instant Start after cache
    await page.getByTestId('session-start-stop-button').click();
    await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true', { timeout: 10000 });
    await page.getByTestId('session-start-stop-button').click();
  });

  // SCENARIO 2: Fallback Negotiation (Whisper Failure -> transformers.js Success)
  test('Resilience Matrix: Verify Graceful Fallback when Primary Engine fails', async ({ proPage: page }) => {
    await enableTestRegistry();
    
    // Register FAILING whisper and SUCCESSFUL transformers.js
    await page.evaluate(() => {
      const win = window as unknown as { __SS_E2E__?: { isActive: boolean, registry: Record<string, unknown> }, __APP_READY_STATE__?: Record<string, boolean> };
      win.__SS_E2E__ = win.__SS_E2E__ || { isActive: true, registry: {} };
      
      const whisperRegistry = win.__SS_E2E__.registry;
      if (whisperRegistry) {
        whisperRegistry['whisper-turbo'] = (opts?: { onReady?: () => void }) => ({
          init: async () => {
             if (opts?.onReady) opts.onReady();
             throw new Error('GPU_FAIL');
          },
          checkAvailability: async () => ({ isAvailable: true, requiresDownload: false }),
          getEngineType: () => 'whisper-turbo'
        });

        whisperRegistry['transformers-js'] = (opts?: { onReady?: () => void }) => ({
          init: async () => {
             if (opts?.onReady) opts.onReady();
             if (win.__APP_READY_STATE__) win.__APP_READY_STATE__['model-ready'] = true;
          },
          checkAvailability: async () => ({ isAvailable: true, requiresDownload: false }),
          start: async () => {},
          stop: async () => "fallback-text",
          getTranscript: async () => "fallback-text",
          getEngineType: () => 'transformers-js'
        });
      }
    });

    await navigateToRoute(page, '/session');
    await page.getByTestId('stt-mode-select').click();
    await page.getByRole('menuitemradio', { name: /Private/i }).click();

    await page.getByTestId('session-start-stop-button').click();
    
    // Should start recording via Fallback Engine
    await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true', { timeout: 15000 });
    // Normalize to handle both Primary (Private Ready) and Fallback (Recording active) labels
    await expect(page.getByTestId('stt-status-label')).toContainText(/Recording active|Private Ready/i);
  });

  // SCENARIO 3: Access Control (Free users restricted from Private)
  test('Tier Control: Verify Private engine is gated for Free users', async ({ freePage: page }) => {
    await navigateToRoute(page, '/session');
    await page.getByTestId('stt-mode-select').click();
    const privateOption = page.getByRole('menuitemradio', { name: /Private/i });
    await expect(privateOption).toBeVisible();
    await expect(privateOption).toHaveAttribute('aria-disabled', 'true');
  });

});
