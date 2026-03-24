import { create } from 'zustand';
import type { SessionStore, SessionState } from '@/stores/useSessionStore';
import { vi } from 'vitest';

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
    isInitiating: false,
    runtimeState: 'IDLE',
    isLockHeldByOther: false,
    history: [],
    chunks: [],
    sessionSaved: false,
    sunsetModal: { type: 'daily', open: false },
};

/**
 * Industry Pattern: Test Factory
 * Creates REAL Zustand store instances with mocked actions for test deterministic testing.
 */
export function createTestSessionStore(
    overrides?: Partial<SessionState>
) {
    return create<SessionStore>((set) => ({
        ...initialState,
        ...overrides,

        startSession: vi.fn(() =>
            set({
                isListening: true,
                startTime: Date.now(),
            })),

        stopSession: vi.fn(() =>
            set({
                isListening: false,
                startTime: null,
            })),

        setReady: vi.fn((ready) =>
            set({
                isReady: ready,
            })),

        updateTranscript: vi.fn((transcript, partial = '') =>
            set({
                transcript: {
                    transcript,
                    partial,
                },
            })),

        updateFillerData: vi.fn((data) =>
            set({
                fillerData: data,
            })),

        updateElapsedTime: vi.fn((time) =>
            set({
                elapsedTime: time,
            })),

        setSTTStatus: vi.fn((status) =>
            set({
                sttStatus: status,
            })),

        setSTTMode: vi.fn((mode) =>
            set({
                sttMode: mode,
            })),

        setModelLoadingProgress: vi.fn((progress) =>
            set({
                modelLoadingProgress: progress,
            })),

        tick: vi.fn(() => set((state) => {
            if (!state.isListening || !state.startTime) return state;
            return { elapsedTime: Math.floor((Date.now() - state.startTime) / 1000) };
        })),

        setActiveEngine: vi.fn((engine) =>
            set({
                activeEngine: engine,
            })),

        setElapsedTime: vi.fn((seconds) =>
            set({
                elapsedTime: seconds,
            })),

        addHistorySegment: vi.fn((segment) =>
            set((state) => ({
                history: [...state.history, segment],
            }))),

        setHistory: vi.fn((history) =>
            set({
                history,
            })),

        setRuntimeState: vi.fn((state) =>
            set({
                runtimeState: state,
            })),

        setStartTime: vi.fn((time) =>
            set({
                startTime: time,
            })),

        setLockHeldByOther: vi.fn((held) =>
            set({
                isLockHeldByOther: held,
            })),

        setSessionSaved: vi.fn((saved) =>
            set({
                sessionSaved: saved,
            })),

        setSunsetModal: vi.fn((sunsetModal) =>
            set({
                sunsetModal,
            })),

        resetSession: vi.fn(() =>
            set(initialState)),

        addChunk: vi.fn((chunk) =>
            set((state: any) => ({
                chunks: [...state.chunks, chunk],
            }))),
    }));
}
