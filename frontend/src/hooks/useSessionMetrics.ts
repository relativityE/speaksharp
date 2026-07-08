import { useMemo } from 'react';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { calculateCoreSessionMetrics, calculateWpm } from '../utils/sessionAnalysis';
import { isFillerRecountSsotEnabled } from '@/services/telemetry/fillerSsotFlag';
import type { Chunk } from './useSpeechRecognition/types';

interface UseSessionMetricsProps {
    transcript: string;
    chunks: Chunk[];
    fillerData: FillerCounts;
    elapsedTime: number;
    /** Session custom filler words — used by the transcript-recount path (SSOT flag ON). */
    userWords?: string[];
}

interface SessionMetrics {
    formattedTime: string;
    clarityScore: number;
    clarityLabel: string;
    clarityExplanation: string;
    isClarityScorable: boolean;
    wpm: number;
    rollingWpm: number; // Speed in the last 15 seconds
    wpmLabel: string;
    wpmExplanation: string;
    fillerCount: number;
    fillerExplanation: string;
    wordCount: number;
}

/**
 * Custom hook to calculate session metrics
 */
export const useSessionMetrics = ({
    transcript,
    chunks,
    fillerData,
    elapsedTime,
    userWords = [],
}: UseSessionMetricsProps): SessionMetrics => {
    return useMemo(() => {
        // Format elapsed time as MM:SS
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = elapsedTime % 60;
        const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // #891 Phase 5.8 APPLY (flag, DEFAULT OFF): when ON, the filler count comes from the deterministic
        // transcript recount (fillerData undefined → countFillerWords(transcript, userWords)) — matching the
        // save/Analytics/PDF basis — and clarity/score (which read this hook's output) inherit it. When OFF,
        // the live counter (fillerData) drives everything exactly as today.
        const useTranscriptRecount = isFillerRecountSsotEnabled();
        const coreMetrics = calculateCoreSessionMetrics({
            transcript,
            durationSeconds: elapsedTime,
            fillerData: useTranscriptRecount ? undefined : fillerData,
            // OFF stays byte-identical to before (no userWords were passed); userWords only feed the recount.
            userWords: useTranscriptRecount ? userWords : [],
        });

        // Rolling WPM (last 15 seconds)
        const now = Date.now();
        const rollingWindowMs = 15000;
        const recentChunks = chunks.filter(c => now - c.timestamp <= rollingWindowMs);
        const recentWordCount = recentChunks.reduce((acc, c) => acc + c.transcript.split(/\s+/).filter(w => w.length > 0).length, 0);

        // Effective time is the smaller of the window or elapsed time
        const effectiveWindowSec = Math.min(elapsedTime, rollingWindowMs / 1000);
        const rollingWpm = calculateWpm(recentWordCount, effectiveWindowSec);

        return {
            formattedTime,
            clarityScore: coreMetrics.clarityScore,
            clarityLabel: coreMetrics.clarityLabel,
            clarityExplanation: coreMetrics.clarityExplanation,
            isClarityScorable: coreMetrics.isClarityScorable,
            wpm: coreMetrics.wpm,
            rollingWpm,
            wpmLabel: coreMetrics.wpmLabel,
            wpmExplanation: coreMetrics.wpmExplanation,
            fillerCount: coreMetrics.fillerCount,
            fillerExplanation: coreMetrics.fillerExplanation,
            wordCount: coreMetrics.wordCount,
        };
    }, [transcript, chunks, fillerData, elapsedTime, userWords]);
};
