import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionStore } from '@/stores/useSessionStore';
import TranscriptionService from '../TranscriptionService';
import { TranscriptionPolicy } from '../TranscriptionPolicy';
import { MicStream } from '../utils/types';
import { testRegistry } from '../TestRegistry';
import { ITranscriptionEngine, TranscriptionModeOptions } from '../modes/types';
import { createMockEngine } from '../../../../tests/unit/factories/engineFactory';

// Mock dependencies
const mockOnTranscriptUpdate = vi.fn();
const mockOnModelLoadProgress = vi.fn();
const mockOnReady = vi.fn();
const mockOnStatusChange = vi.fn();
const mockOnModeChange = vi.fn();
const mockNavigate = vi.fn();
const mockGetToken = vi.fn().mockResolvedValue('mock-token');

vi.mock('../../../lib/storage', () => ({
    saveSession: vi.fn().mockResolvedValue({ session: { id: 'test-sess' }, usageExceeded: false }),
    heartbeatSession: vi.fn().mockResolvedValue({ success: true }),
    completeSession: vi.fn(),
}));

// Helper for failing engines to test containment
const createFailingEngine = (errorMsg: string) => createMockEngine({
    init: vi.fn().mockRejectedValue(new Error(errorMsg)),
    getEngineType: () => 'whisper-turbo' as const
});

describe('TranscriptionService', () => {
    let service: TranscriptionService;

    const basePolicy: TranscriptionPolicy = {
        allowNative: true,
        allowCloud: false,
        allowPrivate: true,
        preferredMode: 'private',
        allowFallback: true,
        executionIntent: 'test'
    };

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        testRegistry.clear();

        // Default success engines
        testRegistry.register('native', () => createMockEngine({ getEngineType: () => 'native' as const }));
        testRegistry.register('private', () => createMockEngine({ getEngineType: () => 'whisper-turbo' as const }));

        service = new TranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onModelLoadProgress: mockOnModelLoadProgress,
            onReady: mockOnReady,
            onStatusChange: mockOnStatusChange,
            onModeChange: mockOnModeChange,
            session: null,
            navigate: mockNavigate,
            getAssemblyAIToken: mockGetToken,
            policy: { ...basePolicy },
            mockMic: {
                stream: {} as MediaStream,
                stop: vi.fn(),
                clone: vi.fn(),
                onFrame: vi.fn().mockReturnValue(() => { }),
            } as unknown as MicStream
        });
    });

    afterEach(() => {
        testRegistry.clear();
        vi.useRealTimers();
    });

    it('should emit fallback status when implementation fails (Item 7A)', async () => {
        testRegistry.register('private', () => createFailingEngine('GPU_CRASH'));

        await service.init();
        await service.startTranscription();
        await vi.runAllTicks();

        // Verify fallback happened
        const fallbackCalls = mockOnStatusChange.mock.calls.filter(c => c[0]?.type === 'fallback');
        expect(fallbackCalls.length).toBe(1); // ✅ Exactly once
        expect(fallbackCalls[0][0].newMode).toBe('native');
        expect(useSessionStore.getState().activeEngine).toBe('native');
    });

    it('should sanitize transcripts effectively through mandatory pipeline (Item 7B)', async () => {
        // Setup a successful engine
        let nativeEngine: any = null;
        testRegistry.register('native', (opts?: TranscriptionModeOptions) => {
            nativeEngine = createMockEngine({ 
                getEngineType: () => 'native' as const,
                ...opts 
            });
            return nativeEngine;
        });

        await service.init();
        await service.startTranscription({ ...basePolicy, preferredMode: 'native' });
        
        // Simulate hallucination via the internal updates
        // We need to trigger the callback that was passed into the engine
        const onTranscriptUpdate = nativeEngine.onTranscriptUpdate; 
        if (onTranscriptUpdate) {
            onTranscriptUpdate({
                transcript: {
                    final: '[BLANK_AUDIO]  Hello (applause) [SILENCE]  world [MUSIC]  ',
                    partial: '[MUSIC] thinking...'
                }
            });
        }

        // Assert
        expect(mockOnTranscriptUpdate).toHaveBeenCalledWith(expect.objectContaining({
            transcript: {
                final: 'Hello world',
                partial: 'thinking...'
            }
        }));
    });

    it('should provide honest status message on cache miss fallback', async () => {
        testRegistry.register('private', () => createFailingEngine('CACHE_MISS'));

        await service.init();
        await service.startTranscription();

        // Ensure microtasks for the async handleCacheMiss call are flushed
        await vi.runAllTicks();
        await Promise.resolve();

        const calls = mockOnStatusChange.mock.calls.map(c => c[0]);
        expect(calls.some(c => c?.type === 'fallback' && c?.newMode === 'native')).toBe(true);
        expect(useSessionStore.getState().activeEngine).toBe('native');
        expect(calls.some(c => c?.type === 'downloading')).toBe(false);
    });

    it('should protect against recursive fallback loops (Item 8A)', async () => {
        // Setup a private engine that fails
        testRegistry.register('private', () => createFailingEngine('RECURSION_TEST'));
        
        // Track handleFailure calls (via status change 'fallback')
        await service.init();
        await service.startTranscription();
        await vi.runAllTicks();

        // Verify fallback happened exactly once despite multiple potential trigger points
        const fallbackCalls = mockOnStatusChange.mock.calls.filter(c => c[0]?.type === 'fallback');
        expect(fallbackCalls.length).toBe(1);
    });

    it('should reset initPromise on failure to allow retries (Item 8B)', async () => {
        let callCount = 0;
        testRegistry.register('private', () => {
            callCount++;
            if (callCount === 1) return createFailingEngine('FIRST_FAILURE');
            return createMockEngine({ getEngineType: () => 'whisper-turbo' as const });
        });

        // Disable fallback to verify the terminal failure path
        service.updatePolicy({ ...basePolicy, preferredMode: 'private', allowFallback: false });
        await service.init();
        
        // First attempt will fail and transition to FAILED
        await service.startTranscription();
        expect(service.getState()).toBe('FAILED');
        expect(callCount).toBe(1);
        
        // Second attempt should generate a NEW promise and succeed
        await service.startTranscription();
        expect(callCount).toBe(2);
        expect(service.getState()).not.toBe('FAILED');
    });


    it('should release the microphone IMMEDIATELY on destroy', async () => {
        const mockMicStop = vi.fn();
        const fastService = new TranscriptionService({
            onTranscriptUpdate: mockOnTranscriptUpdate,
            onStatusChange: mockOnStatusChange,
            policy: { ...basePolicy, preferredMode: 'native', allowNative: true, allowPrivate: false },
            mockMic: { stop: mockMicStop, onFrame: () => () => { } } as unknown as MicStream
        } as unknown as ConstructorParameters<typeof TranscriptionService>[0]);
        await fastService.init();
        await fastService.startTranscription();
        const destroyPromise = fastService.destroy();
        expect(mockMicStop).toHaveBeenCalled();
        await vi.runAllTicks();
        await destroyPromise;
    });
});
