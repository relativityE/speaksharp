import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

export const SESSION_RECOVERY_DRAFT_STORAGE_KEY = 'speaksharp_unsaved_session_draft';

export interface SessionRecoveryDraft {
  sessionId: string;
  userId?: string | null;
  transcript: string;
  durationSeconds: number;
  mode: TranscriptionMode | 'unknown';
  savedAt: string;
}

export function saveSessionRecoveryDraft(draft: Omit<SessionRecoveryDraft, 'savedAt'>): void {
  if (typeof window === 'undefined') return;
  if (!draft.transcript.trim()) return;

  const payload: SessionRecoveryDraft = {
    ...draft,
    savedAt: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(SESSION_RECOVERY_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Recovery is best-effort; never let storage policy/quota errors break stop.
  }
}

export function getSessionRecoveryDraft(): SessionRecoveryDraft | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(SESSION_RECOVERY_DRAFT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SessionRecoveryDraft>;
    if (!parsed.sessionId || !parsed.transcript || typeof parsed.transcript !== 'string') {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      userId: parsed.userId ?? null,
      transcript: parsed.transcript,
      durationSeconds: Number(parsed.durationSeconds) || 0,
      mode: parsed.mode ?? 'unknown',
      savedAt: parsed.savedAt ?? new Date(0).toISOString(),
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
 * ownerless draft has unknown provenance, so it may only be surfaced behind an explicit user decision
 * (e.g. "recover this unsaved transcript?" / discard), never adopted into an account automatically.
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
      window.localStorage.removeItem(SESSION_RECOVERY_DRAFT_STORAGE_KEY);
    } catch {
      // Best-effort cleanup.
    }
    return;
  }

  const draft = getSessionRecoveryDraft();
  if (!draft || draft.sessionId === sessionId) {
    try {
      window.localStorage.removeItem(SESSION_RECOVERY_DRAFT_STORAGE_KEY);
    } catch {
      // Best-effort cleanup.
    }
  }
}
