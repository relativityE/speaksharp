import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes } from './helpers';

/**
 * Homepage Render & Styling Gate (pre-handoff).
 *
 * A hard gate that the homepage actually COMES UP AS EXPECTED before any Dev candidate is handed to
 * the Test agent for browser proof. It runs against the production-like `serve:e2e` build
 * (frontend/dist) through the standard E2E fixtures/mocks, so it catches the two failure modes a
 * jsdom/component test cannot:
 *   1. the CSS/Tailwind pipeline not applying (page renders as raw/unstyled HTML), and
 *   2. the app failing to boot/route to visible landing content (e.g. wedged on a loader).
 *
 * IMPORTANT: it asserts on COMPUTED STYLES, not class-name presence. The regression this guards
 * against had the correct Tailwind class names in the DOM (bg-primary / rounded-xl / h-14) but ZERO
 * visual effect — checking `className` would have passed while the page was visibly broken.
 */
test.describe('Homepage render & styling gate (pre-handoff)', () => {
  test('homepage mounts, renders the hero, and Tailwind styling is applied', async ({ page }) => {
    // Boot the app through the standard harness contract (mocks + resolvable session), then land on
    // the public landing route (unguarded — renders regardless of auth).
    await programmaticLoginWithRoutes(page, { userType: 'free' });
    await navigateToRoute(page, '/');

    // (1) App booted past any loader and the landing hero rendered (not blank, not wedged).
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(heading).toContainText(/Public Impact/i);

    const cta = page.getByTestId('start-free-session-button');
    await expect(cta).toBeVisible();

    // (2) Tailwind actually took VISUAL effect on the primary CTA (default button = bg-primary,
    //     rounded-xl, h-14 via size="lg"). Unstyled => transparent bg, 0px radius, ~auto height.
    const ctaStyle = await cta.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        radiusPx: parseFloat(cs.borderTopLeftRadius || '0'),
        heightPx: parseFloat(cs.height || '0'),
      };
    });
    expect(ctaStyle.backgroundColor).not.toBe('rgba(0, 0, 0, 0)'); // bg-primary applied (not transparent)
    expect(ctaStyle.backgroundColor).not.toBe('transparent');
    expect(ctaStyle.radiusPx).toBeGreaterThan(0);                  // rounded-xl applied
    expect(ctaStyle.heightPx).toBeGreaterThan(40);                 // h-14 (56px) applied, not unstyled default

    // (3) The hero headline renders at a large display size (text-5xl+ / lg:text-[72px]).
    //     With Tailwind off it falls back to the ~32px browser default for <h1>.
    const headingFontPx = await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize || '0'));
    expect(headingFontPx).toBeGreaterThan(40);
  });
});
