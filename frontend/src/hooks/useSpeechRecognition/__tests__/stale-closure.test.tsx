import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition_prod } from '../useSpeechRecognition_prod'; // Testing the prod implementation directly
import { calculateTranscriptStats } from '../../../utils/fillerWordUtils';

// Helper to mock the hooks
import { useTranscriptState } from '../useTranscriptState';
import { useFillerWords } from '../useFillerWords';
import { useTranscriptionService } from '../useTranscriptionService';
import { useSessionTimer } from '../useSessionTimer';
import { useVocalAnalysis } from '../../useVocalAnalysis';

// Mock dependencies
vi.mock('../../../utils/fillerWordUtils', () => ({
    calculateTranscriptStats: vi.fn().mockReturnValue({
        total_words: 10,
        accuracy: 95,
        transcript: 'mock transcript',
    }),
}));

vi.mock('../../../contexts/AuthProvider', () => ({
    useAuthProvider: vi.fn(() => ({ session: { user: { id: 'test-user' } } })),
}));

vi.mock('../../../lib/logger', () => ({
    default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/toast', () => ({
    toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn(), info: vi.fn() },
}));

vi.mock('react-router-dom', () => ({
    useNavigate: vi.fn(),
}));

// Mock internal hooks using simple factories
vi.mock('../useTranscriptState');
vi.mock('../useFillerWords');
vi.mock('../useTranscriptionService');
vi.mock('../useSessionTimer');
vi.mock('../../useVocalAnalysis');

describe('useSpeechRecognition - Stale Closure Fix', () => {
    // Typed mocks
    const mockUseTranscriptState = vi.mocked(useTranscriptState);
    const mockUseFillerWords = vi.mocked(useFillerWords);
    const mockUseTranscriptionService = vi.mocked(useTranscriptionService);
    const mockUseSessionTimer = vi.mocked(useSessionTimer);
    const mockUseVocalAnalysis = vi.mocked(useVocalAnalysis);

    beforeEach(() => {
        vi.clearAllMocks();

        // Default mock implementations using defaults to avoid destructuring errors
        mockUseTranscriptState.mockReturnValue({
            finalChunks: [],
            interimTranscript: '',
            reset: vi.fn(),
            setInterimTranscript: vi.fn(),
            addChunk: vi.fn(),
            transcript: '',
        });

        mockUseFillerWords.mockReturnValue({
            fillerData: {},
            reset: vi.fn(),
            finalFillerData: { total: { count: 0, color: '' } },
        });

        mockUseTranscriptionService.mockReturnValue({
            isListening: true,
            stopListening: vi.fn().mockResolvedValue({ success: true }),
            startListening: vi.fn(),
            reset: vi.fn(),
            isReady: true,
            error: null,
            isSupported: true,
            mode: 'native',
            sttStatus: { type: 'idle' }
        } as unknown as ReturnType<typeof useTranscriptionService>);

        mockUseSessionTimer.mockReturnValue({
            duration: 0,
            reset: vi.fn(),
        });

        mockUseVocalAnalysis.mockReturnValue({
            setIsActive: vi.fn(),
            pauseMetrics: {},
        } as unknown as ReturnType<typeof useVocalAnalysis>);
    });

    it('should use the LATEST state in stopListening, not the render-time state', async () => {
        // 1. Initial Render
        // State A
        const stateA = {
            finalChunks: ['Start'],
            interimTranscript: '',
            reset: vi.fn(),
            setInterimTranscript: vi.fn(),
            addChunk: vi.fn(),
            transcript: 'Start',
        } as unknown as ReturnType<typeof useTranscriptState>;
        mockUseTranscriptState.mockReturnValue(stateA);

        mockUseSessionTimer.mockReturnValue({ duration: 10, reset: vi.fn() });

        const fillerStateA = {
            fillerData: {},
            reset: vi.fn(),
            finalFillerData: { total: { count: 0, color: '' } },
        } as unknown as ReturnType<typeof useFillerWords>;
        mockUseFillerWords.mockReturnValue(fillerStateA);

        const { result, rerender } = renderHook(() => useSpeechRecognition_prod());

        // 2. Update to State B (simulate time passing / transcript updating)
        // If the hook captures variables in closure, it might stick to State A
        const stateB = {
            finalChunks: ['Start', 'End'], // Changed!
            interimTranscript: '',
            reset: vi.fn(),
            setInterimTranscript: vi.fn(),
            addChunk: vi.fn(),
            transcript: 'Start End',
        } as unknown as ReturnType<typeof useTranscriptState>;
        mockUseTranscriptState.mockReturnValue(stateB);

        mockUseSessionTimer.mockReturnValue({ duration: 20, reset: vi.fn() }); // Changed!

        const fillerStateB = {
            fillerData: { 'um': { count: 1, color: '' } },
            reset: vi.fn(),
            finalFillerData: { total: { count: 1, color: '' } }, // Changed!
        } as unknown as ReturnType<typeof useFillerWords>;
        mockUseFillerWords.mockReturnValue(fillerStateB);

        rerender();

        // 3. Call stopListening
        // This function was created during render. 
        // If the fix works (refs), it should see ['Start', 'End'], duration 20, and count 1.
        await act(async () => {
            await result.current.stopListening();
        });

        // 4. Verify what verifyTranscriptStats was called with
        // calculateTranscriptStats args: (finalChunks, finalTranscripts, interimTranscript, duration)
        // Note: mockUseTranscriptState mocks finalChunks and duration from sessionTimer
        expect(calculateTranscriptStats).toHaveBeenCalledWith(
            ['Start', 'End'], // Expected NEW state
            expect.anything(),
            expect.anything(),
            20 // Expected NEW state (duration)
        );
    });
});
