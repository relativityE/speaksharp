import { test } from '@playwright/test'; // plain fixtures on purpose: lands this check in its own shard
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 step probe 4 of 4 (diagnostic; removed before merge). Run 43995026716 passed the first Focus take and failed in
 * the Open Mic step; shard logs name no test, so each probe stops that step at a different point in its own shard:
 * red here, with probe 3 green, means Stop did not save the Open Mic take or its review never appeared.
 */
test.describe('#1882 Focus switch flow: Open Mic take saves after a Focus take', () => {
  test('the Open Mic take after a Focus take saves and reaches its review', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    await runFocusSwitchFlow(page, testInfo, 'open-mic-take');
  });
});
