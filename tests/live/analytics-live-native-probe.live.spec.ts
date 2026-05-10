import { test, expect } from '@playwright/test';
import { AUDIO_ARGS, selectBenchmarkMode, collectBenchmarkPreconditionSnapshot, expectBenchmarkRecordingStarted } from './helpers/benchmark-utils';
import { HARVARD_BENCHMARK_AUDIO } from './helpers/audio-fixtures';

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: [
      ...AUDIO_ARGS,
      `--use-file-for-fake-audio-capture=${HARVARD_BENCHMARK_AUDIO}`,
    ],
  },
});

test('native live STT analytics probe without mocked transcript injection', async ({ page }) => {
  test.setTimeout(120_000);

  const evidence: Record<string, unknown> = {
    mode: 'native',
    transcriptSource: HARVARD_BENCHMARK_AUDIO,
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

  await page.goto('/session?devBypass=true');
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 45_000 });

  await selectBenchmarkMode(page, 'native');
  evidence.preflight = await collectBenchmarkPreconditionSnapshot(page, 'native-live-before-start');
  console.log(`NATIVE_LIVE_PREFLIGHT ${JSON.stringify(evidence.preflight)}`);

  await page.getByTestId('session-start-stop-button').click();
  await expectBenchmarkRecordingStarted(page, 'native-live-probe');
  await expect(page.getByTestId('session-start-stop-button')).toHaveAttribute('data-recording', 'true', { timeout: 30_000 });

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

  await page.goto('/analytics?devBypass=true');
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 45_000 });
  await page.reload();
  await page.locator('html[data-app-ready="true"]').waitFor({ timeout: 45_000 });
  evidence.historyReload = await page.getByTestId(/^session-history-item-/).first().isVisible({ timeout: 15_000 }).catch(() => false);

  console.log(`LIVE_ANALYTICS_NATIVE_EVIDENCE ${JSON.stringify(evidence)}`);

  expect(evidence.transcriptAppeared, JSON.stringify(evidence)).toBe(true);
});
