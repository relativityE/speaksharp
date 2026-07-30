import { test, expect } from './helpers/deployedLiveTest';

/**
 * #1092 — deployed-live authenticated diagnostic for route-aware navigation active-state.
 *
 * TEST-ONLY. No runtime code. Runs against the REAL deployed production app via the approved
 * GitHub-hosted path (rc-gates.yml gate-3-dast, base_url=https://speaksharp-public.vercel.app),
 * authenticating with the GitHub-injected reusable Free/Basic account. It never prints, copies, or
 * mutates credentials, never mutates customer data, and never consumes one-time account state
 * (it only reads navigation state — it does not start a recording, save, or write anything).
 *
 * This is a TARGETED DIAGNOSTIC, not a full Gate 3 pass. It proves the six #1092 checks against the
 * deployed browser at desktop and mobile widths:
 *   1. exactly one mapped nav item is active;
 *   2. the visible landmark owns the correct aria-current="page";
 *   3. Home (/practice), Session (/session), Analytics (/analytics) resolve correctly;
 *   4. mobile navigation is absent on Session, nested/case/trailing-slash Session routes;
 *   5. navigation does not overlap or reflow;
 *   6. keyboard focus has a visible computed outline.
 */

const EMAIL =
  process.env.FREE_TEST_EMAIL ?? process.env.E2E_FREE_EMAIL ?? process.env.BASIC_TEST_EMAIL ?? process.env.E2E_BASIC_EMAIL;
const PASSWORD =
  process.env.FREE_TEST_PASSWORD ?? process.env.E2E_FREE_PASSWORD ?? process.env.BASIC_TEST_PASSWORD ?? process.env.E2E_BASIC_PASSWORD;

const EXPECTED_RELEASE = process.env.EXPECTED_RELEASE_SHA ?? '976f04f8';

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

test.describe('#1092 navigation active-page — deployed-live authenticated diagnostic', () => {
  test.skip(!EMAIL || !PASSWORD, 'Requires FREE_TEST_/BASIC_TEST_ account injected by GitHub Actions.');

  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/signin');
    await page.getByTestId('email-input').fill(EMAIL as string);
    await page.getByTestId('password-input').fill(PASSWORD as string);
    const login = page.waitForResponse(
      (r) => r.url().includes('/auth/v1/token') && r.request().method() === 'POST',
    );
    await page.getByTestId('sign-in-submit').click();
    expect((await login).status()).toBe(200);
    // authenticated shell present
    await page.getByTestId('nav-sign-out-button').waitFor({ state: 'visible', timeout: 20000 });
  });

  test('the deployed browser is serving the expected release', async ({ page }) => {
    const rel = await page.evaluate(() => (window as unknown as { __APP_RELEASE__?: string }).__APP_RELEASE__ ?? '');
    expect(rel).toContain(EXPECTED_RELEASE);
  });

  for (const vp of [{ name: 'desktop', ...DESKTOP, landmark: 'Primary' }, { name: 'mobile', ...MOBILE, landmark: 'Primary mobile' }]) {
    test(`${vp.name}: exactly one active item, correct aria-current, Home/Analytics resolve`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const c of [
        { path: '/practice', label: 'Home' },
        { path: '/analytics', label: 'Analytics' },
      ]) {
        await page.goto(c.path);
        await expect(page).toHaveURL(new RegExp(c.path.replace('/', '\\/')));
        const nav = page.getByRole('navigation', { name: vp.landmark });
        await expect(nav).toBeVisible();
        const current = nav.locator('[aria-current="page"]');
        await expect(current).toHaveCount(1); // checks 1 + 2
        await expect(current).toContainText(c.label); // check 3
      }
    });
  }

  test('desktop: Session resolves and is active; mobile: bottom bar suppressed on all Session variants', async ({ page }) => {
    // check 3 (Session) at desktop
    await page.setViewportSize(DESKTOP);
    await page.goto('/session');
    await expect(page).toHaveURL(/\/session/);
    const desk = page.getByRole('navigation', { name: 'Primary' });
    const deskCurrent = desk.locator('[aria-current="page"]');
    await expect(deskCurrent).toHaveCount(1);
    await expect(deskCurrent).toContainText('Session');

    // check 4: mobile bottom bar must be ABSENT on session + nested/case/trailing-slash
    await page.setViewportSize(MOBILE);
    for (const route of ['/session', '/session/', '/Session', '/session/abc123']) {
      await page.goto(route);
      await expect(page.getByRole('navigation', { name: 'Primary mobile' })).toHaveCount(0);
    }
  });

  test('check 5: no reflow between active and inactive items, and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/practice');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const geo = (testId: string) =>
      nav.getByTestId(testId).evaluate((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          h: Math.round(r.height),
          box: [s.paddingTop, s.paddingBottom, s.paddingLeft, s.paddingRight, s.fontSize, s.fontWeight].join('|'),
          ws: s.whiteSpace,
        };
      });
    const active = await geo('nav-home-link'); // active on /practice
    const inactive = await geo('nav-session-link'); // inactive
    expect(active.h).toBe(inactive.h); // same height → no vertical reflow
    expect(active.box).toBe(inactive.box); // identical padding/font → active state is colour-only
    expect(active.ws).toBe('nowrap'); // single line → no wrap
    const overflow = await nav.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1); // no horizontal overflow/overlap
  });

  test('check 6: nav item is focusable and the deployed CSS carries a real focus outline', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/practice');
    const item = page.getByRole('navigation', { name: 'Primary' }).getByTestId('nav-session-link');
    await item.focus();
    expect(await item.evaluate((el) => document.activeElement === el)).toBe(true);
    // Read the deployed same-origin stylesheet for a REAL outline on :focus-visible.
    const outlineRule = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // cross-origin sheet — skip
        }
        for (const r of Array.from(rules)) {
          const sel = (r as CSSStyleRule).selectorText;
          if (sel && sel.includes('.nav-item:focus-visible')) {
            const st = (r as CSSStyleRule).style;
            return st.getPropertyValue('outline') || st.getPropertyValue('outline-width') || '';
          }
        }
      }
      return '';
    });
    expect(outlineRule).toMatch(/\d+px/);
    expect(outlineRule).not.toMatch(/\b(none|0px)\b/);
  });
});
