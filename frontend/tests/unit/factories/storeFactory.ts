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
    activeEngineVersion: null,
    isInitiating: false,
    runtimeState: 'IDLE',
    isLockHeldByOther: false,
    history: [],
    chunks: [],
    frozenTranscriptAtStop: null,
    isTranscriptFinalizing: false,
    captureLimitReached: null,
    completedSessionDurationSeconds: null,
    activeObjectiveBrief: null,
    practiceFocus: null,
    completedObjectiveBrief: null,
    objectiveCoverageResult: null,
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
    nativeFormatting: { status: 'idle', startedAt: null },
    finalizedAnalysis: null,
    isBooting: false,
    engineSelectionLocked: false,
    pendingResolutionKind: null,
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

        setActiveEngineVersion: vi.fn((key) =>
            set({
                activeEngineVersion: key,
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

        setEngineSelectionLock: vi.fn(),
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

        setNativeFormatting: vi.fn((nativeFormatting) =>
            set({
                nativeFormatting,
            })),

        setFinalizedAnalysis: vi.fn((finalizedAnalysis) =>
            set({
                finalizedAnalysis,
            })),

        resetSession: vi.fn(() =>
            set(initialState)),

        addChunk: vi.fn((chunk) =>
            set((state: any) => ({
                chunks: [...state.chunks, chunk],
            }))),

        appendChunk: vi.fn((chunk) =>
            set((state: any) => ({
                chunks: [...state.chunks, chunk],
            }))),

        setChunks: vi.fn((chunks) =>
            set({
                chunks,
            })),

        freezeTranscriptAtStop: vi.fn((frozenTranscriptAtStop) =>
            set({
                frozenTranscriptAtStop,
            })),

        setCaptureLimitReached: vi.fn((captureLimitReached) => set({ captureLimitReached })),
        setCompletedSessionDuration: vi.fn((completedSessionDurationSeconds) => set({ completedSessionDurationSeconds })),
        setActiveObjectiveBrief: vi.fn((activeObjectiveBrief) => set({ activeObjectiveBrief })),
        setPracticeFocus: vi.fn((practiceFocus) => set({ practiceFocus })),
        setCompletedObjectiveBrief: vi.fn((completedObjectiveBrief) => set({ completedObjectiveBrief })),
        setObjectiveCoverageResult: vi.fn((objectiveCoverageResult) => set({ objectiveCoverageResult })),
        setTranscriptFinalizing: vi.fn((isTranscriptFinalizing) =>
            set({
                isTranscriptFinalizing,
            })),

        setPauseMetrics: vi.fn((pauseMetrics) =>
            set({
                pauseMetrics,
            })),
            
        setIsBooting: vi.fn((isBooting) =>
            set({
                isBooting,
            })),
    }));
}
