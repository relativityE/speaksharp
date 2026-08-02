import { describe, expect, it } from 'vitest';
import {
  DEVICE_ACCESSIBILITY_ASSERTIONS,
  DEVICE_BROWSERS,
  DEVICE_CAPABILITY_STATES,
  DEVICE_DEPENDENCY_GATES,
  DEVICE_PERFORMANCE_METRICS,
  DEVICE_VIEWPORTS,
  devicePerformanceDistributions,
  deviceQualificationDisposition,
  deviceQualificationProblems,
  deviceQualificationReportProblems,
  type DeviceQualificationReport,
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
  capabilities: {
    hardwareConcurrency: 4,
    deviceMemoryGb: 8,
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    webGpuAvailable: false,
    browserSpeechAvailable: true,
  },
  status: 'passed',
  blockingIssue: null,
  unavailableReason: null,
  assertions: { ...assertions },
  metrics: { ...metrics },
  noAutomaticModelDownload: true,
  noAutomaticRecordingStart: true,
  cloudProviderCalls: 0,
});

const fullMatrixRows = (): DeviceQualificationRow[] => DEVICE_BROWSERS.flatMap(browser =>
  DEVICE_VIEWPORTS.flatMap(viewport => DEVICE_CAPABILITY_STATES.map(capabilityState => ({
    ...validRow(),
    browser,
    viewport: { width: viewport.width, height: viewport.height, orientation: viewport.orientation },
    capabilityState,
  }))));

const report = (rows: DeviceQualificationRow[]): DeviceQualificationReport => ({
  schemaVersion: 1,
  releaseSha: 'a'.repeat(40),
  rows,
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
      'low-memory-failure',
      'worker-failure',
      'browser-speech-unavailable',
      'cold-model-cache',
      'warm-model-cache',
    ]));
    expect(DEVICE_ACCESSIBILITY_ASSERTIONS).toContain('css-zoom-200-simulation');
    expect(DEVICE_ACCESSIBILITY_ASSERTIONS).not.toContain('zoom-200');
    expect(DEVICE_ACCESSIBILITY_ASSERTIONS).toContain('focus-trap-escape');
    expect(DEVICE_ACCESSIBILITY_ASSERTIONS).toContain('error-announcements');
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
    expect(deviceQualificationProblems(row).join('\n')).toContain('approved dependency issue');
  });

  it('rejects a forged blocking issue outside the declared dependency gates', () => {
    const row = validRow();
    row.status = 'blocked';
    row.blockingIssue = 999999;
    expect(deviceQualificationProblems(row).join('\n')).toContain('approved dependency issue');
  });

  it('rejects a passed row with no observed latency for a required metric', () => {
    const row = validRow();
    row.metrics['private-model-load-ms'] = null;
    expect(deviceQualificationProblems(row)).toContain('passed row lacks observed metrics.private-model-load-ms');
  });

  it('requires an explicit reason for unavailable capability cells', () => {
    const row = validRow();
    row.status = 'unavailable';
    row.capabilityState = 'browser-speech-unavailable';
    expect(deviceQualificationProblems(row)).toContain('unavailable rows must name an unavailableReason');

    row.unavailableReason = 'system browser does not expose Web Speech';
    row.assertions['error-announcements'] = null;
    expect(deviceQualificationProblems(row)).toEqual([]);
  });

  it('never aggregates blocked, unavailable, invalid, or failed rows into green', () => {
    expect(deviceQualificationDisposition(report(fullMatrixRows()))).toBe('passed');

    const unavailableRows = fullMatrixRows();
    const unavailable = unavailableRows[0];
    unavailable.status = 'unavailable';
    unavailable.unavailableReason = 'capability is not provided';
    expect(deviceQualificationDisposition(report(unavailableRows))).toBe('unavailable');

    const blockedRows = fullMatrixRows();
    const blocked = blockedRows[0];
    blocked.status = 'blocked';
    blocked.blockingIssue = 1120;
    expect(deviceQualificationDisposition(report(blockedRows))).toBe('blocked');

    const failedRows = fullMatrixRows();
    const failed = failedRows[0];
    failed.status = 'failed';
    expect(deviceQualificationDisposition(report(failedRows))).toBe('failed');

    const invalidRows = fullMatrixRows();
    const invalid = invalidRows[0];
    invalid.releaseSha = 'short';
    expect(deviceQualificationDisposition(report(invalidRows))).toBe('failed');
  });

  it('rejects a partial matrix even when its only row is individually valid', () => {
    const problems = deviceQualificationReportProblems(report([validRow()]));
    expect(problems.join('\n')).toContain('report missing 179 required browser/viewport/capability cells');
    expect(deviceQualificationDisposition(report([validRow()]))).toBe('failed');
  });

  it('rejects mixed release identities and duplicate cells', () => {
    const row = validRow();
    const duplicate = validRow();
    duplicate.releaseSha = 'b'.repeat(40);
    const problems = deviceQualificationReportProblems(report([row, duplicate]));
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('releaseSha differs'),
      expect.stringContaining('duplicate qualification cell'),
    ]));
  });

  it('computes content-free p50/p95 only from passed observations', () => {
    const rows = [1, 10, 20, 30, 100].map((time) => {
      const row = validRow();
      row.metrics['time-to-interactive-ms'] = time;
      row.deviceClass = `device-${time}`;
      return row;
    });
    const blocked = validRow();
    blocked.status = 'blocked';
    blocked.blockingIssue = 1047;
    blocked.metrics['time-to-interactive-ms'] = 9999;
    rows.push(blocked);

    expect(devicePerformanceDistributions(rows)['time-to-interactive-ms']).toEqual({
      observed: 5,
      p50: 20,
      p95: 100,
    });
  });
});
