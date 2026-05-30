import logger from '@/lib/logger';
import { syncSTTReady, syncSTTIdentity, syncForensicAnchors as syncRuntimeState, syncEngineReady, syncSessionPersisted, syncNegotiatorDecision, syncProfileReady } from '@/lib/forensicAnchors';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';
import TranscriptionService, { getTranscriptionService } from '@/services/transcription/TranscriptionService';
import type { TranscriptionPolicy } from '@/services/transcription/TranscriptionPolicy';
import { useReadinessStore } from '@/stores/useReadinessStore';
import { saveSession, completeSession, heartbeatSession } from '@/lib/storage';
import { useSessionStore } from '@/stores/useSessionStore';
import { getSupabaseClient } from '../lib/supabaseClient';
import type { UserProfile } from '@/types/user';
import type { TranscriptUpdate, HistorySegment, SttStatus } from '@/types/transcription';
import type { TranscriptionMode } from '@/services/transcription/TranscriptionPolicy';
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
import { FillerCounts } from '@/utils/fillerWordUtils';
import { calculateCoreSessionMetrics, getFillerTotal } from '@/utils/sessionAnalysis';
import { updateSession } from '@/lib/storage';

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

const ensureTerminalPunctuation = (text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) return trimmed;
    const sentenceCased = sentenceCaseStart(trimmed);
    if (TERMINAL_PUNCTUATION_RE.test(sentenceCased)) return sentenceCased;
    if (/[,:;]$/.test(sentenceCased)) return `${sentenceCased.slice(0, -1)}.`;
    return `${sentenceCased}.`;
};

const appendFinalTranscriptText = (currentTranscript: string, finalTranscript: string): string => {
    const finalWithPunctuation = ensureTerminalPunctuation(finalTranscript);
    if (!currentTranscript.trim()) return finalWithPunctuation;
    return `${ensureTerminalPunctuation(currentTranscript)} ${finalWithPunctuation}`;
};

const NATIVE_NOISE_TRANSCRIPTS = new Set([
    'stop',
    'start',
    'test',
    'testing',
    'hello',
    'the',
    'on the',
]);

const NATIVE_SAVE_STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'but',
    'in',
    'of',
    'on',
    'or',
    'the',
    'to',
    'uh',
    'um',
]);

const getNativeMeaningfulWordCount = (transcript: string): number => {
    const words = transcript
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);

    return words.filter((word) => !NATIVE_SAVE_STOPWORDS.has(word)).length;
};

const getNativeSaveQualityFailureReason = (transcript: string): string | null => {
    const normalized = transcript
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) return 'empty_transcript';
    if (NATIVE_NOISE_TRANSCRIPTS.has(normalized)) return 'command_or_noise_transcript';

    const totalWords = normalized.split(' ').filter(Boolean).length;
    const meaningfulWords = getNativeMeaningfulWordCount(normalized);

    if (totalWords < 3) return 'too_few_words';
    if (meaningfulWords < 2) return 'too_few_meaningful_words';

    return null;
};

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

/**
 * LIFECYCLE CONTRACT (v2 — Emission Control)
 * Any async work via enqueue() may be aborted if lifecycleVersion changes.
 * No side-effects are guaranteed after cancellation.
 * Tests must use whenStable() — never vi.waitFor() for side-effects.
 * @see LifecycleToken
 */
export class SpeechRuntimeController {
    private static instance: SpeechRuntimeController | null = null;
    private readonly HEARTBEAT_THRESHOLD_MS =
        import.meta.env.VITE_E2E_MODE ? 60000 : 30000;
    private lifecycleVersion: number = 0;
    private state: RuntimeState = 'IDLE';
    private initialized: boolean = false;
    public service: TranscriptionService | null = null;
    private serviceUnsubscribe: (() => void) | null = null;
    private commandQueue: Promise<void> = Promise.resolve();
    private activeTasks: Set<LifecycleToken> = new Set();
    private sessionId: string | null = null;
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
            });

            // Fix 1 Correction: Programmatic Mode Switch
            (window as unknown as Record<string, unknown>).__E2E_SET_MODE__ = (mode: TranscriptionMode) => {
                this.updatePolicy({ ...this.policy!, preferredMode: mode });
            };
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
        // Phase 1: Ensure Service Genesis (Once per session)
        await this.initializeInfrastructure();
        const requestId = ++this.warmUpRequestId;

        if (this.service) {
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
                    allowNative: mode === 'native',
                    allowCloud: mode === 'cloud',
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
            this.service.updateCallbacks({
                ...callbacks,
                onTranscriptUpdate: (data) => this.handleTranscriptUpdate(data),
                onHistoryUpdate: (history) => this.handleHistoryUpdate(history),
                onError: (error) => this.handleError(error),
            });
        }
    }

    public updatePolicy(policy: TranscriptionPolicy): void {
        const effectivePolicy = this.preserveAllowedCloudSelection(policy);
        this.policy = effectivePolicy;
        if (this.service) {
            void this.enqueue(async (token) => {
                // Token check FIRST
                if (token.cancelled || token.version !== this.lifecycleVersion) return; 
                
                const service = this.service; // Capture reference
                if (!service) return;         // Explicit null check

                await service.updatePolicy(effectivePolicy);
                
                // Re-check after await
                if (token.cancelled || token.version !== this.lifecycleVersion) return;
            });
        }
    }

    private preserveAllowedCloudSelection(policy: TranscriptionPolicy): TranscriptionPolicy {
        const selectedMode = useSessionStore.getState().sttMode;
        if (selectedMode !== 'cloud' || !policy.allowCloud || policy.preferredMode === 'cloud') {
            return policy;
        }

        const effectivePolicy = {
            ...policy,
            preferredMode: 'cloud' as const,
            allowFallback: false,
            executionIntent: `${policy.executionIntent ?? 'policy'}-cloud-preserved`,
        };

        logger.info({
            from: policy.executionIntent,
            to: effectivePolicy.executionIntent,
            previousPreferredMode: policy.preferredMode,
            selectedMode,
        }, '[SpeechRuntimeController] Preserving allowed Cloud mode selection');

        return effectivePolicy;
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

    private updateSessionPersisted(persisted: boolean): void {
        useSessionStore.getState().setSessionSaved(persisted);
        syncSessionPersisted(persisted);
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

    private isActionableStartError(status?: SttStatus): boolean {
        if (!status || status.type !== 'error') {
            return false;
        }

        return /microphone|mic|permission|recording could not start/i.test(status.message);
    }

    private async transition(newState: RuntimeState, error?: Error, token?: LifecycleToken): Promise<void> {
        if (newState === 'RECORDING') {
            if (!this.canTransitionToRecording()) {
                return;
            }
        }

        const previousState = this.state;
        this.state = newState;
        this.syncProvider(this.lifecycleVersion);

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

    private handleModelLoadProgress(progress: number | null) {
        useSessionStore.getState().setModelLoadingProgress(progress);
        this.subscriberCallbacks.onModelLoadProgress?.(progress);
    }

    private isModeAllowedByCurrentPolicy(mode: TranscriptionMode | null): boolean {
        if (!mode || !this.policy) {
            return true;
        }

        if (mode === 'native') return this.policy.allowNative;
        if (mode === 'cloud') return this.policy.allowCloud;
        if (mode === 'private') return this.policy.allowPrivate;

        return false;
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

        if (!this.isModeAllowedByCurrentPolicy(mode)) {
            const fallbackMode = this.policy?.preferredMode ?? 'native';
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
        this.subscriberCallbacks.onStatusChange?.(status);
    }

    private handleAudioData(data: Float32Array) {
        this.subscriberCallbacks.onAudioData?.(data);
    }

    private resetAnalysisStateForNewRecording(): void {
        const store = useSessionStore.getState();
        store.updateTranscript('', '');
        store.updateFillerData({});
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

    private pushTranscriptToStore(data: TranscriptUpdate): void {
        const store = useSessionStore.getState();
        const currentTranscript = store.transcript.transcript;

        const pushNativeStoreTrace = (event: string, payload: Record<string, unknown> = {}) => {
            if (typeof window === 'undefined' || !window.__NATIVE_BROWSER_TRACE__) return;
            window.__NATIVE_BROWSER_TRACE__.push({
                t: Number(performance.now().toFixed(1)),
                event,
                currentTranscript,
                partial: data.transcript.partial ?? '',
                final: data.transcript.final ?? '',
                chunkCount: store.chunks.length,
                ...payload,
            });
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

            const lastChunk = store.chunks[store.chunks.length - 1];
            if (lastChunk?.isFinal && normalizeTranscriptPrefix(lastChunk.transcript) === finalNormalized) {
                pushNativeStoreTrace('store_skip_duplicate_last_chunk', {
                    finalTranscript,
                });
                store.updateTranscript(currentTranscript || finalTranscript, '');
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
                store.updateTranscript(currentTranscript || finalTranscript, '');
                return;
            }

            if (currentTrimmed && hasProviderFullTranscriptPrefix(currentTrimmed, rawFinalTranscript)) {
                const suffix = ensureTerminalPunctuation(rawFinalTranscript.slice(currentTrimmed.length).trim());
                pushNativeStoreTrace('store_replace_with_provider_full_final', {
                    suffix,
                    finalTranscript,
                    normalizedPrefixMatch: true,
                });
                store.updateTranscript(finalTranscript, '');
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
            store.updateTranscript(newFullText, '');
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
    }

    public async startRecording(policy?: TranscriptionPolicy, userWords: string[] = []): Promise<void> {
        this.policy = policy || null;
        this.userWords = userWords;
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
                return;
            }

            if (this.service?.isServiceDestroyed()) {
                pushNativeRuntimeTrace('controller_start_service_destroyed_reset');
                this.service = null;
            }

            if (!this.service) {
                pushNativeRuntimeTrace('controller_start_create_service');
                this.service = getTranscriptionService({
                    ...this.serviceCallbacks,
                    ...this.subscriberCallbacks,
                }, this.lock);
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
                await service.startTranscription(policy, userWords);
                pushNativeRuntimeTrace('controller_service_startTranscription_done');
                pushE2EEvent('SR_AFTER_START_TRANSCRIPTION');
                const serviceState = typeof service.getState === 'function'
                    ? service.getState()
                    : (service.fsm?.is('RECORDING') ? 'RECORDING' : 'UNKNOWN');
                if (serviceState !== 'RECORDING') {
                    throw new Error(`TRANSCRIPTION_START_DID_NOT_RECORD:${serviceState}`);
                }
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
                pushNativeRuntimeTrace('controller_recording_invariant_start');
                await this.checkRecordingInvariant();
                pushNativeRuntimeTrace('controller_recording_invariant_done');

                const supabase = getSupabaseClient();
                pushNativeRuntimeTrace('controller_supabase_session_start');
                const { data: { session } } = await supabase.auth.getSession();
                pushNativeRuntimeTrace('controller_supabase_session_done', {
                    hasUser: Boolean(session?.user?.id),
                });
                if (_token.cancelled || _token.version !== this.lifecycleVersion) {
                    await this.transition('READY', undefined, _token);
                    return;
                }

                const userId = session?.user?.id;
                this.capturedUserId = userId || null;

                if (userId) {
                    const mode = service.getMode() || 'unknown';
                    const idempotencyKey = recordingId;
                    const metadata = service.getMetadata?.() || (
                        mode === 'private'
                            ? { engineVersion: 'transformers-js', modelName: 'whisper-tiny.en', deviceType: 'browser' }
                            : mode === 'cloud'
                                ? { engineVersion: 'assemblyai', modelName: 'universal-streaming', deviceType: 'cloud' }
                                : { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }
                    );

                    const sessionData = {
                        user_id: userId,
                        title: `Session ${new Date().toLocaleString()}`,
                        duration: 0,
                        transcript: ' ',
                        total_words: 0,
                        engine: mode
                    };

                    this.updateSessionPersisted(false);
                    pushNativeRuntimeTrace('controller_placeholder_save_start', {
                        mode,
                    });
                    const saveResult = await saveSession(sessionData, { id: userId } as UserProfile, mode, idempotencyKey, metadata);
                    pushNativeRuntimeTrace('controller_placeholder_save_done', {
                        hasDbSession: Boolean(saveResult?.session),
                        usageExceeded: Boolean(saveResult?.usageExceeded),
                    });
                    const dbSession = saveResult?.session;

                    if (dbSession) {
                        this.sessionId = dbSession.id;
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
        return this.enqueue(async (token) => {
            const stopEntryMode = this.service?.getMode?.() ?? this.policy?.preferredMode ?? null;
            if (stopEntryMode === 'cloud') {
                logger.warn({
                    controllerState: this.state,
                    mode: stopEntryMode,
                    hasService: Boolean(this.service),
                    serviceState: this.service?.getState?.() ?? null,
                    wasRecording: this.state === 'RECORDING',
                    sessionId: this.sessionId,
                    transcriptLength: this.getStoreTranscriptLength(),
                    lifecycleVersion: this.lifecycleVersion,
                }, '[CLOUD_STOP_ENTRY]');
            }

            const canStop =
                this.state === 'RECORDING' ||
                this.state === 'ENGINE_INITIALIZING' ||
                this.state === 'INITIATING' ||
                this.state === 'FAILED' ||
                this.state === 'FAILED_VISIBLE';

            if (!canStop) {
                if (stopEntryMode === 'cloud') {
                    logger.warn({
                        willSave: false,
                        reasonIfNot: 'cannot_stop_from_current_state',
                        mode: stopEntryMode,
                        controllerState: this.state,
                        serviceState: this.service?.getState?.() ?? null,
                        transcriptLength: this.getStoreTranscriptLength(),
                        sessionId: this.sessionId,
                    }, '[CLOUD_SAVE_DECISION]');
                }
                return null;
            }
            const wasRecording = this.state === 'RECORDING';
            await this.transition('STOPPING', undefined, token);
            if (token.cancelled || token.version !== this.lifecycleVersion) return null;
            try {
                this.stopHeartbeat();
                this.stopWatchdog();
                const service = this.service;
                if (!service) {
                    if (stopEntryMode === 'cloud') {
                        logger.warn({
                            willSave: false,
                            reasonIfNot: 'missing_service',
                            mode: stopEntryMode,
                            controllerState: this.state,
                            serviceState: null,
                            transcriptLength: this.getStoreTranscriptLength(),
                            sessionId: this.sessionId,
                        }, '[CLOUD_SAVE_DECISION]');
                    }
                    await this.transition('READY', undefined, token);
                    return null;
                }

                let result = null;
                let guardedStopStatus: SttStatus | null = null;
                logger.info({ wasRecording, state: this.state, sessionId: this.sessionId }, '[DEBUG-STOP] state-check');
                if (wasRecording) {
                    let sessionId = this.sessionId;
                    const startTime = service.getStartTime();
                    result = await service.stopTranscription();
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
                            const duration = startTime ? (Date.now() - startTime) / 1000 : 0;
                            const metadata = service.getMetadata?.() || (
                                mode === 'private'
                                    ? { engineVersion: 'transformers-js', modelName: 'whisper-tiny.en', deviceType: 'browser' }
                                    : mode === 'cloud'
                                        ? { engineVersion: 'assemblyai', modelName: 'universal-streaming', deviceType: 'cloud' }
                                        : { engineVersion: 'web-speech-api', modelName: 'browser-native', deviceType: 'browser' }
                            );
                            const fallbackSessionData = {
                                user_id: userId,
                                title: `Session ${new Date().toLocaleString()}`,
                                duration: Math.round(duration),
                                transcript: result.transcript?.trim() || ' ',
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
                        const duration = startTime ? (Date.now() - startTime) / 1000 : 0;
                        const store = useSessionStore.getState();
                        const chunkTranscript = store.chunks.map(chunk => chunk.transcript).join(' ').trim();
                        const storeTranscript = store.transcript.transcript.trim();
                        const resultTranscript = result.transcript?.trim() || '';
                        const finalTranscript = [resultTranscript, chunkTranscript, storeTranscript]
                            .sort((a, b) => b.split(/\s+/).filter(Boolean).length - a.split(/\s+/).filter(Boolean).length)[0] || '';
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
                            finalTranscriptLength: finalTranscript.length,
                            finalWordCount: finalTranscript.split(/\s+/).filter(Boolean).length,
                            meaningfulWordCount,
                            fillerCount: getFillerTotal(store.fillerData),
                            userWordsCount: this.userWords.length,
                        }, '[DEBUG-STOP] finalization transcript decision');
                        if ((service.getMode?.() ?? stopEntryMode) === 'cloud') {
                            logger.warn({
                                willSave: Boolean(result && sessionId && finalTranscript),
                                reasonIfNot: !result ? 'missing_stop_result' : !sessionId ? 'missing_session_id' : !finalTranscript ? 'empty_transcript' : null,
                                transcriptLength: finalTranscript.length,
                                duration,
                                mode: service.getMode?.() ?? stopEntryMode,
                                serviceState: service.getState?.() ?? null,
                                controllerState: this.state,
                                wasRecording,
                                resultSuccess: result.success ?? null,
                                resultTranscriptLength: resultTranscript.length,
                                chunkTranscriptLength: chunkTranscript.length,
                                storeTranscriptLength: storeTranscript.length,
                                sessionId,
                            }, '[CLOUD_SAVE_DECISION]');
                        }

                        const modeForFinalization = service.getMode?.() ?? stopEntryMode;
                        const nativeSaveQualityFailureReason = modeForFinalization === 'native'
                            ? getNativeSaveQualityFailureReason(meaningfulTranscript)
                            : null;

                        if (meaningfulWordCount === 0 || nativeSaveQualityFailureReason) {
                            logger.warn({
                                sessionId,
                                transcriptLength: finalTranscript.length,
                                duration,
                                mode: modeForFinalization,
                                meaningfulWordCount,
                                nativeSaveQualityFailureReason,
                            }, '[SESSION_SAVE_GUARD] Empty, low-quality, or non-speech session discarded');

                            logger.info({
                                sessionId,
                                finalTranscriptLength: finalTranscript.length,
                                meaningfulWordCount,
                            }, '[DEBUG-STOP] completeSession failed-status starting');
                            await completeSession(sessionId, {
                                status: 'failed',
                                reason: nativeSaveQualityFailureReason
                                    ? 'Not enough meaningful browser transcript was captured; session was not saved to history.'
                                    : 'No meaningful speech detected; session was not saved to history.'
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
                                message: nativeSaveQualityFailureReason
                                    ? "We didn't capture enough speech to save this session."
                                    : "We didn't detect enough speech to save this session.",
                                detail: nativeSaveQualityFailureReason
                                    ? 'Try recording again and speak clearly for at least a few seconds.'
                                    : 'Try recording again and speak for at least a few seconds.'
                            };
                            store.setSTTStatus(guardedStopStatus);
                            this.updateSessionPersisted(false);
                            store.setSessionSaved(false);
                            result = null;
                        } else {
                            const sessionMetrics = calculateCoreSessionMetrics({
                                transcript: finalTranscript,
                                durationSeconds: duration,
                                fillerData: getFillerTotal(store.fillerData) > 0 ? store.fillerData : undefined,
                                userWords: this.userWords,
                            });
                            const fillerWords = sessionMetrics.fillerData;
                            const wordCount = sessionMetrics.wordCount;
                            const wpm = sessionMetrics.wpm;
                            const accuracy = result.stats.accuracy;
                            const clarityScore = sessionMetrics.clarityScore;
                            const currentStoreTranscript = store.transcript.transcript.trim();
                            const currentStorePartial = store.transcript.partial.trim();
                            const isPromotingOnlyPartial =
                                currentStorePartial &&
                                !currentStoreTranscript &&
                                finalTranscript === currentStorePartial;

                            if (store.chunks.length === 0) {
                                store.setChunks([{
                                    transcript: finalTranscript,
                                    timestamp: startTime || Date.now(),
                                    isFinal: true
                                }]);
                                if (isPromotingOnlyPartial) {
                                    store.updateTranscript(finalTranscript, '');
                                }
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
                                    store.updateTranscript(finalTranscript, '');
                                }
                            }

                            const supabase = getSupabaseClient();
                            const { data: { session } } = await supabase.auth.getSession();
                            const userId = session?.user?.id;

                            if (userId) {
                                const { updateLocalUsage } = await import('../hooks/useUsageLimit');
                                updateLocalUsage(userId, Math.round(duration));
                            }

                            logger.info({
                                sessionId,
                                finalTranscriptLength: finalTranscript.length,
                                wordCount,
                                fillerCount: fillerWords.total.count,
                                wpm,
                                clarityScore,
                                accuracy,
                            }, '[DEBUG-STOP] completeSession completed-status starting');
                            await completeSession(sessionId, {
                                status: 'completed',
                                transcript: finalTranscript,
                                duration: Math.round(duration)
                            });
                            logger.info({ sessionId }, '[DEBUG-STOP] completeSession completed-status done');
                            if (token.cancelled) {
                                logger.warn({
                                    mode: service.getMode?.() ?? stopEntryMode,
                                    sessionId,
                                    transcriptLength: finalTranscript.length,
                                }, '[DEBUG-STOP] Stop token cancelled after session completion; continuing rich metrics update');
                            }
                            if (token.version !== this.lifecycleVersion) {
                                logger.warn({
                                    mode: service.getMode?.() ?? stopEntryMode,
                                    sessionId,
                                    tokenVersion: token.version,
                                    lifecycleVersion: this.lifecycleVersion,
                                    transcriptLength: finalTranscript.length,
                                }, '[DEBUG-STOP] Lifecycle changed after session completion; continuing rich metrics update');
                            }

                            logger.info({ sessionId }, '[DEBUG-STOP] updateSession starting');
                            await updateSession(sessionId, {
                                total_words: wordCount,
                                filler_words: fillerWords as unknown as FillerCounts,
                                custom_words: this.userWords.reduce<Record<string, { count: number }>>((acc, word) => {
                                    acc[word] = { count: fillerWords[word]?.count || 0 };
                                    return acc;
                                }, {}),
                                pause_metrics: store.pauseMetrics,
                                wpm,
                                clarity_score: clarityScore,
                                accuracy
                            });
                            logger.info('[DEBUG-STOP] updateSession done');

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
                            this.updateSessionPersisted(true);
                            useSessionStore.getState().setSessionSaved(true);
                        }
                    }
                }

                this.lifecycleVersion++;
                this.stopWatchdog();
                await service.destroy();
                this.service = null;

                logger.info('[DEBUG-STOP] transition READY starting');
                await this.transition('READY');
                if (guardedStopStatus) {
                    useSessionStore.getState().setSTTStatus(guardedStopStatus);
                }
                logger.info('[DEBUG-STOP] transition READY done');
                return result;
            } catch (err: unknown) {
                logger.error({ err }, '[DEBUG-STOP] ERROR caught');
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
                throw err;
            }
        });
    }

    public async ensureReady(options: { skipIfDownloadPending?: boolean } = {}): Promise<void> {
        // Lifecycle guard — prevent stale execution after unmount
        const version = this.lifecycleVersion;

        if (this.service?.isServiceDestroyed()) {
            this.service = null;
        }

        if (!this.service) {
            this.service = getTranscriptionService({
                ...this.serviceCallbacks,
                navigate: this.navigate,
                session: this.session,
                getAssemblyAIToken: this.getAssemblyAIToken,
                userWords: this.userWords
            }, this.lock);
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
        this.stopWatchdog();
        this.watchdogInterval = setInterval(() => {
            if (version !== this.watchdogVersion) {
                clearInterval(this.watchdogInterval!);
                return;
            }
            const strategy = service.getStrategy();
            if (!strategy || !this.isEngineReady) return;
            if (this.state !== 'INITIATING' && this.state !== 'ENGINE_INITIALIZING' && this.state !== 'RECORDING') return;
            const lastHeartbeat = service.getLastHeartbeatTimestamp();
            const drift = Date.now() - lastHeartbeat;
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
                void this.reset('idle_reclamation');
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

    public async switchToNative(): Promise<void> {
        return this.enqueue(async (token) => {
            if (token.cancelled || token.version !== this.lifecycleVersion) return;
            if (this.service?.isServiceDestroyed()) {
                this.service = null;
            }
            const serviceWithHandoff = this.service as { switchToNativeSegmented?: () => Promise<void> };
            if (serviceWithHandoff && typeof serviceWithHandoff.switchToNativeSegmented === 'function') {
                await serviceWithHandoff.switchToNativeSegmented();
                return;
            }
            if (this.service) {
                this.lifecycleVersion++;
                this.stopWatchdog();
                await this.service.destroy();
                this.service = null;
            }
            this.setEngineReady(false);
            const nativePolicy: TranscriptionPolicy = {
                allowNative: true, allowCloud: false, allowPrivate: false,
                preferredMode: 'native', allowFallback: false, executionIntent: 'native-recovery'
            };
            await this.startRecording(nativePolicy);
        });
    }
}

export const speechRuntimeController = SpeechRuntimeController.getInstance();
