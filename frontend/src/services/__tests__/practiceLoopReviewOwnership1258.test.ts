/**
 * #1258 (CLI Dev producer gap 6037347459; contract 6037393538) — coaching events name their take and request, never
 * the session id. The readback could not bind `practice_loop_review_*` to the saved take (attempt_id is cleared after
 * Stop) or pair a request with its outcome. These cases pin the fields, the allowlist shape and the omissions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import { projectEventProps } from '@/services/telemetryAllowlist';
import {
  trackPracticeLoopReviewCompleted,
  trackPracticeLoopReviewDiscarded,
  trackPracticeLoopReviewFailed,
  trackPracticeLoopReviewRendered,
  trackPracticeLoopReviewRequested,
} from '@/services/practiceLoopTelemetry';
import {
  __resetReviewSubjectsForTests, nextReviewRequestSeq, rememberReviewSubject, reviewSubjectFor, REVIEW_REQUEST_SEQ_MAX,
} from '@/services/telemetry/reviewSubject';

vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: vi.fn() } }));

const SESSION = '7b0c1e9e-3c1f-4d8a-9a51-0f6f2a4f1c11';
const SUBJECT = { subject_boot_id: 'boot-1', subject_journey_id: 'jrn-1', subject_attempt_id: 'att-1', subject_attempt_seq: 1 };
const pushed = () => vi.mocked(analyticsBuffer.push).mock.calls.map(([event, props]) => ({ event, props: props as Record<string, unknown> }));

describe('coaching events carry the saved take and request lifecycle (no session id)', () => {
  beforeEach(() => { vi.clearAllMocks(); __resetReviewSubjectsForTests(); });

  it('CASUALTY (6037347459): requested and its terminal outcome share the request seq and name the saved take', () => {
    rememberReviewSubject(SESSION, SUBJECT);
    const lifecycle = { sessionId: SESSION, product: 'open_mic' as const, requestSeq: nextReviewRequestSeq() };
    trackPracticeLoopReviewRequested(lifecycle);
    trackPracticeLoopReviewCompleted({ ...lifecycle, invocations: 1 });
    const [requested, completed] = pushed();
    for (const e of [requested, completed]) {
      expect(e.props).toMatchObject({ ...SUBJECT, product: 'open_mic', review_request_seq: 1 });
      expect(projectEventProps(e.event, e.props).dropped).toEqual([]);
    }
    expect(completed.props.invocations).toBe(1);
  });

  it('the session id is a lookup key only: it never appears in any emitted value', () => {
    rememberReviewSubject(SESSION, SUBJECT);
    trackPracticeLoopReviewRequested({ sessionId: SESSION, product: 'focus_points', requestSeq: 1 });
    trackPracticeLoopReviewFailed('unavailable', { sessionId: SESSION, requestSeq: 1, invocations: 2 });
    trackPracticeLoopReviewRendered({ sessionId: SESSION, source: 'stored' });
    for (const { props } of pushed()) expect(JSON.stringify(props)).not.toContain(SESSION);
  });

  it('a session this tab did not record names no take: the subject fields are omitted, never guessed', () => {
    trackPracticeLoopReviewRequested({ sessionId: 'another-tabs-session', product: 'open_mic', requestSeq: 3 });
    const [{ props }] = pushed();
    expect(Object.keys(props).filter((k) => k.startsWith('subject_'))).toEqual([]);
    expect(props).toMatchObject({ product: 'open_mic', review_request_seq: 3 });
  });

  it('a stored pair renders as `stored` with no request seq, so a revisit is never a generation', () => {
    rememberReviewSubject(SESSION, SUBJECT);
    trackPracticeLoopReviewRendered({ sessionId: SESSION, product: 'open_mic', source: 'stored' });
    const [{ props }] = pushed();
    expect(props.review_source).toBe('stored');
    expect(props).not.toHaveProperty('review_request_seq');
  });

  it('the allowlist refuses malformed ownership values (prose, a session-shaped subject, out-of-range ints)', () => {
    expect(projectEventProps('practice_loop_review_completed', {
      subject_attempt_id: 'the attempt where I talked about layoffs',
      review_request_seq: 0,
      invocations: 11,
      product: 'sales_call',
      review_source: 'cache',
    }).dropped.sort()).toEqual(['invocations', 'product', 'review_request_seq', 'review_source', 'subject_attempt_id']);
  });

  it('discard telemetry is content-free and accepts only the three lifecycle reasons', () => {
    rememberReviewSubject(SESSION, SUBJECT);
    trackPracticeLoopReviewDiscarded('session_changed', { sessionId: SESSION, product: 'open_mic', requestSeq: 7, invocations: 1 });
    const [{ event, props }] = pushed();
    expect(event).toBe('practice_loop_review_discarded');
    expect(props).toMatchObject({ ...SUBJECT, product: 'open_mic', review_request_seq: 7, invocations: 1, discard_reason: 'session_changed' });
    expect(projectEventProps(event, props).dropped).toEqual([]);
    expect(projectEventProps(event, { discard_reason: 'provider_failed', transcript: 'private words' }).dropped.sort()).toEqual(['discard_reason', 'transcript']);
  });

  it('the registry keeps only sanitized subjects, bounded, and the seq wraps inside its declared range', () => {
    rememberReviewSubject(SESSION, { ...SUBJECT, extra: 'x' });
    expect(reviewSubjectFor(SESSION)).toBeNull();
    for (let i = 0; i < 25; i += 1) rememberReviewSubject(`s-${i}`, SUBJECT);
    expect(reviewSubjectFor('s-0')).toBeNull();
    expect(reviewSubjectFor('s-24')).toEqual(SUBJECT);
    __resetReviewSubjectsForTests();
    let last = 0;
    for (let i = 0; i < REVIEW_REQUEST_SEQ_MAX + 1; i += 1) last = nextReviewRequestSeq();
    expect(last).toBe(1);
  });
});
