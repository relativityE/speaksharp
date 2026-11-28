import { describe, it, expect } from 'vitest';
import { repeatPaceSentence } from '../repeatPaceCopy';
import type { RepeatPaceComparison } from '@/services/progress/repeatPaceComparison';

const FORBIDDEN = /improv|reached|caused|because of|met the|better|worse|great|well done/i;
const compared = (beforeWpm: number, afterWpm: number): RepeatPaceComparison => {
    const changePercent = ((afterWpm - beforeWpm) / beforeWpm) * 100;
    return { status: 'compared', beforeWpm, afterWpm, changePercent, band: Math.abs(changePercent) < 10 ? 'within_normal_variation' : 'changed' };
};

describe('Open Mic repeat pace copy', () => {
    it('a change: values, then a neutral direction', () => {
        expect(repeatPaceSentence(compared(150, 120), { valuesShownAbove: false }))
            .toBe('Pace: 150 → 120 words per minute (original session → this repeat). The repeat was 20% slower.');
        expect(repeatPaceSentence(compared(120.4, 150.2), { valuesShownAbove: false }))
            .toBe('Pace: 120 → 150 words per minute (original session → this repeat). The repeat was 25% faster.');
    });

    it('normal variation is said plainly and not counted as a change', () => {
        expect(repeatPaceSentence(compared(152, 138), { valuesShownAbove: false }))
            .toBe('Pace: 152 → 138 words per minute (original session → this repeat). That is a 9% difference. Changes under 10% are treated as normal take-to-take variation.');
    });

    it('does not repeat the numbers when the stored pace values are already shown', () => {
        expect(repeatPaceSentence(compared(152, 138), { valuesShownAbove: true }))
            .toBe('That is a 9% difference. Changes under 10% are treated as normal take-to-take variation.');
    });

    it('each reason a comparison is not made', () => {
        const s = (pace: RepeatPaceComparison) => repeatPaceSentence(pace, { valuesShownAbove: false });
        expect(s({ status: 'cant_compare', reason: 'not_eligible', exclusionReason: 'too_short' }))
            .toBe('Pace is not compared: one of the takes is too short for a reliable comparison.');
        expect(s({ status: 'cant_compare', reason: 'not_eligible' }))
            .toBe('Pace is not compared: one of the takes did not meet the comparison evidence requirements.');
        expect(s({ status: 'cant_compare', reason: 'different_setup' })).toBe('Pace is not compared: the two takes used different recording setups.');
        expect(s({ status: 'cant_compare', reason: 'no_pace' })).toBe('Pace is not compared: pace was not measured for one of the takes.');
        expect(s({ status: 'cant_compare', reason: 'different_length' })).toBe('Pace is not compared: the two takes are very different lengths.');
    });

    it('says nothing for a non-Open Mic loop or an unavailable read', () => {
        expect(repeatPaceSentence({ status: 'cant_compare', reason: 'not_open_mic' }, { valuesShownAbove: false })).toBeNull();
        expect(repeatPaceSentence({ status: 'unavailable' }, { valuesShownAbove: false })).toBeNull();
    });

    it('no sentence praises, blames or claims a cause', () => {
        const all: RepeatPaceComparison[] = [compared(150, 120), compared(120, 150), compared(150, 145),
            ...(['not_eligible', 'different_setup', 'no_pace', 'different_length'] as const).map((reason) => ({ status: 'cant_compare' as const, reason }))];
        for (const pace of all) for (const valuesShownAbove of [true, false]) {
            expect(repeatPaceSentence(pace, { valuesShownAbove }) ?? '').not.toMatch(FORBIDDEN);
        }
    });
});
