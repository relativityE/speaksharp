// #1047 PR-U1 — Canonical, SERVER-OWNED transcript state (durable contract).
// `transcript_state` is a CONSTRAINED TEXT column (TEXT + CHECK on public.sessions, not a PG ENUM). A saved
// session self-describes whether a usable transcript exists, so every surface (History, session detail,
// Analytics, PDF) renders one honest answer instead of inferring it from an empty string (which silently
// reads as a measured zero) or a client guess.

export const TRANSCRIPT_STATE = {
  /** A persisted, non-empty transcript exists. */
  AVAILABLE: 'available',
  /** A server RETENTION operation (#1117) explicitly removed prior transcript text. Server-set ONLY —
   *  never inferred from emptiness and never self-asserted by a client. */
  EXPIRED: 'expired',
  /** No usable transcript was captured (e.g. a failed/degraded finalization). */
  NOT_CAPTURED: 'not_captured',
} as const;

export type TranscriptState = (typeof TRANSCRIPT_STATE)[keyof typeof TRANSCRIPT_STATE];

export const TRANSCRIPT_STATE_VALUES: readonly TranscriptState[] = Object.values(TRANSCRIPT_STATE);

/** Canonical, single-source user copy for the two non-available states (used by every surface + PDF). */
export const TRANSCRIPT_STATE_COPY = {
  /** Shown for a completed session whose transcript was retention-expired but whose measurements remain. */
  EXPIRED: 'Transcript expired. Your measurements are still available.',
  /** Shown when a session saved without a usable transcript. */
  NOT_CAPTURED: 'No transcript was captured.',
} as const;

/** True only when a real transcript exists to read/act on. Text/AI actions gate on this. */
export function hasReadableTranscript(state: string | null | undefined): boolean {
  return state === TRANSCRIPT_STATE.AVAILABLE;
}

/** Canonical, single-source presentation for a session's transcript across History/detail/PDF. */
export interface TranscriptPresentation {
  state: TranscriptState;
  /** True only when there is real transcript text to render. */
  canRenderTranscript: boolean;
  /** True when AI/semantic actions that require transcript text may be offered. */
  aiAvailable: boolean;
  /** The honest message to show when transcript text is unavailable; null when it can be rendered. */
  unavailableMessage: string | null;
}

/**
 * Resolve a session's transcript to ONE presentation decision so no surface infers state from an empty
 * string. `expired`/`not_captured` get their canonical copy; only `available` with real text renders.
 */
export function presentTranscript(
  serverState: string | null | undefined,
  transcript: string | null | undefined,
): TranscriptPresentation {
  const state = resolveTranscriptState(serverState, transcript);
  const canRenderTranscript = state === TRANSCRIPT_STATE.AVAILABLE && !!transcript && transcript.trim().length > 0;
  return {
    state,
    canRenderTranscript,
    aiAvailable: canRenderTranscript,
    unavailableMessage: canRenderTranscript
      ? null
      : state === TRANSCRIPT_STATE.EXPIRED
        ? TRANSCRIPT_STATE_COPY.EXPIRED
        : TRANSCRIPT_STATE_COPY.NOT_CAPTURED,
  };
}

/**
 * Read-side fallback ONLY. The server owns `transcript_state`; clients never assert it. When a legacy row
 * predates the column (undefined), derive available/not_captured from transcript presence — NEVER `expired`,
 * which cannot be inferred from an absent transcript. A present server value always wins.
 */
export function resolveTranscriptState(
  serverState: string | null | undefined,
  transcript: string | null | undefined,
): TranscriptState {
  if (serverState === TRANSCRIPT_STATE.AVAILABLE
    || serverState === TRANSCRIPT_STATE.EXPIRED
    || serverState === TRANSCRIPT_STATE.NOT_CAPTURED) {
    return serverState;
  }
  return transcript && transcript.trim().length > 0
    ? TRANSCRIPT_STATE.AVAILABLE
    : TRANSCRIPT_STATE.NOT_CAPTURED;
}
