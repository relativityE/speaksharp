/**
 * #1258 flight recorder — the cause-independent part (PO 2026-10-01).
 *
 * A page that freezes mid-take cannot report itself. The only durable trace it leaves is the content-free recovery
 * draft the recorder rewrites every 2 s (`App.tsx` heartbeat). If that draft is still `active_interrupted` when the
 * Session page next loads, the take was never durably finalized or saved. This emits ONE governed event for it, so a
 * real user's unresolved take is visible in ordinary Production telemetry.
 *
 * The event says THAT a take was left unresolved, not why or where: a reload, a tab close, a crash and a freeze look
 * alike, and so does a page lost AFTER Stop while finalization was still pending — the controller replaces the draft
 * with `finalized_pending_save` only late in the stop path (#1553 Codex P1 r4161804850). So it makes no claim about
 * whether Stop was pressed. `heartbeat_age_seconds` (last draft write to this load) and `take_seconds` (take length at
 * that write) are the only measurements. Cause-specific fields follow the #1549 diagnostic result.
 *
 * No model attribution (#1553 Codex P1 r4161804844): the draft persists no verified engine identity, and the envelope
 * would otherwise attach whichever engine THIS page has loaded — not the one that recorded the take. The event is
 * pushed with `modelAttributionVerified = false`, so the envelope's model fields stay null.
 *
 * Content-free: closed enums and integers only. Never the session id, the draft's metrics, or any transcript.
 */
import { analyticsBuffer } from '@/services/AnalyticsBuffer';
import type { SessionRecoveryDraft } from '@/services/sessionRecoveryDraft';

type InterruptedDraft = Pick<SessionRecoveryDraft, 'recoveryState' | 'product' | 'mode' | 'durationSeconds' | 'savedAt'>;

/** Builds the event properties, or null when the draft is not an interrupted take. Pure, for tests. */
export function recordingInterruptedProps(draft: InterruptedDraft, nowMs: number): Record<string, string | number> | null {
  if (draft.recoveryState !== 'active_interrupted') return null; // a finalized draft completed finalization: not unresolved
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
    // The draft carries no verified engine identity, so the envelope must not attribute a model (see the header).
    if (props) analyticsBuffer.push('recording_interrupted', props, 'LOW', false);
  } catch {
    /* fail open */
  }
}
