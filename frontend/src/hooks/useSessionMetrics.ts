import { useMemo } from 'react';
import type { FillerCounts } from '@/utils/fillerWordUtils';
import { calculateCoreSessionMetrics, calculateWpm } from '../utils/sessionAnalysis';
import type { Chunk } from './useSpeechRecognition/types';

interface UseSessionMetricsProps {
    transcript: string;
    chunks: Chunk[];
    fillerData: FillerCounts;
    /** LIVE timer for the NEXT recording. Drives `formattedTime` only — the visible MM:SS. */
    elapsedTime: number;
    /**
     * #1089: the SCORING duration — the spoken length of the session currently under review. Defaults
     * to `elapsedTime` (they are the same while recording). After a stop the live timer resets to 0 so
     * the Ready surface can honestly show 00:00, but WPM, pace and clarity must keep dividing by the
     * completed take's real length; passing the store's `completedSessionDurationSeconds` here keeps
     * those two jobs from fighting over one number.
     */
    scoringDurationSeconds?: number;
    /** Accepted for call-site compatibility; NOT used to route the canonical filler source. */
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
    /** Filler DETAIL rows — always the LIVE counter (canonical); coherent with fillerCount. */
    fillerData: FillerCounts;
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
    scoringDurationSeconds,
}: UseSessionMetricsProps): SessionMetrics => {
    return useMemo(() => {
        // The visible timer and the scoring denominator are deliberately separate (#1089).
        const scoringSeconds = scoringDurationSeconds ?? elapsedTime;
        // Format elapsed time as MM:SS
        const minutes = Math.floor(elapsedTime / 60);
        const seconds = elapsedTime % 60;
        const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

        // #SSOT (Product Owner decision): the LIVE filler counter is the ONLY user-facing filler source.
        // There is NO runtime/PostHog/env flag that can route the visible filler count / clarity / score to a
        // transcript recount — the recount is diagnostic/fallback only, handled in the save/analytics/PDF
        // readers, never here. Always pass the live `fillerData`; never `fillerData: undefined`.
        const coreMetrics = calculateCoreSessionMetrics({
            transcript,
            durationSeconds: scoringSeconds,
            fillerData,
            userWords: [],
        });

        // Rolling WPM (last 15 seconds)
        const now = Date.now();
        const rollingWindowMs = 15000;
        const recentChunks = chunks.filter(c => now - c.timestamp <= rollingWindowMs);
        const recentWordCount = recentChunks.reduce((acc, c) => acc + c.transcript.split(/\s+/).filter(w => w.length > 0).length, 0);

        // Effective time is the smaller of the window or elapsed time
        const effectiveWindowSec = Math.min(scoringSeconds, rollingWindowMs / 1000);
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
            // Always the LIVE counter's detail rows — canonical, coherent with fillerCount. No flag path.
            fillerData,
            fillerExplanation: coreMetrics.fillerExplanation,
            wordCount: coreMetrics.wordCount,
        };
    }, [transcript, chunks, fillerData, elapsedTime, scoringDurationSeconds]);
};
