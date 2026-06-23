import { describe, it, expect } from 'vitest';
import {
    decodePace,
    decodePauseRhythm,
    decodeFillers,
    decodeClarity,
    getTryThisNext,
} from '../coachingNarrative';

describe('coachingNarrative decode', () => {
    it('decodes Speaking Pace as Fast / Steady / Slow (Not measured)', () => {
        expect(decodePace(0)).toEqual({ label: 'Not measured', tone: 'watch' });
        expect(decodePace(140)).toEqual({ label: 'Steady', tone: 'good' });   // 130–150 target
        expect(decodePace(175)).toEqual({ label: 'Fast', tone: 'off' });      // > 150
        expect(decodePace(110)).toEqual({ label: 'Slow', tone: 'off' });      // < 130
        expect(decodePace('145')).toEqual({ label: 'Steady', tone: 'good' }); // accepts string
    });

    it('decodes Pause Rhythm as Smooth / Sparse / Choppy', () => {
        expect(decodePauseRhythm(7)).toEqual({ label: 'Smooth', tone: 'good' });
        expect(decodePauseRhythm(1)).toEqual({ label: 'Sparse', tone: 'watch' });   // < 3/min
        expect(decodePauseRhythm(15)).toEqual({ label: 'Choppy', tone: 'off' });    // > 12/min
    });

    it('decodes Filler Words as Low / Noticeable / High', () => {
        expect(decodeFillers(1)).toEqual({ label: 'Low', tone: 'good' });
        expect(decodeFillers(4)).toEqual({ label: 'Noticeable', tone: 'watch' });   // >= 3/min
        expect(decodeFillers(8)).toEqual({ label: 'High', tone: 'off' });           // >= 6/min
    });

    it('decodes Clear Delivery as Strong / Developing / Needs focus', () => {
        expect(decodeClarity(92)).toEqual({ label: 'Strong', tone: 'good' });       // >= 80
        expect(decodeClarity(70)).toEqual({ label: 'Developing', tone: 'watch' });  // >= 60
        expect(decodeClarity(40)).toEqual({ label: 'Needs focus', tone: 'off' });   // < 60
    });
});

describe('coachingNarrative getTryThisNext', () => {
    const onTarget = { avgWpm: 140, avgPausesPerMin: 6, avgFillerWordsPerMin: 1, avgClarity: 90 };

    it('returns no driver and an encouraging action when everything is on target', () => {
        expect(getTryThisNext(onTarget)).toEqual({
            driver: null,
            action: 'Keep the pace steady and land the takeaway.',
        });
    });

    it('surfaces pace first when pace is off (delivery priority)', () => {
        const result = getTryThisNext({ ...onTarget, avgWpm: 180, avgFillerWordsPerMin: 8 });
        expect(result.driver).toBe('pace');
        // > FAST_WPM (170) escalates the action.
        expect(result.action).toBe('Give the next key idea a beat of silence.');
    });

    it('escalates a slightly-fast pace to the gentler action', () => {
        const result = getTryThisNext({ ...onTarget, avgWpm: 160 });
        expect(result).toEqual({ driver: 'pace', action: 'Ease the pace at sentence endings.' });
    });

    it('falls through to pause rhythm when only pauses are off', () => {
        const result = getTryThisNext({ ...onTarget, avgPausesPerMin: 15 });
        expect(result).toEqual({ driver: 'pause rhythm', action: 'Finish a full phrase before taking the next pause.' });
    });

    it('prefers an off metric over a watch metric', () => {
        // fillers Noticeable (watch) but clarity Needs focus (off) → clarity wins... but pace/fillers
        // priority: here fillers is only 'watch', clarity is 'off' → clarity surfaces.
        const result = getTryThisNext({ avgWpm: 140, avgPausesPerMin: 6, avgFillerWordsPerMin: 4, avgClarity: 40 });
        expect(result.driver).toBe('clear delivery');
    });
});
