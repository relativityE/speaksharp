import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_JOURNEY_SHORTCUTS,
  GUIDED_VALUE_STAGES,
  PRODUCT_VALUE_DEPENDENCIES,
  PRODUCT_VALUE_NEGATIVE_PATHS,
  PRODUCT_VALUE_STAGES,
  journeyNegativeProblems,
  journeyStageProblems,
  productValueJourneyDisposition,
  productValueJourneyProblems,
  type JourneyNegativeResult,
  type JourneyProof,
  type JourneyStageResult,
  type ProductValueJourneyReport,
} from './productValueJourneyContract';

const fullProof = (): JourneyProof => ({
  realUi: true,
  realBackend: true,
  exactApplicationAnchor: true,
  networkObserved: true,
  persistenceObserved: true,
  reloadObserved: true,
  noMockSurface: true,
});

const passedStage = (stage: JourneyStageResult['stage']): JourneyStageResult => ({
  stage,
  status: 'passed',
  blockingIssue: null,
  unavailableReason: null,
  proof: fullProof(),
  cloudProviderCalls: 0,
  browserSelections: 0,
  automaticEngineSwitches: 0,
  falseSuccessSignals: 0,
});

const passedNegative = (path: JourneyNegativeResult['path']): JourneyNegativeResult => ({
  path,
  status: 'passed',
  blockingIssue: null,
  unavailableReason: null,
  honestRecoveryActionVisible: true,
  falseSuccessSignals: 0,
  unintendedNavigations: 0,
  unintendedWrites: 0,
  unintendedAnalyticsEvents: 0,
  cloudProviderCalls: 0,
});

const validReport = (): ProductValueJourneyReport => ({
  schemaVersion: 1,
  releaseSha: 'a'.repeat(40),
  environment: 'ci',
  canonicalOrigin: 'http://127.0.0.1:4173',
  runKind: 'deterministic-ci',
  testedAt: '2026-08-02T12:00:00.000Z',
  stages: PRODUCT_VALUE_STAGES.map(passedStage),
  guidedStages: GUIDED_VALUE_STAGES.map(passedStage),
  negativePaths: PRODUCT_VALUE_NEGATIVE_PATHS.map(passedNegative),
  forbiddenShortcutsObserved: [],
  emittedSensitiveFields: [],
});

describe('#1143 Product Value journey contract', () => {
  it('locks the complete positive journey, Guided branch, negative paths, and dependency owners', () => {
    expect(PRODUCT_VALUE_STAGES).toEqual([
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
    ]);
    expect(GUIDED_VALUE_STAGES).toHaveLength(6);
    expect(PRODUCT_VALUE_NEGATIVE_PATHS).toEqual(expect.arrayContaining([
      'microphone-permission-denied',
      'offline-during-save',
      'double-action',
      'stale-tab',
      'transcript-expired',
      'report-issue-failure',
    ]));
    expect(PRODUCT_VALUE_DEPENDENCIES).toEqual({
      privatePrimaryCloudOff: 1120,
      practiceFocus: 1116,
      honestReviewLoop: 1047,
      guidedRehearsal: 1046,
      durableOutcomeTelemetry: 1145,
      deviceQualification: 1144,
    });
    expect(FORBIDDEN_JOURNEY_SHORTCUTS).toEqual(expect.arrayContaining([
      'session-injection',
      'mocked-supabase',
      '__E2E_DEPS__',
      'newest-session-guessing',
      'cloud-engine',
      'automatic-engine-switch',
    ]));
  });

  it('accepts a complete, internally consistent exact-SHA report', () => {
    const report = validReport();
    expect(productValueJourneyProblems(report)).toEqual([]);
    expect(productValueJourneyDisposition(report)).toBe('passed');
  });

  it('records dependency-owned behavior as blocked instead of skipped or passed', () => {
    const result = passedStage('eligible-review-two-takeaways');
    result.status = 'blocked';
    result.blockingIssue = 1047;
    result.proof.persistenceObserved = false;
    expect(journeyStageProblems(result)).toEqual([]);

    const report = validReport();
    report.stages = report.stages.map(stage => stage.stage === result.stage ? result : stage);
    expect(productValueJourneyProblems(report)).toEqual([]);
    expect(productValueJourneyDisposition(report)).toBe('blocked');
  });

  it.each([
    ['Cloud invocation', (result: JourneyStageResult) => { result.cloudProviderCalls = 1; }, 'zero Cloud-provider calls'],
    ['engine switch', (result: JourneyStageResult) => { result.automaticEngineSwitches = 1; }, 'no automatic engine switch'],
    ['false success', (result: JourneyStageResult) => { result.falseSuccessSignals = 1; }, 'no false-success signal'],
    ['missing durable save', (result: JourneyStageResult) => { result.proof.persistenceObserved = false; }, 'proof.persistenceObserved'],
    ['missing exact anchor', (result: JourneyStageResult) => { result.proof.exactApplicationAnchor = false; }, 'proof.exactApplicationAnchor'],
    ['mocked backend', (result: JourneyStageResult) => { result.proof.noMockSurface = false; }, 'proof.noMockSurface'],
  ])('rejects a positive-path false green: %s', (_label, mutate, expected) => {
    const result = passedStage('private-record-finalize-save');
    mutate(result);
    expect(journeyStageProblems(result).join('\n')).toContain(expected);
  });

  it.each([
    ['no honest recovery', (result: JourneyNegativeResult) => { result.honestRecoveryActionVisible = false; }, 'honest recovery action'],
    ['false success', (result: JourneyNegativeResult) => { result.falseSuccessSignals = 1; }, 'no false-success signal'],
    ['navigation', (result: JourneyNegativeResult) => { result.unintendedNavigations = 1; }, 'no unintended navigation'],
    ['write', (result: JourneyNegativeResult) => { result.unintendedWrites = 1; }, 'no unintended write'],
    ['analytics event', (result: JourneyNegativeResult) => { result.unintendedAnalyticsEvents = 1; }, 'no unintended analytics event'],
    ['Cloud call', (result: JourneyNegativeResult) => { result.cloudProviderCalls = 1; }, 'zero Cloud-provider calls'],
  ])('rejects a negative-path false green: %s', (_label, mutate, expected) => {
    const result = passedNegative('offline-during-save');
    mutate(result);
    expect(journeyNegativeProblems(result).join('\n')).toContain(expected);
  });

  it('fails closed on missing, duplicate, or cross-branch stages', () => {
    const report = validReport();
    report.stages = report.stages.filter(result => result.stage !== 'report-issue');
    report.stages.push(passedStage('anonymous-landing'));
    report.guidedStages.push(passedStage('private-readiness'));
    expect(productValueJourneyProblems(report)).toEqual(expect.arrayContaining([
      'missing required stage: report-issue',
      expect.stringContaining('duplicate stage anonymous-landing'),
      expect.stringContaining('non-Guided stage is in the Guided journey'),
    ]));
    expect(productValueJourneyDisposition(report)).toBe('failed');
  });

  it('fails closed when a negative path is absent', () => {
    const report = validReport();
    report.negativePaths = report.negativePaths.filter(result => result.path !== 'stale-tab');
    expect(productValueJourneyProblems(report)).toContain('missing negative path: stale-tab');
    expect(productValueJourneyDisposition(report)).toBe('failed');
  });

  it('rejects forbidden shortcuts and evidence containing prohibited content or identifiers', () => {
    const report = validReport();
    report.forbiddenShortcutsObserved = ['newest-session-guessing'];
    report.emittedSensitiveFields = ['email'];
    expect(productValueJourneyProblems(report)).toEqual(expect.arrayContaining([
      'forbidden journey shortcut was observed',
      'sanitized evidence emitted prohibited content or identifiers',
    ]));
  });

  it('binds production evidence to the sole approved origin and a separately authorized run kind', () => {
    const report = validReport();
    report.environment = 'production';
    expect(productValueJourneyProblems(report)).toEqual(expect.arrayContaining([
      expect.stringContaining('https://speaksharp-public.vercel.app'),
      'production proof must be separately authorized',
    ]));

    report.canonicalOrigin = 'https://speaksharp-public.vercel.app';
    report.runKind = 'authorized-production';
    expect(productValueJourneyProblems(report)).toEqual([]);
  });

  it('does not allow blocked or unavailable cells to aggregate to green', () => {
    const blocked = validReport();
    blocked.guidedStages[0].status = 'blocked';
    blocked.guidedStages[0].blockingIssue = 1046;
    expect(productValueJourneyDisposition(blocked)).toBe('blocked');

    const unavailable = validReport();
    unavailable.negativePaths[0].status = 'unavailable';
    unavailable.negativePaths[0].unavailableReason = 'browser cannot simulate permission dismissal faithfully';
    expect(productValueJourneyDisposition(unavailable)).toBe('unavailable');
  });
});
