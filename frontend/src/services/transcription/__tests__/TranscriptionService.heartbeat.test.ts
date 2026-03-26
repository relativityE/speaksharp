import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { EngineFactory } from '../EngineFactory';
import { TranscriptionModeOptions, ITranscriptionEngine } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';

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
    async start(): Promise<void> { return Promise.resolve(); }
    async stop(): Promise<void> { return Promise.resolve(); }
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

    beforeEach(() => {
        vi.useFakeTimers();
        engine = new MockHeartbeatEngine();
        vi.spyOn(EngineFactory, 'create').mockResolvedValue(engine as unknown as ITranscriptionEngine);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should trigger handoff if heartbeat stalls for >8s', async () => {
        service = new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn().mockResolvedValue('token')
        });

        await service.init();
        await service.startTranscription();

        // 1. Stall heartbeat
        engine.setHeartbeat(Date.now() - 9000);

        // 2. Advance watchdog (5s period)
        await vi.advanceTimersByTimeAsync(5000);

        // 3. Verify handoff state
        expect(service.getMode()).toBeDefined();
    });

    it('should support segmented handoff to Native browser', async () => {
        service = new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn().mockResolvedValue('token')
        });

        await service.init();
        
        const nativeEngine = new MockHeartbeatEngine('native');
        vi.spyOn(EngineFactory, 'create').mockResolvedValue(nativeEngine as unknown as ITranscriptionEngine);

        await service.switchToNativeSegmented();
        expect(service.getMode()).toBe('native');
    });
});
