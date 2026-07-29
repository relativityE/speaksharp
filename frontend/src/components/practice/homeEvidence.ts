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

/**
 * Streak text — or `null`, meaning "render nothing at all".
 *
 * `streak_count` is declared on the check-usage-limit response type but NOTHING produces it: the edge
 * function blind-casts the RPC result and `public.check_usage_limit` returns no streak key, so in
 * production the value is permanently absent. (`git grep -i streak backend/` finds only that dead
 * interface line; the MSW and E2E fixtures inject `streak_count: 0`, which is why it appears to work
 * in dev and in screenshots.) A chip that can never show a number is decoration, not an honest
 * placeholder, so it is omitted entirely rather than rendered as a permanent em-dash. The localStorage
 * streak in `useStreak` is a client-side guess and is deliberately NOT substituted here.
 *
 * A persisted `0` IS evidence ("no current streak") and is rendered. Server-side streak persistence is
 * a separate follow-up, not this PR.
 */
export function streakLabel(streakCount: number | null | undefined): string | null {
    return isValidMetric(streakCount) ? `${Number(streakCount)}-day streak` : null;
}
