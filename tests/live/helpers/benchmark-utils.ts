import * as fs from 'fs';
import * as path from 'path';

export const BENCHMARKS_PATH = path.resolve('docs/STT_BENCHMARKS.json');
export const REGRESSION_TOLERANCE = 0.02;

export const AUDIO_ARGS = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns',
];

export function readBenchmarks() {
    return JSON.parse(fs.readFileSync(BENCHMARKS_PATH, 'utf-8'));
}

export function writeBenchmarks(data: Record<string, unknown>) {
    fs.writeFileSync(BENCHMARKS_PATH, JSON.stringify(data, null, 2));
}

export function assertNoRegression(
    engine: string,
    measuredWer: number,
    label: string,
    variant?: string
) {
    const benchmarks = readBenchmarks();
    let expectedAccuracy: number;

    if (engine === 'Private' && variant) {
        expectedAccuracy = benchmarks.engines.Private[variant].expectedAccuracy;
    } else {
        expectedAccuracy = benchmarks.engines[engine].expectedAccuracy;
    }

    const previousCeilingWer = 1.0 - (expectedAccuracy / 100);

    if (measuredWer > previousCeilingWer + REGRESSION_TOLERANCE) {
        const errorMsg = `${label}${variant ? ` (${variant})` : ''} WER REGRESSION DETECTED\n` +
            `  Previous ceiling: ${(previousCeilingWer * 100).toFixed(2)}%\n` +
            `  Measured:         ${(measuredWer * 100).toFixed(2)}%\n` +
            `  Tolerance:        ${(REGRESSION_TOLERANCE * 100).toFixed(2)}%\n`;

        if (variant === 'webgpu' && process.env.CI) {
            console.warn(`⚠️  ${errorMsg}`);
            console.warn('  Skipping strict failure because CI runners lack real GPUs.');
            return;
        }

        throw new Error(errorMsg + `  Run pnpm benchmark:browser locally to investigate.`);
    }
}
