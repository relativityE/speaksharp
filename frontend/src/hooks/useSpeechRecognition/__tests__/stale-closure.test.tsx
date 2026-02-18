import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition_prod } from '../useSpeechRecognition_prod'; // Testing the prod implementation directly
import { calculateTranscriptStats } from '../../../utils/fillerWordUtils';

// Helper to mock the hooks
import { useTranscriptionState } from '../useTranscriptionState';
import { useFillerWords } from '../useFillerWords';
import { useTranscriptionControl } from '../useTranscriptionControl';
import { useTranscriptionService } from '../useTranscriptionService';
import { useSessionTimer } from '../useSessionTimer';
import { useVocalAnalysis } from '../../useVocalAnalysis';

import { useTranscriptionCallbacks } from '../useTranscriptionCallbacks';
// Mock dependencies
vi.mock('../../../utils/fillerWordUtils', () => ({
    calculateTranscriptStats: vi.fn(), // We spy on this
}));

vi.mock('../../../contexts/AuthProvider', () => ({
    useAuthProvider: vi.fn(() => ({ session: { user: { id: 'test-user' } } })),
}));

vi.mock('../../useProfile', () => ({
    useProfile: vi.fn(() => ({ subscription_status: 'free' })),
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
vi.mock('../useTranscriptionState');
vi.mock('../useFillerWords');
vi.mock('../useTranscriptionControl');
vi.mock('../useTranscriptionCallbacks');
vi.mock('../useTranscriptionService');
vi.mock('../useSessionTimer');
vi.mock('../../useVocalAnalysis');

vi.mock('../../useProfile', () => ({
    useProfile: vi.fn(() => ({ subscription_status: 'pro' }))
}));

describe('useSpeechRecognition - Stale Closure Fix', () => {
    // Typed mocks
    const mockUseTranscriptionState = vi.mocked(useTranscriptionState);
    const mockUseFillerWords = vi.mocked(useFillerWords);
    const mockUseTranscriptionControl = vi.mocked(useTranscriptionControl);
    const mockUseTranscriptionCallbacks = vi.mocked(useTranscriptionCallbacks);
    const mockUseTranscriptionService = vi.mocked(useTranscriptionService);
    const mockUseSessionTimer = vi.mocked(useSessionTimer);
    const mockUseVocalAnalysis = vi.mocked(useVocalAnalysis);

    beforeEach(() => {
        vi.clearAllMocks();

        mockUseTranscriptionControl.mockReturnValue({
            startListening: vi.fn(),
            stopListening: vi.fn().mockResolvedValue({ success: true }),
            isServiceReady: true
        });

        mockUseTranscriptionCallbacks.mockImplementation(() => { });

        // Default implementation
        mockUseTranscriptionState.mockReturnValue({
            finalChunks: [],
            interimTranscript: '',
            transcript: '',
            addChunk: vi.fn(),
            setInterimTranscript: vi.fn(),
            reset: vi.fn(),
            state: 'IDLE',
            error: null,
            isRecording: false,
            isInitializing: false,
            setError: vi.fn()
        } as unknown as ReturnType<typeof useTranscriptionState>);

        mockUseFillerWords.mockReturnValue({
            counts: {},
            totalCount: 0
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
            processAudioFrame: vi.fn(),
            reset: vi.fn()
        } as unknown as ReturnType<typeof useVocalAnalysis>);
    });

    it('should use the LATEST state in stopListening, not the render-time state', async () => {
        // 1. Initial Render (State A)
        mockUseTranscriptionState.mockReturnValue({
            finalChunks: [{ text: 'Start', timestamp: 0, confidence: 1 }],
            interimTranscript: '',
            transcript: 'Start',
            reset: vi.fn(),
            setInterimTranscript: vi.fn(),
            addChunk: vi.fn(),
            state: 'RECORDING',
            error: null,
            isRecording: true,
            isInitializing: false,
            setError: vi.fn()
        } as unknown as ReturnType<typeof useTranscriptionState>);

        mockUseSessionTimer.mockReturnValue({ duration: 10, reset: vi.fn() });

        mockUseFillerWords.mockReturnValue({
            counts: {},
            totalCount: 0
        });

        const { result, rerender } = renderHook(() => useSpeechRecognition_prod());

        // 2. Update to State B (simulate time passing / transcript updating)
        mockUseTranscriptionState.mockReturnValue({
            finalChunks: [
                { text: 'Start', timestamp: 0, confidence: 1 },
                { text: 'End', timestamp: 10, confidence: 1 }
            ],
            interimTranscript: '',
            transcript: 'Start End',
            reset: vi.fn(),
            setInterimTranscript: vi.fn(),
            addChunk: vi.fn(),
            state: 'RECORDING',
            error: null,
            isRecording: true,
            isInitializing: false,
            setError: vi.fn()
        } as unknown as ReturnType<typeof useTranscriptionState>);

        mockUseSessionTimer.mockReturnValue({ duration: 20, reset: vi.fn() });

        mockUseFillerWords.mockReturnValue({
            counts: { 'um': { count: 1, color: '' } },
            totalCount: 1
        });

        rerender();

        // 3. Call stopListening
        await act(async () => {
            // Mock control.stopListening response handled by orchestrator logic
            await result.current.stopListening();
        });

        // 4. Verify what verifyTranscriptStats was called with
        // Since we mocked useTranscriptionState to return ['Start', 'End'], 
        // calculateTranscriptStats should be called with THAT array, not the initial one.
        expect(calculateTranscriptStats).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ text: 'Start' }),
                expect.objectContaining({ text: 'End' })
            ]),
            expect.anything(),
            expect.anything(),
            20 // Expected NEW duration
        );
    });
});
