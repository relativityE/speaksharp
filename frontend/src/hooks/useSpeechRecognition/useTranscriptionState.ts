import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranscriptionContext } from '@/providers/useTranscriptionContext';
import { TranscriptionState } from '../../services/transcription/TranscriptionFSM';
import { Chunk } from './types';
import { combineChunksToText, createChunk } from './utils';

const MAX_CHUNKS = 1000;

/**
 * Atomic Hook: Unified Transcription State.
 * Responsibility: Manages both the FSM state and the accumulated text chunks/interim transcript.
 * 
 * Industry Pattern: State Manager Hook
 */
export const useTranscriptionState = () => {
    const { service, isReady: isServiceReady } = useTranscriptionContext();
    const [state, setState] = useState<TranscriptionState>('IDLE');
    const [finalChunks, setFinalChunks] = useState<Chunk[]>([]);
    const [interimTranscript, setInterimTranscript] = useState<string>('');
    const [error, setError] = useState<Error | null>(null);

    // Derived transcript from chunks
    const transcriptText = useMemo(() => combineChunksToText(finalChunks), [finalChunks]);

    const addChunk = useCallback((transcript: string, speaker?: string) => {
        const trimmedText = transcript.trim();
        if (!trimmedText) return;

        setFinalChunks(prev => {
            if (prev.length > 0 && prev[prev.length - 1].transcript === trimmedText) return prev;
            const chunk = createChunk(trimmedText, speaker);
            if (prev.length >= MAX_CHUNKS) {
                const next = prev.slice(prev.length - MAX_CHUNKS + 1);
                next.push(chunk);
                return next;
            }
            return [...prev, chunk];
        });
    }, []);

    const reset = useCallback(() => {
        setFinalChunks([]);
        setInterimTranscript('');
        setError(null);
    }, []);

    // Subscribe to FSM changes if service is available
    useEffect(() => {
        if (!service || !isServiceReady) return;

        setState(service.getState());

        // Using the public fsm exposed in Part 1 refactor
        const unsubscribe = service.fsm.subscribe((newState) => {
            setState(newState);
        });

        return unsubscribe;
    }, [service, isServiceReady]);

    return {
        state,
        finalChunks,
        interimTranscript,
        transcriptText,
        error,
        setError,
        addChunk,
        setInterimTranscript,
        reset,
        isRecording: state === 'RECORDING',
        isInitializing: state === 'INITIALIZING_ENGINE' || state === 'ACTIVATING_MIC' || state === 'DOWNLOADING_MODEL'
    };
};
