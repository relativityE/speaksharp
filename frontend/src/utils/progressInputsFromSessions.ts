import type { PracticeSession } from '@/types/session';
import { validatedFillerTotal } from './sessionAnalysis';
import { computeProgressVsBaseline, type SessionRateInput, type ProgressVsBaselineResult } from './progressVsBaseline';

/**
 * #1222 S7 — adapt real practice-session history into the Progress-vs-baseline inputs (§6).
 *
 * Two honesty rules carried over from the analytics filler-evidence contract (#1131):
 *   - a session with **no valid filler evidence** (`validatedFillerTotal` === null — empty `{}`, malformed,
 *     or a not_captured row) is EXCLUDED, never counted as a flattering 0 fillers;
 *   - a session with no positive duration is excluded (a rate needs a denominator).
 *
 * Everything else — the 30s floor, baseline pinning, the 6-column trend — is decided by
 * `computeProgressVsBaseline`, so this stays a thin, ordered, validated mapping.
 */
export function progressInputsFromSessions(sessions: PracticeSession[]): SessionRateInput[] {
    return sessions
        .map((s) => ({ s, fillerCount: validatedFillerTotal(s.filler_words) }))
        .filter((x): x is { s: PracticeSession; fillerCount: number } =>
            x.fillerCount !== null && typeof x.s.duration === 'number' && x.s.duration > 0)
        // Oldest first — created_at is ISO-8601, which sorts correctly as a string (no Date needed).
        .sort((a, b) => (a.s.created_at < b.s.created_at ? -1 : a.s.created_at > b.s.created_at ? 1 : 0))
        .map((x) => ({ fillerCount: x.fillerCount, durationSeconds: x.s.duration }));
}

/** Convenience: history (any order) → the computed Progress result for the session page slot C. */
export function progressFromSessionHistory(sessions: PracticeSession[]): ProgressVsBaselineResult {
    return computeProgressVsBaseline(progressInputsFromSessions(sessions));
}
