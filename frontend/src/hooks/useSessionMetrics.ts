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
        // Use the pre-calculated 'total' field if available, otherwise sum (but filter out 'total' key to avoid double counting)
        const fillerCount = fillerData.total
            ? fillerData.total.count
            : Object.entries(fillerData)
                .filter(([key]) => key !== 'total')
                .reduce((sum, [, data]) => sum + data.count, 0);

        // Calculate words per minute
        const wordCount = transcript.split(' ').filter(w => w.length > 0).length;
        const wpm = elapsedTime > 0 ? Math.round((wordCount / elapsedTime) * 60) : 0;

        // Calculate clarity score (penalize filler words AND error tags)
        // Formula: Start at 100. Deduct 2% for every 1% of fillers. Deduct 5 points for every error tag.

        // 1. Count error tags
        const errorTagRegex = /\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]/gi;
        const errorMatches = transcript.match(errorTagRegex) || [];
        const errorCount = errorMatches.length;

        // 2. Helper variables
        const fillerPercentage = wordCount > 0 ? (fillerCount / wordCount) * 100 : 0;

        // 3. Calculate Deductions
        // - Filler Penalty: 1.5x deduction (e.g. 5% fillers = 7.5 points off)
        const fillerPenalty = fillerPercentage * 1.5;
        // - Error Tag Penalty: Fixed points per error (e.g. 3 points per [inaudible])
        const errorPenalty = errorCount * 3;

        let calculatedScore = 100 - fillerPenalty - errorPenalty;

        // normalize
        calculatedScore = Math.min(100, Math.max(0, Math.round(calculatedScore)));

        const clarityScore = wordCount > 0 ? calculatedScore : 100;

        // Generate clarity label
        const clarityLabel = clarityScore >= 90
            ? 'Excellent clarity!'
            : clarityScore >= 80
                ? 'Great clarity'
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
