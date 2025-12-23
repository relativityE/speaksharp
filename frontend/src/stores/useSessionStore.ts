import { create } from 'zustand';
import { FillerCounts } from '@/utils/fillerWordUtils';

interface TranscriptState {
    transcript: string;
    partial: string;
}

interface SessionState {
    isListening: boolean;
    isReady: boolean;
    transcript: TranscriptState;
    fillerData: FillerCounts;
    elapsedTime: number;
    startTime: number | null;
}

interface SessionActions {
    startSession: () => void;
    stopSession: () => void;
    setReady: (ready: boolean) => void;
    updateTranscript: (transcript: string, partial?: string) => void;
    updateFillerData: (data: FillerCounts) => void;
    updateElapsedTime: (time: number) => void;
    resetSession: () => void;
}

type SessionStore = SessionState & SessionActions;

const initialState: SessionState = {
    isListening: false,
    isReady: false,
    transcript: {
        transcript: '',
        partial: '',
    },
    fillerData: {},
    elapsedTime: 0,
    startTime: null,
};

export const useSessionStore = create<SessionStore>((set) => ({
    ...initialState,

    startSession: () =>
        set({
            isListening: true,
            startTime: Date.now(),
        }),

    stopSession: () =>
        set({
            isListening: false,
            startTime: null,
            // P1 FIX: Don't reset elapsedTime here - let UI show final duration
            // elapsedTime is reset in resetSession() when starting a new session
        }),

    setReady: (ready) =>
        set({
            isReady: ready,
        }),

    updateTranscript: (transcript, partial = '') =>
        set({
            transcript: {
                transcript,
                partial,
            },
        }),

    updateFillerData: (data) =>
        set({
            fillerData: data,
        }),

    updateElapsedTime: (time) =>
        set({
            elapsedTime: time,
        }),

    resetSession: () =>
        set(initialState),
}));
