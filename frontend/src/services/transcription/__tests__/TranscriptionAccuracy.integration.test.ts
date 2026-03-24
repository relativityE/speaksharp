import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { testRegistry } from '../TestRegistry';
import { STTEngine } from '@/contracts/STTEngine';
import { Result, TranscriptionModeOptions, Transcript } from '../modes/types';
import { EngineCallbacks, EngineType } from '@/contracts/IPrivateSTTEngine';
/**
 * @file TranscriptionAccuracy.integration.test.ts
 * @description Integration tests verifying that the TranscriptionService correctly
 * collects and returns transcripts from all underlying engines.
 */

describe('Transcription Accuracy Multi-Engine Integration', () => {
    beforeEach(() => {
        testRegistry.clear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        testRegistry.clear();
        vi.useRealTimers();
    });

    const modes: ('native' | 'cloud' | 'private')[] = ['native', 'cloud', 'private'];

    modes.forEach(mode => {
        it(`should produce accurate transcript for ${mode} mode`, async () => {
            const expectedText = `Accurate transcript from ${mode}`;


            class MockEngine extends STTEngine {
                private onTranscriptUpdate?: (update: { transcript: Transcript }) => void;

                constructor(public readonly type: EngineType, private expectedText: string) {
                    super();
                }

                protected async onInit(callbacks: EngineCallbacks) {
                    this.onTranscriptUpdate = (callbacks as unknown as TranscriptionModeOptions).onTranscriptUpdate;
                    return Result.ok(undefined);
                }
                protected async onStart() {}
                protected async onStop() {}
                protected async onDestroy() {}
                async transcribe() { return Result.ok(this.expectedText); }

                public override async startTranscription() {
                    await this.start();
                    this.onTranscriptUpdate?.({ transcript: { final: this.expectedText } });
                }

                public override async stopTranscription() {
                    await this.stop();
                    return this.expectedText;
                }

                public override async getTranscript() {
                    return this.expectedText;
                }
            }

            testRegistry.register(mode, (_opts: unknown) => new MockEngine(mode as unknown as EngineType, expectedText));

            const service = new TranscriptionService({
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
