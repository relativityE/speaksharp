/**
 * CLIP INDEPENDENCE — the missing test class that let a state leak reach a 600-clip run.
 *
 * A frozen-corpus arm scores clips as INDEPENDENT utterances. If a decoder carries state across them,
 * every transcript depends on what preceded it and the arm's WER measures the ORDER as much as the
 * model. That is what happened to moonshine:streaming-medium in r2: measured order-independence 1/6,
 * with a spurious leading token in 101 of 600 clips.
 *
 * This asserts the PROPERTY, not the incident: decoding a clip alone and decoding it after a different
 * clip must produce identical output. It is written against an abstract decoder so it applies to any
 * future stateful arm, not only Moonshine.
 */
import { describe, expect, it } from 'vitest';

type Decode = (audio: string) => string;
interface DecoderLifecycle {
    /** Build a decoder. An isolating lifecycle returns a fresh one; a leaky one returns a shared one. */
    acquire: () => Decode;
    release?: (d: Decode) => void;
}

/**
 * Decode `target` alone, and again after `predecessor`. Independent iff the two agree.
 *
 * A decoder is acquired before EVERY decode, because that is what the isolating lifecycle actually
 * does — the harness builds a decoder per clip. Acquiring once and decoding twice would test a
 * two-clip session instead, and would fail even a correctly isolating implementation.
 */
export function checkIndependence(
    lifecycle: DecoderLifecycle,
    target: string,
    predecessor: string,
): { alone: string; afterOther: string; independent: boolean } {
    const once = (audio: string): string => {
        const d = lifecycle.acquire();
        try { return d(audio); } finally { lifecycle.release?.(d); }
    };

    const alone = once(target);
    once(predecessor);
    const afterOther = once(target);

    return { alone, afterOther, independent: alone === afterOther };
}

/** A decoder that leaks: it prefixes a token derived from what it saw before — r2's exact symptom. */
const leakyShared = (): DecoderLifecycle => {
    let seen = 0;
    const decode: Decode = (audio) => (seen++ > 0 ? `yeah ${audio}` : audio);
    return { acquire: () => decode };
};

/**
 * A decoder rebuilt per clip: the same leak-prone implementation, but each acquire gets its own state,
 * so nothing survives between decodes. This is the shape of the harness fix.
 */
const freshPerClip = (): DecoderLifecycle => ({
    acquire: () => {
        let seen = 0;
        return (audio) => (seen++ > 0 ? `yeah ${audio}` : audio);
    },
});

describe('clip independence is a certification property', () => {
    it('CASUALTY: a shared, stateful decoder FAILS independence', () => {
        // Without this test a leaky arm certifies cleanly: it decodes 600/600, every reliability
        // counter is zero, pins verify — and its WER is still meaningless.
        const r = checkIndependence(leakyShared(), 'tied to a woman', 'a different clip');
        expect(r.independent).toBe(false);
        expect(r.alone).toBe('tied to a woman');
        expect(r.afterOther).toBe('yeah tied to a woman');
    });

    it('POSITIVE CONTROL: a fresh-per-clip lifecycle PASSES independence', () => {
        const r = checkIndependence(freshPerClip(), 'tied to a woman', 'a different clip');
        expect(r.independent).toBe(true);
        expect(r.alone).toBe(r.afterOther);
    });

    it('CASUALTY: the check must not pass merely because both decodes are non-empty', () => {
        // A weaker assertion — "it produced text" — would have accepted the leaky decoder.
        const r = checkIndependence(leakyShared(), 'x', 'y');
        expect(r.alone.length).toBeGreaterThan(0);
        expect(r.afterOther.length).toBeGreaterThan(0);
        expect(r.independent).toBe(false);
    });

    it('CASUALTY: order dependence is detected even when the leak is not a prefix', () => {
        // The r2 symptom was a leading token, but the probe also found a mid-sentence recognition
        // difference. Independence must be byte equality, not a prefix check.
        let prev = '';
        const decode: Decode = (audio) => {
            const out = prev ? `${audio} (after ${prev})` : audio;
            prev = audio;
            return out;
        };
        const shared: DecoderLifecycle = { acquire: () => decode };
        const r = checkIndependence(shared, 'target', 'predecessor');
        expect(r.independent).toBe(false);
        expect(r.afterOther).toContain('after predecessor');
    });

    it('an arm that fails independence must NOT be selection-eligible', () => {
        // The disposition, stated as a rule rather than left to a reviewer: r2's moonshine row satisfied
        // every execution criterion and is still invalid for selection.
        const r = checkIndependence(leakyShared(), 'clip', 'other');
        const selectionEligible = r.independent;
        expect(selectionEligible).toBe(false);
    });
});
