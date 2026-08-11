import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import {
  trackPracticeEntryViewed,
  trackPracticeModeSelected,
  trackFreeformPracticeStarted,
} from '@/services/practiceTelemetry';
import {
  sanitizePrivateSampleProps,
  PRIVATE_SAMPLE_ALLOWED_PROPS,
  PRIVATE_SAMPLE_EVENTS,
} from '@/services/transcription/privateSampleTelemetry';

/**
 * #1259 — the launch-telemetry FALSIFICATION contract.
 *
 * This is the automated "prohibited fields are absent" evidence for the Practice Loop funnel + Private
 * signals defined in product_release/QUALITY.md §5. It consolidates the content-free
 * guarantee across both emitter families so the funnel the launch SLOs read from can never carry audio,
 * transcript, email, a raw user id, or free-form user content.
 */

vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: vi.fn() } }));
const push = vi.mocked(analyticsBuffer.push);

/** The four prohibited categories #1259 forbids in launch telemetry, as adversarial input. */
const PROHIBITED_INPUT: Record<string, unknown> = {
  transcript: 'um this private transcript must never leave the device',
  finalTranscript: 'another sensitive transcript',
  audioBlob: 'data:audio/wav;base64,AAAA',
  email: 'user@example.com',
  user_id: '8f14e45f-ceea-467a-9f8b-2c0a9b1d3e4f',
  name: 'Jane Speaker',
  agenda: 'my confidential pitch outline',
};
/** Substrings that must never appear anywhere in a sanitized payload. */
const LEAKED_VALUES = [
  'private transcript',
  'sensitive transcript',
  'data:audio',
  'user@example.com',
  '8f14e45f',
  'Jane Speaker',
  'confidential pitch',
];

const assertNoLeak = (payload: unknown) => {
  const json = JSON.stringify(payload ?? {});
  for (const leaked of LEAKED_VALUES) expect(json).not.toContain(leaked);
  expect(json).not.toMatch(/@/); // no email-shaped content
};

describe('#1259 — launch telemetry is content-free (falsification)', () => {
  beforeEach(() => push.mockReset());

  it('the Practice Loop funnel emits only the documented, content-free event names', () => {
    trackPracticeEntryViewed(true);
    trackPracticeModeSelected('quick', 'landing_card');
    trackFreeformPracticeStarted('landing_card');

    const names = push.mock.calls.map((c) => c[0]);
    // Drift guard: these are the funnel-entry events named in QUALITY.md §5 (Launch telemetry).
    expect(names).toEqual(['practice_entry_viewed', 'practice_mode_selected', 'freeform_practice_started']);
    for (const [, props] of push.mock.calls) assertNoLeak(props);
  });

  it('Private sample props: every prohibited field is dropped, allowlisted fields survive', () => {
    const out = sanitizePrivateSampleProps({
      ...PROHIBITED_INPUT,
      // valid, content-free failure context that MUST survive
      error_code: 'SetupError',
      save_success: false,
      session_id: 'sess-123',
    });

    // Allowlisted, content-free fields are kept.
    expect(out).toMatchObject({ error_code: 'SetupError', save_success: false, session_id: 'sess-123' });
    // Not one prohibited key survives.
    for (const key of Object.keys(PROHIBITED_INPUT)) {
      expect(Object.prototype.hasOwnProperty.call(out, key)).toBe(false);
    }
    assertNoLeak(out);
  });

  it('objects/arrays/functions (potential PII containers) never survive the Private allowlist', () => {
    const out = sanitizePrivateSampleProps({
      error_code: 'SetupError',
      nested: { transcript: 'leak' },
      list: ['leak'],
      fn: () => 'leak',
    } as Record<string, unknown>);
    expect(out).toEqual({ error_code: 'SetupError' });
    assertNoLeak(out);
  });

  it('the Private allowlist declares no PII-shaped property key', () => {
    for (const key of PRIVATE_SAMPLE_ALLOWED_PROPS) {
      expect(key).not.toMatch(/transcript|audio|email|\bname\b|password|token|raw_?user/i);
    }
  });

  it('the documented Private failure signals exist in the event taxonomy', () => {
    // Drift guard against QUALITY.md §5 (Launch telemetry).
    expect(PRIVATE_SAMPLE_EVENTS.SETUP_FAILED).toBe('private_sample_setup_failed');
    expect(PRIVATE_SAMPLE_EVENTS.ERROR).toBe('private_sample_error');
    expect(PRIVATE_SAMPLE_EVENTS.SETUP_SUCCEEDED).toBe('private_sample_setup_succeeded');
    expect(PRIVATE_SAMPLE_EVENTS.SAVED).toBe('private_sample_saved');
  });
});
