import { test } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 harness probe (diagnostic; removed before merge). Red here, with the Open Mic Start probe green, means the Open Mic
 * take did not record, save or reach its review.
 * Run 43997164070 showed the old flow chose Open Mic from the Focus review, which never offers Start; the live journey
 * reaches the switch from the session page at rest (next Start without a hold), and the flow now does the same.
 */
test.describe('#1882 Focus switch flow: the Open Mic take saves', () => {
  test('the Open Mic take saves and reaches its review', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    await runFocusSwitchFlow(page, testInfo, 'open-mic-take');
  });
});
