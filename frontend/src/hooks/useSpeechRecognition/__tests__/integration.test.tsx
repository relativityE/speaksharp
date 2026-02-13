
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { renderHookWithProviders } from '@test-utils/renderHookWithProviders';
import { MockTranscriptionService } from '@test-mocks/MockTranscriptionService';
import useSpeechRecognition from '../index';
import { testRegistry } from '@/services/transcription/TestRegistry';
import type { Session as SupabaseSession } from '@supabase/supabase-js';




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
        // Setup the registry to return our MockTranscriptionService constructor
        // We use a specific constructor type to avoid the 'any' lint error while maintaining compatibility
        vi.mocked(testRegistry.get).mockReturnValue(MockTranscriptionService as unknown as new (...args: unknown[]) => unknown);
    });

    it('should prevent stale closure on stop by capturing latest transcript state', async () => {
        // Render with full provider context using the new factory pattern
        const { result } = renderHookWithProviders(
            () => useSpeechRecognition(),
            {
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
        );

        // Start listening
        await act(async () => {
            await result.current.startListening();
        });

        // Verify state is listening
        expect(result.current.isListening).toBe(true);
        expect(MockTranscriptionService.latestInstance).toBeTruthy();
        const service = MockTranscriptionService.latestInstance!;

        // Simulate transcript updates
        act(() => {
            service.simulateTranscript('Hello world', true);
        });

        expect(result.current.chunks[0].text).toBe('Hello world');

        // Simulate last-second update (race condition scenario)
        // We start the stop process...
        const stopPromise = act(async () => {
            const stats = await result.current.stopListening();
            return stats;
        });

        // ...and simulate a transcript arriving "during" the stop
        act(() => {
            service.simulateTranscript('final words', true);
        });

        // Await the stop completion
        await stopPromise;

        // CRITICAL: Verify final words are captured in the hook state
        // Note: The hook's 'chunks' might be updated via state updates which happen async
        await waitFor(() => {
            expect(result.current.chunks.some(c => c.text === 'final words')).toBe(true);
        });
    });

    it('should handle service errors gracefully', async () => {
        const { result } = renderHookWithProviders(() => useSpeechRecognition());

        await act(async () => {
            await result.current.startListening();
        });

        // Simulate service error
        act(() => {
            const service = MockTranscriptionService.latestInstance!;
            service.simulateError(new Error('Microphone access denied'));
        });

        // Verify error state is reflected
        await waitFor(() => {
            // The hook exposes 'error' likely from the service which we updated
            // Check if the hook captures the error state
            expect(result.current.sttStatus.type).toBe('error');
            expect(result.current.sttStatus.message).toBe('Microphone access denied');
        });

        // Should stop listening on critical error or user logic choice
        // (This depends on specific hook implementation, but usually errors don't auto-reset isListening unless programmed)
    });

    it('should capture usage limit exceeded state mid-session', async () => {
        const { result } = renderHookWithProviders(() => useSpeechRecognition());

        await act(async () => {
            await result.current.startListening();
        });

        // Simulate mid-session tier limit hit
        act(() => {
            const service = MockTranscriptionService.latestInstance!;
            service.simulateStatusChange({
                type: 'error',
                message: 'Daily usage limit reached'
            });
        });

        // Verify the hook reflects the limit error
        await waitFor(() => {
            expect(result.current.sttStatus.type).toBe('error');
            expect(result.current.sttStatus.message).toBe('Daily usage limit reached');
        });
    });

    it('should cleanup on unmount', async () => {
        const { result, unmount } = renderHookWithProviders(() => useSpeechRecognition());

        await act(async () => {
            await result.current.startListening();
        });

        const service = MockTranscriptionService.latestInstance!;
        const destroySpy = vi.spyOn(service, 'destroy');

        unmount();

        expect(destroySpy).toHaveBeenCalled();
    });
});
