/**
 * #1143 dependency-neutral Product Value journey contract.
 *
 * This contract is intentionally executable before every product dependency has
 * shipped. Missing behavior is recorded as blocked against its owning issue; it
 * is never skipped or converted into a passing E2E result.
 */

export const PRODUCT_VALUE_STAGES = [
  'anonymous-landing',
  'real-ui-authentication',
  'practice-focus-selected',
  'private-readiness',
  'private-record-finalize-save',
  'eligible-review-two-takeaways',
  'practice-this-next-accepted',
  'linked-private-repeat',
  'server-derived-outcome',
  'hard-reload-reopen',
  'history-detail-analytics-pdf',
  'report-issue',
  'sign-out-return',
] as const;

export const GUIDED_VALUE_STAGES = [
  'guided-project-created',
  'guided-private-rehearsal',
  'guided-point-time-evidence',
  'guided-one-action',
  'guided-linked-repeat',
  'guided-stored-outcome',
] as const;

export const PRODUCT_VALUE_NEGATIVE_PATHS = [
  'microphone-permission-denied',
  'offline-before-model-load',
  'offline-during-recording',
  'offline-during-save',
  'model-load-timeout',
  'worker-timeout',
  'double-action',
  'failed-local-handoff',
  'reload-during-recovery',
  'stale-tab',
  'transcript-not-captured',
  'transcript-expired',
  'insufficient-evidence',
  'ineligible-comparison',
  'report-issue-failure',
] as const;

export const PRODUCT_VALUE_DEPENDENCIES = {
  privatePrimaryCloudOff: 1120,
  practiceFocus: 1116,
  honestReviewLoop: 1047,
  guidedRehearsal: 1046,
  durableOutcomeTelemetry: 1145,
  deviceQualification: 1144,
} as const;

export const FORBIDDEN_JOURNEY_SHORTCUTS = [
  'session-injection',
  'mocked-supabase',
  '__E2E_DEPS__',
  'fake-recommendation',
  'newest-session-guessing',
  'cloud-engine',
  'automatic-engine-switch',
] as const;

export type ProductValueStage = typeof PRODUCT_VALUE_STAGES[number];
export type GuidedValueStage = typeof GUIDED_VALUE_STAGES[number];
export type ProductValueNegativePath = typeof PRODUCT_VALUE_NEGATIVE_PATHS[number];
export type JourneyStatus = 'passed' | 'failed' | 'blocked' | 'unavailable';
export type JourneyEnvironment = 'ci' | 'production';

export interface JourneyProof {
  realUi: boolean;
  realBackend: boolean;
  exactApplicationAnchor: boolean;
  networkObserved: boolean;
  persistenceObserved: boolean;
  reloadObserved: boolean;
  noMockSurface: boolean;
}

export interface JourneyStageResult {
  stage: ProductValueStage | GuidedValueStage;
  status: JourneyStatus;
  blockingIssue: number | null;
  unavailableReason: string | null;
  proof: JourneyProof;
  cloudProviderCalls: number;
  browserSelections: number;
  automaticEngineSwitches: number;
  falseSuccessSignals: number;
}

export interface JourneyNegativeResult {
  path: ProductValueNegativePath;
  status: JourneyStatus;
  blockingIssue: number | null;
  unavailableReason: string | null;
  honestRecoveryActionVisible: boolean;
  falseSuccessSignals: number;
  unintendedNavigations: number;
  unintendedWrites: number;
  unintendedAnalyticsEvents: number;
  cloudProviderCalls: number;
}

export interface ProductValueJourneyReport {
  schemaVersion: 1;
  releaseSha: string;
  environment: JourneyEnvironment;
  canonicalOrigin: string;
  runKind: 'deterministic-ci' | 'authorized-production';
  testedAt: string;
  stages: JourneyStageResult[];
  guidedStages: JourneyStageResult[];
  negativePaths: JourneyNegativeResult[];
  forbiddenShortcutsObserved: string[];
  emittedSensitiveFields: string[];
}

const FULL_SHA = /^[0-9a-f]{40}$/;
const CANONICAL_PRODUCTION_ORIGIN = 'https://speaksharp-public.vercel.app';

const STAGE_PROOF_REQUIREMENTS: Record<ProductValueStage | GuidedValueStage, ReadonlyArray<keyof JourneyProof>> = {
  'anonymous-landing': ['realUi'],
  'real-ui-authentication': ['realUi', 'realBackend', 'noMockSurface'],
  'practice-focus-selected': ['realUi'],
  'private-readiness': ['realUi', 'noMockSurface'],
  'private-record-finalize-save': ['realUi', 'realBackend', 'exactApplicationAnchor', 'networkObserved', 'persistenceObserved', 'noMockSurface'],
  'eligible-review-two-takeaways': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved'],
  'practice-this-next-accepted': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved'],
  'linked-private-repeat': ['realUi', 'realBackend', 'exactApplicationAnchor', 'networkObserved', 'persistenceObserved'],
  'server-derived-outcome': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved'],
  'hard-reload-reopen': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved', 'reloadObserved'],
  'history-detail-analytics-pdf': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved', 'reloadObserved'],
  'report-issue': ['realUi', 'realBackend', 'networkObserved', 'persistenceObserved'],
  'sign-out-return': ['realUi', 'realBackend', 'reloadObserved'],
  'guided-project-created': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved'],
  'guided-private-rehearsal': ['realUi', 'realBackend', 'exactApplicationAnchor', 'networkObserved', 'persistenceObserved'],
  'guided-point-time-evidence': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved'],
  'guided-one-action': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved'],
  'guided-linked-repeat': ['realUi', 'realBackend', 'exactApplicationAnchor', 'networkObserved', 'persistenceObserved'],
  'guided-stored-outcome': ['realUi', 'realBackend', 'exactApplicationAnchor', 'persistenceObserved', 'reloadObserved'],
};

function statusProblems(status: JourneyStatus, blockingIssue: number | null, unavailableReason: string | null): string[] {
  const problems: string[] = [];
  if (!['passed', 'failed', 'blocked', 'unavailable'].includes(status)) problems.push(`unsupported status: ${String(status)}`);
  if (status === 'blocked') {
    if (!Number.isInteger(blockingIssue) || Number(blockingIssue) <= 0) problems.push('blocked result must name a positive blockingIssue');
  } else if (blockingIssue !== null) {
    problems.push('non-blocked result must not carry blockingIssue');
  }
  if (status === 'unavailable') {
    if (!unavailableReason?.trim()) problems.push('unavailable result must name an unavailableReason');
  } else if (unavailableReason !== null) {
    problems.push('non-unavailable result must not carry unavailableReason');
  }
  return problems;
}

function nonNegativeIntegerProblems(label: string, value: number): string[] {
  return Number.isInteger(value) && value >= 0 ? [] : [`${label} must be a non-negative integer`];
}

export function journeyStageProblems(result: JourneyStageResult): string[] {
  const problems = statusProblems(result.status, result.blockingIssue, result.unavailableReason);
  const knownStages = [...PRODUCT_VALUE_STAGES, ...GUIDED_VALUE_STAGES] as readonly string[];
  if (!knownStages.includes(result.stage)) problems.push(`unsupported stage: ${String(result.stage)}`);
  for (const key of Object.keys(result.proof) as Array<keyof JourneyProof>) {
    if (typeof result.proof[key] !== 'boolean') problems.push(`proof.${key} must be boolean`);
  }
  if (result.status === 'passed') {
    for (const key of STAGE_PROOF_REQUIREMENTS[result.stage] ?? []) {
      if (result.proof[key] !== true) problems.push(`passed ${result.stage} lacks proof.${key}`);
    }
    if (result.cloudProviderCalls !== 0) problems.push('passed stage must prove zero Cloud-provider calls');
    if (result.automaticEngineSwitches !== 0) problems.push('passed stage must prove no automatic engine switch');
    if (result.falseSuccessSignals !== 0) problems.push('passed stage must prove no false-success signal');
  }
  problems.push(...nonNegativeIntegerProblems('cloudProviderCalls', result.cloudProviderCalls));
  problems.push(...nonNegativeIntegerProblems('browserSelections', result.browserSelections));
  problems.push(...nonNegativeIntegerProblems('automaticEngineSwitches', result.automaticEngineSwitches));
  problems.push(...nonNegativeIntegerProblems('falseSuccessSignals', result.falseSuccessSignals));
  return problems;
}

export function journeyNegativeProblems(result: JourneyNegativeResult): string[] {
  const problems = statusProblems(result.status, result.blockingIssue, result.unavailableReason);
  if (!PRODUCT_VALUE_NEGATIVE_PATHS.includes(result.path)) problems.push(`unsupported negative path: ${String(result.path)}`);
  if (result.status === 'passed') {
    if (!result.honestRecoveryActionVisible) problems.push('passed negative path must show an honest recovery action');
    if (result.falseSuccessSignals !== 0) problems.push('passed negative path must prove no false-success signal');
    if (result.unintendedNavigations !== 0) problems.push('passed negative path must prove no unintended navigation');
    if (result.unintendedWrites !== 0) problems.push('passed negative path must prove no unintended write');
    if (result.unintendedAnalyticsEvents !== 0) problems.push('passed negative path must prove no unintended analytics event');
    if (result.cloudProviderCalls !== 0) problems.push('passed negative path must prove zero Cloud-provider calls');
  }
  for (const key of ['falseSuccessSignals', 'unintendedNavigations', 'unintendedWrites', 'unintendedAnalyticsEvents', 'cloudProviderCalls'] as const) {
    problems.push(...nonNegativeIntegerProblems(key, result[key]));
  }
  return problems;
}

export function productValueJourneyProblems(report: ProductValueJourneyReport): string[] {
  const problems: string[] = [];
  if (report.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (!FULL_SHA.test(report.releaseSha)) problems.push('releaseSha must be a lowercase full 40-character SHA');
  if (!['ci', 'production'].includes(report.environment)) problems.push(`unsupported environment: ${String(report.environment)}`);
  if (!['deterministic-ci', 'authorized-production'].includes(report.runKind)) problems.push(`unsupported runKind: ${String(report.runKind)}`);
  if (report.environment === 'production' && report.canonicalOrigin !== CANONICAL_PRODUCTION_ORIGIN) {
    problems.push(`production proof must use ${CANONICAL_PRODUCTION_ORIGIN}`);
  }
  if (report.environment === 'production' && report.runKind !== 'authorized-production') {
    problems.push('production proof must be separately authorized');
  }
  if (!Number.isFinite(Date.parse(report.testedAt))) problems.push('testedAt must be an ISO timestamp');

  const requiredStages = new Set<string>(PRODUCT_VALUE_STAGES);
  const seenStages = new Set<string>();
  for (const [index, result] of report.stages.entries()) {
    for (const problem of journeyStageProblems(result)) problems.push(`stages[${index}]: ${problem}`);
    if (!requiredStages.has(result.stage)) problems.push(`stages[${index}]: guided or unknown stage is in the core journey`);
    if (seenStages.has(result.stage)) problems.push(`stages[${index}]: duplicate stage ${result.stage}`);
    seenStages.add(result.stage);
  }
  for (const stage of PRODUCT_VALUE_STAGES) if (!seenStages.has(stage)) problems.push(`missing required stage: ${stage}`);

  const seenGuided = new Set<string>();
  for (const [index, result] of report.guidedStages.entries()) {
    for (const problem of journeyStageProblems(result)) problems.push(`guidedStages[${index}]: ${problem}`);
    if (!(GUIDED_VALUE_STAGES as readonly string[]).includes(result.stage)) problems.push(`guidedStages[${index}]: non-Guided stage is in the Guided journey`);
    if (seenGuided.has(result.stage)) problems.push(`guidedStages[${index}]: duplicate stage ${result.stage}`);
    seenGuided.add(result.stage);
  }
  for (const stage of GUIDED_VALUE_STAGES) if (!seenGuided.has(stage)) problems.push(`missing Guided stage: ${stage}`);

  const seenNegative = new Set<string>();
  for (const [index, result] of report.negativePaths.entries()) {
    for (const problem of journeyNegativeProblems(result)) problems.push(`negativePaths[${index}]: ${problem}`);
    if (seenNegative.has(result.path)) problems.push(`negativePaths[${index}]: duplicate path ${result.path}`);
    seenNegative.add(result.path);
  }
  for (const path of PRODUCT_VALUE_NEGATIVE_PATHS) if (!seenNegative.has(path)) problems.push(`missing negative path: ${path}`);

  if (report.forbiddenShortcutsObserved.length > 0) problems.push('forbidden journey shortcut was observed');
  if (report.emittedSensitiveFields.length > 0) problems.push('sanitized evidence emitted prohibited content or identifiers');
  return problems;
}

export function productValueJourneyDisposition(report: ProductValueJourneyReport): JourneyStatus {
  if (productValueJourneyProblems(report).length > 0) return 'failed';
  const results = [...report.stages, ...report.guidedStages, ...report.negativePaths];
  if (results.some(result => result.status === 'failed')) return 'failed';
  if (results.some(result => result.status === 'blocked')) return 'blocked';
  if (results.some(result => result.status === 'unavailable')) return 'unavailable';
  return 'passed';
}

