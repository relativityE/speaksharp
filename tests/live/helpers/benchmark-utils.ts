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

export async function collectBenchmarkPreconditionSnapshot(page: Page, label: string) {
    return page.evaluate((snapshotLabel) => {
        const root = document.documentElement;
        const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '';
        const modeSelect = document.querySelector('[data-testid="stt-mode-select"]') as HTMLElement | null;
        const startButton = document.querySelector('[data-testid="session-start-stop-button"]') as HTMLElement | null;
        const transcript = document.querySelector('[data-testid="transcript-container"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) ?? '';
        const profileText = document.querySelector('[data-testid="pro-badge"], [data-testid="nav-upgrade-button"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

        return {
            label: snapshotLabel,
            url: window.location.href,
            title: document.title,
            root: {
                appReady: root.getAttribute('data-app-ready'),
                runtimeState: root.getAttribute('data-runtime-state'),
                sttReady: root.getAttribute('data-stt-ready'),
                modelStatus: root.getAttribute('data-model-status'),
                sessionPersisted: root.getAttribute('data-session-persisted'),
            },
            browser: {
                hasMediaDevices: Boolean(navigator.mediaDevices),
                hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
                hasWebGPU: Boolean('gpu' in navigator),
                userAgent: navigator.userAgent,
            },
            ui: {
                modeSelectPresent: Boolean(modeSelect),
                modeSelectState: modeSelect?.getAttribute('data-state') ?? null,
                startButtonPresent: Boolean(startButton),
                startButtonDisabled: startButton?.hasAttribute('disabled') ?? null,
                startButtonRecording: startButton?.getAttribute('data-recording') ?? null,
                profileText,
                transcript,
                bodyText,
            },
        };
    }, label).catch((error) => ({
        label,
        snapshotError: error instanceof Error ? error.message : String(error),
        url: page.url(),
    }));
}

export async function waitForBenchmarkSession(page: Page) {
    await page.goto('/session');
    try {
        await expect(page.getByTestId('stt-mode-select')).toBeVisible({ timeout: 20_000 });
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'benchmark-session-selector-missing');
        throw new Error(`Benchmark session precondition failed: stt-mode-select missing\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function selectBenchmarkMode(page: Page, mode: 'native' | 'cloud' | 'private') {
    const select = page.getByTestId('stt-mode-select');
    try {
        await expect(select).toBeVisible({ timeout: 15_000 });
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, `select-${mode}-selector-missing`);
        throw new Error(`Benchmark mode selection precondition failed for ${mode}: stt-mode-select missing\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
    }
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
    try {
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
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-engine-ready-timeout');
        throw new Error(`Private engine readiness precondition failed\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function expectBenchmarkRecordingStarted(page: Page, label: string) {
    try {
        await expect(page.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 10_000 });
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, `${label}-recording-not-started`);
        throw new Error(`Benchmark recording precondition failed for ${label}\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function expectBenchmarkTranscriptOutput(page: Page, label: string, timeout = 20_000, minWords = 5) {
    try {
        await expect(async () => {
            const text = await page.getByTestId('transcript-container').textContent() ?? '';
            const currentWordCount = text.trim().split(/\s+/).filter(w => w.length > 2).length;
            expect(currentWordCount).toBeGreaterThan(minWords);
        }).toPass({ timeout });
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, `${label}-transcript-output-missing`);
        throw new Error(`Benchmark transcript precondition failed for ${label}: transcript did not exceed ${minWords} words before WER\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
    }
}
