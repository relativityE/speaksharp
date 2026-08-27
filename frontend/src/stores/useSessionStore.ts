import { create } from 'zustand';
import { FillerCounts } from '@/utils/fillerWordUtils';
import type { FinalizedFillerReconciliation } from '@/utils/finalizedSessionAnalysis';
import logger from '@/lib/logger';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import type { CoverageStatus } from '@/services/rehearsal/outcomeScorecard';
import { SttStatus, HistorySegment } from '@/types/transcription';
import type { FinalizeEngineKey } from '@/services/transcription/finalizeRateStore';
import type { PauseMetrics } from '@/services/audio/pauseDetector';
import { ENV } from '@/config/TestFlags';
import type { PracticeFocus } from '@/constants/practiceFocus';
import { isPracticeFocus } from '@/constants/practiceFocus';
import { syncForensicAnchors } from '@/lib/forensicAnchors';

/**
 * One Focus Points rail row: the point's brief id, the label to display, and its resolved coverage
 * status. Structurally matches the CoverageRail component's `CoverageRailPoint` prop (kept independent
 * so the store never imports a component), so a stored array can be passed straight to the rail.
 */
export interface ObjectiveCoverageRow {
    id: string;
    label: string;
    status: CoverageStatus;
}

interface TranscriptState {
    transcript: string;
    partial: string;
}

// SttStatus imported from '@/types/transcription'

import { RuntimeState } from '@/services/SpeechRuntimeController';

export type NativeFormattingUiStatus = 'idle' | 'pending' | 'complete' | 'failed';

export interface NativeFormattingUiState {
    status: NativeFormattingUiStatus;
    /** Epoch ms when post-stop formatting began; null when idle/terminal. Drives the
     *  threshold-only "tidying up punctuation…" notice (shown only if pending > ~1.5s). */
    startedAt: number | null;
}

/**
 * Published by the controller AFTER a session is persisted (Track 1 finalized reconciliation).
 * Drives the consolidated status bar's mode-aware copy, the Analytics cue (session-scoped via
 * `sessionId`), and the one-shot completion toast. Persisted total == canonical live (#944).
 */
export interface FinalizedAnalysisState {
    sessionId: string;
    /** Engine that finalized this session ('native' | 'private' | 'cloud' | ...). */
    mode: string;
    reconciliation: FinalizedFillerReconciliation;
    /** Persisted / user-facing filler total (== canonical live). */
    persistedTotal: number;
}

export interface SessionState {
    runtimeState: RuntimeState;
    /** #1033 Part-2b: TRUE while the STT engine selection is locked (Start intent, recording lifecycle,
     *  a pending save/attribution resolution, or a started-but-unresolved recording). Published by the
     *  controller so the selector UI can never disagree with the runtime about whether it may change. */
    engineSelectionLocked: boolean;
    /** #1033 Part-2b: which recovery the user can act on, or null. Drives Retry Save / Discard UI. */
    pendingResolutionKind: 'initial_save' | 'full_save' | 'attribution' | null;
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
    // #34 resolved finalize-rate key for the active engine (private_v2/private_v4/native/cloud),
    // used to drive an engine-aware, self-correcting finalize-time estimate.
    activeEngineVersion: FinalizeEngineKey | null;
    history: Array<HistorySegment>;
    chunks: Array<{ transcript: string; timestamp: number; isFinal: boolean }>;
    frozenTranscriptAtStop: string | null;
    isTranscriptFinalizing: boolean;
    /**
     * #1089: set once when the engine's hard capture backstop is reached. Non-null means the engine has
     * stopped accepting audio, so the app MUST perform a controlled stop and finalize what was captured.
     * Carries only durations — no transcript, no audio, no identity.
     */
    captureLimitReached: { bufferedSeconds: number; limitSeconds: number } | null;
    /**
     * #1089: the SPOKEN length of the most recently completed recording (start -> stop), published by
     * the controller at stop entry from the same value that is persisted to the DB.
     *
     * This exists because `elapsedTime` has two conflicting jobs: it is the LIVE timer for the NEXT
     * recording (which must read 00:00 on the Ready surface) and it was also the denominator every
     * post-save surface used for the take that just finished. Zeroing it for the first job silently
     * broke the second — WPM, pace and the coaching score all divide by it. They now read this
     * snapshot instead, so Ready can honestly show 00:00 while the review of the completed session
     * keeps the correct duration. Cleared when a new recording starts.
     */
    completedSessionDurationSeconds: number | null;
    /**
     * #1046 slice 3b-ii: the Focus Points brief the CURRENT recording is being made against, or null for
     * a freeform (Open Mic) recording. Set at objective-session entry (slice 5); read at the stop seam
     * to finalize per-point coverage; CONSUMED (set null) immediately after finalize fires, so a stale
     * brief can never leak an Open Mic recording into Focus Points scoring (the isolation invariant).
     */
    activeObjectiveBrief: { projectId: string; briefId: string; points?: string[]; topic?: string; paceGuideSecPerPoint?: number | null } | null;
    /**
     * #1264 — the optional Open Mic "Practice Focus" intention (or null). Unlike the objective brief, this
     * is NOT cleared on recording start: it persists so a "Practice this next" repeat keeps the same
     * intention. It is display-only — never a score, never part of the persisted session analysis, and it
     * never changes transcript truth or engine policy.
     */
    practiceFocus: PracticeFocus | null;
    /**
     * #1046 G6/G7 — a SNAPSHOT of the brief captured at save, when `activeObjectiveBrief` is cleared to
     * preserve the isolation invariant. The after-state (review screen) reads this so its Focus Points
     * coverage card, delivery strip, and highlights survive the save. Cleared when the next recording
     * starts, so it can never make a fresh Open Mic session render as Focus Points.
     */
    completedObjectiveBrief: { projectId: string; briefId: string; points?: string[]; topic?: string; paceGuideSecPerPoint?: number | null } | null;
    /**
     * #1354 — the previous session's Progress evidence is not yet terminal, so a new recording must not
     * start. Content-free by construction: a session id and a discriminant, never transcript or error
     * text. `queued` is actionable (a durable retry exists); `unresolved` is fail-closed.
     *
     * This exists in the STORE as well as the controller because disabling the button alone is not a
     * gate — the controller's Start entry enforces it independently, and this drives the visible state.
     */
    progressGate: { sessionId: string; ownerId: string | null; state: 'resolving' | 'queued' | 'unresolved' } | null;
    /**
     * #1354 CASE 4 — WHICH OWNER the gate has been determined for. `null` = not determined yet;
     * `''` = determined for an anonymous (signed-out) visitor; otherwise the user id.
     *
     * `progressGate: null` is ambiguous on its own: it means both "nothing is owed" and "we have not
     * looked yet". On reload we have not looked until the durable queue has been read, and rendering an
     * enabled Start during that window is exactly the flash this prevents.
     *
     * It stores the OWNER rather than a boolean so an ACCOUNT TRANSITION invalidates the answer
     * immediately: debt is owner-scoped, and a `true` inherited from the previous account would render
     * an enabled Start for the new one before their queue had ever been read.
     */
    progressGateResolvedFor: string | null;
    /**
     * #1046 slice 5a: per-point Focus Points coverage for the settled Session page, or null when the
     * completed recording was not a Focus Points session. Mirrors {@link finalizedAnalysis}'s lifecycle
     * exactly — null until an objective session finalizes, SET at the stop seam after coverage is
     * computed, and CLEARED at the start of every new recording so a prior brief's rail can never
     * linger onto a later Open Mic session (the isolation invariant, at the UI layer).
     */
    objectiveCoverageResult: ObjectiveCoverageRow[] | null;
    pauseMetrics: PauseMetrics;
    sessionSaved: boolean;
    nativeFormatting: NativeFormattingUiState;
    /** Post-persistence finalized reconciliation for the settled Session page; null until a save. */
    finalizedAnalysis: FinalizedAnalysisState | null;
    /** #1306 Option A: the FINAL metric snapshot captured at the terminal transition, BEFORE the transcript is
     *  purged, so the metrics-only review shows the true word count + filler breakdown WITHOUT recounting or
     *  retaining the transcript. `finalizedFillerData` is deliberately SEPARATE from the live `fillerData` (which
     *  the live useFillerWords sync overwrites to `{}` once the chunks are purged). */
    finalizedWordCount: number | null;
    finalizedFillerData: FillerCounts | null;
    finalizedFillerCount: number | null;
    isBooting: boolean;
}

interface SessionActions {
    setRuntimeState: (state: RuntimeState) => void;
    setEngineSelectionLock: (locked: boolean, pendingResolutionKind: 'initial_save' | 'full_save' | 'attribution' | null) => void;
    startSession: () => void;
    stopSession: () => void;
    setReady: (ready: boolean) => void;
    updateTranscript: (transcript: string, partial?: string) => void;
    updateFillerData: (data: FillerCounts) => void;
    updateElapsedTime: (time: number) => void;
    setSTTStatus: (status: SttStatus) => void;
    setSTTMode: (mode: TranscriptionMode | null) => void;
    setActiveEngine: (engine: TranscriptionMode | 'none' | null) => void;
    setActiveEngineVersion: (key: FinalizeEngineKey | null) => void;
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
    freezeTranscriptAtStop: (transcript: string | null) => void;
    setTranscriptFinalizing: (finalizing: boolean) => void;
    setCaptureLimitReached: (info: { bufferedSeconds: number; limitSeconds: number } | null) => void;
    setCompletedSessionDuration: (seconds: number | null) => void;
    setActiveObjectiveBrief: (brief: { projectId: string; briefId: string; points?: string[]; topic?: string; paceGuideSecPerPoint?: number | null } | null) => void;
    setPracticeFocus: (focus: PracticeFocus | null) => void;
    setCompletedObjectiveBrief: (brief: { projectId: string; briefId: string; points?: string[]; topic?: string; paceGuideSecPerPoint?: number | null } | null) => void;
    setProgressGate: (gate: { sessionId: string; ownerId: string | null; state: 'resolving' | 'queued' | 'unresolved' } | null) => void;
    setProgressGateResolvedFor: (ownerId: string | null) => void;
    setObjectiveCoverageResult: (rows: ObjectiveCoverageRow[] | null) => void;
    setPauseMetrics: (metrics: PauseMetrics) => void;
    setLockHeldByOther: (held: boolean) => void;
    setSessionSaved: (saved: boolean) => void;
    setNativeFormatting: (formatting: NativeFormattingUiState) => void;
    setFinalizedAnalysis: (analysis: FinalizedAnalysisState | null) => void;
    setFinalizedWordCount: (wordCount: number | null) => void;
    setFinalizedFillerData: (data: FillerCounts | null) => void;
    setFinalizedFillerCount: (count: number | null) => void;
    setIsBooting: (isBooting: boolean) => void;
}

export type SessionStore = SessionState & SessionActions;

// #1264 — Practice Focus persists in sessionStorage so a "Practice this next" repeat (even one that
// re-navigates or reloads within the tab) keeps the chosen intention. Session-scoped: it clears when the
// tab closes, which is the right lifetime for a per-practice-session intention. Fails open (best-effort).
const PRACTICE_FOCUS_KEY = 'speaksharp_practice_focus_v1';
const readPracticeFocus = (): PracticeFocus | null => {
  try {
    const v = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(PRACTICE_FOCUS_KEY) : null;
    return isPracticeFocus(v) ? v : null;
  } catch { return null; }
};
const writePracticeFocus = (v: PracticeFocus | null): void => {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (v) sessionStorage.setItem(PRACTICE_FOCUS_KEY, v);
    else sessionStorage.removeItem(PRACTICE_FOCUS_KEY);
  } catch { /* best-effort */ }
};

const initialState: SessionState = {
    runtimeState: 'IDLE',
    engineSelectionLocked: false,
    pendingResolutionKind: null,
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
    activeEngineVersion: null,
    history: [],
    chunks: [],
    frozenTranscriptAtStop: null,
    isTranscriptFinalizing: false,
    captureLimitReached: null,
    completedSessionDurationSeconds: null,
    activeObjectiveBrief: null,
    practiceFocus: readPracticeFocus(),
    completedObjectiveBrief: null,
    progressGate: null,
    progressGateResolvedFor: null,
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
    finalizedWordCount: null,
    finalizedFillerData: null,
    finalizedFillerCount: null,
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
        // Diagnostic identity marker. Runs at STORE CREATION (module init), so it must
        // not assume a fully-shaped logger — tests that mock `logger` without `.debug`
        // would otherwise crash on import. Keep it dev-only behind the env gate (the
        // original guard) so it never executes in test/prod; the instance id is also
        // always available on window.__LAST_STORE_ID__.
        if (import.meta.env.DEV) {
            logger.debug(`[STORE-IDENTITY] SessionStore Instance Created: [${instanceId}]`);
        }
    }

    return {
    ...initialState,

    setEngineSelectionLock: (engineSelectionLocked, pendingResolutionKind) => {
        set((state) => (
            state.engineSelectionLocked === engineSelectionLocked && state.pendingResolutionKind === pendingResolutionKind
                ? state
                : { ...state, engineSelectionLocked, pendingResolutionKind }
        ));
    },
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
            activeEngineVersion: null,
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
            // #1089 STALE TIMER (Ready/Idle invariant): "Ready to record" / "idle" with a non-zero elapsed
            // timer is a contradiction — Ready asserts that no recording is in progress. The visible timer
            // was only ever reset inside setSTTMode, which skips the reset once sessionSaved is true, so a
            // prior take's elapsed value could survive into the Ready surface (the observed 00:09 while
            // Ready). We MUST enforce this on EVERY route into Ready/Idle. Compute it FIRST, before the
            // duplicate-status no-op below — otherwise republishing the SAME Ready status (a common
            // re-render/re-subscribe path) returns early and preserves the stale timer. Guarded on
            // runtimeState so a live recording is never zeroed from under itself. This zeroes ONLY the LIVE
            // timer (elapsedTime/startTime); completedSessionDurationSeconds, transcript, saved-session
            // identity and recovery state are deliberately untouched — the just-finished session's review
            // still needs its real duration.
            const violatesReadyTimerInvariant =
                (status.type === 'ready' || status.type === 'idle') &&
                state.runtimeState !== 'RECORDING' &&
                (state.elapsedTime !== 0 || state.startTime !== null);

            const isDuplicateStatus =
                state.sttStatus.type === status.type &&
                state.sttStatus.message === status.message &&
                state.sttStatus.progress === status.progress &&
                state.sttStatus.isFrozen === status.isFrozen;

            if (isDuplicateStatus) {
                // A genuine no-op UNLESS the stale-timer invariant is violated; if so, normalize only the
                // LIVE timer while leaving the (unchanged) status and all completed/saved/recovery state.
                return violatesReadyTimerInvariant ? { elapsedTime: 0, startTime: null } : state;
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
            if (violatesReadyTimerInvariant) {
                return { sttStatus: status, elapsedTime: 0, startTime: null };
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
            const resetVisibleSession =
                state.runtimeState !== 'RECORDING' &&
                !state.isTranscriptFinalizing &&
                !state.frozenTranscriptAtStop &&
                // Preserve a just-saved transcript across any post-save internal mode normalization.
                // The next recording resets visible state via resetAnalysisStateForNewRecording.
                !state.sessionSaved;
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
                    activeEngineVersion: null,
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

    setActiveEngineVersion: (key) =>
        set((state) => {
            if (state.activeEngineVersion === key) return state;
            return { activeEngineVersion: key };
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

    setNativeFormatting: (nativeFormatting) =>
        set({ nativeFormatting }),

    setFinalizedAnalysis: (finalizedAnalysis) =>
        set({ finalizedAnalysis }),
    setFinalizedWordCount: (finalizedWordCount) =>
        set({ finalizedWordCount }),
    setFinalizedFillerData: (finalizedFillerData) =>
        set({ finalizedFillerData }),
    setFinalizedFillerCount: (finalizedFillerCount) =>
        set({ finalizedFillerCount }),

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

    freezeTranscriptAtStop: (frozenTranscriptAtStop) =>
        set({
            frozenTranscriptAtStop,
        }),

    setCaptureLimitReached: (captureLimitReached) => set({ captureLimitReached }),

    setCompletedSessionDuration: (completedSessionDurationSeconds) => set({ completedSessionDurationSeconds }),
    setActiveObjectiveBrief: (activeObjectiveBrief) => set({ activeObjectiveBrief }),
    setPracticeFocus: (practiceFocus) => { writePracticeFocus(practiceFocus); set({ practiceFocus }); },
    setCompletedObjectiveBrief: (completedObjectiveBrief) => set({ completedObjectiveBrief }),
    setProgressGate: (progressGate) => set({ progressGate }),
    setProgressGateResolvedFor: (progressGateResolvedFor) => set({ progressGateResolvedFor }),
    setObjectiveCoverageResult: (objectiveCoverageResult) => set({ objectiveCoverageResult }),

    setTranscriptFinalizing: (isTranscriptFinalizing) =>
        set({
            isTranscriptFinalizing,
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
