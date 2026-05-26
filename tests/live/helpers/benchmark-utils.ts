import * as fs from 'fs';
import * as path from 'path';
import { expect, Page } from '@playwright/test';

type BenchmarkPreconditionSnapshot = {
    label: string;
    url: string;
    title?: string;
    root?: {
        appReady: string | null;
        runtimeState: string | null;
        sttReady: string | null;
        modelStatus: string | null;
        sessionPersisted: string | null;
    };
    browser?: {
        hasMediaDevices: boolean;
        hasGetUserMedia: boolean;
        hasWebGPU: boolean;
        speechRecognitionName: string | null;
        speechRecognitionIsMock: boolean;
        userAgent: string;
    };
    ui?: {
        modeSelectPresent: boolean;
        modeSelectState: string | null;
        startButtonPresent: boolean;
        startButtonDisabled: boolean | null;
        startButtonRecording: string | null;
        profileText: string | null;
        transcript: string;
        bodyText: string;
    };
    runtime?: Record<string, unknown> | null;
    snapshotError?: string;
};

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

export async function collectBenchmarkPreconditionSnapshot(page: Page, label: string): Promise<BenchmarkPreconditionSnapshot> {
    return page.evaluate((snapshotLabel) => {
        const root = document.documentElement;
        const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '';
        const modeSelect = document.querySelector('[data-testid="stt-mode-select"]') as HTMLElement | null;
        const startButton = document.querySelector('[data-testid="session-start-stop-button"]') as HTMLElement | null;
        const transcript = document.querySelector('[data-testid="transcript-container"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) ?? '';
        const profileText = document.querySelector('[data-testid="pro-badge"], [data-testid="nav-upgrade-button"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
        const debugWindow = window as Window & {
            __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown>;
            SpeechRecognition?: unknown;
            webkitSpeechRecognition?: unknown;
        };
        const speechRecognition = debugWindow.SpeechRecognition ?? debugWindow.webkitSpeechRecognition;
        const speechRecognitionName = typeof speechRecognition === 'function'
            ? speechRecognition.name
            : null;

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
                speechRecognitionName,
                speechRecognitionIsMock: speechRecognitionName === 'MockSpeechRecognition',
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
            runtime: typeof debugWindow.__SPEECH_RUNTIME_DEBUG__ === 'function'
                ? debugWindow.__SPEECH_RUNTIME_DEBUG__()
                : null,
        };
    }, label).catch((error) => ({
        label,
        snapshotError: error instanceof Error ? error.message : String(error),
        url: page.url(),
    }));
}

export async function assertNativeSpeechRecognitionIsReal(page: Page, label: string) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, label);
    if (snapshot.browser?.speechRecognitionIsMock) {
        throw new Error(
            `Native benchmark is using MockSpeechRecognition, which is silent by default. ` +
            `Run live Native benchmarks without VITE_TEST_MODE=true.\n${JSON.stringify(snapshot, null, 2)}`
        );
    }
}

export async function assertPreStartMode(page: Page, mode: 'native' | 'cloud' | 'private') {
    try {
        await expect(async () => {
            const snapshot = await collectBenchmarkPreconditionSnapshot(page, `pre-start-${mode}`);
            const runtime = snapshot && typeof snapshot === 'object' && 'runtime' in snapshot
                ? snapshot.runtime as Record<string, unknown> | null
                : null;
            const policy = runtime?.policy as Record<string, unknown> | undefined;

            expect(snapshot.ui?.modeSelectState, `PRE_START_MODE_STATE selector must remain ${mode}`).toBe(mode);
            expect(snapshot.root?.runtimeState, 'PRE_START_MODE_STATE runtime should be ready or idle before Start').toMatch(/READY|IDLE/);
            expect(runtime?.controllerPreferredMode, `PRE_START_MODE_STATE controller policy must prefer ${mode}`).toBe(mode);
            expect(policy?.preferredMode, `PRE_START_MODE_STATE policy preferredMode must be ${mode}`).toBe(mode);
            if (runtime?.serviceMode != null) {
                expect(runtime.serviceMode, `PRE_START_MODE_STATE existing service mode must be ${mode}`).toBe(mode);
            }
        }).toPass({ timeout: 15_000, intervals: [500, 1_000, 2_000] });
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, `PRE_START_MODE_STATE_${mode}`);
        throw new Error(`PRE_START_MODE_STATE failed for ${mode}\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
    }
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

    const deadline = Date.now() + 45_000;
    let attempt = 0;
    let lastOptionState: unknown = null;

    while (Date.now() < deadline) {
        attempt++;
        await select.click({ force: true }).catch(() => undefined);

        const option = page.getByTestId(`stt-mode-${mode}`);
        const visible = await option.isVisible({ timeout: 2_000 }).catch(() => false);
        const enabled = visible
            ? await option.evaluate((element) => {
                const htmlElement = element as HTMLElement;
                return (
                    htmlElement.getAttribute('aria-disabled') !== 'true' &&
                    !htmlElement.hasAttribute('disabled') &&
                    !htmlElement.hasAttribute('data-disabled')
                );
            }).catch(() => false)
            : false;

        lastOptionState = { attempt, visible, enabled };

        if (visible && enabled) {
            await option.click({ force: true });

            try {
                await expect(select).toHaveAttribute('data-state', mode, { timeout: 5_000 });
                return;
            } catch (error) {
                lastOptionState = {
                    attempt,
                    visible,
                    enabled,
                    selectedState: await select.getAttribute('data-state').catch(() => null),
                    error: error instanceof Error ? error.message : String(error),
                };
            }
        }

        await page.keyboard.press('Escape').catch(() => undefined);
        await page.waitForTimeout(1_000);
    }

    const snapshot = await collectBenchmarkPreconditionSnapshot(page, `select-${mode}-option-unavailable`);
    throw new Error(`Benchmark mode selection precondition failed for ${mode}: option was not selectable before timeout\n${JSON.stringify({
        lastOptionState,
        snapshot,
    }, null, 2)}`);
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
