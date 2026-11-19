/**
 * #1827 D2 rev 4: the Practice-again intent of THIS tab. The click stores the attempt id in sessionStorage (tab-scoped,
 * unlike the owner-wide open-attempt handoff in localStorage), and the take this tab creates next is registered with
 * that attempt by `register_practice_again_take_v1`. A take started in another tab carries no intent, so it is never
 * registered and the server gives it neither the repeat link nor the tip. Content-free: ids only.
 */
import { getOpenAttemptForUser } from './openAttempt';

const KEY = 'speaksharp_practice_again_intent_v1';
export interface PracticeAgainIntent { attemptId: string; userId: string }

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
            return { attemptId: parsed.attemptId, userId };
        }
        sessionStorage.removeItem(KEY);
        return null;
    } catch {
        return null;
    }
}
