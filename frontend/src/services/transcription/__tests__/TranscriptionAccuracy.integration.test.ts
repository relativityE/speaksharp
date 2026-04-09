import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { STTEngine } from '@/contracts/STTEngine';
import { Result, TranscriptionModeOptions } from '../modes/types';
import { EngineType } from '@/contracts/IPrivateSTTEngine';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { sttRegistry } from '@/services/transcription/STTRegistry';

/**
 * @file TranscriptionAccuracy.integration.test.ts
 * @description Integration tests verifying that the TranscriptionService correctly
 * collects and returns transcripts from all underlying engines.
 */

describe('Transcription Accuracy Multi-Engine Integration', () => {
    let service: TranscriptionService | null = null;
    const instances: Record<string, STTEngine> = {};

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
        sttRegistry.clear();
        if (typeof window !== 'undefined' && '__SS_E2E__' in window) {
            delete (window as unknown as Record<string, unknown>).__SS_E2E__;
        }
    });

    const modes: ('native' | 'cloud' | 'private')[] = ['native', 'cloud', 'private'];

    modes.forEach(mode => {
        it(`should produce accurate transcript for ${mode} mode`, async () => {
            const expectedText = `Accurate transcript from ${mode}`;

            class MockEngine extends STTEngine {
                constructor(public readonly type: EngineType, options: TranscriptionModeOptions) {
                    super(options);
                }

                protected async onInit() {
                    return Result.ok(undefined);
                }
                protected async onStart() {
                    (this.options as TranscriptionModeOptions).onTranscriptUpdate?.({ transcript: { final: expectedText } });
                }
                protected async onStop() {}
                protected async onDestroy() {}
                async transcribe() { return Result.ok(expectedText); }

                public override async getTranscript() {
                    return expectedText;
                }
            }

            // 1. Inject into STTRegistry using architectural keys
            sttRegistry.register('assemblyai', (opts: TranscriptionModeOptions) => { instances.assemblyai = new MockEngine('cloud', opts); return instances.assemblyai; });
            sttRegistry.register('native-browser', (opts: TranscriptionModeOptions) => { instances['native-browser'] = new MockEngine('native', opts); return instances['native-browser']; });
            sttRegistry.register('whisper-turbo', (opts: TranscriptionModeOptions) => { instances['whisper-turbo'] = new MockEngine('transformers-js', opts); return instances['whisper-turbo']; });

            service = new TranscriptionService({
                mockMic: {
                    stream: {} as MediaStream,
                    stop: vi.fn(),
                    clone: vi.fn(),
                    onFrame: vi.fn().mockReturnValue(() => { }),
                } as unknown as import('../utils/types').MicStream,
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
