import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

const RECOVERY_DRAFT_KEY = 'speaksharp_unsaved_session_draft';

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
    window.localStorage.setItem(RECOVERY_DRAFT_KEY, JSON.stringify(payload));
  } catch {
    // Recovery is best-effort; never let storage policy/quota errors break stop.
  }
}

export function getSessionRecoveryDraft(): SessionRecoveryDraft | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(RECOVERY_DRAFT_KEY);
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
 * #1033 (C) — account-boundary safe read. Returns the stored draft ONLY when it belongs to `userId`
 * (there is a single global draft key, so one user's unsaved work must never be exposed to another after
 * a logout/account switch). A null/blank `userId` never matches a draft that carries a user. A legacy draft
 * with no `userId` is returned only when the caller also has no user (best-effort, pre-userId drafts).
 */
export function getRecoverableDraftForUser(userId: string | null | undefined): SessionRecoveryDraft | null {
  const draft = getSessionRecoveryDraft();
  if (!draft) return null;
  const draftUser = draft.userId ?? null;
  const currentUser = userId ?? null;
  if (draftUser !== currentUser) return null; // strict owner match — no cross-user exposure
  return draft;
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
