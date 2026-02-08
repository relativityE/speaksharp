import { describe, it, expect } from 'vitest';
import {
    createInitialFillerData,
    countFillerWords,
    calculateTranscriptStats,
    limitArray
} from '@/utils/fillerWordUtils';
import { FILLER_WORD_KEYS } from '@/config';

describe('fillerWordUtils', () => {
    describe('createInitialFillerData', () => {
        it('creates initial data structure with default filler words', () => {
            const result = createInitialFillerData();
            expect(result).toHaveProperty(FILLER_WORD_KEYS.UM);
            expect(result).toHaveProperty(FILLER_WORD_KEYS.UH);
            expect(result).toHaveProperty(FILLER_WORD_KEYS.LIKE);
            expect(result[FILLER_WORD_KEYS.UM]).toEqual({ count: 0, color: expect.any(String) });
        });

        it('includes custom words in data structure', () => {
            const customWords: string[] = ['basically', 'literally'];
            const result = createInitialFillerData(customWords);
            expect(result).toHaveProperty('basically');
            expect(result).toHaveProperty('literally');
            expect(result.basically).toEqual({ count: 0, color: expect.any(String) });
        });
    });

    describe('countFillerWords', () => {
        it('counts basic filler words correctly', () => {
            const text = 'Um, so, like, you know what I mean?'; // Added comma after 'so'
            const result = countFillerWords(text);

            expect(result[FILLER_WORD_KEYS.UM].count).toBe(1);
            expect(result[FILLER_WORD_KEYS.SO].count).toBe(1);
            expect(result[FILLER_WORD_KEYS.LIKE].count).toBe(1);
            expect(result[FILLER_WORD_KEYS.YOU_KNOW].count).toBe(1);
            expect(result[FILLER_WORD_KEYS.I_MEAN].count).toBe(1);
        });

        it('is case insensitive', () => {
            const text = 'Um UM uM umm';
            const result = countFillerWords(text);
            expect(result[FILLER_WORD_KEYS.UM].count).toBe(4);
        });

        it('counts custom words', () => {
            const text = 'I basically think this is literally amazing';
            const result = countFillerWords(text, ['basically', 'literally']);
            expect(result.basically.count).toBe(1);
            expect(result.literally.count).toBe(1);
        });

        it('only matches whole words', () => {
            const text = 'This umbrella is for um... you.';
            const result = countFillerWords(text);
            expect(result[FILLER_WORD_KEYS.UM].count).toBe(1);
        });

        it('uses cached NLP document for identical text', () => {
            const text = 'He said like maybe it is time.';
            // First call
            countFillerWords(text);
            // Second call (hits branch 61-62)
            const result = countFillerWords(text);
            expect(result[FILLER_WORD_KEYS.LIKE].count).toBe(1);
        });

        it('handles non-filler "like" correctly (fallback coverage)', () => {
            // "I like apples" -> "like" is clearly a verb
            const text = 'I like apples';
            const result = countFillerWords(text);
            // Heuristic should reject this "like" (hits branch 156)
            expect(result[FILLER_WORD_KEYS.LIKE].count).toBe(0);
        });
    });

    describe('calculateTranscriptStats', () => {
        it('calculates basic stats correctly', () => {
            const chunks = [
                { text: 'Hello world.' },
                { text: 'This is a test.' }
            ];
            const wordConfidences = [
                { word: 'dummy', confidence: 0.9 },
                { word: 'dummy', confidence: 0.8 },
                { word: 'dummy', confidence: 0.95 },
                { word: 'dummy', confidence: 0.9 },
                { word: 'dummy', confidence: 0.85 },
                { word: 'dummy', confidence: 0.9 },
                { word: 'dummy', confidence: 0.95 },
            ];

            const result = calculateTranscriptStats(chunks, wordConfidences);

            expect(result.transcript).toBe('Hello world. This is a test.');
            expect(result.total_words).toBe(6);
            expect(result.accuracy).toBeCloseTo(0.89, 2);
        });

        it('handles empty inputs', () => {
            const result = calculateTranscriptStats([], []);
            expect(result.transcript).toBe('');
            expect(result.total_words).toBe(0);
            expect(result.accuracy).toBe(0);
        });

        it('includes interim transcript', () => {
            const chunks = [{ text: 'Hello' }];
            const result = calculateTranscriptStats(chunks, [], 'world');
            expect(result.transcript).toBe('Hello world');
            expect(result.total_words).toBe(2);
        });
    });

    describe('limitArray', () => {
        it('limits array to max length', () => {
            const array: number[] = [1, 2, 3, 4, 5];
            const result = limitArray(array, 3);
            expect(result).toEqual([3, 4, 5]);
        });

        it('returns original array if under limit', () => {
            const array: number[] = [1, 2];
            const result = limitArray(array, 5);
            expect(result).toEqual([1, 2]);
        });
    });
});
