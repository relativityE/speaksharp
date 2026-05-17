import { useMemo } from 'react';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { calculateCoreSessionMetrics } from '@/utils/sessionAnalysis';
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

        const coreMetrics = calculateCoreSessionMetrics({
            transcript,
            durationSeconds: elapsedTime,
            fillerData,
        });

        // Rolling WPM (last 15 seconds)
        const now = Date.now();
        const rollingWindowMs = 15000;
        const recentChunks = chunks.filter(c => now - c.timestamp <= rollingWindowMs);
        const recentWordCount = recentChunks.reduce((acc, c) => acc + c.transcript.split(/\s+/).filter(w => w.length > 0).length, 0);

        // Effective time is the smaller of the window or elapsed time
        const effectiveWindowSec = Math.min(elapsedTime, rollingWindowMs / 1000);
        const rollingWpm = effectiveWindowSec > 0 ? Math.round((recentWordCount / effectiveWindowSec) * 60) : 0;

        return {
            formattedTime,
            clarityScore: coreMetrics.clarityScore,
            clarityLabel: coreMetrics.clarityLabel,
            wpm: coreMetrics.wpm,
            rollingWpm,
            wpmLabel: coreMetrics.wpmLabel,
            fillerCount: coreMetrics.fillerCount,
        };
    }, [transcript, chunks, fillerData, elapsedTime]);
};
