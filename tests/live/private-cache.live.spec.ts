import { test, expect, type Page } from '@playwright/test';
import {
  AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, selectBenchmarkMode,
  startBenchmarkRecording, stopBenchmarkRecording,
} from './helpers/benchmark-utils';
// The MODEL-STATE CONTROL MAP. This spec clicked `session-start-stop-button`, the combined toggle the
// session overhaul retired — it renders on no viewport, so the download click and both recording
// clicks had no target. `live-release-matrix` still invokes this spec, so it is migrated rather than
// left in a known-broken ledger.
import { MIC_CONTROL_BY_STATUS } from '../helpers/micControls';
import privateSttConfig from '../../frontend/src/config/private-stt.config.json';
import { CANDIDATES } from '../../frontend/src/services/transcription/candidateRegistry';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;
const E2E_PRO_EMAIL = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const E2E_PRO_PASSWORD = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const ZERO_HF_AUDIT_REQUIRED = process.env.ZERO_HF_AUDIT_REQUIRED === 'true';

type CacheSnapshot = {
  cacheNames: string[]
  transformerCacheKeyCount: number
  indexedDbNames: string[]
  modelStatus: string | null
  runtimeProvider: string | null
  runtimeState: string | null
  sttReady: string | null
  downloadVisible: boolean
  privateModelTelemetry: {
    model?: string
    selectionSource?: string
    overridden?: boolean
    fallbackPath?: string
  } | null
}

// THE EXPECTATION COMES FROM THE CONFIG PLANE, NOT A LITERAL.
//
// This hardcoded `whisper-base.en` and `selectionSource: 'default'`, and additionally read
// `__PRIVATE_MODEL_TELEMETRY__` — a surface published ONLY by TransformersJSEngine. Under a config that
// selects distil or Moonshine the v2 engine never runs, so that object is never published and the
// proof would fail or, worse, assert v2's identity for a session decoded by another model.
//
// The proof's subject is CACHE behaviour, which is model-agnostic. Model identity is asserted against
// whatever the checked-in config actually names, through a surface every engine publishes.
const CONFIGURED_CANDIDATE = CANDIDATES[privateSttConfig.candidate as keyof typeof CANDIDATES];
const CONFIGURED_IS_V2 = CONFIGURED_CANDIDATE?.engine === 'transformers-js';

const PRIVATE_MODEL_CASES = [
  {
    label: `configured-${privateSttConfig.candidate}`,
    sessionPath: '/session',
    expectedEngine: CONFIGURED_CANDIDATE?.engine,
    /** v2-only surface; asserted only when the configured engine actually publishes it. */
    expectedV2ModelKey: CONFIGURED_IS_V2 ? 'whisper-base.en' : null,
  },
] as const;

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      '--disable-gpu',
      '--disable-webgpu',
      `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_LONG_AUDIO}`,
    ],
  },
});

test.describe.serial('Private first-start and second-start cache proof @live', () => {
  test('Private base default plus tiny fallback load from selfhosted cache', async ({ page }) => {
    test.skip(!BASE_URL || !E2E_PRO_EMAIL || !E2E_PRO_PASSWORD, 'BASE_URL and Pro test credentials are required.');
    test.setTimeout(300_000);

    await page.addInitScript(() => {
      window.__E2E_CONTEXT__ = true;
      window.REAL_WHISPER_TEST = true;
      window.__FORCE_TRANSFORMERS_JS__ = true;
      window.__STT_LOAD_TIMEOUT__ = 180000;
    });

    page.on('console', (message) => {
      const text = message.text();
      if (/ModelManager|TransformersJS|PrivateWhisper|Downloading private model|Private model cached|SpeechRuntime/i.test(text)) {
        console.log(`[browser:${message.type()}] ${text}`);
      }
    });

    await signInAsPro(page);

    const modelEvidence = [];
    for (const modelCase of PRIVATE_MODEL_CASES) {
      await clearPrivateModelStorage(page);
      await page.goto(modelCase.sessionPath);
      await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });

      await selectBenchmarkMode(page, 'private');
      const zeroHfAudit = ZERO_HF_AUDIT_REQUIRED ? await startZeroHuggingFaceAudit(page) : null;
      await preparePrivateModelIfPrompted(page);
      const firstReady = await getCacheSnapshot(page);

      expect(isPrivateReadySnapshot(firstReady), JSON.stringify({ modelCase, firstReady })).toBe(true);
      expect(firstReady.transformerCacheKeyCount, JSON.stringify({ modelCase, firstReady })).toBeGreaterThan(0);
      // Model-agnostic: the provider the engine ITSELF published must be the configured one.
      expect(firstReady.runtimeProvider, JSON.stringify({ modelCase, firstReady })).toBe(modelCase.expectedEngine);
      if (modelCase.expectedV2ModelKey) {
        expect(firstReady.privateModelTelemetry?.model, JSON.stringify({ modelCase, firstReady })).toBe(modelCase.expectedV2ModelKey);
        expect(firstReady.privateModelTelemetry?.selectionSource, JSON.stringify({ modelCase, firstReady })).toBe('default');
      }

      await startAndStopPrivateRecording(page);

      await page.goto(modelCase.sessionPath);
      await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });
      await selectBenchmarkMode(page, 'private');
      await waitForPrivateReady(page);

      const secondReady = await getCacheSnapshot(page);
      expect(secondReady.runtimeProvider, JSON.stringify({ modelCase, secondReady })).toBe(modelCase.expectedEngine);
      if (modelCase.expectedV2ModelKey) {
        expect(secondReady.privateModelTelemetry?.model, JSON.stringify({ modelCase, secondReady })).toBe(modelCase.expectedV2ModelKey);
      }
      await startAndStopPrivateRecording(page);
      const zeroHfResult = zeroHfAudit
        ? await zeroHfAudit.assertZeroHuggingFace({ requireModelsFromOrigin: true })
        : null;
      zeroHfAudit?.stop();

      const evidence = {
        model: modelCase.label,
        expectedEngine: modelCase.expectedEngine,
        firstStart: firstReady,
        secondStart: secondReady,
        cachePersisted: secondReady.transformerCacheKeyCount >= firstReady.transformerCacheKeyCount,
        secondStartReadyWithoutDownloadPrompt: isPrivateReadySnapshot(secondReady) && !secondReady.downloadVisible,
        zeroHfAudit: zeroHfResult,
      };

      expect(evidence.cachePersisted, JSON.stringify(evidence)).toBe(true);
      expect(evidence.secondStartReadyWithoutDownloadPrompt, JSON.stringify(evidence)).toBe(true);
      modelEvidence.push(evidence);
    }

    const evidence = {
      models: modelEvidence,
    };

    console.log(`LIVE_PRIVATE_CACHE_EVIDENCE ${JSON.stringify(evidence)}`);
  });
});

async function signInAsPro(page: Page) {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('email-input').fill(E2E_PRO_EMAIL!);
  await page.getByTestId('password-input').fill(E2E_PRO_PASSWORD!);
  await page.getByTestId('sign-in-submit').click();
  await expect(page).toHaveURL(/\/session/, { timeout: 30_000 });
  await expect(page.getByTestId('pro-badge')).toBeVisible({ timeout: 20_000 });
}

async function startZeroHuggingFaceAudit(page: Page): Promise<{
  stop: () => void
  assertZeroHuggingFace: (opts?: { requireModelsFromOrigin?: boolean }) => Promise<{
    ok: true
    totalRequests: number
    modelsFromOrigin: number
    huggingFaceRequests: 0
  }>
}> {
  // JS helper intentionally lives outside the app bundle. It uses Playwright request
  // events so worker model fetches are visible to the live release matrix.
  const { trackPrivateModelRequests } = await import('./helpers/zeroHuggingFaceAudit.mjs');
  return trackPrivateModelRequests(page);
}

function isPrivateReadySnapshot(snapshot: CacheSnapshot) {
  return snapshot.sttReady === 'true' ||
    snapshot.runtimeState === 'RECORDING' ||
    snapshot.modelStatus === 'ready';
}

async function clearPrivateModelStorage(page: Page) {
  await page.evaluate(async () => {
    if ('caches' in window) {
      for (const name of await caches.keys()) {
        if (/transformers|whisper|model/i.test(name)) {
          await caches.delete(name);
        }
      }
    }

    if ('indexedDB' in window && 'databases' in indexedDB) {
      const databases = await indexedDB.databases();
      await Promise.all(databases
        .map((database) => database.name)
        .filter((name): name is string => typeof name === 'string' && /transformers|whisper|model/i.test(name))
        .map((name) => new Promise<void>((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        })));
    }
  });
}

async function preparePrivateModelIfPrompted(page: Page) {
  // First-run Private downloads via the MIC (the separate "Set up" button was removed). Trigger it
  // only when setup is required (durable data-model-status / first-run note), so a warm cache
  // auto-loads and the mic is never clicked into a recording start.
  const setupNeeded = (await page.evaluate(() => document.documentElement.getAttribute('data-model-status')).catch(() => null)) === 'download-required'
    || await page.locator('[data-testid="private-first-run-note"]').isVisible({ timeout: 10_000 }).catch(() => false);
  if (setupNeeded) {
    if (process.env.PRIVATE_SETUP_USER_CONSENT_REQUIRED === 'true') {
      const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-setup-user-consent-required');
      throw new Error(
        `INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible\n` +
        `Private model setup requires an explicit user click; this proof must not auto-download.\n` +
        `${JSON.stringify(snapshot, null, 2)}`
      );
    }
    // The DOWNLOAD control, which is what `download-required` actually renders.
    await page.getByTestId(MIC_CONTROL_BY_STATUS['download-required']).first().click();
  }

  await waitForPrivateReady(page);
}

async function waitForPrivateReady(page: Page) {
  await page.waitForFunction(() => {
    const root = document.documentElement;
    const runtimeState = root.getAttribute('data-runtime-state');
    const sttReady = root.getAttribute('data-stt-ready');
    const modelStatus = root.getAttribute('data-model-status');

    return (
      sttReady === 'true' ||
      runtimeState === 'RECORDING' ||
      modelStatus === 'ready'
    );
  }, { timeout: 180_000 });
}

async function startAndStopPrivateRecording(page: Page) {
  // RecorderBar REPLACES MicCard while recording rather than toggling it, so start and stop are
  // DIFFERENT controls. The retired toggle's `data-recording` attribute belonged to an element that no
  // longer exists, so polling it reported "not recording" unconditionally.
  await startBenchmarkRecording(page, 'private-cache');
  await page.waitForTimeout(2_000);
  await stopBenchmarkRecording(page, 'private-cache');
}

async function getCacheSnapshot(page: Page): Promise<CacheSnapshot> {
  return await page.evaluate(async () => {
    const cacheNames = 'caches' in window ? await caches.keys() : [];
    const transformerCache = cacheNames.find((name) => /transformers/i.test(name));
    const transformerCacheKeyCount = transformerCache
      ? (await (await caches.open(transformerCache)).keys()).length
      : 0;
    const indexedDbNames = 'indexedDB' in window && 'databases' in indexedDB
      ? (await indexedDB.databases()).map((database) => database.name).filter((name): name is string => Boolean(name))
      : [];
    const root = document.documentElement;
    // Setup UI is now the first-run note (the separate download button was removed).
    const setupNote = document.querySelector('[data-testid="private-first-run-note"]');
    const telemetry = (window as unknown as {
      __PRIVATE_MODEL_TELEMETRY__?: {
        model?: string
        selectionSource?: string
        overridden?: boolean
        fallbackPath?: string
      }
    }).__PRIVATE_MODEL_TELEMETRY__ ?? null;

    return {
      cacheNames,
      transformerCacheKeyCount,
      indexedDbNames,
      modelStatus: root.getAttribute('data-model-status'),
      runtimeState: root.getAttribute('data-runtime-state'),
      sttReady: root.getAttribute('data-stt-ready'),
      downloadVisible: Boolean(setupNote && getComputedStyle(setupNote).display !== 'none'),
      privateModelTelemetry: telemetry,
      // Published by publishPrivateRuntimeDebug for EVERY private engine, so identity can be checked
      // without depending on the v2-only model-telemetry object.
      runtimeProvider: (window as unknown as { __PRIVATE_STT_RUNTIME_DEBUG__?: { provider?: string } })
        .__PRIVATE_STT_RUNTIME_DEBUG__?.provider ?? null,
    };
  });
}
