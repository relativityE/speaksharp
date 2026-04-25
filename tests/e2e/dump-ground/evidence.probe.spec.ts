import { test, expect } from '@playwright/test';
import { setupE2EManifest, navigateToRoute, getProbe, programmaticLoginWithRoutes } from '../helpers';
import { registerMockInE2E } from '../../helpers/testRegistry.helpers';
import type { E2EWindow } from '../helpers/setupE2EManifest';

/**
 * CONSOLIDATED FORENSIC PROBE (v0.6.20)
 * 
 * This file serves as the historical record and active validation suite for 
 * the 5 major crash clusters (Hydras) identified during the stabilization phase.
 * 
 * Usage:
 * - Run all: pnpm test:e2e tests/e2e/dump-ground/evidence.probe.spec.ts
 * - Run specific: pnpm test:e2e tests/e2e/dump-ground/evidence.probe.spec.ts -g "Cluster 5"
 */

test.describe('Engine Lifecycle Forensic Probes', () => {

  /**
   * CLUSTER 1: Auth / Readiness Signal Race
   * Proves: subscriber_mount fires before the store is fully hydrated.
   */
  test.describe('Cluster 1: Auth / Readiness Signal Race', () => {
    test('C1: subscriber_mount hydration alignment', async ({ page }) => {
      await programmaticLoginWithRoutes(page, { userType: 'free' });
      await navigateToRoute(page, '/session');
      
      const logs = await getProbe(page);
      const subs = logs.filter(l => l.event === "SUBSCRIBE");
      
      console.log("[EVIDENCE-C1]", { subs: subs.length });
      expect(subs.length).toBeGreaterThanOrEqual(1); 
    });
  });

  /**
   * CLUSTER 2: Engine State Invisibility (Store Deadlock)
   * Proves: State transitions blocked by store guards.
   */
  test.describe('Cluster 2: Engine State Invisibility', () => {
    test('C2: State transitions must not be blocked', async ({ page }) => {
      await programmaticLoginWithRoutes(page, { userType: 'free' });
      await navigateToRoute(page, '/session');

      const recordButton = page.getByTestId('session-start-stop-button');
      await recordButton.click();
      await page.waitForTimeout(2000);

      const logs = await getProbe(page);
      const blocked = logs.filter(l => l.event === "STATE_BLOCKED");

      console.log("[EVIDENCE-C2]", { blocked: blocked.length });
      expect(blocked.length).toBe(0); // Should be 0 after stabilization fix
    });
  });

  /**
   * CLUSTER 3: Auth / Hydration Failure
   * Proves: Usage limit check gaps during hydration.
   */
  test.describe('Cluster 3: Auth / Hydration Failure', () => {
    test('C3: Usage limit check must succeed', async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as Record<string, unknown>).__E2E_DEPS__ = {
          fetchUsageLimit: async () => ({
            can_start: true, daily_remaining: 3600, daily_limit: 3600,
            monthly_remaining: 90000, monthly_limit: 90000,
            remaining_seconds: 3600, subscription_status: 'pro',
            is_pro: true, streak_count: 5
          })
        };
      });

      await programmaticLoginWithRoutes(page, { userType: 'pro' });
      await navigateToRoute(page, '/session');
      await page.waitForTimeout(2000);

      const logs = await getProbe(page);
      const errors = logs.filter((l: Record<string, unknown>) => l.event === "USAGE_LIMIT_ERROR");

      console.log("[EVIDENCE-C3]", { errors: errors.length });
      expect(errors.length).toBe(0); // Fixed: No usage errors during hydration
    });
  });

  /**
   * CLUSTER 4: Termination Deadlock (Lock Release)
   * Proves: destroy() fails to release locks during state transitions.
   */
  test.describe('Cluster 4: Termination Deadlock', () => {
    test.beforeEach(async ({ page }) => {
      await programmaticLoginWithRoutes(page, { userType: 'free' });
      await navigateToRoute(page, '/session');
      await page.waitForFunction(() => typeof window.__SS_E2E__ !== 'undefined');
    });

    test('C4: Idempotent destroy() sequence', async ({ page }) => {
      await page.getByTestId('session-start-stop-button').click();
      await page.waitForSelector('html[data-recording-state="recording"]', { timeout: 15000 });

      const destroyResult = await page.evaluate(async () => {
        const bridge = (window as unknown as E2EWindow).__SS_E2E__;
        try {
          await bridge.destroyService();
          return { threw: false, finalState: bridge.getFSMState?.() };
        } catch (e) {
          return { threw: true, error: (e as Error).message };
        }
      });

      expect(destroyResult.threw).toBe(false);
      expect(['TERMINATED', 'IDLE']).toContain(destroyResult.finalState);
    });
  });

  /**
   * CLUSTER 5: getStrategy() null crash during subscriber_unmount
   *
   * Hypothesis: After subscriber_unmount, a pending enqueue task runs
   * ensureReady() which calls getStrategy() on a service whose strategy
   * was not yet assigned.
   *
   * Fix: Temporal versioning invalidates the task before it hits the null ref.
   */
  test.describe('Cluster 5: Unmount Race Condition', () => {
    test('C5: capture getStrategy crash source after subscriber_unmount', async ({ page }) => {
      const crashLog: string[] = [];
      const traceLog: string[] = [];

      page.on('console', msg => {
        const text = msg.text();
        if (msg.type() === 'error' || text.includes('getStrategy') || text.includes('null') || text.includes('[TRACE]') || text.includes('RESET')) {
          const entry = `[${msg.type().toUpperCase()}] ${text}`;
          traceLog.push(entry);
        }
      });

      page.on('pageerror', err => {
        crashLog.push(err.message + '\n' + err.stack);
      });

      await setupE2EManifest(page, { engineType: 'real', debug: false });

      await registerMockInE2E(page, 'whisper-turbo', `(opts) => {
        let statusCb = opts?.onStatusChange;
        return {
          init: async () => {
            if (!window.__MODEL_CACHED__) {
              if (statusCb) statusCb({ type: 'downloading', progress: 0.1 });
              await new Promise(resolve => { window.__E2E_FINISH_DOWNLOAD__ = resolve; });
              if (statusCb) statusCb({ type: 'downloading', progress: 1.0 });
              window.__MODEL_CACHED__ = true;
            }
            if (opts?.onReady) opts.onReady();
          },
          checkAvailability: async () => ({
            isAvailable: !!window.__MODEL_CACHED__,
            reason: !window.__MODEL_CACHED__ ? 'CACHE_MISS' : undefined,
            requiresDownload: !window.__MODEL_CACHED__,
          }),
          start: async () => {}, stop: async () => {}, pause: async () => {},
          resume: async () => {}, destroy: async () => {}, terminate: async () => {},
          getTranscript: async () => 'ok', getLastHeartbeatTimestamp: () => Date.now(),
          getEngineType: () => 'whisper-turbo'
        };
      }`);

      await page.evaluate(() => { (window as unknown as E2EWindow).__MODEL_CACHED__ = false; });
      await navigateToRoute(page, '/session');

      // Switch to Private Mode
      await page.getByTestId('stt-mode-select').click();
      await page.getByRole('menuitemradio', { name: /Private/i }).click();

      // Trigger start + download
      await page.getByTestId('session-start-stop-button').click();
      const downloadBtn = page.getByTestId('download-model-button');
      await expect(downloadBtn).toBeVisible({ timeout: 20000 });
      await downloadBtn.click();

      // Unfreeze
      await page.evaluate(() => {
        if ((window as unknown as E2EWindow).__E2E_FINISH_DOWNLOAD__) {
          (window as unknown as E2EWindow).__E2E_FINISH_DOWNLOAD__?.();
        }
      });

      await page.waitForTimeout(2000);
      expect(crashLog, 'No unhandled crashes should fire').toHaveLength(0);
    });
  });

});
