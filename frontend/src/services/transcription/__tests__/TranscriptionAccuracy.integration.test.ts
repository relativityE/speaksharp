import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { testRegistry } from '../TestRegistry';
import { ITranscriptionEngine } from '../modes/types';
import { TranscriptionMode } from '../TranscriptionPolicy';

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

            class MockEngine implements ITranscriptionEngine {
                onTranscriptUpdate: (data: { transcript: { final?: string; partial?: string; speaker?: string }; audioData?: Float32Array }) => void;
                onModelLoadProgress: (progress: number | null) => void;

                constructor(options: {
                    onTranscriptUpdate: (data: { transcript: { final?: string; partial?: string; speaker?: string }; audioData?: Float32Array }) => void;
                    onModelLoadProgress: (progress: number | null) => void;
                }) {
                    this.onTranscriptUpdate = options.onTranscriptUpdate;
                    this.onModelLoadProgress = options.onModelLoadProgress;
                }
                init = vi.fn().mockResolvedValue(undefined);
                startTranscription = async () => {
                    // Simulate receiving final transcript
                    this.onTranscriptUpdate({ transcript: { final: expectedText } });
                };
                // Engines should return the full transcript when stopped
                stopTranscription = vi.fn().mockResolvedValue(expectedText);
                getTranscript = vi.fn().mockResolvedValue(expectedText);
                terminate = vi.fn().mockResolvedValue(undefined);
                getEngineType = () => mode as TranscriptionMode;
                getLastHeartbeatTimestamp = () => Date.now();
            }

            testRegistry.register(mode, (opts: unknown) => new MockEngine(opts as {
                onTranscriptUpdate: (data: { transcript: { final?: string; partial?: string; speaker?: string }; audioData?: Float32Array }) => void;
                onModelLoadProgress: (progress: number | null) => void;
            }));

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
