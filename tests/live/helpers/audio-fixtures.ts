import { fileURLToPath } from 'url';

export const HARVARD_BENCHMARK_AUDIO = fileURLToPath(
    new URL('../../fixtures/harvard_benchmark_16k.wav', import.meta.url)
);
