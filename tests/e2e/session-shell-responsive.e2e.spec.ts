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
 * The session slot map in a real browser — Design Correction Brief G1 / S-1 / S-2 / F-1, acceptance checks
 * #1 (slot geometry), #4 and #6 (slot B is exact ink), #35 (no overflow).
 *
 *     A  full width — recorder
 *     B  full width, INK — coaching → Practice Loop review
 *     C (flex 1) | D (310px) — transcript | rail
 *
 * jsdom cannot lay anything out, so this is where the map is actually proven:
 *   - A and B each span the shell's full content width, in every state, at 1024/1280/1440;
 *   - the two-column row starts BELOW B — C and D sit side by side, D is the 310px rail;
 *   - on phones the four slots stack A → B → C → D and the transcript keeps a readable width;
 *   - slot B computes to exactly rgb(28, 35, 51), flat, in every state;
 *   - no state scrolls horizontally at 320/375/390/1024/1280/1440.
 *
 * Open Mic renders all four slots, so it carries the full journey. Focus Points uses the same shell; its test
 * proves the same geometry and that its rail holds the plan — not a `0/N` score — before a run (F-2).
 */

const PHONE_WIDTHS = [320, 375, 390] as const;
const DESKTOP_WIDTHS = [1024, 1280, 1440] as const;
const ALL_WIDTHS = [...PHONE_WIDTHS, ...DESKTOP_WIDTHS] as const;
const MD_BREAKPOINT = 768;
const DIR = 'test-results/session-shell-responsive';

const heightFor = (w: number) => (w < MD_BREAKPOINT ? 844 : 900);

/**
 * Wait until the page has actually RELAID OUT at the requested width before measuring.
 *
 * `setViewportSize` resolves when the viewport is resized, not when the document has responded to it.
 * Measuring straight afterwards can read the PREVIOUS layout: the captured failures show
 * `div#practice-root w=375` and `button#nav-sign-out-button right=430` while the viewport is 320 — a nav
 * still positioned for the wider layout. That is not a product overflow, it is a stale frame, and it
 * produced failures on branches containing no frontend files at all while passing on same-commit reruns.
 *
 * Three conditions, because the captured 375px node was not always stale layout. With `popLayout`, the
 * outgoing route remains absolutely positioned at its measured width until its 200ms exit completes. A
 * newly visible destination can therefore coexist with the old 375px PracticePage while the test switches
 * to 320px. That animation is valid product behavior, but measuring both route trees is not a stable-state
 * responsive assertion. Wait for presence settlement first, then for the layout viewport and a committed
 * frame at the requested width.
 */
async function settleViewport(page: Page, width: number) {
  await expect(page.getByTestId('route-presence-child')).toHaveCount(1, { timeout: 5_000 });
  await page.setViewportSize({ width, height: heightFor(width) });
  await page.waitForFunction((w) => window.innerWidth === w, width, { timeout: 5_000 });
  // Two rAFs: the first runs before style/layout for this frame, the second after it has been committed.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

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

const INK = 'rgb(28, 35, 51)';

/**
 * The slot-map contract at one width, in whatever state the page is in.
 * Phones: stacked A → B → C → D. From md: A and B full width, then C beside a 310px D.
 */
// G16 D5 put the mic status to the RIGHT of the mic button. At 375 px the button (flex-basis 0) shrank instead of
// wrapping and its title/subtitle were painted UNDER the status: no overflow, every slot present, so the slot map
// alone passed. Measure the rendered TEXT (not the button box, which is exactly what shrank) against the status.
async function assertMicTextClearOfStatus(page: Page, label: string) {
  const hits = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="mic-card"]');
    const status = document.querySelector('[data-testid="mic-status-row"]');
    if (!card || !status) return ['mic-card or mic-status-row missing'];
    const s = status.getBoundingClientRect();
    const out: string[] = [];
    for (const el of Array.from(card.querySelectorAll('button span.block'))) {
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const r of Array.from(range.getClientRects())) {
        const overlaps = r.width > 0 && r.left < s.right && r.right > s.left && r.top < s.bottom && r.bottom > s.top;
        if (overlaps) out.push(`"${el.textContent}" overlaps the mic status`);
      }
    }
    return out;
  });
  expect(hits, `mic text vs status @ ${label}`).toEqual([]);
}

async function assertSlotMap(page: Page, w: number, state: string) {
  await settleViewport(page, w);
  await assertNoHorizontalOverflow(page, `${state}@${w}`);

  const shell = await page.getByTestId('session-shell').boundingBox();
  const a = await page.getByTestId('session-slot-a').boundingBox(); // recorder
  const b = await page.getByTestId('session-slot-b').boundingBox(); // coaching, ink
  const c = await page.getByTestId('session-slot-c').boundingBox(); // transcript
  const d = await page.getByTestId('session-slot-d').boundingBox(); // rail
  expect(shell && a && b && c && d, `shell and all four slots present in ${state}@${w}`).toBeTruthy();

  // Checks #4 / #6 — slot B is flat ink in every state; if it looks blue it is wrong.
  const ground = await page.getByTestId('session-slot-b').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { color: cs.backgroundColor, image: cs.backgroundImage, opacity: cs.opacity };
  });
  expect(ground.color, `slot B ink in ${state}@${w}`).toBe(INK);
  expect(ground.image, `slot B has no gradient in ${state}@${w}`).toBe('none');
  expect(ground.opacity, `slot B is opaque in ${state}@${w}`).toBe('1');

  // A and B are full-width blocks at every width, and B sits directly under A.
  expect(Math.abs(a!.width - shell!.width), `A full width in ${state}@${w}`).toBeLessThanOrEqual(2);
  expect(Math.abs(b!.width - shell!.width), `B full width in ${state}@${w}`).toBeLessThanOrEqual(2);
  expect(b!.y, `B below A in ${state}@${w}`).toBeGreaterThanOrEqual(a!.y + a!.height - 1);
  // The row — whichever way it is laid out — starts below B.
  expect(c!.y, `C below B in ${state}@${w}`).toBeGreaterThanOrEqual(b!.y + b!.height - 1);
  expect(d!.y, `D below B in ${state}@${w}`).toBeGreaterThanOrEqual(b!.y + b!.height - 1);

  if (w < MD_BREAKPOINT) {
    // Stacked: C then D, sharing the left edge; the transcript keeps a readable width.
    expect(d!.y, `D below C in ${state}@${w}`).toBeGreaterThanOrEqual(c!.y + c!.height - 1);
    expect(Math.abs(d!.x - a!.x), `D shares the left edge in ${state}@${w}`).toBeLessThanOrEqual(2);
    expect(c!.width, `transcript full-width in ${state}@${w}`).toBeGreaterThan(w * 0.8);
  } else {
    // Two columns under B: C starts at the left edge, D is the 310px rail beside it, both on one row.
    expect(Math.abs(c!.x - a!.x), `C at the left edge in ${state}@${w}`).toBeLessThanOrEqual(2);
    expect(Math.abs(d!.width - 310), `D is the 310px rail in ${state}@${w}`).toBeLessThanOrEqual(1);
    expect(d!.x, `D right of C in ${state}@${w}`).toBeGreaterThan(c!.x + c!.width - 2);
    expect(Math.abs(d!.y - c!.y), `C and D share a row in ${state}@${w}`).toBeLessThanOrEqual(1);
    expect(Math.abs(d!.x + d!.width - (a!.x + a!.width)), `D ends at A's right edge in ${state}@${w}`).toBeLessThanOrEqual(2);
  }
}

test.describe('G1 — the session slot map holds in a real browser', () => {
  test('Open Mic before/during/after: slot map and no overflow at every supported width', async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });

    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await settleViewport(page, 375);
    await navigateToRoute(page, '/session');

    // ---- BEFORE ---- full layout contract at every width (all four slots present + stable).
    await expect(page.getByTestId('mic-start')).toBeVisible();
    await expect(page.locator('[data-testid="session-shell"][data-session-state="before"]')).toBeVisible();
    for (const w of ALL_WIDTHS) {
      await assertSlotMap(page, w, 'before');
      await assertMicTextClearOfStatus(page, `before@${w}`);
    }
    await settleViewport(page, 375);
    await page.screenshot({ path: `${DIR}/before-phone-375.png`, fullPage: true });
    await settleViewport(page, 1280);
    await page.screenshot({ path: `${DIR}/before-desktop-1280.png`, fullPage: true });

    // ---- DURING ---- no width may overflow while live.
    await settleViewport(page, 375);
    await startRecording(page);
    await simulateTranscription(page, 'mobile session transcript stays readable while stacked on a phone', true);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 15_000 });
    for (const w of ALL_WIDTHS) {
      await assertSlotMap(page, w, 'during');
    }

    // ---- AFTER ---- save, settle, then re-sweep every width.
    await settleViewport(page, 375);
    await page.waitForTimeout(5_200); // clear the sub-5s no-persist guard
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    for (const w of ALL_WIDTHS) {
      await assertSlotMap(page, w, 'after');
    }

    // #1255 RETURN — the waveform must not be CLIPPED at 320px (a late filler marker sits at the right edge).
    // S-9/S-11: `after` shows the run as a static shape (`run-shape`, no transport), built from 2px hairlines
    // whose count is derived from the track width — so at the narrowest phone the FIRST and LAST lines must
    // both sit inside the visible track, and the lines must be hairlines rather than grown blocks.
    await settleViewport(page, 320);
    const waveform = page.getByTestId('run-shape-waveform');
    const lines = page.getByTestId('run-shape-waveform-line');
    // The run must keep real room on the narrowest phone — the legend wraps rather than squeezing it.
    await expect.poll(async () => (await waveform.boundingBox())?.width ?? 0, { message: 'track keeps its floor width' })
      .toBeGreaterThanOrEqual(96);
    // Density is derived from the track, never a hardcoded count: floor(trackWidth / 4). The spec re-measures on
    // a ~100ms debounced ResizeObserver, so poll until the count has followed the resize.
    await expect.poll(async () => {
      const box = await waveform.boundingBox();
      const n = await lines.count();
      return n > 0 && box !== null && n <= Math.floor(box.width / 4);
    }, { message: 'line count follows the track width' }).toBe(true);
    const track = await waveform.boundingBox();
    const count = await lines.count();
    const first = await lines.first().boundingBox();
    const last = await lines.nth(count - 1).boundingBox();
    expect(first!.width, 'lines are 2px hairlines, not grown blocks').toBeLessThanOrEqual(2.5);
    expect(first!.x, 'first line within track (left)').toBeGreaterThanOrEqual(track!.x - 1);
    expect(last!.x + last!.width, 'last line within track (right)').toBeLessThanOrEqual(track!.x + track!.width + 1);
  });

  // F-1 / F-2 — Focus Points on the SAME map: its coaching band exists in slot B, and its rail states the
  // plan rather than a zero score before the run.
  test('Focus Points before: slot map holds and the rail states the plan, not 0/N', async ({ page }) => {
    test.setTimeout(120_000);
    mkdirSync(DIR, { recursive: true });

    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await settleViewport(page, 375);
    await navigateToRoute(page, '/practice');

    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
    await page.getByTestId('objective-point-label-0').fill('Name the price');
    await page.getByTestId('objective-point-label-1').fill('State the guarantee');
    await page.getByTestId('objective-setup-submit').click();
    await page.waitForURL('**/session');
    await expect(page.locator('[data-testid="session-shell"][data-session-state="before"]')).toBeVisible();

    // F-1: the coaching band is present in Focus Points too.
    await expect(page.getByTestId('session-slot-b').getByText('Tips appear as you speak.')).toBeVisible();

    // The rail holds the plan above the points.
    const rail = page.getByTestId('session-slot-d');
    await expect(rail.getByTestId('coverage-pace')).toBeVisible();
    await expect(rail.getByTestId('focus-points-rail')).toBeVisible();
    await expect(rail.getByTestId('coverage-pace-plan')).toContainText('2 points');
    // F-2 / G4: no score before a run.
    await expect(page.getByTestId('coverage-pace-count'), 'no 0/N scoreboard before a run').toHaveCount(0);
    await expect(page.getByTestId('coverage-pace-perpoint'), 'no measured pace before a run').toHaveCount(0);
    await expect(page.getByTestId('coverage-pace-bar'), 'no pace bar before a run').toHaveCount(0);
    const planTop = (await rail.getByTestId('coverage-pace').boundingBox())!.y;
    const pointsTop = (await rail.getByTestId('focus-points-rail').boundingBox())!.y;
    expect(planTop, 'Coverage & pace sits above Points to cover').toBeLessThan(pointsTop);

    for (const w of ALL_WIDTHS) {
      await assertSlotMap(page, w, 'focus-before');
    }

    // Sanitized proof screenshots at one phone (390) and one desktop (1440) width, vs the G5 mockup.
    await settleViewport(page, 390);
    await page.screenshot({ path: `${DIR}/focus-before-phone-390.png`, fullPage: true });
    await settleViewport(page, 1440);
    await page.screenshot({ path: `${DIR}/focus-before-desktop-1440.png`, fullPage: true });
  });
});
