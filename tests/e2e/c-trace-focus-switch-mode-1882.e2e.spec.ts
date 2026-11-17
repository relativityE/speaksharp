import { test } from './fixtures';
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 step probe 1 of 3 (diagnostic; removed before merge). Shard logs name no test, so each probe stops the shared
 * flow at a different step in its own shard: red here means login, the first set or the first Focus take failed.
 */
test.describe('#1882 Focus switch flow, step 1', () => {
  test('the first Focus take saves and reaches its review', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    await runFocusSwitchFlow(page, testInfo, 'first-focus-take');
  });
});
