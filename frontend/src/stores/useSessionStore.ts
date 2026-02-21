import { create } from 'zustand';
import { FillerCounts } from '@/utils/fillerWordUtils';
import logger from '@/lib/logger';
import { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import { SttStatus } from '@/types/transcription';

export interface TranscriptChunk {
    text: string;
    speaker?: string;
    timestamp: number;
}

interface TranscriptState {
    transcript: string;
    partial: string;
    chunks: TranscriptChunk[];
}

// SttStatus imported from '@/types/transcription'

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
    updateTranscript: (transcript: string, partial?: string, chunks?: TranscriptChunk[]) => void;
    addChunk: (text: string, speaker?: string) => void;
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
        chunks: [],
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

    updateTranscript: (transcript, partial = '', chunks) =>
        set((state) => ({
            transcript: {
                transcript,
                partial,
                chunks: chunks || state.transcript.chunks,
            },
        })),

    addChunk: (text, speaker) =>
        set((state) => {
            const newChunk: TranscriptChunk = {
                text,
                speaker,
                timestamp: Date.now(),
            };
            const newTranscript = state.transcript.transcript
                ? `${state.transcript.transcript} ${text}`
                : text;

            return {
                transcript: {
                    ...state.transcript,
                    transcript: newTranscript,
                    chunks: [...state.transcript.chunks, newChunk],
                }
            };
        }),

    updateFillerData: (data) =>
        set({
            fillerData: data,
        }),

    updateElapsedTime: (time) =>
        set({
            elapsedTime: time,
        }),

    setSTTStatus: (status) => {
        set((state) => {
            // ✅ GUARD: Don't allow overwriting 'recording' with 'idle' or 'ready' silently
            if (state.sttStatus.type === 'recording') {
                if (status.type === 'idle' || status.type === 'ready') {
                    logger.warn({ status }, '[Store] ⚠️ Attempted to overwrite recording state');
                }
            }
            return { sttStatus: status };
        });
    },

    setSTTMode: (mode) =>
        set({
            sttMode: mode,
        }),

    setActiveEngine: (engine) =>
        set({
            activeEngine: engine,
        }),

    setModelLoadingProgress: (progress) => {
        logger.debug({ progress }, '[Store] setModelLoadingProgress');
        set({
            modelLoadingProgress: progress,
        });
    },

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
declare global {
    interface Window {
        useSessionStore?: typeof useSessionStore;
        __SESSION_STORE_API__?: typeof useSessionStore;
    }
}

if (typeof window !== 'undefined') {
    window.useSessionStore = useSessionStore;
    window.__SESSION_STORE_API__ = useSessionStore;
}
