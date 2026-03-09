import { describe, it, expect } from 'vitest';
import { SPEECH_FIXTURES, SpeechFixture } from '../fixtures/stt-isomorphic/speech-metadata.isomorphic';
import { HARVARD_SENTENCES } from '../fixtures/stt-isomorphic/harvard-sentences';
import { calculateWordErrorRate } from '../../frontend/src/lib/wer';

/**
 * SpeakSharp: STT Correctness Regression Suite (Phase 1)
 * 🔬 Objective: Validate that the Word Error Rate (WER) algorithm and 
 *                baseline fixtures operate correctly before running live ML benchmarks.
 */

describe('STT Correctness Baseline Suite', () => {

    describe('Harvard Sentences (Ground Truth Stability)', () => {
        it('should have exactly 10 phonetically balanced sentences', () => {
            expect(HARVARD_SENTENCES).toHaveLength(10);
        });
    });

    describe('Word Error Rate (WER) Logic', () => {
        it('should return 0.0 for an exact word-for-word match', () => {
            const ref = 'This is a perfect transcript';
            const hyp = 'This is a perfect transcript';
            expect(calculateWordErrorRate(ref, hyp)).toBe(0.0);
        });

        it('should be case-insensitive', () => {
            expect(calculateWordErrorRate('hello', 'HELLO')).toBe(0.0);
        });

        it('should calculate 1/N for a single substitution', () => {
            const ref = 'the quick brown fox';
            const hyp = 'the slow brown fox'; // 'quick' -> 'slow'
            expect(calculateWordErrorRate(ref, hyp)).toBe(0.25);
        });

        it('should calculate 1/N for a single deletion', () => {
            const ref = 'the quick brown fox';
            const hyp = 'the brown fox'; // 'quick' deleted
            expect(calculateWordErrorRate(ref, hyp)).toBe(0.25);
        });

        it('should calculate 1/N for a single insertion', () => {
            const ref = 'the brown fox';
            const hyp = 'the quick brown fox'; // 'quick' inserted
            // WER = (S+D+I)/N_ref = (0+0+1)/3 = 0.333...
            expect(calculateWordErrorRate(ref, hyp)).toBeCloseTo(0.333, 3);
        });

        it('should return 1.0 if the hypothesis is completely different', () => {
            const ref = 'apple banana';
            const hyp = 'cherry date';
            expect(calculateWordErrorRate(ref, hyp)).toBe(1.0);
        });
    });

    describe('Isomorphic Speech Fixtures', () => {
        const fixtures = Object.values(SPEECH_FIXTURES);

        fixtures.forEach((speech: SpeechFixture) => {
            describe(`Speech: ${speech.id}`, () => {
                it('should detect required filler words accurately from ground truth', () => {
                    const fillers = Object.entries(speech.expectedFillers)
                        .filter(([, count]) => count > 0)
                        .map(([filler]) => filler);

                    if (fillers.length === 0) return;

                    const transcript = speech.expectedTranscript.toLowerCase();
                    fillers.forEach(filler => {
                        expect(transcript).toContain(filler.toLowerCase());
                    });
                });

                it('should accurately match expected filler counts in ground truth', () => {
                    const counts = speech.expectedFillers;
                    if (Object.keys(counts).length === 0) return;

                    Object.entries(counts).forEach(([filler, expected]) => {
                        const occurrences = (speech.expectedTranscript.toLowerCase().match(new RegExp(`\\b${filler}\\b`, 'g')) || []).length;
                        expect(occurrences).toBe(expected);
                    });
                });
            });
        });
    });
});
