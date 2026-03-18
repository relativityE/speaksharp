import { describe, it, expect, vi, beforeEach } from 'vitest';

// Senior Choice: Formal module mock to prevent real TranscriptionService from loading
// Moving to top to ensure it's applied before any component/hook imports
vi.mock('@/services/transcription/TranscriptionService', async () => {
    const { MockTranscriptionService } = await import('../../../../tests/mocks/MockTranscriptionService');
    
    // Provide a valid substitute for the class with static methods
    return {
        default: MockTranscriptionService,
        resetTranscriptionService: vi.fn(),
        getTranscriptionService: vi.fn(() => MockTranscriptionService.latestInstance),
        // Add static subscribe if hook uses it
        subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
    };
});

// Mock the TestRegistry to ensure we can register our mock
vi.mock('@/services/transcription/TestRegistry', async () => {
    const actual = await vi.importActual('@/services/transcription/TestRegistry');
    return {
        ...actual,
        testRegistry: {
            register: vi.fn(),
            get: vi.fn(),
        }
    };
});

import { act, waitFor } from '../../../../tests/support/test-utils';
import { renderHookWithProviders } from '@test-utils/renderHookWithProviders';
import useSpeechRecognition from '../index';
import { testRegistry } from '@/services/transcription/TestRegistry';
import { resetTranscriptionService, getTranscriptionService } from '@/services/transcription/TranscriptionService';
import { TranscriptionPolicy, E2E_DETERMINISTIC_PRIVATE } from '@/services/transcription/TranscriptionPolicy';
import TranscriptionService from '@/services/transcription/TranscriptionService';
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { TranscriptionModeOptions, ITranscriptionEngine } from '@/services/transcription/modes/types';
import { MockTranscriptionService } from '../../../../tests/mocks/MockTranscriptionService';
import { speechRuntimeController } from '@/services/SpeechRuntimeController';

// Hoist STTServiceFactory mock
const { STTServiceFactory } = vi.hoisted(() => ({
    STTServiceFactory: {
        createService: vi.fn()
    }
}));

vi.mock('@/services/transcription/STTServiceFactory', () => ({
    STTServiceFactory
}));

// We are NOT mocking SpeechRuntimeController anymore to allow REAL state flow to the REAL store


describe('useSpeechRecognition Integration', () => {
    let service: MockTranscriptionService;
    const basePolicy = E2E_DETERMINISTIC_PRIVATE;

    beforeEach(async () => {
        vi.clearAllMocks();
        await speechRuntimeController.reset();
        
        // Enforce singleton initialization for the mock
        const s = new MockTranscriptionService({
            onTranscriptUpdate: vi.fn(),
            onModelLoadProgress: vi.fn(),
            onReady: vi.fn(),
            onError: vi.fn(),
        });
        MockTranscriptionService.latestInstance = s;
        service = s;

        // Setup the registry to return our MockTranscriptionService constructor
        vi.mocked(STTServiceFactory.createService).mockReturnValue(service as any);
        vi.mocked(testRegistry.get).mockReturnValue((opts: TranscriptionModeOptions) => {
            const newS = new MockTranscriptionService(opts);
            MockTranscriptionService.latestInstance = newS;
            return newS;
        });

        // Use global stubbing for cleaner window mocking
        vi.stubGlobal('__E2E_MOCK_NATIVE__', true);
        vi.stubGlobal('__E2E_MOCK_LOCAL_WHISPER__', true);
        vi.stubGlobal('MockNativeBrowser', MockTranscriptionService);
        vi.stubGlobal('MockPrivateWhisper', MockTranscriptionService);
    });

    it('should prevent stale closure on stop by capturing latest transcript state', async () => {
        // Render with full provider context using the new factory pattern
        const { result } = renderHookWithProviders(
            () => useSpeechRecognition(),
            {
                authMock: {
                    session: {
                        user: {
                            id: 'test-user-id',
                            email: 'test@example.com',
                            app_metadata: {},
                            user_metadata: {},
                            aud: 'authenticated',
                            created_at: new Date().toISOString(),
                        },
                        access_token: 'fake-token',
                        refresh_token: 'fake-refresh',
                        expires_in: 3600,
                        token_type: 'bearer',
                    } as unknown as SupabaseSession,
                }
            }
        );

        // Start listening
        await act(async () => {
            const { E2E_DETERMINISTIC_PRIVATE } = await import('../types');
            await result.current.startListening(E2E_DETERMINISTIC_PRIVATE);
        });

        // Verify state is listening
        expect(result.current.isListening).toBe(true);

        // let service: MockTranscriptionService | null = null; // Removed, now defined in beforeEach
        await vi.waitFor(() => {
            // service = MockTranscriptionService.latestInstance; // Removed, now defined in beforeEach
            expect(service).toBeTruthy();
        });

        // Simulate transcript updates
        act(() => {
            service!.simulateTranscript('Hello world', true);
        });

        expect(result.current.chunks[0].transcript).toBe('Hello world');

        // Simulate last-second update (race condition scenario)
        // We start the stop process...
        const stopPromise = act(async () => {
            const stats = await result.current.stopListening();
            return stats;
        });

        // ...and simulate a transcript arriving "during" the stop
        act(() => {
            if (service) {
                service.simulateTranscript('final words', true);
            }
        });

        // Await the stop completion
        await stopPromise;

        // CRITICAL: Verify final words are captured in the hook state
        // Note: The hook's 'chunks' might be updated via state updates which happen async
        await waitFor(() => {
            expect(result.current.chunks.some(c => c.transcript === 'final words')).toBe(true);
        });
    });

    it('should handle service errors gracefully', async () => {
        const { result } = renderHookWithProviders(() => useSpeechRecognition());

        await act(async () => {
            const { E2E_DETERMINISTIC_PRIVATE } = await import('../types');
            await result.current.startListening(E2E_DETERMINISTIC_PRIVATE);
        });

        // Simulate service error
        act(() => {
            const currentService = MockTranscriptionService.latestInstance;
            if (currentService) {
                currentService.simulateError(new Error('Microphone access denied'));
            }
        });

        // Verify error state is reflected
        await vi.waitFor(() => {
            const status = result.current.sttStatus;
            expect(status.type).toBe('error');
            expect(status.message).toBe('Microphone access denied');
        }, { timeout: 3000 });

        // Should stop listening on critical error or user logic choice
        // (This depends on specific hook implementation, but usually errors don't auto-reset isListening unless programmed)
    });

    it('should capture usage limit exceeded state mid-session', async () => {
        const { result } = renderHookWithProviders(() => useSpeechRecognition());

        await act(async () => {
            const { E2E_DETERMINISTIC_PRIVATE } = await import('../types');
            await result.current.startListening(E2E_DETERMINISTIC_PRIVATE);
        });

        // Simulate mid-session tier limit hit
        act(() => {
            const currentService = MockTranscriptionService.latestInstance;
            if (currentService) {
                currentService.simulateStatusChange({
                    type: 'error',
                    message: 'Daily usage limit reached'
                });
            }
        });

        // Verify the hook reflects the limit error
        await vi.waitFor(() => {
            const status = result.current.sttStatus;
            expect(status.type).toBe('error');
            expect(status.message).toBe('Daily usage limit reached');
        }, { timeout: 3000 });
    });

    it('should cleanup on unmount', async () => {
        const { result, unmount } = renderHookWithProviders(() => useSpeechRecognition());

        await act(async () => {
            const { E2E_DETERMINISTIC_PRIVATE } = await import('../types');
            await result.current.startListening(E2E_DETERMINISTIC_PRIVATE);
        });

        // Wait for the instance to be created (async via useEffect/act)
        let service: MockTranscriptionService | null = null;
        await vi.waitFor(() => {
            service = MockTranscriptionService.latestInstance;
            console.log('[DEBUG TEST] latestInstance:', service ? 'FOUND' : 'NULL');
            expect(service).toBeTruthy();
        });

        const terminateSpy = vi.spyOn(service!, 'terminate');

        unmount();

        // The service should be terminated asynchronously
        await vi.waitFor(() => {
            expect(terminateSpy).toHaveBeenCalled();
        }, { timeout: 3000 });
    });
});
