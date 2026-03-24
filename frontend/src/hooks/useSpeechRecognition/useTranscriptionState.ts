import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { useSessionStore } from '@/stores/useSessionStore';
import { RuntimeState } from '../../services/SpeechRuntimeController';

/**
 * Atomic Hook: Unified Transcription State.
 * Responsibility: Manages both the FSM state and the accumulated text chunks/interim transcript.
 * 
 * Industry Pattern: State Manager Hook
 */
export const useTranscriptionState = () => {
    useTranscriptionContext();
    const runtimeState = useSessionStore(s => s.runtimeState);
    const transcript = useSessionStore(s => s.transcript);
    const sttStatus = useSessionStore(s => s.sttStatus);
    const chunks = useSessionStore(s => s.chunks);

    // Derived transcript from history for display if needed, 
    // but typically we use the flat transcript from the store.
    const transcriptText = transcript.transcript;
    const interimTranscript = transcript.partial;

    const isRecording = runtimeState === 'RECORDING';
    const isInitializing = runtimeState === 'INITIATING' || runtimeState === 'ENGINE_INITIALIZING';

    return {
        state: runtimeState as RuntimeState,
        finalChunks: chunks,
        interimTranscript,
        transcriptText,
        error: sttStatus.type === 'error' ? new Error(sttStatus.message) : null,
        isRecording,
        isInitializing,
        // Legacy no-ops for unit test compatibility
        addChunk: () => {},
        setInterimTranscript: () => {},
        reset: () => {},
        setError: () => {}
    };
};
