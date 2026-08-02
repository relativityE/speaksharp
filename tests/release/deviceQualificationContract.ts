/**
 * #1144 dependency-neutral qualification contract.
 *
 * This file defines what must be measured without pretending that dependency-owned
 * Product Value assertions already pass. A completed release row is admissible only
 * when every required cell is observed on one exact release SHA. A blocked row names
 * the open issue that owns the missing behavior.
 */

export const DEVICE_VIEWPORTS = [
  { key: 'phone-portrait', width: 320, height: 844, orientation: 'portrait' },
  { key: 'phone-landscape', width: 844, height: 320, orientation: 'landscape' },
  { key: 'tablet-portrait', width: 768, height: 1024, orientation: 'portrait' },
  { key: 'tablet-landscape', width: 1024, height: 768, orientation: 'landscape' },
  { key: 'desktop', width: 1280, height: 800, orientation: 'landscape' },
] as const;

export const DEVICE_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;

export const DEVICE_CAPABILITY_STATES = [
  'shared-array-buffer-available',
  'shared-array-buffer-unavailable',
  'microphone-granted',
  'microphone-denied',
  'microphone-dismissed',
  'offline-before-model-load',
  'offline-during-model-load',
  'worker-failure',
  'cold-model-cache',
  'warm-model-cache',
] as const;

export const DEVICE_ACCESSIBILITY_ASSERTIONS = [
  'keyboard-only',
  'focus-order',
  'focus-return',
  'accessible-names',
  'live-regions',
  'contrast',
  'zoom-200',
  'no-horizontal-overflow',
] as const;

export const DEVICE_PERFORMANCE_METRICS = [
  'time-to-interactive-ms',
  'private-model-download-ms',
  'private-model-load-ms',
  'private-model-warmup-ms',
  'recording-start-ms',
  'stop-to-final-transcript-ms',
  'finalize-to-durable-save-ms',
  'review-render-ms',
  'linked-repeat-handoff-ms',
] as const;

export const DEVICE_DEPENDENCY_GATES = {
  privatePrimaryCloudOff: 1120,
  honestReviewLoop: 1047,
  guidedRehearsal: 1046,
  cradleToGraveJourney: 1143,
} as const;

export type DeviceBrowser = typeof DEVICE_BROWSERS[number];
export type DeviceCapabilityState = typeof DEVICE_CAPABILITY_STATES[number];
export type DeviceAccessibilityAssertion = typeof DEVICE_ACCESSIBILITY_ASSERTIONS[number];
export type DevicePerformanceMetric = typeof DEVICE_PERFORMANCE_METRICS[number];

export interface DeviceQualificationRow {
  releaseSha: string;
  browser: DeviceBrowser;
  browserVersion: string;
  os: string;
  deviceClass: string;
  viewport: { width: number; height: number; orientation: 'portrait' | 'landscape' };
  capabilityState: DeviceCapabilityState;
  status: 'passed' | 'failed' | 'blocked';
  blockingIssue: number | null;
  assertions: Record<DeviceAccessibilityAssertion, boolean | null>;
  metrics: Record<DevicePerformanceMetric, number | null>;
  noAutomaticModelDownload: boolean;
  noAutomaticRecordingStart: boolean;
  cloudProviderCalls: number;
}

const FULL_SHA = /^[0-9a-f]{40}$/i;

export function deviceQualificationProblems(row: DeviceQualificationRow): string[] {
  const problems: string[] = [];

  if (!FULL_SHA.test(row.releaseSha)) problems.push('releaseSha must be a full 40-character SHA');
  if (!DEVICE_BROWSERS.includes(row.browser)) problems.push(`unsupported browser: ${String(row.browser)}`);
  if (!row.browserVersion.trim()) problems.push('browserVersion is required');
  if (!row.os.trim()) problems.push('os is required');
  if (!row.deviceClass.trim()) problems.push('deviceClass is required');
  if (!DEVICE_CAPABILITY_STATES.includes(row.capabilityState)) {
    problems.push(`unsupported capabilityState: ${String(row.capabilityState)}`);
  }
  if (!(row.viewport.width > 0 && row.viewport.height > 0)) problems.push('viewport dimensions must be positive');
  const derivedOrientation = row.viewport.width > row.viewport.height ? 'landscape' : 'portrait';
  if (row.viewport.orientation !== derivedOrientation) problems.push('viewport orientation contradicts its dimensions');
  if (!['passed', 'failed', 'blocked'].includes(row.status)) problems.push(`unsupported status: ${String(row.status)}`);

  if (row.status === 'blocked') {
    if (!Number.isInteger(row.blockingIssue) || Number(row.blockingIssue) <= 0) {
      problems.push('blocked rows must name a positive blockingIssue');
    }
  } else if (row.blockingIssue !== null) {
    problems.push('non-blocked rows must not carry blockingIssue');
  }

  for (const key of DEVICE_ACCESSIBILITY_ASSERTIONS) {
    const value = row.assertions[key];
    if (!(typeof value === 'boolean' || value === null)) problems.push(`assertions.${key} must be boolean or null`);
    if (row.status === 'passed' && value !== true) problems.push(`passed row lacks assertions.${key}`);
  }

  for (const key of DEVICE_PERFORMANCE_METRICS) {
    const value = row.metrics[key];
    if (!(value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0))) {
      problems.push(`metrics.${key} must be a non-negative number or null`);
    }
  }

  if (row.status === 'passed' && row.noAutomaticModelDownload !== true) {
    problems.push('passed row must prove no automatic model download');
  }
  if (row.status === 'passed' && row.noAutomaticRecordingStart !== true) {
    problems.push('passed row must prove no automatic recording start');
  }
  if (!Number.isInteger(row.cloudProviderCalls) || row.cloudProviderCalls < 0) {
    problems.push('cloudProviderCalls must be a non-negative integer');
  }
  if (row.status === 'passed' && row.cloudProviderCalls !== 0) {
    problems.push('passed row must prove zero Cloud-provider calls');
  }

  return problems;
}

