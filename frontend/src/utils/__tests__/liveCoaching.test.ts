import { describe, it, expect } from 'vitest';
import { liveTipFromMetrics, verdictFromSuggestions } from '../liveCoaching';
import type { FillerCounts } from '@/utils/fillerWordUtils';

const fillers = (o: Record<string, number>): FillerCounts =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { count: v }])) as unknown as FillerCounts;

// #1222 S12b — deterministic live tip + after verdict, grounded in real session signals.
describe('liveTipFromMetrics (#1222 S12b)', () => {
    it('says nothing in the first few seconds', () => {
        expect(liveTipFromMetrics({ fillerData: fillers({ um: 3 }), wpm: 140, elapsedSeconds: 5 })).toBeNull();
    });

    it('targets the dominant filler with its count, id keyed to the word', () => {
        const tip = liveTipFromMetrics({ fillerData: fillers({ um: 4, like: 1 }), wpm: 140, elapsedSeconds: 30 });
        expect(tip?.id).toBe('filler:um');
        expect(tip?.headline).toMatch(/um/);
        expect(tip?.evidence).toMatch(/4 times/);
        expect(tip?.goingRight).toMatch(/right in your range/); // pace 140 in band
    });

    it('flags too-fast pace when there is no filler spike', () => {
        const tip = liveTipFromMetrics({ fillerData: fillers({}), wpm: 190, elapsedSeconds: 30 });
        expect(tip?.id).toBe('pace:fast');
    });

    it('gives a positive "holding steady" tip when pace is in range and no fillers', () => {
        const tip = liveTipFromMetrics({ fillerData: fillers({}), wpm: 140, elapsedSeconds: 30 });
        expect(tip?.id).toBe('steady');
        expect(tip?.goingRight).toBeTruthy();
    });
});

describe('verdictFromSuggestions (#1222 S12b)', () => {
    it('uses the saved two-takeaways when present', () => {
        const v = verdictFromSuggestions({ what_worked: 'Steady pace throughout', what_to_try_next: 'Pause before key points' });
        expect(v.verdictLine).toBe('Steady pace throughout');
        expect(v.fix).toBe('Pause before key points');
    });

    it('falls back honestly to the dominant filler when there are no suggestions', () => {
        const v = verdictFromSuggestions(null, fillers({ um: 5, so: 2 }));
        expect(v.verdictLine).toMatch(/saved/i);
        expect(v.fix).toMatch(/um/);
    });

    it('has a safe generic fix when there is no signal at all', () => {
        const v = verdictFromSuggestions(undefined, null);
        expect(v.fix).toMatch(/baseline/i);
    });
});
