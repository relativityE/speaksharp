import { useEffect, useState } from 'react';
import { getPracticeStreak, setUserTimezone } from '@/lib/storage';
import type { PracticeStreak } from '@/lib/storage';

type StreakState = { userId: string | null; streak: PracticeStreak | null; loading: boolean };

/**
 * Home-only server-authoritative streak (#1093), keyed by the authenticated user id. On mount and on
 * every account change it:
 *   1. clears the previous account's result immediately and shows the loading skeleton;
 *   2. initializes the account IANA timezone ONCE from the browser (no UTC fallback — an invalid/absent
 *      zone is left NULL, which the reader surfaces as "Streak unavailable");
 *   3. fetches the server-authoritative streak (`get_practice_streak`);
 *   4. applies the result ONLY if the account has not changed since the request began — a stale response
 *      from a previous account is ignored.
 * No localStorage is ever read; the count is derived on the server from durably saved sessions.
 */
export function useHomeStreak(
    userId: string | null | undefined,
): { streak: PracticeStreak | null; loading: boolean } {
    const [state, setState] = useState<StreakState>({ userId: null, streak: null, loading: !!userId });

    useEffect(() => {
        if (!userId) {
            setState({ userId: null, streak: null, loading: false });
            return;
        }
        let active = true;
        // Account change (or first mount): drop any prior result and show the skeleton.
        setState({ userId, streak: null, loading: true });
        void (async () => {
            // Timezone DISCOVERY can throw in a hostile/locked-down environment. If it does, we do NOT
            // fall back to UTC (a wrong tz would give a wrong local-day streak) — we skip initialization
            // and still fetch the persisted server streak, so the chip always settles (never stuck loading).
            let tz: string | null = null;
            try {
                tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
            } catch {
                tz = null;
            }
            if (tz) await setUserTimezone(tz); // initialize-once server-side; safe to call every load
            const next = await getPracticeStreak();
            if (!active) return; // this effect was superseded by an account change — ignore the response
            setState((prev) => (prev.userId === userId ? { userId, streak: next, loading: false } : prev));
        })();
        return () => {
            active = false;
        };
    }, [userId]);

    // Guard the brief window after `userId` changes but before the new effect commits: never surface the
    // previous account's streak — show loading instead.
    if (state.userId !== (userId ?? null)) return { streak: null, loading: !!userId };
    return { streak: state.streak, loading: state.loading };
}
