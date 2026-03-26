import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { EngineFactory } from '../EngineFactory';
import { ITranscriptionEngine } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';

/**
 * @file TranscriptionService.maxAttempts.test.ts
 * @description Verifies the "Max Attempts" circuit breaker and fallback logic.
 */

class MockPrivateEngine implements ITranscriptionEngine {
    constructor() {}
    async init() { return { isOk: true as const, data: undefined }; }
    async start(): Promise<void> { return Promise.resolve(); }
    async stop(): Promise<void> { return Promise.resolve(); }
    async startTranscription(): Promise<void> { return Promise.resolve(); }
    async stopTranscription(): Promise<string> { return Promise.resolve('test'); }
    dispose(): void {}
    async getTranscript(): Promise<string> { return Promise.resolve('test'); }
    getEngineType(): string { return 'whisper-turbo'; }
    getLastHeartbeatTimestamp(): number { return Date.now(); }
}

class MockNativeEngine implements ITranscriptionEngine {
    constructor() {}
    async init() { return { isOk: true as const, data: undefined }; }
    async start(): Promise<void> { return Promise.resolve(); }
    async stop(): Promise<void> { return Promise.resolve(); }
    async startTranscription(): Promise<void> { return Promise.resolve(); }
    async stopTranscription(): Promise<string> { return Promise.resolve('test'); }
    dispose(): void {}
    async getTranscript(): Promise<string> { return Promise.resolve('test'); }
    getEngineType(): string { return 'native'; }
    getLastHeartbeatTimestamp(): number { return Date.now(); }
}

describe('TranscriptionService Max Attempts', () => {
    let service: TranscriptionService;

    beforeEach(() => {
        vi.useFakeTimers();
        service = new TranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            session: null,
            navigate: vi.fn() as unknown as NavigateFunction,
            getAssemblyAIToken: vi.fn().mockResolvedValue('token'),
            policy: {
                allowNative: true,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: 'private',
                executionIntent: 'test',
                allowFallback: true
            }
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should enforce Native fallback after max private attempts', async () => {
        const privateEngine = new MockPrivateEngine();
        const createSpy = vi.spyOn(EngineFactory, 'create');
        
        // Mock multiple failures followed by a fallback
        createSpy.mockResolvedValueOnce(privateEngine as unknown as ITranscriptionEngine);
        createSpy.mockResolvedValueOnce(new MockNativeEngine() as unknown as ITranscriptionEngine);

        await service.init();
        
        // Simulate failures via internal failure manager
        const failureManager = (service as unknown as { failureManager: { recordFailure: (m: string, e: Error) => void } }).failureManager;
        if (failureManager) {
            for (let i = 0; i < 3; i++) {
                failureManager.recordFailure('private', new Error('GPU_CRASH'));
            }
        }

        expect(service.getMode()).toBe('native');
    });
});
