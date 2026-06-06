import { test, expect, type Page } from '@playwright/test';
import { AUDIO_ARGS, collectBenchmarkPreconditionSnapshot, selectBenchmarkMode } from './helpers/benchmark-utils';
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
  runtimeState: string | null
  sttReady: string | null
  downloadVisible: boolean
}

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
  test('Private CPU model setup survives a same-browser second start from cache', async ({ page }) => {
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
    await clearPrivateModelStorage(page);
    await page.reload();
    await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });

    await selectBenchmarkMode(page, 'private');
    const zeroHfAudit = ZERO_HF_AUDIT_REQUIRED ? await startZeroHuggingFaceAudit(page) : null;
    await preparePrivateModelIfPrompted(page);
    const firstReady = await getCacheSnapshot(page);

    expect(isPrivateReadySnapshot(firstReady), JSON.stringify(firstReady)).toBe(true);
    expect(firstReady.transformerCacheKeyCount, JSON.stringify(firstReady)).toBeGreaterThan(0);

    await startAndStopPrivateRecording(page);

    await page.reload();
    await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });
    await selectBenchmarkMode(page, 'private');
    await waitForPrivateReady(page);

    const secondReady = await getCacheSnapshot(page);
    await startAndStopPrivateRecording(page);
    const zeroHfResult = zeroHfAudit
      ? await zeroHfAudit.assertZeroHuggingFace({ requireModelsFromOrigin: true })
      : null;
    zeroHfAudit?.stop();

    const evidence = {
      firstStart: firstReady,
      secondStart: secondReady,
      cachePersisted: secondReady.transformerCacheKeyCount >= firstReady.transformerCacheKeyCount,
      secondStartReadyWithoutDownloadPrompt: isPrivateReadySnapshot(secondReady) && !secondReady.downloadVisible,
      zeroHfAudit: zeroHfResult,
    };

    console.log(`LIVE_PRIVATE_CACHE_EVIDENCE ${JSON.stringify(evidence)}`);

    expect(evidence.cachePersisted, JSON.stringify(evidence)).toBe(true);
    expect(evidence.secondStartReadyWithoutDownloadPrompt, JSON.stringify(evidence)).toBe(true);
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
        .filter((name): name is string => Boolean(name) && /transformers|whisper|model/i.test(name))
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
  const downloadButton = page.locator('[data-testid="download-model-button"], [data-testid="download-model-button-inline"]').first();
  if (await downloadButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
    if (process.env.PRIVATE_SETUP_USER_CONSENT_REQUIRED === 'true') {
      const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-setup-user-consent-required');
      throw new Error(
        `INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible\n` +
        `Private model setup requires an explicit user click; this proof must not auto-download.\n` +
        `${JSON.stringify(snapshot, null, 2)}`
      );
    }
    await downloadButton.click();
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
  const startStopButton = page.getByTestId('session-start-stop-button');
  await expect(startStopButton).toBeVisible({ timeout: 30_000 });
  await expect(startStopButton).toBeEnabled({ timeout: 60_000 });
  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'true', { timeout: 45_000 });
  await page.waitForTimeout(2_000);
  await startStopButton.click();
  await expect(startStopButton).toHaveAttribute('data-recording', 'false', { timeout: 45_000 });
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
    const downloadButton = document.querySelector('[data-testid="download-model-button"], [data-testid="download-model-button-inline"]');

    return {
      cacheNames,
      transformerCacheKeyCount,
      indexedDbNames,
      modelStatus: root.getAttribute('data-model-status'),
      runtimeState: root.getAttribute('data-runtime-state'),
      sttReady: root.getAttribute('data-stt-ready'),
      downloadVisible: Boolean(downloadButton && getComputedStyle(downloadButton).display !== 'none'),
    };
  });
}
