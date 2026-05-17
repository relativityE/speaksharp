import type { PracticeSession } from '@/types/session';
import { countFillerWords, type FillerCounts } from './fillerWordUtils';

export interface CoreSessionMetrics {
    wordCount: number;
    wpm: number;
    wpmLabel: string;
    fillerCount: number;
    fillerData: FillerCounts;
    clarityScore: number;
    clarityLabel: string;
    errorCount: number;
}

interface CoreSessionMetricsInput {
    transcript: string;
    durationSeconds: number;
    fillerData?: FillerCounts | PracticeSession['filler_words'] | null;
    userWords?: string[];
}

const ERROR_TAG_REGEX = /\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]/gi;

export const countTranscriptWords = (transcript: string): number =>
    transcript.match(/\b[\p{L}\p{N}][\p{L}\p{N}'-]*\b/gu)?.length ?? 0;

export const sumFillerCounts = (fillerWords?: PracticeSession['filler_words'] | FillerCounts | null): number =>
    Object.entries(fillerWords || {}).reduce(
        (sum, [word, data]) => word === 'total' ? sum : sum + (data.count || 0),
        0
    );

export const getFillerTotal = (fillerWords?: PracticeSession['filler_words'] | FillerCounts | null): number => {
    const persistedTotal = fillerWords?.total?.count;
    return typeof persistedTotal === 'number' ? persistedTotal : sumFillerCounts(fillerWords);
};

export const calculateWpm = (wordCount: number, durationSeconds: number): number =>
    durationSeconds > 0 ? Math.round((wordCount / durationSeconds) * 60) : 0;

export const getWpmLabel = (wpm: number): string =>
    wpm >= 130 && wpm <= 150
        ? 'Optimal Range'
        : wpm > 150
            ? 'Too Fast'
            : wpm < 60
                ? ''
                : 'Too Slow';

export const calculateClarityScore = ({
    wordCount,
    fillerCount,
    errorCount,
    wpm,
}: {
    wordCount: number;
    fillerCount: number;
    errorCount: number;
    wpm: number;
}): number => {
    if (wordCount <= 0) return 100;

    const fillerPercentage = (fillerCount / wordCount) * 100;
    const pacePenalty =
        wpm > 170
            ? Math.min(20, (wpm - 170) / 3)
            : wpm > 0 && wpm < 90
                ? Math.min(15, (90 - wpm) / 3)
                : 0;

    return Math.max(0, Math.min(100, Math.round(100 - (fillerPercentage * 1.5) - (errorCount * 3) - pacePenalty)));
};

export const getClarityLabel = (clarityScore: number): string =>
    clarityScore >= 90
        ? 'Excellent clarity!'
        : clarityScore >= 80
            ? 'Great clarity'
            : clarityScore >= 60
                ? 'Good clarity'
                : 'Keep practicing';

export const calculateCoreSessionMetrics = ({
    transcript,
    durationSeconds,
    fillerData,
    userWords = [],
}: CoreSessionMetricsInput): CoreSessionMetrics => {
    const derivedFillerData = fillerData
        ? (fillerData as FillerCounts)
        : countFillerWords(transcript, userWords);
    const wordCount = countTranscriptWords(transcript);
    const wpm = calculateWpm(wordCount, durationSeconds);
    const fillerCount = getFillerTotal(derivedFillerData);
    const errorCount = (transcript.match(ERROR_TAG_REGEX) || []).length;
    const clarityScore = calculateClarityScore({ wordCount, fillerCount, errorCount, wpm });

    return {
        wordCount,
        wpm,
        wpmLabel: getWpmLabel(wpm),
        fillerCount,
        fillerData: derivedFillerData,
        clarityScore,
        clarityLabel: getClarityLabel(clarityScore),
        errorCount,
    };
};

export const getSessionAnalysisMetrics = (session: PracticeSession): CoreSessionMetrics => {
    const persistedFillerCount = getFillerTotal(session.filler_words);
    const transcriptFillerData = countFillerWords(session.transcript || '');
    const transcriptFillerCount = getFillerTotal(transcriptFillerData);
    const shouldUseTranscriptFillers = transcriptFillerCount > persistedFillerCount;
    const fillerData = shouldUseTranscriptFillers ? transcriptFillerData : session.filler_words;
    const metrics = calculateCoreSessionMetrics({
        transcript: session.transcript || '',
        durationSeconds: session.duration || 0,
        fillerData,
    });
    const wordCount = Math.max(metrics.wordCount, session.total_words ?? 0);
    const wpm = session.wpm ?? calculateWpm(wordCount, session.duration || 0);
    const clarityScore = session.clarity_score ?? calculateClarityScore({
        wordCount,
        fillerCount: metrics.fillerCount,
        errorCount: metrics.errorCount,
        wpm,
    });

    return {
        ...metrics,
        wordCount,
        wpm,
        wpmLabel: getWpmLabel(wpm),
        clarityScore,
        clarityLabel: getClarityLabel(clarityScore),
    };
};
