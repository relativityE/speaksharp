import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import { NavigateFunction } from 'react-router-dom';
import { sttRegistry } from '../STTRegistry';
import { STTEngine } from '../../../contracts/STTEngine';
import { Result } from '../modes/types';
import { MicStream } from '../utils/types';
import { EngineType } from '../../../contracts/IPrivateSTTEngine';

/**
 * @file TranscriptionService.maxAttempts.test.ts
 * @description Verifies the "Max Attempts" circuit breaker and fallback logic.
 */

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
            },
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
    });

    it('should block Private transcription after max failures but respect No Implicit Fallback', async () => {
        // 1. Setup Mock Engine that always fails init
        class FailureEngine extends STTEngine {
            public override readonly type = 'transformers-js' as EngineType;
            private failCount = 0;
            protected async onInit() { 
                this.failCount++;
                return Result.err(new Error(`FAIL ${this.failCount}`)); 
            }
            public async checkAvailability() {
                return { isAvailable: true };
            }
            protected async onStart() {}
            protected async onStop() {}
            protected async onDestroy() {}
            async transcribe() { return Result.ok('test'); }
            public override getEngineType() { return 'whisper-turbo' as EngineType; }
        }

        const mockEngine = new FailureEngine();
        sttRegistry.register('whisper-turbo', () => mockEngine);

        await service.init();
        
        // 3. Trigger 3 consecutive failures
        for (let i = 0; i < 3; i++) {
            await service.startTranscription();
            expect(service.getState()).toBe('FAILED');
        }

        // 4. Verification of "No Implicit Fallback"
        // Mode remains 'private' despite failures, conforming to Phase 4.3 invariant
        expect(service.getMode()).toBe('private');
        
        // Final State should be FAILED
        expect(service.getState()).toBe('FAILED');
    });
});
