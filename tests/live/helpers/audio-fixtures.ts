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
