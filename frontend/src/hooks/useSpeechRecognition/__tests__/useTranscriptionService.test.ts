import { renderHook } from '../../../../tests/support/test-utils';
import { useTranscriptionService, type UseTranscriptionServiceOptions } from '../useTranscriptionService';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { useSessionStore, type SessionStore } from '@/stores/useSessionStore';
import { type Session } from '@supabase/supabase-js';
import { speechRuntimeController } from '../../../services/SpeechRuntimeController';

// Mock dependencies
vi.mock('@/providers/useTranscriptionContext', () => ({
    useTranscriptionContext: vi.fn(),
}));

vi.mock('../../../stores/useSessionStore', () => ({
    useSessionStore: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
    toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));



vi.mock('../../../services/SpeechRuntimeController', () => ({
    speechRuntimeController: {
        startRecording: vi.fn().mockResolvedValue(undefined),
        stopRecording: vi.fn().mockResolvedValue({ success: true, transcript: 'test', stats: {} }),
        getState: vi.fn().mockReturnValue('READY'),
        warmUp: vi.fn().mockResolvedValue(undefined),
        setSubscriberCallbacks: vi.fn(),
        confirmSubscriberHandshake: vi.fn(),
        updatePolicy: vi.fn(),
        reset: vi.fn().mockResolvedValue(undefined),
    }
}));

// Mock TranscriptionService for the second test suite
vi.mock('../../../services/transcription/TranscriptionService', () => {
    return {
        default: vi.fn().mockImplementation(() => ({
            updateCallbacks: vi.fn(),
            updatePolicy: vi.fn(),
            startTranscription: vi.fn(),
            destroy: vi.fn().mockResolvedValue(undefined),
        })),
        getTranscriptionService: vi.fn().mockImplementation(() => ({
            updateCallbacks: vi.fn(),
            updatePolicy: vi.fn(),
            startTranscription: vi.fn(),
            destroy: vi.fn().mockResolvedValue(undefined),
        })),
        useSessionStore: {
            getState: vi.fn()
        }
    };
});


const mockStore = {
    isListening: false,
    isReady: false,
    sttStatus: { type: 'idle', message: '' },
    sttMode: 'native',
    modelLoadingProgress: 0,
    setReady: vi.fn(),
    setSTTStatus: vi.fn(),
    setSTTMode: vi.fn(),
    startSession: vi.fn(),
    stopSession: vi.fn(),
    getState: vi.fn()
};
mockStore.getState.mockReturnValue(mockStore);

describe('useTranscriptionService - Integrated Behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useTranscriptionContext).mockReturnValue({
            isReady: true,
            runtimeState: 'IDLE',
            useStore: useSessionStore as unknown as typeof useSessionStore
        });
        vi.mocked(useSessionStore).mockReturnValue(mockStore as unknown as SessionStore);
    });

    afterEach(() => {
    });

    it('should initialize and call updateCallbacks on mount', () => {
        const options: UseTranscriptionServiceOptions = {
            onTranscriptUpdate: vi.fn(),
            session: null as unknown as Session,
            navigate: vi.fn(),
            getAssemblyAIToken: vi.fn().mockResolvedValue('token')
        };

        renderHook(() => useTranscriptionService(options));

        expect(speechRuntimeController.setSubscriberCallbacks).toHaveBeenCalled();
    });

    it('should call startTranscription when isListening becomes true', async () => {
        mockStore.isListening = true;
        const options: UseTranscriptionServiceOptions = {
            onTranscriptUpdate: vi.fn(),
            session: null as unknown as Session,
            navigate: vi.fn(),
            getAssemblyAIToken: vi.fn().mockResolvedValue('token')
        };

        renderHook(() => useTranscriptionService(options));

        await vi.waitFor(() => {
            expect(speechRuntimeController.startRecording).toHaveBeenCalled();
        });
    });
});
