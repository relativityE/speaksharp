import * as fs from 'fs';
import * as path from 'path';
import { expect, Page } from '@playwright/test';

export const BENCHMARKS_PATH = path.resolve('tests/STT_BENCHMARKS.json');
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

export async function waitForBenchmarkSession(page: Page) {
    await page.goto('/session');
    await expect(page.getByTestId('stt-mode-select')).toBeVisible({ timeout: 20_000 });
}

export async function selectBenchmarkMode(page: Page, mode: 'native' | 'cloud' | 'private') {
    const select = page.getByTestId('stt-mode-select');
    await expect(select).toBeVisible({ timeout: 15_000 });
    await select.scrollIntoViewIfNeeded();

    for (let attempt = 1; attempt <= 3; attempt++) {
        await select.click({ force: true });

        const option = page.getByTestId(`stt-mode-${mode}`);
        await expect(option).toBeVisible({ timeout: 10_000 });
        await option.click({ force: true });

        try {
            await expect(select).toHaveAttribute('data-state', mode, { timeout: 5_000 });
            return;
        } catch (error) {
            if (attempt === 3) {
                throw error;
            }
            await page.waitForTimeout(750);
        }
    }
}

export async function waitForPrivateEngineReady(page: Page, timeout = 180_000) {
    await page.waitForFunction(() => {
        const root = document.documentElement;
        const runtimeState = root.getAttribute('data-runtime-state');
        const sttReady = root.getAttribute('data-stt-ready');

        return (
            sttReady === 'true' ||
            runtimeState === 'READY' ||
            runtimeState === 'RECORDING'
        );
    }, { timeout });
}
