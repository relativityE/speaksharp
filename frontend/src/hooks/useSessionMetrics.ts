import { useMemo } from 'react';
import type { FillerCounts } from '@/utils/fillerWordUtils';

interface UseSessionMetricsProps {
    transcript: string;
    fillerData: FillerCounts;
    elapsedTime: number;
}

interface SessionMetrics {
    formattedTime: string;
    clarityScore: number;
    clarityLabel: string;
    wpm: number;
    wpmLabel: string;
    fillerCount: number;
}

/**
 * Custom hook to calculate session metrics
 * Extracted from SessionPage to comply with React Hooks rules
 */
export const useSessionMetrics = ({
    transcript,
    fillerData,
    elapsedTime,
}: UseSessionMetricsProps): SessionMetrics => {
    return useMemo(() => {
        // Format elapsed time as MM:SS
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = elapsedTime % 60;
        const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // Calculate filler word count
        const fillerCount = Object.values(fillerData).reduce((sum, data) => sum + data.count, 0);

        // Calculate words per minute
        const wordCount = transcript.split(' ').filter(w => w.length > 0).length;
        const wpm = elapsedTime > 0 ? Math.round((wordCount / elapsedTime) * 60) : 0;

        // Calculate clarity score (penalize filler words proportionally)
        // Formula: 100% - (filler percentage)
        // Example: 1 filler in 5 words (20%) = 80% clarity
        const clarityScore = fillerCount > 0 && wordCount > 0
            ? Math.max(0, 100 - ((fillerCount / wordCount) * 100))
            : 87;

        // Generate clarity label
        const clarityLabel = clarityScore >= 80
            ? 'Excellent clarity!'
            : clarityScore >= 60
                ? 'Good clarity'
                : 'Keep practicing';

        // Generate WPM label
        const wpmLabel = wpm >= 120 && wpm <= 160
            ? 'Optimal Range'
            : wpm > 160
                ? 'Too Fast'
                : wpm < 60
                    ? ''
                    : 'Too Slow';

        return {
            formattedTime,
            clarityScore,
            clarityLabel,
            wpm,
            wpmLabel,
            fillerCount,
        };
    }, [transcript, fillerData, elapsedTime]);
};
