import { useEffect, useRef, useState } from 'react';

/**
 * #1222 slot D (during) — enforce the **8-second minimum hold** on the live coaching tip (spec §4). A tip
 * is unreadable while speaking if it can be replaced instantly, so a displayed tip must stay for at least
 * `minHoldMs` before the next one takes over. When the hold expires, the LATEST candidate wins (never a
 * stale queued one). One tip at a time — never a stack.
 *
 * `candidate` is what the coaching engine currently wants to show (it may change often); the return value
 * is what should actually be rendered right now. Identity is by `id`.
 */
export function useHeldTip<T extends { id: string }>(candidate: T | null, minHoldMs = 8000): T | null {
    const [displayed, setDisplayed] = useState<T | null>(candidate);
    const shownAtRef = useRef<number>(candidate ? Date.now() : 0);
    const latestRef = useRef<T | null>(candidate);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        latestRef.current = candidate;

        // Nothing shown yet → adopt the first candidate immediately.
        if (!displayed) {
            if (candidate) {
                setDisplayed(candidate);
                shownAtRef.current = Date.now();
            }
            return;
        }

        // Same tip (or candidate cleared) → keep showing the current one; never blank mid-session.
        if (!candidate || candidate.id === displayed.id) return;

        const remaining = minHoldMs - (Date.now() - shownAtRef.current);
        if (remaining <= 0) {
            setDisplayed(candidate);
            shownAtRef.current = Date.now();
            return;
        }

        // Hold still active — swap to whatever is latest once it expires.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            const next = latestRef.current;
            if (next && next.id !== displayed.id) {
                setDisplayed(next);
                shownAtRef.current = Date.now();
            }
        }, remaining);

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [candidate, displayed, minHoldMs]);

    return displayed;
}
