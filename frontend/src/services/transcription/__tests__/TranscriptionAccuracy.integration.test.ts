import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { STTEngine } from '@/contracts/STTEngine';
import { Result, TranscriptionModeOptions, Transcript } from '../modes/types';
import { EngineCallbacks, EngineType } from '@/contracts/IPrivateSTTEngine';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';

/**
 * @file TranscriptionAccuracy.integration.test.ts
 * @description Integration tests verifying that the TranscriptionService correctly
 * collects and returns transcripts from all underlying engines.
 */

describe('Transcription Accuracy Multi-Engine Integration', () => {
    let service: TranscriptionService | null = null;

    beforeEach(async () => {
        vi.useFakeTimers();
        // 1. Setup T=0 Environment
        await setupStrictZero();
    });

    afterEach(async () => {
        if (service) {
            await service.destroy();
            service = null;
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
        if (typeof window !== 'undefined' && '__SS_E2E__' in window) {
            delete (window as any).__SS_E2E__;
        }
    });

    const modes: ('native' | 'cloud' | 'private')[] = ['native', 'cloud', 'private'];

    modes.forEach(mode => {
        it(`should produce accurate transcript for ${mode} mode`, async () => {
            const expectedText = `Accurate transcript from ${mode}`;

            class MockEngine extends STTEngine {
                private onTranscriptUpdate?: (update: { transcript: Transcript }) => void;
                private currentTranscriptText: string = '';

                constructor(public readonly type: EngineType, private expectedText: string) {
                    super();
                }

                protected async onInit(callbacks: EngineCallbacks) {
                    this.onTranscriptUpdate = (callbacks as unknown as TranscriptionModeOptions).onTranscriptUpdate;
                    return Result.ok(undefined);
                }
                protected async onStart(_mic?: import('../utils/types').MicStream) {
                    this.currentTranscriptText = this.expectedText;
                    this.onTranscriptUpdate?.({ transcript: { final: this.expectedText } });
                }
                protected async onStop() {}
                protected async onDestroy() {}
                async transcribe() { return Result.ok(this.expectedText); }

                public override async getTranscript() {
                    return this.expectedText;
                }
            }

            // 1. Inject into TestRegistry using architectural keys
            const e2eWindow = window as any;
            if (!e2eWindow.__SS_E2E__) e2eWindow.__SS_E2E__ = { registry: {} };
            const engineKey = mode === 'native' ? 'native-browser' : mode === 'cloud' ? 'assemblyai' : 'whisper-turbo';
            e2eWindow.__SS_E2E__.registry[engineKey] = () => new MockEngine(mode as unknown as EngineType, expectedText);

            service = new TranscriptionService({
                policy: {
                    allowNative: mode === 'native',
                    allowCloud: mode === 'cloud',
                    allowPrivate: mode === 'private',
                    preferredMode: mode,
                    allowFallback: false,
                    executionIntent: 'test'
                }
            });

            await service.init();
            await service.startTranscription();

            // Allow async operations to complete and exceed MIN_RECORDING_DURATION_MS (100ms)
            await vi.advanceTimersByTimeAsync(200);

            const result = await service.stopTranscription();

            expect(result?.success).toBe(true);
            expect(result?.transcript).toBe(expectedText);
            // Verify stats were calculated correctly (roughly)
            expect(result?.stats.total_words).toBeGreaterThan(0);
            expect(result?.stats.transcript).toBe(expectedText);
        });
    });
});
