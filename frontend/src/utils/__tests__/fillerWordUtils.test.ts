import { describe, expect, it } from 'vitest';
import { countFillerWords } from '../fillerWordUtils';

describe('fillerWordUtils', () => {
    it('treats custom filler words as literal text when building regex patterns', () => {
        const counts = countFillerWords('I say c++ and wait... but not c or plus plus.', ['c++', 'wait...']);

        expect(counts['c++'].count).toBe(1);
        expect(counts['wait...'].count).toBe(1);
    });

    it('counts sentence-start like and so fillers that the transcript UI highlights', () => {
        const counts = countFillerWords('Like I think this is ready. So we should ship it.');

        expect(counts.like.count).toBe(1);
        expect(counts.so.count).toBe(1);
        expect(counts.total.count).toBe(2);
    });

    it('matches transcript highlighting for like and so on analytics recalculation', () => {
        const counts = countFillerWords('I like this because it is so helpful.');

        expect(counts.like.count).toBe(1);
        expect(counts.so.count).toBe(1);
        expect(counts.total.count).toBe(2);
    });

    it('counts pause-delimited like and so fillers', () => {
        const counts = countFillerWords('I was like, ready to continue, so, I kept going.');

        expect(counts.like.count).toBe(1);
        expect(counts.so.count).toBe(1);
        expect(counts.total.count).toBe(2);
    });
});
