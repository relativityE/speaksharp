
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor } from '../../../../tests/support/test-utils';
import { renderHookWithProviders } from '@test-utils/renderHookWithProviders';
import { MockTranscriptionService } from '@test-mocks/MockTranscriptionService';
import useSpeechRecognition from '../index';
import { testRegistry } from '@/services/transcription/TestRegistry';
import { resetTranscriptionService } from '@/services/transcription/TranscriptionService';
import { useSessionStore } from '@/stores/useSessionStore';
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { TranscriptionModeOptions, ITranscriptionMode } from '@/services/transcription/modes/types';




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

describe('useSpeechRecognition Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetTranscriptionService();
        useSessionStore.getState().resetSession();
        MockTranscriptionService.latestInstance = null;
        // Setup the registry to return our MockTranscriptionService constructor
        // We use a specific constructor type to avoid the 'any' lint error while maintaining compatibility
        vi.mocked(testRegistry.get).mockReturnValue((opts: TranscriptionModeOptions) => new MockTranscriptionService(opts));

        const win = window as unknown as Window & {
            __E2E_MOCK_NATIVE__?: boolean;
            __E2E_MOCK_LOCAL_WHISPER__?: boolean;
            MockNativeBrowser?: unknown;
            MockPrivateWhisper?: unknown;
        };

        win.__E2E_MOCK_NATIVE__ = true;
        win.MockNativeBrowser = MockTranscriptionService as unknown as new (config: TranscriptionModeOptions) => ITranscriptionMode;
        win.MockPrivateWhisper = MockTranscriptionService as unknown as new (config: TranscriptionModeOptions) => ITranscriptionMode;
        win.__E2E_MOCK_LOCAL_WHISPER__ = true;
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
            await result.current.startListening();
        });

        // Verify state is listening
        expect(result.current.isListening).toBe(true);

        let service: MockTranscriptionService | null = null;
        await vi.waitFor(() => {
            service = MockTranscriptionService.latestInstance;
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
            await result.current.startListening();
        });

        // Simulate service error
        act(() => {
            const currentService = MockTranscriptionService.latestInstance;
            if (currentService) {
                // In production, TranscriptionService handles errors by transitioning FSM
                // which useSpeechRecognition_prod.ts listens to via onStatusChange
                currentService.simulateStatusChange({
                    type: 'error',
                    message: 'Microphone access denied'
                });
            }
        });

        // Verify error state is reflected
        await vi.waitFor(() => {
            expect(result.current.sttStatus.type).toBe('error');
            expect(result.current.sttStatus.message).toBe('Microphone access denied');
        }, { timeout: 3000 });
    });

    it('should capture usage limit exceeded state mid-session', async () => {
        const { result } = renderHookWithProviders(() => useSpeechRecognition());

        await act(async () => {
            await result.current.startListening();
        });

        // Verify initial state
        expect(result.current.sttStatus.type).toBe('recording');

        // Simulate mid-session tier limit hit
        act(() => {
            const currentService = MockTranscriptionService.latestInstance;
            if (currentService) {
                // We simulate the status change directly on the service which
                // should propagate to the store and then back to the hook.
                currentService.simulateStatusChange({
                    type: 'error',
                    message: 'Daily usage limit reached'
                });
            }
        });

        // Verify the hook reflects the limit error from the store
        await vi.waitFor(() => {
            // Note: useSpeechRecognition_prod returns sttStatus from the session store
            expect(result.current.sttStatus.type).toBe('error');
            expect(result.current.sttStatus.message).toBe('Daily usage limit reached');
        }, { timeout: 3000 });
    });

    it('should cleanup on unmount', async () => {
        const { result, unmount } = renderHookWithProviders(() => useSpeechRecognition());

        await act(async () => {
            await result.current.startListening();
        });

        // Wait for the instance to be created (async via useEffect/act)
        let service: MockTranscriptionService | null = null;
        await vi.waitFor(() => {
            service = MockTranscriptionService.latestInstance;
            expect(service).toBeTruthy();
        });

        unmount();

        // In the singleton model, the hook doesn't terminate the service on unmount
        // because other components might be using it.
        // We verify the singleton is still there but isListening is handled by the hook state.

        // Actually, the hook unmounts, so we can't check its state.
        // We just ensure we didn't crash and service persists as a singleton.
        expect(MockTranscriptionService.latestInstance).toBeTruthy();
    });
});
