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

    // #894 INVARIANT LOCK: the under-count reported in #894 is UPSTREAM (STT engines omit a spoken filler
    // from the transcript). The counting path itself must always count um/uh/uhm/interjected fillers WHEN
    // PRESENT in the text. These lock that guarantee so a future regression in countFillerWords cannot be
    // mistaken for (or hidden behind) the known engine-recall limitation.
    describe('#894: counts fillers whenever they are present in the transcript text', () => {
        it('counts a sentence-leading "Um."', () => {
            const counts = countFillerWords('Um. Basically, we should wait.');
            expect(counts.um.count).toBe(1);
        });

        it('counts an interjected mid-sentence ", um,"', () => {
            const counts = countFillerWords('so we can move forward without, um, fiddling with settings');
            expect(counts.um.count).toBe(1);
        });

        it('counts the "uhm" spelling as an um filler', () => {
            const counts = countFillerWords('Uhm, basically, we should literally like, wait.');
            expect(counts.um.count).toBe(1);
        });

        it('counts "uh"/"er" as uh fillers when present', () => {
            const counts = countFillerWords('I was, uh, thinking, er, about this.');
            expect(counts.uh.count).toBe(2);
        });

        it('is case-insensitive across um variants', () => {
            const counts = countFillerWords('UM umm Ummm uhm');
            expect(counts.um.count).toBe(4);
        });
    });
});
