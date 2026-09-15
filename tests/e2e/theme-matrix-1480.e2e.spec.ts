/**
 * #1480 / PR #1481 — browser evidence for the site-wide visual-only theme migration (PM closure checklist item 5).
 *
 * Every required surface is captured at the responsive bands the checklist names, with reduced motion emulated, and
 * checked in a real browser for:
 *   - WCAG colour contrast (axe `color-contrast`, `link-in-text-block`) — these FAIL the test, because contrast is
 *     exactly what a colour migration can break;
 *   - horizontal overflow at every band, including 640px (200% zoom of a 1280px window) and 320px (400% reflow);
 *   - a visible keyboard focus indicator.
 * Every other axe finding is written to `axe-<surface>.json` beside the screenshots for PM inspection rather than
 * failing here: those rules are not colour decisions and predate this PR.
 *
 * States the CI e2e build cannot render, recorded rather than faked:
 *   - payments ENABLED: checkout surfaces need `VITE_PAYMENTS_ENABLED=true` AND a live Stripe key at build time;
 *   - `/design`: internal routes are off in production-mode builds.
 */
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { setupE2EMocks } from './mock-routes';
import {
  goToApp,
  mockLiveTranscript,
  navigateToRoute,
  programmaticLoginWithRoutes,
  simulateTranscription,
  startRecording,
  stopRecording,
} from './helpers';
import { TEST_IDS } from '../constants';
import { MOCK_TRANSCRIPTS } from './fixtures/mockData';

const SHOTS = 'test-results/theme-matrix-1480';
const BANDS = [
  { name: 'reflow-320', width: 320, height: 800 },
  { name: 'zoom200-640', width: 640, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 900 },
] as const;
const COLOUR_RULES = new Set(['color-contrast', 'link-in-text-block']);

async function settle(page: Page): Promise<void> {
  // Axe and screenshots inspect the resting state, never a transient animation frame.
  await page.waitForTimeout(600);
}

async function checkColourAndRecord(page: Page, surface: string): Promise<void> {
  await settle(page);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(
    `${SHOTS}/axe-${surface}.json`,
    JSON.stringify(
      result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target) })),
      null,
      2,
    ),
  );
  // Soft: one run must report EVERY colour defect on every surface, not stop at the first failing surface.
  const colour = result.violations
    .filter((v) => COLOUR_RULES.has(v.id))
    .flatMap((v) => v.nodes.map((n) => ({ rule: v.id, html: n.html.slice(0, 160), summary: n.failureSummary?.split('\n').slice(1).join(' ').trim() })));
  expect.soft(colour, `${surface}: colour violations\n${JSON.stringify(colour, null, 2)}`).toEqual([]);
}

async function captureBands(page: Page, surface: string): Promise<void> {
  for (const band of BANDS) {
    await page.setViewportSize({ width: band.width, height: band.height });
    await settle(page);
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect.soft(widths.document, `${surface} overflows horizontally at ${band.name}: ${JSON.stringify(widths)}`).toBeLessThanOrEqual(widths.viewport);
    await page.screenshot({ path: `${SHOTS}/${surface}-${band.name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

async function evidence(page: Page, surface: string): Promise<void> {
  await checkColourAndRecord(page, surface);
  await captureBands(page, surface);
}

test.describe('#1480 theme matrix — public, auth, legal, error and internal surfaces', () => {
  const PUBLIC_SURFACES = [
    { surface: 'landing', route: '/' },
    { surface: 'pricing-payments-closed', route: '/pricing' },
    { surface: 'auth-signin', route: '/auth/signin' },
    { surface: 'auth-signup', route: '/auth/signup' },
    { surface: 'auth-reset', route: '/auth/reset' },
    { surface: 'legal-terms', route: '/terms' },
    { surface: 'legal-privacy', route: '/privacy' },
    { surface: 'not-found', route: '/theme-matrix-1480-not-a-route' },
  ] as const;

  for (const { surface, route } of PUBLIC_SURFACES) {
    test(`${surface}: contrast, reflow and screenshots`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await setupE2EMocks(page, { userType: 'free' });
      await goToApp(page, route);
      await evidence(page, surface);
    });
  }

  test('ops-status (colours only): contrast, reflow and screenshots', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupE2EMocks(page, { userType: 'free' });
    const now = new Date().toISOString();
    const check = (name: string, status: 'pass' | 'warn' | 'fail' | 'skip') => ({
      name, status, label: name, icon: '•', question: `Is ${name} healthy?`, evidence: `${name} evidence`, nextAction: 'None', checkedAt: now,
    });
    await page.route('**/ops-health.summary.json', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: now,
        summary: { pass: 1, warn: 1, fail: 1, skip: 1 },
        verdict: 'Theme matrix fixture',
        checks: [check('Alpha', 'pass'), check('Bravo', 'warn'), check('Charlie', 'fail'), check('Delta', 'skip')],
      }),
    }));
    await goToApp(page, '/admin/ops-status');
    await evidence(page, 'ops-status');
  });

  test('keyboard focus is visibly indicated on the signed-out shell', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupE2EMocks(page, { userType: 'free' });
    await goToApp(page, '/');
    let indicator: { tag: string; outline: string; boxShadow: string } | null = null;
    for (let i = 0; i < 12 && !indicator; i += 1) {
      await page.keyboard.press('Tab');
      indicator = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || !/^(A|BUTTON|INPUT)$/.test(el.tagName)) return null;
        const style = getComputedStyle(el);
        return { tag: el.tagName, outline: `${style.outlineStyle} ${style.outlineWidth}`, boxShadow: style.boxShadow };
      });
    }
    expect(indicator, 'a focusable control received keyboard focus').not.toBeNull();
    const visible = !indicator!.outline.startsWith('none') || indicator!.boxShadow !== 'none';
    expect(visible, `focused ${indicator!.tag} shows an outline or ring: ${JSON.stringify(indicator)}`).toBe(true);
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/keyboard-focus-desktop-1280.png` });
  });
});

test.describe('#1480 theme matrix — authenticated product surfaces', () => {
  test('Practice home, Share Feedback and Analytics', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });

    await navigateToRoute(page, '/practice');
    await evidence(page, 'practice-home');

    await page.getByTestId('nav-report-issue-button').click();
    await expect(page.getByTestId('issue-report-description')).toBeVisible({ timeout: 10_000 });
    await evidence(page, 'share-feedback');
    await page.keyboard.press('Escape');

    await navigateToRoute(page, '/analytics');
    await evidence(page, 'analytics');
  });

  test('Open Mic session: before, during, and after with the review-unavailable state', async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/session');
    await evidence(page, 'open-mic-before');

    await startRecording(page);
    await mockLiveTranscript(page, MOCK_TRANSCRIPTS as unknown as string[]);
    await expect(page.getByTestId(TEST_IDS.LIVE_TRANSCRIPT)).toBeVisible({ timeout: 15_000 });
    await checkColourAndRecord(page, 'open-mic-during');
    await page.screenshot({ path: `${SHOTS}/open-mic-during-desktop-1280.png`, fullPage: true });
    await page.waitForTimeout(5_200); // clears the sub-5s no-persist guard
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });

    // In the mocked environment the review provider answers with a malformed body, so the honest settled state is
    // the review-unavailable card — the review-failed state this migration must keep legible.
    const reviewCard = page.getByTestId('ai-suggestions-card');
    await expect(reviewCard).toBeVisible({ timeout: 15_000 });
    await expect(reviewCard).not.toHaveAttribute('data-review-state', 'loading', { timeout: 20_000 });
    await evidence(page, 'open-mic-after-review-unavailable');
  });

  test('Focus Points: setup dialog, then session before, during and after', async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/practice');

    await page.getByTestId('practice-card-objective').click();
    await expect(page.getByTestId('objective-setup-dialog')).toBeVisible();
    await page.getByTestId('objective-goal-select').selectOption('Sales or product pitch');
    const labels = ['Name the price', 'State the guarantee', 'Explain the timeline'];
    for (let i = 0; i < labels.length; i += 1) {
      await page.getByTestId(`objective-point-label-${i}`).fill(labels[i]);
    }
    await evidence(page, 'focus-points-setup');
    await page.getByTestId('objective-setup-submit').click();

    await page.waitForURL('**/session');
    await expect(page.getByTestId('focus-points-rail')).toBeVisible();
    await evidence(page, 'focus-points-before');

    await startRecording(page);
    await simulateTranscription(page, 'First I will name the price clearly. Then I state the guarantee we offer.', true);
    await expect(page.locator('[data-testid="session-shell"][data-session-state="during"]')).toBeVisible({ timeout: 15_000 });
    await checkColourAndRecord(page, 'focus-points-during');
    await page.screenshot({ path: `${SHOTS}/focus-points-during-desktop-1280.png`, fullPage: true });
    await page.waitForTimeout(5_200);
    await stopRecording(page);
    await expect(page.locator('html')).toHaveAttribute('data-session-persisted', 'true', { timeout: 20_000 });
    await expect(page.locator('[data-testid="session-shell"][data-session-state="after"]')).toBeVisible({ timeout: 15_000 });
    await evidence(page, 'focus-points-after');
  });
});
