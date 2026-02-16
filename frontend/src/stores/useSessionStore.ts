import { create } from 'zustand';
import { FillerCounts } from '@/utils/fillerWordUtils';
import { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';

interface TranscriptState {
    transcript: string;
    partial: string;
}

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'fallback' | 'error';

export interface SttStatus {
    type: SttStatusType;
    message: string;
    detail?: string;
    progress?: number;
}

export interface SessionState {
    isListening: boolean;
    isReady: boolean;
    transcript: TranscriptState;
    fillerData: FillerCounts;
    elapsedTime: number;
    startTime: number | null;
    sttStatus: SttStatus;
    sttMode: TranscriptionMode | null;
    modelLoadingProgress: number | null;
    activeEngine: TranscriptionMode | 'none' | null;
}

interface SessionActions {
    startSession: () => void;
    stopSession: () => void;
    setReady: (ready: boolean) => void;
    updateTranscript: (transcript: string, partial?: string) => void;
    updateFillerData: (data: FillerCounts) => void;
    updateElapsedTime: (time: number) => void;
    setSTTStatus: (status: SttStatus) => void;
    setSTTMode: (mode: TranscriptionMode | null) => void;
    setActiveEngine: (engine: TranscriptionMode | 'none' | null) => void;
    setModelLoadingProgress: (progress: number | null) => void;
    tick: () => void;
    setElapsedTime: (seconds: number) => void;
    resetSession: () => void;
}

export type SessionStore = SessionState & SessionActions;

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
    sttStatus: { type: 'idle', message: 'Ready to record' },
    sttMode: null,
    modelLoadingProgress: null,
    activeEngine: null,
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

    setSTTStatus: (status) =>
        set({
            sttStatus: status,
        }),

    setSTTMode: (mode) =>
        set({
            sttMode: mode,
        }),

    setActiveEngine: (engine) =>
        set({
            activeEngine: engine,
        }),

    setModelLoadingProgress: (progress) =>
        set({
            modelLoadingProgress: progress,
        }),

    tick: () => set((state) => {
        if (!state.isListening || !state.startTime) return state;
        return { elapsedTime: Math.floor((Date.now() - state.startTime) / 1000) };
    }),

    setElapsedTime: (seconds) =>
        set({
            elapsedTime: seconds,
        }),

    resetSession: () =>
        set(initialState),
}));

// Expose store to window for E2E tests
if (typeof window !== 'undefined') {
    (window as any).useSessionStore = useSessionStore;
}
