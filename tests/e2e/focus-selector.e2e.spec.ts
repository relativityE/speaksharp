/**
 * PR 2 — Analytics Focus selector trigger UX.
 *
 * The trigger must be a clearly-labeled, discoverable dropdown (not a vague
 * "Change Focus" gear): label "Choose focus", a chevron affordance, a stable
 * data-testid (so tests are not coupled to the label), and it opens the focus
 * options. Trigger-only change; focus logic unchanged.
 */
import { test, expect } from './fixtures';
import { navigateToRoute, programmaticLoginWithRoutes, waitForFeature } from './helpers';

test.describe('Analytics focus selector trigger', () => {
  test('reads "Choose focus", is discoverable, and opens the focus options', async ({ page }) => {
    await programmaticLoginWithRoutes(page, { userType: 'pro' });
    await navigateToRoute(page, '/analytics');
    await waitForFeature(page, 'analytics');

    const trigger = page.getByTestId('analytics-focus-trigger');
    await expect(trigger).toBeVisible();
    await expect(trigger).toContainText(/choose focus/i);
    await expect(trigger).not.toContainText(/change focus/i);
    await trigger.screenshot({ path: 'test-results/focus-trigger-after.png' });

    // Opens the focus options.
    await trigger.click();
    await expect(page.getByText('Choose what you want to improve')).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /speak clearly/i })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /sound confident/i })).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: /track progress/i })).toBeVisible();
    await page.screenshot({ path: 'test-results/focus-dropdown-open.png' });
  });
});
