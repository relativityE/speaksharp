/**
 * #1827 D2 rev 4: Practice again → the exact repeat.
 *
 * ONE authoritative repeat identity: the server's `progress_recommendation_attempts.registered_session_id`. The client
 * keeps no copy of it. It holds only the tab-scoped INTENT (sessionStorage: which attempt this tab's next Start belongs
 * to); the take that tab creates next is registered by `register_practice_again_take_v1`, and only that Start ever
 * registers. Every later decision (save, reload, retry) READS the server's registered take (`readRepeatIdentity`); a
 * lost reply is answered by the next read, a discarded take is released by the server, and nothing local can go stale.
 * A take from another tab carries no intent, so it is never registered and never gets the link or the tip.
 * Content-free: ids only.
 */
import { getOpenAttemptForUser } from './openAttempt';
import { getSupabaseClient } from '@/lib/supabaseClient';
import logger from '@/lib/logger';

const KEY = 'speaksharp_practice_again_intent_v1';
export interface PracticeAgainIntent { attemptId: string; userId: string }

export function setPracticeAgainIntent(intent: PracticeAgainIntent): void {
    try {
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(KEY, JSON.stringify({ attemptId: intent.attemptId, userId: intent.userId }));
    } catch { /* best effort */ }
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
            return { attemptId: parsed.attemptId, userId };
        }
        sessionStorage.removeItem(KEY);
        return null;
    } catch {
        return null;
    }
}

/**
 * At the Practice again press: declare to the server that this attempt's repeat will be registered, so only the registered
 * take can be linked. An attempt an older client records is never declared and keeps the earlier rules. A database without
 * the registration migration has no such function; nothing to declare there. Never blocks the press.
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

/**
 * The server's answer to "which take is this attempt's repeat?" — read-only, never a registration.
 *   registered: the take registered from the Practice-again tab.
 *   awaiting:   registration is required and nothing has committed: bind nothing (never guess).
 *   legacy:     an older client's attempt, or a database before the registration migration: the earlier first-take rules.
 *   unknown:    the read failed: decide nothing now; the next save or load reads again.
 */
export type RepeatIdentity =
    | { kind: 'registered'; sessionId: string }
    | { kind: 'awaiting' }
    | { kind: 'legacy' }
    | { kind: 'unknown' };

/** A database without 20261119120000 has neither column: PostgREST reports an unknown column. */
const missingRegistrationColumns = (error: { code?: string; message?: string }) =>
    error.code === '42703' || error.code === 'PGRST204' || /registered_session_id|registration_required/.test(error.message ?? '');

export async function readRepeatIdentity(attemptId: string): Promise<RepeatIdentity> {
    try {
        const { data, error } = await getSupabaseClient().from('progress_recommendation_attempts')
            .select('registered_session_id, registration_required').eq('id', attemptId).maybeSingle();
        if (error) return missingRegistrationColumns(error) ? { kind: 'legacy' } : { kind: 'unknown' };
        const row = data as { registered_session_id?: string | null; registration_required?: boolean | null } | null;
        if (!row) return { kind: 'unknown' };
        if (typeof row.registered_session_id === 'string') return { kind: 'registered', sessionId: row.registered_session_id };
        return row.registration_required ? { kind: 'awaiting' } : { kind: 'legacy' };
    } catch {
        return { kind: 'unknown' };
    }
}

/**
 * A registration request for this tab's take that did not reach a definitive answer (it failed before committing, or its
 * reply was lost). It is re-sent ONCE for the SAME take just before that take completes, while the server still accepts
 * it (a completed or failed take is refused). Not a repeat identity: the server's answer is never stored, and if this
 * retry also fails the take stays unregistered (never guessed). Tab-scoped (sessionStorage), ids only.
 */
const PENDING_KEY = 'speaksharp_practice_again_pending_registration_v1';
export function notePendingRegistration(attemptId: string, sessionId: string): void {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(PENDING_KEY, JSON.stringify({ attemptId, sessionId })); } catch { /* best effort */ }
}
export function clearPendingRegistration(): void {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}
/** Re-send the pending registration for `sessionId`, once, before it completes. Never throws; never blocks the save. */
export async function retryPendingRegistration(sessionId: string): Promise<void> {
    let pending: { attemptId?: unknown; sessionId?: unknown } | null = null;
    try {
        const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(PENDING_KEY);
        pending = raw ? JSON.parse(raw) : null;
    } catch { pending = null; }
    if (!pending || pending.sessionId !== sessionId || typeof pending.attemptId !== 'string') return;
    clearPendingRegistration();                                         // once: no loop, no other take
    try {
        const { error } = await getSupabaseClient().rpc('register_practice_again_take_v1', { p_attempt: pending.attemptId, p_session: sessionId });
        if (error) logger.warn({ code: error.code }, '[progress] Practice again registration retry failed');
    } catch {
        logger.warn('[progress] Practice again registration retry failed');
    }
}
