import { test, expect } from './fixtures';
import { POINTS, runFocusSwitchFlow, SWITCH_FLOW_TIMEOUT_MS } from './focusSwitch1882Flow';

/**
 * #1882 trace check (diagnostic; removed before merge): the switch take must be recorded as a Focus take with all
 * four points, decided at Start. Red here names the cause: the take started with no active brief (Open Mic mode).
 */
test.describe('#1882 Focus switch trace: mode at Start', () => {
  test('the switch take starts as focus_points with four points', async ({ page }, testInfo) => {
    test.setTimeout(SWITCH_FLOW_TIMEOUT_MS);
    const { switchTrace } = await runFocusSwitchFlow(page, testInfo);
    const snapshots = switchTrace.filter((e) => e.event === 'controller_progress_mode_snapshot');
    expect(snapshots.map((e) => `${e.mode}:${e.pointCount}`), JSON.stringify(switchTrace)).toEqual([`focus_points:${POINTS.length}`]);
  });
});
