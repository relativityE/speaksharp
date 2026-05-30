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
