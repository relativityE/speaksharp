/**
 * A HANG MUST BECOME A NUMBER.
 *
 * r3 deadlocked at the start of the moonshine arm and sat at 0.0% CPU across every process for 77
 * minutes before anyone noticed. The reliability schema already had a `timedOut` counter — read in two
 * places, set by nothing. The counter existed while the mechanism did not, so an unbounded wait was
 * indistinguishable from a healthy run in progress.
 *
 * These assert the chain that now closes it: a decode past its deadline throws a classified error, the
 * classifier recognises that error by its MESSAGE, and any non-zero count disqualifies the arm.
 */
import { describe, expect, it } from 'vitest';
import { DECODE_TIMEOUT_MS, DecodeTimeoutError } from '../browser/browserArm';
import { qualify } from '../selectionPolicy';

/** The predicate buildVerdict uses to turn a decode failure into the timedOut count. */
const CLASSIFIER = /timeout|deadline/i;

const row = (over: Record<string, unknown> = {}) => ({
    id: 'moonshine:streaming-medium',
    evidenceClass: 'selection',
    role: 'selection',
    backendProven: true,
    dtypeAliasOf: undefined,
    speed: { realTimeFactorP95: 0.5 },
    duration: { truncatedClips: 0, highDeletionClips: 0 },
    reliability: {
        expectedClips: 600, decoded: 600,
        threw: 0, emptyOutput: 0, timedOut: 0, audioRejected: 0, missing: 0,
    },
    ...over,
}) as unknown as Parameters<typeof qualify>[0];

describe('a decode that never settles is classified, not waited on', () => {
    it('CASUALTY: the deadline error is recognised BY THE CLASSIFIER that counts it', () => {
        // The coupling is the message text. An error whose wording stopped matching would silently
        // stop being counted while every piece still looked correct on its own.
        const e = new DecodeTimeoutError(`decode_timeout: clip-9 exceeded ${DECODE_TIMEOUT_MS}ms`);
        expect(CLASSIFIER.test(e.message)).toBe(true);
    });

    it('CASUALTY: a timed-out arm is DISQUALIFIED from selection', () => {
        const clean = qualify(row());
        expect(clean.reasons).not.toContain('reliability_failures');

        const hung = qualify(row({
            reliability: {
                expectedClips: 600, decoded: 600,
                threw: 0, emptyOutput: 0, timedOut: 1, audioRejected: 0, missing: 0,
            },
        }));
        expect(hung.reasons).toContain('reliability_failures');
    });

    it('CASUALTY: an arm that never finished is disqualified as an incomplete corpus', () => {
        // The r3 shape: the arm stopped partway and would otherwise have looked like fewer clips
        // rather than a failure.
        const partial = qualify(row({
            reliability: {
                expectedClips: 600, decoded: 12,
                threw: 0, emptyOutput: 0, timedOut: 1, audioRejected: 0, missing: 588,
            },
        }));
        expect(partial.reasons).toContain('incomplete_corpus');
        expect(partial.reasons).toContain('reliability_failures');
    });

    it('the budget is generous enough that a slow model is not mislabelled as hung', () => {
        // The heaviest arm measured RTF ~0.5 with p95 warm loads near 2s; a clip is seconds, not
        // minutes. A tight budget would turn load spikes into fabricated reliability failures.
        expect(DECODE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    });
});
