import { create } from 'zustand';
import { FillerCounts } from '../utils/fillerWordUtils';
import logger from '../lib/logger';
import { TranscriptionMode } from '../services/transcription/TranscriptionPolicy';
import { SttStatus } from '../types/transcription';

interface TranscriptState {
    transcript: string;
    partial: string;
}

// SttStatus imported from '@/types/transcription'

import { RuntimeState } from '../services/SpeechRuntimeController';

export interface SessionState {
    runtimeState: RuntimeState;
    isLockHeldByOther: boolean;
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
    history: Array<{ mode: TranscriptionMode; text: string }>;
}

interface SessionActions {
    setRuntimeState: (state: RuntimeState) => void;
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
    addHistorySegment: (segment: { mode: TranscriptionMode; text: string }) => void;
    setHistory: (history: Array<{ mode: TranscriptionMode; text: string }>) => void;
    resetSession: () => void;
    setLockHeldByOther: (held: boolean) => void;
}

export type SessionStore = SessionState & SessionActions;

const initialState: SessionState = {
    runtimeState: 'IDLE',
    isLockHeldByOther: false,
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
    history: [],
};

export const useSessionStore = create<SessionStore>((set) => ({
    ...initialState,

    setRuntimeState: (runtimeState) =>
        set({
            runtimeState,
        }),

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

    updateTranscript: (transcriptText, partial = '') =>
        set({
            transcript: {
                transcript: transcriptText,
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

    addHistorySegment: (segment) =>
        set((state) => ({
            history: [...state.history, segment],
        })),

    setHistory: (history) =>
        set({
            history,
        }),

    resetSession: () =>
        set(initialState),

    setLockHeldByOther: (held: boolean) =>
        set({
            isLockHeldByOther: held,
        }),
}));

// Expose store to window only in test/dev for E2E diagnostics
if (process.env.NODE_ENV !== 'production' || (typeof window !== 'undefined' && (window as { TEST_MODE?: boolean }).TEST_MODE)) {
    if (typeof window !== 'undefined') {
        (window as unknown as { useSessionStore: unknown }).useSessionStore = useSessionStore;
        (window as unknown as { __SESSION_STORE_API__: unknown }).__SESSION_STORE_API__ = useSessionStore;
    }
}
