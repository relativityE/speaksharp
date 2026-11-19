/**
 * #1827 D2 rev 4: the Practice-again intent of THIS tab. The click stores the attempt id in sessionStorage (tab-scoped,
 * unlike the owner-wide open-attempt handoff in localStorage), and the take this tab creates next is registered with
 * that attempt by `register_practice_again_take_v1`. A take started in another tab carries no intent, so it is never
 * registered and the server gives it neither the repeat link nor the tip. Content-free: ids only.
 */
import { getOpenAttemptForUser, setOpenAttempt } from './openAttempt';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';

const KEY = 'speaksharp_practice_again_intent_v1';
export interface PracticeAgainIntent {
    attemptId: string;
    userId: string;
    /** The take the server registered, kept here when the owner-wide handoff write failed (Codex P2), so it is not lost. */
    registeredSessionId?: string;
    /** A take whose registration was sent but not answered (Codex P2): retried with the same session until confirmed. */
    candidateSessionId?: string;
    /**
     * The candidate has already saved and its evaluation is durable, but it could not be bound while its registration was
     * unconfirmed (Codex P2): once confirmed, it is bound as the resolution right away instead of waiting for a settlement
     * that already happened.
     */
    candidateSaved?: boolean;
}

export function setPracticeAgainIntent(intent: PracticeAgainIntent): void {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(KEY, JSON.stringify(intent)); } catch { /* best effort */ }
}

export function clearPracticeAgainIntent(): void {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** This tab's intent for `userId`, only while that attempt is still the owner's open attempt; anything else is cleared. */
export function getPracticeAgainIntent(userId: string): PracticeAgainIntent | null {
    try {
        if (typeof sessionStorage === 'undefined') return null;
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<PracticeAgainIntent>;
        const open = getOpenAttemptForUser(userId);
        if (typeof parsed?.attemptId === 'string' && parsed.userId === userId && open?.attemptId === parsed.attemptId) {
            return { attemptId: parsed.attemptId, userId,
                ...(typeof parsed.registeredSessionId === 'string' ? { registeredSessionId: parsed.registeredSessionId } : {}),
                ...(typeof parsed.candidateSessionId === 'string' ? { candidateSessionId: parsed.candidateSessionId } : {}),
                ...(parsed.candidateSaved === true ? { candidateSaved: true } : {}) };
        }
        sessionStorage.removeItem(KEY);
        return null;
    } catch {
        return null;
    }
}

/**
 * The take registered for the owner's open attempt: the handoff's own record, or this tab's held registration when the
 * handoff write failed. A held registration is written back to the handoff as soon as storage accepts it.
 */
export function registeredTakeFor(userId: string): string | undefined {
    const open = getOpenAttemptForUser(userId);
    if (!open) return undefined;
    if (open.registeredSessionId) return open.registeredSessionId;
    const held = getPracticeAgainIntent(userId)?.registeredSessionId;
    if (held) setOpenAttempt({ ...open, registeredSessionId: held });
    return held;
}

/**
 * At the Practice again press: declare to the server that this attempt's repeat will be registered, so only the registered
 * take can be linked. An attempt an older client records is never declared and keeps the earlier rules (Codex P2). A
 * database without the registration migration has no such function; nothing to declare there. Never blocks the press.
 */
export async function declarePracticeAgainRegistration(attemptId: string): Promise<boolean> {
    try {
        const { data, error } = await getSupabaseClient().rpc('register_practice_again_take_v1', { p_attempt: attemptId, p_session: null });
        if (error) logger.warn({ code: error.code }, '[progress] Practice again registration not declared');
        return !error && data === true;
    } catch {
        logger.warn('[progress] Practice again registration not declared');
        return false;
    }
}

/** Record `sessionId` as the registered take: in the owner-wide handoff, or held by this tab when that write fails. */
export function recordRegisteredTake(userId: string, intent: PracticeAgainIntent, sessionId: string): void {
    const open = getOpenAttemptForUser(userId);
    const stored = open?.attemptId === intent.attemptId && setOpenAttempt({ ...open, registeredSessionId: sessionId });
    const rest: PracticeAgainIntent = { ...intent };
    delete rest.candidateSessionId;
    delete rest.candidateSaved;
    setPracticeAgainIntent(stored ? rest : { ...rest, registeredSessionId: sessionId });
}

/**
 * A registration that was sent but never answered (Codex P2): ask again for the SAME take. The registration RPC is
 * idempotent for the take already registered, so a commit whose response was lost is confirmed here; a take the server
 * never registered is refused, and only then is the candidate dropped. `unknown` (another error) keeps it for the next try.
 */
export type CandidateConfirmation = 'none' | 'confirmed' | 'refused' | 'unknown';
export async function confirmCandidateRegistration(userId: string): Promise<CandidateConfirmation> {
    const intent = getPracticeAgainIntent(userId);
    if (!intent?.candidateSessionId) return 'none';
    if (registeredTakeFor(userId)) return 'confirmed';
    try {
        const { data, error } = await getSupabaseClient().rpc('register_practice_again_take_v1',
            { p_attempt: intent.attemptId, p_session: intent.candidateSessionId });
        if (error) return 'unknown';                                   // still unknown: keep the candidate for the next try
        if (data === true) {
            recordRegisteredTake(userId, intent, intent.candidateSessionId);
            // Already saved and evaluated while unconfirmed: bind it now, so the caller's resolution retry advances it.
            if (intent.candidateSaved) {
                const open = getOpenAttemptForUser(userId);
                if (open?.attemptId === intent.attemptId && !open.resolutionSessionId) {
                    setOpenAttempt({ ...open, registeredSessionId: intent.candidateSessionId, resolutionSessionId: intent.candidateSessionId });
                }
            }
            return 'confirmed';
        }
        const rest: PracticeAgainIntent = { ...intent };
        delete rest.candidateSessionId;
        delete rest.candidateSaved;
        setPracticeAgainIntent(rest);
        return 'refused';
    } catch {
        return 'unknown';
    }
}

/**
 * The registered take was discarded by this client (marked failed): the server releases its registration, and so does the
 * handoff, unless it is already the bound resolution. Keeps the pre-migration fallback from pinning a discarded take.
 */
export function releaseDiscardedTake(sessionId: string): void {
    try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem('ss_progress_open_attempt_v1');
        const open = raw ? JSON.parse(raw) as { userId?: string; registeredSessionId?: string; resolutionSessionId?: string } : null;
        if (!open?.userId || open.resolutionSessionId === sessionId) return;
        const current = getOpenAttemptForUser(open.userId);
        if (!current) return;
        if (current.registeredSessionId === sessionId) {
            const rest = { ...current };
            delete rest.registeredSessionId;
            setOpenAttempt(rest);
        }
        const intent = getPracticeAgainIntent(open.userId);
        if (intent?.registeredSessionId === sessionId || intent?.candidateSessionId === sessionId) {
            const kept: PracticeAgainIntent = { ...intent };
            if (kept.registeredSessionId === sessionId) delete kept.registeredSessionId;
            if (kept.candidateSessionId === sessionId) { delete kept.candidateSessionId; delete kept.candidateSaved; }
            setPracticeAgainIntent(kept);
        }
    } catch { /* best effort: the server has already released it */ }
}

/** Synchronous: whether this tab holds a registration sent but never answered (so callers await only when there is one). */
export function hasRegistrationCandidate(userId: string): boolean {
    return Boolean(getPracticeAgainIntent(userId)?.candidateSessionId);
}

/** The take whose registration is still unconfirmed has saved and been evaluated (called when binding had to wait). */
export function markCandidateSaved(userId: string, sessionId: string): void {
    const intent = getPracticeAgainIntent(userId);
    if (intent?.candidateSessionId === sessionId && !intent.candidateSaved) setPracticeAgainIntent({ ...intent, candidateSaved: true });
}
