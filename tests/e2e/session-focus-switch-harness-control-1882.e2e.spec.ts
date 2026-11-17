import { test, expect } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 step probe 3 of 3, the harness control (diagnostic; removed before merge). It runs the whole flow and judges
 * only the harness: the new set saves, the switch take saves and its review is reached, and the take is traced. Green
 * here and red on the verdict spec means the bug reproduced; red here means the harness, not the product.
 */
test.describe('#1882 Focus switch flow harness control', () => {
  test('the switch take saves, reaches its review and is traced', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    const { switchTrace } = await runFocusSwitchFlow(page, testInfo);
    expect(switchTrace.some((e) => e.event === 'controller_progress_mode_snapshot'), JSON.stringify(switchTrace)).toBe(true);
  });
});
