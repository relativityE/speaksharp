import type { PracticeSession } from '@/types/session';
import { countedFillerTotal } from './fillerTiers';
import { getCustomWordList } from './sessionAnalysis';
import { computeProgressVsBaseline, type SessionRateInput, type ProgressVsBaselineResult } from './progressVsBaseline';

/**
 * #1222 S7 — adapt real practice-session history into the Progress-vs-baseline inputs (§6).
 *
 * Two honesty rules carried over from the analytics filler-evidence contract (#1131):
 *   - a session with **no valid PER-KEY filler evidence** (`countedFillerTotal` === null — empty `{}`,
 *     malformed, a not_captured row, or a total-only snapshot) is EXCLUDED, never counted as a flattering 0;
 *   - a session with no positive duration is excluded (a rate needs a denominator).
 *
 * #1231 slice 2: the per-session rate is the TRUE-filler tier (um/uh/ah + user words, + discourse when the
 * user opts in), DERIVED from each session's per-key `filler_words` — the SAME derivation for old and new
 * sessions, so the baseline→latest trend never shows a fake jump from the tier change. The `includeDiscourseMarkers`
 * flag (the caller's DB-backed preference) applies uniformly to every session in the comparison.
 *
 * Everything else — the 30s floor, baseline pinning, the 6-column trend — is decided by
 * `computeProgressVsBaseline`, so this stays a thin, ordered, validated mapping.
 */
export function progressInputsFromSessions(
    sessions: PracticeSession[],
    { includeDiscourseMarkers = false }: { includeDiscourseMarkers?: boolean } = {},
): SessionRateInput[] {
    return sessions
        .map((s) => ({ s, fillerCount: countedFillerTotal(s.filler_words, { includeDiscourseMarkers, userWords: getCustomWordList(s.custom_words) }) }))
        .filter((x): x is { s: PracticeSession; fillerCount: number } =>
            x.fillerCount !== null && typeof x.s.duration === 'number' && x.s.duration > 0)
        // Oldest first — created_at is ISO-8601, which sorts correctly as a string (no Date needed).
        .sort((a, b) => (a.s.created_at < b.s.created_at ? -1 : a.s.created_at > b.s.created_at ? 1 : 0))
        .map((x) => ({ fillerCount: x.fillerCount, durationSeconds: x.s.duration }));
}

/** Convenience: history (any order) → the computed Progress result for the session page slot C. */
export function progressFromSessionHistory(
    sessions: PracticeSession[],
    options: { includeDiscourseMarkers?: boolean } = {},
): ProgressVsBaselineResult {
    return computeProgressVsBaseline(progressInputsFromSessions(sessions, options));
}
