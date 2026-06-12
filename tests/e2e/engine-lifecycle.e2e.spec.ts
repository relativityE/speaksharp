import { test, expect } from './fixtures';
import { navigateToRoute, waitForModelReady, programmaticLoginWithRoutes, selectTranscriptionEngine } from './helpers';
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

  // SCENARIO 3: Access Control. The 60-minute Pro trial is retired; Private access for
  // free users now flows from the Private sample entitlement (one ≤5-min session) reported
  // by the usage-limit RPC. An available sample unlocks Private; Cloud stays Pro-only.
  test('Tier Control: free user with an available Private sample can use Private but not Cloud', async ({ page }) => {
    // Sample-entitlement contract: an available sample (seconds remaining) unlocks Private.
    // The sample fields are set on mockProfile so the FIRST usage-limit hydration already
    // reflects the sample — the default check-usage-limit mock reads them from the page
    // profile, avoiding a late override the app would only see after caching the generic
    // Free response.
    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      mockProfile: {
        subscription_status: 'free',
        stripe_subscription_id: null,
        subscription_id: null,
        preferred_mode: 'native',
        private_sample_available: true,
        private_sample_limit_seconds: 300,
        private_sample_seconds_used: 0,
        private_sample_seconds_remaining: 300,
      },
    });

    await navigateToRoute(page, '/session');
    const usageLimitProbe = await page.evaluate(() => {
      const win = window as unknown as {
        queryClient?: {
          getQueryCache?: () => {
            getAll?: () => Array<{
              queryKey?: unknown;
              state?: { data?: unknown; status?: string };
            }>;
          };
        };
        __E2E_DEPS__?: { fetchUsageLimit?: unknown };
        supabase?: { functions?: { invoke?: unknown } };
      };
      const usageQueries = win.queryClient?.getQueryCache?.().getAll?.()
        .filter(query => JSON.stringify(query.queryKey).includes('usageLimit'))
        .map(query => ({
          queryKey: query.queryKey,
          status: query.state?.status,
          data: query.state?.data,
        })) ?? [];

      return {
        source: typeof win.__E2E_DEPS__?.fetchUsageLimit === 'function'
          ? 'window.__E2E_DEPS__.fetchUsageLimit'
          : win.supabase?.functions?.invoke
            ? 'window.supabase.functions.invoke'
            : 'network/default',
        hasWindowSupabase: !!win.supabase,
        hasE2EFetchUsageLimit: typeof win.__E2E_DEPS__?.fetchUsageLimit === 'function',
        usageQueries,
      };
    });
    expect(usageLimitProbe.source).toBe('window.supabase.functions.invoke');
    expect(usageLimitProbe.usageQueries).toHaveLength(1);
    expect(usageLimitProbe.usageQueries[0]?.status).toBe('success');
    expect(usageLimitProbe.usageQueries[0]?.data).toMatchObject({
      subscription_status: 'free',
      is_pro: false,
      private_sample_available: true,
      private_sample_limit_seconds: 300,
      private_sample_seconds_remaining: 300,
      private_sample_session_id: null,
      private_sample_completed_at: null,
    });
    await openModeMenu(page);

    await expectModeEnabled(page, /Private/i);
    await expectModeDisabled(page, /Cloud/i);
  });

  test('Tier Control: free user with no available Private sample cannot use Private or Cloud', async ({ page }) => {
    // Sample already consumed/unavailable: Private locks back to Pro-only, same as Cloud.
    // Set on mockProfile so the first usage-limit hydration reflects the consumed sample.
    await programmaticLoginWithRoutes(page, {
      userType: 'free',
      mockProfile: {
        subscription_status: 'free',
        stripe_subscription_id: null,
        subscription_id: null,
        preferred_mode: 'native',
        private_sample_available: false,
        private_sample_limit_seconds: 300,
        private_sample_seconds_used: 300,
        private_sample_seconds_remaining: 0,
      },
    });

    await navigateToRoute(page, '/session');
    await openModeMenu(page);

    await expectModeDisabled(page, /Private/i);
    await expectModeDisabled(page, /Cloud/i);
  });

});
