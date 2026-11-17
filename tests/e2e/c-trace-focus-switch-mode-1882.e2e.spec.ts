import { test } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 step probe 1 of 4 (diagnostic; removed before merge). Run 43995026716 passed the first Focus take and failed in
 * the Open Mic step; shard logs name no test, so each probe stops that step at a different point in its own shard:
 * red here means the Products menu could not choose Open Mic from the Focus review.
 */
test.describe('#1882 Focus switch flow: Products → Open Mic after a completed Focus take', () => {
  test('the Products menu reaches Open Mic after a Focus take', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    await runFocusSwitchFlow(page, testInfo, 'open-mic-menu');
  });
});
