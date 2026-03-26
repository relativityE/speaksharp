import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type TranscriptionService from '../TranscriptionService';
import type { TranscriptionServiceOptions } from '../TranscriptionService';
import type { TranscriptionPolicy } from '../TranscriptionPolicy';
import type { MicStream } from '../utils/types';
import type { PracticeSession } from '../../../types/session';
import { setupStrictZero } from '../../../../../tests/setupStrictZero';

/**
 * ARCHITECTURE:
 * STRICT ZERO ENFORCEMENT.
 * Tests follow the T=0 ordering: Reset -> Globals -> Import.
 */

describe('TranscriptionService', () => {
    let service: TranscriptionService;
    let getTranscriptionService: (options: Partial<TranscriptionServiceOptions>) => TranscriptionService;
    let resetTranscriptionService: () => void;
    let ENV: { isTest: boolean; disableWasm: boolean };
    
    // Captured Mock References
    const mockOnTranscriptUpdate = vi.fn();
    const mockOnModelLoadProgress = vi.fn();
    const mockOnReady = vi.fn();
    const mockGetToken = vi.fn().mockResolvedValue('mock-token');

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();

        // Step 1 & 2: Reset + Set Globals at T=0
        await setupStrictZero();

        // Step 3: Dynamic Import AFTER setup
        const tsModule = await import('../TranscriptionService');
        getTranscriptionService = tsModule.getTranscriptionService;
        resetTranscriptionService = tsModule.resetTranscriptionService;

        const flagsModule = await import('../../../config/TestFlags');
        ENV = flagsModule.ENV;

        const storageModule = await import('../../../lib/storage');
        vi.spyOn(storageModule, 'saveSession').mockResolvedValue({ 
            session: { id: 'test-sess', user_id: 'u1', created_at: '', duration: 0 } as unknown as PracticeSession, 
            usageExceeded: false 
        });

        service = getTranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            session: null,
            navigate: vi.fn(),
            getAssemblyAIToken: mockGetToken,
            policy: {
                allowNative: true,
                allowCloud: false,
                allowPrivate: true,
                preferredMode: 'private',
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

    afterEach(() => {
        if (typeof window !== 'undefined') {
            const win = window as unknown as Record<string, unknown>;
            delete win.__SS_E2E__;
        }
        vi.useRealTimers();
        vi.restoreAllMocks();
        resetTranscriptionService();
    });

    it('should initialize successfully with ST=0 registry-injected mock', async () => {
        // T=0 Compliance Check
        expect(ENV.isTest).toBe(true);
        expect(ENV.disableWasm).toBe(true);

        await service.init();
        expect(service.getState()).toBe('READY');
        expect(service.getMode()).toBe('private');
    });

    it('should sanitize transcripts effectively', async () => {
        await service.init();
        await service.startTranscription();
        
        const serviceInternal = service as unknown as { engine: { onTranscriptUpdate: (data: unknown) => void, getEngineType: () => string } };
        const engine = serviceInternal.engine;
        expect(engine.getEngineType()).toBe('mock');

        if (engine.onTranscriptUpdate) {
            engine.onTranscriptUpdate({
                transcript: {
                    final: '[BLANK_AUDIO]  Hello world [MUSIC]  ',
                    partial: 'thinking...'
                }
            });
        }

        expect(mockOnTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
            transcript: {
                final: 'Hello world',
                partial: 'thinking...'
            }
        }));
    });
});
