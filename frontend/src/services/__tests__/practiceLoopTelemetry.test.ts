import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { projectEventProps } from '@/services/telemetryAllowlist';
import {
  trackPracticeLoopReviewCompleted,
  trackPracticeLoopReviewFailed,
  trackPracticeLoopReviewPersisted,
  trackPracticeLoopReviewRendered,
  trackPracticeLoopReviewRequested,
  trackAiCoachingDiagnostic,
} from '@/services/practiceLoopTelemetry';

vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: vi.fn() } }));

describe('Practice Loop review telemetry', () => {
  beforeEach(() => vi.clearAllMocks());

  it('emits five governed, content-free lifecycle receipts', () => {
    trackPracticeLoopReviewRequested();
    trackPracticeLoopReviewCompleted();
    trackPracticeLoopReviewPersisted();
    trackPracticeLoopReviewRendered();
    trackPracticeLoopReviewFailed('network');

    expect(vi.mocked(analyticsBuffer.push).mock.calls.map(([event]) => event)).toEqual([
      'practice_loop_review_requested',
      'practice_loop_review_completed',
      'practice_loop_review_persisted',
      'practice_loop_review_rendered',
      'practice_loop_review_failed',
    ]);
    for (const [event, props] of vi.mocked(analyticsBuffer.push).mock.calls) {
      expect(projectEventProps(event, props).dropped).toEqual([]);
      expect(JSON.stringify(props)).not.toMatch(/transcript|session-complete|opening|implementation/i);
    }
  });

  it('drops prose and non-enum failure reasons at the allowlist boundary', () => {
    expect(projectEventProps('practice_loop_review_failed', {
      reason: 'provider said the transcript was about layoffs',
      error: 'raw provider response',
    })).toEqual({ props: {}, dropped: ['reason', 'error'] });
  });

  it('#1473: keeps the closed service_configuration reason the review client now emits', () => {
    expect(projectEventProps('practice_loop_review_failed', { reason: 'service_configuration' }))
      .toEqual({ props: { reason: 'service_configuration' }, dropped: [] });
  });

  it('projects diagnostic timings and opaque identities while rejecting prose', () => {
    const id = '130bbc6c-5d89-465d-91e6-51f5a5951e34';
    trackAiCoachingDiagnostic({
      diagnostic_request_id: id, diagnostic_attempt_id: id, client_attempt: 1,
      outcome: 'failure', phase: 'provider', reason: 'provider_timeout', status: 502,
      provider_status: null, provider: 'google_gemini', configured_model: 'gemini-3.8-flash',
      observed_model: null, source: 'fresh', provider_attempts: 2, retry_count: 1,
      provider_duration_ms: 40_000, total_duration_ms: 41_000, prompt_sha256: 'a'.repeat(64),
      product: 'open_mic', has_session: true, client_release_id: 'a'.repeat(40),
    });
    const [event, props] = vi.mocked(analyticsBuffer.push).mock.calls[0];
    expect(event).toBe('ai_coaching_diagnostic');
    expect(projectEventProps(event, props).dropped).toEqual([]);
    expect(projectEventProps(event, { ...props, transcript: 'synthetic words' }).dropped).toEqual(['transcript']);
  });
});
