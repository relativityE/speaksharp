// @vitest-environment node
/** #1573 Codex P1 4232318053 + PO 2026-10-09: the per-minute filler rate in plain words — "about" + a whole number, below 1 "under 1". */
import { describe, it, expect } from 'vitest';
import { fillerRatePhrase } from '../coachingNarrative';

describe('fillerRatePhrase', () => {
    it('reads as speech, not a statistic', () => {
        expect([0, 0.4, 0.99, 1, 2.5, 6.6].map(fillerRatePhrase)).toEqual([
            'under 1 a minute', 'under 1 a minute', 'under 1 a minute', 'about 1 a minute', 'about 3 a minute', 'about 7 a minute',
        ]);
    });
});
