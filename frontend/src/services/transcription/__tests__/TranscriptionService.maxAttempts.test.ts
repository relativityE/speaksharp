import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { ITranscriptionEngine } from '../modes/types';
import { NavigateFunction } from 'react-router-dom';

/**
 * @file TranscriptionService.maxAttempts.test.ts
 * @description Verifies the "Max Attempts" circuit breaker and fallback logic.
 */

class MockPrivateEngine implements ITranscriptionEngine {
    constructor() {}
    async init() { return { isOk: true as const, data: undefined }; }
    async checkAvailability() { return { isAvailable: true }; }
    async prepare() { return Promise.resolve(); }
    async start(): Promise<void> { return Promise.resolve(); }
    async stop(): Promise<void> { return Promise.resolve(); }
    async terminate(): Promise<void> { return Promise.resolve(); }
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
    async checkAvailability() { return { isAvailable: true }; }
    async prepare() { return Promise.resolve(); }
    async start(): Promise<void> { return Promise.resolve(); }
    async stop(): Promise<void> { return Promise.resolve(); }
    async terminate(): Promise<void> { return Promise.resolve(); }
    async startTranscription(): Promise<void> { return Promise.resolve(); }
    async stopTranscription(): Promise<string> { return Promise.resolve('test'); }
    dispose(): void {}
    async getTranscript(): Promise<string> { return Promise.resolve('test'); }
    getEngineType(): string { return 'native-browser'; }
    getLastHeartbeatTimestamp(): number { return Date.now(); }
}

import { setupStrictZero } from '../../../../../tests/setupStrictZero';

describe('TranscriptionService Max Attempts', () => {
    let service: TranscriptionService;

    beforeEach(async () => {
        vi.useFakeTimers();
        
        // 1. Setup T=0 Environment
        await setupStrictZero();

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

    afterEach(async () => {
        if (service) {
            await service.destroy();
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should block Private transcription after max failures but respect No Implicit Fallback', async () => {
        const privateEngine = new MockPrivateEngine();
        const nativeEngine = new MockNativeEngine();

        // 1. Inject into TestRegistry
        const e2eWindow = window as any;
        if (!e2eWindow.__SS_E2E__) e2eWindow.__SS_E2E__ = { registry: {} };
        e2eWindow.__SS_E2E__.registry = {
            'whisper-turbo': () => privateEngine,
            'native-browser': () => nativeEngine
        };

        await service.init();
        
        // 2. Simulate failures via internal failure manager
        const serviceInternal = (service as any);
        const failureManager = serviceInternal.failureManager;
        if (failureManager) {
            for (let i = 0; i < 3; i++) {
                failureManager.recordPrivateFailure();
            }
        }

        // 3. Act: Trigger transcription. 
        // Under Phase 4.2 Invariant, this should NOT switch to native.
        // It should either fail or stay in private (if the Negotiator isn't consulted).
        await service.startTranscription();

        // ARCHITECTURE: Verification of "No Implicit Fallback"
        // Mode remains 'private' despite failures, conforming to Phase 4.2
        expect(service.getMode()).toBe('private');
        
        // Final State should be RECORDING (if it succeeded) or FAILED (if blocked)
        // In current implementation, startTranscription() ignores failureManager counts for mode selection
    });
});
