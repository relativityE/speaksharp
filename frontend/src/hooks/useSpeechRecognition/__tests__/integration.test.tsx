
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor } from '../../../../tests/support/test-utils';
import { renderHookWithProviders } from '@test-utils/renderHookWithProviders';
import { MockTranscriptionService } from '@test-mocks/MockTranscriptionService';
import useSpeechRecognition from '../index';
import { testRegistry } from '@/services/transcription/TestRegistry';
import type { Session as SupabaseSession } from '@supabase/supabase-js';
import { TranscriptionModeOptions, ITranscriptionMode } from '@/services/transcription/modes/types';

// Mock the TestRegistry to ensure we can register our mock
vi.mock('@/services/transcription/TestRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/transcription/TestRegistry')>();
    return {
        ...actual,
        testRegistry: {
            register: vi.fn(),
            get: vi.fn(),
            enable: vi.fn(),
            disable: vi.fn(),
            clear: vi.fn(),
        }
    };
});

describe('useSpeechRecognition Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        MockTranscriptionService.latestInstance = null;
        // Setup the registry to return our MockTranscriptionService constructor
        vi.mocked(testRegistry.get).mockReturnValue((opts: TranscriptionModeOptions) => new MockTranscriptionService(opts) as unknown as ITranscriptionMode);

        const win = window as unknown as Record<string, unknown>;
        win.__E2E_MOCK_NATIVE__ = true;
        win.MockNativeBrowser = MockTranscriptionService;
        win.MockPrivateWhisper = MockTranscriptionService;
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
                currentService.simulateError(new Error('Microphone access denied'));
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

        const terminateSpy = vi.spyOn(service!, 'terminate');

        unmount();

        await vi.waitFor(() => {
            expect(terminateSpy).toHaveBeenCalled();
        });
    });
});
