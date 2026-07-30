/**
 * #1047 — the pure evidence rules behind the authenticated Home header.
 *
 * Kept out of the component so they can be asserted directly: this is the ONLY place that decides
 * whether Home may state a fact about the user's practice.
 *
 * The rule is symmetric, and getting only half of it right is the common failure. Home must not
 * fabricate a number — but an em-dash is not a neutral placeholder either. It is a positive claim
 * ("we looked, and there is nothing"), so rendering it while the query is still in flight, or when
 * the read FAILED, asserts an absence we have not established. That is the mirror image of
 * fabrication and just as untrue. Every distinguishable situation therefore gets its own state:
 *
 *   loading  — we have not looked yet. Say nothing about the data.
 *   failed   — we looked and could not see. Say THAT, and never dress it up as emptiness.
 *   empty    — we looked and there is genuinely nothing yet. This is the first-run state.
 *   present  — we have persisted evidence and may state it.
 *
 * A fabricated `0` or `0:00` is never produced in any of them: it is indistinguishable from a
 * genuine zero. Validity itself is delegated to the shared #1091 layer.
 */

import { isValidMetric, NOT_ENOUGH_DATA_COMPACT } from '@/utils/metricValidity';
import type { PracticeSession } from '@/types/session';

/**
 * The NARROW shape Home needs — reviewable-session identity + duration only. It mirrors what
 * `sessionService.getRecentReviewable` selects (#1042 PR4): never transcript, scores, WPM or engine
 * data. Home deliberately does not widen that read, which is exactly why some tiles have no source.
 */
export type RecentSession = Pick<PracticeSession, 'id' | 'created_at' | 'duration' | 'status'>;

/** The four distinguishable situations. They must never render identically. */
export type EvidenceState = 'loading' | 'failed' | 'empty' | 'present';

export interface LastSessionView {
    state: EvidenceState;
    /** What to paint on the secondary line. */
    text: string;
    /** True when `text` is the bare em-dash and therefore needs a visually-hidden explanation. */
    compact: boolean;
    /** Only a present, identified session can be reviewed. */
    canReview: boolean;
}

function formatWhen(iso: string): string | null {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatClock(seconds: number): string {
    const total = Math.round(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The last-session line, composed ONLY from persisted columns (created_at, duration).
 *
 * Each state produces DIFFERENT output, which is the point: "we couldn't read your history" and "you
 * haven't practised yet" are opposite facts and must not share a rendering. A null duration is
 * dropped rather than printed as "0:00".
 */
export function lastSessionView(
    session: RecentSession | null,
    { loading, failed }: { loading: boolean; failed: boolean },
): LastSessionView {
    if (loading) return { state: 'loading', text: 'Checking…', compact: false, canReview: false };
    if (failed) return { state: 'failed', text: 'Couldn’t load', compact: false, canReview: false };
    if (!session) return { state: 'empty', text: 'No sessions yet', compact: false, canReview: false };

    const when = formatWhen(session.created_at);
    const duration = isValidMetric(session.duration) && Number(session.duration) > 0
        ? formatClock(Number(session.duration))
        : null;
    const parts = [when, duration].filter(Boolean) as string[];
    // The session exists and is reviewable even when neither column is displayable (a corrupt
    // timestamp with no duration): the row still leads somewhere, it just cannot describe itself.
    return parts.length > 0
        ? { state: 'present', text: parts.join(' · '), compact: false, canReview: true }
        : { state: 'present', text: NOT_ENOUGH_DATA_COMPACT, compact: true, canReview: true };
}

// The PracticeStreak RPC DTO lives in the storage/domain layer; presentation consumes it (never the
// reverse). Re-exported so existing `homeEvidence` importers keep resolving the same type.
export type { PracticeStreak } from '@/lib/storage';
import type { PracticeStreak } from '@/lib/storage';

/**
 * Streak chip text — the chip is shown ONLY for an earned, active streak of two or more qualifying
 * days. Everything else renders no chip at all (the component hides it; it does not reserve width,
 * show a skeleton, or print a placeholder):
 *   | active, count >= 2                                   | `N-day streak` |
 *   | active count 1 / none / lapsed / zero                | (no chip → null) |
 *   | loading / unavailable / read failure / null timezone | (no chip → null) |
 *   | invalid payload                                      | (fail closed → null) |
 * NEVER `0-day streak`, `1-day streak`, `Start your streak`, or `Streak unavailable`. A failed or
 * unavailable read is fetched and validated as before and may be logged diagnostically, but it is
 * simply not surfaced — a two-plus-day streak is the only user-facing state.
 */
export function streakLabel(streak: PracticeStreak | null | undefined): string | null {
    if (streak?.state !== 'active' || !Number.isInteger(streak.count) || streak.count < 2) {
        return null;
    }
    return `${streak.count}-day streak`;
}
