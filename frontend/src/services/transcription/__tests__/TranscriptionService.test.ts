import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import { sanitizeTranscriptText } from '../TranscriptionService';
import type { TranscriptionServiceOptions } from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import type { MicStream } from '../utils/types';
import type { PracticeSession } from '../../../types/session';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result, TranscriptionModeOptions } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';

vi.mock('@/lib/toast', () => ({
    toast: {
        info: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        dismiss: vi.fn(),
    },
}));

describe('TranscriptionService', () => {
    let service: TranscriptionService;
    let TranscriptionServiceClass: typeof TranscriptionService;
    let resetTranscriptionService: () => void;
    let ENV: { isTest: boolean; disableWasm: boolean };
    
    const mockOnTranscriptUpdate = vi.fn();
    const mockOnModelLoadProgress = vi.fn();
    const mockOnReady = vi.fn();
    const mockGetToken = vi.fn().mockResolvedValue('mock-token');

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // 1. Reset $+$ Enrollment (Harness is post-reset authoritative)
        await setupStrictZero();

        // 2. Dynamic Import (Captures post-reset registry)
        const tsModule = (await import('../TranscriptionService')) as unknown as { 
          default: typeof TranscriptionService, 
          resetTranscriptionService: () => void 
        };
        TranscriptionServiceClass = tsModule.default;
        resetTranscriptionService = tsModule.resetTranscriptionService;
        resetTranscriptionService();

        const flagsModule = await import('../../../config/TestFlags');
        ENV = flagsModule.ENV;

        const storageModule = await import('../../../lib/storage');
        vi.spyOn(storageModule, 'saveSession').mockResolvedValue({ 
            session: { id: 'test-sess', user_id: 'u1', created_at: '', duration: 0 } as unknown as PracticeSession, 
            usageExceeded: false 
        });

        service = new (TranscriptionServiceClass as unknown as new (o: TranscriptionServiceOptions) => TranscriptionService)({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: true,
                allowPrivate: true,
                preferredMode: 'mock',
                allowFallback: true,
                executionIntent: 'test'
            } as TranscriptionPolicy,
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });
    });

    afterEach(async () => {
        if (service) {
            await service.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
        if (resetTranscriptionService) resetTranscriptionService();
        
        // Dynamic cleanup (Identity alignment)
        const { sttRegistry } = await import('../STTRegistry');
        sttRegistry.clear();
    });

    it('should initialize successfully with ST=0 registry-injected mock', async () => {
        expect(ENV.isTest).toBe(true);
        expect(ENV.disableWasm).toBe(true);

        await service.init();
        expect(service.getState()).toBe('READY');
        expect(service.getMode()).toBe('mock');
    });

    it('does not claim Private is ready at download completion before model initialization succeeds', async () => {
        const { toast } = await import('@/lib/toast');
        const privateService = new (TranscriptionServiceClass as unknown as new (o: TranscriptionServiceOptions) => TranscriptionService)({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: true,
                allowPrivate: true,
                preferredMode: 'private',
                allowFallback: false,
                executionIntent: 'private-download-toast-test'
            } as TranscriptionPolicy,
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });

        (privateService as unknown as { processModelLoadProgress: (progress: number | null) => void }).processModelLoadProgress(12);
        (privateService as unknown as { processModelLoadProgress: (progress: number | null) => void }).processModelLoadProgress(42);
        (privateService as unknown as { processModelLoadProgress: (progress: number | null) => void }).processModelLoadProgress(100);

        expect(toast.info).toHaveBeenCalledTimes(1);
        expect(toast.info).toHaveBeenCalledWith(
            expect.stringMatching(/Private transcription is setting up/i),
            expect.objectContaining({ id: 'private-model-alternative-stt', duration: 5000 })
        );
        expect(toast.success).not.toHaveBeenCalled();

        await privateService.destroy();
    });

    it('MAXDEPTH Part 3: dedupes duplicate integer-percent progress (no store/callback flood)', async () => {
        const onProgress = vi.fn();
        const svc = new (TranscriptionServiceClass as unknown as new (o: TranscriptionServiceOptions) => TranscriptionService)({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: onProgress,
            onReady: vi.fn(),
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
        });
        const p = (svc as unknown as { processModelLoadProgress: (n: number | null) => void });
        // Worker floods the SAME integer percent many times; only DISTINCT percents should emit.
        p.processModelLoadProgress(37);
        p.processModelLoadProgress(37);
        p.processModelLoadProgress(37);
        p.processModelLoadProgress(38);
        p.processModelLoadProgress(38);
        // 37 once + 38 once = 2 (not 5) — the duplicate-percent churn that drove ~423/429 store
        // mutations and the render storm is suppressed at the source.
        expect(onProgress).toHaveBeenCalledTimes(2);
        expect(onProgress).toHaveBeenNthCalledWith(1, 37);
        expect(onProgress).toHaveBeenNthCalledWith(2, 38);
        await svc.destroy();
    });

    it('should sanitize transcripts effectively', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        
        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'transformers-js' as EngineType; }
            
            public triggerTranscript(data: { transcript: { final?: string; partial?: string } }) {
                (this.options as TranscriptionModeOptions)?.onTranscriptUpdate?.(data);
            }
        }
        
        const mockEngine = new MockEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('mock', mockEngine);

        await service.startTranscription();
        
        mockEngine.triggerTranscript({
            transcript: {
                final: '[BLANK_AUDIO]  Hello world [MUSIC]  ',
                partial: 'thinking...'
            }
        });

        expect(mockOnTranscriptUpdate).toHaveBeenNthCalledWith(1, {
            transcript: { final: 'Hello world' }
        });
        expect(mockOnTranscriptUpdate).toHaveBeenNthCalledWith(2, {
            transcript: { partial: 'thinking...' }
        });
    });

    it('should reject startTranscription when strategy start fails', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        const startError = new Error('SIMULATED_ENGINE_START_FAILURE');

        class FailingStartEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() { throw startError; }
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'transformers-js' as EngineType; }
        }

        const failingEngine = new FailingStartEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('transformers-js', failingEngine);
        sttRegistry.registerStatic('mock', failingEngine);

        await expect(service.startTranscription()).rejects.toThrow('SIMULATED_ENGINE_START_FAILURE');
        expect(service.getState()).toBe('FAILED');
    });

    it('starts the selected strategy exactly once for one recording start', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        sttRegistry.clear();
        const onStart = vi.fn();

        class CountingStartEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() { onStart(); }
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'transformers-js' as EngineType; }
        }

        sttRegistry.registerStatic('mock', new CountingStartEngine({} as unknown as TranscriptionModeOptions));

        await service.startTranscription();

        expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('should sanitize bracketed and parenthetical transcript metadata tags', () => {
        expect(sanitizeTranscriptText('[MUSIC] Hello  (applause) world [BLANK_AUDIO]')).toBe('Hello world');
        expect(sanitizeTranscriptText('Testing (laughter) one [SILENCE] two')).toBe('Testing one two');
        expect(sanitizeTranscriptText('>> On the stale smell')).toBe('On the stale smell');
        expect(sanitizeTranscriptText('*Spits* Stay, my told wild tales to frightened him.')).toBe('Stay, my told wild tales to frightened him.');
        expect(sanitizeTranscriptText('Basically, a dash of peppers, oil, beef stew. 1.2, 1.5.')).toBe('Basically, a dash of peppers, oil, beef stew.');
    });

    it('REGRESSION: forwards later partials without re-sending stale final transcript', async () => {
        const { sttRegistry } = await import('../STTRegistry');

        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'transformers-js' as EngineType; }

            public triggerTranscript(data: { transcript: { final?: string; partial?: string } }) {
                (this.options as TranscriptionModeOptions)?.onTranscriptUpdate?.(data);
            }
        }

        const mockEngine = new MockEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('mock', mockEngine);

        await service.startTranscription();

        mockEngine.triggerTranscript({ transcript: { final: 'already committed final text' } });
        mockEngine.triggerTranscript({ transcript: { partial: 'new live partial words' } });

        expect(mockOnTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: { partial: 'new live partial words' },
        });
    });

    it('REGRESSION: accumulates sentence-sized final updates instead of replacing prior finals', async () => {
        const { sttRegistry } = await import('../STTRegistry');

        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'transformers-js' as EngineType; }

            public triggerTranscript(data: { transcript: { final?: string; partial?: string } }) {
                (this.options as TranscriptionModeOptions)?.onTranscriptUpdate?.(data);
            }
        }

        const mockEngine = new MockEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('mock', mockEngine);

        await service.startTranscription();

        mockEngine.triggerTranscript({ transcript: { final: 'private local microphone proof starts now' } });
        mockEngine.triggerTranscript({ transcript: { final: 'I want to make one simple point before we move on' } });
        mockEngine.triggerTranscript({ transcript: { final: 'with a clear next step' } });

        expect(mockOnTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: {
                final: 'private local microphone proof starts now I want to make one simple point before we move on with a clear next step',
            },
        });
    });

    it('REGRESSION (#87/#88): an authoritative whole-utterance final REPLACES accumulated rolling finals (no duplication)', async () => {
        const { sttRegistry } = await import('../STTRegistry');

        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'transformers-js' as EngineType; }

            public triggerTranscript(data: { transcript: { final?: string; partial?: string; replacesRollingTranscript?: boolean } }) {
                (this.options as TranscriptionModeOptions)?.onTranscriptUpdate?.(data);
            }
        }

        const mockEngine = new MockEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('mock', mockEngine);

        await service.startTranscription();

        // Garbled streaming/provisional finals accumulate (the v4 rolling preview).
        mockEngine.triggerTranscript({ transcript: { final: 'well the swan dive was far short of pre the box was thrown beside the door' } });
        // Clean post-Stop whole-utterance decode: NOT a forward prefix of the garbled preview, so the
        // generic merge would APPEND it → doubled service_result / selectedForSave (the 142-vs-87 bug).
        // The replace flag must make it the authoritative full transcript.
        mockEngine.triggerTranscript({
            transcript: {
                final: 'Well, the swan dive was far short of perfect, the box was thrown beside the parked truck.',
                replacesRollingTranscript: true,
            },
        });

        // service_result (what stop() returns and selectedForSave reads) is the clean final ONLY.
        expect(mockOnTranscriptUpdate).toHaveBeenLastCalledWith({
            transcript: {
                final: 'Well, the swan dive was far short of perfect, the box was thrown beside the parked truck.',
                replacesRollingTranscript: true,
            },
        });
        const internal = service as unknown as { currentTranscript: string };
        expect(internal.currentTranscript).toBe(
            'Well, the swan dive was far short of perfect, the box was thrown beside the parked truck.'
        );
    });

    it('#891 Phase 5.6 (SHADOW): app-mic transcript updates publish transcript telemetry; mock mode does not', async () => {
        const { getSessionTelemetryBus, __resetSessionTelemetryBusForTests } =
            await import('../../telemetry/sessionTelemetryBus');
        __resetSessionTelemetryBusForTests();
        const events: Array<{ type?: string; mode?: string; text?: string; replacesRollingTranscript?: boolean }> = [];
        getSessionTelemetryBus().subscribe((e) => events.push(e as never));

        const svc = service as unknown as {
            mode: string;
            emissionsEnabled: boolean;
            strategyCallbacks: { onTranscriptUpdate: (d: { transcript: { partial?: string; final?: string; replacesRollingTranscript?: boolean } }) => void };
        };

        // Private is an app-mic mode → the single service choke point mirrors Native's telemetry for it.
        // The shadow publish reads the merged app-facing transcript AFTER processTranscript, so emissions
        // must be enabled (in production the choke point is only reached when they are).
        svc.emissionsEnabled = true;
        svc.mode = 'private';
        try { svc.strategyCallbacks.onTranscriptUpdate({ transcript: { partial: 'hello' } }); } catch { /* ignore */ }
        try { svc.strategyCallbacks.onTranscriptUpdate({ transcript: { final: 'hello world', replacesRollingTranscript: true } }); } catch { /* ignore */ }

        expect(events).toContainEqual(expect.objectContaining({ type: 'transcript.partial', mode: 'private', text: 'hello' }));
        expect(events).toContainEqual(expect.objectContaining({ type: 'transcript.final', mode: 'private', text: 'hello world', replacesRollingTranscript: true }));

        // Mock is NOT a real app-mic mode → nothing published (Native self-publishes in NativeBrowser).
        events.length = 0;
        svc.mode = 'mock';
        try { svc.strategyCallbacks.onTranscriptUpdate({ transcript: { final: 'ignored' } }); } catch { /* ignore */ }
        expect(events.filter((e) => String(e.type).startsWith('transcript'))).toHaveLength(0);
    });

    it('#891 Phase 5.7 (SHADOW): final telemetry mirrors the merged app-facing transcript — overlapping finals do NOT double-count', async () => {
        const { __resetSessionTelemetryBusForTests } = await import('../../telemetry/sessionTelemetryBus');
        const { createShadowMetricsEngine } = await import('../../telemetry/shadowMetricsEngine');
        __resetSessionTelemetryBusForTests();
        const engine = createShadowMetricsEngine('s', 'private')!;

        const svc = service as unknown as {
            mode: string;
            emissionsEnabled: boolean;
            currentTranscript: string;
            strategyCallbacks: { onTranscriptUpdate: (d: { transcript: { final?: string; partial?: string; replacesRollingTranscript?: boolean } }) => void };
        };
        svc.emissionsEnabled = true;
        svc.mode = 'private';

        // Two OVERLAPPING non-replacing final segments (as Cloud emits). Naive accumulation would double the
        // words; the choke point instead publishes the merged app-facing `currentTranscript` with replace.
        try { svc.strategyCallbacks.onTranscriptUpdate({ transcript: { final: 'the plan is to launch' } }); } catch { /* ignore */ }
        try { svc.strategyCallbacks.onTranscriptUpdate({ transcript: { final: 'the plan is to launch on friday' } }); } catch { /* ignore */ }

        const snap = engine.getSnapshot();
        // Shadow transcript == the store's merged committed transcript (single source), not a doubled concat.
        expect(snap.transcript.finalText).toBe(svc.currentTranscript);
        expect(snap.transcript.finalText).not.toContain('launch the plan');
        engine.dispose();
    });

    it('REGRESSION: splits combined Web Speech final+interim into final commit then visible partial', async () => {
        const { sttRegistry } = await import('../STTRegistry');

        class MockEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            public async checkAvailability() { return { isAvailable: true }; }
            protected async onInit() { return Result.ok(undefined); }
            protected async onStart() {}
            protected async onStop() {}
            protected async onPause() {}
            protected async onResume() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'transformers-js' as EngineType; }

            public triggerTranscript(data: { transcript: { final?: string; partial?: string } }) {
                (this.options as TranscriptionModeOptions)?.onTranscriptUpdate?.(data);
            }
        }

        const mockEngine = new MockEngine({} as unknown as TranscriptionModeOptions);
        sttRegistry.registerStatic('mock', mockEngine);

        await service.startTranscription();

        mockEngine.triggerTranscript({
            transcript: {
                final: 'committed final words',
                partial: 'current interim window',
            },
        });

        expect(mockOnTranscriptUpdate).toHaveBeenNthCalledWith(1, {
            transcript: { final: 'committed final words' },
        });
        expect(mockOnTranscriptUpdate).toHaveBeenNthCalledWith(2, {
            transcript: { partial: 'current interim window' },
        });
    });

    it('should synchronously rehydrate transcript and recording status on subscription', () => {
        const internal = service as unknown as {
            currentTranscript: string;
            partialTranscript: string;
            fsm: { setState: (state: string) => void };
        };
        internal.currentTranscript = 'Hello persistent world';
        internal.partialTranscript = '';
        internal.fsm.setState('RECORDING');

        let capturedTranscript: string | null = null;
        let capturedStatus: string | null = null;
        const unsubscribe = service.subscribe({
            onTranscriptUpdate: (update) => {
                capturedTranscript = update.transcript.final ?? null;
            },
            onStatusChange: (status) => {
                capturedStatus = status.type;
            },
        }, 'rehydration-unit-test');

        expect(capturedTranscript).toBe('Hello persistent world');
        expect(capturedStatus).toBe('recording');
        unsubscribe();
    });


    it('should keep deterministic mock service ready for execution', async () => {
        await service.init();
        expect(service.getState()).toBe('READY');
    });


    it('should handle unavailable private initialization without throwing', async () => {
        const { sttRegistry } = await import('../STTRegistry');
        
        // Register a mock that always fails checkAvailability
        sttRegistry.register('mock', () => ({
            checkAvailability: async () => ({ isAvailable: false, reason: 'UNKNOWN', message: 'Injected failure' }),
            init: async () => Result.ok(undefined),
            getEngineType: () => 'transformers-js'
        } as unknown as STTEngine));

        const failingService = new (TranscriptionServiceClass as unknown as new (o: TranscriptionServiceOptions) => TranscriptionService)({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: false,
                allowPrivate: true,
                preferredMode: 'private',
                allowFallback: false,
                executionIntent: 'test-private-failure'
            } as TranscriptionPolicy,
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });

        await expect(failingService.init()).resolves.toEqual({ success: true });
        expect(['READY', 'DOWNLOAD_REQUIRED']).toContain(failingService.getState());
        await failingService.destroy();
    });
});
