import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { TEST_IDS } from '../constants';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
  startRecording,
  stopRecording,
} from './helpers';

/**
 * #1256 / PR #1271 — the DECISIVE isolation journey.
 *
 * Completing a Focus Points take must never leak the objective into the next Open Mic session. The store
 * clears the LIVE brief on save (so it can never attach to the next recording) and keeps a review-only
 * SNAPSHOT alive for the after-state; the snapshot is cleared the moment the next recording starts, and is
 * ignored outside the after-state. This spec proves that contract end-to-end through the real UI:
 *
 *   Focus Points setup → record → save → REVIEW (snapshot keeps the FP after-state alive)
 *     → return to Practice → start Open Mic → assert NO objective survives, even with matching keywords,
 *       across the fresh session's before / during / after.
 *
 * The Open Mic transcript deliberately repeats the prior brief's point keywords ("price", "guarantee",
 * "timeline"). If any stale objective state leaked, the local keyword matcher would light a coverage rail
 * on Open Mic — so re-using those exact words is the sharpest possible isolation probe.
 */

/**
 * The user may enter ANY number of Focus Points, and every point they enter must be captured and
 * detected. There is no criteria count. This journey uses four only because it is not the number of
 * rows the form happens to open with, so a set built by the user is exercised rather than the
 * default layout — four is a sample, never a specification.
 *
 * The Open Mic leg re-speaks these keywords on purpose.
 */
const POINT_LABELS = [
  'Name the price',
  'State the guarantee',
  'Explain the timeline',
  'Cover the onboarding',
] as const;

/** One sentence per entered point, so the take genuinely covers all four. */
const SPEAKS_EVERY_POINT =
  'First I will name the price clearly. Then I state the guarantee we offer. '
  + 'Next I explain the timeline for delivery. Finally I cover the onboarding steps.';

/**
 * TAKE B SAYS SOMETHING DIFFERENT — the same four points, different words.
 *
 * The retry leg used to re-speak `SPEAKS_EVERY_POINT` and then assert 4/4, which two different
 * products satisfy: one where take B genuinely recorded and scored, and one where take A's saved
 * transcript and coverage were simply republished under B. Identical input made them
 * indistinguishable, so the leg proved the successor existed but not that it was the successor's own
 * work — the exact shape of casualty this program keeps having to correct.
 *
 * Each take also carries a marker phrase that cannot be confused with the other, so the after-state
 * transcript itself is evidence of WHICH take produced it.
 */
const TAKE_A_MARKER = 'this is the opening rehearsal';
const TAKE_B_MARKER = 'this is the second rehearsal';
const SPEAKS_EVERY_POINT_TAKE_A = `${TAKE_A_MARKER}. ${SPEAKS_EVERY_POINT}`;
const SPEAKS_EVERY_POINT_TAKE_B =
  `${TAKE_B_MARKER}. To begin I name the price up front. I also state the guarantee that covers it. `
  + 'After that I explain the timeline we commit to. To close I cover the onboarding you receive.';

/** Enter every label into the setup dialog, adding rows beyond the three initial ones. */
async function enterEveryPoint(page: Page) {
  await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
  await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
  for (let i = 3; i < POINT_LABELS.length; i++) {
    await page.getByTestId('objective-add-point').click();
  }
  for (let i = 0; i < POINT_LABELS.length; i++) {
    await page.getByTestId(`objective-point-label-${i}`).fill(POINT_LABELS[i]);
  }
  await page.getByTestId('objective-setup-submit').click();
}

/** Every entered point is present, in order, and every one reports Detected. */
async function assertEveryPointDetected(page: Page, label: string) {
  await expect(page.getByTestId('coverage-pace-total'), `total in ${label}`).toHaveText(`/${POINT_LABELS.length}`);
  await expect(page.getByTestId('coverage-pace-covered'), `covered in ${label}`).toHaveText(String(POINT_LABELS.length));
  for (let i = 0; i < POINT_LABELS.length; i++) {
    await expect(page.getByTestId(`focus-point-${i}`), `point ${i} in ${label}`).toHaveAttribute('data-status', 'covered');
    await expect(page.getByTestId(`focus-point-${i}`), `point ${i} label in ${label}`).toContainText(POINT_LABELS[i]);
  }
}

/** Focus Points chrome that must be ABSENT from any Open Mic state. */
async function assertNoObjectiveChrome(page: Page, label: string) {
  await expect(page.getByTestId('focus-points-rail'), `focus-points-rail leaked into ${label}`).toHaveCount(0);
  await expect(page.getByTestId('coverage-pace'), `coverage-pace leaked into ${label}`).toHaveCount(0);
  await expect(page.getByTestId('focus-delivery-strip'), `focus-delivery-strip leaked into ${label}`).toHaveCount(0);
  // The transcript header must not carry the Focus Points "n of m points covered" scoreboard.
  await expect(page.getByText(/points covered/i), `coverage scoreboard leaked into ${label}`).toHaveCount(0);
}

/** Drive a full record → save → after-state cycle (clears the sub-5s no-persist guard). */
async function recordSaveAndSettle(page: Page, transcript: string) {
  await startRecording(page);
  await simulateTranscription(page, transcript, true);
  await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
  await stopRecording(page);
  await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
  await expect(
    page.locator('[data-testid="session-shell"][data-session-state="after"]'),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('#1256 — Focus Points review state never leaks into the next Open Mic take', () => {
  test('Focus Points → save → review → Open Mic starts (and stays) clean', async ({ page }) => {
    test.setTimeout(120_000);

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');

    // ---- FOCUS POINTS: setup → session ----
    await page.getByTestId('practice-card-objective').click();
    await enterEveryPoint(page);

    // BEFORE (Focus Points): the plan rail is present — this is genuinely a Focus Points session.
    await page.waitForURL('**/session');
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await expect(page.getByTestId('coverage-pace-total')).toHaveText(`/${POINT_LABELS.length}`);

    // RECORD → SAVE → REVIEW. EVERY entered point is spoken, so every one must be detected. There is
    // no case in which a point the user entered is allowed to go missing.
    await recordSaveAndSettle(page, SPEAKS_EVERY_POINT);

    // AFTER (Focus Points): the finished-brief SNAPSHOT keeps the review screen alive after the live brief
    // was cleared on save — coverage card + rail render, proving the snapshot path works, and the
    // snapshot preserves every entered point with its coverage.
    await expect(page.getByTestId('coverage-pace')).toBeVisible();
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await assertEveryPointDetected(page, 'Focus Points after-state');

    // ---- RETURN TO PRACTICE → OPEN MIC ----
    await navigateToRoute(page, '/practice');
    await page.getByTestId('practice-card-freeform').click();
    await page.waitForURL('**/session');

    // BEFORE (Open Mic): a fresh session shows the Open Mic prompt offer and NO objective chrome, even
    // though the completed-brief snapshot still sits in the store (it is ignored outside the after-state).
    await expect(page.getByTestId('prompt-offer')).toBeVisible();
    await assertNoObjectiveChrome(page, 'Open Mic before');

    // DURING (Open Mic): re-speak the EXACT prior point keywords. If any objective state leaked, the
    // keyword matcher would light a coverage rail — it must not.
    await startRecording(page);
    await simulateTranscription(
      page,
      'Let me talk about the price, the guarantee, the timeline and the onboarding for all of this today.',
      true,
    );
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({
      timeout: 15_000,
    });
    await assertNoObjectiveChrome(page, 'Open Mic during');

    // AFTER (Open Mic): save and settle; the review screen is the generic Open Mic one — still no
    // objective coverage, rail, delivery strip, or scoreboard.
    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(
      page.locator('[data-testid="session-shell"][data-session-state="after"]'),
    ).toBeVisible({ timeout: 15_000 });
    await assertNoObjectiveChrome(page, 'Open Mic after');
  });

  // #1256 P1 — "Retry these points" must REBIND the finished brief and start a Focus Points take, not an
  // Open Mic one. The live brief was cleared on save, so without the rebind the retry silently degrades to
  // Open Mic and can never re-score the saved point set.
  test('Retry these points restarts as Focus Points, not Open Mic', async ({ page }) => {
    test.setTimeout(120_000);

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');

    await page.getByTestId('practice-card-objective').click();
    await enterEveryPoint(page);
    await page.waitForURL('**/session');
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();

    await recordSaveAndSettle(page, SPEAKS_EVERY_POINT_TAKE_A);
    // After-state Focus Points review is up (snapshot path); the retry control lives on the rail.
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await assertEveryPointDetected(page, 'before retry');

    // A'S SAVED IDENTITY, captured so B's can be required to differ. The controller publishes the
    // persisted row id on the document, which is the same anchor the observer reads.
    const takeAId = await page.locator('html').getAttribute('data-session-persisted-id');
    expect(takeAId, 'take A persisted under a real session id').toBeTruthy();

    // Retry → a fresh recording that is still Focus Points (rail present, Open Mic prompt offer absent).
    await page.getByTestId('focus-points-retry').click();
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await expect(page.getByTestId('coverage-pace')).toBeVisible();
    await expect(page.getByTestId('prompt-offer')).toHaveCount(0);

    // THE PRIOR TAKE'S N/N CLEARS TO 0/N. This is the assertion that was red: take A finished at 4/4,
    // Retry started take B, and the rail still showed A's 4/4 because A's finalization republished its
    // coverage after B's start had cleared it. Fenced in #1431 by binding that publish to the take
    // that owns it.
    await expect(page.getByTestId('coverage-pace-total')).toHaveText(`/${POINT_LABELS.length}`);
    await expect(page.getByTestId('coverage-pace-covered')).toHaveText('0');

    // ...AND EVERY ENTERED POINT IS STILL PRESENT, in order. A retry that silently dropped to the
    // three default rows would be a different set than the one the user asked to retry, and a rail
    // that cleared by emptying itself would satisfy 0/N while losing the user's work.
    await expect(page.getByTestId('focus-points-rail-list').getByRole('listitem'))
      .toHaveCount(POINT_LABELS.length);
    for (let i = 0; i < POINT_LABELS.length; i++) {
      await expect(page.getByTestId(`focus-point-${i}`)).toContainText(POINT_LABELS[i]);
      await expect(page.getByTestId(`focus-point-${i}`)).toHaveAttribute('data-status', 'pending');
    }

    // ---- TAKE B RUNS TO ITS OWN SAVE. Clearing A's coverage is only half the contract: the
    // successor must then publish ITS OWN transcript, review and N/N. A rail that cleared and stayed
    // empty would pass every assertion above while leaving the user with nothing.
    await simulateTranscription(page, SPEAKS_EVERY_POINT_TAKE_B, true);

    /**
     * B'S WORDS, ASSERTED WHILE B IS STILL RECORDING — which is where the live transcript exists.
     *
     * My first version asserted this in the AFTER-state and CI answered "element(s) not found",
     * correctly: #1306 purges ephemeral working memory at terminal, and the after-state renders the
     * server's `review-transcript` or an honest notice, never the live buffer. Asserting it here proves
     * the thing that actually matters for isolation — the successor captured its OWN content rather
     * than inheriting A's — at the only point where that content is on screen.
     */
    //
    // CASE-INSENSITIVE, and that is not cosmetic. The product sentence-cases the transcript, so it
    // renders "This is the second rehearsal…". A case-SENSITIVE `toContainText` failed the positive
    // assertion — and, worse, made the NEGATIVE one vacuous: `.not.toContainText('this is the opening
    // rehearsal')` would have passed against a screen literally showing take A's words, because the
    // rendered text is capitalised. A negative assertion that cannot fail is the exact shape of
    // casualty this program keeps having to correct.
    const liveTranscript = page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT);
    await expect(liveTranscript, "take B captured B's words")
        .toContainText(new RegExp(TAKE_B_MARKER, 'i'));
    await expect(liveTranscript, "take A's transcript did not carry into B")
        .not.toContainText(new RegExp(TAKE_A_MARKER, 'i'));

    await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(
      page.locator('[data-testid="session-shell"][data-session-state="after"]'),
    ).toBeVisible({ timeout: 15_000 });

    // B's own coverage, from B's own take — the same four points, all detected again.
    await assertEveryPointDetected(page, 'take B after-state');

    // ---- AND THE SAVE IS GENUINELY B'S. 4/4 alone is also what a republished take A looks like, so
    // the successor has to be identified by something A cannot supply: its own persisted row.
    // Republishing A's after-state would leave A's id on the document.
    const takeBId = await page.locator('html').getAttribute('data-session-persisted-id');
    expect(takeBId, 'take B persisted under a real session id').toBeTruthy();
    expect(takeBId, 'take B saved its OWN row, it did not republish take A').not.toBe(takeAId);
  });
});
