import { test } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 harness probe (diagnostic; removed before merge). Shard logs name no test, so each probe stops the flow in its own
 * shard. Red here means the short next take did not leave the page at rest, or Open Mic did not offer Start.
 * Run 43997164070 showed the old flow chose Open Mic from the Focus review, which never offers Start; the live journey
 * reaches the switch from the session page at rest (next Start without a hold), and the flow now does the same.
 */
test.describe('#1882 Focus switch flow: Open Mic offers Start from rest', () => {
  test('Open Mic shows Start after the Focus take and the short next take', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    await runFocusSwitchFlow(page, testInfo, 'open-mic-ready');
  });
});
