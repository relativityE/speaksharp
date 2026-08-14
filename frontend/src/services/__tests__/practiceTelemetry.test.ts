import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import {
  trackPracticeEntryViewed, trackPracticeModeSelected, trackPracticeOverviewExpanded,
  trackFreeformPracticeStarted,
  type PracticeEntrySource,
} from '@/services/practiceTelemetry';

vi.mock('@/services/AnalyticsBuffer', () => ({ analyticsBuffer: { push: vi.fn() } }));
const push = vi.mocked(analyticsBuffer.push);

// Content that must NEVER appear in any practice event payload.
const FORBIDDEN_KEYS = ['transcript', 'audio', 'agenda', 'title', 'description', 'email', 'name', 'url', 'path', 'text'];

describe('practiceTelemetry — content-free, allowlisted events via AnalyticsBuffer', () => {
  beforeEach(() => push.mockReset());

  it('emits the expected event names with only allowlisted properties', () => {
    trackPracticeEntryViewed(true);
    trackPracticeModeSelected('quick', 'landing_card');
    trackPracticeOverviewExpanded('quick');
    trackFreeformPracticeStarted('freeform_overview');

    const names = push.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      'practice_entry_viewed', 'practice_mode_selected', 'practice_overview_expanded',
      'freeform_practice_started',
    ]);
    // #1294: no `objective_unavailable_selected` event exists — Focus Points is an activated product.
    expect(names).not.toContain('objective_unavailable_selected');

    // Every payload carries only allowlisted keys and no free-form user content.
    const allowed = new Set(['mode', 'entry_source', 'returning_user', 'release_sha']);
    const allProps = push.mock.calls.map(([, props]) => (props ?? {}) as Record<string, unknown>);
    const allKeys = [...new Set(allProps.flatMap((p) => Object.keys(p)))];
    allKeys.forEach((key) => {
      expect(allowed.has(key)).toBe(true);
      expect(FORBIDDEN_KEYS).not.toContain(key);
    });
    // `mode` is only ever the enum; no payload contains email-shaped or free-form content.
    allProps.map((p) => p.mode).filter(Boolean).forEach((m) => expect(['quick', 'objective']).toContain(m));
    allProps.forEach((p) => expect(JSON.stringify(p)).not.toMatch(/@/));
  });

  it('DROPS an out-of-enum entry_source instead of emitting arbitrary text', () => {
    // A future/hostile caller supplies a non-enum source; it must be normalized away (null), never sent.
    trackPracticeModeSelected('quick', 'evil_free_text' as PracticeEntrySource);
    trackFreeformPracticeStarted('http://leak.example/path' as PracticeEntrySource);
    const props = push.mock.calls.map(([, p]) => (p ?? {}) as Record<string, unknown>);
    props.forEach((p) => expect(p.entry_source).toBeNull());
    // The arbitrary strings never appear anywhere in the payloads.
    props.forEach((p) => {
      expect(JSON.stringify(p)).not.toContain('evil_free_text');
      expect(JSON.stringify(p)).not.toContain('leak.example');
    });
  });

  it('keeps valid enum sources', () => {
    trackPracticeModeSelected('objective', 'landing_card');
    trackFreeformPracticeStarted('freeform_overview');
    expect(push.mock.calls[0][1]).toMatchObject({ entry_source: 'landing_card' });
    expect(push.mock.calls[1][1]).toMatchObject({ entry_source: 'freeform_overview' });
  });

  // RESTORED failure-path test (one-shot mock — a persistent throwing mockImplementation interferes with
  // Vitest's module/mock lifecycle; mockImplementationOnce throws for exactly this invocation).
  it('fails open when AnalyticsBuffer rejects an event', () => {
    push.mockImplementationOnce(() => {
      throw new Error('analytics unavailable');
    });
    expect(() => trackFreeformPracticeStarted('freeform_overview')).not.toThrow();
    expect(push).toHaveBeenCalledTimes(1);
  });
});
