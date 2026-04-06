import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionModeOptions, ITranscriptionEngine } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';
import { MicStream } from '../utils/types';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';

/**
 * @file TranscriptionService.heartbeat.test.ts
 * @description Verifies the 8s heartbeat watchdog and segmented handoff logic.
 */

class MockHeartbeatEngine implements ITranscriptionEngine {
    private lastHeartbeat = Date.now();
    public onReady?: () => void;
    public instanceId = 'mock-id';

    constructor(public type = 'private') {}

    async init(callbacks: TranscriptionModeOptions) {
        this.onReady = callbacks.onReady;
        return { isOk: true as const, data: undefined };
    }
    async checkAvailability() { return { isAvailable: true }; }
    async prepare() { return Promise.resolve(); }
    async start(): Promise<void> { return Promise.resolve(); }
    async stop(): Promise<void> { return Promise.resolve(); }
    async terminate(): Promise<void> { return Promise.resolve(); }
    async startTranscription(): Promise<void> { return Promise.resolve(); }
    async stopTranscription(): Promise<string> { return Promise.resolve('test'); }
    dispose(): void {}
    async getTranscript(): Promise<string> { return Promise.resolve('test'); }
    getEngineType(): string { return this.type; }
    getLastHeartbeatTimestamp(): number { return this.lastHeartbeat; }
    setHeartbeat(ts: number) { this.lastHeartbeat = ts; }
}

describe('TranscriptionService Heartbeat & Handoff', () => {
    let service: TranscriptionService;
    let engine: MockHeartbeatEngine;

    const mockMic: MicStream = {
        stream: {} as MediaStream,
        stop: vi.fn(),
        clone: vi.fn(),
        onFrame: vi.fn().mockReturnValue(() => { }),
    } as unknown as MicStream;

    beforeEach(async () => {
        vi.useFakeTimers();
        engine = new MockHeartbeatEngine();
        
        // T=0: Setup strict environment
        await setupStrictZero();
        
        // Override registry with heartbeat-specific engine at all keys
        const win = window as unknown as { __SS_E2E__: { registry: Record<string, unknown> } };
        win.__SS_E2E__.registry = {
            ...win.__SS_E2E__.registry,
            'whisper-turbo': () => engine,
            'assemblyai': () => engine,
            'native-browser': () => engine,
            'transformers-js': () => engine
        };
        // Tests instantiate their own custom service
    });

    afterEach(async () => {
        if (service) {
            await service.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should emit isFrozen warning if heartbeat stalls for >8s without autonomous fallback', async () => {
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
        });

        await service.init();
        await service.startTranscription();

        // 1. Stall heartbeat
        engine.setHeartbeat(Date.now() - 9000);

        // 2. Advance watchdog (5s period)
        await vi.advanceTimersByTimeAsync(5000);

        // 3. Verify handoff state (must NOT fallback automatically, just emit warning)
        expect(onStatusChange).toHaveBeenCalledWith(expect.objectContaining({
            isFrozen: true,
            type: 'warning'
        }));
        
        // Ensure mode didn't drift
        expect(service.getMode()).toBe('private');
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
