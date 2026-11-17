import { test, expect } from './fixtures';
import { POINTS, runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 product verdict: after Focus → Open Mic → Focus, the short switch take's review keeps its four rail rows
 * (point 1 covered) and offers Start a new set. The harness control and the trace checks run the same flow in
 * other shards, so a red here is the product, not the harness.
 */
test.describe('#1882 Focus switch after a completed Focus take', () => {
  test('the short switch take keeps its rail and offers Start a new set', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    const { switchTrace } = await runFocusSwitchFlow(page, testInfo);
    for (let i = 0; i < POINTS.length; i += 1) {
      await expect(page.getByTestId(`focus-point-${i}`), `switch take review row ${i}; trace ${JSON.stringify(switchTrace)}`).toBeVisible();
    }
    await expect(page.getByTestId('focus-point-0')).toHaveAttribute('data-status', 'covered');
    await expect(page.getByTestId('focus-points-new-set'), `trace ${JSON.stringify(switchTrace)}`).toBeVisible({ timeout: 30_000 });
  });
});
