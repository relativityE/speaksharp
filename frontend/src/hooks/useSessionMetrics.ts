import { useMemo } from 'react';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import type { Chunk } from './useSpeechRecognition/types';

interface UseSessionMetricsProps {
    transcript: string;
    chunks: Chunk[];
    fillerData: FillerCounts;
    elapsedTime: number;
}

interface SessionMetrics {
    formattedTime: string;
    clarityScore: number;
    clarityLabel: string;
    wpm: number;
    rollingWpm: number; // Speed in the last 15 seconds
    wpmLabel: string;
    fillerCount: number;
}

/**
 * Custom hook to calculate session metrics
 */
export const useSessionMetrics = ({
    transcript,
    chunks,
    fillerData,
    elapsedTime,
}: UseSessionMetricsProps): SessionMetrics => {
    return useMemo(() => {
        // Format elapsed time as MM:SS
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = elapsedTime % 60;
        const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // Calculate filler word count
        const fillerCount = fillerData.total
            ? fillerData.total.count
            : Object.entries(fillerData)
                .filter(([key]) => key !== 'total')
                .reduce((sum, [, data]) => sum + data.count, 0);

        // --- WPM Calculations ---
        const wordCount = transcript.split(/\s+/).filter(w => w.length > 0).length;
        const wpm = elapsedTime > 0 ? Math.round((wordCount / elapsedTime) * 60) : 0;

        // Rolling WPM (last 15 seconds)
        const now = Date.now();
        const rollingWindowMs = 15000;
        const recentChunks = chunks.filter(c => now - c.timestamp <= rollingWindowMs);
        const recentWordCount = recentChunks.reduce((acc, c) => acc + c.text.split(/\s+/).filter(w => w.length > 0).length, 0);

        // Effective time is the smaller of the window or elapsed time
        const effectiveWindowSec = Math.min(elapsedTime, rollingWindowMs / 1000);
        const rollingWpm = effectiveWindowSec > 0 ? Math.round((recentWordCount / effectiveWindowSec) * 60) : 0;

        // --- Clarity & Labels ---
        const errorTagRegex = /\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]/gi;
        const errorCount = (transcript.match(errorTagRegex) || []).length;
        const fillerPercentage = wordCount > 0 ? (fillerCount / wordCount) * 100 : 0;

        const calculatedScore = Math.max(0, Math.min(100, Math.round(100 - (fillerPercentage * 1.5) - (errorCount * 3))));
        const clarityScore = wordCount > 0 ? calculatedScore : 100;

        const clarityLabel = clarityScore >= 90 ? 'Excellent clarity!' : clarityScore >= 80 ? 'Great clarity' : clarityScore >= 60 ? 'Good clarity' : 'Keep practicing';

        // Update WPM label with 130-150 optimal range
        const wpmLabel = wpm >= 130 && wpm <= 150
            ? 'Optimal Range'
            : wpm > 150
                ? 'Too Fast'
                : wpm < 60
                    ? ''
                    : 'Too Slow';

        return {
            formattedTime,
            clarityScore,
            clarityLabel,
            wpm,
            rollingWpm,
            wpmLabel,
            fillerCount,
        };
    }, [transcript, chunks, fillerData, elapsedTime]);
};
