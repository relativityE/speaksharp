import { test, expect } from '@playwright/test';
import { AUDIO_ARGS, selectBenchmarkMode, collectBenchmarkPreconditionSnapshot, expectBenchmarkRecordingStarted, collectNativePreflightDisposition } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_LONG_AUDIO } from './helpers/audio-fixtures';

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_LONG_AUDIO}`,
    ],
  },
});

test('native live STT analytics probe without mocked transcript injection', async ({ page }) => {
  test.setTimeout(120_000);

  const testEmail = process.env.PRO_TEST_EMAIL ?? process.env.E2E_PRO_EMAIL;
  const testPassword = process.env.PRO_TEST_PASSWORD ?? process.env.E2E_PRO_PASSWORD;

  if (!testEmail || !testPassword) {
    throw new Error('PRO_TEST_EMAIL and PRO_TEST_PASSWORD are required for the native live preflight probe. E2E_PRO_EMAIL/E2E_PRO_PASSWORD remain supported as legacy local aliases.');
  }

  const evidence: Record<string, unknown> = {
    mode: 'native',
    transcriptSource: HARVARD_BENCHMARK_LONG_AUDIO,
    transcriptAppeared: false,
    statsChanged: false,
    saved: false,
    historyReload: false,
    blockers: [] as string[],
  };

  page.on('console', (message) => {
    const text = message.text();
    if (/SpeechRecognition|Transcription|Supabase|Session saved|error|failed/i.test(text)) {
      console.log(`[browser:${message.type()}] ${text}`);
    }
  });

  await page.goto('/auth/signin');
  await page.waitForSelector('[data-testid="auth-form"]', { timeout: 15_000 });
  await page.getByTestId('email-input').fill(testEmail);
  await page.getByTestId('password-input').fill(testPassword);

  const loginPromise = page.waitForResponse(response =>
    response.url().includes('/auth/v1/token') && response.request().method() === 'POST'
  );
  await page.getByTestId('sign-in-submit').click();
  await loginPromise;

  await page.goto('/session');
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });

  await selectBenchmarkMode(page, 'native');
  evidence.preflight = await collectBenchmarkPreconditionSnapshot(page, 'native-live-before-start');
  console.log(`NATIVE_LIVE_PREFLIGHT ${JSON.stringify(evidence.preflight)}`);

  const profileText = ((evidence.preflight as { ui?: { profileText?: string | null } }).ui?.profileText ?? '').trim();
  if (profileText !== 'PRO') {
    throw new Error(`Native live preflight requires a Pro account before Start\n${JSON.stringify(evidence, null, 2)}`);
  }

  await page.getByTestId('session-start-stop-button').click();

  // Native CI disposition (release-gate CLASSIFICATION only — no app behavior change).
  // Web Speech `onstart` is environment-dependent; CI Chrome frequently never fires it. If the
  // app fails safely (SpeechRecognition present, reached READY, safe fallback copy, recovers to
  // idle without hanging), classify as ADVISORY/CI_BROWSER_LIMITATION rather than a paid-soft-
  // launch P0 blocker. A real hang / scary copy / unrecoverable or corrupt state still fails P0.
  try {
    await expectBenchmarkRecordingStarted(page, 'native-live-probe');
    await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true', { timeout: 30_000 });
  } catch (startError) {
    const disposition = await collectNativePreflightDisposition(page, { timeoutMs: 12_000, startError, label: 'native-live-probe' });
    evidence.nativeCiDisposition = disposition;
    console.log(`NATIVE_CI_PREFLIGHT_DISPOSITION ${JSON.stringify(disposition)}`);

    if (disposition.classification === 'ADVISORY_CI_BROWSER_LIMITATION') {
      // Advisory: CI browser could not prove Web Speech start; app recovered safely.
      // Not "Native green" — a real-browser/human Native proof remains a follow-up.
      test.info().annotations.push({
        type: 'advisory',
        description: `native-preflight CI_BROWSER_LIMITATION: ${disposition.summary} Real-browser/human Native proof remains a follow-up.`,
      });
      console.log(`LIVE_ANALYTICS_NATIVE_EVIDENCE ${JSON.stringify({ ...evidence, classification: 'ADVISORY_CI_BROWSER_LIMITATION', recordingStarted: false })}`);
      return;
    }

    // Real defect: app hung / scary copy / unrecoverable / corrupt state → preserve P0.
    throw new Error(
      `NATIVE_PREFLIGHT_P0 ${disposition.classification}\n${JSON.stringify(disposition, null, 2)}\n` +
      `${startError instanceof Error ? startError.message : String(startError)}`,
    );
  }

  await page.waitForTimeout(18_000);

  const transcriptText = ((await page.getByTestId('transcript-container').textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const wpmText = ((await page.getByTestId('wpm-value').textContent()) ?? '').trim();
  const fillerText = ((await page.getByTestId('filler-count-value').textContent()) ?? '').trim();
  const clarityText = ((await page.getByTestId('clarity-score-value').textContent()) ?? '').trim();
  const pauseText = ((await page.getByText(/Pause Analysis/i).locator('..').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();

  evidence.transcriptAppeared = /\b(the|you|that|have|harvard|speech|ask|country|fellow|test)\b/i.test(transcriptText);
  evidence.transcriptSample = transcriptText.slice(0, 240);
  evidence.liveStats = { wpmText, fillerText, clarityText, pauseText };
  evidence.statsChanged = !/^0\b/.test(wpmText) || !/^0\b/.test(fillerText) || !/^100%?$/.test(clarityText) || /[1-9]/.test(pauseText);

  await page.getByTestId('session-start-stop-button').click();
  await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'false', { timeout: 45_000 }).catch((error) => {
    (evidence.blockers as string[]).push(`stop did not settle: ${error.message}`);
  });

  evidence.saved = await page.locator('html[data-session-persisted="true"]').isVisible().catch(() => false);

  await page.goto('/analytics');
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });
  await page.reload();
  await page.locator('html[data-app-visible-ready="true"]').waitFor({ timeout: 45_000 });
  evidence.historyReload = await page.getByTestId(/^session-history-item-/).first().isVisible({ timeout: 15_000 }).catch(() => false);

  if (!evidence.transcriptAppeared) {
    (evidence.blockers as string[]).push(
      'manual-browser-transcript-required: GitHub Chromium fake-audio does not reliably prove Web Speech transcript output'
    );
  }

  console.log(`LIVE_ANALYTICS_NATIVE_EVIDENCE ${JSON.stringify(evidence)}`);

  const blockers = evidence.blockers as string[];
  expect(
    blockers.filter((blocker) => !blocker.startsWith('manual-browser-transcript-required')),
    JSON.stringify(evidence)
  ).toEqual([]);

  if (evidence.transcriptAppeared) {
    expect(evidence.saved, JSON.stringify(evidence)).toBe(true);
  }
});
