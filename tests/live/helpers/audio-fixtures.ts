import { fileURLToPath } from 'url';

export const HARVARD_BENCHMARK_AUDIO = fileURLToPath(
    new URL('../../fixtures/harvard_benchmark_16k.wav', import.meta.url)
);

export const HARVARD_BENCHMARK_LONG_AUDIO = fileURLToPath(
    new URL('../../fixtures/harvard_benchmark_16k_loop_120s.wav', import.meta.url)
);

export const FILLER_CONV_01_AUDIO = fileURLToPath(
    new URL('../../fixtures/stt-isomorphic/audio/conv_01.wav', import.meta.url)
);

/**
 * 65.8 s of UNIQUE continuous speech — long enough that a bounded recording never wraps.
 *
 * `FILLER_CONV_01_AUDIO` is 3.56 s. Chromium's `--use-file-for-fake-audio-capture` LOOPS its input,
 * so a 60 s recording fed the engine the same 3.5 seconds ~17 times. Attempt 6's draft output shows
 * exactly that ("we should literally like, wait, um, basically, we should literally like, wait, um"),
 * which is indistinguishable from a model repetition loop. Adversarially-looped audio must never be
 * the default input for a correctness proof.
 */
export const WASHINGTON_LONG_AUDIO = fileURLToPath(
    new URL('../../fixtures/stt-isomorphic/audio/washington_01.wav', import.meta.url)
);
