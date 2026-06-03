import { useState, useEffect } from 'react';
import { useUsageLimit, type UsageLimitCheck } from './useUsageLimit';
import { safeLocalStorageGetJSON, safeLocalStorageSet } from '@/lib/safeStorage';

const STREAK_STORAGE_KEY = 'speaksharp-streak';

interface StoredStreak {
    currentStreak: number;
    lastPracticeDate: string;
}

const readStoredStreak = (): StoredStreak => {
    const stored = safeLocalStorageGetJSON<Partial<StoredStreak>>(STREAK_STORAGE_KEY, {});
    return {
        currentStreak: typeof stored?.currentStreak === 'number' ? stored.currentStreak : 0,
        lastPracticeDate: typeof stored?.lastPracticeDate === 'string' ? stored.lastPracticeDate : '',
    };
};

export function useStreak() {
    const e2eDeps = (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>).__E2E_DEPS__ : null) as { fetchUsageLimit?: () => Promise<UsageLimitCheck> } | null;
    const { data: usageLimit } = useUsageLimit(e2eDeps || undefined);
    // Safe parse: a corrupted/legacy streak value must never throw in this render-path
    // initializer — a throw here white-screens the whole app shell.
    const [localStreak, setLocalStreak] = useState(() => readStoredStreak().currentStreak);

    useEffect(() => {
        if (usageLimit?.streak_count !== undefined) {
            setLocalStreak(usageLimit.streak_count);
        }
    }, [usageLimit?.streak_count]);

    const updateStreak = () => {
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        const current = readStoredStreak();
        let newStreak = current.currentStreak;
        let isNewDay = false;

        if (current.lastPracticeDate !== today) {
            isNewDay = true;
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (current.lastPracticeDate === yesterdayStr || current.lastPracticeDate === '') {
                newStreak += 1;
            } else {
                newStreak = 1;
            }

            const updated = { currentStreak: newStreak, lastPracticeDate: today };
            safeLocalStorageSet(STREAK_STORAGE_KEY, JSON.stringify(updated));
            setLocalStreak(newStreak);
        }

        return { currentStreak: newStreak, isNewDay };
    };

    return {
        currentStreak: usageLimit?.streak_count ?? localStreak,
        updateStreak
    };
}
