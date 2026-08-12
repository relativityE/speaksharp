import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import {
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
  startRecording,
  stopRecording,
} from './helpers';

/**
 * #1255 / PR #1270 — the responsive SessionShell proof.
 *
 * The shell was a FIXED two-column grid at every width, which crushed the transcript and coaching side by
 * side on phones. It is now ONE stacked column below the `md` breakpoint and the 1.55fr/1fr two-column
 * grid from `md` up. This journey proves, in a real browser, that:
 *
 *   - no state at any supported width scrolls horizontally (320/375/390 phones, 1024/1280/1440 desktop);
 *   - on phones the four slots stack in reading order mic → transcript → progress → coaching, and the
 *     transcript uses the readable full width (not a crushed 1fr column);
 *   - on desktop the rail sits BESIDE the left column (two-column), not below it.
 *
 * The Open Mic (freeform) session renders all four slots (Focus Points intentionally hides slot C), so it
 * is the right journey to assert the full mic → transcript → progress → coaching order.
 */

const PHONE_WIDTHS = [320, 375, 390] as const;
const DESKTOP_WIDTHS = [1024, 1280, 1440] as const;
const ALL_WIDTHS = [...PHONE_WIDTHS, ...DESKTOP_WIDTHS] as const;
const MD_BREAKPOINT = 768;
const DIR = 'test-results/session-shell-responsive';

const heightFor = (w: number) => (w < MD_BREAKPOINT ? 844 : 900);

/** No horizontal overflow: the document never scrolls wider than the viewport (±1px rounding). */
async function assertNoHorizontalOverflow(page: Page, label: string) {
  const { overflow, culprits } = await page.evaluate(() => {
    const vw = window.innerWidth;
    const over = document.documentElement.scrollWidth - vw;
    // Diagnostic: when overflowing, list every element whose right edge exceeds the viewport, so the
    // failure names the actual too-wide node (testid/tag/class + measured width) instead of a bare number.
    const culprits: string[] = [];
    if (over > 1) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 || r.width > vw + 1) {
          const tid = el.getAttribute('data-testid');
          const id = tid ? `#${tid}` : el.className ? `.${String(el.className).split(/\s+/).slice(0, 2).join('.')}` : '';
          culprits.push(`${el.tagName.toLowerCase()}${id} w=${Math.round(r.width)} right=${Math.round(r.right)}`);
        }
      }
    }
    return { overflow: over, culprits: culprits.slice(0, 12) };
  });
  expect(
    overflow,
    `horizontal overflow at ${label} (${overflow}px). Widest offenders: ${culprits.join(' | ')}`,
  ).toBeLessThanOrEqual(1);
}

/** Sweep every supported width in the current state and assert no width overflows. */
async function sweepNoOverflow(page: Page, state: string) {
  for (const w of ALL_WIDTHS) {
    await page.setViewportSize({ width: w, height: heightFor(w) });
    await assertNoHorizontalOverflow(page, `${state}@${w}`);
  }
}

/**
 * The layout contract at one width, in the before-state where all four slots are present and stable.
 * Phones: stacked in reading order, transcript full-width. Desktop: rail beside the left column.
 */
async function assertLayout(page: Page, w: number) {
  await page.setViewportSize({ width: w, height: heightFor(w) });
  await assertNoHorizontalOverflow(page, `before@${w}`);

  const a = await page.getByTestId('session-slot-a').boundingBox(); // mic
  const b = await page.getByTestId('session-slot-b').boundingBox(); // transcript
  const c = await page.getByTestId('session-slot-c').boundingBox(); // progress
  const d = await page.getByTestId('session-slot-d').boundingBox(); // coaching
  expect(a && b && c && d, `all four slots present at ${w}`).toBeTruthy();

  if (w < MD_BREAKPOINT) {
    // Stacked: strict top-to-bottom reading order mic → transcript → progress → coaching.
    expect(a!.y, `mic above transcript @${w}`).toBeLessThan(b!.y);
    expect(b!.y, `transcript above progress @${w}`).toBeLessThan(c!.y);
    expect(c!.y, `progress above coaching @${w}`).toBeLessThan(d!.y);
    // Single column: the rail shares the left column's left edge (full-width, not indented).
    expect(Math.abs(c!.x - a!.x), `rail shares left edge @${w}`).toBeLessThanOrEqual(2);
    // Transcript uses the readable full width, not a crushed fraction of it.
    expect(b!.width, `transcript full-width @${w}`).toBeGreaterThan(w * 0.8);
  } else {
    // Two-column: the rail begins at/after the left column's right edge and sits beside it (same row).
    expect(c!.x, `rail right of left column @${w}`).toBeGreaterThan(b!.x + b!.width - 2);
    expect(Math.abs(c!.y - a!.y), `rail beside left column @${w}`).toBeLessThan(60);
  }
}

test.describe('#1255 — SessionShell is responsive across phone and desktop widths', () => {
  test('before/during/after: no overflow at 320/375/390 + 1024/1280/1440, correct stack order', async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });

    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await page.setViewportSize({ width: 375, height: 844 });
    await navigateToRoute(page, '/session');

    // ---- BEFORE ---- full layout contract at every width (all four slots present + stable).
    await expect(page.getByTestId('mic-start')).toBeVisible();
    await expect(page.locator('[data-testid="session-shell"][data-session-state="before"]')).toBeVisible();
    for (const w of ALL_WIDTHS) {
      await assertLayout(page, w);
    }
    await page.setViewportSize({ width: 375, height: 844 });
    await page.screenshot({ path: `${DIR}/before-phone-375.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `${DIR}/before-desktop-1280.png`, fullPage: true });

    // ---- DURING ---- no width may overflow while live.
    await page.setViewportSize({ width: 375, height: 844 });
    await startRecording(page);
    await simulateTranscription(page, 'mobile session transcript stays readable while stacked on a phone', true);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 15_000 });
    await sweepNoOverflow(page, 'during');

    // ---- AFTER ---- save, settle, then re-sweep every width.
    await page.setViewportSize({ width: 375, height: 844 });
    await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    await sweepNoOverflow(page, 'after');

    // #1255 RETURN — the waveform must not be CLIPPED at 320px (the earlier overflow:hidden fix hid the
    // rightmost bars, which can carry a late filler marker). At the narrowest phone, assert the whole
    // recording is represented: the FIRST and LAST bars sit inside the visible track (no clipping).
    await page.setViewportSize({ width: 320, height: 844 });
    const track = await page.getByTestId('scrubber-waveform').boundingBox();
    const bars = page.getByTestId('scrubber-waveform-bar');
    const count = await bars.count();
    expect(track, 'scrubber waveform present').toBeTruthy();
    expect(count, 'waveform renders bars').toBeGreaterThan(0);
    const first = await bars.first().boundingBox();
    const last = await bars.nth(count - 1).boundingBox();
    // Left edge of the first bar is not clipped off the left of the track…
    expect(first!.x, 'first bar within track (left)').toBeGreaterThanOrEqual(track!.x - 1);
    // …and the right edge of the last bar (a late filler position) is inside the track's right edge.
    expect(last!.x + last!.width, 'last bar within track (right)').toBeLessThanOrEqual(track!.x + track!.width + 1);
  });
});
