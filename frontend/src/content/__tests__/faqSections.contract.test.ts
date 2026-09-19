import { describe, it, expect } from 'vitest';
import { FAQ_SECTIONS } from '../faqSections';
import { PRIV_STT } from '@/services/transcription/sttConstants';

/**
 * The FAQ is a set of product claims. These casualties bind each claim to the contract it describes, so
 * a stale answer fails CI instead of reaching a user. The 2026-09-18 audit found every Progress answer
 * repeating a four-signal model (filler rate, clarity, pace, pause rhythm) that never shipped, plus an
 * unlimited-length promise and absolute audio wording.
 */
const text = FAQ_SECTIONS.flatMap((s) => s.items.flatMap((i) => [i.question, ...i.answer])).join('\n');
const answerOf = (id: string) =>
    FAQ_SECTIONS.flatMap((s) => s.items).find((i) => i.id === id)?.answer.join(' ') ?? '';

describe('FAQ claims match the shipped contracts', () => {
    it('CASUALTY: never describes Progress as four combined signals or as using pause rhythm', () => {
        expect(text).not.toMatch(/four signals|pause rhythm|pause-rhythm/i);
    });

    it('Progress is a clarity score, lowered by fillers, unclear stretches and an out-of-range pace', () => {
        const a = answerOf('how-progress-measured');
        expect(a).toMatch(/clarity/i);
        expect(a).toMatch(/filler/i);
        expect(a).toMatch(/90–170 words per minute/);
    });

    it('compares against the previous qualifying session, with the first as the baseline', () => {
        expect(answerOf('how-progress-measured')).toMatch(/previous qualifying session/i);
        expect(answerOf('first-session-no-percent')).toMatch(/baseline set/i);
    });

    it('CASUALTY: eligibility is never reduced to duration alone', () => {
        const a = answerOf('why-not-counted');
        expect(a).toMatch(/30 seconds/);
        expect(a).toMatch(/75 words/);
        expect(a).toMatch(/transcript/i);
        expect(a).toMatch(/verified record/i);
        expect(text).not.toMatch(/qualifies once it is long enough/i);
    });

    it('CASUALTY: states the PRODUCT recording cap, never the memory backstop or "unlimited"', () => {
        expect(text).not.toMatch(/as long as you like|unlimited|no time limit/i);
        // The binding cap is MAX_PRIVATE_RECORDING_SECONDS. MAX_UTTERANCE_SECONDS is a memory backstop set
        // deliberately ABOVE it (a normal take never reaches it) — quoting it told users 15 min instead of 10.
        const capMinutes = PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS / 60;
        expect(PRIV_STT.MAX_UTTERANCE_SECONDS).toBeGreaterThan(PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS);
        expect(answerOf('open-floor-vs-focus-points')).toMatch(new RegExp(`up to ${capMinutes} minutes per recording`));
        expect(text).not.toMatch(new RegExp(`${PRIV_STT.MAX_UTTERANCE_SECONDS / 60} minutes`));
    });

    it('CASUALTY: Focus Points is described as detector evidence, not proof of what was meant', () => {
        expect(text).not.toMatch(/actually hit/i);
        expect(answerOf('focus-points-detect')).toMatch(/matching words/i);
        expect(answerOf('focus-points-detect')).toMatch(/not that you made the point well/i);
    });

    it('audio: processed in memory, never uploaded or saved — not an absolute "not recorded"', () => {
        expect(answerOf('audio-private')).toMatch(/processed in memory/i);
        expect(answerOf('audio-private')).toMatch(/never uploaded or saved/i);
        expect(text).not.toMatch(/audio is not recorded/i);
    });

    it('CASUALTY: claims no retention schedule while newest-one retention is only installed, not activated', () => {
        expect(text).not.toMatch(/newest[- ](one|two)|deleted after|kept for \d+|automatically deleted/i);
    });

    it('the model cache is described as usual, not guaranteed', () => {
        expect(answerOf('model-download')).toMatch(/normally keeps it/i);
        expect(answerOf('model-download')).toMatch(/can download again/i);
    });
});
