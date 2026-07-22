/**
 * Practice-entry product telemetry — CONTENT-FREE, via AnalyticsBuffer (never PostHog directly).
 *
 * Explicit events only (no autocapture). Every payload is allowlisted here: mode / source / a boolean /
 * the release id. It NEVER carries transcript, audio, agenda, issue text, email, names, arbitrary
 * URL/path segments, or any user-entered content. Fails open — a telemetry error never blocks
 * navigation or practice (AnalyticsBuffer.push does not throw). Session lifecycle stays with the
 * existing `session_started` / `session_saved` events; nothing here duplicates them.
 */

import { analyticsBuffer } from '@/services/AnalyticsBuffer';

export type PracticeMode = 'quick' | 'guided';

const releaseId = (): string | null => {
  try { return (typeof window !== 'undefined' && window.__APP_RUNTIME_CONFIG__?.release) || null; } catch { return null; }
};

const emit = (event: string, props: Record<string, string | boolean | null>): void => {
  try {
    analyticsBuffer.push(event, { ...props, release_sha: releaseId() }, 'LOW');
  } catch {
    /* fail open — telemetry must never block navigation or practice */
  }
};

/** The practice chooser became visible. */
export const trackPracticeEntryViewed = (returningUser: boolean): void =>
  emit('practice_entry_viewed', { returning_user: returningUser });

/** A mode was chosen (Quick or Guided card). `source` describes where the choice was made. */
export const trackPracticeModeSelected = (mode: PracticeMode, source: string): void =>
  emit('practice_mode_selected', { mode, entry_source: source });

/** A mode's inline overview/preview was expanded. */
export const trackPracticeOverviewExpanded = (mode: PracticeMode): void =>
  emit('practice_overview_expanded', { mode });

/** Quick Practice's primary action fired — the user is handing off to the existing /session. */
export const trackQuickPracticeStarted = (source: string): void =>
  emit('quick_practice_started', { mode: 'quick', entry_source: source });

/** The Guided Rehearsal preview was viewed (it stays on /practice; no functional rehearsal). */
export const trackGuidedRehearsalPreviewViewed = (): void =>
  emit('guided_rehearsal_preview_viewed', { mode: 'guided' });
