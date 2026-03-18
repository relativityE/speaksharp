import { renderHook } from '../../../../tests/support/test-utils';
import { useTranscriptionService, type UseTranscriptionServiceOptions } from '../useTranscriptionService';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { testRegistry } from '../../../services/transcription/TestRegistry';
import TranscriptionService from '../../../services/transcription/TranscriptionService';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { useSessionStore, type SessionStore } from '../../../stores/useSessionStore';
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
        getService: vi.fn().mockReturnValue({
            updateCallbacks: vi.fn(),
            updatePolicy: vi.fn(),
            getMode: vi.fn().mockReturnValue('native'),
            getState: vi.fn().mockReturnValue('IDLE'),
            fsm: {
                subscribe: vi.fn().mockReturnValue(() => { }),
                getState: vi.fn().mockReturnValue('IDLE'),
            },
            destroy: vi.fn().mockResolvedValue(undefined),
        }),
        getState: vi.fn().mockReturnValue('READY'),
        warmUp: vi.fn().mockResolvedValue(undefined),
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

const mockService = {
    startTranscription: vi.fn().mockResolvedValue(undefined),
    stopTranscription: vi.fn().mockResolvedValue({ transcript: 'test', stats: {} }),
    updateCallbacks: vi.fn(),
    updatePolicy: vi.fn(),
    getMode: vi.fn().mockReturnValue('native'),
    getState: vi.fn().mockReturnValue('IDLE'),
    fsm: {
        subscribe: vi.fn().mockReturnValue(() => { }),
    },
    destroy: vi.fn().mockResolvedValue(undefined)
} as unknown as TranscriptionService;

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
            service: mockService,
            isReady: true
        });
        vi.mocked(useSessionStore).mockReturnValue(mockStore as unknown as SessionStore);
        testRegistry.enable();
    });

    afterEach(() => {
        testRegistry.disable();
    });

    it('should initialize and call updateCallbacks on mount', () => {
        const options: UseTranscriptionServiceOptions = {
            onTranscriptUpdate: vi.fn(),
            session: null as unknown as Session,
            navigate: vi.fn(),
            getAssemblyAIToken: vi.fn().mockResolvedValue('token')
        };

        renderHook(() => useTranscriptionService(options));

        expect(mockService.updateCallbacks).toHaveBeenCalled();
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
