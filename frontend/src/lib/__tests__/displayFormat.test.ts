import { describe, expect, it } from 'vitest';
import { mmss, plural, PRODUCT_LABEL, shortDate, shortTime, times } from '@/lib/displayFormat';

describe('#1258 punch list §0.2 shared display formatters', () => {
    it('shortDate omits the year this year and includes it for a past year', () => {
        const thisYear = new Date().getFullYear();
        expect(shortDate(new Date(thisYear, 9, 7, 12))).toBe('7 Oct');
        expect(shortDate(new Date(2025, 9, 7, 12))).toBe('7 Oct 2025');
        expect(shortDate('not a date')).toBe('');
    });
    it('shortTime lowercases am/pm where the locale uses it', () => {
        expect(shortTime(new Date(2026, 9, 7, 18, 12))).not.toMatch(/AM|PM/);
    });
    it('mmss, times and plural', () => {
        expect(mmss(46)).toBe('0:46');
        expect(mmss(204)).toBe('3:24');
        expect(times(1)).toBe('1 time');
        expect(times(2)).toBe('2 times');
        expect(plural(1, 'word', 'words')).toBe('1 word');
        expect(plural(73, 'word', 'words')).toBe('73 words');
        expect(PRODUCT_LABEL.open_mic).toBe('Open Mic');
    });
});
