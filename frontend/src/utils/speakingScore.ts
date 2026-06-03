import type { PauseMetrics } from '@/services/audio/pauseDetector';
import { ANALYTICS_THRESHOLDS, countTranscriptWords } from './sessionAnalysis';

export const SPEAKSHARP_SCORE_MODEL_VERSION = 'speaking-score-v0.1' as const;

export const SPEAKSHARP_SCORE_WEIGHTS = {
    messageStructure: 0.35,
    deliveryControl: 0.30,
    languageClarity: 0.20,
    audienceImpact: 0.15,
} as const;

export const SPEAKSHARP_CONFIDENCE_THRESHOLDS = {
    MIN_WORDS_FOR_DIRECTIONAL: 25,
    MIN_WORDS_FOR_USABLE: 75,
    MIN_SECONDS_FOR_USABLE: 30,
} as const;

export interface SpeakingScoreInput {
    transcript: string;
    wordCount?: number;
    wpm: number;
    clarityScore: number;
    fillerCount: number;
    elapsedSeconds: number;
    pauseMetrics?: Partial<PauseMetrics>;
    engine?: 'native' | 'private' | 'cloud' | string;
    transcriptionConfidence?: 'low' | 'medium' | 'high';
}

export interface SpeakingScoreBreakdown {
    messageStructure: number;
    deliveryControl: number;
    languageClarity: number;
    audienceImpact: number;
}

export interface SpeakingScoreResult {
    modelVersion: typeof SPEAKSHARP_SCORE_MODEL_VERSION;
    weights: typeof SPEAKSHARP_SCORE_WEIGHTS;
    score: number;
    label: string;
    headline: string;
    actions: string[];
    breakdown: SpeakingScoreBreakdown;
    weakestCategories: (keyof SpeakingScoreBreakdown)[];
    confidence: 'warming-up' | 'directional' | 'usable';
    target: {
        value: number | null;
        label: string;
    };
    transcription: {
        engine?: string;
        confidence: 'low' | 'medium' | 'high';
    };
}

const clamp = (value: number, min = 0, max = 10): number => Math.max(min, Math.min(max, value));

const roundTenth = (value: number): number => Math.round(value * 10) / 10;

const countMatches = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

const getScoreLabel = (score: number): string => {
    if (score >= 8.5) return 'Polished Presenter';
    if (score >= 7) return 'Confident Speaker';
    if (score >= 5) return 'Clear Communicator';
    if (score >= 3) return 'Building Control';
    return 'Getting Started';
};

const scorePace = (wpm: number, wordCount: number): number => {
    if (wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS || wpm <= 0) return 0;
    if (wpm >= 130 && wpm <= 150) return 10;
    if (wpm >= 110 && wpm <= 170) return 8;
    if (wpm > 170 && wpm <= 200) return 5.5;
    if (wpm >= 90 && wpm < 110) return 6;
    return 3.5;
};

const scoreFillers = (fillerCount: number, wordCount: number): number => {
    if (wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS) return 0;
    const fillerRate = (fillerCount / Math.max(1, wordCount)) * 100;
    if (fillerRate <= 1) return 10;
    if (fillerRate <= 5) return 8;
    if (fillerRate <= 12) return 5.5;
    return 2.5;
};

const scorePauses = (pauseMetrics: Partial<PauseMetrics> | undefined, elapsedSeconds: number, wordCount: number): number => {
    if (wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS) return 0;
    const pausesPerMinute = pauseMetrics?.pausesPerMinute ?? 0;
    const averagePauseDuration = pauseMetrics?.averagePauseDuration ?? 0;
    const totalPauses = pauseMetrics?.totalPauses ?? 0;

    if (totalPauses === 0) return elapsedSeconds >= 20 ? 6 : 7;
    if (pausesPerMinute > 12) return 4.5;
    if (averagePauseDuration >= 0.6 && averagePauseDuration <= 2.5) return 9;
    return 7;
};

const scoreMessageStructure = (transcript: string, wordCount: number): number => {
    if (wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS) return 0;

    const normalized = transcript.toLowerCase();
    const sentenceCount = Math.max(1, countMatches(transcript, /[.!?]/g));
    const signpostCount = countMatches(
        normalized,
        /\b(first|second|next|finally|because|so that|for example|the point is|my point is|in short|therefore)\b/g
    );

    const lengthScore = wordCount >= 45 ? 7 : wordCount >= 24 ? 6 : wordCount >= 12 ? 4.5 : 3;
    const structureBonus = Math.min(2, signpostCount * 0.8) + Math.min(1, sentenceCount > 1 ? 1 : 0);
    return clamp(lengthScore + structureBonus);
};

const scoreAudienceImpact = (transcript: string, wordCount: number): number => {
    if (wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS) return 0;

    const normalized = transcript.toLowerCase();
    const takeawayCount = countMatches(
        normalized,
        /\b(you should|we should|i recommend|the takeaway|the point|so you can|so we can|what matters|next step)\b/g
    );
    const exampleCount = countMatches(normalized, /\b(for example|for instance|such as|because|when you|if you)\b/g);

    const base = wordCount >= 35 ? 6 : wordCount >= 14 ? 4.5 : 3;
    return clamp(base + Math.min(2.5, takeawayCount * 1.25) + Math.min(1.5, exampleCount * 0.75));
};

const inferTranscriptionConfidence = (
    engine: SpeakingScoreInput['engine'],
    suppliedConfidence: SpeakingScoreInput['transcriptionConfidence']
): 'low' | 'medium' | 'high' => {
    if (suppliedConfidence) return suppliedConfidence;
    if (engine === 'cloud' || engine === 'private') return 'high';
    if (engine === 'native') return 'medium';
    return 'medium';
};

/**
 * Longest run of words with no sentence-ending punctuation — a transcript-quality
 * proxy. A wall-of-text run-on (common when STT under-punctuates) signals the
 * transcript is not clean enough to present a precise score with full confidence.
 */
export const maxRunOnWords = (transcript: string): number => {
    const spans = (transcript || '').split(/[.!?]+/);
    return spans.reduce((max, span) => {
        const words = span.trim().split(/\s+/).filter(Boolean).length;
        return words > max ? words : max;
    }, 0);
};

const getConfidence = (
    wordCount: number,
    elapsedSeconds: number,
    transcriptionConfidence: 'low' | 'medium' | 'high',
    readabilityWeak: boolean
): SpeakingScoreResult['confidence'] => {
    if (wordCount < SPEAKSHARP_CONFIDENCE_THRESHOLDS.MIN_WORDS_FOR_DIRECTIONAL) return 'warming-up';
    if (
        wordCount < SPEAKSHARP_CONFIDENCE_THRESHOLDS.MIN_WORDS_FOR_USABLE ||
        elapsedSeconds < SPEAKSHARP_CONFIDENCE_THRESHOLDS.MIN_SECONDS_FOR_USABLE ||
        transcriptionConfidence === 'low' ||
        // Weak transcript quality (run-on / under-punctuated) → never present as a
        // precise/usable score. Label only — the 0-10 score math is unchanged.
        readabilityWeak
    ) {
        return 'directional';
    }
    return 'usable';
};

const uniqueActions = (actions: string[]): string[] => [...new Set(actions)].slice(0, 3);

const getWeakestCategories = (breakdown: SpeakingScoreBreakdown): (keyof SpeakingScoreBreakdown)[] =>
    (Object.entries(breakdown) as [keyof SpeakingScoreBreakdown, number][])
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2)
        .map(([category]) => category);

const getNextTarget = (score: number): SpeakingScoreResult['target'] => {
    const nextBoundary = [3, 5, 7, 8.5].find((boundary) => score < boundary);
    if (nextBoundary) {
        return {
            value: nextBoundary,
            label: `Next target ${nextBoundary.toFixed(1)}`,
        };
    }

    return {
        value: null,
        label: 'Hold consistency',
    };
};

export const calculateSpeakingScore = ({
    transcript,
    wordCount: suppliedWordCount,
    wpm,
    clarityScore,
    fillerCount,
    elapsedSeconds,
    pauseMetrics,
    engine,
    transcriptionConfidence: suppliedTranscriptionConfidence,
}: SpeakingScoreInput): SpeakingScoreResult => {
    const wordCount = suppliedWordCount ?? countTranscriptWords(transcript);
    const transcriptionConfidence = inferTranscriptionConfidence(engine, suppliedTranscriptionConfidence);
    const paceScore = scorePace(wpm, wordCount);
    const fillerScore = scoreFillers(fillerCount, wordCount);
    const pauseScore = scorePauses(pauseMetrics, elapsedSeconds, wordCount);

    const breakdown: SpeakingScoreBreakdown = {
        messageStructure: scoreMessageStructure(transcript, wordCount),
        deliveryControl: clamp((paceScore * 0.45) + (fillerScore * 0.35) + (pauseScore * 0.2)),
        languageClarity: wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS
            ? 0
            : clamp(clarityScore / 10),
        audienceImpact: scoreAudienceImpact(transcript, wordCount),
    };

    const score = roundTenth(
        (breakdown.messageStructure * SPEAKSHARP_SCORE_WEIGHTS.messageStructure)
        + (breakdown.deliveryControl * SPEAKSHARP_SCORE_WEIGHTS.deliveryControl)
        + (breakdown.languageClarity * SPEAKSHARP_SCORE_WEIGHTS.languageClarity)
        + (breakdown.audienceImpact * SPEAKSHARP_SCORE_WEIGHTS.audienceImpact)
    );

    const actions: string[] = [];
    if (wordCount < ANALYTICS_THRESHOLDS.MIN_RELIABLE_SCORING_WORDS) {
        actions.push('Start with one complete thought.');
        actions.push('Say the main point before the context.');
    } else {
        if (breakdown.messageStructure < 6) actions.push('Say the main point before the context.');
        if (wpm > 170) actions.push('Give the next key idea a beat of silence.');
        else if (wpm > ANALYTICS_THRESHOLDS.TARGET_WPM_MAX) actions.push('Ease the pace at sentence endings.');
        else if (wpm > 0 && wpm < ANALYTICS_THRESHOLDS.VERY_SLOW_WPM) actions.push('Add a little more momentum through familiar lines.');

        const fillerRate = (fillerCount / Math.max(1, wordCount)) * 100;
        if (fillerRate >= ANALYTICS_THRESHOLDS.NOTICEABLE_FILLER_RATE_PERCENT) {
            actions.push('When a filler is coming, pause and restart.');
        }

        const pausesPerMinute = pauseMetrics?.pausesPerMinute ?? 0;
        const totalPauses = pauseMetrics?.totalPauses ?? 0;
        if (totalPauses === 0 && elapsedSeconds >= 20) actions.push('Pause once before the takeaway.');
        else if (pausesPerMinute > 12) actions.push('Finish a full phrase before taking the next pause.');

        if (breakdown.audienceImpact < 5.5) actions.push('Use one concrete example to make it land.');
    }

    const label = getScoreLabel(score);
    // Transcript-quality gate (label/confidence only — does NOT change the score):
    // a >45-word run-on means the transcript is under-punctuated/unreliable, so the
    // score is presented as directional rather than precise.
    const readabilityWeak = maxRunOnWords(transcript) > 45;
    const confidence = getConfidence(wordCount, elapsedSeconds, transcriptionConfidence, readabilityWeak);
    const headline = confidence === 'warming-up'
        ? 'Speak a little more to get a useful score.'
        : confidence === 'directional'
            ? 'Early signal. Keep going before treating the score as final.'
        : score >= 7
            ? 'Your delivery is landing. Keep tightening the message.'
            : score >= 5
                ? 'You have a clear base. One focused adjustment can lift it.'
                : 'Good practice signal. Make the next attempt simpler and steadier.';

    return {
        modelVersion: SPEAKSHARP_SCORE_MODEL_VERSION,
        weights: SPEAKSHARP_SCORE_WEIGHTS,
        score,
        label,
        headline,
        actions: uniqueActions(actions.length > 0 ? actions : ['Keep the pace steady and land the takeaway.']),
        breakdown,
        weakestCategories: getWeakestCategories(breakdown),
        confidence,
        target: getNextTarget(score),
        transcription: {
            engine,
            confidence: transcriptionConfidence,
        },
    };
};
