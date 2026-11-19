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
                ...(typeof parsed.registeredSessionId === 'string' ? { registeredSessionId: parsed.registeredSessionId } : {}) };
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
