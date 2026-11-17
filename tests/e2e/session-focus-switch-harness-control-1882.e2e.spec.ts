import { test, expect } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 harness control (diagnostic; removed before merge). Same flow as the product verdict spec, but it judges
 * only the harness: three takes saved, each review reached, the switch take traced. Green here and red on the
 * verdict spec means the bug reproduced; red here means the harness, not the product.
 */
test.describe('#1882 Focus switch flow harness control', () => {
  test('three takes save and the switch take is traced', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    const { switchTrace } = await runFocusSwitchFlow(page, testInfo);
    expect(switchTrace.some((e) => e.event === 'controller_progress_mode_snapshot'), JSON.stringify(switchTrace)).toBe(true);
  });
});
