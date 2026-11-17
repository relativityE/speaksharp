import { test } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 step probe 3 of 4 (diagnostic; removed before merge). Run 43995026716 passed the first Focus take and failed in
 * the Open Mic step; shard logs name no test, so each probe stops that step at a different point in its own shard:
 * red here, with probe 2 green, means Start did not reach recording.
 */
test.describe('#1882 Focus switch flow: Open Mic records after a Focus take', () => {
  test('Start records an Open Mic take after a completed Focus take', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    await runFocusSwitchFlow(page, testInfo, 'open-mic-recording');
  });
});
