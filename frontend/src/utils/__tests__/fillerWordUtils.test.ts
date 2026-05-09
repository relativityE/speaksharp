import { describe, expect, it } from 'vitest';
import { countFillerWords } from '../fillerWordUtils';

describe('fillerWordUtils', () => {
    it('treats custom filler words as literal text when building regex patterns', () => {
        const counts = countFillerWords('I say c++ and wait... but not c or plus plus.', ['c++', 'wait...']);

        expect(counts['c++'].count).toBe(1);
        expect(counts['wait...'].count).toBe(1);
    });
});
