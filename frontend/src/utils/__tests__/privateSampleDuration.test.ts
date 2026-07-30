import { describe, it, expect } from 'vitest';
import {
    sampleWholeMinutes,
    formatTrialAllotmentTitle,
    formatTrialRemainingTitle,
    formatSampleCapLine,
} from '../privateSampleDuration';

describe('privateSampleDuration — server-derived, never-overstating duration copy (#1047)', () => {
    it('sampleWholeMinutes: exact whole minutes, else null (no mis-rounding)', () => {
        expect(sampleWholeMinutes(300)).toBe(5);
        expect(sampleWholeMinutes(600)).toBe(10);
        expect(sampleWholeMinutes(330)).toBeNull();   // 5.5 min — NOT claimed as a number
        expect(sampleWholeMinutes(0)).toBeNull();
        expect(sampleWholeMinutes(-60)).toBeNull();
        expect(sampleWholeMinutes(Number.NaN)).toBeNull();
    });

    it('fresh allotment title: exact whole-minute → "N-minute available"; non-whole → no number', () => {
        expect(formatTrialAllotmentTitle(300)).toBe('5-minute Private trial available');
        expect(formatTrialAllotmentTitle(600)).toBe('10-minute Private trial available');
        // a non-whole limit must NOT become "5.5-minute" or a rounded "6-minute"
        expect(formatTrialAllotmentTitle(330)).toBe('Private trial available');
    });

    it('remaining title FLOORS and never overstates', () => {
        expect(formatTrialRemainingTitle(300)).toBe('Continue with Private — about 5 minutes remaining');
        expect(formatTrialRemainingTitle(125)).toBe('Continue with Private — about 2 minutes remaining');
        expect(formatTrialRemainingTitle(120)).toBe('Continue with Private — about 2 minutes remaining');
        expect(formatTrialRemainingTitle(119)).toBe('Continue with Private — about 1 minute remaining'); // floors, singular
        expect(formatTrialRemainingTitle(61)).toBe('Continue with Private — about 1 minute remaining');  // NOT "2 minutes"
        expect(formatTrialRemainingTitle(60)).toBe('Continue with Private — about 1 minute remaining');
        expect(formatTrialRemainingTitle(59)).toBe('Continue with Private — less than a minute remaining');
        expect(formatTrialRemainingTitle(1)).toBe('Continue with Private — less than a minute remaining');
        expect(formatTrialRemainingTitle(0)).toBe('Continue with Private — less than a minute remaining');
    });

    it('recording cap line uses the SAME whole-minute source (no hard-coded 5)', () => {
        expect(formatSampleCapLine(300)).toBe('Private sample: up to 5 minutes. We’ll stop and save when the sample ends.');
        expect(formatSampleCapLine(600)).toBe('Private sample: up to 10 minutes. We’ll stop and save when the sample ends.');
        expect(formatSampleCapLine(330)).toBe('Private sample. We’ll stop and save when the sample ends.'); // no false number
    });
});
