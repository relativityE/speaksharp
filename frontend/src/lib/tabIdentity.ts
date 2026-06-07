/**
 * Stable per-tab identity for the active-session lock.
 *
 * The active-session lock distinguishes "this tab" from "another tab" by a tabId. Generating a
 * RANDOM tabId per instance/page-load caused false "Active session in another tab" lockouts
 * (LOCK-FALSE-POSITIVE): on reload the new page got a NEW random id while the pre-reload lock was
 * still inside its timeout window, so the same physical tab failed to recognize its own lock; the
 * two lock mechanisms (DistributedLock + useActiveSessionLock) also disagreed within one tab.
 *
 * `sessionStorage` is the correct scope: it PERSISTS across reloads within the same tab and is
 * DISTINCT per tab (and cleared when the tab closes). So the same tab keeps one id across reloads
 * (no self-lockout), while a genuinely different tab still gets a different id (real cross-tab
 * mutex preserved). Falls back to a random id if sessionStorage is unavailable (private mode/SSR).
 */
const TAB_ID_KEY = 'speaksharp_tab_id';

function randomId(): string {
    return Math.random().toString(36).substring(2, 15);
}

export function getStableTabId(): string {
    try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
            const existing = window.sessionStorage.getItem(TAB_ID_KEY);
            if (existing) return existing;
            const fresh = randomId();
            window.sessionStorage.setItem(TAB_ID_KEY, fresh);
            return fresh;
        }
    } catch {
        // sessionStorage blocked (private mode, policy) — fall back to an ephemeral id.
    }
    return randomId();
}
