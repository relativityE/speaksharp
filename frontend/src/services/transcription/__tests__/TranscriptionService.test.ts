import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import TranscriptionService from '../TranscriptionService';
import type { TranscriptionServiceOptions } from '../TranscriptionService';
import { TranscriptionPolicy, PROD_FREE_POLICY } from '../TranscriptionPolicy';
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

    afterEach(async () => {
        if (service) {
            await service.destroy();
        }
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

    it('should sanitize transcripts before emitting (Behavior-based)', async () => {
        // Arrange
        await service.startTranscription({ ...PROD_FREE_POLICY, preferredMode: 'cloud' });

        return new Promise<void>((resolve) => {
            const tempService = getTranscriptionService({
                onTranscriptUpdate: (update) => {
                    // Assert
                    expect(update.transcript.final).toBe(' clean text ');
                    resolve();
                }
            });

            // Act
            const rawTranscript = { transcript: { final: ' clean text ', isFinal: true, timestamp: 0 } };
            // Simulate the strategy emitting a transcript event via the facade's mapped callback
            if ((tempService as any).strategy && (tempService as any).strategy.onTranscriptUpdate) {
                (tempService as any).strategy.onTranscriptUpdate(rawTranscript);
            } else {
                // Fallback for tests if facade isn't fully established
                (tempService as any).processTranscript(rawTranscript);
            }
        });
    });

    it('should sanitize transcripts effectively', async () => {
        await service.init();
        await service.startTranscription();
        
        // ARCHITECTURE: Black-box testing via the registered mock instance
        const win = window as any;
        const mockEngine = win.__SS_E2E__?.latestMock;
        expect(mockEngine).toBeDefined();
        
        // Simulate a transcript event through the wired proxy
        if (mockEngine && mockEngine.onTranscriptUpdate) {
            mockEngine.onTranscriptUpdate({
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
