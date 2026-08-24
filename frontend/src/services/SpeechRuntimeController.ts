import logger from '@/lib/logger';
import { syncSTTReady, syncSTTIdentity, syncForensicAnchors as syncRuntimeState, syncEngineReady, syncSessionPersisted, syncNegotiatorDecision, syncProfileReady } from '@/lib/forensicAnchors';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';
import { toSanitizedCause } from '@/lib/sanitizeStartError';
import TranscriptionService, { getTranscriptionService } from '@/services/transcription/TranscriptionService';
import type { TranscriptionPolicy } from '@/services/transcription/TranscriptionPolicy';
import { resolvePrivateModel } from '@/services/transcription/utils/privateModelFlag';
import { getV4FlagState } from '@/services/transcription/privateV4Flags';
import { isPrivateEngineOverrideActive } from '@/services/transcription/engines/PrivateSTT';
import type { MetricsEngine } from '@/services/telemetry/MetricsEngine';
import { createShadowMetricsEngine, toTelemetryMode, isShadowMetricsEngineEnabled } from '@/services/telemetry/shadowMetricsEngine';
import { safeResetSessionTelemetry } from '@/services/telemetry/sessionTelemetryBus';
import { computeLegacyMetrics, compareSnapshotToLegacy, type ParityReport } from '@/services/telemetry/metricsParity';
import { measureFillerDivergence, cloneFillerCounts, buildSanitizedFillerArtifact, type FillerDivergenceReport, type SanitizedFillerArtifact } from '@/services/telemetry/fillerDivergence';
import {
    PRIVATE_TELEMETRY_EVENTS,
    emitPrivateTelemetry,
    resolvePrivateAssignment,
    setPrivateTelemetryContext,
    clearPrivateRecordingIdentity,
    buildPrivateEnvProps,
    buildEngineVersion,
} from '@/services/transcription/privateTelemetry';
import { ATTRIBUTION_STATUS, type AttributionStatus } from '@/constants/attributionStatus';
import { useReadinessStore } from '@/stores/useReadinessStore';
import { saveSession, completeSession, heartbeatSession, type CompleteSessionOptions } from '@/lib/storage';
import { flattenToFillerCounts, deriveNextActionSignal } from '@/utils/nextAction';
import { PRIV_STT } from './transcription/sttConstants';
import { useSessionStore } from '@/stores/useSessionStore';
import { getSupabaseClient } from '../lib/supabaseClient';
import type { UserProfile } from '@/types/user';
import type { TranscriptUpdate, HistorySegment, SttStatus } from '@/types/transcription';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
import { isModeAllowed } from '@/services/transcription/TranscriptionPolicy';
import { emitEngineRequestCollapsedToPrivate, isRetiredEngineRequest } from '@/services/transcription/sttExclusivityTelemetry';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { STT_CONFIG } from '@/config';
import { Result } from '@/services/transcription/modes/types';
import { ENV } from '@/config/TestFlags';
import { sessionManager } from '@/services/transcription/SessionManager';
import type { TranscriptionServiceOptions } from '@/services/transcription/TranscriptionService';
import { pushE2EEvent } from '@/lib/e2eProbe';
import { DistributedLock } from '@/lib/DistributedLock';
import { validateEngine, STTEngine } from '@/contracts/STTEngine';
import { FillerCounts, countFillerWords } from '@/utils/fillerWordUtils';
import { calculateCoreSessionMetrics, getFillerTotal, isUsableFillerCounts } from '@/utils/sessionAnalysis';
import { detectRepetitionRisk } from '@/utils/repetitionRisk';
import { updateSession } from '@/lib/storage';
import { reconcileFinalizedFillers } from '@/utils/finalizedSessionAnalysis';
import { shouldPublishFinalized } from '@/services/transcription/finalizeGate';
// #1033 (2): the controller deliberately imports ONLY the owner-scoped reader — the unscoped
// getSessionRecoveryDraft() must never be reachable from a recovery path.
import { clearSessionRecoveryDraft, getRecoverableDraftForUser, saveSessionRecoveryDraft } from '@/services/sessionRecoveryDraft';
import { wireProgressEvaluationOnSave } from '@/services/progress/recordProgress';
import { installSttEvidenceCollector } from '@/services/transcription/sttEvidenceCollector';
import { installSttIdentityAccessor } from '@/services/transcription/sttIdentity';

declare global {
    interface Window {
        __E2E_UNHANDLED_REJECTIONS__?: unknown[];
        __TRANSCRIPTION_SERVICE__?: SpeechRuntimeController;
        __SpeechRuntimeController__?: typeof SpeechRuntimeController;
        __SPEECH_RUNTIME_DEBUG__?: () => Record<string, unknown>;
        STTEngine?: typeof STTEngine;
        Result?: typeof Result;
        __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
        __NATIVE_BROWSER_TRACE__?: Array<Record<string, unknown>>;
        __SS_TRANSCRIPT_TRACE__?: Array<Record<string, unknown>>;
        __SS_TRANSCRIPT_TRACE_SEQ__?: number;
    }
}

const isPrivateTranscriptTraceEnabled = () =>
    typeof window !== 'undefined' && Boolean(window.__PRIVATE_TRANSCRIPT_TRACE__);

const pushNativeRuntimeTrace = (event: string, payload: Record<string, unknown> = {}) => {
    if (typeof window === 'undefined' || !window.__NATIVE_BROWSER_TRACE__) return;
    window.__NATIVE_BROWSER_TRACE__.push({
        t: Number(performance.now().toFixed(1)),
        event,
        ...payload,
    });
};

// #1306 P1: transcript-text keys that must NEVER appear in a PRODUCTION diagnostic trace (lengths only there).
const TRANSCRIPT_TRACE_TEXT_KEYS = ['preview', 'text', 'transcript', 'partial', 'final', 'finalTranscript', 'currentTranscript', 'newFullText', 'frozenAtStop'];
const pushTranscriptLifecycleTrace = (stage: string, payload: Record<string, unknown> = {}) => {
    if (typeof window === 'undefined') return;
    window.__SS_TRANSCRIPT_TRACE__ = window.__SS_TRANSCRIPT_TRACE__ ?? [];
    window.__SS_TRANSCRIPT_TRACE_SEQ__ = (window.__SS_TRANSCRIPT_TRACE_SEQ__ ?? 0) + 1;
    // #1306 P1: diagnostics retain only codes/numbers/lengths/timestamps — NEVER transcript text, in any build
    // (test/E2E/real-device artifacts are inside the privacy boundary too). Strip any text keys a caller passed.
    const safePayload: Record<string, unknown> = { ...payload };
    for (const k of TRANSCRIPT_TRACE_TEXT_KEYS) if (k in safePayload) delete safePayload[k];
    window.__SS_TRANSCRIPT_TRACE__.push({
        sequence: window.__SS_TRANSCRIPT_TRACE_SEQ__,
        t: Number(performance.now().toFixed(1)),
        stage,
        timestamp: Date.now(),
        ...safePayload,
    });
    if (window.__SS_TRANSCRIPT_TRACE__.length > 1000) {
        window.__SS_TRANSCRIPT_TRACE__.shift();
    }
};

const getVisibleTranscriptText = (transcript: { transcript: string; partial: string }): string =>
    [transcript.transcript.trim(), transcript.partial.trim()]
        .filter(Boolean)
        .join(' ')
        .trim();

const hasMeaningfulTranscriptText = (text: string): boolean => {
    const normalized = text
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return false;
    if (NATIVE_NOISE_TRANSCRIPTS.has(normalized)) return false;
    return normalized.split(' ').filter(Boolean).length >= 2;
};

type ObjectiveBriefSnapshot = {
    projectId: string;
    briefId: string;
    points?: string[];
    topic?: string;
    paceGuideSecPerPoint?: number | null;
};

type RecordingProgressMode =
    | { mode: 'open_mic' }
    | { mode: 'focus_points'; brief: ObjectiveBriefSnapshot }
    | { mode: 'unknown' };

type ProgressCompletionContext =
    | { mode: 'open_mic' }
    | {
        mode: 'focus_points';
        brief: ObjectiveBriefSnapshot;
        segments: { text: string; startSec: number }[];
        durationSeconds: number;
    }
    | { mode: 'unknown' };

type RichMetricsPayload = Parameters<typeof updateSession>[1];
type ProgressMetricsState = {
    /** Exact immutable payload calculated for this recording, or null when recovery cannot prove it. */
    payload: RichMetricsPayload | null;
    /** Actual result of the rich-metrics write. Never inferred from transcript completion or attribution. */
    persisted: boolean;
};

const normalizeTranscriptPrefix = (text: string): string =>
    text
        .toLowerCase()
        .replace(/[^\w\s']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const hasProviderFullTranscriptPrefix = (currentTranscript: string, finalTranscript: string): boolean => {
    const normalizedCurrent = normalizeTranscriptPrefix(currentTranscript);
    const normalizedFinal = normalizeTranscriptPrefix(finalTranscript);
    return Boolean(normalizedCurrent && normalizedFinal.startsWith(normalizedCurrent));
};

const TERMINAL_PUNCTUATION_RE = /[.!?]["')\]]?$/;

const sentenceCaseStart = (text: string): string => {
    const firstLetterIndex = text.search(/[A-Za-z]/);
    if (firstLetterIndex === -1) return text;
    return `${text.slice(0, firstLetterIndex)}${text.charAt(firstLetterIndex).toUpperCase()}${text.slice(firstLetterIndex + 1)}`;
};

const normalizeStandaloneFirstPerson = (text: string): string =>
    text.replace(/\bi\b/g, 'I');

const addConservativeCommas = (text: string): string =>
    text
        .replace(/^(Today|First|Next|Finally|However|Meanwhile|Overall|Eventually)\s+/i, '$1, ')
        .replace(/^(For example|For instance|In short|Most importantly|By the way)\s+/i, '$1, ');

const ensureTerminalPunctuation = (text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) return trimmed;
    const sentenceCased = addConservativeCommas(normalizeStandaloneFirstPerson(sentenceCaseStart(trimmed)));
    if (TERMINAL_PUNCTUATION_RE.test(sentenceCased)) return sentenceCased;
    if (/[,:;]$/.test(sentenceCased)) return `${sentenceCased.slice(0, -1)}.`;
    return `${sentenceCased}.`;
};

const appendFinalTranscriptText = (currentTranscript: string, finalTranscript: string): string => {
    const finalWithPunctuation = ensureTerminalPunctuation(finalTranscript);
    if (!currentTranscript.trim()) return finalWithPunctuation;
    return `${ensureTerminalPunctuation(currentTranscript)} ${finalWithPunctuation}`;
};

const createControllerOwnedServiceCallbacks = (
    callbacks: Partial<TranscriptionServiceOptions>,
    handlers: Required<Pick<
        TranscriptionServiceOptions,
        | 'onTranscriptUpdate'
        | 'onModelLoadProgress'
        | 'onReady'
        | 'onAudioData'
        | 'onModeChange'
        | 'onStatusChange'
        | 'onError'
    >> & Pick<TranscriptionServiceOptions, 'onHistoryUpdate' | 'onCaptureLimitReached'>
): Partial<TranscriptionServiceOptions> => ({
    ...callbacks,
    onTranscriptUpdate: handlers.onTranscriptUpdate,
    onHistoryUpdate: handlers.onHistoryUpdate,
    onError: handlers.onError,
    onStatusChange: handlers.onStatusChange,
    onCaptureLimitReached: handlers.onCaptureLimitReached,
    onModelLoadProgress: handlers.onModelLoadProgress,
    onReady: handlers.onReady,
    onAudioData: handlers.onAudioData,
    onModeChange: handlers.onModeChange,
});

const NATIVE_NOISE_TRANSCRIPTS = new Set([
    'stop',
    'start',
    'test',
    'testing',
    'hello',
    'the',
    'on the',
]);

export type RuntimeState =
    | 'IDLE'
    | 'INITIATING'
    | 'ENGINE_INITIALIZING'
    | 'DOWNLOAD_REQUIRED'
    | 'READY'
    | 'RECORDING'
    | 'STOPPING'
    | 'FAILED'
    | 'FAILED_VISIBLE'
    | 'TERMINATED';

export interface LifecycleToken {
    version: number;
    cancelled: boolean;
}

type TranscriptLifecycleSource =
    | 'service_result'
    | 'committed_final'
    | 'visible_snapshot'
    | 'best_meaningful_partial'
    | 'store_visible_snapshot'
    | 'empty';

interface TranscriptLifecycleState {
    committedFinal: string;
    currentPartial: string;
    bestMeaningfulPartial: string;
    visibleTranscript: string;
    lastVisibleTranscriptAtStop: string | null;
    selectedTranscriptForSave: string | null;
    selectedTranscriptSource: TranscriptLifecycleSource | null;
}

const createEmptyTranscriptLifecycleState = (): TranscriptLifecycleState => ({
    committedFinal: '',
    currentPartial: '',
    bestMeaningfulPartial: '',
    visibleTranscript: '',
    lastVisibleTranscriptAtStop: null,
    selectedTranscriptForSave: null,
    selectedTranscriptSource: null,
});

/**
 * LIFECYCLE CONTRACT (v2 — Emission Control)
 * Any async work via enqueue() may be aborted if lifecycleVersion changes.
 * No side-effects are guaranteed after cancellation.
 * Tests must use whenStable() — never vi.waitFor() for side-effects.
 * @see LifecycleToken
 */
/**
 * #1089: post-Stop finalization exceeded PRIV_STT.FINALIZE_HARD_TIMEOUT_MS. Distinct from a decode
 * ERROR: the engine never answered at all, so the failure is a hang, and the user-facing recovery
 * copy differs. Routed through the normal stop-error path so it reuses the existing FAILED +
 * recovery-draft architecture rather than inventing a second one.
 */
export class FinalizationTimeoutError extends Error {
    readonly timeoutMs: number;
    constructor(timeoutMs: number) {
        super(`Finalization exceeded ${timeoutMs}ms`);
        this.name = 'FinalizationTimeoutError';
        this.timeoutMs = timeoutMs;
    }
}

/**
 * #1161 runtime evidence posted to the trusted server producer (attest-session-engine). Advisory input only —
 * the server re-validates it and is the sole writer of the attribution authority. `provider` selects the class:
 * `transformers-js[-v4]` → Private, `web-speech` → Browser.
 */
export interface RuntimeEvidence {
    provider: string;
    engine: string;
    engine_version?: string;
    model_id?: string;
    resolved_device?: string;
    fallback_occurred: boolean;
    cloud_used: boolean;
}

export class SpeechRuntimeController {
    private static instance: SpeechRuntimeController | null = null;
    private readonly HEARTBEAT_THRESHOLD_MS =
        import.meta.env.VITE_E2E_MODE ? 60000 : 30000;
    private lifecycleVersion: number = 0;
    // Monotonic stop counter. The finalized-analysis signal (toast/cue/settled copy) is published only
    // at the TERMINAL of a stop (persist → reconcile → native formatter complete/failed → final display).
    // A newer stop bumps this so a stale async formatter result can never publish over a newer session.
    private finalizeSequence: number = 0;
    private state: RuntimeState = 'IDLE';
    private initialized: boolean = false;
    public service: TranscriptionService | null = null;
    private serviceUnsubscribe: (() => void) | null = null;
    private commandQueue: Promise<void> = Promise.resolve();
    private activeTasks: Set<LifecycleToken> = new Set();
    private sessionId: string | null = null;
    /** #891 Phase 5.6: shadow MetricsEngine (dev/test only; null in production). */
    private shadowEngine: MetricsEngine | null = null;
    /** #891 Phase 5.8 precursor: live filler counts snapshotted at STOP-entry, before finalize corrects the store. */
    private liveFillerDataAtStop: FillerCounts | null = null;
    /** #891 Phase 5.8 precursor: filler divergence computed at finalization (over the selected save transcript), cached so it survives shadow-engine disposal. */
    private lastFillerDivergenceReport: FillerDivergenceReport | null = null;
    /** #891 Phase 5.8 Step 1: sanitized numbers-only artifact for the owner known-script take (custom words anonymized, no transcript text). */
    private lastFillerArtifact: SanitizedFillerArtifact | null = null;
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_PERIOD_MS = STT_CONFIG.HEARTBEAT_TIMEOUT_MS;
    private readonly MAX_HEARTBEAT_FAILURES = 3;

    // Cancellation tracking for startRecording
    private currentRecordingId: string | null = null;
    private capturedUserId: string | null = null;

    // Session Lock (Tab Mutex)
    private lock: DistributedLock;
    private watchdogInterval: NodeJS.Timeout | null = null;
    private watchdogVersion = 0;
    private heartbeatVersion = 0;
    private idleTimeout: NodeJS.Timeout | null = null;
    private readonly IDLE_RECLAMATION_MS = 5 * 60 * 1000;
    // #1258: monotonically increments ONLY when an actual idle reclamation tears the engine down. Consumers
    // (the foreground-return reload) key their one-shot reload off a CHANGE in this token, so a tab switch or a
    // generic IDLE state never triggers a reload — only a real reclamation does.
    private idleReclamationGeneration = 0;
    private readonly WATCHDOG_PERIOD_MS = 5000;

    private readonly FAILURE_HOLD_DURATION_MS = STT_CONFIG.FAILURE_HOLD_DURATION_MS;
    private readonly VISIBLE_HOLD_DURATION_MS = STT_CONFIG.VISIBLE_HOLD_DURATION_MS;

    private readyPromise: Promise<void> | null = null;
    private warmUpRequestId = 0;

    // FSM Invariants
    private isEngineReady: boolean = false;
    private lockWatchdogInterval: NodeJS.Timeout | null = null;
    private isSubscriberReady: boolean = false;
    private isEmissionsSafe: boolean = false;
    private transcriptEmissionSequence = 0;
    private transcriptLifecycle: TranscriptLifecycleState = createEmptyTranscriptLifecycleState();
    // Authoritative save-candidate decision from the last Stop (debug-only; surfaced
    // via window.__SPEECH_RUNTIME_DEBUG__().saveCandidate so proofs read ground truth
    // instead of scraping status/placeholder banners out of the transcript DOM).
    private lastSaveCandidateDebug: Record<string, unknown> | null = null;

    // Segmented Emission Queue
    private emissionQueue: TranscriptUpdate[] = [];
    private historyQueue: HistorySegment[][] = [];
    private subscriberCallbacks: Partial<TranscriptionServiceOptions> = {};
    private readonly serviceCallbacks: Partial<TranscriptionServiceOptions>;
    private policy: TranscriptionPolicy | null = null;
    private userWords: string[] = [];

    // Runtime rehydration fields (Fix 2)
    private navigate?: NavigateFunction;
    private session: Session | null = null;
    private getAssemblyAIToken?: () => Promise<string | null>;

    private constructor() {
        this.lock = new DistributedLock();

        // Authoritative Signal Reset
        syncSTTReady(false);

        this.serviceCallbacks = {
            onTranscriptUpdate: this.handleTranscriptUpdate.bind(this),
            onStatusChange: this.handleStatusChange.bind(this),
            // #1089: the engine hit its hard capture backstop and has stopped accepting audio. Publish it
            // so the session layer performs a CONTROLLED stop (preserving + finalizing everything captured
            // before the guard) instead of the old behaviour: silently discarding audio while the UI still
            // said "Recording". Durations only — no transcript, no audio, no identity.
            onCaptureLimitReached: (info) => {
                logger.warn(info, '[Controller] ⚠️ Capture backstop reached — stopping and finalizing');
                useSessionStore.getState().setCaptureLimitReached(info);
            },
            onModelLoadProgress: this.handleModelLoadProgress.bind(this),
            onReady: this.handleReady.bind(this),
            onHistoryUpdate: this.handleHistoryUpdate.bind(this),
            onModeChange: this.handleModeChange.bind(this),
            onAudioData: this.handleAudioData.bind(this),
            onError: this.handleError.bind(this),
        };

        // E2E HOOK: Sanctioned Mocks
        if (typeof window !== 'undefined') {
            window.STTEngine = STTEngine;
            window.Result = Result;
            window.__TRANSCRIPTION_SERVICE__ = this;
            window.__SpeechRuntimeController__ = SpeechRuntimeController;
            window.__SPEECH_RUNTIME_DEBUG__ = () => ({
                controllerState: this.state,
                policy: this.policy,
                controllerPreferredMode: this.policy?.preferredMode ?? null,
                serviceMode: this.service?.getMode?.() ?? null,
                serviceState: this.service?.getState?.() ?? null,
                sessionId: this.sessionId,
                lifecycleVersion: this.lifecycleVersion,
                transcriptLength: this.getStoreTranscriptLength(),
                // Authoritative save-candidate decision from the last Stop, so proofs
                // can distinguish a real empty save from DOM-banner extraction noise.
                saveCandidate: this.lastSaveCandidateDebug,
                // #1306 P1: diagnostics expose only the LENGTH — NEVER the transcript text. Test/E2E/real-device
                // artifacts are inside the privacy boundary too, so this is unconditional (no ENV.isTest escape).
                selectedTranscriptForSaveLength: (this.transcriptLifecycle.selectedTranscriptForSave ?? '').length,
                selectedTranscriptSource: this.transcriptLifecycle.selectedTranscriptSource ?? null,
                // #891 Phase 5.8 Step 1: DEV/TEST-ONLY numbers-only filler artifact for the known-script take.
                // The getter self-gates (null in production); custom words anonymized; no transcript text.
                ...(isShadowMetricsEngineEnabled() ? { fillerDivergence: this.getSanitizedFillerArtifact() } : {}),
            });

            // STT-EVIDENCE-SCHEMA step 2: read-only proof accessor. window.__STT_EVIDENCE__(overrides?)
            // aggregates the existing diagnostic globals into the normalized SttEvidence schema
            // (PASS/FAIL/INVALID/BLOCKED). Diagnostic only — never gates product behavior.
            installSttEvidenceCollector(window);
            // STT-IDENTITY-DIAG: read-only window.__STT_IDENTITY__() — consolidated engine/model
            // identity for the dev/test badge + proof artifacts (also folded into __STT_EVIDENCE__().identity).
            installSttIdentityAccessor(window);

            // Fix 1 Correction: Programmatic Mode Switch — TEST-ONLY write hook. It MUST NOT ship to the
            // production bundle: the mock-free production proof (#1151) rejects any __E2E_/__MOCK_ injection
            // surface, and a mode setter in prod is an engine-hierarchy nudge vector. ENV.isTest is false in
            // the real production build (import.meta.env.MODE === 'production') and true in unit/e2e, so the
            // read-only proof accessors above stay while this writer is gated out of production.
            if (ENV.isTest) {
                (window as unknown as Record<string, unknown>).__E2E_SET_MODE__ = (mode: TranscriptionMode) => {
                    this.updatePolicy({ ...this.policy!, preferredMode: mode });
                };
            }
        }
    }

    /**
     * ✅ Authoritative Reset Hook for E2E Tests
     * Purges the singleton instance and all internal execution state.
     */
    public static __resetForTests(): void {
        if (SpeechRuntimeController.instance) {
            SpeechRuntimeController.instance.fullReset();
            SpeechRuntimeController.instance = null;
        }
    }

    /**
     * Exhaustive State Purge:
     * Clears engine, strategy, and readiness bits to prevent state leakage.
     */
    public fullReset(): void {
        this.reset();
        syncNegotiatorDecision('none', false);
        this.setEngineReady(false);
        useSessionStore.getState().setRuntimeState('IDLE');
        this.updateSessionPersisted(false);
        syncProfileReady(false);
    }

    /**
     * Singleton instance accessor with global stabilization (v0.6.4).
     * Ensures only one controller instance exists in the runtime context.
     */
    public static getInstance(): SpeechRuntimeController {
        if (!SpeechRuntimeController.instance) {
            SpeechRuntimeController.instance = new SpeechRuntimeController();
        }
        return SpeechRuntimeController.instance;
    }

    /**
     * Internal store accessor for state management and testing.
     */
    public getStore() {
        return useSessionStore;
    }

    /** Active DB session id (null when no session is persisted). */
    public getSessionId(): string | null {
        return this.sessionId;
    }

    /** Resolved transcription engine type of the active service strategy, or null. */
    public getResolvedEngineType(): string | null {
        return this.service?.getEngineType?.() ?? null;
    }

    /**
     * Set content-free Private engine telemetry context and capture the durable engine version.
     */
    public applyPrivateTelemetryContext(): void {
        try {
            const flags = getV4FlagState();
            const assignment = resolvePrivateAssignment({
                resolvedEngineType: this.getResolvedEngineType(),
                overrideActive: isPrivateEngineOverrideActive(),
                allowlisted: flags.allowlisted,
                rolloutEnabled: flags.v4Enabled,
            });
            const meta = this.service?.getMetadata?.();
            // Fall back to the variant's default model id if metadata hasn't surfaced one yet, so
            // the durable engine_version is always private_v2:<model> / private_v4:<model>.
            const model = meta?.modelName ?? (assignment.engine_variant === 'private_v4' ? 'base_q4' : 'whisper-base.en');
            const release = typeof window !== 'undefined' ? (window.__APP_RELEASE__ ?? null) : null;
            setPrivateTelemetryContext({
                session_id: this.sessionId,
                engine_variant: assignment.engine_variant,
                assignment_source: assignment.assignment_source,
                posthog_flag_key: assignment.posthog_flag_key,
                posthog_flag_value: assignment.posthog_flag_value,
                model,
                release_sha: release,
            });
            // Capture the resolved arm now (engine is resolved here) for durable persistence at
            // stop — independent of the telemetry context's clear timing.
            this.resolvedPrivateEngineVersion = buildEngineVersion(assignment.engine_variant, model);
            this.resolvedPrivateEngineSessionId = this.sessionId; // scope the arm to THIS recording (#1033)
        } catch {
            /* telemetry context must never break the recording pipeline */
        }
    }

    // Private setup telemetry, driven by the engine status stream so it fires regardless
    // of how the model load was triggered (warmUp / auto-init on mode select / explicit download).
    private privateSetupStartedAt: number | null = null;
    private privateSetupResolved = false;
    /** Resolved Private arm (private_v2:<model> / private_v4:<model>), captured at engine-resolve
     *  for durable persistence to sessions.engine_version at stop. */
    private resolvedPrivateEngineVersion: string | null = null;
    /** The recording/session the resolved Private arm belongs to, so it can never verify a different recording. */
    private resolvedPrivateEngineSessionId: string | null = null;
    /** #1033: last recording whose durable attribution write failed — stashed so Retry Save can promote it
     *  pending→verified via UPDATE (never a duplicate session). Null when nothing is awaiting retry. */
    private pendingAttributionRetry: {
        sessionId: string;
        evidence: RuntimeEvidence | null;
        progressContext: ProgressCompletionContext;
        progressMetrics: ProgressMetricsState;
    } | null = null;
    /** #1033 (item 2/3): last recording whose durable FULL SAVE (completeSession) failed — a strictly worse
     *  failure than an attribution-only miss (the transcript row itself is not persisted). Stashed so Retry
     *  Save re-runs the ACTUAL failed op — completeSession THEN the attribution write — for the SAME session,
     *  never a duplicate. Distinct from pendingAttributionRetry so each resolution retries only what failed. */
    private pendingFullSaveRetry: {
        /** null when the session ROW DOES NOT EXIST YET (pre-session window) — see `initialSave`. */
        sessionId: string | null;
        /** #1033 (1): present when the placeholder row was never created. Retry must CREATE the row first,
         *  using this recording's idempotency identity so a retry can never produce a duplicate session. */
        initialSave?: { userId: string; recordingId: string; mode: string; engineVersion?: string; modelName?: string; deviceType?: string };
        // #1306: transcript-free. A finalized retry replays the exact content-free metrics + one next action.
        completeArgs: CompleteSessionOptions & { status: 'completed' };
        attributionEvidence: RuntimeEvidence | null;
        progressContext: ProgressCompletionContext;
        progressMetrics: ProgressMetricsState;
    } | null = null;

    /** #1265: immutable practice-mode snapshot captured when this recording enters RECORDING. Retry paths
     *  must never infer mode from a later live store or default missing context to Open Mic. */
    private recordingProgressMode: RecordingProgressMode = { mode: 'unknown' };

    /** #1033 (1): owner + idempotency identity for the window between RECORDING and the initial save. Set
     *  once the authenticated owner is known (before speech), cleared once the row exists or at resolution.
     *  #1161 (finding 6): also carries the engine provenance so an initial-save retry recreates identical rows. */
    private pendingInitialSaveContext: { userId: string; recordingId: string; mode: string; engineVersion?: string; modelName?: string; deviceType?: string } | null = null;

    /** #1033 (5): a producer-affecting policy change (entitlement/profile sync) that arrived while the engine
     *  was locked. It is NOT applied to the live recording; it is queued and applied at the next recording's
     *  start boundary, so entitlement changes are never lost and never swap the in-flight producer. */
    private queuedProducerPolicy: TranscriptionPolicy | null = null;

    /** #1033 (3): in-flight transactional application of `queuedProducerPolicy` (awaitable — the service is
     *  the authority on whether the new policy actually took effect). */
    private queuedPolicyApplication: Promise<void> | null = null;

    /** #1033 (4): the IMMUTABLE producing engine for the in-flight recording, latched the moment the service
     *  confirms it reached RECORDING. While set, no service callback may report a different mode, and final
     *  attribution must match it. Cleared only on durable save, confirmed discard, or a new recording's start
     *  boundary (a PRE-start failure never latches, so it needs no clearing). */
    private recordingEngineMode: TranscriptionMode | null = null;

    /** #1033 (2): set when the service reported an engine different from the latch — the transcript may mix
     *  producers, so this recording can NEVER be marked `verified`. Cleared at the recording boundary. */
    private producerIntegrityCompromised = false;

    /** #1033 (2): in-flight producer-integrity teardown, so duplicate/stale callbacks chain onto the same
     *  teardown rather than starting a second one (and so it can be awaited deterministically). */
    private producerIntegrityTeardown: Promise<void> | null = null;

    /** Recording-lifecycle states during which the STT engine selection is locked (one engine per recording). */
    private static readonly RECORDING_LIFECYCLE_STATES: ReadonlySet<RuntimeState> = new Set<RuntimeState>(['INITIATING', 'ENGINE_INITIALIZING', 'RECORDING', 'STOPPING']);
    /** #1033: set SYNCHRONOUSLY the instant Start is invoked (before the enqueued work reaches INITIATING),
     *  so the lock cannot lose a race to a rapid engine change right after Start. Released by transition()
     *  once a real state (INITIATING/…/terminal) is reached, where the lifecycle/pending predicates take over. */
    private engineSelectionIntentLocked = false;
    /** #1033: TRUE once a recording has actually BEGUN (transition to RECORDING) and has NOT yet reached a
     *  terminal resolution — durable save + attribution success, an approved discard, or successful Retry Save.
     *  This keeps the lock through POST-START failures (heartbeat/STT/runtime/stop/finalization/attribution),
     *  which land in non-locked states (FAILED/FAILED_VISIBLE/TERMINATED/READY/IDLE). A PRE-recording failure
     *  never sets it, so it correctly unlocks. Preserves the transcript/recovery-draft window. */
    private recordingStartedUnresolved = false;
    /** #1033: engine selection is locked while (a) Start intent, (b) the recording lifecycle, (c) a pending
     *  attribution retry, OR (d) a started recording has not yet durably resolved (post-start failure window).
     *  THE single authoritative predicate — consumed by the UI selector AND enforced in the controller. */
    public isEngineSelectionLocked(): boolean {
        return this.engineSelectionIntentLocked
            || SpeechRuntimeController.RECORDING_LIFECYCLE_STATES.has(this.state)
            || this.pendingAttributionRetry !== null
            || this.pendingFullSaveRetry !== null
            || this.recordingStartedUnresolved;
    }
    /** #1033: true while a completed recording's attribution write OR full save is awaiting Retry Save. */
    public hasPendingAttribution(): boolean {
        return this.pendingAttributionRetry !== null || this.pendingFullSaveRetry !== null;
    }
    /** #1033 (item 2): what the current Retry Save would re-attempt — the ACTUAL failed op, or none. A full
     *  save failure outranks an attribution failure (it is the more severe, less-persisted state). */
    public pendingResolutionKind(): 'initial_save' | 'full_save' | 'attribution' | null {
        if (this.pendingFullSaveRetry) {
            return this.pendingFullSaveRetry.initialSave && !this.pendingFullSaveRetry.sessionId
                ? 'initial_save'
                : 'full_save';
        }
        if (this.pendingAttributionRetry) return 'attribution';
        return null;
    }

    /**
     * #1033 Retry Save — re-attempt the durable attribution write for the last recording whose write
     * failed. Updates the SAME row by session id (never creates a duplicate session). On success the row
     * moves pending→verified/unverified; on failure it stays pending and remains retryable. Idempotent
     * (returns true when nothing is pending).
     */
    public async retryPendingAttribution(): Promise<boolean> {
        const pending = this.pendingAttributionRetry;
        if (!pending) return true;
        const targetSessionId = pending.sessionId;
        try {
            // #1161: re-post evidence to the trusted server producer. null = transient failure → stay retryable.
            const res = await this.attestSessionEngine(pending.sessionId, pending.evidence);
            if (res === null) return false;
            // compare-and-clear: clear ONLY if the slot still holds the session we just promoted — if it
            // changed to another session while the update was in flight, leave that one intact (#1033).
            if (this.pendingAttributionRetry?.sessionId === targetSessionId) {
                this.pendingAttributionRetry = null;
                this.markRecordingResolved(); // Retry Save succeeded → recording fully resolved → unlock
            }
            await this.completeProgressForRecording(
                pending.progressContext ?? { mode: 'unknown' },
                targetSessionId,
                res.attributed ? ATTRIBUTION_STATUS.VERIFIED : ATTRIBUTION_STATUS.UNVERIFIED,
                pending.progressMetrics?.persisted ?? false,
            );
            return true;
        } catch {
            return false;
        }
    }

    /**
     * #1033 (item 2/3) unified Retry Save — re-runs the ACTUAL failed op for the last unresolved recording:
     *  - a FULL-SAVE failure re-runs completeSession THEN the attribution write (the transcript row was never
     *    persisted); only when BOTH succeed is the recording resolved and the lock released.
     *  - an ATTRIBUTION-only failure re-runs just the attribution write (transcript already persisted).
     * Same session id throughout (never a duplicate). Idempotent: returns true when nothing is pending.
     * Session-safe compare-and-clear: only clears the slot it actually resolved.
     */
    public async retryRecordingSave(): Promise<boolean> {
        const fullSave = this.pendingFullSaveRetry;
        if (fullSave) {
            let targetSessionId = fullSave.sessionId;
            try {
                // #1033 (1): INITIAL SAVE — the row never existed (failure landed between RECORDING and the
                // placeholder save). Create it with THIS recording's idempotency key so a retry can never
                // create a duplicate, then complete it and write the (unverified) attribution.
                if (!targetSessionId) {
                    const ctx = fullSave.initialSave;
                    if (!ctx) return false; // no owner/identity → cannot safely persist; stay retryable
                    const created = await saveSession(
                        {
                            user_id: ctx.userId,
                            title: `Session ${new Date().toISOString()}`,
                            duration: 0,
                            total_words: 0,
                            engine: ctx.mode,
                        },
                        { id: ctx.userId } as UserProfile,
                        ctx.mode as TranscriptionMode,
                        ctx.recordingId, // idempotency identity — same recording, never a duplicate row
                        // #1161 (finding 6): carry the SAME engine provenance so the recovered row is not
                        // recreated with a blank engine identity.
                        { engineVersion: ctx.engineVersion, modelName: ctx.modelName, deviceType: ctx.deviceType },
                    );
                    const createdId = created?.session?.id;
                    if (!createdId) return false; // still retryable; nothing destroyed
                    targetSessionId = createdId;
                    // Adopt the row so a subsequent retry resumes as a normal full-save.
                    if (this.pendingFullSaveRetry === fullSave) {
                        this.pendingFullSaveRetry = { ...fullSave, sessionId: createdId };
                    }
                    if (!this.sessionId) this.sessionId = createdId;
                    this.applyPrivateTelemetryContext();
                }
                const completion = await completeSession(targetSessionId, fullSave.completeArgs);
                if (!completion?.success) return false;
                // #1161: attribution via the trusted server producer. null = transient → stay retryable.
                const attrRes = await this.attestSessionEngine(targetSessionId, fullSave.attributionEvidence);
                if (attrRes === null) return false;
                // #1306 Step 3: the retry's separate metrics PATCH is REMOVED for the same reason as the
                // normal path — v2 wrote every retained metric in the SAME transaction as the transcript and
                // retention, so its acceptance above already proves they landed. #1265's concern (a completed
                // recording with no Progress evaluation) is now structurally impossible rather than repaired
                // by a second write: there is no state where completion succeeded but metrics did not.
                // The retry replays fullSave.completeArgs UNCHANGED, so the same immutable payload — including
                // the same transcript — is sent; a divergent payload conflicts server-side rather than writing.
                const metricsPersisted = true;
                // Full save + attribution both durable → recording resolved. Compare-and-clear (the slot may
                // have been re-pointed to another session mid-flight, though the single-unresolved invariant
                // makes that near-impossible); never clear a different session's unresolved work.
                if (this.pendingFullSaveRetry?.sessionId === targetSessionId) {
                    this.pendingFullSaveRetry = null;
                    if (this.pendingAttributionRetry?.sessionId === targetSessionId) this.pendingAttributionRetry = null;
                    this.markRecordingResolved();
                    await this.completeProgressForRecording(
                        fullSave.progressContext ?? { mode: 'unknown' },
                        targetSessionId,
                        attrRes.attributed ? ATTRIBUTION_STATUS.VERIFIED : ATTRIBUTION_STATUS.UNVERIFIED,
                        metricsPersisted,
                    );
                }
                return true;
            } catch {
                return false;
            }
        }
        // No full-save failure outstanding → fall back to the attribution-only retry.
        return this.retryPendingAttribution();
    }

    /**
     * #1033 (B) — INVARIANT enforcer. Whenever a recording that BEGAN becomes unresolved via a post-start
     * failure (heartbeat / engine death / runtime error / a stop that failed before completeSession) WITHOUT
     * a specific retry op already stashed, guarantee an actionable resolution so the user is never locked with
     * no recovery route:
     *  - recoverable unsaved transcript (durable recovery draft for this session, or the live store) → stash a
     *    FULL-SAVE retry (the durable save never happened). Identity can't be verified after a mid-recording
     *    failure, so attribution is 'unverified' — honest, never fabricated.
     *  - nothing recoverable to save → the recording is resolved by discard → unlock.
     * Post-condition (asserted by tests): recordingStartedUnresolved ⟹ pendingResolutionKind() !== null.
     */
    /**
     * #1033 (4) — the single place a recording becomes RESOLVED: durably saved, successfully retried, or
     * explicitly discarded. Releases the post-start lock AND the immutable producer latch together, so the
     * latch can never outlive its recording (and a stale latch can never reject the next recording's engine).
     */
    /**
     * #1033 (3) — the ONE valid next engine under a policy. The requested `preferredMode` wins only if that
     * engine is still allowed by the policy; otherwise fall back to an allowed engine. A stale UI selection
     * (e.g. Cloud/Private chosen before entitlement was revoked) can never override a newly restricted policy.
     */
    private resolveEntitledMode(p: TranscriptionPolicy): TranscriptionMode {
        // #1320: mode admissibility is decided ONLY by the authoritative policy helper (private→allowPrivate,
        // mock→always, everything else→false). `allowNative` is inert and MUST NOT influence selection — the
        // old ad-hoc `m === 'private' ? allowPrivate : allowNative` let allowNative gate mock and even a stale
        // native preference; a controller-boundary guard test locks this.
        if (p.preferredMode && isModeAllowed(p.preferredMode, p)) return p.preferredMode;
        // Private is the only customer engine — the fallback chain no longer includes Native/Web-Speech.
        const fallback: TranscriptionMode[] = ['private'];
        return fallback.find((m) => isModeAllowed(m, p)) ?? 'private';
    }

    /**
     * #1033 (3) — apply the queued producer policy as a TRANSACTIONAL state transition across the session
     * store, the controller policy, and the SERVICE. The previous coherent state is captured first; the
     * service's `updatePolicy` is **awaited** (it is the authority — a synchronous controller assignment
     * proves nothing). The queue is cleared ONLY after the service confirms. On failure the prior coherent
     * state is restored, the queue is retained for retry, and a retryable configuration error is surfaced —
     * so store / controller / service / queue can never disagree.
     */
    private async applyQueuedProducerPolicy(): Promise<void> {
        const queued = this.queuedProducerPolicy;
        if (!queued) return;
        const store = useSessionStore.getState();
        const prevPolicy = this.policy;
        const prevMode = store.sttMode;
        // ONE valid next mode: a stale Cloud/Private selection cannot survive a revoked entitlement.
        const nextMode = this.resolveEntitledMode(queued);
        const coherent: TranscriptionPolicy = { ...queued, preferredMode: nextMode };
        try {
            store.setSTTMode(nextMode);
            this.policy = coherent;
            if (this.service) {
                // Route through the command queue so this lands AFTER any service policy write already
                // enqueued by an earlier updatePolicy — otherwise a stale in-flight policy could resolve
                // last and leave the service configured for the engine we just replaced.
                await this.enqueue(async (token) => {
                    if (token.cancelled || token.version !== this.lifecycleVersion) return;
                    const svc = this.service;
                    if (!svc) return;
                    await svc.updatePolicy(coherent); // the SERVICE confirms, or this throws
                });
            }
            this.queuedProducerPolicy = null; // cleared only on confirmed application
            logger.info({ nextMode }, '[controller] queued producer policy applied + confirmed by service (#1033 3)');
        } catch (e) {
            // Roll back to the previous coherent state and KEEP the queue so it can be retried.
            this.policy = prevPolicy;
            useSessionStore.getState().setSTTMode(prevMode);
            this.queuedProducerPolicy = queued;
            logger.error({ e, nextMode }, '[controller] queued producer policy REJECTED by service — restored prior state, queue retained (#1033 3)');
            useSessionStore.getState().setSTTStatus({
                type: 'error',
                message: 'Could not update your transcription settings.',
                detail: 'Your previous transcription method is still in effect. Please try again.',
            });
        }
    }

    private snapshotProgressModeAtRecordingBoundary(): RecordingProgressMode {
        const brief = useSessionStore.getState().activeObjectiveBrief;
        if (!brief) return { mode: 'open_mic' };
        return {
            mode: 'focus_points',
            brief: {
                ...brief,
                ...(brief.points ? { points: [...brief.points] } : {}),
            },
        };
    }

    private buildProgressCompletionContext(durationSeconds?: number): ProgressCompletionContext {
        if (this.recordingProgressMode.mode !== 'focus_points') return this.recordingProgressMode;
        const store = useSessionStore.getState();
        return {
            mode: 'focus_points',
            brief: this.recordingProgressMode.brief,
            segments: store.chunks
                .filter((chunk) => chunk.isFinal)
                .map((chunk) => ({ text: chunk.transcript, startSec: chunk.timestamp })),
            durationSeconds: durationSeconds ?? store.completedSessionDurationSeconds ?? 0,
        };
    }

    private markRecordingResolved(): void {
        this.recordingStartedUnresolved = false;
        this.recordingEngineMode = null;
        this.pendingInitialSaveContext = null;
        // #1033 Part-2b: republish so SessionPage's banner disappears + the selector unlocks after a
        // successful retry/discard resolves the recording (no FSM transition fires here otherwise).
        this.publishLockState();
        // #1033 (5): a producer-affecting policy change (e.g. an entitlement/profile sync) that was rejected
        // while locked is applied NOW, at the resolution boundary — the change is never lost, and it never
        // touched the recording that was in flight. Applied only once the lock has actually released.
        if (this.queuedProducerPolicy && !this.isEngineSelectionLocked()) {
            this.queuedPolicyApplication = this.applyQueuedProducerPolicy();
        }
    }

    private ensurePostStartFailureIsActionable(): void {
        if (!this.recordingStartedUnresolved) return;
        if (this.pendingFullSaveRetry || this.pendingAttributionRetry) return; // a specific retry already exists

        // #1033 (2): resolve recovery ONLY by the CURRENT session id + the authenticated owner. Never read
        // the unscoped global draft — without both identities we could otherwise consume a stale draft that
        // belongs to a different account. Missing identity fails CLOSED: no foreign draft is ever loaded.
        const sessionId = this.sessionId;
        const userId = this.capturedUserId;
        const ownedDraft = sessionId && userId ? getRecoverableDraftForUser(userId) : null;
        const draftForThisSession = ownedDraft && ownedDraft.sessionId === sessionId ? ownedDraft : null;

        // #1306: ONLY a FINALIZED draft (exact final metrics + the next action already derived at a clean stop)
        // can complete on retry. A post-start failure with only live/partial state must NEVER be turned into a
        // completed session from fabricated metrics — it resolves by discard instead.
        if (draftForThisSession?.recoveryState === 'finalized_pending_save' && (sessionId || this.pendingInitialSaveContext)) {
            const dur = Math.round(draftForThisSession.durationSeconds || 0);
            const initialSave = sessionId ? undefined : (this.pendingInitialSaveContext ?? undefined);
            this.pendingFullSaveRetry = {
                sessionId,
                ...(initialSave ? { initialSave } : {}),
                completeArgs: {
                    status: 'completed',
                    duration: dur,
                    nextActionSignal: draftForThisSession.nextActionSignal ?? null,
                    metrics: {
                        totalWords: draftForThisSession.metrics.totalWords ?? null,
                        clarityScore: draftForThisSession.metrics.clarityScore ?? null,
                        wpm: draftForThisSession.metrics.wpm ?? null,
                        fillerCounts: draftForThisSession.metrics.fillerCounts ?? null,
                        pauseMetrics: draftForThisSession.metrics.pauseMetrics ?? null,
                    },
                },
                attributionEvidence: null,  // #1161: mid-recording failure has no trusted identity → no authority
                progressContext: this.buildProgressCompletionContext(dur),
                progressMetrics: { payload: null, persisted: false },
            };
            logger.warn({ sessionId, kind: this.pendingResolutionKind(), state: this.state }, '[controller] post-start failure with a FINALIZED draft → save retry armed (#1306/#1033 1/B)');
            this.publishLockState();
            return;
        }
        // No finalized metrics to save (only partial/interrupted state) → resolve by discard; never fabricate a
        // completion. The interrupted snapshot (if any) remains an explicitly incomplete, non-Progress record.
        this.markRecordingResolved();
        logger.info({ state: this.state, hasSession: Boolean(sessionId), hasOwner: Boolean(userId), interrupted: draftForThisSession?.recoveryState === 'active_interrupted' }, '[controller] post-start failure with no finalized work → resolved (unlocked) (#1306/#1033 B)');
    }

    /**
     * #1033 (B/6) — explicit, user-CONFIRMED discard of an unresolved recording. The UI MUST warn that unsaved
     * work will be lost before calling this.
     *
     * HONEST PERSISTENCE. Explicit discard authorizes losing the TRANSCRIPT — it does not authorize leaving the
     * database inconsistent while destroying the only recovery copy. Three distinct outcomes:
     *  - `discarded` — no database row exists (nothing to mark). Local state cleared; unlocked.
     *  - `discarded` — an existing row was successfully marked failed. Local draft cleared; unlocked.
     *  - `retryable` — an existing row could NOT be marked failed. The recovery draft is KEPT and the recording
     *    stays locked/retryable, so we never claim a clean discard over an active/pending row. The caller
     *    should surface the failure and offer retry.
     */
    public async discardUnresolvedRecording(): Promise<{ outcome: 'discarded' | 'retryable'; sessionId: string | null }> {
        const sessionId = this.pendingFullSaveRetry?.sessionId ?? this.pendingAttributionRetry?.sessionId ?? this.sessionId ?? null;

        if (sessionId) {
            let marked = false;
            try {
                const res = await completeSession(sessionId, {
                    status: 'failed',
                    reason: 'User discarded an unsaved recording after a save/attribution failure.',
                });
                marked = Boolean(res?.success);
            } catch (e) {
                logger.warn({ e, sessionId }, '[controller] discard: marking the session failed threw (#1033 6)');
                marked = false;
            }
            if (!marked) {
                // The row exists but could not be marked failed. Do NOT destroy the sole recovery copy and do
                // NOT claim success — remain locked + retryable so the state stays honest and recoverable.
                logger.error({ sessionId }, '[controller] discard NOT completed — row could not be marked failed; keeping draft + staying locked (#1033 6)');
                return { outcome: 'retryable', sessionId };
            }
            clearSessionRecoveryDraft(sessionId);
        } else {
            // No database row was ever created — there is nothing to reconcile; clear local state only.
            clearSessionRecoveryDraft();
        }

        this.pendingFullSaveRetry = null;
        this.pendingAttributionRetry = null;
        this.markRecordingResolved();
        logger.info({ sessionId, state: this.state }, '[controller] unresolved recording discarded → unlocked (#1033 B)');
        return { outcome: 'discarded', sessionId };
    }

    /**
     * #1033 (C) — same-user reload rehydration. Reads the recovery draft ONLY if it belongs to `userId`
     * (account-boundary safe — never exposes one user's unsaved work to another), and if present re-arms the
     * unresolved-recording lock + a full-save retry so the user can Retry Save or Discard after a reload.
     * Returns true when a draft for this user was rehydrated. No-op (returns false) when there is none for them.
     */
    public rehydrateUnresolvedRecording(userId: string | null | undefined): boolean {
        const draft = getRecoverableDraftForUser(userId);
        // #1306: only a FINALIZED draft can be re-armed for completion. An active_interrupted draft has no final
        // metrics and must never rehydrate into a completable save.
        if (!draft || draft.recoveryState !== 'finalized_pending_save') return false;
        this.sessionId = draft.sessionId;
        this.recordingStartedUnresolved = true;
        this.pendingFullSaveRetry = {
            sessionId: draft.sessionId,
            completeArgs: {
                status: 'completed',
                duration: Math.round(draft.durationSeconds),
                nextActionSignal: draft.nextActionSignal ?? null,
                metrics: {
                    totalWords: draft.metrics.totalWords ?? null,
                    clarityScore: draft.metrics.clarityScore ?? null,
                    wpm: draft.metrics.wpm ?? null,
                    fillerCounts: draft.metrics.fillerCounts ?? null,
                    pauseMetrics: draft.metrics.pauseMetrics ?? null,
                },
            },
            attributionEvidence: null,  // #1161: rehydrated recording has no trusted identity → no authority
            // The recovery draft carries no objective brief linkage. Missing mode context fails closed instead
            // of being guessed as Open Mic after reload.
            progressContext: { mode: 'unknown' },
            // Progress must remain unavailable rather than writing an immutable partial evaluation.
            progressMetrics: { payload: null, persisted: false },
        };
        this.publishLockState();
        logger.info({ sessionId: draft.sessionId }, '[controller] rehydrated FINALIZED unresolved recording for same user (#1306/#1033 C)');
        return true;
    }

    /** Closed allowlist of engine tokens eligible for a VERIFIED attribution. Anything else → unverified. */
    private static readonly VERIFIABLE_ENGINES: ReadonlySet<string> = new Set(['private']);

    /**
     * #1033 — Snapshot the finalizing engine's durable identity from the LIVE engine.
     * MUST be called BEFORE `service.stopTranscription()` (which can mutate/destroy engine metadata).
     * One recording = one engine (the selector is locked while recording — Part 2), so `producerMode`
     * is authoritative.
     *
     * VERIFIED requires ALL of: a known engine token (closed allowlist), real live `getMetadata()`
     * (no fabricated/default fallback), and non-blank engine_version/model_name/device_type. For Private
     * the resolved arm is used only when it belongs to THE CURRENT recording/session. Anything unconfirmable
     * — unknown engine, missing/throwing metadata, incomplete/blank tuple — yields `{ attribution_status:
     * 'unverified' }` and does NOT overwrite the placeholder identity. Never invents a token.
     */
    private captureFinalizingIdentity(
        service: { getMetadata?: () => { engineVersion?: string | null; modelName?: string | null; deviceType?: string | null } | null } | null,
        producerMode: string | null,
    ): { engine?: string; engine_version?: string; model_name?: string; device_type?: string; attribution_status: AttributionStatus } {
        const unverified = { attribution_status: ATTRIBUTION_STATUS.UNVERIFIED } as const;
        const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
        try {
            if (!producerMode || !SpeechRuntimeController.VERIFIABLE_ENGINES.has(producerMode)) return unverified;
            // #1033 (2): the service reported a second engine during this recording — the transcript may mix
            // producers, so it can NEVER be marked verified regardless of what metadata now reports.
            if (this.producerIntegrityCompromised) {
                logger.error({ sessionId: this.sessionId, producerMode }, '[controller] producer integrity compromised → unverified (#1033 2)');
                return unverified;
            }
            // #1033 (4): final attribution MUST match the engine latched when this recording started. If the
            // finalizing mode disagrees with the latch, the producer identity is not trustworthy → unverified
            // (fail closed; never attribute a recording to an engine it did not demonstrably start on).
            if (this.recordingEngineMode && producerMode !== this.recordingEngineMode) {
                logger.error({ latched: this.recordingEngineMode, producerMode, sessionId: this.sessionId }, '[controller] finalizing mode ≠ latched producer → unverified (#1033 4)');
                return unverified;
            }
            const meta = service?.getMetadata?.();
            if (!meta) return unverified; // verified requires the real engine's metadata — never guess
            const armForThisRecording = (
                producerMode === 'private'
                && nonBlank(this.resolvedPrivateEngineVersion)
                && this.resolvedPrivateEngineSessionId === this.sessionId
            ) ? this.resolvedPrivateEngineVersion : null;
            const engineVersion = armForThisRecording ?? meta.engineVersion;
            if (!nonBlank(engineVersion) || !nonBlank(meta.modelName) || !nonBlank(meta.deviceType)) return unverified;
            return {
                engine: producerMode,
                engine_version: engineVersion,
                model_name: meta.modelName,
                device_type: meta.deviceType,
                attribution_status: ATTRIBUTION_STATUS.VERIFIED,
            };
        } catch {
            return unverified;
        }
    }

    /**
     * #1161: derive the server attestation evidence from the locally-gated finalizing identity. Returns null
     * when there is NO trusted local identity to attest — an unverified identity (fail-closed local gate), or a
     * Cloud producer (no trusted local identity; the server would reject it anyway). Only the two attestable
     * classes map to a provider: Private (on-device transformers-js) and Browser (browser/OS Web Speech, which is
     * externally processed — not on-device). The server (attest-session-engine → attest_session_engine_v1)
     * re-validates and is the SOLE writer — this is advisory input, never trusted for the verdict, which records a
     * client DECLARATION, not proof of which engine executed.
     */
    private static evidenceFromIdentity(
        identity: { engine?: string; engine_version?: string; model_name?: string; device_type?: string; attribution_status: AttributionStatus },
    ): RuntimeEvidence | null {
        if (identity.attribution_status !== ATTRIBUTION_STATUS.VERIFIED || !identity.engine) return null;
        const provider = identity.engine === 'private' ? 'transformers-js'
            : null;   // retired 'native'/'cloud' (or anything else) → no trusted local identity → do not attest
        if (!provider) return null;
        return {
            provider,
            engine: identity.engine,
            engine_version: identity.engine_version,
            model_id: identity.model_name,
            resolved_device: identity.device_type,
            fallback_occurred: false,   // captureFinalizingIdentity already proved a clean, latch-matched run
            cloud_used: false,
        };
    }

    /**
     * #1161: the SOLE client entry point to the trusted server producer. The client can no longer write the
     * locked attribution columns; it posts runtime evidence (or, for a definitive no-evidence run, a resolve
     * request) and the Edge Function classifies + writes the terminal verdict. Contract:
     *  - null evidence  → DEFINITIVE no trusted local identity (Cloud / unverifiable / rehydrated). This is NOT a
     *    no-op: it posts `op:'resolve'` so the server writes the terminal `session_attribution_unattributed`
     *    marker, letting #1045 Progress + #1117 retention CONVERGE instead of deferring forever. 2xx → terminal
     *    { attributed: false }; 5xx/network → null (TRANSIENT; caller retries) — never silently pending (P1).
     *  - present evidence, 2xx → { attributed: <server verdict> } (terminal).
     *  - present evidence, 4xx (server rejected the evidence) → { attributed: false } (terminal; not retryable).
     *  - either op, 5xx / network error → null (TRANSIENT; caller stashes for Retry Save).
     */
    private async attestSessionEngine(
        sessionId: string, evidence: RuntimeEvidence | null,
    ): Promise<{ attributed: boolean } | null> {
        // Definitive no-local-evidence still reaches a SERVER terminal-unattributed resolution (P1) — only
        // network/5xx stays transient. Present evidence → the normal attest path.
        const body = evidence
            ? { sessionId, runtimeEvidence: evidence }
            : { op: 'resolve_unattributed', sessionId };
        try {
            const { data, error } = await getSupabaseClient().functions.invoke('attest-session-engine', { body });
            if (error) {
                const status = (error as { context?: { status?: number } })?.context?.status;
                // 4xx = the server definitively rejected this request → terminal, not retryable.
                if (typeof status === 'number' && status >= 400 && status < 500) return { attributed: false };
                return null;   // 5xx / network (incl. resolve's not-yet-completed 503) → transient → retryable
            }
            return { attributed: Boolean((data as { attributed?: boolean } | null)?.attributed) };
        } catch {
            return null;   // network failure → retryable
        }
    }

    private emitPrivateSetupStatus(type: string): void {
        try {
            if ((this.service?.getMode?.() ?? null) !== 'private') return;
            const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
            if (type === 'download-required' || type === 'downloading' || type === 'initializing') {
                // (re)arm a setup cycle; emit started once per cycle
                if (this.privateSetupStartedAt == null || this.privateSetupResolved) {
                    this.privateSetupStartedAt = now;
                    this.privateSetupResolved = false;
                    emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.SETUP_STARTED, { ...buildPrivateEnvProps() });
                }
            } else if (type === 'ready' && !this.privateSetupResolved) {
                this.privateSetupResolved = true;
                this.applyPrivateTelemetryContext();
                emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.SETUP_SUCCEEDED, {
                    setup_duration_ms: this.privateSetupStartedAt != null ? Math.round(now - this.privateSetupStartedAt) : null,
                    ...buildPrivateEnvProps(),
                });
            } else if (type === 'error' && !this.privateSetupResolved && this.privateSetupStartedAt != null) {
                this.privateSetupResolved = true;
                this.applyPrivateTelemetryContext();
                emitPrivateTelemetry(PRIVATE_TELEMETRY_EVENTS.SETUP_FAILED, { error_code: 'SetupError', ...buildPrivateEnvProps() });
            }
        } catch {
            /* telemetry must never break the recording pipeline */
        }
    }

    /**
     * UX-NAV-1: synchronously persist the in-progress transcript as a recovery draft.
     *
     * Called from the App-level hard-navigation/unload guard (`beforeunload`/`pagehide`),
     * where the normal async stop→decode→save path cannot run to completion before the
     * page is torn down. `localStorage.setItem` is synchronous, so the draft is durably
     * written before unload; `SessionPage`'s recovery effect restores it on next load via
     * `getSessionRecoveryDraft()`. The draft is cleared on a successful stop+save
     * (`clearSessionRecoveryDraft`), so this never resurrects an already-saved session.
     *
     * No-op unless actively RECORDING with a known sessionId and non-empty transcript.
     */
    public persistActiveRecoveryDraft(): void {
        if (this.state !== 'RECORDING') return;
        const sessionId = this.sessionId;
        if (!sessionId) return;
        // #1033 (1): a persisted session row only exists for an AUTHENTICATED user, so the draft MUST carry
        // that owner. Writing an ownerless draft here would make the user's own work unrecoverable (the
        // owner-scoped reader requires an exact match) AND would leave an unattributable draft in shared
        // browser storage. If the owner is somehow unknown, fail CLOSED — never write an ownerless draft.
        const userId = this.capturedUserId;
        if (!userId) {
            logger.warn({ sessionId }, '[controller] persistActiveRecoveryDraft skipped: no captured user id — refusing to write an ownerless draft (#1033)');
            return;
        }

        const store = useSessionStore.getState();
        // #1306: read the live transcript TRANSIENTLY only to decide whether anything was said — NEVER persist
        // it. The snapshot itself is content-free.
        const liveTranscript = this.collectRecoverableTranscript();
        if (!liveTranscript) return;
        const partialWordCount = liveTranscript.split(/\s+/).filter(Boolean).length;

        const startTime = store.startTime;
        const durationSeconds = startTime ? Math.max(0, Math.round((Date.now() - startTime) / 1000)) : 0;

        // CONTENT-FREE, INTERRUPTED snapshot: partial synchronous counters only. It can NEVER become a completed
        // session or enter Progress comparisons — it carries no final metrics and no next action.
        saveSessionRecoveryDraft({
            sessionId,
            userId,
            recoveryState: 'active_interrupted',
            durationSeconds,
            mode: this.service?.getMode?.() ?? store.sttMode ?? 'unknown',
            metrics: { totalWords: partialWordCount },
        });
    }

    /**
     * Synchronously syncs the current FSM state to the DOM forensic anchors.
     * Use this when UI state changes (like mode selection) need immediate 
     * visibility for E2E infrastructure before async transitions complete.
     */
    public syncForensicState(): void {
        this.syncProvider(this.lifecycleVersion);
    }

    /**
     * Initializes the controller/service shell without selecting or warming an
     * STT engine. Provider mount uses this for readiness handshakes; route-level
     * session lifecycle owns modeful warm-up after tier/profile resolution.
     */
    public async initializeInfrastructure(): Promise<void> {
        if (!this.readyPromise) {
            this.readyPromise = this.enqueue(async (token) => {
                await this.initInternal(token);
            });
        }
        await this.readyPromise;
    }


    /**
     * Warm-up Logic (Clean Pipeline Entry Point):
     * This method ensures the STT engine is ready for use, returning a promise 
     * that resolves when the service is instantiated and the engine is initialized.
     */
    public async warmUp(mode: TranscriptionMode = 'private'): Promise<void> {
        // #1184 NOTE: warm-up still honors the requested `mode` and its lock-rejection contract (below). It is
        // NOT a resolution/collapse point — the Private-only funnel is the policy layer (resolveMode /
        // buildPolicyForUser / requestModeChange). Warming a retired engine directly is a residual layer-2
        // leak (engine-code removal) tracked on #1165/#1184, not a "collapsed to Private" event.
        // Phase 1: Ensure Service Genesis (Once per session)
        await this.initializeInfrastructure();
        const requestId = ++this.warmUpRequestId;

        if (this.service) {
            // #1033: while engine selection is locked, warm-up must not switch the ACTIVE engine (it writes
            // this.policy.preferredMode directly, bypassing updatePolicy). Warming the already-selected engine
            // is fine; warming a DIFFERENT one is rejected so one recording keeps one engine.
            if (this.isEngineSelectionLocked() && this.policy && mode !== this.policy.preferredMode) {
                logger.warn({ mode, active: this.policy.preferredMode, state: this.state }, '[SpeechRuntimeController] warmUp: engine change rejected — engine selection locked (#1033)');
                return;
            }
            const selectedMode = useSessionStore.getState().sttMode;
            if (selectedMode && selectedMode !== mode) {
                logger.info({
                    mode,
                    selectedMode,
                }, '[SpeechRuntimeController] Skipping stale warm-up request');
                return;
            }

            const nextPolicy = this.policy
                ? { ...this.policy, preferredMode: mode }
                : {
                    allowNative: false,
                    allowPrivate: mode === 'private',
                    preferredMode: mode,
                    allowFallback: false,
                    executionIntent: `warmup-${mode}`,
                };

            await this.service.updatePolicy(nextPolicy);
            if (requestId !== this.warmUpRequestId) {
                logger.info({
                    mode,
                    requestId,
                    currentRequestId: this.warmUpRequestId,
                }, '[SpeechRuntimeController] Ignoring completed stale warm-up');
                return;
            }
            this.policy = nextPolicy;
            await this.service.warmUp(mode);
        }

        await this.syncServiceSubscription();
    }

    /**
     * User-initiated model download. Delegates to service's initiateDownload
     * which handles FSM reset internally.
     */
    public async initiateModelDownload(mode: TranscriptionMode = 'private'): Promise<void> {
        if (!this.service) {
            await this.ensureReady({ skipIfDownloadPending: false });
        }
        // Setup telemetry is emitted from handleStatusChange (path-agnostic: covers warmUp /
        // auto-init / explicit download alike), not here — initiateModelDownload is only ONE of
        // the model-load entry points and is skipped when the model auto-loads on mode select.
        await this.service!.initiateDownload(mode);
    }

    /**
     * Synchronizes the controller's internal state callbacks with the transcription service.
     */
    public async syncServiceSubscription(): Promise<void> {
        // Prevent re-subscription during booting to avoid state fragmentation
        // SANCTIONED: Top-level guard (S4.1)
        if (useSessionStore.getState().isBooting) {
            pushE2EEvent('SYNC_SUBSCRIPTION_SKIP', { reason: 'is_booting' });
            return;
        }

        pushE2EEvent('SYNC_SUBSCRIPTION_START', { source: 'SpeechRuntimeController' });
        try {
            await this.enqueue(async (_token) => {
                if (!this.service) {
                    pushE2EEvent('SYNC_SUBSCRIPTION_SKIP', { reason: 'no_service' });
                    return;
                }

                // #893: never subscribe to an already-terminated service. During the login→/session
                // transition an enqueued sync can run against a service that was terminated in between;
                // subscribe() would throw ENGINE_ALREADY_TERMINATED (a benign transition race) and surface
                // as a GLOBAL UNHANDLED REJECTION. Skip + drop the stale ref so the next init recreates a
                // fresh service (mirrors the isServiceDestroyed() guard already used on the init paths).
                if (this.service.isServiceDestroyed()) {
                    pushE2EEvent('SYNC_SUBSCRIPTION_SKIP', { reason: 'service_destroyed' });
                    // #893: invalidate the cached STT readiness BEFORE dropping the dead reference. Otherwise
                    // the terminated service's already-resolved `readyPromise` survives, and a subsequent
                    // warmUp()/ensureReady() would short-circuit (`if (!this.readyPromise)` false), find
                    // `this.service` null, and resolve WITHOUT creating/warming a replacement — leaving the
                    // session reporting readiness with no live service. Clearing it (mirrors the teardown
                    // pattern) forces the next readiness path back through initInternal to rebuild a fresh one.
                    this.readyPromise = null;
                    this.resetEphemeralState('service_destroyed_in_sync');
                    this.service = null;
                    return;
                }

                if (this.serviceUnsubscribe) {
                    pushE2EEvent('SYNC_SUBSCRIPTION_CLEANUP', { source: 'SpeechRuntimeController' });
                    this.serviceUnsubscribe();
                    this.serviceUnsubscribe = null;
                }

                pushE2EEvent('SYNC_SUBSCRIPTION_EXECUTE', { source: 'SpeechRuntimeController' });
                this.serviceUnsubscribe = this.service.subscribe(
                    this.serviceCallbacks,
                    'SpeechRuntimeController'
                );
            });
        } finally {
            // Handled in enqueue
        }
    }

    private async initInternal(token: LifecycleToken): Promise<void> {
        try {
            const readiness = useReadinessStore.getState();
            readiness.setAppState('BOOTING');
            useSessionStore.getState().setIsBooting(true);

            logger.info('[SpeechRuntimeController] \u{1F3C1} Infrastructure initialization started');

            if (!this.service) {
                this.service = sessionManager.getOrCreateService(this.serviceCallbacks, this.lock);
            }

            readiness.setAppState('SERVICE_READY');
            this.initialized = true;

            // Phase 3.3: Ensure DOM is synced before the async transition starts
            this.syncForensicState();
            syncSTTIdentity('none', ENV.isE2E);

            await this.transition('READY', undefined, token);

            readiness.setReady('stt');

            this.startLockWatchdog();
            logger.info('[SpeechRuntimeController] Infrastructure ready (Lazy)');
        } catch (error) {
            this.readyPromise = null;
            throw error;
        } finally {
            useSessionStore.getState().setIsBooting(false);
        }
    }

    /**
     * Updates the UI callbacks that the controller should proxy to. 
     */
    public setSubscriberCallbacks(callbacks: Partial<TranscriptionServiceOptions>): void {
        this.subscriberCallbacks = callbacks;

        if (callbacks.navigate) this.navigate = callbacks.navigate;
        if (callbacks.session) this.session = callbacks.session;
        if (callbacks.getAssemblyAIToken) this.getAssemblyAIToken = callbacks.getAssemblyAIToken;

        if (this.service) {
            this.service.updateCallbacks(
                createControllerOwnedServiceCallbacks(callbacks, this.serviceCallbacks as Required<typeof this.serviceCallbacks>)
            );
        }
    }

    /**
     * #1033 (A): the SINGLE authoritative engine-selection change. Returns accepted/rejected. While engine
     * selection is locked it rejects BEFORE any mutation — the UI store mode, the controller preferredMode,
     * and the service policy all stay unchanged, so nothing (not even Cloud-preservation) can restore the
     * rejected engine. Callers (UI setMode) must NOT mutate the store on a rejection. When accepted, the store
     * mode is set FIRST (Cloud-preservation reads it) and then the policy is applied.
     */
    public requestModeChange(nextMode: TranscriptionMode, nextPolicy: TranscriptionPolicy): { accepted: boolean; reason?: string } {
        if (this.isEngineSelectionLocked()) {
            logger.warn({ to: nextMode, state: this.state, kind: this.pendingResolutionKind() }, '[controller] requestModeChange rejected — engine selection locked (#1033)');
            return { accepted: false, reason: 'engine_selection_locked' };
        }
        // #1184 STT exclusivity: the store must reference the RESOLVED engine of the applied policy, not the
        // raw requested mode — so a request for a non-Private engine cannot leave the store (a layer) on an
        // engine the policy won't run. Under Private-only this collapses any request to 'private' (fail-closed);
        // under the legacy multi-engine policy it is a no-op (preferredMode === the requested mode).
        if (isRetiredEngineRequest(nextMode)) {
            emitEngineRequestCollapsedToPrivate({ source: 'requestModeChange', requestedMode: nextMode });
        }
        const resolvedMode = nextPolicy.preferredMode ?? nextMode;
        useSessionStore.getState().setSTTMode(resolvedMode);
        this.updatePolicy(nextPolicy);
        return { accepted: true };
    }

    /**
     * #1033 (A/5): does this policy change anything that can determine WHICH ENGINE PRODUCES SPEECH —
     * the preferred engine, any engine allow-flag, or `allowFallback`? Fallback policy decides which engine
     * takes over after a failure, so under the one-engine contract it is producer-affecting, not cosmetic.
     */
    private wouldChangeActiveProducer(p: TranscriptionPolicy): boolean {
        const cur = this.policy;
        if (!cur) return false;
        return p.preferredMode !== cur.preferredMode
            || p.allowNative !== cur.allowNative
            || p.allowPrivate !== cur.allowPrivate
            || p.allowFallback !== cur.allowFallback;
    }

    public updatePolicy(policy: TranscriptionPolicy): void {
        // #1033 (A): single authoritative gate. Normalize FIRST (Cloud-preservation etc.), then enforce the
        // lock LAST so no normalization step can restore a rejected engine while locked. While engine selection
        // is locked (Start intent, recording lifecycle, a pending resolution, or an unresolved recording), NO
        // path (UI setMode, profile/entitlement sync, __E2E_SET_MODE__, warm-up, native selection, Cloud-
        // preservation) may change the ACTIVE PRODUCER. EVERY producer-affecting field is frozen — the engine,
        // all three allow-flags, AND `allowFallback` (which decides who produces speech after a failure).
        // Only non-producer metadata (executionIntent) from the incoming policy passes through. A rejected
        // entitlement/profile change is QUEUED and applied at the next recording's start boundary.
        const normalized = policy;
        let effectivePolicy = normalized;
        if (this.isEngineSelectionLocked() && this.policy && this.wouldChangeActiveProducer(normalized)) {
            logger.warn({ from: this.policy.preferredMode, to: normalized.preferredMode, state: this.state }, '[controller] updatePolicy: producer change rejected — engine selection locked (#1033)');
            this.queuedProducerPolicy = normalized; // apply at the next recording boundary
            effectivePolicy = {
                ...normalized,
                preferredMode: this.policy.preferredMode,
                allowNative: this.policy.allowNative,
                allowPrivate: this.policy.allowPrivate,
                allowFallback: this.policy.allowFallback,
            };
        }
        this.policy = effectivePolicy;
        if (this.service) {
            // #1033: this write is intentionally fire-and-forget, but its rejection MUST still be handled —
            // an unhandled promise rejection here would surface as a process-level error (and in strict
            // runtimes could terminate it) whenever the service refuses a policy. Callers that need the
            // service to CONFIRM the policy use applyQueuedProducerPolicy(), which awaits it transactionally.
            void this.enqueue(async (token) => {
                // Token check FIRST
                if (token.cancelled || token.version !== this.lifecycleVersion) return;

                const service = this.service; // Capture reference
                if (!service) return;         // Explicit null check

                await service.updatePolicy(effectivePolicy);

                // Re-check after await
                if (token.cancelled || token.version !== this.lifecycleVersion) return;
            }).catch((e) => {
                logger.warn({ e, preferredMode: effectivePolicy.preferredMode }, '[SpeechRuntimeController] service policy update failed (non-fatal; policy retained)');
            });
        }
    }


    public startLockWatchdog(): void {
        if (typeof window === 'undefined') return;
        this.stopLockWatchdog();

        const checkHost = () => {
            const store = useSessionStore.getState();
            const heldByOther = this.lock.isHeldByOther();
            if (store.isLockHeldByOther !== heldByOther) {
                store.setLockHeldByOther(heldByOther);
            }
        };

        window.addEventListener('storage', (e) => {
            if (e.key === 'speaksharp_active_session_lock') checkHost();
        });

        this.lockWatchdogInterval = setInterval(checkHost, 3000);
        checkHost();
    }

    public stopLockWatchdog(): void {
        if (this.lockWatchdogInterval) {
            clearInterval(this.lockWatchdogInterval);
            this.lockWatchdogInterval = null;
        }
    }

    private updateStreakInternal(): { currentStreak: number; isNewDay: boolean } {
        if (typeof window === 'undefined') return { currentStreak: 0, isNewDay: false };

        const saved = safeLocalStorageGet('speaksharp-streak');
        const now = new Date();
        const today = now.toISOString().split('T')[0];

        const current = saved ? JSON.parse(saved) : { currentStreak: 0, lastPracticeDate: '' };
        let newStreak = current.currentStreak;
        let isNewDay = false;

        if (current.lastPracticeDate !== today) {
            isNewDay = true;
            const yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (current.lastPracticeDate === yesterdayStr || current.lastPracticeDate === '') {
                newStreak += 1;
            } else {
                newStreak = 1;
            }

            const updated = { currentStreak: newStreak, lastPracticeDate: today };
            safeLocalStorageSet('speaksharp-streak', JSON.stringify(updated));
        }

        return { currentStreak: newStreak, isNewDay };
    }

    private async enqueue<T>(task: (token: LifecycleToken) => Promise<T>): Promise<T> {
        const token: LifecycleToken = { version: this.lifecycleVersion, cancelled: false };
        this.activeTasks.add(token);

        const wrapped = async (): Promise<T> => {
            try {
                // If we're already cancelled before we start
                if (token.cancelled || token.version !== this.lifecycleVersion) {
                    return undefined as unknown as T;
                }
                return await task(token);
            } finally {
                this.activeTasks.delete(token);
            }
        };

        const next = this.commandQueue.then(wrapped);
        this.commandQueue = next.then(() => { }, () => { });
        return next;
    }

    public getState(): RuntimeState {
        return this.state;
    }

    /** #1258: token that increments on each actual idle reclamation. A change since a consumer last observed it
     *  means the engine was genuinely reclaimed (not merely idle / not a tab switch). */
    public getIdleReclamationGeneration(): number {
        return this.idleReclamationGeneration;
    }

    private updateSessionPersisted(
        persisted: boolean,
        details?: { sessionId?: string | null; mode?: string | null },
    ): void {
        useSessionStore.getState().setSessionSaved(persisted);
        if (useSessionStore.getState().sessionSaved !== persisted) {
            useSessionStore.setState({ sessionSaved: persisted });
        }
        syncSessionPersisted(persisted, details);
    }

    /**
     * Returns a promise that resolves when the current command queue
     * is fully drained. Use in tests instead of vi.waitFor() polling.
     *
     * @example
     * await controller.startRecording();
     * await controller.whenStable(); // FSM is now RECORDING
     * await waitFor(() => expect(store.getState().sessionId).toBeDefined()); // Wait for projection
     */
    public async whenStable(): Promise<void> {
        await this.commandQueue;
        pushE2EEvent('WHEN_STABLE_RESOLVED');
    }

    private handleStrategyReady(): void {
        void this.enqueue(async (token) => {
            try {
                await this.transition('READY', undefined, token);
            } catch (err) {
                logger.error({ err }, '[SpeechRuntimeController] Failed to transition to READY');
            }
            this.syncProvider(token.version);
        });
    }

    private handleModelProgress(_progress: number): void {
        this.syncProvider(this.lifecycleVersion);
    }

    private setEngineReady(ready: boolean): void {
        this.isEngineReady = ready;
        syncEngineReady(ready);
    }

    private getStoreTranscriptLength(): number {
        const store = useSessionStore.getState();
        const chunkTranscript = store.chunks.map(chunk => chunk.transcript).join(' ').trim();
        const storeTranscript = store.transcript.transcript.trim();
        return Math.max(chunkTranscript.length, storeTranscript.length);
    }

    /**
     * #1033 (3) — the CANONICAL recoverable-transcript selection, mirroring the finalization candidate
     * chain (service_result is unavailable at failure time). Considers EVERY source finalization would:
     * committed final, chunks, committed store text, the visible/frozen-at-stop snapshot, the best
     * meaningful partial, the raw partial, and the combined visible snapshot. Quality-preferring like
     * finalization (`??` chain), but NEVER returns empty while any recoverable speech text exists — a
     * recording with only partial text or only chunks must never be classified as "nothing to recover".
     */
    private collectRecoverableTranscript(): string {
        this.syncTranscriptLifecycleFromStore();
        const store = useSessionStore.getState();
        const chunkTranscript = store.chunks.map(chunk => chunk.transcript).join(' ').trim();
        const storeTranscript = store.transcript.transcript.trim();
        const storePartialTranscript = store.transcript.partial.trim();
        const visibleStoreTranscript = [storeTranscript, storePartialTranscript].filter(Boolean).join(' ').trim();
        const frozenStopTranscript = store.frozenTranscriptAtStop?.trim() || '';

        const candidates = [
            this.transcriptLifecycle.committedFinal || chunkTranscript || storeTranscript,
            this.transcriptLifecycle.lastVisibleTranscriptAtStop || frozenStopTranscript,
            this.transcriptLifecycle.bestMeaningfulPartial || storePartialTranscript,
            visibleStoreTranscript,
            chunkTranscript,
            storePartialTranscript,
        ]
            .map(text => (text ?? '').trim())
            .filter(Boolean);
        if (candidates.length === 0) return '';

        // RECOVERY maximizes preservation: among candidates, prefer the MEANINGFUL ones and take the most
        // complete (longest) — so a committed body plus its in-progress partial tail is kept whole rather than
        // truncated to the committed text alone. If nothing qualifies as meaningful, still keep the longest
        // non-empty text rather than discarding the user's words.
        const longest = (texts: string[]) => texts.reduce((a, b) => (b.length > a.length ? b : a));
        const meaningful = candidates.filter(text => hasMeaningfulTranscriptText(text));
        return meaningful.length > 0 ? longest(meaningful) : longest(candidates);
    }

    private isActionableStartError(status?: SttStatus): boolean {
        if (!status || status.type !== 'error') {
            return false;
        }

        return /microphone|mic|permission|recording could not start/i.test(status.message);
    }

    private async transition(newState: RuntimeState, error?: Error, token?: LifecycleToken): Promise<void> {
        // #1033: release the Start-intent BRIDGE once a real state is reached — the lifecycle-state set,
        // the pending-retry, and recordingStartedUnresolved now govern isEngineSelectionLocked(). Once a
        // recording has actually begun, mark it unresolved so a POST-start failure (which lands in a
        // non-locked state) keeps engine selection locked until durable save/retry/approved-discard.
        this.engineSelectionIntentLocked = false;
        if (newState === 'RECORDING') {
            if (!this.canTransitionToRecording()) {
                return;
            }
            // Recording confirmed to begin → keep engine selection locked until durable save/retry/discard,
            // even if a later failure lands in a non-locked state (FAILED/TERMINATED/READY/IDLE).
            this.recordingStartedUnresolved = true;
        }

        const previousState = this.state;
        this.state = newState;
        this.syncProvider(this.lifecycleVersion);

        // #1033 (B): a terminal failure of a recording that BEGAN must never leave the user locked with no
        // recovery. Guarantee an actionable resolution (arm a full-save retry from recoverable work, or unlock
        // if there is nothing to save). Runs for FAILED/FAILED_VISIBLE/TERMINATED; a no-op when a specific
        // retry op is already stashed or the recording never began.
        if (newState === 'FAILED' || newState === 'FAILED_VISIBLE' || newState === 'TERMINATED') {
            this.ensurePostStartFailureIsActionable();
        }

        logger.info({ from: previousState, to: newState }, '[SpeechRuntimeController] ⚡ Transition');
        const store = useSessionStore.getState();
        if (newState === 'FAILED_VISIBLE') {
            logger.warn({
                source: 'SpeechRuntimeController',
                from: previousState,
                to: 'FAILED_VISIBLE',
                reason: error?.message ?? null,
                mode: this.service?.getMode?.() ?? this.policy?.preferredMode ?? null,
                hasService: Boolean(this.service),
                serviceState: this.service?.getState?.() ?? null,
                sessionId: this.sessionId,
                transcriptLength: this.getStoreTranscriptLength(),
                lifecycleVersion: this.lifecycleVersion,
                tokenVersion: token?.version ?? null,
            }, '[RECORDING_LIFECYCLE_FAIL]');
        }

        const isExitTransition =
            newState === 'IDLE' ||
            newState === 'READY' ||
            newState === 'TERMINATED';

        const wasActive =
            previousState === 'RECORDING' ||
            previousState === 'ENGINE_INITIALIZING' ||
            previousState === 'INITIATING' ||
            previousState === 'STOPPING' ||
            previousState === 'FAILED' ||
            previousState === 'FAILED_VISIBLE';

        this.lock.updateState(newState);

        // #1314 C6: clear the "Finalizing…" banner through this ONE transition reducer whenever the
        // controller reaches a resting/terminal state, so no stop path can leave `isTranscriptFinalizing`
        // latched true after the controller is READY (the stale-banner "stuck session" defect). The
        // 4-minute finalization safety timeout is unchanged.
        if (
            newState === 'READY' ||
            newState === 'IDLE' ||
            newState === 'TERMINATED' ||
            newState === 'FAILED' ||
            newState === 'FAILED_VISIBLE'
        ) {
            if (store.isTranscriptFinalizing) store.setTranscriptFinalizing(false);
        }

        if (isExitTransition) {
            const currentStatus = store.sttStatus;
            const shouldPreserveActionableError =
                newState === 'TERMINATED' &&
                this.isActionableStartError(currentStatus);

            store.setActiveEngine(null);
            if (!shouldPreserveActionableError) {
                store.setSTTStatus({ type: 'idle', message: 'Ready to record' });
            }

            if (wasActive) {
                store.stopSession();
                if (shouldPreserveActionableError) {
                    store.setSTTStatus(currentStatus);
                }
                if (newState === 'TERMINATED') {
                    await this.service?.destroy();
                    this.sessionId = null;
                }
            }
        }

        if (newState === 'RECORDING') {
            store.setSTTStatus({ type: 'recording', message: 'Recording active' });
        }

        if (newState === 'RECORDING' || newState === 'ENGINE_INITIALIZING' || newState === 'INITIATING') {
            this.stopIdleTimer();
        } else if (newState === 'IDLE' || newState === 'READY') {
            this.startIdleTimer();
        }

        store.setRuntimeState(newState);

        if (newState === 'FAILED') {
            this.commandQueue = Promise.resolve();
            if (error) {
                const rawMessage = error.message || '';
                const isMicPermissionError = /permission|not-allowed|service-not-allowed|microphone|mic/i.test(rawMessage);
                const displayMessage = isMicPermissionError
                    ? 'Microphone access is denied. Please grant permission in your browser settings.'
                    : rawMessage;
                store.setSTTStatus({ type: 'error', message: displayMessage });
            }
            if (this.sessionId) {
                // Ensure this is properly tracked or caught
                completeSession(this.sessionId, {
                    status: 'failed',
                    duration: 0,
                    reason: 'Controller transitioned to FAILED state'
                }).catch((completeError) => {
                    logger.warn({
                        completeError,
                        sessionId: this.sessionId,
                        state: this.state,
                    }, '[SpeechRuntimeController] Failed to mark session failed after FAILED transition');
                });
            }
            await this.transition('FAILED_VISIBLE', error, token);
        }

        if (newState === 'FAILED_VISIBLE') {
            setTimeout(() => {
                void this.enqueue(async (t) => {
                    if (this.state === 'FAILED_VISIBLE' || this.state === 'FAILED') {
                        await this.transition('TERMINATED', undefined, t);
                    }
                });
            }, this.VISIBLE_HOLD_DURATION_MS);
        }

        if (newState === 'RECORDING' && previousState !== 'RECORDING') {
            this.recordingProgressMode = this.snapshotProgressModeAtRecordingBoundary();
            store.startSession();
        }

        this.syncProvider(this.lifecycleVersion);
    }

    private canTransitionToRecording(): boolean {
        return this.isEngineReady && this.isEmissionsSafe;
    }

    public confirmSubscriberHandshake(): void {
        const readiness = useReadinessStore.getState();
        this.isSubscriberReady = true;

        if (this.isEngineReady) {
            readiness.setAppState('READY');
            syncSTTReady(true);
        }

        this.flushQueues();

        if (ENV.isE2E) {
            setTimeout(() => {
                if (this.emissionQueue.length > 0) {
                    this.flushQueues();
                }
            }, 100);
        }

        void this.checkRecordingInvariant();
    }

    private async checkRecordingInvariant() {
        if (this.canTransitionToRecording() && (this.state === 'INITIATING' || this.state === 'ENGINE_INITIALIZING')) {
            await this.transition('RECORDING');
        }
    }

    private handleTranscriptUpdate(data: TranscriptUpdate) {
        pushTranscriptLifecycleTrace('controller:receive', {
            type: data.transcript.final ? 'final' : 'partial',
            textLength: (data.transcript.final || data.transcript.partial || '').length,
            preview: (data.transcript.final || data.transcript.partial || '').slice(0, 80),
        });
        // Keep the visible transcript store current even if the React subscriber
        // temporarily detaches/remounts during long idle or recognition restart
        // windows. Callback delivery can wait; user-visible text should not.
        this.pushTranscriptToStore(data);

        if (this.isSubscriberReady) {
            this.subscriberCallbacks.onTranscriptUpdate?.(data);
            this.emitTranscriptPulse(data);
        } else {
            this.emissionQueue.push(data);
        }
    }

    private handleHistoryUpdate(history: HistorySegment[]) {
        if (this.isSubscriberReady) {
            queueMicrotask(() => {
                useSessionStore.getState().setHistory(history);
                this.subscriberCallbacks.onHistoryUpdate?.(history);
            });
        } else {
            this.historyQueue.push(history);
        }
    }

    private handleError(error: Error): void {
        const store = useSessionStore.getState();
        const rawMessage = error.message || '';
        const isMicPermissionError = /permission|not-allowed|service-not-allowed|microphone|mic/i.test(rawMessage);
        const displayMessage = isMicPermissionError
            ? 'Microphone access is denied. Please grant permission in your browser settings.'
            : rawMessage;

        if (store.sttStatus?.type === 'recording' && !isMicPermissionError) {
            logger.warn({ error: error.message }, '[SpeechRuntimeController] handleError suppressed — recording is active');
            return; // fallback recovery in progress — don't overwrite
        }

        syncSTTReady(false);
        store.setSTTStatus({ type: 'error', message: displayMessage });

        void this.enqueue(async (token) => {
            await this.transition('FAILED', new Error(displayMessage), token);
        });
    }

    private handleReady() {
        this.setEngineReady(true);
        if (this.service) {
            this.startWatchdog(this.service);
        }
        void this.checkRecordingInvariant();
    }

    private pendingModelProgress: number | null = null;
    private modelProgressFlushScheduled = false;

    // Coalesce model-load PROGRESS events. A large base.en download — amplified by multiple
    // worker progress streams during init — fires a rapid burst; pushing each one straight to
    // the store floods React with synchronous re-renders and trips "Maximum update depth
    // exceeded" during DOWNLOAD_REQUIRED->ENGINE_INITIALIZING. We keep only the LATEST value and
    // flush at most once per animation frame, so a burst can never storm the renderer.
    // (SELFHOST-MODELS-MAXDEPTH — fixes the progress-flood render storm.)
    private handleModelLoadProgress(progress: number | null) {
        this.pendingModelProgress = progress;
        if (this.modelProgressFlushScheduled) return;
        this.modelProgressFlushScheduled = true;

        const flush = () => {
            this.modelProgressFlushScheduled = false;
            const value = this.pendingModelProgress;
            useSessionStore.getState().setModelLoadingProgress(value);
            this.subscriberCallbacks.onModelLoadProgress?.(value);
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(flush);
        } else {
            setTimeout(flush, 0);
        }
    }

    private isModeAllowedByCurrentPolicy(mode: TranscriptionMode | null): boolean {
        if (!mode || !this.policy) {
            return true;
        }
        // #1320: defer to the authoritative policy helper — never read `allowNative` for a mode decision.
        return isModeAllowed(mode, this.policy);
    }

    /**
     * #1033 (2) — PRODUCER-INTEGRITY FAILURE. The service reported an engine different from the one latched
     * for this recording, so the transcript may already mix two producers. Fail closed and honestly:
     *  1. mark the producer as compromised so finalization can NEVER mark this row `verified`;
     *  2. stop the engine safely (best-effort) and leave the recording UNRESOLVED so it stays locked;
     *  3. preserve the recoverable transcript and arm the correct recovery op (initial-save or full-save)
     *     with `attribution_status = 'unverified'`;
     *  4. surface an actionable error — never keep claiming the latched engine is still producing.
     */
    private async failProducerIntegrity(reportedMode: TranscriptionMode | null): Promise<void> {
        this.producerIntegrityCompromised = true;
        pushNativeRuntimeTrace('controller_producer_integrity_failure', {
            latched: this.recordingEngineMode,
            reported: reportedMode ?? null,
        });
        useSessionStore.getState().setSTTStatus({
            type: 'error',
            message: 'Recording stopped: the transcription engine changed unexpectedly.',
            detail: 'Your transcript was kept and can be saved, but its engine could not be verified.',
        });
        // Stop the engine so it cannot keep producing under a second identity. Best-effort: teardown failure
        // must not prevent the recovery arming below.
        try {
            await this.service?.stopTranscription?.();
        } catch (e) {
            logger.warn({ e }, '[controller] producer-integrity stop failed (continuing to arm recovery) (#1033 2)');
        }
        // The recording BEGAN, so it stays unresolved/locked; arm the actionable recovery for its transcript.
        this.recordingStartedUnresolved = true;
        this.ensurePostStartFailureIsActionable();
        await this.transition('FAILED', new Error('PRODUCER_INTEGRITY_ENGINE_CHANGED'));
    }

    private handleModeChange(mode: TranscriptionMode | null) {
        const store = useSessionStore.getState();
        const isActiveSessionTransition = ['INITIATING', 'RECORDING', 'STOPPING'].includes(this.state);

        if (!isActiveSessionTransition && mode !== store.sttMode) {
            logger.info({
                mode,
                selectedMode: store.sttMode,
                controllerState: this.state,
            }, '[SpeechRuntimeController] Ignoring idle warm-up mode callback');
            return;
        }

        // #1033 (2/4): one recording = one engine. Once the producer is LATCHED, a service callback reporting a
        // DIFFERENT mode means the SERVICE MAY ACTUALLY HAVE SWITCHED ENGINES — the transcript could already
        // contain two producers. Merely ignoring the callback and repainting the old label would leave the UI
        // claiming an engine that is no longer producing. This is a FATAL producer-integrity event: terminate
        // the recording safely, preserve the recoverable transcript, arm the correct recovery, and force the
        // attribution to `unverified` (a mixed-engine row can NEVER be marked verified).
        // #1033 (2): once this recording is already compromised/terminal, further mismatched callbacks are
        // STALE — ignore them entirely (no second teardown, no state mutation, no DB action).
        if (this.producerIntegrityCompromised) {
            logger.warn({ reportedMode: mode, state: this.state }, '[SpeechRuntimeController] Ignoring stale mode callback after producer-integrity failure (#1033 2)');
            return;
        }

        if (this.recordingEngineMode && mode !== this.recordingEngineMode) {
            logger.error({
                reportedMode: mode,
                latchedMode: this.recordingEngineMode,
                controllerState: this.state,
                sessionId: this.sessionId,
            }, '[SpeechRuntimeController] PRODUCER INTEGRITY FAILURE — service reported a different engine mid-recording (#1033 2)');
            // Start the teardown ONCE. Repeated/concurrent duplicate callbacks reuse the SAME promise and
            // perform no second stop, transition, recovery mutation, or DB action. The handle is retained
            // (not cleared here) so post-completion stale callbacks are inert too; it is cleared only at the
            // next recording boundary.
            if (!this.producerIntegrityTeardown) {
                this.producerIntegrityTeardown = this.failProducerIntegrity(mode)
                    .catch((e) => { logger.warn({ e }, '[controller] producer-integrity teardown error (#1033 2)'); });
            }
            return;
        }

        if (!this.isModeAllowedByCurrentPolicy(mode)) {
            const fallbackMode = this.policy?.preferredMode ?? 'private';
            logger.warn({
                mode,
                fallbackMode,
                policy: this.policy?.executionIntent,
            }, '[SpeechRuntimeController] Ignoring stale disallowed mode callback');
            store.setSTTMode(fallbackMode);
            this.subscriberCallbacks.onModeChange?.(fallbackMode);
            return;
        }

        store.setSTTMode(mode);
        this.subscriberCallbacks.onModeChange?.(mode);
    }

    private handleStatusChange(status: SttStatus) {
        if (status.type === 'initializing') {
            this.setEngineReady(false);
        }
        if (status.type === 'ready') {
            this.setEngineReady(true);
        }
        this.emitPrivateSetupStatus(status.type);
        // P0.2: surface engine-originated local finalization status to the store so
        // the UI shows "Processing speech locally…" during STOPPING instead of the
        // stale "Recording active". Scoped to informational status while a session
        // is stopping/active; engine ready/recording/error remain owned by the
        // lifecycle transitions, so this does not disturb the status machine.
        if (status.type === 'info' && (this.state === 'STOPPING' || this.state === 'RECORDING')) {
            useSessionStore.getState().setSTTStatus(status);
        }
        this.subscriberCallbacks.onStatusChange?.(status);
    }

    private handleAudioData(data: Float32Array) {
        this.subscriberCallbacks.onAudioData?.(data);
    }

    private resetAnalysisStateForNewRecording(): void {
        const store = useSessionStore.getState();
        // #1033: drop the resolved Private arm at the recording boundary so a prior Private recording
        // can never verify a later Browser/Cloud/Private row (re-latched on the next Private resolve).
        this.resolvedPrivateEngineVersion = null;
        this.resolvedPrivateEngineSessionId = null;
        // #1033 (4): a NEW recording is starting — drop the previous recording's producer latch so it cannot
        // leak across recordings. The new latch is set only once this start actually reaches RECORDING.
        // The integrity flag is cleared HERE (a recording boundary), never at resolution, so it survives
        // through finalization and keeps a compromised recording from ever being marked verified.
        this.recordingEngineMode = null;
        this.producerIntegrityCompromised = false;
        this.producerIntegrityTeardown = null;
        this.resetTranscriptLifecycle();
        store.updateTranscript('', '');
        store.freezeTranscriptAtStop(null);
        store.setTranscriptFinalizing(false);
        store.updateFillerData({});
        // #1306 Option A: drop the prior take's terminal metric snapshot so it never lingers onto a new session.
        store.setFinalizedWordCount(null);
        store.setFinalizedFillerData(null);
        store.setFinalizedFillerCount(null);
        store.setChunks([]);
        store.setPauseMetrics({
            totalPauses: 0,
            averagePauseDuration: 0,
            longestPause: 0,
            pausesPerMinute: 0,
            silencePercentage: 0,
            transitionPauses: 0,
            extendedPauses: 0,
        });
        store.setElapsedTime(0);
        store.setSessionSaved(false);
    }

    private flushQueues() {
        while (this.emissionQueue.length > 0) {
            const data = this.emissionQueue.shift();
            if (data) {
                this.subscriberCallbacks.onTranscriptUpdate?.(data);
                this.emitTranscriptPulse(data);
            }
        }
        while (this.historyQueue.length > 0) {
            const history = this.historyQueue.shift();
            if (history) {
                queueMicrotask(() => {
                    useSessionStore.getState().setHistory(history);
                    this.subscriberCallbacks.onHistoryUpdate?.(history);
                });
            }
        }
    }

    private syncTranscriptLifecycleFromStore(): void {
        const { transcript } = useSessionStore.getState();
        const committedFinal = transcript.transcript.trim();
        const currentPartial = transcript.partial.trim();
        const visibleTranscript = getVisibleTranscriptText(transcript);

        this.transcriptLifecycle.committedFinal = committedFinal;
        this.transcriptLifecycle.currentPartial = currentPartial;
        this.transcriptLifecycle.visibleTranscript = visibleTranscript;
        if (hasMeaningfulTranscriptText(currentPartial)) {
            this.transcriptLifecycle.bestMeaningfulPartial = currentPartial;
        }
    }

    private resetTranscriptLifecycle(): void {
        this.transcriptLifecycle = createEmptyTranscriptLifecycleState();
    }

    /**
     * #1306 P1: purge the ephemeral live transcript from working-memory surfaces once metrics have been derived
     * and the session finalized. The live transcript is working memory ONLY; after finalization it must not
     * linger in the session store or the controller's transcript lifecycle (incl. selectedTranscriptForSave).
     * Metrics (fillerCounts / next_action / clarity) are held separately (finalizedAnalysis + the metrics-only
     * save payload), so clearing the raw text here never affects the save, a Retry Save, or the review reader.
     * Production diagnostics already carry lengths only (see pushNativeStoreTrace + the debug object), so the
     * dev/proof trace ring is intentionally left intact for test harnesses.
     */
    private purgeTranscriptWorkingMemory(): void {
        try {
            const store = useSessionStore.getState();
            store.updateTranscript('', '');
            store.setChunks([]);
        } catch { /* store may be torn down mid-teardown; best-effort */ }
        this.resetTranscriptLifecycle();
    }

    private freezeTranscriptLifecycleAtStop(): string {
        this.syncTranscriptLifecycleFromStore();
        const frozen =
            this.transcriptLifecycle.visibleTranscript ||
            this.transcriptLifecycle.bestMeaningfulPartial ||
            this.transcriptLifecycle.currentPartial ||
            this.transcriptLifecycle.committedFinal;

        this.transcriptLifecycle.lastVisibleTranscriptAtStop = frozen || null;
        const store = useSessionStore.getState();
        store.freezeTranscriptAtStop(frozen || null);
        store.setTranscriptFinalizing(true);
        return frozen;
    }

    private pushTranscriptToStore(data: TranscriptUpdate): void {
        const store = useSessionStore.getState();
        const currentTranscript = store.transcript.transcript;

        const pushNativeStoreTrace = (event: string, payload: Record<string, unknown> = {}) => {
            if (typeof window === 'undefined' || !window.__NATIVE_BROWSER_TRACE__) return;
            // #1306 P1: diagnostics retain only codes/numbers/LENGTHS — NEVER transcript text, in ANY build
            // (test/E2E/real-device artifacts are inside the privacy boundary too). The base carries lengths; any
            // transcript-bearing key (base + any passed in `payload`) is stripped below so no spoken prose ever
            // lands in the retained trace ring.
            const entry: Record<string, unknown> = {
                t: Number(performance.now().toFixed(1)),
                event,
                currentTranscriptLength: currentTranscript.length,
                partialLength: (data.transcript.partial ?? '').length,
                finalLength: (data.transcript.final ?? '').length,
                chunkCount: store.chunks.length,
                ...payload,
            };
            // #1306 P1: NEVER retain transcript text in a diagnostic trace, in any build — strip every
            // transcript-bearing key (base + any passed in `payload`). Lengths above are the only text signal.
            for (const k of ['currentTranscript', 'partial', 'final', 'preview', 'finalTranscript', 'newFullText', 'text', 'frozenAtStop']) {
                if (k in entry) delete entry[k];
            }
            window.__NATIVE_BROWSER_TRACE__.push(entry);
        };

        // 🛡️ USER_ID EMISSION GUARD: Ensure transcripts belong to the session starter
        const currentUserId = this.session?.user?.id;
        if (this.capturedUserId && currentUserId && currentUserId !== this.capturedUserId) {
            pushNativeStoreTrace('store_guard_user_mismatch', {
                expected: this.capturedUserId,
                actual: currentUserId,
            });
            logger.warn({
                expected: this.capturedUserId,
                actual: currentUserId
            }, '[SpeechRuntimeController] ABORTING EMISSION: userId mismatch');
            return;
        }

        pushNativeStoreTrace('store_received_update', {
            hasFinal: Boolean(data.transcript.final),
            hasPartial: Boolean(data.transcript.partial),
        });

        if (data.transcript.final) {
            this.transcriptEmissionSequence += 1;
            const rawFinalTranscript = data.transcript.final.trim();
            const finalTranscript = ensureTerminalPunctuation(rawFinalTranscript);
            const currentTrimmed = currentTranscript.trim();
            const currentNormalized = normalizeTranscriptPrefix(currentTrimmed);
            const finalNormalized = normalizeTranscriptPrefix(finalTranscript);
            if (!rawFinalTranscript) {
                pushNativeStoreTrace('store_skip_empty_final');
                return;
            }

            // AUTHORITATIVE whole-utterance re-transcription (Private post-Stop): REPLACE the rolling
            // transcript + chunks instead of running the prefix/append heuristics below. Without this
            // the clean final decode is appended onto the garbled streaming preview (it is not a forward
            // prefix) → duplicated/inflated saved transcript. Regression guard for #87/#88. A blank final
            // is already rejected above, so this never wipes text to empty.
            if (data.transcript.replacesRollingTranscript) {
                store.updateTranscript(finalTranscript, data.transcript.partial || '');
                store.setChunks([{ transcript: finalTranscript, timestamp: Date.now(), isFinal: true }]);
                this.syncTranscriptLifecycleFromStore();
                pushNativeStoreTrace('store_replace_rolling_with_whole_utterance', { finalTranscript });
                pushTranscriptLifecycleTrace('store:update', {
                    type: 'final_replace_whole_utterance',
                    committedLength: useSessionStore.getState().transcript.transcript.length,
                    partialLength: useSessionStore.getState().transcript.partial.length,
                    preview: finalTranscript.slice(0, 80),
                });
                return;
            }

            const lastChunk = store.chunks[store.chunks.length - 1];
            if (lastChunk?.isFinal && normalizeTranscriptPrefix(lastChunk.transcript) === finalNormalized) {
                pushNativeStoreTrace('store_skip_duplicate_last_chunk', {
                    finalTranscript,
                });
                store.updateTranscript(currentTranscript || finalTranscript, data.transcript.partial || '');
                this.syncTranscriptLifecycleFromStore();
                pushTranscriptLifecycleTrace('store:update', {
                    type: 'final_duplicate',
                    committedLength: useSessionStore.getState().transcript.transcript.length,
                    partialLength: useSessionStore.getState().transcript.partial.length,
                });
                return;
            }
            if (isPrivateTranscriptTraceEnabled()) {
                logger.info({
                    currentLength: currentTranscript.length,
                    finalLength: finalTranscript.length,
                    chunkCount: store.chunks.length,
                }, '[PRIVATE_TRACE] store_final_transcript_apply');
            }

            if (currentNormalized === finalNormalized || currentNormalized.endsWith(finalNormalized)) {
                pushNativeStoreTrace('store_skip_final_already_present', {
                    currentTrimmed,
                    finalTranscript,
                });
                store.updateTranscript(currentTranscript || finalTranscript, data.transcript.partial || '');
                this.syncTranscriptLifecycleFromStore();
                pushTranscriptLifecycleTrace('store:update', {
                    type: 'final_already_present',
                    committedLength: useSessionStore.getState().transcript.transcript.length,
                    partialLength: useSessionStore.getState().transcript.partial.length,
                });
                return;
            }

            if (currentTrimmed && hasProviderFullTranscriptPrefix(currentTrimmed, rawFinalTranscript)) {
                const suffix = ensureTerminalPunctuation(rawFinalTranscript.slice(currentTrimmed.length).trim());
                pushNativeStoreTrace('store_replace_with_provider_full_final', {
                    suffix,
                    finalTranscript,
                    normalizedPrefixMatch: true,
                });
                store.updateTranscript(finalTranscript, data.transcript.partial || '');
                this.syncTranscriptLifecycleFromStore();
                pushTranscriptLifecycleTrace('store:update', {
                    type: 'final_replace',
                    committedLength: useSessionStore.getState().transcript.transcript.length,
                    partialLength: useSessionStore.getState().transcript.partial.length,
                    preview: finalTranscript.slice(0, 80),
                });
                if (suffix) {
                    store.addChunk({
                        transcript: suffix,
                        timestamp: Date.now(),
                        isFinal: true
                    });
                }
                return;
            }

            const newFullText = appendFinalTranscriptText(currentTranscript, finalTranscript);
            pushNativeStoreTrace('store_apply_final', {
                finalTranscript,
                newFullText,
            });
            store.updateTranscript(newFullText, data.transcript.partial || '');
            this.syncTranscriptLifecycleFromStore();
            pushTranscriptLifecycleTrace('store:update', {
                type: 'final',
                committedLength: useSessionStore.getState().transcript.transcript.length,
                partialLength: useSessionStore.getState().transcript.partial.length,
                preview: newFullText.slice(0, 80),
            });
            store.addChunk({
                transcript: finalTranscript,
                timestamp: Date.now(),
                isFinal: true
            });
        } else if (data.transcript.partial && !data.transcript.partial.startsWith('Downloading model')) {
            const partialSequence = this.transcriptEmissionSequence;
            if (isPrivateTranscriptTraceEnabled()) {
                logger.info({
                    currentLength: currentTranscript.length,
                    partialLength: data.transcript.partial.length,
                }, '[PRIVATE_TRACE] store_partial_transcript_apply');
            }
            pushNativeStoreTrace('store_apply_partial', {
                partialTranscript: data.transcript.partial,
                partialSequence,
            });
            if (partialSequence === this.transcriptEmissionSequence) {
                store.updateTranscript(currentTranscript, data.transcript.partial);
                this.syncTranscriptLifecycleFromStore();
                pushTranscriptLifecycleTrace('store:update', {
                    type: 'partial',
                    committedLength: useSessionStore.getState().transcript.transcript.length,
                    partialLength: useSessionStore.getState().transcript.partial.length,
                    preview: data.transcript.partial.slice(0, 80),
                });
            } else {
                pushNativeStoreTrace('store_skip_stale_partial', {
                    partialTranscript: data.transcript.partial,
                    partialSequence,
                    currentSequence: this.transcriptEmissionSequence,
                });
            }
        } else {
            pushNativeStoreTrace('store_skip_no_final_or_partial');
        }
    }

    private emitTranscriptPulse(data: TranscriptUpdate): void {
        pushE2EEvent('TRANSCRIPT_PULSE', {
            isFinal: Boolean(data.transcript.final),
            hasPartial: Boolean(data.transcript.partial),
            textLength: (data.transcript.final || data.transcript.partial || '').length,
        });
    }

    private syncProvider(expectedVersion: number) {
        if (expectedVersion !== this.lifecycleVersion) return;
        const mode = this.policy?.preferredMode ?? null;
        syncRuntimeState(this.state, mode);
        this.publishLockState();
    }

    /**
     * #1033 Part-2b: publish the authoritative lock + recovery state so the selector UI and the
     * Retry/Discard surfaces read the SAME truth the controller enforces — never their own guess.
     * `syncProvider` fires only on FSM transitions, but the recovery operations (retry / discard /
     * rehydrate / resolution) mutate the lock WITHOUT a transition — they must republish, or the banner
     * would linger and the selector stay locked after a successful retry/discard (and not appear after
     * a reload rehydration).
     */
    private publishLockState(): void {
        useSessionStore.getState().setEngineSelectionLock(this.isEngineSelectionLocked(), this.pendingResolutionKind());
    }

    /**
     * #891 Phase 5.6 (SHADOW): stand up the shadow MetricsEngine for a session. No-op in production
     * (createShadowMetricsEngine returns null). Wrapped so shadow telemetry can NEVER affect recording.
     */
    private startShadowMetricsEngine(sessionId: string, mode: string | null): void {
        try {
            this.disposeShadowMetricsEngine();
            this.liveFillerDataAtStop = null;
            this.lastFillerDivergenceReport = null;
            this.lastFillerArtifact = null;
            const tmode = toTelemetryMode(mode);
            if (!tmode) return;
            safeResetSessionTelemetry(sessionId);
            this.shadowEngine = createShadowMetricsEngine(sessionId, tmode, {
                userWords: this.userWords,
                sessionStartT: performance.now(),
            });
        } catch {
            /* shadow telemetry must never affect the recording path */
        }
    }

    /**
     * #891 Phase 5.7: confirm the ACTUAL negotiated/service mode on the provisional shadow engine and
     * activate mode filtering — everything captured while provisional (incl. early fallback-mode events)
     * is preserved. Prefer the live service mode; fall back to the requested mode only if unavailable.
     */
    private bindShadowMode(mode: string | null): void {
        try {
            if (!this.shadowEngine) return;
            const tmode = toTelemetryMode(this.service?.getMode?.() ?? mode);
            if (tmode) this.shadowEngine.bindMode(tmode);
        } catch {
            /* shadow telemetry must never affect the recording path */
        }
    }

    /**
     * #891 Phase 5.7: bind the real DB session id into an already-running shadow engine WITHOUT resetting —
     * everything captured since the early (provisional-id) start is preserved — and confirm the actual mode.
     */
    private rebindShadowSession(sessionId: string, mode: string | null): void {
        try {
            if (!this.shadowEngine) return;
            this.shadowEngine.setSessionId(sessionId);
            this.bindShadowMode(mode);
        } catch {
            /* shadow telemetry must never affect the recording path */
        }
    }

    private disposeShadowMetricsEngine(): void {
        try {
            this.shadowEngine?.dispose();
        } catch {
            /* ignore */
        }
        this.shadowEngine = null;
    }

    /** #891 Phase 5.6: diagnostics/tests only — the shadow snapshot is NOT consumed by any product surface. */
    public getShadowMetricsSnapshot(): ReturnType<MetricsEngine['getSnapshot']> | null {
        return this.shadowEngine?.getSnapshot() ?? null;
    }

    /**
     * #891 Phase 5.7 (SHADOW): compare the shadow snapshot against the legacy product metrics computed
     * from the same raw store inputs. Diagnostics/tests only — the parity report (numbers only, no
     * transcript text) is NOT consumed by any product surface and drives no cutover.
     */
    public getShadowParityReport(): ParityReport | null {
        const snapshot = this.shadowEngine?.getSnapshot();
        if (!snapshot) return null;
        const st = useSessionStore.getState();
        const legacy = computeLegacyMetrics({
            transcript: st.transcript.transcript,
            elapsedSeconds: st.elapsedTime,
            fillerData: st.fillerData,
            pauseMetrics: st.pauseMetrics,
            engine: snapshot.mode,
            userWords: this.userWords,
        });
        return compareSnapshotToLegacy(snapshot, legacy);
    }

    /**
     * #891 Phase 5.8 PRECURSOR (SHADOW): the filler divergence report computed AT FINALIZATION over the
     * save-selected finalTranscript (live counter snapshotted before the finalize store-correction). Cached,
     * so it does NOT depend on the shadow engine still being alive after stop. Numbers only — no transcript
     * text. Diagnostics/tests only; drives no cutover and changes no product behavior.
     */
    public getFillerDivergenceReport(): FillerDivergenceReport | null {
        return this.lastFillerDivergenceReport;
    }

    /**
     * #891 Phase 5.8 Step 1 — DEV/TEST-ONLY sanitized filler artifact for the owner known-script take.
     * Returns null in production (gated on isShadowMetricsEngineEnabled). Numbers-only: custom words are
     * anonymized (custom_N) and no transcript text is present. Diagnostics only; no product behavior.
     */
    public getSanitizedFillerArtifact(): SanitizedFillerArtifact | null {
        if (!isShadowMetricsEngineEnabled()) return null;
        return this.lastFillerArtifact;
    }

    private logShadowParity(): void {
        try {
            const report = this.getShadowParityReport();
            if (!report) return;
            logger.info(
                { allEqual: report.allEqual, divergentCount: report.divergentCount, fields: report.fields },
                '[SHADOW_PARITY] snapshot vs legacy (numbers only)',
            );
        } catch {
            /* diagnostics must never affect the stop path */
        }
    }

    public async startRecording(policy?: TranscriptionPolicy, userWords: string[] = []): Promise<void> {
        // #1033: do not start a new recording while a prior recording is unresolved — a pending attribution
        // retry, OR a recording that began and failed post-start without a durable save. Its identity must be
        // resolved (Retry Save) or explicitly discarded first. This bounds the system to AT MOST ONE
        // unresolved recording, so the single retry slot / unresolved signal can never be clobbered.
        if (this.pendingAttributionRetry || this.pendingFullSaveRetry || this.recordingStartedUnresolved) {
            logger.warn({ pendingSession: (this.pendingFullSaveRetry ?? this.pendingAttributionRetry)?.sessionId ?? null, kind: this.pendingResolutionKind(), unresolved: this.recordingStartedUnresolved }, '[controller] startRecording blocked: prior recording unresolved (#1033)');
            useSessionStore.getState().setSTTStatus({ type: 'error', message: 'Finish saving your previous recording before starting a new one.' });
            return;
        }
        // #1033: lock engine selection SYNCHRONOUSLY at Start intent — before any async enqueue reaches
        // INITIATING — so a rapid engine change right after Start cannot win the race. Released in transition().
        this.engineSelectionIntentLocked = true;
        // This take has no persisted row yet. Clear the previous take synchronously so a report opened
        // during setup/start cannot inherit stale session correlation.
        clearPrivateRecordingIdentity();
        this.policy = policy || null;
        this.userWords = userWords;
        // A new recording supersedes any prior stop's pending finalization: bump the finalize token so a
        // still-in-flight formatter/metrics callback from the previous session cannot publish or mutate
        // this one, and clear the prior finalized signal so its settled UI (toast/cue/copy) does not linger.
        this.finalizeSequence++;
        useSessionStore.getState().setFinalizedAnalysis(null);
        // #1046 slice 5a: a new recording also clears any prior Focus Points coverage rail, so the
        // settled UI from an earlier objective session never lingers onto this one (mirrors the
        // finalizedAnalysis clear above; the brief itself is consumed separately at the stop seam).
        useSessionStore.getState().setObjectiveCoverageResult(null);
        const recordingId = crypto.randomUUID();
        this.currentRecordingId = recordingId;
        pushNativeRuntimeTrace('controller_start_requested', {
            recordingId,
            state: this.state,
            policyMode: policy?.preferredMode ?? null,
            lifecycleVersion: this.lifecycleVersion,
        });

        return this.enqueue(async (_token) => {
            pushNativeRuntimeTrace('controller_start_queue_enter', {
                recordingId,
                state: this.state,
                tokenVersion: _token.version,
                lifecycleVersion: this.lifecycleVersion,
                currentRecordingId: this.currentRecordingId,
            });
            if (this.currentRecordingId !== recordingId) {
                pushNativeRuntimeTrace('controller_start_skip_superseded_recording', {
                    recordingId,
                    currentRecordingId: this.currentRecordingId,
                });
                return;
            }

            if (this.state === 'FAILED_VISIBLE' || this.state === 'TERMINATED') {
                this.resetEphemeralState('retry_after_start_failure');
                this.state = 'IDLE';
                this.lock.updateState('IDLE');
                useSessionStore.getState().setRuntimeState('IDLE');
            }

            if (this.state !== 'READY' && this.state !== 'IDLE' && this.state !== 'FAILED') {
                pushNativeRuntimeTrace('controller_start_skip_bad_state', {
                    state: this.state,
                });
                // #1033 item 4: this Start is aborting before any transition (no INITIATING → no lifecycle-state
                // lock yet). Release the synchronous Start-intent lock so it can't leak. If another recording is
                // genuinely active it stays locked via RECORDING_LIFECYCLE_STATES; a stale/double Start does not.
                this.engineSelectionIntentLocked = false;
                return;
            }

            if (this.state === 'FAILED') {
                this.resetEphemeralState();
            }

            const version = this.lifecycleVersion;
            if (version !== this.lifecycleVersion) {
                pushNativeRuntimeTrace('controller_start_skip_version_changed_before_service', {
                    version,
                    lifecycleVersion: this.lifecycleVersion,
                });
                // #1033 item 4: aborting before the INITIATING transition — release the Start-intent lock.
                this.engineSelectionIntentLocked = false;
                return;
            }

            if (this.service?.isServiceDestroyed()) {
                pushNativeRuntimeTrace('controller_start_service_destroyed_reset');
                this.service = null;
            }

            if (!this.service) {
                pushNativeRuntimeTrace('controller_start_create_service');
                this.service = getTranscriptionService(
                    createControllerOwnedServiceCallbacks(this.subscriberCallbacks, this.serviceCallbacks as Required<typeof this.serviceCallbacks>),
                    this.lock
                );
            }

            pushE2EEvent('SR_START_ENTER');
            const acquired = this.lock.acquire('INITIATING');
            pushNativeRuntimeTrace('controller_lock_acquire_result', {
                acquired,
                state: this.state,
            });
            pushE2EEvent('SR_LOCK_ACQUIRED');
            if (!acquired) {
                useSessionStore.getState().setSTTStatus({
                    type: 'error',
                    message: '⛔ Active session in another tab.'
                });
                await this.transition('FAILED', undefined, _token);
                return;
            }

            this.resetAnalysisStateForNewRecording();

            await this.transition('INITIATING', undefined, _token);
            pushNativeRuntimeTrace('controller_transition_initiating_done', {
                tokenCancelled: _token.cancelled,
                tokenVersion: _token.version,
                lifecycleVersion: this.lifecycleVersion,
            });
            pushE2EEvent('SR_AFTER_INITIATING');
            if (_token.cancelled || _token.version !== this.lifecycleVersion) {
                pushNativeRuntimeTrace('controller_start_abort_after_initiating', {
                    tokenCancelled: _token.cancelled,
                    tokenVersion: _token.version,
                    lifecycleVersion: this.lifecycleVersion,
                });
                await this.transition('READY', undefined, _token);
                return;
            }

            const mode = this.policy?.preferredMode || 'private';
            if (this.service) {
                pushNativeRuntimeTrace('controller_warmup_start', { mode });
                await this.service.warmUp(mode);
                pushNativeRuntimeTrace('controller_warmup_done', { mode });
                pushE2EEvent('SR_AFTER_WARMUP');
                pushE2EEvent('SR_TOKEN_CHECK', {
                    cancelled: _token.cancelled,
                    tokenVersion: _token.version,
                    lifecycleVersion: this.lifecycleVersion
                });
                if (_token.cancelled || _token.version !== this.lifecycleVersion) {
                    pushE2EEvent('SR_ABORT_TOKEN');
                    pushNativeRuntimeTrace('controller_start_abort_after_warmup', {
                        tokenCancelled: _token.cancelled,
                        tokenVersion: _token.version,
                        lifecycleVersion: this.lifecycleVersion,
                    });
                    await this.transition('READY', undefined, _token);
                    return;
                }

                const strategy = this.service.getStrategy();
                if (strategy && 'start' in strategy && 'stop' in strategy) {
                    validateEngine(strategy as unknown as STTEngine);
                }
            }

            const service = this.service;
            if (!service) throw new Error('SERVICE_MISSING');

            // #1033 (1): resolve the authenticated OWNER and arm the initial-save recovery context BEFORE
            // `startTranscription()` — i.e. before the engine/microphone can produce a single transcript
            // callback. Moving this after startTranscription (or merely before the RECORDING transition) would
            // leave a window in which speech is produced with no owner to bind a recovery draft/retry to.
            // `getSession()` reads the local session, so this does not delay the mic meaningfully.
            const supabase = getSupabaseClient();
            pushNativeRuntimeTrace('controller_supabase_session_start');
            const { data: { session: authSession } } = await supabase.auth.getSession();
            pushNativeRuntimeTrace('controller_supabase_session_done', {
                hasUser: Boolean(authSession?.user?.id),
            });
            if (_token.cancelled || _token.version !== this.lifecycleVersion) {
                await this.transition('READY', undefined, _token);
                return;
            }
            const userId = authSession?.user?.id;
            this.capturedUserId = userId || null;
            // Owner-bound recovery contract for the pre-session window (row does not exist yet). Carries this
            // recording's idempotency identity so a later initial-save retry can never create a duplicate row.
            this.pendingInitialSaveContext = userId
                ? { userId, recordingId, mode: this.policy?.preferredMode ?? mode }
                : null;

            pushE2EEvent('SR_BEFORE_ENGINE_INIT');
            pushNativeRuntimeTrace('controller_transition_engine_initializing_start');
            await this.transition('ENGINE_INITIALIZING', undefined, _token);
            pushNativeRuntimeTrace('controller_transition_engine_initializing_done');
            pushE2EEvent('SR_AFTER_ENGINE_INIT');

            try {
                pushE2EEvent('SR_BEFORE_START_TRANSCRIPTION');
                pushNativeRuntimeTrace('controller_service_startTranscription_start', {
                    mode: policy?.preferredMode ?? null,
                });
                // #891 Phase 5.7 (SHADOW): stand up the shadow engine BEFORE the strategy starts, using a
                // provisional id (recordingId) + the preferred mode, so no early transcript/audio/lifecycle
                // event is missed. The real DB id + negotiated mode are rebound below WITHOUT resetting the
                // captured state. No-op in production.
                this.startShadowMetricsEngine(recordingId, mode);

                // #1161 (Option 2 — pre-session intent): record the client-DECLARED engine mode + model as an
                // immutable, server-RECORDED intent BEFORE the producing engine can start or capture a sample.
                // This is a DECLARATION, not proof of execution (Private and Browser both run client-side; Browser
                // is externally processed, never an on-device claim). It registers a pre-session INTENT keyed on
                // the recording id — it creates NO session row, so a recording that never reaches RECORDING
                // persists nothing (the #1033 discard safeguard is preserved). The session is created only AFTER
                // RECORDING is confirmed (below), where the intent is atomically BOUND to it. AWAITED so capture
                // cannot begin before the declaration is recorded; errors are surfaced (logged), never discarded —
                // fail-closed ⇒ the session resolves definitively unattributed later, recording unaffected. The
                // class/model come from the REQUESTED mode; attest checks the reported runtime for CONSISTENCY, so
                // a divergent runtime resolves unattributed. Cloud registers no intent.
                if (userId && mode === 'private') {
                    try {
                        const reg = await getSupabaseClient().functions.invoke('attest-session-engine', {
                            // Engine type travels in the authenticated request HEADER, never the (client-controlled)
                            // payload — the Edge rejects a payload override. Private is the primary path; Browser is
                            // the secondary, containment-only class.
                            headers: { 'X-SpeakSharp-Engine-Type': mode === 'private' ? 'private' : 'browser' },
                            body: {
                                op: 'register',
                                recordingKey: recordingId,
                                expectedModel: mode === 'private' ? resolvePrivateModel() : null,
                            },
                        });
                        if (reg?.error) logger.warn({ err: reg.error, recordingId }, '[controller] pre-recording attribution intent failed — session will be unattributed');
                    } catch (e) {
                        logger.warn({ e, recordingId }, '[controller] pre-recording attribution intent threw — session will be unattributed');
                    }
                }

                await service.startTranscription(policy, userWords);
                // #891 Phase 5.7 (SHADOW): the negotiated/actual mode is now settled — bind it so the shadow
                // engine filters by the REAL mode (not the requested one), keeping the early events it
                // captured while provisional. rebindShadowSession re-confirms it at the DB-id step below.
                this.bindShadowMode(mode);
                pushNativeRuntimeTrace('controller_service_startTranscription_done');
                pushE2EEvent('SR_AFTER_START_TRANSCRIPTION');
                const serviceState = typeof service.getState === 'function'
                    ? service.getState()
                    : (service.fsm?.is('RECORDING') ? 'RECORDING' : 'UNKNOWN');
                if (serviceState !== 'RECORDING') {
                    // #P1-observability: surface the underlying engine-start leaf (mic / AudioWorklet /
                    // engine-init) as the wrapper's `cause` so the app-layer Sentry capture
                    // (useSessionLifecycle) shows the ROOT cause, not only this generic wrapper.
                    //
                    // PRIVACY: attach ONLY a REDACTED clone. The raw leaf must never become the cause —
                    // Sentry serializes Error.cause as a linked exception, which would ship the raw
                    // message/stack and bypass sanitizeStartError. toSanitizedCause() scrubs
                    // name/message/stack first. `.cause` is set as a property (not the ctor option) to
                    // stay ES2020-safe. The raw leaf stays inside TranscriptionService (getStartError).
                    const wrapper = new Error(`TRANSCRIPTION_START_DID_NOT_RECORD:${serviceState}`);
                    const rawLeaf = (service as { getStartError?: () => Error | null }).getStartError?.();
                    const safeCause = toSanitizedCause(rawLeaf);
                    if (safeCause) (wrapper as Error & { cause?: unknown }).cause = safeCause;
                    throw wrapper;
                }
                // #1033 (4): the service has CONFIRMED it is recording — latch the producing engine now. This
                // is the immutable identity of this recording: later service callbacks reporting another mode
                // are rejected, and final attribution must match it. Cleared on save / confirmed discard / the
                // next recording's start boundary.
                this.recordingEngineMode = (service.getMode?.() as TranscriptionMode | null | undefined) ?? mode;
                pushNativeRuntimeTrace('controller_producer_latched', { latchedMode: this.recordingEngineMode });

                this.isEmissionsSafe = true;
                if (_token.cancelled || _token.version !== this.lifecycleVersion) {
                    await this.transition('READY', undefined, _token);
                    return;
                }

                if (service && service.fsm?.is('DOWNLOAD_REQUIRED')) {
                    this.setEngineReady(false);
                    this.service = null;
                    await this.transition('READY', undefined, _token);
                    return;
                }
                this.setEngineReady(true);
                this.isEmissionsSafe = true;
                // (Owner + initial-save recovery context were established BEFORE startTranscription — #1033 (1).)
                pushNativeRuntimeTrace('controller_recording_invariant_start');
                await this.checkRecordingInvariant();
                pushNativeRuntimeTrace('controller_recording_invariant_done');

                if (userId) {
                    // #1033 / #1161 (Option 2): the session is persisted ONLY here — after RECORDING is CONFIRMED
                    // (past the not-recording throw + DOWNLOAD_REQUIRED early-return above) — so a start that never
                    // reaches recording creates no session. The negotiated/actual mode is now settled.
                    const negMode = service.getMode() || 'unknown';
                    const idempotencyKey = recordingId;
                    // #1320: Private is the only customer engine — the metadata fallback reflects it (no Web-Speech).
                    const metadata = service.getMetadata?.() || { engineVersion: 'transformers-js', modelName: resolvePrivateModel(), deviceType: 'browser' };

                    // #1161 (finding 6): enrich the initial-save recovery context with the SAME engine provenance
                    // this save uses, so an initial-save RETRY recreates the row with identical engine identity.
                    if (this.pendingInitialSaveContext && this.pendingInitialSaveContext.userId === userId) {
                        this.pendingInitialSaveContext = {
                            ...this.pendingInitialSaveContext, mode: negMode,
                            engineVersion: metadata.engineVersion, modelName: metadata.modelName, deviceType: metadata.deviceType,
                        };
                    }

                    this.updateSessionPersisted(false);
                    pushNativeRuntimeTrace('controller_placeholder_save_start', { mode: negMode });
                    const saveResult = await saveSession(
                        { user_id: userId, title: `Session ${new Date().toISOString()}`, duration: 0, total_words: 0, engine: negMode },
                        { id: userId } as UserProfile, negMode, idempotencyKey, metadata);
                    pushNativeRuntimeTrace('controller_placeholder_save_done', {
                        hasDbSession: Boolean(saveResult?.session), usageExceeded: Boolean(saveResult?.usageExceeded),
                    });
                    const dbSession = saveResult?.session;

                    if (dbSession) {
                        this.sessionId = dbSession.id;
                        this.applyPrivateTelemetryContext();
                        // #1161 (Option 2): ATOMICALLY bind the pre-session intent (registered before start) to the
                        // session this recording just produced. AWAITED; a bind failure/miss ⇒ the session resolves
                        // definitively unattributed later (no authority); recording unaffected. Only local trusted
                        // engines registered an intent, so only they bind. Cloud never binds.
                        if (negMode === 'private') {
                            try {
                                const bind = await getSupabaseClient().functions.invoke('attest-session-engine', {
                                    body: { op: 'bind', sessionId: dbSession.id, recordingKey: recordingId },
                                });
                                if (bind?.error) logger.warn({ err: bind.error, sessionId: dbSession.id }, '[controller] attribution intent bind failed — session will be unattributed');
                            } catch (e) {
                                logger.warn({ e, sessionId: dbSession.id }, '[controller] attribution intent bind threw — session will be unattributed');
                            }
                        }
                        // #1033 (1): the row now EXISTS — the pre-session initial-save window is closed.
                        this.pendingInitialSaveContext = null;
                        // #891 Phase 5.7 (SHADOW): bind the real DB id + negotiated mode into the already-running
                        // shadow engine WITHOUT resetting — events captured since the early start are preserved.
                        this.rebindShadowSession(this.sessionId, negMode);
                    }

                    if (_token.cancelled || _token.version !== this.lifecycleVersion) {
                        await this.transition('READY', undefined, _token);
                        return;
                    }

                    if (saveResult?.usageExceeded) {
                        throw new Error(`Usage limit exceeded${saveResult.usageError ? `: ${saveResult.usageError}` : ''}`);
                    }

                    const currentState = this.getState();
                    if (dbSession && service && (
                        currentState === 'RECORDING' ||
                        currentState === 'ENGINE_INITIALIZING' ||
                        currentState === 'STOPPING'
                    )) {
                        service.setSessionId?.(dbSession.id);
                        this.startHeartbeat(dbSession.id, service);
                    }
                }
            } catch (err: unknown) {
                this.isEmissionsSafe = false;
                await this.transition('FAILED', err as Error, _token);
                throw err;
            }
        });
    }

    /**
     * ✅ HARD RESET (Synchronous Barrier)
     * 1. version++, 2. Cancel tokens, 3. Clear activeTasks, 4. Clear Queue
     */
    public reset(reason: string = 'manual'): void {
        if (reason === 'subscriber_unmount') {
            logger.debug('[SpeechRuntimeController] Soft reset: Detaching subscriber (preserving engine)');
            if (this.serviceUnsubscribe) {
                this.serviceUnsubscribe();
                this.serviceUnsubscribe = null;
            }
            return;
        }

        logger.warn({ reason, state: this.state }, '[SpeechRuntimeController] HARD RESET triggered');

        // 1. Monotonic Boundary Cut (FIRST)
        this.lifecycleVersion++;

        // #1033: a HARD reset (navigation/logout/account change/manual) must clear the engine-selection lock
        // and any unresolved-attribution retry so state cannot leak across users/sessions. (The soft
        // 'subscriber_unmount' reset returns earlier and PRESERVES an in-flight recovery.)
        this.engineSelectionIntentLocked = false;
        this.markRecordingResolved();
        this.pendingAttributionRetry = null;
        this.pendingFullSaveRetry = null;
        this.recordingProgressMode = { mode: 'unknown' };

        // 2. Cancel tokens & Clear registry
        this.activeTasks.forEach(t => t.cancelled = true);
        this.activeTasks.clear();

        // 3. Reset Queue
        this.commandQueue = Promise.resolve();

        // 4. Fire-and-forget destruction
        const svc = this.service;
        this.service = null;
        if (svc) {
            this.stopWatchdog();
            this.stopHeartbeat();
            svc.destroy().catch((destroyError) => {
                logger.warn({
                    destroyError,
                    reason,
                    state: this.state,
                    lifecycleVersion: this.lifecycleVersion,
                }, '[SpeechRuntimeController] Service destroy failed during hard reset');
            });
        }

        this.serviceUnsubscribe = null;
        this.setEngineReady(false);
        this.resetTranscriptLifecycle();
        syncRuntimeState('IDLE', null);
        useSessionStore.getState().setRuntimeState('IDLE');
        this.updateSessionPersisted(false);
        syncProfileReady(false);
        this.initialized = false;
        this.readyPromise = null;
        this.isSubscriberReady = false;
        this.resetEphemeralState(reason);

        void this.transition('TERMINATED');
        void this.transition('IDLE');
    }

    private resetEphemeralState(reason: string = 'unknown'): void {
        if (!(ENV.isE2E && reason === 'subscriber_unmount')) {
            this.emissionQueue = [];
        }
        this.historyQueue = [];
        this.isEmissionsSafe = false;
        this.isSubscriberReady = false;
        useReadinessStore.getState().resetRouterReady();
    }

    public async stopRecording(): Promise<unknown> {
        // #891 Phase 5.7: the shadow engine is torn down AFTER finalize (see below), not here, so its
        // snapshot includes the committed final transcript before parity is measured. A leftover engine
        // is always disposed by the next startShadowMetricsEngine.
        return this.enqueue(async (token) => {
            const stopEntryMode = this.service?.getMode?.() ?? this.policy?.preferredMode ?? null;

            const canStop =
                this.state === 'RECORDING' ||
                this.state === 'ENGINE_INITIALIZING' ||
                this.state === 'INITIATING' ||
                this.state === 'FAILED' ||
                this.state === 'FAILED_VISIBLE';

            if (!canStop) {
                return null;
            }
            const stopSnapshotStore = useSessionStore.getState();
            const frozenAtStop = this.freezeTranscriptLifecycleAtStop();
            pushTranscriptLifecycleTrace('lifecycle:stop', {
                mode: stopEntryMode,
                visibleAtStopLength: frozenAtStop.length,
                committedLength: stopSnapshotStore.transcript.transcript.length,
                partialLength: stopSnapshotStore.transcript.partial.length,
                preview: frozenAtStop.slice(0, 80),
            });
            const wasRecording = this.state === 'RECORDING';
            // #1089: this sits OUTSIDE the try below, and setTranscriptFinalizing(true) has already run.
            // A throw here would leave finalization latched true forever — and finalization now disables
            // the record control, so that is an unrecoverable lockout rather than a cosmetic flag leak.
            try {
                await this.transition('STOPPING', undefined, token);
            } catch (transitionError) {
                useSessionStore.getState().setTranscriptFinalizing(false);
                useSessionStore.getState().freezeTranscriptAtStop(null);
                throw transitionError;
            }
            if (token.cancelled || token.version !== this.lifecycleVersion) {
                useSessionStore.getState().setTranscriptFinalizing(false);
                useSessionStore.getState().freezeTranscriptAtStop(null);
                return null;
            }
            try {
                this.stopHeartbeat();
                this.stopWatchdog();
                const service = this.service;
                let sessionCompleted = false;
                if (!service) {
                    await this.transition('READY', undefined, token);
                    useSessionStore.getState().setTranscriptFinalizing(false);
                    useSessionStore.getState().freezeTranscriptAtStop(null);
                    return null;
                }

                let result = null;
                let guardedStopStatus: SttStatus | null = null;
                // Identity-bearing persisted-session marker (blocker #5): captured on
                // successful completion so the post-READY persistence write can carry
                // the exact session id + mode for proofs (data-session-persisted-id).
                let persistedSessionMarker: { sessionId: string; mode: string | null } | null = null;
                logger.info({ wasRecording, state: this.state, sessionId: this.sessionId }, '[DEBUG-STOP] state-check');
                if (wasRecording) {
                    let sessionId = this.sessionId;
                    const startTime = service.getStartTime();
                    // #891 Phase 5.8 precursor (SHADOW): snapshot the LIVE filler counts NOW, before
                    // stopTranscription()'s committed final can re-correct/normalize the store transcript
                    // (and any downstream filler recompute). This is the "live counter" side of the divergence.
                    // DEFENSIVE DEEP COPY: the store may later mutate/replace fillerData in place, so clone the
                    // counts — the snapshot must not drift afterward.
                    this.liveFillerDataAtStop = cloneFillerCounts(useSessionStore.getState().fillerData) ?? null;
                    // #metrics-duration: the persisted/scored session duration must be the SPOKEN
                    // recording length (start → stop), captured NOW — BEFORE the post-Stop finalize
                    // decode below, which can take tens of seconds on Private. Computing duration at
                    // save time (after the await) folds the finalize wait into the session length, so
                    // pace/WPM divide by an inflated denominator and misclassify the user (a 5:00 take
                    // showed 6:28 / 132 WPM instead of ~169). The finalize wall-clock stays separate
                    // (telemetry / __PRIVATE_TIMING__ / proof) and is NOT a session-length input.
                    const recordingStoppedAt = Date.now();
                    const recordingDurationSeconds = startTime ? Math.max(0, (recordingStoppedAt - startTime) / 1000) : 0;
                    // #1089: publish the SAME authoritative spoken length the DB receives, so every post-save
                    // surface (WPM, pace, coaching score, the review header) has a durable denominator that
                    // survives the live timer being reset to 00:00 for the next recording.
                    useSessionStore.getState().setCompletedSessionDuration(Math.round(recordingDurationSeconds));
                    // #1033: snapshot the producing-engine identity from the LIVE engine, BEFORE
                    // stopTranscription() can mutate/destroy engine metadata. Used for durable attribution.
                    const finalizingIdentity = this.captureFinalizingIdentity(service, service.getMode?.() ?? stopEntryMode);
                    // #1161: derive the server attestation evidence NOW (before stopTranscription destroys engine
                    // metadata). null ⇒ no trusted local identity (unverified/Cloud) ⇒ no authority is produced.
                    const attestationEvidence = SpeechRuntimeController.evidenceFromIdentity(finalizingIdentity);
                    // #1089 BOUNDED FINALIZATION. stopTranscription() runs the whole-utterance decode and
                    // has no internal ceiling; the watchdog was stopped just above. Because Finalizing…
                    // now disables the record control, a hang here means the user cannot start, stop or
                    // recover without reloading the page — and the 300s -> 600s cap doubled the exposure.
                    // On expiry we throw into the EXISTING catch, which transitions to FAILED, clears the
                    // finalizing latch and surfaces the recovery draft the user already spoke.
                    let finalizeTimer: ReturnType<typeof setTimeout> | undefined;
                    try {
                        result = await Promise.race([
                            service.stopTranscription(),
                            new Promise<never>((_, reject) => {
                                finalizeTimer = setTimeout(
                                    () => reject(new FinalizationTimeoutError(PRIV_STT.FINALIZE_HARD_TIMEOUT_MS)),
                                    PRIV_STT.FINALIZE_HARD_TIMEOUT_MS,
                                );
                            }),
                        ]);
                    } finally {
                        if (finalizeTimer !== undefined) clearTimeout(finalizeTimer);
                    }
                    logger.info({
                        mode: service.getMode?.() ?? stopEntryMode,
                        sessionId,
                        hasResult: Boolean(result),
                        resultSuccess: result?.success ?? null,
                        resultTranscriptLength: result?.transcript?.length ?? 0,
                        resultTotalWords: result?.stats?.total_words ?? null,
                        resultAccuracy: result?.stats?.accuracy ?? null,
                        storeTranscriptLength: this.getStoreTranscriptLength(),
                        storePartialLength: useSessionStore.getState().transcript.partial.length,
                        chunkCount: useSessionStore.getState().chunks.length,
                        controllerState: this.state,
                        serviceState: service.getState?.() ?? null,
                    }, '[DEBUG-STOP] after service.stopTranscription');

                    // #891 Phase 5.7 (SHADOW, dev-only): the committed final has now flowed through the
                    // choke point into the shadow engine, so its snapshot is complete. Measure shadow↔legacy
                    // parity (NUMBERS ONLY — no transcript text) and dispose. Fully wrapped; never affects stop.
                    this.logShadowParity();
                    this.disposeShadowMetricsEngine();

                    if (token.cancelled) {
                        logger.warn({
                            mode: service.getMode?.() ?? stopEntryMode,
                            sessionId,
                        resultSuccess: result?.success ?? null,
                        resultTranscriptLength: result?.transcript?.length ?? 0,
                        storeTranscriptLength: this.getStoreTranscriptLength(),
                    }, '[DEBUG-STOP] Stop token was cancelled after stop result; continuing finalization for captured session');
                    }
                    if (token.version !== this.lifecycleVersion) {
                        logger.warn({
                            mode: service.getMode?.() ?? stopEntryMode,
                            sessionId,
                            tokenVersion: token.version,
                            lifecycleVersion: this.lifecycleVersion,
                            resultSuccess: result?.success ?? null,
                            resultTranscriptLength: result?.transcript?.length ?? 0,
                            storeTranscriptLength: this.getStoreTranscriptLength(),
                        }, '[DEBUG-STOP] Lifecycle version changed after stop result; continuing session finalization for captured session');
                    }

                    if (result && !sessionId) {
                        const supabase = getSupabaseClient();
                        const { data: { session } } = await supabase.auth.getSession();
                        const userId = session?.user?.id || this.capturedUserId;

                        if (userId) {
                            const mode = service.getMode() || stopEntryMode || 'unknown';
                            const duration = recordingDurationSeconds; // spoken recording length — excludes post-Stop finalize (see recordingStoppedAt above)
                            // #1320: Private is the only customer engine — the metadata fallback reflects it (no Web-Speech).
                            const metadata = service.getMetadata?.() || { engineVersion: 'transformers-js', modelName: resolvePrivateModel(), deviceType: 'browser' };
                            this.syncTranscriptLifecycleFromStore();
                            const fallbackTranscript =
                                result.transcript?.trim() ||
                                this.transcriptLifecycle.lastVisibleTranscriptAtStop ||
                                this.transcriptLifecycle.visibleTranscript ||
                                this.transcriptLifecycle.bestMeaningfulPartial ||
                                ' ';
                            const fallbackSessionData = {
                                user_id: userId,
                                title: `Session ${new Date().toISOString()}`,
                                duration: Math.round(duration),
                                transcript: fallbackTranscript,
                                total_words: 0,
                                engine: mode,
                            };
                            const saveResult = await saveSession(
                                fallbackSessionData,
                                { id: userId } as UserProfile,
                                mode,
                                undefined,
                                metadata
                            );

                            if (saveResult?.session?.id) {
                                sessionId = saveResult.session.id;
                                this.sessionId = sessionId;
                                this.applyPrivateTelemetryContext();
                                service.setSessionId?.(sessionId);
                                logger.warn({ sessionId, mode }, '[DEBUG-STOP] Recovered missing sessionId with late session create');
                            }

                            if (saveResult?.usageExceeded) {
                                throw new Error(`Usage limit exceeded${saveResult.usageError ? `: ${saveResult.usageError}` : ''}`);
                            }
                        }
                    }

                    logger.info({
                        mode: service.getMode?.() ?? stopEntryMode,
                        sessionId,
                        hasResult: Boolean(result),
                        willEnterFinalizationBranch: Boolean(result && sessionId),
                        reasonIfNot: !result ? 'missing_stop_result' : !sessionId ? 'missing_session_id' : null,
                    }, '[DEBUG-STOP] before result/session branch');

                    if (result && sessionId) {
                        const duration = recordingDurationSeconds; // spoken recording length — excludes post-Stop finalize (see recordingStoppedAt above)
                        this.syncTranscriptLifecycleFromStore();
                        const store = useSessionStore.getState();
                        const chunkTranscript = store.chunks.map(chunk => chunk.transcript).join(' ').trim();
                        const storeTranscript = store.transcript.transcript.trim();
                        const storePartialTranscript = store.transcript.partial.trim();
                        const visibleStoreTranscript = [storeTranscript, storePartialTranscript]
                            .filter(Boolean)
                            .join(' ')
                            .trim();
                        const frozenStopTranscript = store.frozenTranscriptAtStop?.trim() || '';
                        const resultTranscript = result.transcript?.trim() || '';
                        const modeForFinalization = service.getMode?.() ?? stopEntryMode;
                        const candidates: Array<{ source: TranscriptLifecycleSource; text: string }> = [
                            { source: 'service_result', text: resultTranscript },
                            { source: 'committed_final', text: this.transcriptLifecycle.committedFinal || chunkTranscript || storeTranscript },
                            { source: 'visible_snapshot', text: this.transcriptLifecycle.lastVisibleTranscriptAtStop || frozenStopTranscript },
                            { source: 'best_meaningful_partial', text: this.transcriptLifecycle.bestMeaningfulPartial || storePartialTranscript },
                            { source: 'store_visible_snapshot', text: visibleStoreTranscript },
                        ];
                        const preparedCandidates = candidates
                            .map(candidate => ({ ...candidate, text: candidate.text.trim() }))
                            .filter(candidate => Boolean(candidate.text));
                        // #1320: Native/Web-Speech is retired, so the Native-only save-quality gate is gone —
                        // Private candidate selection is purely "has meaningful transcript text".
                        const selectedCandidate =
                            preparedCandidates.find(candidate => hasMeaningfulTranscriptText(candidate.text)) ??
                            preparedCandidates[0] ??
                            { source: 'empty' as const, text: '' };
                        const finalTranscript = selectedCandidate.text
                            ? ensureTerminalPunctuation(selectedCandidate.text)
                            : '';
                        const saveCandidateReason = selectedCandidate.source;
                        this.transcriptLifecycle.selectedTranscriptForSave = finalTranscript || null;
                        this.transcriptLifecycle.selectedTranscriptSource = saveCandidateReason;
                        // #891 Phase 5.8 precursor (SHADOW, dev-only): measure the LIVE filler counter
                        // (snapshotted at stop-entry) vs the RECOUNT over the SAVE-SELECTED finalTranscript —
                        // the exact transcript + duration the save/scoring path uses — and CACHE it so the
                        // report survives shadow-engine disposal. Numbers only; no transcript text; no cutover.
                        if (isShadowMetricsEngineEnabled()) {
                            try {
                                const fillerReport = measureFillerDivergence({
                                    transcript: finalTranscript,
                                    elapsedSeconds: duration,
                                    liveFillerData: this.liveFillerDataAtStop,
                                    engine: modeForFinalization ?? undefined,
                                    userWords: this.userWords,
                                    selectedSource: saveCandidateReason,
                                });
                                this.lastFillerDivergenceReport = fillerReport;
                                // #891 Phase 5.8 Step 1: sanitized numbers-only artifact for the owner known-script
                                // take. The recount detail is derived from finalTranscript TRANSIENTLY (only counts
                                // are kept); custom words are anonymized to custom_N; no transcript text is stored.
                                this.lastFillerArtifact = buildSanitizedFillerArtifact({
                                    report: fillerReport,
                                    liveFillerData: this.liveFillerDataAtStop,
                                    recountFillerData: countFillerWords(finalTranscript, this.userWords),
                                    userWords: this.userWords,
                                });
                            } catch {
                                /* diagnostics must never affect the save path */
                            }
                        }
                        const meaningfulTranscript = finalTranscript
                            .replace(/\[(inaudible|blank_audio|music|applause|laughter|noise|mumbles)\]/gi, '')
                            .trim();
                        const meaningfulWordCount = meaningfulTranscript.split(/\s+/).filter(Boolean).length;
                        logger.info({
                            sessionId,
                            mode: service.getMode?.() ?? stopEntryMode,
                            duration,
                            resultSuccess: result.success ?? null,
                            resultTranscriptLength: resultTranscript.length,
                            chunkTranscriptLength: chunkTranscript.length,
                            storeTranscriptLength: storeTranscript.length,
                            storePartialTranscriptLength: storePartialTranscript.length,
                            visibleStoreTranscriptLength: visibleStoreTranscript.length,
                            frozenStopTranscriptLength: frozenStopTranscript.length,
                            saveCandidateReason,
                            finalTranscriptLength: finalTranscript.length,
                            finalWordCount: finalTranscript.split(/\s+/).filter(Boolean).length,
                            meaningfulWordCount,
                            fillerCount: getFillerTotal(store.fillerData),
                            userWordsCount: this.userWords.length,
                        }, '[DEBUG-STOP] finalization transcript decision');
                        // Expose the AUTHORITATIVE save-candidate decision so proof
                        // harnesses read ground truth instead of scraping the
                        // transcript-container DOM (which includes status/placeholder
                        // banners like "Processing speech locally…" / "Listening...").
                        // Surfaced via window.__SPEECH_RUNTIME_DEBUG__().saveCandidate.
                        // A+ repetition-risk DETECTOR (non-mutating): Whisper can loop phrases on
                        // short/ambiguous audio. Per the team's data-integrity decision we do NOT
                        // delete possibly-genuine repeats — we only FLAG the risk here for evidence/
                        // telemetry. The saved transcript is the raw model output, unaltered. The
                        // principled fix for the loops (VAD/segmentation) is a queued STT lane.
                        const repetitionRisk = detectRepetitionRisk(finalTranscript);
                        if (repetitionRisk.repetitionRisk) {
                            logger.warn({
                                sessionId,
                                mode: service.getMode?.() ?? stopEntryMode,
                                repetitionRiskReason: repetitionRisk.repetitionRiskReason,
                                repeatedSpanSummary: repetitionRisk.repeatedSpanSummary,
                            }, '[REPETITION_RISK] saved transcript shows a repetition-loop signature (flagged, not altered)');
                        }
                        this.lastSaveCandidateDebug = {
                            sessionId,
                            saveCandidateReason,
                            // #1306 P1: length only — the transcript text is NEVER placed in a diagnostic, in any
                            // build (test/E2E/real-device artifacts are inside the privacy boundary too).
                            selectedForSaveLength: finalTranscript.length,
                            finalWordCount: finalTranscript.split(/\s+/).filter(Boolean).length,
                            meaningfulWordCount,
                            resultTranscriptLength: resultTranscript.length,
                            chunkTranscriptLength: chunkTranscript.length,
                            storeTranscriptLength: storeTranscript.length,
                            storePartialTranscriptLength: storePartialTranscript.length,
                            visibleStoreTranscriptLength: visibleStoreTranscript.length,
                            frozenStopTranscriptLength: frozenStopTranscript.length,
                            candidateLengths: preparedCandidates.map((c) => ({ source: c.source, length: c.text.length })),
                            // Evidence-only repetition flags (never mutate saved text):
                            repetitionRisk: repetitionRisk.repetitionRisk,
                            repetitionRiskReason: repetitionRisk.repetitionRiskReason,
                            repeatedSpanSummary: repetitionRisk.repeatedSpanSummary,
                            capturedAt: Date.now(),
                        };
                        pushTranscriptLifecycleTrace('save:candidate', {
                            mode: service.getMode?.() ?? stopEntryMode,
                            selectedLength: finalTranscript.length,
                            reason: saveCandidateReason,
                            preview: finalTranscript.slice(0, 80),
                        });

                        if (meaningfulWordCount === 0) {
                            logger.warn({
                                sessionId,
                                transcriptLength: finalTranscript.length,
                                duration,
                                mode: modeForFinalization,
                                meaningfulWordCount,
                            }, '[SESSION_SAVE_GUARD] Empty or non-speech session discarded');

                            logger.info({
                                sessionId,
                                finalTranscriptLength: finalTranscript.length,
                                meaningfulWordCount,
                            }, '[DEBUG-STOP] completeSession failed-status starting');
                            await completeSession(sessionId, {
                                status: 'failed',
                                reason: 'No meaningful speech detected; session was not saved to history.'
                            });
                            logger.info({ sessionId }, '[DEBUG-STOP] completeSession failed-status done');
                            if (token.cancelled) {
                                logger.warn({
                                    mode: service.getMode?.() ?? stopEntryMode,
                                    sessionId,
                                }, '[DEBUG-STOP] Stop token cancelled after failed-session completion; preserving warning state');
                            }
                            if (token.version !== this.lifecycleVersion) {
                                logger.warn({
                                    mode: service.getMode?.() ?? stopEntryMode,
                                    sessionId,
                                    tokenVersion: token.version,
                                    lifecycleVersion: this.lifecycleVersion,
                                }, '[DEBUG-STOP] Lifecycle changed after failed-session completion; preserving user-facing warning');
                            }

                            guardedStopStatus = {
                                type: 'warning',
                                message: "We didn't detect enough speech to save this session.",
                                detail: 'Try recording again and speak for at least a few seconds.'
                            };
                            store.setSTTStatus(guardedStopStatus);
                            this.updateSessionPersisted(false);
                            store.setSessionSaved(false);
                            // #1033 (item 3): a no-speech / low-quality recording is RESOLVED by discard (nothing
                            // to Retry Save). The post-start lock is released uniformly at the normal stop terminal
                            // (transition READY below) for every non-error terminal, so no per-branch clear here.
                            result = null;
                        } else {
                            // #SSOT (Product Owner decision): the LIVE filler counter is canonical. Use the
                            // deep-cloned live snapshot captured at stop-entry (liveFillerDataAtStop, before
                            // any recompute) as the saved filler count/data + the clarity/score filler input.
                            // Word count/WPM still come from the final transcript. The transcript recount is
                            // DIAGNOSTIC/FALLBACK ONLY — used just when the live snapshot is absent/malformed.
                            const canonicalLiveFillers = isUsableFillerCounts(this.liveFillerDataAtStop)
                                ? this.liveFillerDataAtStop
                                : undefined;
                            if (!canonicalLiveFillers) {
                                logger.warn(
                                    { sessionId, mode: stopEntryMode },
                                    '[filler-ssot] live filler snapshot absent/malformed at save — falling back to transcript recount (diagnostic)',
                                );
                            }
                            const sessionMetrics = calculateCoreSessionMetrics({
                                transcript: finalTranscript,
                                durationSeconds: duration,
                                // Canonical live snapshot → filler count/data + clarity; undefined only on the
                                // fallback path, where calculateCoreSessionMetrics recounts the final transcript.
                                fillerData: canonicalLiveFillers,
                                userWords: this.userWords,
                            });
                            const fillerWords = sessionMetrics.fillerData;
                            const wordCount = sessionMetrics.wordCount;
                            const wpm = sessionMetrics.wpm;
                            const accuracy = result.stats.accuracy;
                            const clarityScore = sessionMetrics.clarityScore;
                            const currentStoreTranscript = useSessionStore.getState().transcript.transcript.trim();

                            if (store.chunks.length === 0) {
                                store.setChunks([{
                                    transcript: finalTranscript,
                                    timestamp: startTime || Date.now(),
                                    isFinal: true
                                }]);
                            } else if (finalTranscript && finalTranscript.length > store.transcript.transcript.length) {
                                const currentTranscript = store.transcript.transcript.trim();
                                const correctionSuffix = currentTranscript && finalTranscript.startsWith(currentTranscript)
                                    ? finalTranscript.slice(currentTranscript.length).trim()
                                    : '';

                                if (correctionSuffix) {
                                    store.appendChunk({
                                        transcript: correctionSuffix,
                                        timestamp: Date.now(),
                                        isFinal: true,
                                        isCorrection: true
                                    });
                                }
                            }
                            if (finalTranscript && finalTranscript !== currentStoreTranscript) {
                                store.updateTranscript(finalTranscript, '');
                                this.syncTranscriptLifecycleFromStore();
                                pushTranscriptLifecycleTrace('store:update', {
                                    type: 'selected_for_save',
                                    committedLength: useSessionStore.getState().transcript.transcript.length,
                                    partialLength: useSessionStore.getState().transcript.partial.length,
                                    preview: finalTranscript.slice(0, 80),
                                });
                            }

                            const supabase = getSupabaseClient();
                            const { data: { session } } = await supabase.auth.getSession();
                            const userId = session?.user?.id;

                            logger.info({
                                sessionId,
                                finalTranscriptLength: finalTranscript.length,
                                wordCount,
                                fillerCount: fillerWords.total.count,
                                wpm,
                                clarityScore,
                                accuracy,
                            }, '[DEBUG-STOP] completeSession completed-status starting');
                            // #1306 metrics-only: derive the CONTENT-FREE final payload from the in-memory
                            // transcript, then never persist the transcript itself. filler_counts is the strict
                            // flat standard-key map; next_action_signal is the one structured action.
                            const finalFillerCounts = flattenToFillerCounts(fillerWords);
                            // #1306 Option A: capture the FINAL validated metric snapshot (filler breakdown +
                            // headline count + word count) into DEDICATED store fields BEFORE the transcript is
                            // purged, so the terminal review reads THIS snapshot and never recounts (or retains)
                            // the transcript. These fields are separate from the live `fillerData` (which the live
                            // useFillerWords→store sync overwrites to `{}` once the chunks are purged). `fillerWords`
                            // (== sessionMetrics.fillerData) is the canonical nested per-key shape the review
                            // consumes; `sessionMetrics.fillerCount` is the true-filler headline.
                            useSessionStore.getState().setFinalizedWordCount(wordCount);
                            useSessionStore.getState().setFinalizedFillerData(fillerWords);
                            useSessionStore.getState().setFinalizedFillerCount(sessionMetrics.fillerCount);
                            const PAUSE_KEYS = ['totalPauses', 'averagePauseDuration', 'longestPause', 'pausesPerMinute', 'silencePercentage', 'transitionPauses', 'extendedPauses'] as const;
                            const finalPauseMetrics = store.pauseMetrics
                                ? PAUSE_KEYS.reduce<Record<string, number>>((acc, k) => {
                                    const v = (store.pauseMetrics as unknown as Record<string, unknown>)[k];
                                    if (typeof v === 'number' && Number.isFinite(v)) acc[k] = v;
                                    return acc;
                                }, {})
                                : {};
                            const finalMetrics = {
                                totalWords: wordCount,
                                clarityScore,
                                wpm,
                                fillerCounts: finalFillerCounts,
                                pauseMetrics: finalPauseMetrics,
                            };
                            const finalNextAction = deriveNextActionSignal({
                                durationSeconds: Math.round(duration),
                                wordCount,
                                wpm,
                                fillerCounts: finalFillerCounts,
                                clarityScore,
                            });

                            // CONTENT-FREE recovery draft: exact final metrics + the next action, NO transcript.
                            saveSessionRecoveryDraft({
                                sessionId,
                                userId,
                                recoveryState: 'finalized_pending_save',
                                durationSeconds: Math.round(duration),
                                mode: modeForFinalization ?? 'unknown',
                                metrics: finalMetrics,
                                nextActionSignal: finalNextAction,
                            });

                            // #1306 Step 3: the EXACT finalized transcript selected at the recording boundary is
                            // bound into the IMMUTABLE completion payload here, before any terminal purge. Retry
                            // Save replays this identical object, so a retry can never send a different
                            // transcript (which the server would reject as a conflict rather than partially write).
                            // This value lives only in recording-owned memory — it is deliberately NOT written to
                            // the recovery draft below, diagnostics, telemetry, or logs.
                            const completeArgs: CompleteSessionOptions & { status: 'completed' } = {
                                status: 'completed',
                                duration: Math.round(duration),
                                nextActionSignal: finalNextAction,
                                metrics: finalMetrics,
                                finalTranscript,
                            };
                            const progressContext = this.buildProgressCompletionContext(Math.round(duration));
                            // Capture the exact rich-metrics write before either persistence step can fail.
                            // A full-save retry replays this immutable payload; an attribution retry carries
                            // the actual result of the original write. Recovery paths without this payload
                            // fail closed and never create an immutable incomplete Progress evaluation.
                            // #1306 metrics-only: the rich-metrics write is content-free — flat filler_counts, no
                            // custom_words, no per-session accuracy. Reuses the same derived values sent to the RPC.
                            const richMetricsPayload: RichMetricsPayload = {
                                total_words: wordCount,
                                filler_counts: finalFillerCounts,
                                pause_metrics: finalPauseMetrics,
                                wpm,
                                clarity_score: clarityScore,
                                next_action_signal: finalNextAction,
                            };
                            const completion = await completeSession(sessionId, completeArgs);
                            if (!completion.success) {
                                // #1033 (item 2/3): the durable FULL SAVE failed — the transcript row is NOT
                                // persisted (a strictly worse state than an attribution-only miss). Keep the
                                // recording locked (recordingStartedUnresolved stays true from RECORDING) and
                                // stash a FULL-SAVE retry so Retry Save re-runs the ACTUAL failed op
                                // (completeSession + attribution), not just the attribution write. The transcript
                                // is preserved in the recovery draft (saved just above). Session-safe: never
                                // overwrite a different session's outstanding retry.
                                if (!this.pendingFullSaveRetry || this.pendingFullSaveRetry.sessionId === sessionId) {
                                    this.pendingFullSaveRetry = {
                                        sessionId,
                                        completeArgs,
                                        attributionEvidence: attestationEvidence,
                                        progressContext,
                                        progressMetrics: { payload: richMetricsPayload, persisted: false },
                                    };
                                } else {
                                    logger.error({ existing: this.pendingFullSaveRetry.sessionId, sessionId }, '[controller] full-save retry slot held by another session — failing closed, not overwriting (#1033)');
                                }
                                throw new Error('SESSION_COMPLETION_FAILED');
                            }
                            // #1033: persist the finalizing engine identity + attribution_status in ONE
                            // atomic update. The row was created 'pending' (DB default); a VERIFIED tuple
                            // (engine/engine_version/model_name/device_type) or an 'unverified' status is
                            // written from the identity captured before teardown. The engine cannot have
                            // changed mid-recording (selector locked), so this is never a mis-attribution.
                            // On write failure the row simply stays 'pending' (transcript preserved), so a
                            // later retry can promote it to verified. Engine-specific evidence uses only
                            // attribution_status = 'verified' (no engine_version string heuristics).
                            // #1045: the attribution_status actually persisted for this row once the write
                            // below succeeds ('verified' or 'unverified'). Stays undefined (row is 'pending')
                            // on failure, so the Progress seam defers rather than record a premature row.
                            let attributionTerminalStatus: string | undefined;
                            try {
                                // #1161: the client can no longer write the locked attribution columns — post
                                // evidence to the trusted server producer. null result = TRANSIENT failure → throw
                                // into the catch to stash for Retry Save (transcript already persisted, row pending).
                                const attestResult = await this.attestSessionEngine(sessionId, attestationEvidence);
                                if (attestResult === null) throw new Error('attestation failed (transient — retryable)');
                                attributionTerminalStatus = attestResult.attributed
                                    ? ATTRIBUTION_STATUS.VERIFIED : ATTRIBUTION_STATUS.UNVERIFIED;
                                // Clear the pending-retry ONLY if it belongs to THIS recording — a later
                                // recording must never clear an earlier session's unresolved pending retry (#1033).
                                if (!this.pendingAttributionRetry || this.pendingAttributionRetry.sessionId === sessionId) {
                                    this.pendingAttributionRetry = null;
                                }
                                // A clean save for this session also clears any stale full-save retry it held.
                                if (this.pendingFullSaveRetry?.sessionId === sessionId) {
                                    this.pendingFullSaveRetry = null;
                                }
                                // #1033: durable save + attribution succeeded → this recording is fully resolved;
                                // release the post-start lock (engine selection can change for the next recording).
                                this.markRecordingResolved();
                            } catch (attributionError) {
                                // #1033: transcript is already persisted (completeSession). The row stays 'pending'
                                // (DB default); stash the patch so Retry Save can promote it pending→verified via
                                // UPDATE (no duplicate session, no transcript loss). Session-safe: NEVER overwrite a
                                // DIFFERENT session's unresolved pending retry — fail closed if one impossibly exists.
                                if (!this.pendingAttributionRetry || this.pendingAttributionRetry.sessionId === sessionId) {
                                    this.pendingAttributionRetry = {
                                        sessionId,
                                        evidence: attestationEvidence,
                                        progressContext,
                                        // The result is filled after the ordinary rich-metrics write below.
                                        // Until then a concurrent retry fails closed rather than guessing.
                                        progressMetrics: { payload: richMetricsPayload, persisted: false },
                                    };
                                } else {
                                    logger.error({ existing: this.pendingAttributionRetry.sessionId, sessionId }, '[controller] attribution retry slot held by another session — failing closed, not overwriting (#1033)');
                                }
                                logger.warn({ attributionError, sessionId }, '[controller] attribution persist failed — row stays pending; retry available');
                            }
                            logger.info({ sessionId }, '[DEBUG-STOP] completeSession completed-status done');
                            sessionCompleted = true;
                            persistedSessionMarker = sessionId
                                ? { sessionId, mode: modeForFinalization ?? stopEntryMode }
                                : null;
                            this.updateSessionPersisted(true, persistedSessionMarker ?? undefined);
                            useSessionStore.getState().setSessionSaved(true);

                            // Track 1 finalized reconciliation (disclosure-only). Computed against the
                            // PERSISTED filler counts (`fillerWords` — exactly what was written to the DB,
                            // canonical live under #944; word-preserving formatting never changes the count).
                            // PUBLISHED only at the TERMINAL of finalization so the toast / Analytics cue /
                            // settled status never fire while the transcript is still being tidied.
                            let finalizedReconciliation: ReturnType<typeof reconcileFinalizedFillers> | null = null;
                            try {
                                finalizedReconciliation = reconcileFinalizedFillers(
                                    finalTranscript, fillerWords as unknown as FillerCounts, this.userWords,
                                );
                            } catch (reconErr) {
                                logger.warn({ reconErr, sessionId }, '[controller] finalized reconciliation compute failed (non-fatal)');
                            }
                            const finalizedMode = modeForFinalization ?? stopEntryMode ?? 'unknown';
                            const finalizedPersistedTotal = fillerWords.total.count;
                            const finalizeToken = ++this.finalizeSequence;
                            const isFinalizeTokenValid = () => this.finalizeSequence === finalizeToken;

                            // TWO-TRACK terminal join. The finalized-ready signal publishes ONLY when BOTH
                            // the transcript track (formatterDone) AND the analysis-persistence track
                            // (metricsDone && metricsOk) are terminal, and the finalize token is still current.
                            // Metrics-persistence failure keeps the warning status and shows no success UI.
                            let formatterDone = false;
                            let metricsDone = false;
                            let metricsOk = false;
                            const maybePublishFinalized = () => {
                                if (!sessionId || !finalizedReconciliation) return;
                                if (!shouldPublishFinalized({ formatterDone, metricsDone, metricsOk, tokenValid: isFinalizeTokenValid() })) return;
                                useSessionStore.getState().setFinalizedAnalysis({
                                    sessionId,
                                    mode: finalizedMode,
                                    reconciliation: finalizedReconciliation,
                                    persistedTotal: finalizedPersistedTotal,
                                });
                            };

                            // #1320: Native/Web-Speech (RAW-FIRST background formatting) is retired. Private's
                            // transcript track is already terminal here — no async formatter, so publish directly.
                            formatterDone = true;
                            maybePublishFinalized(); // waits for the metrics track below
                            if (token.cancelled) {
                                logger.warn({
                                    mode: service.getMode?.() ?? stopEntryMode,
                                    sessionId,
                                    transcriptLength: finalTranscript.length,
                                }, '[DEBUG-STOP] Stop token cancelled after session completion; continuing terminal publish (metrics already committed by v2)');
                            }
                            if (token.version !== this.lifecycleVersion) {
                                logger.warn({
                                    mode: service.getMode?.() ?? stopEntryMode,
                                    sessionId,
                                    tokenVersion: token.version,
                                    lifecycleVersion: this.lifecycleVersion,
                                    transcriptLength: finalTranscript.length,
                                }, '[DEBUG-STOP] Lifecycle changed after session completion; continuing terminal publish (metrics already committed by v2)');
                            }

                            // #1306 Step 3: the redundant post-completion metrics PATCH is REMOVED. v2 persisted
                            // every retained metric and the next action inside the SAME transaction that wrote the
                            // transcript and ran retention, so a second write could only introduce a divergent
                            // authority and a "completed but metrics missing" window. The v2 acceptance above IS
                            // the durable metrics result; attribution remains its own separately trusted path.
                            metricsDone = true;
                            metricsOk = true;
                            // Attribution may still be pending, but its eventual retry must use this exact
                            // result — transcript completion alone never implies rich metrics persisted.
                            if (this.pendingAttributionRetry?.sessionId === sessionId) {
                                this.pendingAttributionRetry = {
                                    ...this.pendingAttributionRetry,
                                    progressMetrics: { payload: richMetricsPayload, persisted: metricsOk },
                                };
                            }
                            maybePublishFinalized();

                            // Normal completion and both retry completions share this one immutable
                            // mode-aware seam. It uses the recording-boundary snapshot above, never the current
                            // live brief, so a later Focus Points selection cannot attach to this take.
                            void this.completeProgressForRecording(
                                progressContext,
                                sessionId,
                                attributionTerminalStatus,
                                metricsOk,
                            );

                            clearSessionRecoveryDraft(sessionId);

                            this.updateStreakInternal();

                            if (typeof window !== 'undefined') {
                                logger.info('[DEBUG-STOP] pushing ANALYTICS_COMPLETE');
                                const { pushE2EEvent } = await import('../lib/e2eProbe');
                                pushE2EEvent('ANALYSIS_COMPLETE', {
                                    sessionId,
                                    fillerCount: fillerWords.total.count,
                                    wpm,
                                    accuracy
                                });
                                logger.info('[DEBUG-STOP] pushed ANALYTICS_COMPLETE');
                            }

                            logger.info('[DEBUG-STOP] calling updateSessionPersisted(true)');
                            this.updateSessionPersisted(true, persistedSessionMarker ?? undefined);
                            useSessionStore.getState().setSessionSaved(true);
                            // The finalized signal (finalizedAnalysis) is published by publishFinalized() at
                            // the formatter terminal above — NOT here — so the settled UI waits for the final
                            // text. Non-native published synchronously in the else-branch above.
                        }
                    }
                }

                this.lifecycleVersion++;
                this.stopWatchdog();
                await service.destroy();
                this.service = null;
                useSessionStore.getState().setTranscriptFinalizing(false);
                useSessionStore.getState().freezeTranscriptAtStop(null);
                // #1306 P1: metrics are derived and the session is finalized here — purge the ephemeral live
                // transcript from working memory (store + lifecycle) so no spoken text survives finalization. A
                // still-pending Native background formatter can't re-populate it: its writeback is guarded on the
                // store still holding this session's raw final, which is now cleared.
                this.purgeTranscriptWorkingMemory();

                logger.info('[DEBUG-STOP] transition READY starting');
                await this.transition('READY');
                // #1033 (item 3): the stop path reached its NORMAL terminal — the recording was saved, discarded
                // as no-speech/low-quality, or had nothing to persist. Unless a durable retry was stashed (a
                // full-save or attribution failure, which keeps the lock for Retry Save), the recording is fully
                // resolved, so release the post-start engine-selection lock. Covers EVERY non-error stop terminal
                // uniformly; the error path (catch below) transitions to FAILED and deliberately stays locked so
                // the recovery draft can be saved. This is the single authoritative unlock for a completed stop.
                if (!this.pendingFullSaveRetry && !this.pendingAttributionRetry) {
                    this.markRecordingResolved();
                }
                if (sessionCompleted) {
                    this.updateSessionPersisted(true, persistedSessionMarker ?? undefined);
                    useSessionStore.getState().setSessionSaved(true);
                }
                if (guardedStopStatus) {
                    useSessionStore.getState().setSTTStatus(guardedStopStatus);
                }
                logger.info('[DEBUG-STOP] transition READY done');
                return result;
            } catch (err: unknown) {
                logger.error({ err }, '[DEBUG-STOP] ERROR caught');
                const hasRecoveryDraftSignal = this.getStoreTranscriptLength() > 0;
                if (this.sessionId) {
                    completeSession(this.sessionId, {
                        status: 'failed',
                        reason: `Stop recording failed: ${(err as Error).message}`
                    }).catch((completeError) => {
                        logger.warn({
                            completeError,
                            sessionId: this.sessionId,
                            state: this.state,
                        }, '[SpeechRuntimeController] Failed to mark session failed after stopRecording error');
                    });
                }
                await this.transition('FAILED', err as Error, token);
                useSessionStore.getState().setTranscriptFinalizing(false);
                useSessionStore.getState().freezeTranscriptAtStop(null);
                if (err instanceof FinalizationTimeoutError) {
                    // #1089: name the real failure instead of hanging on Finalizing… forever. The control
                    // is usable again (FAILED clears the finalizing latch), and the transcript captured up
                    // to this point is kept as a recovery draft when there is one.
                    useSessionStore.getState().setSTTStatus({
                        type: 'error',
                        message: 'We could not finish processing this recording.',
                        detail: hasRecoveryDraftSignal
                            ? 'What we transcribed so far was kept in this browser. You can record again.'
                            : 'You can record again.',
                    });
                } else if (hasRecoveryDraftSignal) {
                    useSessionStore.getState().setSTTStatus({
                        type: 'warning',
                        message: 'Session was not saved yet.',
                        detail: 'A local recovery draft was kept in this browser after a save issue.',
                    });
                }
                // #1306 P1: the FAILED terminal is also a terminal stop — transcript-derived processing is done
                // (the content-free recovery draft, if any, was already written by persistActiveRecoveryDraft and
                // the recovery-signal length was captured above). Purge the ephemeral transcript so no spoken
                // text survives a failed finalization either.
                this.purgeTranscriptWorkingMemory();
                throw err;
            }
        });
    }

    /**
     * #1265: the only completion seam allowed to invoke Progress for a recording. Normal completion,
     * attribution retry, and full-save retry all arrive here with the immutable recording-boundary mode.
     * Unknown/legacy retry context fails closed. Open Mic evaluates immediately. Focus Points evaluates
     * only after its original brief is explicitly registered; registration failure or ambiguity writes no
     * evaluation. Later objective-stage failure after confirmed registration still evaluates.
     */
    private async completeProgressForRecording(
        context: ProgressCompletionContext,
        sessionId: string,
        attributionStatus: string | undefined,
        metricsPersisted: boolean,
    ): Promise<void> {
        if (context.mode === 'unknown') return;
        // Both practice modes require actual durable delivery metrics. This guard sits before Open Mic's
        // immediate path and Focus Points registration so neither can create an immutable partial evaluation.
        if (!metricsPersisted) return;

        const runProgressEval = () => void wireProgressEvaluationOnSave({
            sessionId,
            status: 'completed',
            attributionStatus,
            metricsPersisted,
            userId: this.capturedUserId,
        }).catch((progressErr) => logger.warn(
            { progressErr, sessionId },
            '[controller] progress recording failed (non-fatal)',
        ));

        if (context.mode === 'open_mic') {
            runProgressEval();
            return;
        }

        const store = useSessionStore.getState();
        store.setCompletedObjectiveBrief(context.brief);
        const liveBrief = store.activeObjectiveBrief;
        if (liveBrief?.projectId === context.brief.projectId && liveBrief.briefId === context.brief.briefId) {
            store.setActiveObjectiveBrief(null);
        }
        await this.finalizeObjectiveAndGateProgress(
            { projectId: context.brief.projectId, briefId: context.brief.briefId },
            sessionId,
            context.segments,
            context.durationSeconds,
            runProgressEval,
        );
    }

    /**
     * #1265: finalize a Focus Points recording's objective evidence, publish its per-point coverage rail,
     * and gate the session's Progress evaluation on DURABLE objective registration. Extracted so the
     * cohort-safety invariant is DIRECTLY testable:
     *   • register failure (registered=false)  -> NO Progress evaluation (never cohorted 'freeform');
     *   • later objective-stage failure but registered=true -> evaluation STILL runs (the recording is a
     *     confirmed Focus Points source, so its Progress belongs to the 'objective' cohort);
     *   • ambiguous throw (finalize rejects)    -> NO evaluation (registration state is unknown → fail closed).
     * There is no registration retry — a failed registration means Progress is unavailable for this take.
     * Open Mic (no brief) never reaches here; it evaluates immediately at the call site.
     * The seam is strictly non-fatal: any objective failure is logged and swallowed, never breaking save.
     */
    private async finalizeObjectiveAndGateProgress(
        brief: { projectId: string; briefId: string },
        sessionId: string,
        segments: { text: string; startSec: number }[],
        durationSeconds: number,
        runProgressEval: () => void,
    ): Promise<void> {
        try {
            const { finalizeObjectiveSessionOnSave } = await import('@/services/objective/finalizeObjectiveSessionOnSave');
            const objResult = await finalizeObjectiveSessionOnSave({
                projectId: brief.projectId,
                briefId: brief.briefId,
                sourceSessionId: sessionId,
                idempotencyKey: sessionId,
                segments,
                durationSeconds,
            });
            // Publish per-point coverage ONLY on a fully-successful finalize carrying coverage; any failed
            // stage leaves objectiveCoverageResult null, so a broken session shows no rail (never fabricated).
            if (objResult.ok && objResult.coverage) {
                useSessionStore.getState().setObjectiveCoverageResult(
                    objResult.coverage.map((c) => ({ id: c.briefPointId, label: c.point, status: c.status })),
                );
            }
            if (objResult.registered) runProgressEval();
        } catch (objErr) {
            logger.warn({ objErr, sessionId }, '[controller] objective finalization failed (non-fatal)');
        }
    }

    public async ensureReady(options: { skipIfDownloadPending?: boolean } = {}): Promise<void> {
        // Lifecycle guard — prevent stale execution after unmount
        const version = this.lifecycleVersion;

        if (this.service?.isServiceDestroyed()) {
            this.service = null;
        }

        if (!this.service) {
            this.service = getTranscriptionService(
                createControllerOwnedServiceCallbacks({
                    navigate: this.navigate,
                    session: this.session,
                    getAssemblyAIToken: this.getAssemblyAIToken,
                    userWords: this.userWords
                }, this.serviceCallbacks as Required<typeof this.serviceCallbacks>),
                this.lock
            );
        }

        if (options.skipIfDownloadPending && this.service.fsm?.is('DOWNLOAD_REQUIRED')) {
            return;
        }

        const mode = this.service.getMode() || 'private';
        await this.service.warmUp(mode);

        // Lifecycle check after async warmUp — abort if unmounted
        if (version !== this.lifecycleVersion) return;

        if (options.skipIfDownloadPending && this.service.fsm?.is('DOWNLOAD_REQUIRED')) {
            return;
        }

        const strategy = this.service.getStrategy();
        if (!strategy) {
            if (options.skipIfDownloadPending) {
                logger.debug({ mode }, '[SpeechRuntimeController] Warm-up completed without an active strategy; recording start remains the strict boundary.');
                return;
            }
            throw new Error('STT_STRATEGY_MISSING_AFTER_ENSURE_READY');
        }
    }

    private startHeartbeat(sessionId: string, service: TranscriptionService): void {
        this.stopHeartbeat();
        const version = ++this.heartbeatVersion;
        let consecutiveFailures = 0;
        const scheduleNext = (immediate = false) => {
            const delay = immediate ? 0 : this.HEARTBEAT_PERIOD_MS;
            this.heartbeatInterval = setTimeout(() => {
                if (version !== this.heartbeatVersion) return;
                void (async () => {
                    try {
                        const currentState = service.getState();
                        if (!sessionId || (currentState !== 'RECORDING' && currentState !== 'ENGINE_INITIALIZING')) return;
                        await heartbeatSession(sessionId, Math.round(this.HEARTBEAT_PERIOD_MS / 1000));
                        if (version !== this.heartbeatVersion) return;
                        consecutiveFailures = 0; // Reset on success
                        scheduleNext();
                    } catch (error: unknown) {
                        if (version !== this.heartbeatVersion) return;
                        consecutiveFailures++;

                        if (consecutiveFailures >= this.MAX_HEARTBEAT_FAILURES) {
                            logger.error({ sessionId, consecutiveFailures }, '[Heartbeat] Max failures reached — terminating session');
                            pushE2EEvent('HEARTBEAT_FAILURE_THRESHOLD_REACHED', { sessionId, consecutiveFailures });

                            this.stopHeartbeat(); // Kill interval before transition
                            await this.transition('FAILED', error instanceof Error ? error : new Error('HEARTBEAT_FAILURE'));
                            return;
                        }

                        logger.warn({ sessionId, consecutiveFailures, error }, '[Heartbeat] Failure pulse recorded');
                        scheduleNext();
                    }
                })();
            }, delay);
        };
        scheduleNext(true);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearTimeout(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private startWatchdog(service: TranscriptionService): void {
        const version = ++this.watchdogVersion;
        const watchdogStartedAt = Date.now();
        this.stopWatchdog();
        this.watchdogInterval = setInterval(() => {
            if (version !== this.watchdogVersion) {
                clearInterval(this.watchdogInterval!);
                return;
            }
            const strategy = service.getStrategy();
            if (!strategy || !this.isEngineReady) return;
            if (this.state !== 'INITIATING' && this.state !== 'ENGINE_INITIALIZING' && this.state !== 'RECORDING') return;
            const now = Date.now();
            const lastHeartbeat = service.getLastHeartbeatTimestamp();
            const hasValidHeartbeat =
                Number.isFinite(lastHeartbeat) &&
                lastHeartbeat > 0 &&
                lastHeartbeat <= now + 1000;
            // Some private/browser engines can briefly report a zero/invalid inner
            // heartbeat while a ready cached model is being rebound to a fresh mic
            // start. Treat that as "no pulse yet" for one normal heartbeat window,
            // not as a dead worker. If it never produces a valid pulse, the same
            // threshold still trips from watchdog start.
            const effectiveLastHeartbeat = hasValidHeartbeat
                ? Math.min(lastHeartbeat, now)
                : watchdogStartedAt;
            const drift = now - effectiveLastHeartbeat;
            if (drift > this.HEARTBEAT_THRESHOLD_MS) {
                this.handleHeartbeatFailure(new Error(`STT_HEARTBEAT_FAILURE: ${drift}ms`));
            }
        }, this.WATCHDOG_PERIOD_MS);
    }

    private stopWatchdog(): void {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
    }

    // --- Idle Reclamation ---

    private startIdleTimer(): void {
        this.stopIdleTimer();
        this.idleTimeout = setTimeout(() => {
            if (this.state === 'IDLE' || this.state === 'READY') {
                // #1258: while the session page is FOREGROUND, a READY Private engine must NEVER be reclaimed
                // out from under a user who is waiting to record. Reclaiming it forces a full model
                // re-download/re-init; on a cold device that reload cannot finish before the next idle tick, so
                // the recorder returns to "loading" and `mic-start` never stabilizes to enabled (the deployed
                // active-trial canary's exact failure). Preserve based on the ACTUAL running engine — service
                // mode + engine-ready — NOT the nullable store `sttMode` (post-#1184 the store mode is
                // frequently `null` while the running engine is a ready Private engine; the old
                // `sttMode === 'private'` check failed open and reclaimed it).
                // BUT still reclaim after genuine long BACKGROUND inactivity: when the page is hidden, the model
                // is not in front of a waiting user, so freeing its memory is correct. Re-arm on preserve so a
                // later background transition is still reclaimed.
                const serviceMode = this.service?.getMode();
                const pageForeground = typeof document === 'undefined' || document.visibilityState !== 'hidden';
                const shouldPreserveReadyPrivateEngine =
                    this.state === 'READY' &&
                    this.isEngineReady &&
                    serviceMode === 'private' &&
                    pageForeground;

                if (shouldPreserveReadyPrivateEngine) {
                    logger.info({
                        state: this.state,
                        serviceMode,
                    }, '[SpeechRuntimeController] Skipping idle reclamation for ready foreground Private engine');
                    this.startIdleTimer(); // re-arm: reclaim later if the page is backgrounded
                    return;
                }
                // Reclaim the engine, then advance the reload token ONLY AFTER the (synchronous) reset completes.
                // A reset that throws must NOT mint a reload token — otherwise a foreground return would reload
                // against a reclamation that never completed. The token is the authorization for exactly one
                // foreground-return reload tied to THIS reclamation.
                try {
                    this.reset('idle_reclamation');
                    this.idleReclamationGeneration += 1;
                } catch (err) {
                    logger.warn({ err }, '[SpeechRuntimeController] idle reclamation reset failed; reload token not advanced');
                }
            }
        }, this.IDLE_RECLAMATION_MS);
    }

    private stopIdleTimer(): void {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
    }

    private handleHeartbeatFailure(error: Error): void {
        void this.enqueue(async (token) => {
            this.stopWatchdog();
            this.stopHeartbeat();
            if (this.sessionId) {
                completeSession(this.sessionId, { status: 'failed', reason: error.message }).catch((completeError) => {
                    logger.warn({
                        completeError,
                        sessionId: this.sessionId,
                        heartbeatError: error,
                        state: this.state,
                    }, '[SpeechRuntimeController] Failed to mark session failed after heartbeat failure');
                });
            }
            await this.transition('FAILED', error, token);
            if (this.service) {
                this.lifecycleVersion++;
                this.service.handleHeartbeatFailure(error);
                await this.service.destroy();
                this.service = null;
            }
        });
    }

}

export const speechRuntimeController = SpeechRuntimeController.getInstance();
