import { describe, expect, it } from 'vitest';
import {
    calculateCoreSessionMetrics,
    getWpmLabel,
    getSessionAnalysisMetrics,
    isUsableFillerCounts,
} from '../sessionAnalysis';
import type { PracticeSession } from '@/types/session';

describe('sessionAnalysis metric truth', () => {
    it('counts captured filler words and explains their impact', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'Um I think uh this is like a useful test',
            durationSeconds: 30,
        });

        expect(metrics.wordCount).toBe(10);
        expect(metrics.fillerCount).toBe(3);
        expect(metrics.fillerData.total.count).toBe(3);
        expect(metrics.fillerExplanation).toContain('This is likely noticeable; pause before restarting a thought');
        expect(metrics.clarityExplanation).toContain('Replace the next one with a brief pause');
    });

    it('STT-P1: re-counts respelled fillers ("Umm") from the final transcript when no live fillerData is supplied', () => {
        // The save/score path (SpeechRuntimeController) now omits the live store.fillerData so the
        // persisted count is derived from the authoritative final transcript. A saved "Umm" must
        // therefore count as a user-perceived "um" (regex normalizes umm/ummm/uhm -> um), not um:0.
        const metrics = calculateCoreSessionMetrics({
            transcript: 'Umm, basically we should ship it.',
            durationSeconds: 20,
        });

        expect(metrics.fillerData.um.count).toBe(1);
        expect(metrics.fillerCount).toBeGreaterThanOrEqual(1);
    });

    it('does not report perfect clarity for missing speech', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: '',
            durationSeconds: 60,
        });

        expect(metrics.clarityScore).toBe(0);
        expect(metrics.isClarityScorable).toBe(false);
        expect(metrics.clarityLabel).toBe('Not enough reliable speech to score');
        expect(metrics.clarityExplanation).toBe('No transcript was captured, so clarity cannot be scored yet.');
        expect(metrics.fillerExplanation).toBe('No transcript was captured, so filler words cannot be verified yet.');
    });

    it('does not score a one-word partial transcript as great clarity for a saved session', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'Well',
            durationSeconds: 15,
        });

        expect(metrics.wordCount).toBe(1);
        expect(metrics.isClarityScorable).toBe(false);
        expect(metrics.clarityLabel).toBe('Not enough reliable speech to score');
        expect(metrics.clarityExplanation).toMatch(/too little captured speech/i);
        expect(metrics.fillerExplanation).toMatch(/too little captured speech/i);
    });

    it('never reports low or missing WPM as optimal', () => {
        expect(getWpmLabel(0)).toBe('Not Measured');
        expect(getWpmLabel(20)).toBe('Too Slow');
        expect(getWpmLabel(129)).toBe('Too Slow');
        expect(getWpmLabel(140)).toBe('Optimal Range');
    });

    it('uses supplied live filler counts when they exceed final transcript text', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'This final transcript dropped the filler words',
            durationSeconds: 30,
            fillerData: {
                um: { count: 2 },
                total: { count: 2 },
            },
        });

        expect(metrics.fillerCount).toBe(2);
        expect(metrics.fillerData.total.count).toBe(2);
        expect(metrics.clarityScore).toBeLessThan(100);
    });

    it('SSOT: uses the persisted canonical filler total and does NOT inflate a valid persisted zero from transcript', () => {
        // Live counter recorded ZERO; the committed transcript text happens to contain "um"/"uh". Per the
        // live-canonical SSOT, the persisted zero is authoritative and must NOT be repaired up from the
        // transcript (previous behavior wrongly took max(persisted, recount) = 2).
        const session = {
            id: 'session-1',
            user_id: 'user-1',
            created_at: '2026-05-21T12:00:00.000Z',
            updated_at: '2026-05-21T12:00:00.000Z',
            title: 'Truth check',
            duration: 60,
            total_words: 8,
            transcript: 'um this transcript has uh two fillers',
            filler_words: { total: { count: 0 } }, // valid persisted (live) zero
            clarity_score: null,
            wpm: null,
        } as unknown as PracticeSession;

        const metrics = getSessionAnalysisMetrics(session);

        expect(metrics.fillerCount).toBe(0);
        expect(metrics.fillerData.total.count).toBe(0);
        expect(metrics.wpm).toBe(8); // word count/WPM still derive from the transcript
    });

    it('SSOT: recounts custom filler words from transcript ONLY as fallback when persisted filler data is absent', () => {
        const session = {
            id: 'session-2',
            user_id: 'user-1',
            created_at: '2026-05-21T12:00:00.000Z',
            updated_at: '2026-05-21T12:00:00.000Z',
            title: 'Custom filler truth check',
            duration: 60,
            transcript: 'basically this basically needs to count',
            custom_words: { basically: { count: 0 } },
            filler_words: null, // absent → fallback recount (diagnostic), which honors custom words
            clarity_score: null,
            wpm: null,
        } as unknown as PracticeSession;

        const metrics = getSessionAnalysisMetrics(session);

        expect(metrics.fillerData.basically.count).toBe(2);
        expect(metrics.fillerData.total.count).toBe(2);
        expect(metrics.fillerCount).toBe(2);
    });

    it('turns Cloud-quality transcript evidence into plain-language coaching', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'The stale smell of old beer, like, lingers, basically, a dash of pepper spoils beef stew. Well, the swan dive was far short of perfect.',
            durationSeconds: 26.194,
        });

        expect(metrics.wordCount).toBe(25);
        expect(metrics.fillerCount).toBe(2);
        expect(metrics.wpm).toBe(57);
        expect(metrics.wpmExplanation).toContain('very slow for most listeners');
        expect(metrics.fillerExplanation).toContain('Pick one repeat filler to replace with silence next time');
        expect(metrics.clarityExplanation).toContain('Replace the next one with a brief pause');
    });

    it('explains clean transcripts as a next-step coaching opportunity instead of a bare score', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'This answer is clear direct and easy for the audience to follow without filler words today',
            durationSeconds: 7,
        });

        expect(metrics.fillerCount).toBe(0);
        expect(metrics.fillerExplanation).toContain('Keep using silence as your reset');
        expect(metrics.clarityExplanation).toContain('Focus the next run on pacing and emphasis');
    });
});

describe('Live filler SSOT — live count is canonical, recount is diagnostic/fallback', () => {
    // #1: live um:3 vs transcript recount um:1 → the SAVED filler metric follows the live snapshot (3).
    it('save path: supplied live snapshot wins over a lower transcript recount', () => {
        const liveSnapshot = { total: { count: 3, color: '' }, um: { count: 3, color: '' } };
        const metrics = calculateCoreSessionMetrics({
            transcript: 'um only one here', // recount would see um:1
            durationSeconds: 20,
            fillerData: liveSnapshot,
        });
        expect(metrics.fillerCount).toBe(3);
        expect(metrics.fillerData.um.count).toBe(3);
    });

    // #2 + #5: live zero vs transcript-with-fillers → count stays 0, and clarity uses that canonical 0.
    it('save path: a valid live zero stays zero (and clarity consumes the canonical count)', () => {
        const zeroWithFillersInText = calculateCoreSessionMetrics({
            transcript: 'um uh like so basically the words are here for scoring reliably now',
            durationSeconds: 20,
            fillerData: { total: { count: 0, color: '' } }, // canonical live zero
        });
        const recountBaseline = calculateCoreSessionMetrics({
            transcript: 'um uh like so basically the words are here for scoring reliably now',
            durationSeconds: 20, // no fillerData → recount sees the fillers
        });
        expect(zeroWithFillersInText.fillerCount).toBe(0);
        expect(recountBaseline.fillerCount).toBeGreaterThan(0);
        // Clarity reflects the canonical 0 fillers, i.e. it is NOT penalized like the recount path.
        expect(zeroWithFillersInText.clarityScore).toBeGreaterThanOrEqual(recountBaseline.clarityScore);
    });

    // #3: analytics uses persisted canonical, NOT max(persisted, recount).
    it('analytics: persisted canonical is used even when a transcript recount would be larger', () => {
        const session = {
            id: 's', user_id: 'u', created_at: '', updated_at: '', title: 't', duration: 60,
            transcript: 'um um um um um lots of ums in the text here',
            filler_words: { total: { count: 1, color: '' }, um: { count: 1, color: '' } }, // canonical 1
            clarity_score: null, wpm: null,
        } as unknown as PracticeSession;
        const metrics = getSessionAnalysisMetrics(session);
        expect(metrics.fillerCount).toBe(1); // NOT 5
    });

    // #6: recount fallback ONLY when persisted is missing/malformed.
    it('analytics: recounts the transcript when persisted filler data is absent/malformed', () => {
        const base = { id: 's', user_id: 'u', created_at: '', updated_at: '', title: 't', duration: 60,
            transcript: 'um and uh appear here', clarity_score: null, wpm: null };
        for (const badPersisted of [null, {}, { total: { count: 'x' } }]) {
            const metrics = getSessionAnalysisMetrics({ ...base, filler_words: badPersisted } as unknown as PracticeSession);
            expect(metrics.fillerCount).toBeGreaterThan(0); // fell back to recount
        }
    });

    // #8: no transcript/raw-custom text is embedded in the canonical filler data structure.
    it('canonical filler data carries no transcript text', () => {
        const metrics = calculateCoreSessionMetrics({
            transcript: 'honestly this is honestly the plan um so',
            durationSeconds: 20,
            fillerData: { total: { count: 2, color: '' }, um: { count: 1, color: '' }, so: { count: 1, color: '' } },
        });
        const json = JSON.stringify(metrics.fillerData);
        expect(json).not.toContain('honestly');
        expect(json).not.toContain('the plan');
    });
});

describe('isUsableFillerCounts — valid-zero is usable; only absent/malformed is not', () => {
    it('valid zero (total:0) is usable', () => { expect(isUsableFillerCounts({ total: { count: 0, color: '' } })).toBe(true); });
    it('zero entry without total is usable', () => { expect(isUsableFillerCounts({ um: { count: 0, color: '' } } as never)).toBe(true); });
    it('nonzero counts are usable', () => { expect(isUsableFillerCounts({ total: { count: 3, color: '' } })).toBe(true); });
    it('null / undefined / empty are NOT usable', () => {
        expect(isUsableFillerCounts(null)).toBe(false);
        expect(isUsableFillerCounts(undefined)).toBe(false);
        expect(isUsableFillerCounts({})).toBe(false);
    });
    it('malformed (non-numeric total, no numeric entry) is NOT usable', () => {
        expect(isUsableFillerCounts({ total: { count: 'x' } } as never)).toBe(false);
    });
});
