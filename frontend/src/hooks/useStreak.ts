import { useState, useEffect } from 'react';

interface StreakData {
    currentStreak: number;
    lastPracticeDate: string | null;
}

const STORAGE_KEY = 'speaksharp-streak';

export function useStreak() {
    const [streak, setStreak] = useState<StreakData>({
        currentStreak: 0,
        lastPracticeDate: null,
    });

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                setStreak(JSON.parse(stored));
            } catch (e) {
                console.error('Failed to parse streak data', e);
            }
        }
    }, []);

    const updateStreak = () => {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const { currentStreak, lastPracticeDate } = streak;

        if (lastPracticeDate === today) {
            // Already practiced today
            return { currentStreak, isNewDay: false };
        }

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        let newStreak = 1;
        if (lastPracticeDate === yesterdayStr) {
            newStreak = currentStreak + 1;
        }

        const newData = {
            currentStreak: newStreak,
            lastPracticeDate: today,
        };

        setStreak(newData);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));

        return { currentStreak: newStreak, isNewDay: true };
    };

    return {
        currentStreak: streak.currentStreak,
        updateStreak,
    };
}
