/**
 * #1045 — the single "open" recommendation attempt the user accepted with "Practice this next", pending
 * the next session that will resolve it. Owner-scoped, localStorage-backed so it survives navigation into
 * the recording surface and a reload. Exactly one open attempt at a time (accepting a new one replaces it).
 */
import logger from '@/lib/logger';

const KEY = 'ss_progress_open_attempt_v1';

export interface OpenAttempt {
    attemptId: string;
    userId: string;
    /** The session the recommendation was shown on — for observability only; comparability is server-side. */
    sourceSessionId: string;
}

export function setOpenAttempt(a: OpenAttempt): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
        localStorage.setItem(KEY, JSON.stringify(a));
        return localStorage.getItem(KEY) === JSON.stringify(a);
    } catch (err) {
        logger.warn({ err }, '[progress] open-attempt write failed');
        return false;
    }
}

export function getOpenAttemptForUser(userId: string): OpenAttempt | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const a = JSON.parse(raw) as OpenAttempt;
        if (a && a.userId === userId && typeof a.attemptId === 'string') return a;
        return null;
    } catch { return null; }
}

export function clearOpenAttempt(): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
