import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { projectEventProps } from '@/services/telemetryAllowlist';
import {
  trackPracticeLoopReviewCompleted,
  trackPracticeLoopReviewFailed,
  trackPracticeLoopReviewPersisted,
  trackPracticeLoopReviewRendered,
  trackPracticeLoopReviewRequested,
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
});
