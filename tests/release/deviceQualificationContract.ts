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
  'low-memory-failure',
  'worker-failure',
  'browser-speech-unavailable',
  'cold-model-cache',
  'warm-model-cache',
] as const;

export const DEVICE_ACCESSIBILITY_ASSERTIONS = [
  'keyboard-only',
  'visible-focus',
  'focus-order',
  'focus-return',
  'focus-trap-escape',
  'accessible-names',
  'live-regions',
  'error-announcements',
  'contrast',
  'reflow',
  // Automated CSS zoom is a reflow simulation, not proof that the browser's
  // native 200% zoom control was exercised. Native browser zoom remains a
  // separate manual qualification gate outside this dependency-neutral lane.
  'css-zoom-200-simulation',
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
export type DeviceQualificationStatus = 'passed' | 'failed' | 'blocked' | 'unavailable';

export interface DeviceCapabilityMetadata {
  hardwareConcurrency: number | null;
  deviceMemoryGb: number | null;
  crossOriginIsolated: boolean | null;
  sharedArrayBufferAvailable: boolean;
  webGpuAvailable: boolean;
  browserSpeechAvailable: boolean;
}

export interface DeviceQualificationRow {
  releaseSha: string;
  browser: DeviceBrowser;
  browserVersion: string;
  os: string;
  deviceClass: string;
  viewport: { width: number; height: number; orientation: 'portrait' | 'landscape' };
  capabilityState: DeviceCapabilityState;
  capabilities: DeviceCapabilityMetadata;
  status: DeviceQualificationStatus;
  blockingIssue: number | null;
  unavailableReason: string | null;
  assertions: Record<DeviceAccessibilityAssertion, boolean | null>;
  metrics: Record<DevicePerformanceMetric, number | null>;
  noAutomaticModelDownload: boolean;
  noAutomaticRecordingStart: boolean;
  cloudProviderCalls: number;
}

export interface DeviceQualificationReport {
  schemaVersion: 1;
  releaseSha: string;
  rows: DeviceQualificationRow[];
}

export interface DevicePerformanceDistribution {
  observed: number;
  p50: number | null;
  p95: number | null;
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const DEVICE_DEPENDENCY_ISSUES = new Set<number>(Object.values(DEVICE_DEPENDENCY_GATES));

function requiredCellKey(
  browser: DeviceBrowser,
  viewport: DeviceQualificationRow['viewport'],
  capabilityState: DeviceCapabilityState,
): string {
  return [browser, viewport.width, viewport.height, viewport.orientation, capabilityState].join('|');
}

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
  if (!DEVICE_VIEWPORTS.some(viewport => viewport.width === row.viewport.width
    && viewport.height === row.viewport.height
    && viewport.orientation === row.viewport.orientation)) {
    problems.push('viewport is not in the required qualification matrix');
  }
  if (!['passed', 'failed', 'blocked', 'unavailable'].includes(row.status)) {
    problems.push(`unsupported status: ${String(row.status)}`);
  }

  if (!(row.capabilities.hardwareConcurrency === null
    || (Number.isInteger(row.capabilities.hardwareConcurrency) && row.capabilities.hardwareConcurrency > 0))) {
    problems.push('capabilities.hardwareConcurrency must be a positive integer or null');
  }
  if (!(row.capabilities.deviceMemoryGb === null
    || (typeof row.capabilities.deviceMemoryGb === 'number'
      && Number.isFinite(row.capabilities.deviceMemoryGb)
      && row.capabilities.deviceMemoryGb > 0))) {
    problems.push('capabilities.deviceMemoryGb must be a positive number or null');
  }
  for (const key of ['crossOriginIsolated', 'sharedArrayBufferAvailable', 'webGpuAvailable', 'browserSpeechAvailable'] as const) {
    const value = row.capabilities[key];
    if (!(typeof value === 'boolean' || (key === 'crossOriginIsolated' && value === null))) {
      problems.push(`capabilities.${key} must be ${key === 'crossOriginIsolated' ? 'boolean or null' : 'boolean'}`);
    }
  }
  if (row.capabilityState === 'shared-array-buffer-available'
    && row.capabilities.sharedArrayBufferAvailable !== true) {
    problems.push('shared-array-buffer-available contradicts capabilities.sharedArrayBufferAvailable');
  }
  if (row.capabilityState === 'shared-array-buffer-unavailable'
    && row.capabilities.sharedArrayBufferAvailable !== false) {
    problems.push('shared-array-buffer-unavailable contradicts capabilities.sharedArrayBufferAvailable');
  }
  if (row.capabilityState === 'browser-speech-unavailable'
    && row.capabilities.browserSpeechAvailable !== false) {
    problems.push('browser-speech-unavailable contradicts capabilities.browserSpeechAvailable');
  }

  if (row.status === 'blocked') {
    if (!Number.isInteger(row.blockingIssue) || !DEVICE_DEPENDENCY_ISSUES.has(Number(row.blockingIssue))) {
      problems.push(`blocked rows must name an approved dependency issue: ${[...DEVICE_DEPENDENCY_ISSUES].join(', ')}`);
    }
  } else if (row.blockingIssue !== null) {
    problems.push('non-blocked rows must not carry blockingIssue');
  }
  if (row.status === 'unavailable') {
    if (!row.unavailableReason?.trim()) problems.push('unavailable rows must name an unavailableReason');
  } else if (row.unavailableReason !== null) {
    problems.push('non-unavailable rows must not carry unavailableReason');
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
    if (row.status === 'passed' && value === null) {
      problems.push(`passed row lacks observed metrics.${key}`);
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

function percentile(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

export function devicePerformanceDistributions(rows: DeviceQualificationRow[]): Record<DevicePerformanceMetric, DevicePerformanceDistribution> {
  return Object.fromEntries(DEVICE_PERFORMANCE_METRICS.map((metric) => {
    const values = rows
      .filter(row => row.status === 'passed' && deviceQualificationProblems(row).length === 0)
      .map(row => row.metrics[metric])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    return [metric, {
      observed: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
    }];
  })) as Record<DevicePerformanceMetric, DevicePerformanceDistribution>;
}

export function deviceQualificationReportProblems(report: DeviceQualificationReport): string[] {
  const problems: string[] = [];
  if (report.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (!FULL_SHA.test(report.releaseSha)) problems.push('report releaseSha must be a full 40-character SHA');
  if (!Array.isArray(report.rows) || report.rows.length === 0) problems.push('report must contain at least one row');

  const identities = new Set<string>();
  const observedRequiredCells = new Set<string>();
  for (const [index, row] of report.rows.entries()) {
    for (const problem of deviceQualificationProblems(row)) problems.push(`rows[${index}]: ${problem}`);
    if (row.releaseSha !== report.releaseSha) problems.push(`rows[${index}]: releaseSha differs from report releaseSha`);
    const identity = [row.browser, row.browserVersion, row.os, row.deviceClass, row.viewport.width,
      row.viewport.height, row.capabilityState].join('|');
    if (identities.has(identity)) problems.push(`rows[${index}]: duplicate qualification cell`);
    identities.add(identity);
    observedRequiredCells.add(requiredCellKey(row.browser, row.viewport, row.capabilityState));
  }

  const missingRequiredCells = DEVICE_BROWSERS.flatMap(browser =>
    DEVICE_VIEWPORTS.flatMap(viewport =>
      DEVICE_CAPABILITY_STATES.map(capabilityState => requiredCellKey(browser, viewport, capabilityState))))
    .filter(cell => !observedRequiredCells.has(cell));
  if (missingRequiredCells.length > 0) {
    const sample = missingRequiredCells.slice(0, 5).join(', ');
    const remainder = missingRequiredCells.length > 5 ? ', …' : '';
    problems.push(`report missing ${missingRequiredCells.length} required browser/viewport/capability cells: ${sample}${remainder}`);
  }

  return problems;
}

export function deviceQualificationDisposition(report: DeviceQualificationReport): DeviceQualificationStatus {
  if (deviceQualificationReportProblems(report).length > 0) return 'failed';
  if (report.rows.some(row => row.status === 'failed')) return 'failed';
  if (report.rows.some(row => row.status === 'blocked')) return 'blocked';
  if (report.rows.some(row => row.status === 'unavailable')) return 'unavailable';
  return 'passed';
}
