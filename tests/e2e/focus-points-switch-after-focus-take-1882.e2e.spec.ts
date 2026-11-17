import { test } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 step probe 2 of 3 (diagnostic; removed before merge): red here, with step 1 green, means Products → Open Mic
 * or the Open Mic take after a completed Focus take failed.
 */
test.describe('#1882 Focus switch flow, step 2', () => {
  test('Products → Open Mic after a Focus take records and saves an Open Mic take', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    await runFocusSwitchFlow(page, testInfo, 'open-mic-take');
  });
});
