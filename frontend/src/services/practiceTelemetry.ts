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
import type { GovernedEvent } from '@/services/telemetryAllowlist';

export type PracticeMode = 'quick' | 'objective';

/**
 * CLOSED entry-source enum. The telemetry service boundary must not accept arbitrary `source` strings —
 * a future caller could otherwise smuggle free-form/user content into the payload. Unknown values are
 * DROPPED (never emitted), so only these exact tokens can ever reach analytics.
 */
export type PracticeEntrySource = 'landing_card' | 'freeform_overview';
const ENTRY_SOURCES: readonly PracticeEntrySource[] = ['landing_card', 'freeform_overview'];
const normalizeSource = (source: unknown): PracticeEntrySource | null =>
  typeof source === 'string' && (ENTRY_SOURCES as readonly string[]).includes(source)
    ? (source as PracticeEntrySource)
    : null;

const releaseId = (): string | null => {
  try { return (typeof window !== 'undefined' && window.__APP_RUNTIME_CONFIG__?.release) || null; } catch { return null; }
};

// `GovernedEvent`, not `string`. This wrapper is why a regex over literal `analyticsBuffer.push('name')`
// call sites could not see any Practice event — every one of them is emitted through here with a variable.
// Typing the parameter makes an ungoverned name a COMPILE error instead of an event whose properties are
// all silently dropped, which is what happened to `freeform_practice_started`.
const emit = (event: GovernedEvent, props: Record<string, string | boolean | null>): void => {
  try {
    analyticsBuffer.push(event, { ...props, release_sha: releaseId() }, 'LOW');
  } catch {
    /* fail open — telemetry must never block navigation or practice */
  }
};

/** The practice chooser became visible. */
export const trackPracticeEntryViewed = (returningUser: boolean): void =>
  emit('practice_entry_viewed', { returning_user: returningUser });

/** A mode was chosen (Quick or Objective card). `source` is a closed enum; unknown values are dropped. */
export const trackPracticeModeSelected = (mode: PracticeMode, source: PracticeEntrySource): void =>
  emit('practice_mode_selected', { mode, entry_source: normalizeSource(source) });

/** A mode's inline overview/preview was expanded. */
export const trackPracticeOverviewExpanded = (mode: PracticeMode): void =>
  emit('practice_overview_expanded', { mode });

/** Quick Practice's primary action fired — the user is handing off to the existing /session. */
export const trackFreeformPracticeStarted = (source: PracticeEntrySource): void =>
  emit('freeform_practice_started', { mode: 'quick', entry_source: normalizeSource(source) });

// NOTE: the retired `objective_unavailable_selected` event was removed with #1294 — Focus Points is an
// ACTIVATED product, so no "unavailable" event exists. Focus Points selection is captured by the funnel's
// `practice_mode_selected` (mode='objective') emitted when the setup flow opens; no separate event is needed.
