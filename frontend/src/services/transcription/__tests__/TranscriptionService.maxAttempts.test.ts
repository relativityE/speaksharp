import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import { NavigateFunction } from 'react-router-dom';
import type { sttRegistry as SttRegistry } from '../STTRegistry';
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
    let TranscriptionServiceClass: typeof import('../TranscriptionService').default;
    let registry: typeof SttRegistry;

    beforeEach(async () => {
        vi.useFakeTimers();
        
        // 1. Setup T=0 Environment
        await setupStrictZero();
        TranscriptionServiceClass = (await import('../TranscriptionService')).default;
        registry = (await import('../STTRegistry')).sttRegistry;

        service = new TranscriptionServiceClass({
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

    it('should preserve Private retry state after setup failures without implicit Cloud fallback', async () => {
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
        registry.register('whisper-turbo', () => mockEngine);
        registry.register('transformers-js', () => mockEngine);

        await service.init();
        expect(service.getState()).toBe('INIT_FAILED');

        await expect(service.startTranscription()).rejects.toThrow('TRANSCRIPTION_START_BLOCKED_STATE:INIT_FAILED');

        // 4. Verification of "No Implicit Fallback"
        // Mode remains 'private' despite failures, conforming to Phase 4.3 invariant
        expect(service.getMode()).toBe('private');
        
        // Final state should remain explicit Private setup failure, not an implicit Cloud fallback.
        expect(service.getState()).toBe('INIT_FAILED');
    });
});
