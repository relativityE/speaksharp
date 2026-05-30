import { create } from 'zustand';
import { FillerCounts } from '@/utils/fillerWordUtils';
import logger from '@/lib/logger';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import { SttStatus, HistorySegment } from '@/types/transcription';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import { ENV } from '@/config/TestFlags';
import { syncForensicAnchors } from '@/lib/forensicAnchors';

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
    pauseMetrics: PauseMetrics;
    sessionSaved: boolean;
    sunsetModal: { type: 'daily' | 'monthly'; open: boolean };
    isBooting: boolean;
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
    setPauseMetrics: (metrics: PauseMetrics) => void;
    setLockHeldByOther: (held: boolean) => void;
    setSessionSaved: (saved: boolean) => void;
    setSunsetModal: (modal: { type: 'daily' | 'monthly'; open: boolean }) => void;
    setIsBooting: (isBooting: boolean) => void;
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
    pauseMetrics: {
        totalPauses: 0,
        averagePauseDuration: 0,
        longestPause: 0,
        pausesPerMinute: 0,
        silencePercentage: 0,
        transitionPauses: 0,
        extendedPauses: 0,
    },
    sessionSaved: false,
    sunsetModal: { type: 'daily', open: false },
    isBooting: false,
};

const normalizeModelLoadingProgress = (progress: number | null): number | null => {
    if (progress === null || !Number.isFinite(progress)) return null;
    const percent = progress > 0 && progress <= 1 ? progress * 100 : progress;
    return Math.max(0, Math.min(100, Math.round(percent)));
};

const sentenceCaseStart = (text: string): string => {
    const firstLetterIndex = text.search(/[A-Za-z]/);
    if (firstLetterIndex === -1) return text;
    return `${text.slice(0, firstLetterIndex)}${text.charAt(firstLetterIndex).toUpperCase()}${text.slice(firstLetterIndex + 1)}`;
};

export const useSessionStore = create<SessionStore>((set) => {
    const instanceId = Math.random().toString(36).substring(7);
    if (typeof window !== 'undefined') {
        (window as unknown as { __LAST_STORE_ID__: string }).__LAST_STORE_ID__ = instanceId;
        if (import.meta.env.DEV) {
            console.warn(`[STORE-IDENTITY] SessionStore Instance Created: [${instanceId}]`);
        }
    }

    return {
    ...initialState,

    setRuntimeState: (runtimeState) => {
        logger.debug({ runtimeState }, '[useSessionStore] setRuntimeState');
        set((state) => {
            const next = {
                runtimeState,
                isListening: runtimeState === 'RECORDING',
                isInitiating: runtimeState === 'INITIATING',
                isReady: runtimeState === 'READY',
            };
            if (
                state.runtimeState === next.runtimeState &&
                state.isListening === next.isListening &&
                state.isInitiating === next.isInitiating &&
                state.isReady === next.isReady
            ) {
                return state;
            }
            return next;
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
        set({
            transcript: {
                transcript: sentenceCaseStart(transcriptText),
                partial: sentenceCaseStart(partial),
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
            if (
                state.sttStatus.type === status.type &&
                state.sttStatus.message === status.message &&
                state.sttStatus.progress === status.progress &&
                state.sttStatus.isFrozen === status.isFrozen
            ) {
                return state;
            }
            // Guard active recordings, but allow recovery once runtime has left RECORDING.
            if (
                state.runtimeState === 'RECORDING' &&
                state.sttStatus.type === 'recording' &&
                (status.type === 'idle' || status.type === 'ready')
            ) {
                logger.warn({ status, currentState: state.sttStatus.type }, '[Store] ⚠️ Attempted to overwrite recording state');
                return state;
            }
            return { sttStatus: status };
        });
    },

    setSTTMode: (mode) => {
        set((state) => {
            if (state.sttMode === mode) {
                syncForensicAnchors(state.runtimeState, mode);
                return state;
            }
            const resetVisibleSession = state.runtimeState !== 'RECORDING';
            const next = {
                ...state,
                sttMode: mode,
                ...(resetVisibleSession ? {
                    transcript: { transcript: '', partial: '' },
                    chunks: [],
                    fillerData: {},
                    elapsedTime: 0,
                    startTime: null,
                    activeEngine: null,
                    sessionSaved: false,
                    pauseMetrics: initialState.pauseMetrics,
                    sttStatus: { type: 'ready', message: 'Ready to record' } as SttStatus,
                } : {}),
            };
            // Immediate intent signal using next-state snapshot (Invariant I2)
            syncForensicAnchors(next.runtimeState, mode);
            return next;
        });
    },

    setActiveEngine: (engine) =>
        set((state) => {
            if (state.activeEngine === engine) return state;
            return { activeEngine: engine };
        }),

    setModelLoadingProgress: (progress) => {
        const normalized = normalizeModelLoadingProgress(progress);
        set((state) => {
            if (state.modelLoadingProgress === normalized) return state;
            return { modelLoadingProgress: normalized };
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

    setPauseMetrics: (pauseMetrics) =>
        set({
            pauseMetrics,
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
    
    setIsBooting: (isBooting) =>
        set({
            isBooting,
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
