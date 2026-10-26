import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import {
  navigateToRoute,
  openSessionDetailFromHistoryItem,
  programmaticLoginWithRoutes,
  selectTranscriptionEngine,
  simulateTranscription,
  startRecording,
  stopRecording,
  waitForFeature,
} from './helpers';
import { TEST_IDS } from '../constants';

const transcript = [
  'um speaksharp helps teams practice concise updates',
  'actually this target phrase should be tracked',
  'basically we can compare clarity pace like filler trends today',
].join(' ');

/**
 * #1593 UX-5 — the expected metrics are a HAND-CHECKABLE contract (product_release/QUALITY.md, Math), worked from the
 * fixture above and the controlled recording length, never produced by the app's own functions:
 *   words   = 24 (each letter/number run is one word; "um" is a word)
 *   fillers = 1  (um; like/actually/basically are discourse markers, not counted unless opted in)
 *   WPM     = 24 ÷ (seconds / 60)
 *   clarity = round(100 − 1.5 × (1/24 × 100) − pace penalty)
 *             pace penalty = 0 within 90–170 wpm, min(15, (90 − wpm) / 3) below 90
 *   10 s → 144 wpm, 100 − 6.25 − 0 = 93.75 → 94
 *   20 s →  72 wpm, 100 − 6.25 − 6 = 87.75 → 88
 */
const WORDS = 24;
const FILLERS = 1;
const TEN_SECONDS = { elapsedMs: 10_000, durationSeconds: 10, timer: '00:10', wpm: 144, clarity: 94 } as const;
const TWENTY_SECONDS = { elapsedMs: 20_000, durationSeconds: 20, timer: '00:20', wpm: 72, clarity: 88 } as const;
type Take = typeof TEN_SECONDS | typeof TWENTY_SECONDS;

interface SavedRow {
  id: string;
  status?: string;
  duration?: number;
  total_words?: number;
  wpm?: number;
  clarity_score?: number;
}

/** The session rows of the E2E in-page Supabase double — the client's real save target (setupE2EManifest). */
const readSavedRows = (page: Page): Promise<SavedRow[]> => page.evaluate(() => {
  const raw = window.sessionStorage.getItem('__SS_E2E_SESSION_DB__');
  return raw ? (JSON.parse(raw) as { sessions: SavedRow[] }).sessions : [];
});

/**
 * One Private take whose Start→Stop length is set by the test, not slept: Date is fixed at a current-time T0 for Start
 * and moved to T0 + elapsedMs for Stop (timers keep running). Checks the Session review, then returns the ONE row this
 * take created and saved.
 */
async function recordTake(page: Page, take: Take): Promise<SavedRow> {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/session');
  await selectTranscriptionEngine(page, 'private');
  const before = new Set((await readSavedRows(page)).map((r) => r.id));

  const t0 = Date.now();
  await page.clock.setFixedTime(t0);
  await startRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-runtime-state', 'RECORDING', { timeout: 15_000 });
  await simulateTranscription(page, transcript, true);
  await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toContainText('target phrase');

  await page.clock.setFixedTime(t0 + take.elapsedMs);
  await stopRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 15_000 });
  expect(await page.evaluate(() => (window as unknown as { __e2eCompleteSessionV2Calls__?: number }).__e2eCompleteSessionV2Calls__)).toBe(1);

  // The Session review of this take: its recorded length and the counts it shows.
  await expect(page.getByTestId('run-shape-duration')).toHaveText(take.timer);
  await expect(page.getByTestId('this-run-card-fillers')).toHaveText(String(FILLERS));
  await expect(page.getByTestId('this-run-card-words')).toHaveText(String(WORDS));

  const created = (await readSavedRows(page)).filter((r) => !before.has(r.id));
  expect(created).toHaveLength(1);
  return created[0];
}

/** The metrics shown for exactly this saved session: its history row, then its detail page. Returns the detail check. */
async function expectAnalyticsShows(page: Page, sessionId: string, take: Take) {
  await page.getByTestId(TEST_IDS.NAV_ANALYTICS_LINK).click();
  await waitForFeature(page, 'analytics');
  const row = page.getByTestId(`${TEST_IDS.SESSION_HISTORY_ITEM}-${sessionId}`);
  await expect(row).toBeVisible();
  const rowMetric = (label: string) => row.locator('span', { hasText: label }).locator('strong');
  await expect(rowMetric('Pace (wpm)')).toHaveText(String(take.wpm));
  await expect(rowMetric('Fillers')).toHaveText(String(FILLERS));
  await expect(rowMetric('Clear delivery (%)')).toHaveText(String(take.clarity));

  await navigateToRoute(page, `/progress/${sessionId}`);
  await waitForFeature(page, 'analytics');
  const card = (testId: string) => page.getByTestId(testId).locator('[data-evidence="present"]');
  const expectDetail = async () => {
    await expect(card(TEST_IDS.STAT_CARD_SPEAKING_PACE)).toHaveText(String(take.wpm));
    await expect(card(TEST_IDS.CLARITY_SCORE_VALUE)).toHaveText(String(take.clarity));
    await expect(card(TEST_IDS.FILLER_COUNT_VALUE)).toHaveText(String(FILLERS));
  };
  await expectDetail();
  return expectDetail;
}

// #1184: Private is the only engine — the former native/cloud matrix collapses to a single Private run.
test(`Gate 2 mocked private: a 10-second take shows its exact metrics on Analytics and after reload`, async ({ page }) => {
  const saved = await recordTake(page, TEN_SECONDS);
  // The save boundary: the captured Start→Stop length and the metrics persisted for this session.
  expect(saved).toMatchObject({
    status: 'completed', duration: TEN_SECONDS.durationSeconds, total_words: WORDS, wpm: TEN_SECONDS.wpm, clarity_score: TEN_SECONDS.clarity,
  });

  const expectDetail = await expectAnalyticsShows(page, saved.id, TEN_SECONDS);
  await expect(page.getByTestId('session-engine-metadata')).toContainText(/private/i);
  // #1306 Step 3: this is the NEWEST session, so its transcript is RETAINED and rendered. POSITIVE proof, not absence.
  await expect(page.getByTestId('session-detail-transcript')).toHaveCount(1);
  await expect(page.getByTestId('session-detail-transcript')).toContainText(/target phrase should be tracked/i);

  await page.reload();
  await waitForFeature(page, 'analytics');
  await expect(page).toHaveURL(new RegExp(`/progress/${saved.id}$`));
  // ...the same exact metrics and transcript survive a full reload, i.e. they came from the saved row.
  await expectDetail();
  await expect(page.getByTestId('session-detail-transcript')).toContainText(/target phrase should be tracked/i);
  await expect(page.getByTestId('session-engine-metadata')).toContainText(/private/i);

  await page.getByRole('button', { name: /Export PDF/i }).click();
  await expect(page.locator('body')).toHaveAttribute('data-pdf-token', 'watermarked');
});

test(`Gate 2 mocked private: CONTROL — the same take at 20 seconds shows 20-second metrics, not the 10-second ones`, async ({ page }) => {
  // A positive duration-sensitivity control: the recording length drives what is saved and shown.
  const saved = await recordTake(page, TWENTY_SECONDS);
  expect(saved).toMatchObject({
    status: 'completed', duration: TWENTY_SECONDS.durationSeconds, total_words: WORDS, wpm: TWENTY_SECONDS.wpm, clarity_score: TWENTY_SECONDS.clarity,
  });
  expect(saved.wpm).not.toBe(TEN_SECONDS.wpm);
  expect(saved.clarity_score).not.toBe(TEN_SECONDS.clarity);
  await expectAnalyticsShows(page, saved.id, TWENTY_SECONDS);
});

test(`Gate 2 mocked private: session detail can return to dashboard`, async ({ page }) => {
  await programmaticLoginWithRoutes(page, { userType: 'pro' });
  await navigateToRoute(page, '/progress');
  await waitForFeature(page, 'analytics');

  const latestSession = page.getByTestId(/session-history-item-/).first();
  await openSessionDetailFromHistoryItem(page, latestSession);
  await page.getByRole('link', { name: /Back to Dashboard/i }).click();
  await expect(page).toHaveURL('/progress');
});
