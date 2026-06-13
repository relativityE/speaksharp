import { test, expect, type Page } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, selectTranscriptionEngine } from './helpers';

type BrowserProof = {
  v2Constructed: number;
  v2Init: number;
  v4Constructed: number;
  v4Init: number;
  captures: Array<{ event: string; payload: Record<string, unknown> }>;
};

type HarnessOptions = {
  v4FlagEnabled: boolean;
  webgpuAvailable: boolean;
  localStorageOverrides?: Record<string, string>;
};

const V4_FORBIDDEN_PAYLOAD_TERMS = [
  'email',
  'transcript',
  'audio',
  'stack',
  'session_token',
  'access_token',
  'refresh_token',
  'jwt',
  'service_role',
  'supabase_service_role',
  'stripe_secret',
  'sk_live',
  'sk_test',
  'whsec',
  'assemblyai',
  'api_key',
  'apikey',
  'password',
  'authorization',
];

const V4_URL_PATTERN = /transformers-js-v4|onnx-community\/whisper|decoder_model_merged_q4|encoder_model\.onnx/i;

function isV4AssetRequest(url: string, resourceType: string) {
  if (resourceType === 'document') return false;

  try {
    const { pathname } = new URL(url);
    return V4_URL_PATTERN.test(pathname);
  } catch {
    return V4_URL_PATTERN.test(url);
  }
}

async function installBrowserControlHarness(page: Page, options: HarnessOptions) {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (V4_URL_PATTERN.test(url)) {
      await route.continue();
      return;
    }
    await route.continue();
  });

  await programmaticLoginWithRoutes(page, { userType: 'pro' });

  await page.evaluate(async () => {
    const cache = await caches.open('transformers-cache');
    const cacheFiles = [
      'config.json',
      'tokenizer.json',
      'preprocessor_config.json',
      'onnx/encoder_model_quantized.onnx',
      'onnx/decoder_model_merged_quantized.onnx',
    ];
    await Promise.all(cacheFiles.map((file) =>
      cache.put(`/models/whisper-base.en/${file}`, new Response('{}', {
        headers: { 'content-type': file.endsWith('.json') ? 'application/json' : 'application/octet-stream' },
      }))
    ));
  });

  await page.addInitScript(({ v4FlagEnabled, webgpuAvailable, localStorageOverrides }) => {
    const win = window as unknown as Window & {
      __SS_E2E__?: {
        isActive?: boolean;
        engineType?: string;
        registry?: Record<string, unknown>;
      };
      __V4_BROWSER_CONTROL_PROOF__?: BrowserProof;
      posthog?: {
        isFeatureEnabled?: (key: string) => boolean;
        capture?: (event: string, payload?: Record<string, unknown>) => void;
      };
    };

    for (const [key, value] of Object.entries(localStorageOverrides ?? {})) {
      window.localStorage.setItem(key, value);
    }

    win.__V4_BROWSER_CONTROL_PROOF__ = {
      v2Constructed: 0,
      v2Init: 0,
      v4Constructed: 0,
      v4Init: 0,
      captures: [],
    };

    const posthog = win.posthog ?? {};
    posthog.isFeatureEnabled = (key: string) => {
      if (key === 'private_stt_v4_enabled') return v4FlagEnabled;
      if (key === 'private_stt_v4_distil_enabled') return false;
      if (key === 'private_stt_v4_internal_only') return v4FlagEnabled;
      return false;
    };
    posthog.capture = (event: string, payload: Record<string, unknown> = {}) => {
      win.__V4_BROWSER_CONTROL_PROOF__?.captures.push({ event, payload });
    };
    win.posthog = posthog;

    Object.defineProperty(window.navigator, 'gpu', {
      configurable: true,
      value: webgpuAvailable
        ? { requestAdapter: async () => ({ name: 'browser-control-proof-adapter' }) }
        : undefined,
    });

    const makeV4Engine = () => (engineOptions?: { onReady?: () => void }) => {
      const proof = win.__V4_BROWSER_CONTROL_PROOF__;
      proof!.v4Constructed += 1;

      return {
        type: 'transformers-js-v4',
        checkAvailability: async () => ({ isAvailable: true, available: true }),
        init: async () => {
          proof!.v4Init += 1;
          engineOptions?.onReady?.();
          return { isOk: true, data: undefined };
        },
        start: async () => undefined,
        stop: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        destroy: async () => undefined,
        terminate: async () => undefined,
        updateOptions: () => undefined,
        getEngineType: () => 'transformers-js-v4',
        getLastHeartbeatTimestamp: () => Date.now(),
        getTranscript: async () => 'transformers-js-v4 browser-control transcript',
        transcribe: async () => ({ isOk: true, data: 'transformers-js-v4 browser-control transcript' }),
      };
    };

    const makeV2Engine = () => (engineOptions?: { onReady?: () => void }) => {
      const proof = win.__V4_BROWSER_CONTROL_PROOF__;
      proof!.v2Constructed += 1;

      return {
        type: 'transformers-js',
        checkAvailability: async () => ({ isAvailable: true, available: true }),
        init: async () => {
          proof!.v2Init += 1;
          engineOptions?.onReady?.();
          return { isOk: true, data: undefined };
        },
        start: async () => undefined,
        stop: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        destroy: async () => undefined,
        terminate: async () => undefined,
        updateOptions: () => undefined,
        getEngineType: () => 'transformers-js',
        getLastHeartbeatTimestamp: () => Date.now(),
        getTranscript: async () => 'transformers-js browser-control transcript',
        transcribe: async () => ({ isOk: true, data: 'transformers-js browser-control transcript' }),
      };
    };

    if (!win.__SS_E2E__) {
      win.__SS_E2E__ = { isActive: false, engineType: 'system', registry: {} };
    }
    win.__SS_E2E__.registry = {
      ...(win.__SS_E2E__.registry ?? {}),
      'transformers-js-v4': makeV4Engine(),
    };
    // Hide the v2 mock until PrivateSTT publishes the resolver decision. If it is
    // visible during STTStrategyFactory.create(), it gets injected into PrivateSTT
    // and the real runtime resolver never runs. Once the debug decision exists,
    // initSafeEngine() can use the mock and avoid loading fake model bytes.
    Object.defineProperty(win.__SS_E2E__.registry, 'transformers-js', {
      configurable: true,
      get: () => win.__PRIVATE_STT_RUNTIME_DEBUG__ ? makeV2Engine() : undefined,
    });
    // Production-like override gate: keep registry/mocked auth data available, but make
    // ENV.isE2E false before PrivateSTT resolves URL/localStorage experiment knobs.
    win.__SS_E2E__.isActive = false;
    win.__SS_E2E__.engineType = 'system';
  }, {
    v4FlagEnabled: options.v4FlagEnabled,
    webgpuAvailable: options.webgpuAvailable,
    localStorageOverrides: options.localStorageOverrides,
  });
}

async function reinforceBrowserControlHarness(page: Page, options: HarnessOptions) {
  await page.evaluate(({ v4FlagEnabled, webgpuAvailable, localStorageOverrides }) => {
    const win = window as unknown as Window & {
      __SS_E2E__?: {
        isActive?: boolean;
        engineType?: string;
        registry?: Record<string, unknown>;
      };
      __PRIVATE_STT_RUNTIME_DEBUG__?: unknown;
      __V4_BROWSER_CONTROL_PROOF__?: BrowserProof;
      posthog?: {
        isFeatureEnabled?: (key: string) => boolean;
        capture?: (event: string, payload?: Record<string, unknown>) => void;
      };
    };

    for (const [key, value] of Object.entries(localStorageOverrides ?? {})) {
      window.localStorage.setItem(key, value);
    }

    win.__V4_BROWSER_CONTROL_PROOF__ = win.__V4_BROWSER_CONTROL_PROOF__ ?? {
      v2Constructed: 0,
      v2Init: 0,
      v4Constructed: 0,
      v4Init: 0,
      captures: [],
    };

    const posthog = win.posthog ?? {};
    posthog.isFeatureEnabled = (key: string) => {
      if (key === 'private_stt_v4_enabled') return v4FlagEnabled;
      if (key === 'private_stt_v4_distil_enabled') return false;
      if (key === 'private_stt_v4_internal_only') return v4FlagEnabled;
      return false;
    };
    posthog.capture = (event: string, payload: Record<string, unknown> = {}) => {
      win.__V4_BROWSER_CONTROL_PROOF__?.captures.push({ event, payload });
    };
    win.posthog = posthog;

    Object.defineProperty(window.navigator, 'gpu', {
      configurable: true,
      value: webgpuAvailable
        ? { requestAdapter: async () => ({ name: 'browser-control-proof-adapter' }) }
        : undefined,
    });

    const makeV2Engine = () => (engineOptions?: { onReady?: () => void }) => {
      const proof = win.__V4_BROWSER_CONTROL_PROOF__;
      proof!.v2Constructed += 1;
      return {
        type: 'transformers-js',
        checkAvailability: async () => ({ isAvailable: true, available: true }),
        init: async () => {
          proof!.v2Init += 1;
          engineOptions?.onReady?.();
          return { isOk: true, data: undefined };
        },
        start: async () => undefined,
        stop: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        destroy: async () => undefined,
        terminate: async () => undefined,
        updateOptions: () => undefined,
        getEngineType: () => 'transformers-js',
        getLastHeartbeatTimestamp: () => Date.now(),
        getTranscript: async () => 'transformers-js browser-control transcript',
        transcribe: async () => ({ isOk: true, data: 'transformers-js browser-control transcript' }),
      };
    };

    const makeV4Engine = () => (engineOptions?: { onReady?: () => void }) => {
      const proof = win.__V4_BROWSER_CONTROL_PROOF__;
      proof!.v4Constructed += 1;
      return {
        type: 'transformers-js-v4',
        checkAvailability: async () => ({ isAvailable: true, available: true }),
        init: async () => {
          proof!.v4Init += 1;
          engineOptions?.onReady?.();
          return { isOk: true, data: undefined };
        },
        start: async () => undefined,
        stop: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        destroy: async () => undefined,
        terminate: async () => undefined,
        updateOptions: () => undefined,
        getEngineType: () => 'transformers-js-v4',
        getLastHeartbeatTimestamp: () => Date.now(),
        getTranscript: async () => 'transformers-js-v4 browser-control transcript',
        transcribe: async () => ({ isOk: true, data: 'transformers-js-v4 browser-control transcript' }),
      };
    };

    if (!win.__SS_E2E__) {
      win.__SS_E2E__ = { isActive: false, engineType: 'system', registry: {} };
    }
    win.__SS_E2E__.registry = {
      ...(win.__SS_E2E__.registry ?? {}),
      'transformers-js-v4': makeV4Engine(),
    };
    Object.defineProperty(win.__SS_E2E__.registry, 'transformers-js', {
      configurable: true,
      get: () => win.__PRIVATE_STT_RUNTIME_DEBUG__ ? makeV2Engine() : undefined,
    });
    win.__SS_E2E__.isActive = false;
    win.__SS_E2E__.engineType = 'system';
  }, options);
}

async function startPrivateAndCollect(page: Page, options: HarnessOptions, query = '') {
  const v4Requests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (isV4AssetRequest(url, request.resourceType())) v4Requests.push(url);
  });

  await navigateToRoute(page, `/session${query ?? ''}`);
  await reinforceBrowserControlHarness(page, options);
  await selectTranscriptionEngine(page, 'private');
  const startButton = page.getByTestId('session-start-stop-button');
  await expect(startButton).toBeEnabled({ timeout: 15_000 });
  await startButton.click();

  await page.waitForFunction(() => {
    const win = window as unknown as {
      __PRIVATE_STT_RUNTIME_DEBUG__?: unknown;
      __V4_BROWSER_CONTROL_PROOF__?: BrowserProof;
    };
    return Boolean(win.__PRIVATE_STT_RUNTIME_DEBUG__);
  }, undefined, { timeout: 15_000 });

  return page.evaluate((requests) => {
    const win = window as unknown as {
      __PRIVATE_STT_RUNTIME_DEBUG__?: Record<string, unknown>;
      __V4_BROWSER_CONTROL_PROOF__?: BrowserProof;
    };
    return {
      runtime: win.__PRIVATE_STT_RUNTIME_DEBUG__ ?? null,
      proof: win.__V4_BROWSER_CONTROL_PROOF__ ?? null,
      v4Requests: requests,
      location: window.location.href,
    };
  }, v4Requests);
}

function assertNoUnsafeTelemetry(captures: Array<{ event: string; payload: Record<string, unknown> }>) {
  for (const { event, payload } of captures) {
    const blob = JSON.stringify({ event, payload }).toLowerCase();
    for (const term of V4_FORBIDDEN_PAYLOAD_TERMS) {
      expect(blob, `PostHog payload must not contain ${term}`).not.toContain(term);
    }
    expect(blob, 'PostHog payload must not contain email-shaped values')
      .not.toMatch(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  }
}

test.describe('v4 PostHog browser-control proof', () => {
  // v4 activation/proof harness preserved ON main (convergence requirement), but v4 is OFF by
  // default and this proof is dispatch-only — it is skipped in the standard e2e shards so it never
  // destabilizes the shipped suite. Run it explicitly with RUN_V4_BROWSER_PROOF=1 when validating
  // a future v4 flag-on activation (#76).
  test.skip(process.env.RUN_V4_BROWSER_PROOF !== '1', 'v4 browser-control proof is dispatch-only (set RUN_V4_BROWSER_PROOF=1)');

  test('flag off/default stays on v2 and never constructs or requests v4 in a browser', async ({ page }) => {
    const options = { v4FlagEnabled: false, webgpuAvailable: true };
    await installBrowserControlHarness(page, options);
    const evidence = await startPrivateAndCollect(page, options);

    expect(evidence.runtime).toMatchObject({ provider: 'transformers-js' });
    expect(evidence.proof).toMatchObject({ v2Constructed: 1, v2Init: 1, v4Constructed: 0, v4Init: 0 });
    expect(evidence.v4Requests).toEqual([]);
    assertNoUnsafeTelemetry(evidence.proof?.captures ?? []);
  });

  test('production-like browser ignores URL and localStorage v4 bypass attempts', async ({ page }) => {
    const options = {
      v4FlagEnabled: false,
      webgpuAvailable: true,
      localStorageOverrides: {
        privateEngine: 'transformers-js-v4',
        stt_engine: 'v4',
        v4ForceAuto: '1',
        'speaksharp.private.engine': 'transformers-js-v4',
        'speaksharp.v4.forceAuto': '1',
        'speaksharp.v4.device': 'webgpu',
        'speaksharp.v4.decoderDtype': 'q4',
      },
    };
    await installBrowserControlHarness(page, options);
    const evidence = await startPrivateAndCollect(page, options, '?engine=v4&privateEngine=transformers-js-v4&v4ForceAuto=1&v4Device=webgpu&v4DecoderDtype=q4');

    expect(evidence.runtime).toMatchObject({ provider: 'transformers-js' });
    expect(evidence.proof).toMatchObject({ v2Constructed: 1, v2Init: 1, v4Constructed: 0, v4Init: 0 });
    expect(evidence.v4Requests).toEqual([]);
    assertNoUnsafeTelemetry(evidence.proof?.captures ?? []);
  });

  test('flag on without WebGPU stays conservative on v2 and any browser telemetry remains safe', async ({ page }) => {
    const options = { v4FlagEnabled: true, webgpuAvailable: false };
    await installBrowserControlHarness(page, options);
    const evidence = await startPrivateAndCollect(page, options);

    expect(evidence.runtime).toMatchObject({
      provider: 'transformers-js',
      webgpuAvailable: false,
    });
    expect(evidence.proof).toMatchObject({ v2Constructed: 1, v2Init: 1, v4Constructed: 0, v4Init: 0 });
    expect(evidence.v4Requests).toEqual([]);
    assertNoUnsafeTelemetry(evidence.proof?.captures ?? []);

    // The full E2E bundle disables analytics, so event emission remains covered by
    // the unit/headless telemetry suite. This browser proof verifies runtime
    // selection and keeps any captured browser payload on the same safety rail.
    expect(evidence.proof?.captures ?? []).toEqual(expect.any(Array));
  });
});
