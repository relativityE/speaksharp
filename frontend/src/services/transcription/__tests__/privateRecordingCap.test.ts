import { describe, it, expect } from 'vitest';
import { PRIV_STT, PRIV_STT_DERIVED, PRIV_CLOUD_AUDIO } from '../sttConstants';

/**
 * Private per-recording cap invariants.
 *
 * The cap was raised 300s -> 600s (10 min) because the 5-minute value was set when finalization was
 * ASSUMED slow. That assumption is measured false: on production multi-threaded WASM a real 5:03 take
 * finalized in 38.7s (RTF ~0.128), so a full 10-minute take costs ~77s of Finalizing…. Stopping a user
 * who believes they are still recording is worse than a longer finalize wait.
 */
describe('Private recording cap', () => {
    it('caps a single Private take at 10 minutes', () => {
        expect(PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS).toBe(600);
    });

    /**
     * THE CRITICAL ONE. On reaching MAX_UTTERANCE_SAMPLES, PrivateWhisper stops ACCUMULATING audio
     * (`utteranceSampleCount >= MAX_UTTERANCE_SAMPLES` -> early return) WITHOUT stopping the recording.
     * If the memory backstop were <= the recording cap, a take could run to the cap while silently
     * dropping its tail — the user would keep speaking and lose that audio with no error.
     */
    it('keeps the memory backstop STRICTLY ABOVE the recording cap so no tail can be silently dropped', () => {
        expect(PRIV_STT.MAX_UTTERANCE_SECONDS).toBeGreaterThan(PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS);
    });

    it('leaves usable headroom between the cap and the backstop (not a boundary-adjacent pair)', () => {
        const headroom = PRIV_STT.MAX_UTTERANCE_SECONDS - PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS;
        expect(headroom).toBeGreaterThanOrEqual(60);
    });

    it('derives the sample-count backstop from the seconds backstop', () => {
        expect(PRIV_STT_DERIVED.MAX_UTTERANCE_SAMPLES)
            .toBe(PRIV_STT.MAX_UTTERANCE_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ);
    });

    it('warns before the cap, with the warning shorter than the cap itself', () => {
        expect(PRIV_STT.PRIVATE_RECORDING_CAP_WARNING_SECONDS).toBeGreaterThan(0);
        expect(PRIV_STT.PRIVATE_RECORDING_CAP_WARNING_SECONDS)
            .toBeLessThan(PRIV_STT.MAX_PRIVATE_RECORDING_SECONDS);
    });

    it('keeps the buffered audio within a sane memory ceiling (16kHz float32)', () => {
        const bytes = PRIV_STT.MAX_UTTERANCE_SECONDS * PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ * 4;
        expect(bytes).toBeLessThanOrEqual(64 * 1024 * 1024); // <= 64MB backstop
    });
});
