import { describe, expect, it } from 'vitest';
import {
    calculateCoreSessionMetrics,
    getWpmLabel,
    getSessionAnalysisMetrics,
    getFillerExplanation,
    isUsableFillerCounts,
    normalizeFillerCounts,
    FILLER_TRANSCRIPT_DISCLOSURE,
} from '../sessionAnalysis';
import type { PracticeSession } from '@/types/session';
import type { FillerCounts } from '@/utils/fillerWordUtils';

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

    // #894: every count-bearing filler explanation carries the transcript-derived disclosure, so the metric
    // is presented as an honest lower bound (STT engines can omit a spoken filler upstream). It is NOT added
    // to the "no transcript captured" / "too little speech" cases, where no count is presented.
    describe('#894: transcript-derived disclosure on count-bearing explanations', () => {
        it('appends the disclosure when a count IS presented (fillers detected)', () => {
            expect(getFillerExplanation(3, 100)).toContain(FILLER_TRANSCRIPT_DISCLOSURE);
        });
        it('appends the disclosure to the honest zero ("none detected" may still be an under-count)', () => {
            expect(getFillerExplanation(0, 100)).toContain(FILLER_TRANSCRIPT_DISCLOSURE);
        });
        it('does NOT append the disclosure when no transcript was captured', () => {
            expect(getFillerExplanation(0, 0)).not.toContain(FILLER_TRANSCRIPT_DISCLOSURE);
        });
        it('does NOT append the disclosure when there is too little speech to verify', () => {
            // wordCount < MIN_RELIABLE_SCORING_WORDS (3) → the "too little speech" branch, which presents no count.
            expect(getFillerExplanation(0, 2)).not.toContain(FILLER_TRANSCRIPT_DISCLOSURE);
        });
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

describe('normalizeFillerCounts — accepted canonical filler data ALWAYS exposes total.count', () => {
    it('adds total.count = sum of non-total entries when total is missing (detail-only object)', () => {
        const out = normalizeFillerCounts({ um: { count: 1, color: '' } } as FillerCounts);
        expect(out.total.count).toBe(1);
        expect(out.um.count).toBe(1);
    });
    it('sums multiple entries into total.count', () => {
        const out = normalizeFillerCounts({ um: { count: 3, color: '' }, so: { count: 2, color: '' } } as FillerCounts);
        expect(out.total.count).toBe(5);
    });
    it('preserves an existing numeric total (identity — no re-sum)', () => {
        const input = { total: { count: 4, color: '' }, um: { count: 9, color: '' } } as FillerCounts;
        expect(normalizeFillerCounts(input)).toBe(input); // same object, total not overwritten
        expect(normalizeFillerCounts(input).total.count).toBe(4);
    });
    it('empty object gets total.count 0', () => {
        expect(normalizeFillerCounts({} as FillerCounts).total.count).toBe(0);
    });

    it('SAVE edge case: a detail-only live snapshot does NOT crash and exposes total.count', () => {
        // calculateCoreSessionMetrics is the single point where canonical filler data is accepted for save.
        const metrics = calculateCoreSessionMetrics({
            transcript: 'the plan is ready for the board',
            durationSeconds: 20,
            fillerData: { um: { count: 1, color: '' } } as FillerCounts, // detail-only, NO total
        });
        // Controller reads fillerWords.total.count at ANALYSIS_COMPLETE — must not throw.
        expect(() => metrics.fillerData.total.count).not.toThrow();
        expect(metrics.fillerData.total.count).toBe(1);
        expect(metrics.fillerCount).toBe(1);
    });
});

describe('metrics-duration: pace uses the persisted RECORDING duration, not finalize-inflated wall-clock', () => {
    // Companion to the SpeechRuntimeController fix: the controller now persists session.duration as
    // the spoken recording length (Stop − Start), excluding the post-Stop finalize decode. This
    // proves the analysis/detail layer divides pace by that persisted duration, so the correct value
    // reaches the user. 750 words over a real 5:00 take = 150 WPM (top of the 130–150 target band).
    const base = {
        id: 's-dur', user_id: 'u', created_at: '2026-07-13T12:00:00.000Z', updated_at: '2026-07-13T12:00:00.000Z',
        title: '5-min take', total_words: 750, transcript: 'point one point two point three',
        filler_words: { total: { count: 0 } }, clarity_score: null, wpm: null,
    };

    it('a 5:00 recording (duration=300) yields 150 WPM — the correct pace', () => {
        const session = { ...base, duration: 300 } as unknown as PracticeSession;
        const metrics = getSessionAnalysisMetrics(session);
        expect(metrics.wordCount).toBe(750);
        expect(metrics.wpm).toBe(150); // 750 words / 5.0 min
    });

    it('dividing by finalize-inflated duration (388s) would understate the SAME words to 116 WPM (the bug)', () => {
        // Guards the exact regression: a 5:00 take whose persisted duration folded in ~88s of finalize
        // shows ~116 WPM ("slow", below the 130 target) instead of 150 ("in target") — a ~23% miscue.
        const good = getSessionAnalysisMetrics({ ...base, duration: 300 } as unknown as PracticeSession).wpm;
        const buggy = getSessionAnalysisMetrics({ ...base, duration: 388 } as unknown as PracticeSession).wpm;
        expect(good).toBe(150);
        expect(buggy).toBe(116);
        expect(good).toBeGreaterThan(buggy);
        // Coaching impact: the recording duration keeps pace in the target band; the wall-clock drops it below.
        expect(good).toBeGreaterThanOrEqual(130);
        expect(buggy).toBeLessThan(130);
    });
});
