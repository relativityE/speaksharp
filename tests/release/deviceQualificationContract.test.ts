import { describe, expect, it } from 'vitest';
import {
  DEVICE_ACCESSIBILITY_ASSERTIONS,
  DEVICE_BROWSERS,
  DEVICE_CAPABILITY_STATES,
  DEVICE_DEPENDENCY_GATES,
  DEVICE_PERFORMANCE_METRICS,
  DEVICE_VIEWPORTS,
  deviceQualificationProblems,
  type DeviceQualificationRow,
} from './deviceQualificationContract';

const assertions = Object.fromEntries(DEVICE_ACCESSIBILITY_ASSERTIONS.map(key => [key, true])) as DeviceQualificationRow['assertions'];
const metrics = Object.fromEntries(DEVICE_PERFORMANCE_METRICS.map(key => [key, 1])) as DeviceQualificationRow['metrics'];

const validRow = (): DeviceQualificationRow => ({
  releaseSha: 'a'.repeat(40),
  browser: 'chromium',
  browserVersion: '150.0.0',
  os: 'ubuntu-24.04',
  deviceClass: 'desktop-reference',
  viewport: { width: 1280, height: 800, orientation: 'landscape' },
  capabilityState: 'shared-array-buffer-available',
  status: 'passed',
  blockingIssue: null,
  assertions: { ...assertions },
  metrics: { ...metrics },
  noAutomaticModelDownload: true,
  noAutomaticRecordingStart: true,
  cloudProviderCalls: 0,
});

describe('#1144 device qualification contract', () => {
  it('locks the required browser, viewport, capability, accessibility, and performance matrices', () => {
    expect(DEVICE_BROWSERS).toEqual(['chromium', 'firefox', 'webkit']);
    expect(DEVICE_VIEWPORTS.map(({ width }) => width)).toEqual(expect.arrayContaining([320, 768, 1280]));
    expect(DEVICE_VIEWPORTS.some(({ orientation }) => orientation === 'portrait')).toBe(true);
    expect(DEVICE_VIEWPORTS.some(({ orientation }) => orientation === 'landscape')).toBe(true);
    expect(DEVICE_CAPABILITY_STATES).toEqual(expect.arrayContaining([
      'shared-array-buffer-available',
      'shared-array-buffer-unavailable',
      'microphone-denied',
      'offline-during-model-load',
      'worker-failure',
      'cold-model-cache',
      'warm-model-cache',
    ]));
    expect(DEVICE_ACCESSIBILITY_ASSERTIONS).toContain('zoom-200');
    expect(DEVICE_PERFORMANCE_METRICS).toContain('linked-repeat-handoff-ms');
  });

  it('records dependency-owned gates instead of converting unavailable product behavior into a pass', () => {
    expect(DEVICE_DEPENDENCY_GATES).toEqual({
      privatePrimaryCloudOff: 1120,
      honestReviewLoop: 1047,
      guidedRehearsal: 1046,
      cradleToGraveJourney: 1143,
    });
    const row = validRow();
    row.status = 'blocked';
    row.blockingIssue = 1120;
    row.assertions['live-regions'] = null;
    expect(deviceQualificationProblems(row)).toEqual([]);
  });

  it('accepts a fully observed passed row', () => {
    expect(deviceQualificationProblems(validRow())).toEqual([]);
  });

  it.each([
    ['abbreviated SHA', (row: DeviceQualificationRow) => { row.releaseSha = 'abc123'; }, 'releaseSha'],
    ['missing accessibility proof', (row: DeviceQualificationRow) => { row.assertions['focus-return'] = null; }, 'focus-return'],
    ['automatic model download', (row: DeviceQualificationRow) => { row.noAutomaticModelDownload = false; }, 'automatic model download'],
    ['automatic recording', (row: DeviceQualificationRow) => { row.noAutomaticRecordingStart = false; }, 'automatic recording start'],
    ['Cloud call', (row: DeviceQualificationRow) => { row.cloudProviderCalls = 1; }, 'zero Cloud-provider calls'],
    ['negative timing', (row: DeviceQualificationRow) => { row.metrics['time-to-interactive-ms'] = -1; }, 'time-to-interactive-ms'],
    ['wrong orientation', (row: DeviceQualificationRow) => { row.viewport.orientation = 'portrait'; }, 'orientation'],
  ])('rejects a false green: %s', (_label, mutate, expected) => {
    const row = validRow();
    mutate(row);
    expect(deviceQualificationProblems(row).join('\n')).toContain(expected);
  });

  it('rejects a blocked row with no authoritative dependency', () => {
    const row = validRow();
    row.status = 'blocked';
    expect(deviceQualificationProblems(row)).toContain('blocked rows must name a positive blockingIssue');
  });
});

