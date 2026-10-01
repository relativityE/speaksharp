/**
 * #1258 flight recorder — the cause-independent part (PO 2026-10-01).
 *
 * A page that freezes mid-take cannot report itself. The only durable trace it leaves is the content-free recovery
 * draft the recorder rewrites every 2 s (`App.tsx` heartbeat). If that draft is still `active_interrupted` when the
 * Session page next loads, the take never reached Stop/save. This emits ONE governed event for it, so a real user's
 * interrupted take is visible in ordinary Production telemetry.
 *
 * The event says THAT a take was interrupted, not why: a reload, a tab close, a crash and a freeze all look alike
 * here. `heartbeat_age_seconds` (last draft write to this load) and `take_seconds` (take length at that write) are
 * the only measurements. Cause-specific fields follow the #1549 diagnostic result.
 *
 * Content-free: closed enums and integers only. Never the session id, the draft's metrics, or any transcript.
 */
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import type { SessionRecoveryDraft } from '@/services/sessionRecoveryDraft';

type InterruptedDraft = Pick<SessionRecoveryDraft, 'recoveryState' | 'product' | 'mode' | 'durationSeconds' | 'savedAt'>;

/** Builds the event properties, or null when the draft is not an interrupted take. Pure, for tests. */
export function recordingInterruptedProps(draft: InterruptedDraft, nowMs: number): Record<string, string | number> | null {
  if (draft.recoveryState !== 'active_interrupted') return null; // a finalized draft reached Stop: not an interruption
  const props: Record<string, string | number> = {
    product: draft.product === 'open_mic' || draft.product === 'focus_points' ? draft.product : 'unknown',
    mode: draft.mode === 'private' ? 'private' : 'unknown',
    take_seconds: Math.max(0, Math.round(Number(draft.durationSeconds) || 0)),
  };
  const savedAtMs = Date.parse(draft.savedAt);
  // A missing or future timestamp (clock change) is omitted rather than reported as a wrong age.
  if (Number.isFinite(savedAtMs) && nowMs >= savedAtMs) props.heartbeat_age_seconds = Math.round((nowMs - savedAtMs) / 1000);
  return props;
}

/** Emits `recording_interrupted` for an interrupted draft. Never throws: telemetry must not block recovery. */
export function trackRecordingInterrupted(draft: InterruptedDraft, nowMs: number = Date.now()): void {
  try {
    const props = recordingInterruptedProps(draft, nowMs);
    if (props) analyticsBuffer.push('recording_interrupted', props, 'LOW');
  } catch {
    /* fail open */
  }
}
