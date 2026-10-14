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
    /** Once resolution starts, retries remain durably bound to this exact repeat session. */
    resolutionSessionId?: string;
    /**
     * #1258 RH-13: when the user accepted it. A reconcile round binds the attempt only to the first owed take enqueued
     * after this moment; an attempt stored before this field existed is bound by the next save, as before.
     */
    acceptedAtIso?: string;
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

/** Clear only the handoff this caller terminally closed; never erase a newer replacement binding. */
export function clearOpenAttemptIfMatches(userId: string, attemptId: string): boolean {
    const current = getOpenAttemptForUser(userId);
    if (!current || current.attemptId !== attemptId) return false;
    if (typeof localStorage === 'undefined') return false;
    try {
        localStorage.removeItem(KEY);
        // Only claim success after authoritative browser-storage readback proves absence.
        return localStorage.getItem(KEY) === null;
    } catch (err) {
        logger.warn({ err, attemptId }, '[progress] matching open-attempt clear failed');
        return false;
    }
}

/**
 * #1258 (Codex P2 r4275389955) — the CLIENT-clock moment a press asked the server to create an attempt for a
 * recommendation. Written before the create call, so when that call commits but its answer is lost, the next press
 * reuses the attempt with its ORIGINAL press time — the same clock as every take start it is compared with. The server's
 * `accepted_at` is never mixed in: a skewed database clock would otherwise reorder an acceptance against a take.
 */
const PRESS_KEY = 'ss_progress_attempt_press_v1';

interface AttemptPress { userId: string; recommendationId: string; pressedAtIso: string }

export function recordAttemptPress(userId: string, recommendationId: string, pressedAtIso: string): void {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(PRESS_KEY, JSON.stringify({ userId, recommendationId, pressedAtIso } satisfies AttemptPress));
    } catch (err) {
        logger.warn({ err }, '[progress] attempt-press write failed');
    }
}

/**
 * #1258 (Codex P2 r4275718056): a recorded press is adopted for a REUSED attempt only when the server accepted that
 * attempt within this window of the press. The press marker names the owner and recommendation but cannot name an
 * attempt id (the create's answer was lost), so a marker left by a create that genuinely failed must not be borrowed by
 * an attempt created later elsewhere. The server time only CONFIRMS identity; ordering stays on the client clock.
 */
export const ATTEMPT_PRESS_MATCH_WINDOW_MS = 120_000;

/** The recorded press if it plausibly created the attempt the server accepted at `serverAcceptedAtIso`; else null. */
export function attemptPressMatching(userId: string, recommendationId: string, serverAcceptedAtIso: string | null): string | null {
    const press = attemptPressFor(userId, recommendationId);
    if (press === null || serverAcceptedAtIso === null) return null;
    const gap = Math.abs(Date.parse(serverAcceptedAtIso) - Date.parse(press));
    return Number.isFinite(gap) && gap <= ATTEMPT_PRESS_MATCH_WINDOW_MS ? press : null;
}

/** The recorded press for exactly this owner and recommendation, or null (unknown — the caller keeps its own press). */
export function attemptPressFor(userId: string, recommendationId: string): string | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(PRESS_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as Partial<AttemptPress> | null;
        return p && p.userId === userId && p.recommendationId === recommendationId && typeof p.pressedAtIso === 'string'
            && Number.isFinite(Date.parse(p.pressedAtIso)) ? p.pressedAtIso : null;
    } catch { return null; }
}

export function clearAttemptPress(userId: string, recommendationId: string): void {
    if (typeof localStorage === 'undefined' || attemptPressFor(userId, recommendationId) === null) return;
    try { localStorage.removeItem(PRESS_KEY); } catch { /* ignore */ }
}
