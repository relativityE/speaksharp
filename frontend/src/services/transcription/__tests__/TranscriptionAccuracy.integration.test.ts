import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result, TranscriptionModeOptions } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import type { sttRegistry as SttRegistry } from '../STTRegistry';

/**
 * @file TranscriptionAccuracy.integration.test.ts
 * @description Integration tests verifying that the TranscriptionService correctly
 * collects and returns transcripts from all underlying engines.
 */

describe('Transcription Accuracy Multi-Engine Integration', () => {
    let service: TranscriptionService | null = null;
    let TranscriptionServiceClass: typeof import('../TranscriptionService').default;
    let registry: typeof SttRegistry;
    const instances: Record<string, STTEngine> = {};

    beforeEach(async () => {
        vi.useFakeTimers();
        // 1. Setup T=0 Environment
        await setupStrictZero();
        TranscriptionServiceClass = (await import('../TranscriptionService')).default;
        registry = (await import('../STTRegistry')).sttRegistry;
    });

    afterEach(async () => {
        if (service) {
            await service.destroy();
            service = null;
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
        registry?.clear();
        if (typeof window !== 'undefined' && '__SS_E2E__' in window) {
            delete (window as unknown as Record<string, unknown>).__SS_E2E__;
        }
    });

    const modes: ('native' | 'cloud' | 'private')[] = ['native', 'cloud', 'private'];

    modes.forEach(mode => {
        it(`should produce accurate transcript for ${mode} mode`, async () => {
            const expectedText = `Accurate transcript from ${mode}`;
            let frameListener: (frame: Float32Array) => void = () => undefined;

            class MockEngine extends STTEngine {
                constructor(public readonly type: EngineType, options: TranscriptionModeOptions) {
                    super(options);
                }

                public async checkAvailability() { return { isAvailable: true }; }

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

            // 1. Inject into STTRegistry using architectural keys (Task 7.2)
            registry.register('assemblyai', (opts: TranscriptionModeOptions) => { 
                instances.assemblyai = new MockEngine('cloud', opts); 
                return instances.assemblyai; 
            });
            registry.register('native-browser', (opts: TranscriptionModeOptions) => { 
                instances['native-browser'] = new MockEngine('native', opts); 
                return instances['native-browser']; 
            });
            
            // Register both private engine keys: PrivateSTT routes to transformers-js when
            // ENV.disableWasm=true (test env without real GPU), whisper-turbo when GPU is available.
            registry.register('whisper-turbo', (opts: TranscriptionModeOptions) => {
                instances['whisper-turbo'] = new MockEngine('whisper-turbo', opts);
                return instances['whisper-turbo'];
            });
            registry.register('transformers-js', (opts: TranscriptionModeOptions) => {
                instances['transformers-js'] = new MockEngine('transformers-js', opts);
                return instances['transformers-js'];
            });
            registry.register('mock', (opts: TranscriptionModeOptions) => {
                instances.mock = new MockEngine('mock', opts);
                return instances.mock;
            });

            service = new TranscriptionServiceClass({
                mockMic: {
                    stream: {} as MediaStream,
                    stop: vi.fn(),
                    clone: vi.fn(),
                    onFrame: vi.fn((listener: (frame: Float32Array) => void) => {
                        frameListener = listener;
                        return () => { frameListener = () => undefined; };
                    }),
                } as unknown as import('../utils/types').MicStream,
                policy: {
                    allowNative: mode === 'native',
                    allowCloud: mode === 'cloud',
                    allowPrivate: mode === 'private',
                    preferredMode: mode === 'private' ? 'mock' : mode,
                    allowFallback: false,
                    executionIntent: 'test'
                }
            });

            await service.init();
            await service.startTranscription();

            if (mode === 'private') {
                frameListener(new Float32Array(16000).fill(0.2));
            }

            // Allow async operations to complete and exceed MIN_RECORDING_DURATION_MS (100ms)
            await vi.advanceTimersByTimeAsync(mode === 'private' ? 700 : 200);

            const result = await service.stopTranscription();

            expect(result?.success).toBe(true);
            expect(result?.transcript).toBe(expectedText);
            // Verify stats were calculated correctly (roughly)
            expect(result?.stats.total_words).toBeGreaterThan(0);
            expect(result?.stats.transcript).toBe(expectedText);
        });
    });
});
