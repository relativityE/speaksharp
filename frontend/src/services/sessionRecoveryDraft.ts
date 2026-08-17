import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import type { NextActionSignal } from '@/contracts/nextActionSignal';

const RECOVERY_DRAFT_KEY = 'speaksharp_unsaved_session_draft';

/**
 * #1306 — the recovery draft is CONTENT-FREE. Live transcript is ephemeral working memory and must NEVER be
 * persisted to localStorage (or anywhere). A draft carries only content-free recording state + metrics, in one
 * of two states:
 *   - `finalized_pending_save`: exact FINAL metrics + the one next_action_signal already exist; a retry may
 *     complete the session idempotently.
 *   - `active_interrupted`: only PARTIAL synchronous counters exist (e.g. captured from a `beforeunload`
 *     snapshot). It must NEVER become a completed session or enter Progress comparisons — it carries no
 *     next_action_signal and can only be discarded/restarted or kept as an explicitly incomplete record.
 */
export type RecoveryState = 'finalized_pending_save' | 'active_interrupted';

/** Content-free metrics (numbers only — never transcript/prose). Partial for active_interrupted. */
export interface RecoveryMetrics {
  totalWords?: number;
  clarityScore?: number;
  wpm?: number;
  fillerCounts?: Record<string, number>;
  pauseMetrics?: Record<string, number>;
}

export interface SessionRecoveryDraft {
  sessionId: string;
  userId?: string | null;
  recoveryState: RecoveryState;
  durationSeconds: number;
  mode: TranscriptionMode | 'unknown';
  metrics: RecoveryMetrics;
  /** Present ONLY for `finalized_pending_save`; an `active_interrupted` draft never carries a next action. */
  nextActionSignal?: NextActionSignal | null;
  savedAt: string;
}

const isRecoveryState = (v: unknown): v is RecoveryState =>
  v === 'finalized_pending_save' || v === 'active_interrupted';

/** Copy ONLY numeric metric fields — never spread arbitrary input, so no stray transcript/prose can ride along. */
function sanitizeMetrics(m: RecoveryMetrics | null | undefined): RecoveryMetrics {
  const out: RecoveryMetrics = {};
  if (!m || typeof m !== 'object') return out;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (num(m.totalWords) !== undefined) out.totalWords = num(m.totalWords);
  if (num(m.clarityScore) !== undefined) out.clarityScore = num(m.clarityScore);
  if (num(m.wpm) !== undefined) out.wpm = num(m.wpm);
  const numMap = (obj: unknown): Record<string, number> | undefined => {
    if (!obj || typeof obj !== 'object') return undefined;
    const r: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) r[k] = v;
    }
    return Object.keys(r).length ? r : undefined;
  };
  const fillers = numMap(m.fillerCounts);
  if (fillers) out.fillerCounts = fillers;
  const pauses = numMap(m.pauseMetrics);
  if (pauses) out.pauseMetrics = pauses;
  return out;
}

/**
 * Persist a CONTENT-FREE recovery draft. Fields are whitelisted explicitly (never spread) so no transcript or
 * prose can be written. A `finalized_pending_save` draft keeps its next action; an `active_interrupted` draft
 * is forced to carry none. No-op when there is nothing worth recovering (no elapsed time).
 */
export function saveSessionRecoveryDraft(draft: Omit<SessionRecoveryDraft, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  if (!draft.sessionId) return;
  if (!(Number(draft.durationSeconds) > 0)) return; // nothing recoverable

  const payload: SessionRecoveryDraft = {
    sessionId: draft.sessionId,
    userId: draft.userId ?? null,
    recoveryState: isRecoveryState(draft.recoveryState) ? draft.recoveryState : 'active_interrupted',
    durationSeconds: Math.max(0, Math.round(Number(draft.durationSeconds) || 0)),
    mode: draft.mode ?? 'unknown',
    metrics: sanitizeMetrics(draft.metrics),
    // A next action is only valid for a fully-finalized draft; never attach one to a partial/interrupted draft.
    nextActionSignal: draft.recoveryState === 'finalized_pending_save' ? (draft.nextActionSignal ?? null) : null,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(RECOVERY_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Recovery is best-effort; never let storage policy/quota errors break stop.
  }
}

/**
 * Read the stored draft, reconstructing ONLY known content-free fields. A legacy transcript-bearing draft
 * (written before #1306) is treated as invalid and never surfaced — its content is never read or exposed.
 */
export function getSessionRecoveryDraft(): SessionRecoveryDraft | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(RECOVERY_DRAFT_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Fail closed on any legacy content-bearing draft. Refusing to LOAD it is not enough — the transcript is
    // still sitting in localStorage — so DELETE the key immediately, then return the safe (empty) state.
    if ('transcript' in parsed || 'ai_suggestions' in parsed || 'ground_truth' in parsed) {
      try { window.localStorage.removeItem(RECOVERY_DRAFT_KEY); } catch { /* best-effort */ }
      return null;
    }
    if (!parsed.sessionId || typeof parsed.sessionId !== 'string') return null;
    if (!isRecoveryState(parsed.recoveryState)) return null;
    return {
      sessionId: parsed.sessionId,
      userId: (parsed.userId as string | null | undefined) ?? null,
      recoveryState: parsed.recoveryState,
      durationSeconds: Number(parsed.durationSeconds) || 0,
      mode: (parsed.mode as SessionRecoveryDraft['mode']) ?? 'unknown',
      metrics: sanitizeMetrics(parsed.metrics as RecoveryMetrics | undefined),
      nextActionSignal:
        parsed.recoveryState === 'finalized_pending_save'
          ? ((parsed.nextActionSignal as NextActionSignal | null | undefined) ?? null)
          : null,
      savedAt: (parsed.savedAt as string | undefined) ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * #1033 (C) — account-boundary safe read. Returns the stored draft ONLY when it is owned by a real user
 * AND that owner is exactly `userId`. There is a single global draft key, so one account's unsaved work
 * must never be exposed to another after a logout/account switch.
 *
 * LEGACY OWNERLESS DRAFTS (written before drafts were owner-bound) are **never** returned here and are
 * never auto-adopted into any account — an ownerless draft may in fact belong to a previously signed-in
 * user of this browser, so silently handing it to the current user would leak it. They are readable only
 * through the explicit `getLegacyOwnerlessDraft()` escape hatch, for a deliberate, user-confirmed decision.
 */
export function getRecoverableDraftForUser(userId: string | null | undefined): SessionRecoveryDraft | null {
  const draft = getSessionRecoveryDraft();
  if (!draft) return null;
  const draftUser = draft.userId ?? null;
  const currentUser = userId ?? null;
  if (!draftUser || !currentUser) return null; // ownerless draft, or no authenticated caller → fail closed
  if (draftUser !== currentUser) return null;  // strict owner match — no cross-account exposure
  return draft;
}

/**
 * #1033 (1) — explicit, opt-in access to a LEGACY draft that carries no owner. Returns null when the stored
 * draft is owned (use `getRecoverableDraftForUser` for those). Never call this to auto-rehydrate: an
 * ownerless draft has unknown provenance, so it may only be surfaced behind an explicit user decision.
 */
export function getLegacyOwnerlessDraft(): SessionRecoveryDraft | null {
  const draft = getSessionRecoveryDraft();
  if (!draft) return null;
  return draft.userId ? null : draft;
}

export function clearSessionRecoveryDraft(sessionId?: string): void {
  if (typeof window === 'undefined') return;

  if (!sessionId) {
    try {
      window.localStorage.removeItem(RECOVERY_DRAFT_KEY);
    } catch {
      // Best-effort cleanup.
    }
    return;
  }

  const draft = getSessionRecoveryDraft();
  if (!draft || draft.sessionId === sessionId) {
    try {
      window.localStorage.removeItem(RECOVERY_DRAFT_KEY);
    } catch {
      // Best-effort cleanup.
    }
  }
}
