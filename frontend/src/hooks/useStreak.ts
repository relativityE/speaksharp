import { useState, useEffect } from 'react';
import { useUsageLimit } from './useUsageLimit';

export function useStreak() {
    const { data: usageLimit } = useUsageLimit();
    const [localStreak, setLocalStreak] = useState(() => {
        const saved = localStorage.getItem('speaksharp-streak');
        return saved ? JSON.parse(saved).currentStreak : 0;
    });

    useEffect(() => {
        if (usageLimit?.streak_count !== undefined) {
            setLocalStreak(usageLimit.streak_count);
        }
    }, [usageLimit?.streak_count]);

    const updateStreak = () => {
        const saved = localStorage.getItem('speaksharp-streak');
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        const current = saved ? JSON.parse(saved) : { currentStreak: 0, lastPracticeDate: '' };
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
            localStorage.setItem('speaksharp-streak', JSON.stringify(updated));
            setLocalStreak(newStreak);
        }

        return { currentStreak: newStreak, isNewDay };
    };

    return {
        currentStreak: usageLimit?.streak_count ?? localStreak,
        updateStreak
    };
}
