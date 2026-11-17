import { test } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 harness control (diagnostic; removed before merge). Runs the whole flow with no product verdict: green here with the
 * verdict spec red means the product, not the harness.
 * Run 43997164070 showed the old flow chose Open Mic from the Focus review, which never offers Start; the live journey
 * reaches the switch from the session page at rest (next Start without a hold), and the flow now does the same.
 */
test.describe('#1882 Focus switch flow: harness control', () => {
  test('the whole switch flow runs and the switch take saves', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    await runFocusSwitchFlow(page, testInfo, 'switch-take');
  });
});
