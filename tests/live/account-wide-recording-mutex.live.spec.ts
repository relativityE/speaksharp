import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUDIO_ARGS, assertManualReleaseProofEnvironment, collectBenchmarkPreconditionSnapshot, selectBenchmarkMode } from './helpers/benchmark-utils';
import { FILLER_CONV_01_AUDIO } from './helpers/audio-fixtures';

const BASE_URL = process.env.BASE_URL;
const ACCOUNT_EMAIL = process.env.ACCOUNT_MUTEX_TEST_EMAIL ?? process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
const ACCOUNT_PASSWORD = process.env.ACCOUNT_MUTEX_TEST_PASSWORD ?? process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;
const USE_EXISTING_ACCOUNT = Boolean(ACCOUNT_EMAIL && ACCOUNT_PASSWORD);

test.describe.configure({ mode: 'serial', retries: 0 });

test.use({
  permissions: ['microphone'],
  baseURL: BASE_URL,
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      `--use-file-for-fake-audio-capture=${FILLER_CONV_01_AUDIO}`,
    ],
  },
});

test.describe('Account-wide recording mutex @live', () => {
  test('same account in two isolated browser contexts cannot record concurrently', async ({ browser }) => {
    test.skip(!BASE_URL, 'BASE_URL is required.');
    test.setTimeout(300_000);

    const account = USE_EXISTING_ACCOUNT
      ? { email: ACCOUNT_EMAIL!, password: ACCOUNT_PASSWORD!, mode: 'existing' as const }
      : {
        email: `account-mutex-${Date.now()}@speaksharp.app`,
        password: `SpeakSharpMutex-${Date.now()}!Aa9`,
        mode: 'fresh' as const,
      };

    const machineA = await newMachine(browser);
    const machineB = await newMachine(browser);

    try {
      const logsA = collectConsole(machineA.page, 'machineA');
      const logsB = collectConsole(machineB.page, 'machineB');

      if (account.mode === 'fresh') {
        await signUp(machineA.page, account.email, account.password);
      } else {
        await signIn(machineA.page, account.email, account.password);
      }
      await signIn(machineB.page, account.email, account.password);

      const environmentA = await assertManualReleaseProofEnvironment(machineA.page, 'account-mutex-machine-a-env');
      const environmentB = await assertManualReleaseProofEnvironment(machineB.page, 'account-mutex-machine-b-env');

      await prepareSession(machineA.page);
      await prepareSession(machineB.page);

      const firstStart = await startRecording(machineA.page, 'machineA');
      expect(firstStart.recording, JSON.stringify(firstStart)).toBe(true);

      const secondStart = await tryStartSecondMachine(machineB.page);
      const lockText = await readLockText(machineB.page);
      const evidence = {
        account: { mode: account.mode, email: account.email },
        environmentA,
        environmentB,
        firstStart,
        secondStart,
        lockText,
        machineA: await collectBenchmarkPreconditionSnapshot(machineA.page, 'account-mutex-machine-a-after-first-start'),
        machineB: await collectBenchmarkPreconditionSnapshot(machineB.page, 'account-mutex-machine-b-after-second-start'),
        logsA,
        logsB,
      };
      console.log(`LIVE_ACCOUNT_MUTEX_EVIDENCE ${JSON.stringify(evidence)}`);

      expect(secondStart.recording, JSON.stringify(evidence)).toBe(false);
      expect(lockText, JSON.stringify(evidence)).toMatch(/active session|another tab|another device|already recording|recording in progress/i);
    } finally {
      await stopIfRecording(machineB.page);
      await stopIfRecording(machineA.page);
      await machineB.context.close();
      await machineA.context.close();
    }
  });
});

async function newMachine(browser: Browser) {
  const context = await browser.newContext({
    baseURL: BASE_URL,
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  return { context, page };
}

function collectConsole(page: Page, label: string) {
  const logs: Array<{ type: string; text: string }> = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/lock|session|recording|SpeechRuntime|DistributedLock|active session/i.test(text)) {
      logs.push({ type: message.type(), text });
      console.log(`[${label}:${message.type()}] ${text}`);
    }
  });
  return logs;
}

async function signUp(page: Page, email: string, password: string) {
  await page.goto('/auth/signup');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-up-submit').click();
  await page.waitForURL(/\/session/, { timeout: 60_000 });
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/auth/signin');
  await expect(page.getByTestId('auth-form')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('email-input').fill(email);
  await page.getByTestId('password-input').fill(password);
  await page.getByTestId('sign-in-submit').click();
  await page.waitForURL(/\/session/, { timeout: 60_000 });
}

async function prepareSession(page: Page) {
  await page.goto('/session');
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 60_000 });
  await selectBenchmarkMode(page, 'private');
  await preparePrivateModelIfPrompted(page);
  await expect(page.getByTestId('session-start-stop-button')).toBeEnabled({ timeout: 90_000 });
}

async function preparePrivateModelIfPrompted(page: Page) {
  const downloadButton = page.locator('[data-testid="download-model-button"], [data-testid="download-model-button-inline"]').first();
  if (await downloadButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await downloadButton.click();
  }

  await page.waitForFunction(() => {
    const root = document.documentElement;
    return (
      root.getAttribute('data-stt-ready') === 'true' ||
      root.getAttribute('data-model-status') === 'ready' ||
      root.getAttribute('data-runtime-state') === 'READY'
    );
  }, { timeout: 180_000 });
}

async function startRecording(page: Page, label: string) {
  const button = page.getByTestId('session-start-stop-button');
  await expect(button, `${label} start/stop button`).toBeEnabled({ timeout: 60_000 });
  await button.click();
  await page.waitForTimeout(2_000);
  return readRecordingState(page);
}

async function tryStartSecondMachine(page: Page) {
  const button = page.getByTestId('session-start-stop-button');
  await expect(button).toBeVisible({ timeout: 60_000 });
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await button.click();
  await page.waitForTimeout(3_000);
  return readRecordingState(page);
}

async function readRecordingState(page: Page) {
  return page.evaluate(() => {
    const button = document.querySelector('[data-testid="session-start-stop-button"]');
    const html = document.documentElement;
    return {
      recording: button?.getAttribute('data-recording') === 'true',
      buttonRecording: button?.getAttribute('data-recording') ?? null,
      runtimeState: html.getAttribute('data-runtime-state'),
      sttStatus: html.getAttribute('data-stt-status'),
      lockHeldByOther: html.getAttribute('data-lock-held-by-other'),
      statusText: document.querySelector('[data-testid="status-message-text"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      bodyText: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 800),
      localLock: localStorage.getItem('speaksharp_active_session_lock'),
    };
  });
}

async function readLockText(page: Page) {
  const state = await readRecordingState(page);
  return [state.statusText, state.bodyText].filter(Boolean).join(' ');
}

async function stopIfRecording(page: Page) {
  const state = await readRecordingState(page).catch(() => null);
  if (!state?.recording) return;
  await page.getByTestId('session-start-stop-button').click().catch(() => undefined);
  await page.waitForTimeout(1_000).catch(() => undefined);
}
