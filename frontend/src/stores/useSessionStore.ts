import { create } from 'zustand';
import { FillerCounts } from '@/utils/fillerWordUtils';
import logger from '@/lib/logger';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import { SttStatus, HistorySegment } from '@/types/transcription';
import { ENV } from '@/config/TestFlags';

interface TranscriptState {
    transcript: string;
    partial: string;
}

// SttStatus imported from '@/types/transcription'

import { RuntimeState } from '@/services/SpeechRuntimeController';

export interface SessionState {
    runtimeState: RuntimeState;
    isLockHeldByOther: boolean;
    isListening: boolean;
    isInitiating: boolean;
    isReady: boolean;
    transcript: TranscriptState;
    fillerData: FillerCounts;
    elapsedTime: number;
    startTime: number | null;
    sttStatus: SttStatus;
    sttMode: TranscriptionMode | null;
    modelLoadingProgress: number | null;
    activeEngine: TranscriptionMode | 'none' | null;
    history: Array<HistorySegment>;
    chunks: Array<{ transcript: string; timestamp: number; isFinal: boolean }>;
    sessionSaved: boolean;
    sunsetModal: { type: 'daily' | 'monthly'; open: boolean };
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
    setStartTime: (time: number | null) => void;
    tick: () => void;
    setElapsedTime: (seconds: number) => void;
    addHistorySegment: (segment: HistorySegment) => void;
    setHistory: (history: Array<HistorySegment>) => void;
    resetSession: () => void;
    addChunk: (chunk: { transcript: string; timestamp: number; isFinal: boolean }) => void;
    appendChunk: (chunk: { transcript: string; timestamp: number; isFinal: boolean; isCorrection?: boolean }) => void;
    setChunks: (chunks: Array<{ transcript: string; timestamp: number; isFinal: boolean; isCorrection?: boolean }>) => void;
    setLockHeldByOther: (held: boolean) => void;
    setSessionSaved: (saved: boolean) => void;
    setSunsetModal: (modal: { type: 'daily' | 'monthly'; open: boolean }) => void;
}

export type SessionStore = SessionState & SessionActions;

const initialState: SessionState = {
    runtimeState: 'IDLE',
    isLockHeldByOther: false,
    isListening: false,
    isInitiating: false,
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
    chunks: [],
    sessionSaved: false,
    sunsetModal: { type: 'daily', open: false },
};

export const useSessionStore = create<SessionStore>((set) => {
    const instanceId = Math.random().toString(36).substring(7);
    if (typeof window !== 'undefined') {
        (window as unknown as { __LAST_STORE_ID__: string }).__LAST_STORE_ID__ = instanceId;
        console.warn(`[STORE-IDENTITY] 🏗️ SessionStore Instance Created: [${instanceId}]`);
    }

    return {
    ...initialState,

    setRuntimeState: (runtimeState) => {
        logger.debug({ runtimeState }, '[useSessionStore] setRuntimeState');
        set({
            runtimeState,
            isListening: runtimeState === 'RECORDING' || runtimeState === 'ENGINE_INITIALIZING' || runtimeState === 'INITIATING',
            isInitiating: runtimeState === 'INITIATING',
            isReady: runtimeState === 'READY',
        });
    },

    startSession: () => {
        // Master Invariant: startSession is a side-effect of FSM transition
        set((state) => ({
            isListening: true,
            startTime: state.startTime || Date.now(),
        }));
    },

    stopSession: () => {
        // Master Invariant: stopSession is a side-effect of FSM transition
        set({
            isListening: false,
            startTime: null,
            activeEngine: null,
            modelLoadingProgress: null,
            sttStatus: { type: 'idle', message: 'Ready to record' },
        });
    },

    setReady: (ready) =>
        set({
            isReady: ready,
        }),

    updateTranscript: (transcriptText, partial = '') => {
        console.warn(`[DIAG-STORE] updateTranscript: "${transcriptText.substring(0, 30)}..." (partial: "${partial}")`);
        set({
            transcript: {
                transcript: transcriptText,
                partial,
            },
        });
    },

    updateFillerData: (data) =>
        set({
            fillerData: data,
        }),

    updateElapsedTime: (time) =>
        set({
            elapsedTime: time,
        }),

    setSTTStatus: (status) => {
        logger.debug({ type: status.type, message: status.message, timestamp: Date.now() }, '[STORE UPDATE]');
        set((state) => {
            // ✅ GUARD: Don't allow overwriting 'recording' with 'idle' or 'ready' silently
            if (state.sttStatus.type === 'recording' && (status.type === 'idle' || status.type === 'ready')) {
                logger.warn({ status, currentState: state.sttStatus.type }, '[Store] ⚠️ Attempted to overwrite recording state');
                return state;
            }
            return { sttStatus: status };
        });
    },

    setSTTMode: (mode) => {
        set({
            sttMode: mode,
        });
    },

    setActiveEngine: (engine) =>
        set({
            activeEngine: engine,
        }),

    setModelLoadingProgress: (progress) => {
        set({
            modelLoadingProgress: progress,
        });
    },

    setStartTime: (startTime) =>
        set({
            startTime,
        }),

    tick: () => set((state) => {
        if (!state.startTime) return state;
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

    addChunk: (chunk) =>
        set((state) => ({
            chunks: [...state.chunks, chunk],
        })),

    appendChunk: (chunk) =>
        set((state) => ({
            chunks: [...state.chunks, chunk],
        })),

    setChunks: (chunks) =>
        set({
            chunks,
        }),

    setLockHeldByOther: (held: boolean) =>
        set({
            isLockHeldByOther: held,
        }),

        setSessionSaved: (saved: boolean) =>
        set({
            sessionSaved: saved,
        }),

    setSunsetModal: (sunsetModal) =>
        set({
            sunsetModal,
        }),
    };
});


// Expose store to window only in test/dev for E2E diagnostics (Strict Zero)
if (process.env.NODE_ENV !== 'production' || ENV.isE2E) {
    if (typeof window !== 'undefined') {
        (window as unknown as { useSessionStore: unknown }).useSessionStore = useSessionStore;
        (window as unknown as { __SESSION_STORE_API__: unknown }).__SESSION_STORE_API__ = useSessionStore;
    }
}
