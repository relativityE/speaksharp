import { test, expect } from '@playwright/test';
import { setupE2EManifest, navigateToRoute, getProbe, programmaticLoginWithRoutes } from '../helpers';
import { registerMockInE2E } from '../../helpers/testRegistry.helpers';
import type { E2EWindow } from '../helpers/setupE2EManifest';

declare global {
  interface Window {
    __PROBE_ZOMBIE_FIRED__?: boolean;
    __MODEL_CACHED__?: boolean;
    __E2E_FINISH_DOWNLOAD__?: (value?: unknown) => void;
  }
}

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
      await page.getByTestId('session-start-stop-button').click({ force: true });
      await page.waitForSelector('html[data-runtime-state="RECORDING"]', { timeout: 15000 });

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

      await setupE2EManifest(page, { 
        engineType: 'real', 
        debug: false,
        userType: 'pro'
      });

      const delayedDownloadMock = `(opts) => {
        let statusCb = opts?.onStatusChange;
        let isDestroyed = false;
        return {
          init: async () => {
            if (!window.__MODEL_CACHED__) {
              if (statusCb) statusCb({ type: 'downloading', progress: 0.1 });
              const win = window;
              const delay = win.__SS_E2E__?.mockEngineInitDelayMs ?? 0;
              if (delay > 0) await new Promise(r => setTimeout(r, delay));

              await new Promise(resolve => { window.__E2E_FINISH_DOWNLOAD__ = resolve; });
              if (statusCb) statusCb({ type: 'downloading', progress: 1.0 });
              window.__MODEL_CACHED__ = true;
            }
            if (opts?.onReady) {
              if (isDestroyed) window.__PROBE_ZOMBIE_FIRED__ = true;
              opts.onReady();
            }
          },
          checkAvailability: async () => ({
            isAvailable: !!window.__MODEL_CACHED__,
            reason: !window.__MODEL_CACHED__ ? 'CACHE_MISS' : undefined,
            requiresDownload: !window.__MODEL_CACHED__,
          }),
          start: async () => {}, stop: async () => {}, pause: async () => {},
          resume: async () => {}, destroy: async () => { isDestroyed = true; }, terminate: async () => {},
          getTranscript: async () => 'ok', getLastHeartbeatTimestamp: () => Date.now(),
          getEngineType: () => 'whisper-turbo'
        };
      }`;
      await registerMockInE2E(page, 'whisper-turbo', delayedDownloadMock);
      await registerMockInE2E(page, 'transformers-js', delayedDownloadMock);

      await page.evaluate(() => { (window as unknown as E2EWindow).__MODEL_CACHED__ = false; });
      await navigateToRoute(page, '/session');

      // Forensic Readiness Gate (Invariant I3)
      await expect.poll(
        async () => await page.getAttribute('html', 'data-engine-ready'),
        { timeout: 15000 }
      ).toBe('true');

      // Pro sessions default to Private; assert that state directly so the
      // probe remains focused on the download/unmount race.
      await expect(page.getByTestId('stt-mode-select')).toHaveAttribute('data-state', 'private', { timeout: 15000 });

      // Trigger the explicit download path before unmounting.
      await page.getByTestId('download-model-button').click({ force: true });

      // Step 5.2 — Wait for the frozen mock download to be active.
      await page.waitForFunction(() => typeof (window as any).__E2E_FINISH_DOWNLOAD__ === 'function', { timeout: 10000 });
      
      // Step 5.3 — UNMOUNT while downloading
      await page.evaluate(async () => {
        const win = window as any;
        win.zombieCallbackFired = false;
        
        // Wrap the onReady callback to catch zombies
        const originalFinish = win.__E2E_FINISH_DOWNLOAD__;
        win.__E2E_FINISH_DOWNLOAD__ = () => {
          originalFinish?.();
          // If the service is destroyed, this callback should NOT reach the UI/store
        };

        await win.__SS_E2E__?.destroyService?.();
      });

      // Step 5.4 — Trigger the completion of the "frozen" download
      await page.evaluate(() => {
        const win = window as any;
        win.__E2E_FINISH_DOWNLOAD__?.();
      });

      // Step 5.5 — ASSERT: No signal arrived after unmount
      await page.waitForTimeout(1000);
      const zombieCallbackFired = await page.evaluate(() => 
          window.__PROBE_ZOMBIE_FIRED__ ?? false
      );
      expect(zombieCallbackFired).toBe(false);
      expect(crashLog, 'No unhandled crashes should fire').toHaveLength(0);
    });
  });

});
