import { useState, useCallback } from 'react';

/**
 * Atomic Hook: Tracks filler word counts in real-time.
 * Responsibility: Analyzing transcript segments for filler words (um, ah, like, etc).
 */
export const useFillerWordCounter = (fillerWords: string[] = ['um', 'uh', 'ah', 'like', 'you know']) => {
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [totalCount, setTotalCount] = useState(0);

    const resetCounts = useCallback(() => {
        setCounts({});
        setTotalCount(0);
    }, []);

    const processSegment = useCallback((text: string) => {
        if (!text) return;

        const words = text.toLowerCase().split(/\s+/);
        const newCounts = { ...counts };
        let added = 0;

        words.forEach(word => {
            // Clean word from punctuation
            const cleanWord = word.replace(/[^\w]/g, '');
            if (fillerWords.includes(cleanWord)) {
                newCounts[cleanWord] = (newCounts[cleanWord] || 0) + 1;
                added++;
            }
        });

        if (added > 0) {
            setCounts(newCounts);
            setTotalCount(prev => prev + added);
        }
    }, [counts, fillerWords]);

    return {
        counts,
        totalCount,
        processSegment,
        resetCounts
    };
};
