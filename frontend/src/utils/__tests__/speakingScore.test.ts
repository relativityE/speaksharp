import { describe, expect, it } from 'vitest';
import {
    calculateSpeakingScore,
    SPEAKSHARP_CONFIDENCE_THRESHOLDS,
    SPEAKSHARP_SCORE_MODEL_VERSION,
} from '../speakingScore';

const basePauseMetrics = {
    totalPauses: 2,
    averagePauseDuration: 1.1,
    longestPause: 1.6,
    pausesPerMinute: 4,
    silencePercentage: 12,
    transitionPauses: 2,
    extendedPauses: 0,
};

describe('calculateSpeakingScore', () => {
    it('returns a warming-up score with simple starter actions before enough speech exists', () => {
        const result = calculateSpeakingScore({
            transcript: '',
            wpm: 0,
            clarityScore: 0,
            fillerCount: 0,
            elapsedSeconds: 0,
            pauseMetrics: basePauseMetrics,
        });

        expect(result.score).toBe(0);
        expect(result.confidence).toBe('warming-up');
        expect(result.modelVersion).toBe(SPEAKSHARP_SCORE_MODEL_VERSION);
        expect(result.actions).toEqual([
            'Start with one complete thought.',
            'Say the main point before the context.',
        ]);
    });

    it('rewards structured speech with steady pace, low fillers, and useful pauses', () => {
        const result = calculateSpeakingScore({
            transcript: 'The point is simple. First, practice privately because it builds confidence. For example, one focused rehearsal makes the next meeting easier.',
            wpm: 140,
            clarityScore: 96,
            fillerCount: 0,
            elapsedSeconds: 45,
            pauseMetrics: basePauseMetrics,
        });

        expect(result.score).toBeGreaterThanOrEqual(7);
        expect(result.label).toMatch(/Confident Speaker|Polished Presenter/);
        expect(result.actions.length).toBeLessThanOrEqual(3);
        expect(result.target.label).toMatch(/Next target|Hold consistency/);
    });

    it('turns fast pacing and filler rate into short actionable coaching', () => {
        const result = calculateSpeakingScore({
            transcript: 'I think like the main idea is that we should move faster because the client needs an answer and like this would help.',
            wpm: 190,
            clarityScore: 62,
            fillerCount: 3,
            elapsedSeconds: 28,
            pauseMetrics: {
                ...basePauseMetrics,
                totalPauses: 0,
                pausesPerMinute: 0,
            },
        });

        expect(result.actions).toContain('Give the next key idea a beat of silence.');
        expect(result.actions).toContain('When a filler is coming, pause and restart.');
        expect(result.actions.length).toBeLessThanOrEqual(3);
    });

    it('uses explicit confidence thresholds for short and usable samples', () => {
        const shortTranscript = Array(SPEAKSHARP_CONFIDENCE_THRESHOLDS.MIN_WORDS_FOR_DIRECTIONAL).fill('word').join(' ');
        const usableTranscript = Array(SPEAKSHARP_CONFIDENCE_THRESHOLDS.MIN_WORDS_FOR_USABLE).fill('word').join(' ');

        const directional = calculateSpeakingScore({
            transcript: shortTranscript,
            wpm: 120,
            clarityScore: 88,
            fillerCount: 0,
            elapsedSeconds: 20,
            pauseMetrics: basePauseMetrics,
        });
        const usable = calculateSpeakingScore({
            transcript: usableTranscript,
            wpm: 140,
            clarityScore: 92,
            fillerCount: 0,
            elapsedSeconds: SPEAKSHARP_CONFIDENCE_THRESHOLDS.MIN_SECONDS_FOR_USABLE,
            pauseMetrics: basePauseMetrics,
        });

        expect(directional.confidence).toBe('directional');
        expect(usable.confidence).toBe('usable');
    });

    it('keeps low-transcription-confidence samples directional even with enough words', () => {
        const transcript = Array(100).fill('word').join(' ');
        const result = calculateSpeakingScore({
            transcript,
            wpm: 140,
            clarityScore: 90,
            fillerCount: 0,
            elapsedSeconds: 60,
            pauseMetrics: basePauseMetrics,
            transcriptionConfidence: 'low',
        });

        expect(result.confidence).toBe('directional');
        expect(result.transcription.confidence).toBe('low');
    });

    it('keeps filler impact in delivery control instead of language clarity', () => {
        const transcript = Array(80).fill('word').join(' ');
        const clean = calculateSpeakingScore({
            transcript,
            wpm: 140,
            clarityScore: 80,
            fillerCount: 0,
            elapsedSeconds: 45,
            pauseMetrics: basePauseMetrics,
        });
        const fillerHeavy = calculateSpeakingScore({
            transcript,
            wpm: 140,
            clarityScore: 80,
            fillerCount: 15,
            elapsedSeconds: 45,
            pauseMetrics: basePauseMetrics,
        });

        expect(fillerHeavy.breakdown.deliveryControl).toBeLessThan(clean.breakdown.deliveryControl);
        expect(fillerHeavy.breakdown.languageClarity).toBe(clean.breakdown.languageClarity);
    });

    it('is deterministic for identical input', () => {
        const input = {
            transcript: 'The point is simple. First we practice privately. For example one focused rehearsal makes the next meeting easier.',
            wpm: 140,
            clarityScore: 90,
            fillerCount: 0,
            elapsedSeconds: 35,
            pauseMetrics: basePauseMetrics,
        };

        expect(calculateSpeakingScore(input)).toEqual(calculateSpeakingScore(input));
    });
});
