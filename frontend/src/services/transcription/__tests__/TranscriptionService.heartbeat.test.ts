import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionModeOptions, Result } from '../modes/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';
import { NavigateFunction } from 'react-router-dom';
import { MicStream } from '../utils/types';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';
import { sttRegistry } from '../STTRegistry';

/**
 * @file TranscriptionService.heartbeat.test.ts
 * @description Verifies the 8s heartbeat watchdog and segmented handoff logic.
 */

import { STTEngine } from '../../../contracts/STTEngine';

class MockHeartbeatEngine extends STTEngine {
    public override readonly type = 'transformers-js' as EngineType;

    constructor(options?: TranscriptionModeOptions) {
        super(options);
    }

    protected async onInit() { return Result.ok(undefined); }
    protected async onStart() { return Promise.resolve(); }
    protected async onStop() { return Promise.resolve(); }
    protected async onDestroy() { return Promise.resolve(); }
    async transcribe() { return Result.ok('test'); }

    public override async getTranscript() { return 'test'; }
    public override getEngineType() { return 'whisper-turbo'; }
    setHeartbeat(ts: number) { this.lastHeartbeat = ts; }
}

describe('TranscriptionService Heartbeat & Handoff', () => {
    let service: TranscriptionService;
    let engine: MockHeartbeatEngine;

    const mockMic: MicStream = {
        stream: {} as MediaStream,
        stop: vi.fn(),
        prepare: vi.fn().mockResolvedValue(undefined),
        clone: vi.fn(),
        onFrame: vi.fn().mockReturnValue(() => { }),
    } as unknown as MicStream;

    beforeEach(async () => {
        vi.useFakeTimers();
        engine = new MockHeartbeatEngine();

        // T=0: Setup strict environment
        await setupStrictZero();

        // Override registry with heartbeat-specific engine at all keys
        sttRegistry.register('whisper-turbo', (opts: TranscriptionModeOptions) => { engine = new MockHeartbeatEngine(opts); return engine; });
        sttRegistry.register('assemblyai', (opts: TranscriptionModeOptions) => { engine = new MockHeartbeatEngine(opts); return engine; });
        sttRegistry.register('native-browser', (opts: TranscriptionModeOptions) => { engine = new MockHeartbeatEngine(opts); return engine; });
        sttRegistry.register('transformers-js', (opts: TranscriptionModeOptions) => { engine = new MockHeartbeatEngine(opts); return engine; });
        // Tests instantiate their own custom service
    });

    afterEach(async () => {
        if (service && service.getState() !== 'TERMINATED') {
            await service.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
        vi.clearAllTimers();
    });

    it('should emit isFrozen warning when engine heartbeat stalls beyond 8s threshold', async () => {
        vi.useFakeTimers();
        const onStatusChange = vi.fn();
        
        service = new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            onStatusChange,
            session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn().mockResolvedValue('token'),
            mockMic,
            policy: {
                allowNative: true,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: 'private',
                allowFallback: true,
                executionIntent: 'test'
            }
        }, undefined, 50, 8000);

        await service.init();
        await service.startTranscription();

        // 1. Establish Heartbeat at T=0
        // Date.now() is controlled by fake timers.
        // Initialization ensures internal heartbeat is fresh.

        // 2. Advance 9 seconds — Date.now() advances automatically
        await vi.advanceTimersByTimeAsync(9000);

        // 3. Assert frozen warning was emitted
        expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            isFrozen: true,
            type: 'warning'
        }));
        
        // Ensure mode didn't drift
        expect(service.getMode()).toBe('private');
        
        vi.useRealTimers();
    });

    it('should support segmented handoff to Native browser', async () => {
        service = new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn().mockResolvedValue('token'),
            mockMic,
            policy: {
                allowNative: true,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: 'private',
                allowFallback: true,
                executionIntent: 'test'
            }
        });

        await service.init();
        await service.startTranscription();

        // switchToNativeSegmented calls destroy() then startTranscription() with native policy
        // The native-browser mock is already in the registry from setupStrictZero
        await service.switchToNativeSegmented();
        expect(service.getMode()).toBe('native');
    });
});
