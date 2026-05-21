import type { PracticeSession } from '@/types/session';
import { countFillerWords, type FillerCounts } from './fillerWordUtils';

export interface CoreSessionMetrics {
    wordCount: number;
    wpm: number;
    wpmLabel: string;
    wpmExplanation: string;
    fillerCount: number;
    fillerData: FillerCounts;
    fillerExplanation: string;
    clarityScore: number;
    clarityLabel: string;
    clarityExplanation: string;
    isClarityScorable: boolean;
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

export const getWpmExplanation = (wpm: number, wordCount: number): string => {
    if (wordCount <= 0 || wpm <= 0) return 'Waiting for enough transcribed speech to measure pace.';
    if (wpm >= 130 && wpm <= 150) return 'You are inside the target 130-150 WPM range.';
    if (wpm > 150) return 'You are above the target range; slow slightly so listeners can track each idea.';
    if (wpm < 60) return 'This is too little speech to judge pace reliably yet.';
    return 'You are below the target range; tighten pauses or add a little energy.';
};

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
    if (wordCount <= 0) return 0;

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

export const getClarityExplanation = ({
    wordCount,
    fillerCount,
    errorCount,
    wpm,
}: {
    wordCount: number;
    fillerCount: number;
    errorCount: number;
    wpm: number;
}): string => {
    if (wordCount <= 0) {
        return 'No transcript was captured, so clarity cannot be scored yet.';
    }
    if (errorCount > 0) {
        return 'The transcript contains inaudible or error markers, which lowers the score.';
    }
    if (fillerCount > 0) {
        return `${fillerCount} filler ${fillerCount === 1 ? 'word is' : 'words are'} lowering this score.`;
    }
    if (wordCount < 12) {
        return 'This sample is short; treat the score as a rough signal until more speech is captured.';
    }
    if (wpm > 170) {
        return 'Fast pacing is lowering the score because it can reduce listener comprehension.';
    }
    if (wpm > 0 && wpm < 90) {
        return 'Slow pacing is lowering the score because the delivery may feel fragmented.';
    }
    return 'No filler words or transcript errors were detected in this sample.';
};

export const getFillerExplanation = (fillerCount: number, wordCount: number): string => {
    if (wordCount <= 0) return 'No transcript was captured, so filler words cannot be verified yet.';
    if (fillerCount === 0) return 'No filler words were detected in the captured transcript.';
    const rate = (fillerCount / Math.max(1, wordCount)) * 100;
    return `${fillerCount} filler ${fillerCount === 1 ? 'word' : 'words'} detected, about ${rate.toFixed(1)}% of captured words.`;
};

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
    const isClarityScorable = wordCount > 0;

    return {
        wordCount,
        wpm,
        wpmLabel: getWpmLabel(wpm),
        wpmExplanation: getWpmExplanation(wpm, wordCount),
        fillerCount,
        fillerData: derivedFillerData,
        fillerExplanation: getFillerExplanation(fillerCount, wordCount),
        clarityScore,
        clarityLabel: isClarityScorable ? getClarityLabel(clarityScore) : 'Not enough speech to score',
        clarityExplanation: getClarityExplanation({ wordCount, fillerCount, errorCount, wpm }),
        isClarityScorable,
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
        wpmExplanation: getWpmExplanation(wpm, wordCount),
        clarityScore,
        clarityLabel: wordCount > 0 ? getClarityLabel(clarityScore) : 'Not enough speech to score',
        clarityExplanation: getClarityExplanation({
            wordCount,
            fillerCount: metrics.fillerCount,
            errorCount: metrics.errorCount,
            wpm,
        }),
        fillerExplanation: getFillerExplanation(metrics.fillerCount, wordCount),
        isClarityScorable: wordCount > 0,
    };
};
