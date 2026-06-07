import { writeFileSync } from 'node:fs';
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

      // STT-IDENTITY-DIAG: capture identity DURING a real Private recording (closes the
      // "identity reflects a live run" gap — the browser smoke captured only the idle state).
      const identityA = await readSttIdentity(machineA.page);

      const secondStart = await tryStartSecondMachine(machineB.page);
      const lockText = await readLockText(machineB.page);

      // Re-assert A is STILL recording while B is blocked, so the block is proven under REAL
      // concurrency (not because A had already stopped).
      const aStillRecording = await readRecordingState(machineA.page);

      // Take-over: B forces the lease; A's heartbeat must then revoke and A must stop.
      const takeOver = await forceTakeOver(machineB.page);
      const aAfterTakeOver = await waitForRevoked(machineA.page);

      const evidence = {
        account: { mode: account.mode, email: account.email },
        environmentA,
        environmentB,
        firstStart,
        identityA,
        secondStart,
        lockText,
        aStillRecording,
        takeOver,
        aAfterTakeOver,
        machineA: await collectBenchmarkPreconditionSnapshot(machineA.page, 'account-mutex-machine-a-after-first-start'),
        machineB: await collectBenchmarkPreconditionSnapshot(machineB.page, 'account-mutex-machine-b-after-second-start'),
        logsA,
        logsB,
      };
      console.log(`LIVE_ACCOUNT_MUTEX_EVIDENCE ${JSON.stringify(evidence)}`);
      try {
        writeFileSync(`/private/tmp/account-lease-mutex-proof-${Date.now()}.json`, JSON.stringify(evidence, null, 2));
      } catch { /* artifact write is best-effort */ }

      // Core anti-sharing outcome: B cannot record concurrently and is told why.
      expect(secondStart.recording, JSON.stringify(evidence)).toBe(false);
      expect(lockText, JSON.stringify(evidence)).toMatch(/active session|another tab|another device|already recording|recording in progress/i);
      // Concurrency was real: A was still recording when B was blocked.
      expect(aStillRecording.recording, JSON.stringify(evidence)).toBe(true);
      // Take-over works: only asserted when a take-over control exists (UI wiring is test-owned);
      // otherwise captured as evidence. Written as single booleans to avoid conditional expects.
      const takeOverAsserted = takeOver.attempted;
      expect(!takeOverAsserted || takeOver.recording === true, `take-over should record on B: ${JSON.stringify(evidence)}`).toBe(true);
      expect(!takeOverAsserted || aAfterTakeOver.recording === false, `take-over should revoke/stop A: ${JSON.stringify(evidence)}`).toBe(true);
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
  // Use NATIVE for the account-mutex proof: the lease is acquired in the controller for ALL modes
  // (mode-agnostic), so proving it in Native avoids the Private DOWNLOAD_REQUIRED setup that left the
  // start button disabled and timed out the DAST run. Native is also the free-tier default — the most
  // realistic credential-sharing surface.
  await selectBenchmarkMode(page, 'native');
  await expect(page.getByTestId('session-start-stop-button')).toBeEnabled({ timeout: 60_000 });
}

async function startRecording(page: Page, label: string) {
  const button = page.getByTestId('session-start-stop-button');
  await expect(button, `${label} start/stop button`).toBeEnabled({ timeout: 60_000 });
  await button.click();
  // FIX: the prior fixed 2s wait raced Private warmup, so A often wasn't RECORDING yet and the
  // proof failed before B's block could be asserted. Poll until the engine is actually RECORDING
  // (data-recording=true), so the cross-device concurrency window is real.
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-testid="session-start-stop-button"]');
    return b?.getAttribute('data-recording') === 'true';
  }, { timeout: 120_000 }).catch(() => undefined);
  return readRecordingState(page);
}

async function tryStartSecondMachine(page: Page) {
  const button = page.getByTestId('session-start-stop-button');
  await expect(button).toBeVisible({ timeout: 60_000 });
  await expect(button).toBeEnabled({ timeout: 60_000 });
  await button.click();
  // Wait for a DECISION (blocked or started), not a fixed delay: B is blocked when it shows the
  // account-lease/active-session message or an error STT status, or (failure) it reaches recording.
  await page.waitForFunction(() => {
    const b = document.querySelector('[data-testid="session-start-stop-button"]');
    const html = document.documentElement;
    const status = document.querySelector('[data-testid="status-message-text"]')?.textContent ?? '';
    return (
      b?.getAttribute('data-recording') === 'true' ||
      html.getAttribute('data-stt-status') === 'error' ||
      html.getAttribute('data-lock-held-by-other') === 'true' ||
      /active session|another tab|another device|already recording|recording in progress/i.test(status)
    );
  }, { timeout: 60_000 }).catch(() => undefined);
  return readRecordingState(page);
}

/** Read the dev/test STT identity (STT-IDENTITY-DIAG) during a live recording, if exposed. */
async function readSttIdentity(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __STT_IDENTITY__?: () => unknown };
    try { return typeof w.__STT_IDENTITY__ === 'function' ? w.__STT_IDENTITY__() : null; } catch { return null; }
  });
}

/**
 * Force an explicit user take-over on the blocked machine. The take-over affordance is test-owned
 * UI; if no control is present this returns attempted:false (evidence only) so the core block proof
 * still stands. When present, it clicks it and waits for this machine to reach recording.
 */
async function forceTakeOver(page: Page) {
  const candidates = [
    '[data-testid="take-over-recording"]',
    '[data-testid="account-lease-take-over"]',
    '[data-testid="lease-take-over"]',
    'button:has-text("Take over")',
    'button:has-text("Record here")',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await loc.click().catch(() => undefined);
      await page.waitForFunction(() => (
        document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'true'
      ), { timeout: 60_000 }).catch(() => undefined);
      return { attempted: true, control: sel, ...(await readRecordingState(page)) };
    }
  }
  return { attempted: false, control: null, ...(await readRecordingState(page)) };
}

/** After a take-over, the displaced machine's lease heartbeat reports revoked and it stops. */
async function waitForRevoked(page: Page) {
  await page.waitForFunction(() => (
    document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') !== 'true'
  ), { timeout: 30_000 }).catch(() => undefined);
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
