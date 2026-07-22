import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import {
  trackPracticeEntryViewed, trackPracticeModeSelected, trackPracticeOverviewExpanded,
  trackQuickPracticeStarted, trackGuidedRehearsalPreviewViewed,
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
    trackPracticeOverviewExpanded('guided');
    trackQuickPracticeStarted('quick_overview');
    trackGuidedRehearsalPreviewViewed();

    const names = push.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      'practice_entry_viewed', 'practice_mode_selected', 'practice_overview_expanded',
      'quick_practice_started', 'guided_rehearsal_preview_viewed',
    ]);

    // Every payload carries only allowlisted keys and no free-form user content.
    const allowed = new Set(['mode', 'entry_source', 'returning_user', 'release_sha']);
    const allProps = push.mock.calls.map(([, props]) => (props ?? {}) as Record<string, unknown>);
    const allKeys = [...new Set(allProps.flatMap((p) => Object.keys(p)))];
    allKeys.forEach((key) => {
      expect(allowed.has(key)).toBe(true);
      expect(FORBIDDEN_KEYS).not.toContain(key);
    });
    // `mode` is only ever the enum; no payload contains email-shaped or free-form content.
    allProps.map((p) => p.mode).filter(Boolean).forEach((m) => expect(['quick', 'guided']).toContain(m));
    allProps.forEach((p) => expect(JSON.stringify(p)).not.toMatch(/@/));
  });
});
