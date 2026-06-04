/**
 * Native raw-first ASYNC saved-transcript formatting.
 *
 * Product architecture (reviewer decision 2026-06-03): Native is the zero-setup
 * front-door engine, so Stop/save/history/detail MUST NOT wait on the (network)
 * punctuation/casing formatter. The raw transcript is saved immediately; this runs
 * the formatter in the BACKGROUND and replaces the saved transcript ONLY if the
 * formatter succeeds and preserves the user's words.
 *
 *   Stop -> saved immediately (raw) -> "Formatting transcript…" -> formatted
 *   replaces raw when ready; on failure/timeout/empty/word-change the raw remains.
 *
 * Native ONLY. Never invoked for Private (Private must never call a server formatter).
 */
import { formatNativeTranscript, getNativeFormatterTelemetry } from './modes/nativeTranscriptFormatter';
import { updateSession as updateSessionDefault } from '@/lib/storage';
import logger from '@/lib/logger';

export type NativeFormattingStatus = 'not_started' | 'pending' | 'complete' | 'failed';

export interface NativeFormattingState {
  sessionId: string | null;
  status: NativeFormattingStatus;
  provider: string | null;
  /** True when formatting changed the text and the saved transcript was updated. */
  changed: boolean;
  /** True when the saved DB session was updated to the formatted text. */
  savedTranscriptUpdated: boolean;
  completedAt: number | null;
}

declare global {
  interface Window {
    /** Proof/UX hook: latest Native async-formatting state. Diagnostics only. */
    __NATIVE_FORMATTING_STATUS__?: NativeFormattingState;
  }
}

function publishStatus(state: NativeFormattingState): void {
  if (typeof window !== 'undefined') {
    window.__NATIVE_FORMATTING_STATUS__ = state;
  }
}

export interface FormatNativeSessionParams {
  /** DB id of the just-saved session (raw already persisted). */
  sessionId: string | null;
  /** The raw transcript that was saved. */
  rawTranscript: string;
  /** Called with the formatted text when the saved transcript is updated (e.g. to refresh the store/display). */
  onUpdated?: (formatted: string) => void;
  /** Injectable for tests. */
  updateSessionFn?: typeof updateSessionDefault;
}

/**
 * Format the saved Native transcript in the background. Never throws. Returns the
 * final formatting state (also published to window.__NATIVE_FORMATTING_STATUS__).
 */
export async function formatNativeSessionInBackground(
  params: FormatNativeSessionParams,
): Promise<NativeFormattingState> {
  const { sessionId, onUpdated } = params;
  const updateSession = params.updateSessionFn ?? updateSessionDefault;
  const raw = (params.rawTranscript ?? '').trim();

  const done = (partial: Partial<NativeFormattingState>): NativeFormattingState => {
    const state: NativeFormattingState = {
      sessionId,
      status: 'complete',
      provider: getNativeFormatterTelemetry()?.provider ?? null,
      changed: false,
      savedTranscriptUpdated: false,
      completedAt: Date.now(),
      ...partial,
    };
    publishStatus(state);
    return state;
  };

  // Nothing to format — raw stays.
  if (!raw) {
    return done({ status: 'complete', changed: false });
  }

  publishStatus({
    sessionId, status: 'pending', provider: null, changed: false,
    savedTranscriptUpdated: false, completedAt: null,
  });

  try {
    // formatNativeTranscript bounds latency (~4s budget), enforces word-preservation,
    // and returns the RAW text on any failure/timeout/empty/word-change.
    const formatted = (await formatNativeTranscript(raw)).trim();
    const changed = formatted.length > 0 && formatted !== raw;

    if (!changed) {
      // Formatter fell back to raw (or made no change) — saved transcript already correct.
      return done({ status: 'complete', changed: false });
    }

    if (!sessionId) {
      // No persisted session to update (e.g. anonymous); surface the change for callers only.
      onUpdated?.(formatted);
      return done({ status: 'complete', changed: true, savedTranscriptUpdated: false });
    }

    const result = await updateSession(sessionId, { transcript: formatted });
    if (!result.success) {
      logger.warn({ sessionId, error: result.error ?? null },
        '[NativeAsyncFormatter] saved-transcript update failed; raw transcript preserved');
      return done({ status: 'failed', changed: true, savedTranscriptUpdated: false });
    }

    onUpdated?.(formatted);
    return done({ status: 'complete', changed: true, savedTranscriptUpdated: true });
  } catch (error) {
    // formatNativeTranscript should never throw, but be defensive: raw is preserved.
    logger.warn({ error, sessionId },
      '[NativeAsyncFormatter] background formatting failed; raw transcript preserved');
    return done({ status: 'failed', changed: false });
  }
}
