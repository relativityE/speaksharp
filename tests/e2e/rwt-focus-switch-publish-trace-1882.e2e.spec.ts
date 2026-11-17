import { test, expect } from '@playwright/test'; // plain fixtures on purpose: lands this check in its own shard
import { POINTS, runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 product verdict: after Focus → Open Mic → Focus, the short switch take's review keeps its four rail rows
 * (point 1 covered) and offers Start a new set. The step probes and the harness control run the same flow in the
 * other shards, so a red here with all of them green is the product, not the harness. The failure message carries
 * the switch take's controller trace (states and counts only).
 */
test.describe('#1882 Focus switch after a completed Focus take', () => {
  test('the short switch take keeps its rail and offers Start a new set', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    const { switchTrace } = await runFocusSwitchFlow(page, testInfo);
    const trace = JSON.stringify(switchTrace);
    for (let i = 0; i < POINTS.length; i += 1) {
      await expect(page.getByTestId(`focus-point-${i}`), `switch take review row ${i}; trace ${trace}`).toBeVisible();
    }
    await expect(page.getByTestId('focus-point-0'), `trace ${trace}`).toHaveAttribute('data-status', 'covered');
    await expect(page.getByTestId('focus-points-new-set'), `trace ${trace}`).toBeVisible({ timeout: 30_000 });
  });
});
