import * as fs from 'fs';
import * as path from 'path';
import { expect, Page, TestInfo } from '@playwright/test';

type BenchmarkPreconditionSnapshot = {
    label: string;
    url: string;
    title?: string;
    environmentProof?: ReleaseProofEnvironment;
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

type ReleaseProofEnvironment = {
    url: string;
    port: number | null;
    authMode: 'real' | 'mock' | 'unknown';
    mockAuth: boolean;
    supabaseUrl?: string;
    releaseProofEligible: boolean;
    cdpSameTab: boolean | null;
    invalidReasons: string[];
    source?: 'app-runtime-config' | 'benchmark-fallback';
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
        const readPort = () => {
            if (window.location.port) {
                const parsed = Number(window.location.port);
                return Number.isFinite(parsed) ? parsed : null;
            }
            if (window.location.protocol === 'http:') return 80;
            if (window.location.protocol === 'https:') return 443;
            return null;
        };
        const bodyText = document.body?.innerText?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? '';
        const modeSelect = document.querySelector('[data-testid="stt-mode-select"]') as HTMLElement | null;
        const startButton = document.querySelector('[data-testid="session-start-stop-button"]') as HTMLElement | null;
        const transcript = document.querySelector('[data-testid="transcript-container"]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) ?? '';
        const profileText = document.querySelector('[data-testid="pro-badge"], [data-testid="nav-upgrade-button"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
        const debugWindow = window as Window & {
            __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown>;
            __APP_RUNTIME_CONFIG__?: {
                url?: string;
                port?: number;
                authMode?: string;
                mockAuth?: boolean;
                supabaseUrl?: string;
                releaseProofEligible?: boolean;
            };
            SpeechRecognition?: unknown;
            webkitSpeechRecognition?: unknown;
            __E2E_CONTEXT__?: boolean;
            __E2E_MOCK_SESSION__?: boolean;
            __SS_E2E__?: unknown;
            TEST_MODE?: boolean;
        };
        const speechRecognition = debugWindow.SpeechRecognition ?? debugWindow.webkitSpeechRecognition;
        const speechRecognitionName = typeof speechRecognition === 'function'
            ? speechRecognition.name
            : null;
        const port = readPort();
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const mockAuth = Boolean(
            debugWindow.__E2E_CONTEXT__ ||
            debugWindow.__E2E_MOCK_SESSION__ ||
            debugWindow.__SS_E2E__ ||
            debugWindow.TEST_MODE ||
            speechRecognitionName === 'MockSpeechRecognition'
        );
        const authMode: ReleaseProofEnvironment['authMode'] = mockAuth ? 'mock' : (isLocalhost && port === 5174 ? 'real' : 'unknown');
        const invalidReasons = [
            ...(!isLocalhost ? ['not_localhost'] : []),
            ...(port !== 5174 ? [`port_${port ?? 'unknown'}_not_5174`] : []),
            ...(authMode !== 'real' ? [`auth_${authMode}`] : []),
            ...(mockAuth ? ['mock_auth_detected'] : []),
        ];
        const appRuntimeConfig = debugWindow.__APP_RUNTIME_CONFIG__;
        const appRuntimeAuthMode: ReleaseProofEnvironment['authMode'] = appRuntimeConfig?.authMode === 'real' || appRuntimeConfig?.authMode === 'mock'
            ? appRuntimeConfig.authMode
            : 'unknown';
        const appRuntimePort = typeof appRuntimeConfig?.port === 'number' && Number.isFinite(appRuntimeConfig.port)
            ? appRuntimeConfig.port
            : port;
        const appRuntimeSupabaseUrl = typeof appRuntimeConfig?.supabaseUrl === 'string'
            ? appRuntimeConfig.supabaseUrl
            : undefined;
        const appRuntimeIsLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const appRuntimeUsesRealSupabase = appRuntimeSupabaseUrl
            ? /\.supabase\.co\/?$/.test(appRuntimeSupabaseUrl)
            : true;
        const appRuntimeInvalidReasons = appRuntimeConfig
            ? [
                ...(!appRuntimeIsLocalhost ? ['not_localhost'] : []),
                ...(appRuntimePort !== 5174 ? [`port_${appRuntimePort ?? 'unknown'}_not_5174`] : []),
                ...(appRuntimeAuthMode !== 'real' ? [`auth_${appRuntimeAuthMode}`] : []),
                ...(appRuntimeConfig.mockAuth ? ['mock_auth_detected'] : []),
                ...(!appRuntimeUsesRealSupabase ? ['supabase_not_real'] : []),
                ...(!appRuntimeConfig.releaseProofEligible ? ['app_runtime_releaseProofEligible_false'] : []),
            ]
            : [];
        const environmentProof = appRuntimeConfig
            ? {
                url: appRuntimeConfig.url || window.location.href,
                port: appRuntimePort,
                authMode: appRuntimeAuthMode,
                mockAuth: Boolean(appRuntimeConfig.mockAuth),
                supabaseUrl: appRuntimeSupabaseUrl,
                releaseProofEligible: Boolean(appRuntimeConfig.releaseProofEligible),
                cdpSameTab: true,
                invalidReasons: appRuntimeInvalidReasons,
                source: 'app-runtime-config' as const,
            }
            : {
                url: window.location.href,
                port,
                authMode,
                mockAuth,
                releaseProofEligible: invalidReasons.length === 0,
                cdpSameTab: true,
                invalidReasons,
                source: 'benchmark-fallback' as const,
            };

        return {
            label: snapshotLabel,
            url: window.location.href,
            title: document.title,
            environmentProof,
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

export async function logBenchmarkPhase(page: Page, phase: string) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, phase);
    console.log(`[STT_BENCHMARK_PHASE] ${JSON.stringify(snapshot)}`);
    return snapshot;
}

export async function assertManualReleaseProofEnvironment(page: Page, label: string) {
    const snapshot = await collectBenchmarkPreconditionSnapshot(page, label);
    const proof = snapshot.environmentProof;

    if (!proof?.releaseProofEligible) {
        throw new Error(
            `INVALID_SETUP setup.env RELEASE_PROOF_INELIGIBLE ${label}\n` +
            `Manual STT release proof must run on localhost:5174 with real auth. ` +
            `localhost:5173, mock auth, test-mode builds, and wrong CDP tabs are invalid evidence.\n` +
            `${JSON.stringify(snapshot, null, 2)}`
        );
    }

    return proof;
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
        await logBenchmarkPhase(page, 'SETUP_STT_MODE_SESSION_READY');
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
                await logBenchmarkPhase(page, `SETUP_STT_MODE_SELECTED_${mode.toUpperCase()}`);
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
    await logBenchmarkPhase(page, 'SETUP_MODEL_PROVIDER_WAIT_START');
    try {
        await page.waitForFunction(() => {
            const root = document.documentElement;
            const runtimeState = root.getAttribute('data-runtime-state');
            const sttReady = root.getAttribute('data-stt-ready');
            const modelStatus = root.getAttribute('data-model-status');

            return (
                sttReady === 'true' ||
                runtimeState === 'RECORDING' ||
                modelStatus === 'ready'
            );
        }, undefined, { timeout });
        await logBenchmarkPhase(page, 'SETUP_MODEL_PROVIDER_READY');
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-engine-ready-timeout');
        throw new Error(
            `INVALID_SETUP setup.model_provider TIMEOUT private-engine-ready-timeout ` +
            `after ${timeout}ms\n${JSON.stringify(snapshot, null, 2)}\n` +
            `${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export async function preparePrivateModelIfPrompted(page: Page, timeout = 180_000) {
    const setupButton = page.locator(
        [
            '[data-testid="download-model-button"]',
            '[data-testid="download-model-button-inline"]',
        ].join(','),
    ).first();

    if (await setupButton.isVisible({ timeout: 10_000 }).catch(() => false)) {
        await logBenchmarkPhase(page, 'SETUP_MODEL_PROVIDER_BUTTON_VISIBLE');
        if (process.env.PRIVATE_SETUP_USER_CONSENT_REQUIRED === 'true') {
            const snapshot = await collectBenchmarkPreconditionSnapshot(page, 'private-setup-user-consent-required');
            throw new Error(
                `INVALID_SETUP setup.model_provider USER_CONSENT_REQUIRED private-setup-download-visible\n` +
                `Private model setup requires an explicit user click; the proof harness must not auto-download.\n` +
                `${JSON.stringify(snapshot, null, 2)}`
            );
        }
        await setupButton.scrollIntoViewIfNeeded().catch(() => undefined);
        try {
            await setupButton.click({ timeout: 10_000 });
        } catch (error) {
            await logBenchmarkPhase(page, 'SETUP_MODEL_PROVIDER_BUTTON_FORCE_CLICK_RETRY');
            console.warn('[benchmark-utils] Private setup click needed force retry', error);
            await setupButton.click({ force: true, timeout: 5_000 });
        }
        await logBenchmarkPhase(page, 'SETUP_MODEL_PROVIDER_BUTTON_CLICKED');
    } else {
        await logBenchmarkPhase(page, 'SETUP_MODEL_PROVIDER_BUTTON_NOT_VISIBLE');
    }

    await waitForPrivateEngineReady(page, timeout);
}

export async function expectBenchmarkRecordingStarted(page: Page, label: string) {
    try {
        // Canonical "recording started" signal is data-recording=true on the start/stop button.
        // The `Stop Recording` aria-label only renders once the stop control mounts and was a flaky
        // proxy (it broke the native-preflight probe). Wait for the attribute, falling back to the
        // label so existing behavior is preserved where the attribute isn't set.
        await page.waitForFunction(() => (
            document.querySelector('[data-testid="session-start-stop-button"]')?.getAttribute('data-recording') === 'true'
        ), { timeout: 12_000 }).catch(async () => {
            await expect(page.getByLabel(/Stop Recording/i)).toBeVisible({ timeout: 5_000 });
        });
        await logBenchmarkPhase(page, `PROOF_RUNTIME_RECORDING_STARTED_${label.toUpperCase()}`);
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
        await logBenchmarkPhase(page, `PROOF_TIMING_FIRST_TEXT_${label.toUpperCase()}`);
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, `${label}-transcript-output-missing`);
        throw new Error(`Benchmark transcript precondition failed for ${label}: transcript did not exceed ${minWords} words before WER\n${JSON.stringify(snapshot, null, 2)}\n${error instanceof Error ? error.message : String(error)}`);
    }
}

type BenchmarkSaveCandidate = {
    selectedForSave?: string;
    saveCandidateReason?: string;
    selectedForSaveLength?: number;
    finalWordCount?: number;
    meaningfulWordCount?: number;
    resultTranscriptLength?: number;
    chunkTranscriptLength?: number;
    storeTranscriptLength?: number;
    storePartialTranscriptLength?: number;
    visibleStoreTranscriptLength?: number;
    frozenStopTranscriptLength?: number;
    candidateLengths?: Array<{ source: string; length: number }>;
    repetitionRisk?: boolean;
    repetitionRiskReason?: 'adjacent_loop' | 'near_whole_doubling' | 'repeated_span' | null;
    repeatedSpanSummary?: string | null;
};

export async function attachPrivateBenchmarkEvidence(
    page: Page,
    testInfo: TestInfo,
    label: string,
): Promise<void> {
    const includeAudioDataUrl = process.env.STT_INCLUDE_AUDIO_DATA_URL === 'true';
    const evidence = await page.evaluate(({ evidenceLabel, includeAudioDataUrl: shouldIncludeAudioDataUrl }) => {
        const root = document.documentElement;
        const debugWindow = window as Window & {
            __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown>;
            __PRIVATE_STT_TIMELINE__?: unknown[];
            __PRIVATE_TRANSCRIPT_TRACE__?: unknown[];
            __PRIVATE_INFERENCE_AUDIO_CHUNKS__?: Array<Record<string, unknown> & { wavDataUrl?: string }>;
            __PRIVATE_UTTERANCE_AUDIO_CHUNKS__?: Array<Record<string, unknown> & { wavDataUrl?: string }>;
        };
        const transcriptContainer = document.querySelector('[data-testid="transcript-container"]');
        const mapAudioChunk = (chunk: Record<string, unknown> & { wavDataUrl?: string }) => {
            const { wavDataUrl, ...rest } = chunk;
            return {
                ...rest,
                wavDataUrlBytes: typeof wavDataUrl === 'string' ? wavDataUrl.length : 0,
                ...(shouldIncludeAudioDataUrl ? { wavDataUrl: wavDataUrl ?? null } : {}),
            };
        };

        return {
            label: evidenceLabel,
            capturedAt: new Date().toISOString(),
            url: window.location.href,
            root: {
                appReady: root.getAttribute('data-app-ready'),
                runtimeState: root.getAttribute('data-runtime-state'),
                sttReady: root.getAttribute('data-stt-ready'),
                modelStatus: root.getAttribute('data-model-status'),
                sessionPersisted: root.getAttribute('data-session-persisted'),
                transcriptState: transcriptContainer?.getAttribute('data-transcript-state') ?? null,
            },
            transcriptText: transcriptContainer?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
            runtime: typeof debugWindow.__SPEECH_RUNTIME_DEBUG__ === 'function'
                ? debugWindow.__SPEECH_RUNTIME_DEBUG__()
                : null,
            privateTimeline: debugWindow.__PRIVATE_STT_TIMELINE__ ?? [],
            privateTranscriptTrace: debugWindow.__PRIVATE_TRANSCRIPT_TRACE__ ?? [],
            privateAudioChunks: (debugWindow.__PRIVATE_INFERENCE_AUDIO_CHUNKS__ ?? []).map(mapAudioChunk),
            privateUtteranceAudioChunks: (debugWindow.__PRIVATE_UTTERANCE_AUDIO_CHUNKS__ ?? []).map(mapAudioChunk),
        };
    }, { evidenceLabel: label, includeAudioDataUrl }).catch((error) => ({
        label,
        capturedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
        url: page.url(),
    }));

    const evidenceJson = JSON.stringify(evidence, null, 2);
    const evidencePath = testInfo.outputPath(`${label}-private-benchmark-evidence.json`);
    fs.writeFileSync(evidencePath, evidenceJson);

    await testInfo.attach(`${label}-private-benchmark-evidence.json`, {
        path: evidencePath,
        contentType: 'application/json',
    });
}

export async function waitForBenchmarkSaveCandidate(
    page: Page,
    label: string,
    timeout = 90_000,
): Promise<BenchmarkSaveCandidate> {
    try {
        await expect(async () => {
            const candidate = await page.evaluate(() => {
                const debugWindow = window as Window & {
                    __SPEECH_RUNTIME_DEBUG__?: () => { saveCandidate?: BenchmarkSaveCandidate | null };
                };
                return debugWindow.__SPEECH_RUNTIME_DEBUG__?.().saveCandidate ?? null;
            });
            expect(candidate, 'saveCandidate must be exposed after Stop').toBeTruthy();
        }).toPass({ timeout, intervals: [250, 500, 1_000, 2_000] });

        const candidate = await page.evaluate(() => {
            const debugWindow = window as Window & {
                __SPEECH_RUNTIME_DEBUG__?: () => { saveCandidate?: BenchmarkSaveCandidate | null };
            };
            return debugWindow.__SPEECH_RUNTIME_DEBUG__?.().saveCandidate ?? null;
        });
        await logBenchmarkPhase(page, `PROOF_JOURNEY_SAVE_CANDIDATE_READY_${label.toUpperCase()}`);
        if (!candidate) {
            throw new Error('saveCandidate unexpectedly missing after wait.');
        }
        return candidate;
    } catch (error) {
        const snapshot = await collectBenchmarkPreconditionSnapshot(page, `${label}-save-candidate-missing`);
        throw new Error(
            `PROOF_FAIL proof.journey.stop_save_detail saveCandidate missing for ${label} after ${timeout}ms\n` +
            `${JSON.stringify(snapshot, null, 2)}\n` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
