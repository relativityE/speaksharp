import { test, expect } from './helpers/deployedLiveTest';

/**
 * #1094 — deployed-live authenticated READ-ONLY Session smoke (route-into-Ready state only).
 *
 * TEST-ONLY. No runtime code. Runs against the REAL deployed production app via the approved
 * GitHub-hosted path (rc-gates.yml gate-3-dast, base_url=https://speaksharp-public.vercel.app),
 * authenticating with the GitHub-injected reusable Free/Basic account.
 *
 * READ-ONLY: it navigates to /session and asserts the pre-record ("Ready") surface. It NEVER starts
 * a recording, creates a session, saves, or writes any production data, and never consumes one-time
 * account state. The six completed/finalizing filler states are proven by exact-head E2E, NOT here.
 *
 * Asserts the approved #1047 Session reference in the at-rest state:
 *   - original orange microphone button + glyph;
 *   - "Progress" naming (never "SpeakSharp Progress");
 *   - dark-green help island;
 *   - Ready timer reads 00:00 (idle);
 *   - compact empty transcript;
 *   - collapsed pre-record filler row;
 *   - "Add your filler words" affordance;
 *   - no nav/Session CSS overlap or horizontal reflow (desktop + mobile).
 */

const EMAIL =
  process.env.FREE_TEST_EMAIL ?? process.env.E2E_FREE_EMAIL ?? process.env.BASIC_TEST_EMAIL ?? process.env.E2E_BASIC_EMAIL;
const PASSWORD =
  process.env.FREE_TEST_PASSWORD ?? process.env.E2E_FREE_PASSWORD ?? process.env.BASIC_TEST_PASSWORD ?? process.env.E2E_BASIC_PASSWORD;

const EXPECTED_RELEASE = process.env.EXPECTED_RELEASE_SHA ?? 'bc3dd2ad';

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

// Parse "rgb(r, g, b)" / "rgba(r, g, b, a)" → [r,g,b].
function rgb(s: string): [number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/i);
  const parts = (m ? m[1] : s).split(',').map((x) => parseFloat(x.trim()));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

test.describe('#1094 Session simplify — deployed-live authenticated READ-ONLY smoke', () => {
  test.skip(!EMAIL || !PASSWORD, 'Requires FREE_TEST_/BASIC_TEST_ account injected by GitHub Actions.');

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/signin');
    await page.getByTestId('email-input').fill(EMAIL as string);
    await page.getByTestId('password-input').fill(PASSWORD as string);
    const login = page.waitForResponse((r) => r.url().includes('/auth/v1/token') && r.request().method() === 'POST');
    await page.getByTestId('sign-in-submit').click();
    expect((await login).status()).toBe(200);
    await page.getByTestId('nav-sign-out-button').waitFor({ state: 'visible', timeout: 20000 });
    // Read-only navigation into the Session page (NO recording started).
    await page.goto('/session');
    await page.getByTestId('session-page').waitFor({ state: 'visible', timeout: 20000 });
  });

  test('the deployed browser is serving the expected release', async ({ page }) => {
    const rel = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? '');
    expect(rel).toContain(EXPECTED_RELEASE);
  });

  test('orange microphone button with its glyph (idle)', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const btn = page.getByTestId('session-start-stop-button');
    await expect(btn).toBeVisible();
    // Glyph present: an svg icon (Mic) inside the button.
    expect(await btn.locator('svg').count()).toBeGreaterThan(0);
    // Colour is the orange primary token, not a neutral/grey.
    const [r, g, b] = rgb(await btn.evaluate((el) => getComputedStyle(el).backgroundColor));
    expect(r).toBeGreaterThan(150); // strong red channel
    expect(r).toBeGreaterThan(g); // r > g > b → orange, not green/grey
    expect(g).toBeGreaterThan(b);
  });

  test('"Progress" naming — never "SpeakSharp Progress"', async ({ page }) => {
    const card = page.getByTestId('live-coaching-score-card');
    await expect(card).toBeVisible();
    // aria-label is the authoritative, exact naming check. The visible panel label is the
    // uppercased "PROGRESS", so the visible-text check is case-insensitive on purpose.
    await expect(card).toHaveAttribute('aria-label', 'Progress');
    await expect(card).toContainText(/progress/i);
    await expect(card).not.toContainText(/SpeakSharp Progress/i);
  });

  test('dark-green help island', async ({ page }) => {
    const help = page.getByTestId('freestyle-help-button');
    await expect(help).toBeVisible();
    const [r, g, b] = rgb(await help.evaluate((el) => getComputedStyle(el).backgroundColor));
    expect(g).toBeGreaterThan(r); // green dominates
    expect(g).toBeGreaterThan(b);
    expect(g).toBeLessThan(190); // "dark" green, not a bright/pale tint
  });

  test('Ready timer reads 00:00 and is idle', async ({ page }) => {
    const timer = page.getByTestId('session-timer');
    await expect(timer).toBeVisible();
    await expect(timer).toHaveText(/00:00/);
    await expect(timer).toHaveAttribute('data-timer-active', 'false');
  });

  test('compact empty transcript at rest', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    const panel = page.getByTestId('transcript-panel');
    await expect(panel).toBeVisible();
    // Compact: the at-rest panel is no longer a ~400px block. Bound it well under that.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect((box as { height: number }).height).toBeLessThan(320);
    // Empty: no real transcript text yet.
    await expect(panel).not.toContainText(/\w{20,}/);
  });

  test('collapsed pre-record filler row with "Add your filler words"', async ({ page }) => {
    const card = page.getByTestId('filler-words-card');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-filler-collapsed', 'true'); // collapsed pre-record
    await expect(card).toContainText('Add your filler words');
  });

  for (const vp of [{ name: 'desktop', ...DESKTOP }, { name: 'mobile', ...MOBILE }]) {
    test(`${vp.name}: no horizontal overflow and record button not covered (combined nav/Session CSS)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/session');
      await page.getByTestId('session-page').waitFor({ state: 'visible' });
      // No page-level horizontal reflow/overflow.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      // The record button is on-screen and not clipped/covered off the viewport.
      const btn = page.getByTestId('session-start-stop-button');
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      const { x, y, width, height } = box as { x: number; y: number; width: number; height: number };
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(vp.width + 1);
      expect(y + height).toBeLessThanOrEqual(vp.height + 1);
    });
  }
});
