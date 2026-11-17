import { test, expect } from '@playwright/test'; // plain fixtures on purpose: lands this check in its own shard
import { runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 trace check (diagnostic; removed before merge): the switch take must publish its completed brief, which is
 * the only source of the after rail once the active brief retires. Red here names the cause: the publication was
 * refused or the take returned early (unresolved).
 */
test.describe('#1882 Focus switch trace: completed brief published', () => {
  test('the switch take publishes its completed brief and never returns unresolved', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    const { switchTrace } = await runFocusSwitchFlow(page, testInfo);
    const view = switchTrace
      .filter((e) => ['controller_completed_brief', 'controller_progress_unresolved', 'controller_progress_publication_refused'].includes(String(e.event)))
      .map((e) => (e.event === 'controller_completed_brief' ? `published:${e.published}` : `${e.event}:${e.reason ?? ''}`));
    expect(view, JSON.stringify(switchTrace)).toEqual(['published:true']);
  });
});
