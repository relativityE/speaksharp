/**
 * #1047 — the pure evidence rules behind the authenticated Home header.
 *
 * Kept out of the component so they can be asserted directly: these two functions are the ONLY place
 * that decides whether Home may state a fact about the user's practice. Both fail to an em-dash, never
 * to a zero — a fabricated `0` or `0:00` is indistinguishable from a genuine one and is therefore a
 * false claim, not a neutral default. Validity itself is delegated to the shared #1091 layer.
 */

import { isValidMetric } from '@/utils/metricValidity';
import type { PracticeSession } from '@/types/session';

/**
 * The NARROW shape Home needs — reviewable-session identity + duration only. It mirrors what
 * `sessionService.getRecentReviewable` selects (#1042 PR4): never transcript, scores, WPM or engine
 * data. Home deliberately does not widen that read, which is exactly why some tiles have no source.
 */
export type RecentSession = Pick<PracticeSession, 'id' | 'created_at' | 'duration' | 'status'>;

/** The one string this surface uses when it cannot stand behind a value. */
export const NO_EVIDENCE = '—';

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
 * The last-session secondary line, composed ONLY from persisted columns (created_at, duration).
 * A failed read, an absent session, an unparseable date or a missing duration each yield an
 * em-dash — never a fabricated "0:00" and never a silently dropped button.
 */
export function lastSessionSummary(session: RecentSession | null, failed: boolean): string {
    if (failed || !session) return NO_EVIDENCE;
    const when = formatWhen(session.created_at);
    const duration = isValidMetric(session.duration) && Number(session.duration) > 0
        ? formatClock(Number(session.duration))
        : null;
    const parts = [when, duration].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(' · ') : NO_EVIDENCE;
}

/**
 * Streak text. The ONLY accepted source is the persisted `streak_count` from check-usage-limit; the
 * client-side localStorage streak is a local guess and is deliberately not trusted here. A persisted
 * 0 IS evidence ("no streak") and is shown as such.
 */
export function streakLabel(streakCount: number | null | undefined): string {
    return isValidMetric(streakCount) ? `${Number(streakCount)}-day streak` : `${NO_EVIDENCE} day streak`;
}

