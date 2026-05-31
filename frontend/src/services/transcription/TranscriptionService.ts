import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { isEqual } from 'lodash-es';
import { TranscriptionModeOptions, Transcript } from '@/services/transcription/modes/types';

import { TranscriptionError } from './errors';
import { STTStrategy } from './STTStrategy';
import { STTStrategyFactory } from './STTStrategyFactory';
import { STTNegotiator } from './STTNegotiator';
import logger from '@/lib/logger';
import { toast } from '@/lib/toast';
import {
  TranscriptionPolicy,
  TranscriptionMode,
  resolveMode,
  PROD_FREE_POLICY,
} from './TranscriptionPolicy';
import { useSessionStore } from '@/stores/useSessionStore';
import { calculateTranscriptStats, TranscriptStats } from '@/utils/fillerWordUtils';
import { TranscriptionFSM, TranscriptionState } from './TranscriptionFSM';
import { syncForensicAnchors, mapToRuntimeState, syncEngineReady } from '../../lib/forensicAnchors';
import { createMicStream } from './utils/audioUtils';
import { pushE2EEvent, isBridgeActive } from '@/lib/e2eProbe';
import { FailureManager } from './FailureManager';
import { MicStream } from './utils/types';
import { STT_CONFIG } from '@/config';
import { ENV } from '@/config/TestFlags';
import { PRIV_CLOUD_AUDIO } from './sttConstants';
import { sessionManager } from './SessionManager';
import { DistributedLock } from '@/lib/DistributedLock';
import type { TranscriptUpdate, HistorySegment, SttStatus } from '@/types/transcription';
import type { LifecycleToken } from '../SpeechRuntimeController';
export { sanitizeTranscriptText } from './transcriptSanitizer';
import { sanitizeTranscriptText } from './transcriptSanitizer';

import {
  saveSession,
  heartbeatSession,
  completeSession,
} from '@/lib/storage';

declare global {
  interface Window {
    __TRANSCRIPTION_SERVICE_INTERNAL__?: TranscriptionService;
    __PRIVATE_TRANSCRIPT_TRACE__?: boolean;
    __SS_TRANSCRIPT_TRACE__?: Array<Record<string, unknown>>;
    __SS_TRANSCRIPT_TRACE_SEQ__?: number;
  }
}

// Singleton managed via SessionManager
const isPrivateTranscriptTraceEnabled = () =>
  typeof window !== 'undefined' && Boolean(window.__PRIVATE_TRANSCRIPT_TRACE__);

const pushTranscriptLifecycleTrace = (stage: string, payload: Record<string, unknown> = {}) => {
  if (typeof window === 'undefined') return;
  window.__SS_TRANSCRIPT_TRACE__ = window.__SS_TRANSCRIPT_TRACE__ ?? [];
  window.__SS_TRANSCRIPT_TRACE_SEQ__ = (window.__SS_TRANSCRIPT_TRACE_SEQ__ ?? 0) + 1;
  window.__SS_TRANSCRIPT_TRACE__.push({
    sequence: window.__SS_TRANSCRIPT_TRACE_SEQ__,
    t: Number(performance.now().toFixed(1)),
    stage,
    timestamp: Date.now(),
    ...payload,
  });
  if (window.__SS_TRANSCRIPT_TRACE__.length > 1000) {
    window.__SS_TRANSCRIPT_TRACE__.shift();
  }
};

/**
 * @deprecated Use SpeechRuntimeController as the sole manager of service instances.
 * This is preserved only for the Controller's internal initialization.
 */
export function getTranscriptionService(options: Partial<TranscriptionServiceOptions> = {}, lock?: DistributedLock): TranscriptionService {
  return sessionManager.getOrCreateService(options, lock);
}

export const resetTranscriptionService = async (): Promise<void> => {
  await sessionManager.destroySession();
  syncForensicAnchors('IDLE', null);
};

// Types moved to src/types/transcription.ts

export interface TranscriptionServiceOptions {
  onTranscriptUpdate: (update: { transcript: Transcript }) => void;
  onModelLoadProgress: (progress: number | null) => void;
  onReady: () => void;
  onHistoryUpdate?: (history: HistorySegment[]) => void;
  session: Session | null;
  navigate: NavigateFunction;
  getAssemblyAIToken: () => Promise<string | null>;
  userWords?: string[];
  policy?: TranscriptionPolicy;
  mockMic?: MicStream;
  onModeChange?: (mode: TranscriptionMode | null) => void;
  onStatusChange?: (status: SttStatus) => void;
  onAudioData?: (data: Float32Array) => void;
  onError?: (error: Error) => void;
  watchdogIntervalMs?: number;
  watchdogTimeoutMs?: number;
}

/**
 * ARCHITECTURE:
 * TranscriptionService serves as a Facade (GoF Pattern).
 * It orchestrates between FSM (State), Factory (Creation), and FailureManager (Resilience).
 * 
 * Goal: Low cognitive load, high testability, single responsibility.
 */
export default class TranscriptionService {
  public readonly serviceId: string;
  public fsm: TranscriptionFSM;
  private failureManager: FailureManager;
  public strategy: STTStrategy | null = null;
  private mic: MicStream | null = null;
  private micFrameDisposer: (() => void) | null = null;
  private micFramePumpCount: number = 0;
  private micError: Error | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private isFrozen: boolean = false;

  private policy: TranscriptionPolicy;
  private options: TranscriptionServiceOptions;

  private lifecycleVersion: number = 0;
  private commandQueue: Promise<void> = Promise.resolve();
  private activeTasks: Set<LifecycleToken> = new Set();
  private negotiator: STTNegotiator;

  private startTimestamp: number = 0;
  private lastTranscriptTime: number = 0;
  private sessionId: string | null = null;
  private runId: string | null = null;
  private emissionsEnabled: boolean = false;
  private pendingTranscriptQueue: TranscriptUpdate[] = [];
  private startTime: number | null = null;
  private metadata: { engineVersion: string; modelName: string; deviceType: string } | null = null;

  private transcriptHistory: HistorySegment[] = [];

  private strategyCallbacks: TranscriptionModeOptions;
  private mode: TranscriptionMode | null = null;
  private activeStrategyId: string | null = null;
  private strategyVersion: number = 0;
  private isModeLocked: boolean = false;
  private lastError: TranscriptionError | null = null;
  private idempotencyKey: string | null = null;

  private destroyPromise: Promise<void> | null = null;
  private readonly MIN_RECORDING_DURATION_MS = 100;
  private downloadController: AbortController | null = null;
  private modelLoadingProgress: number | null = 0;
  private privateModelReady: boolean = false;
  private privateDownloadAlternativeToastShown: boolean = false;
  private activeSubscriberId: string | null = null;
  private isTerminated: boolean = false;
  private isDestroyed: boolean = false;
  private currentTranscript: string = '';
  private partialTranscript: string = '';

  public getFailureManager(): FailureManager {
    return this.failureManager;
  }

  private setEngineReady(ready: boolean): void {
    syncEngineReady(ready);
  }

  private markPrivateModelReady(): void {
    if (this.mode !== 'private') return;

    this.privateModelReady = true;
    this.privateDownloadAlternativeToastShown = false;
    this.modelLoadingProgress = 100;

    const state = (useSessionStore as unknown as {
      getState: () => {
        setModelLoadingProgress: (p: number | null) => void;
        setSTTStatus: (status: SttStatus) => void;
      }
    }).getState?.();

    if (state) {
      state.setModelLoadingProgress(100);
      state.setSTTStatus({
        type: 'ready',
        message: 'Private ready. Nothing leaves your browser.',
        detail: 'On-device transcription is initialized for this browser tab.',
        progress: 100
      });
    }

    toast.success('Private is ready. Nothing leaves your browser.', {
      id: 'private-model-ready',
      duration: 5000,
    });

    setTimeout(() => {
      const currentState = (useSessionStore as unknown as {
        getState: () => {
          modelLoadingProgress: number | null;
          setModelLoadingProgress: (p: number | null) => void;
        }
      }).getState?.();
      if (currentState && currentState.modelLoadingProgress === 100) {
        currentState.setModelLoadingProgress(null);
      }
    }, 5000);
  }

  private markPrivateModelInitFailed(_error: unknown): void {
    if (this.mode !== 'private') return;

    this.privateModelReady = false;
    this.modelLoadingProgress = null;
    this.setEngineReady(false);

    const state = (useSessionStore as unknown as {
      getState: () => {
        setModelLoadingProgress: (p: number | null) => void;
        setSTTStatus: (status: SttStatus) => void;
      }
    }).getState?.();

    if (state) {
      state.setModelLoadingProgress(null);
      state.setSTTStatus({
        type: 'init-failed',
        message: 'Private / Vault Mode could not finish setup.',
        detail: 'Check microphone permission and browser storage, then retry setup. Your audio stays on your machine.'
      });
    }
  }

  private canFallbackToNative(): boolean {
    return Boolean(
      this.policy.allowFallback &&
      this.policy.allowNative &&
      this.mode !== 'native' &&
      this.mode !== 'mock'
    );
  }

  /**
   * Serializes async operations to prevent concurrent initialization races.
   */
  private async enqueue<T>(task: (token: LifecycleToken) => Promise<T>): Promise<T> {
    const token: LifecycleToken = { version: this.lifecycleVersion, cancelled: false };
    this.activeTasks.add(token);

    const wrapped = async (): Promise<T> => {
      try {
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

  /**
   * Atomic Readiness Gate
   * Ensures the STT strategy is initialized within a serialized queue.
   */
  public async ensureReady(expectedVersion: number): Promise<void> {
    return this.enqueue(async () => {
      if (this.lifecycleVersion !== expectedVersion) {
        logger.debug({ current: this.lifecycleVersion, expected: expectedVersion }, '[TranscriptionService] ensureReady ABORTED: lifecycleVersion mismatch');
        return;
      }

      // 1. Resolve strategy (Atomic)
      const strategy = STTNegotiator.negotiate(this.policy, this.options.onModeChange ? null : undefined);

      const newStrategy = STTStrategyFactory.create(strategy.mode, this.strategyCallbacks, this.policy);
      this.strategy = newStrategy;
      this.activeStrategyId = (newStrategy as unknown as { instanceId: string }).instanceId ?? Math.random().toString(36);

      // 2. Initialize
      await this.strategy.init();
    });
  }

  // Handlers populated via injection
  private dbHandlers?: {
    initDbSession: (mode: string, idempotencyKey: string, metadata: Record<string, unknown>) => Promise<string | null>;
    heartbeatSession: (sessionId: string) => Promise<void>;
    completeSession: (sessionId: string, transcript: string, duration: number) => Promise<void>;
  };

  private lock: DistributedLock;

  constructor(
    options: Partial<TranscriptionServiceOptions> = {},
    lock?: DistributedLock,
    private watchdogIntervalMs: number = 2000,
    private watchdogTimeoutMs: number = STT_CONFIG.HEARTBEAT_TIMEOUT_MS
  ) {
    logger.debug('[TranscriptionService] Initializing service');
    this.serviceId = Math.random().toString(36).substring(7);
    this.fsm = new TranscriptionFSM();
    this.negotiator = new STTNegotiator();
    this.setEngineReady(false);

    // 🛡️ Forensic Bridge (v0.7.0): Synchronous DOM signaling
    // Fired in the same tick as every FSM transition.
    this.fsm.subscribe((state: TranscriptionState) => {
      const runtimeState = mapToRuntimeState(state);
      if (this.mode !== null) {
        syncForensicAnchors(runtimeState, this.mode);
      } else {
        syncForensicAnchors(runtimeState);
      }
    });

    // T=0 Signal: Ensure IDLE is written before any async transitions
    syncForensicAnchors('IDLE');
    this.failureManager = new FailureManager() as FailureManager;
    this.lock = lock || new DistributedLock();
    this.policy = (options.policy || PROD_FREE_POLICY) as TranscriptionPolicy;

    // 1. Initial stable options to avoid undefined closure crashes
    this.options = {
      onTranscriptUpdate: options.onTranscriptUpdate || (() => { }),
      onModelLoadProgress: options.onModelLoadProgress || (() => { }),
      onReady: options.onReady || (() => { }),
      session: options.session || null,
      navigate: options.navigate || ((() => { }) as unknown as NavigateFunction),
      getAssemblyAIToken: options.getAssemblyAIToken || (async () => null),
      userWords: options.userWords || [],
      policy: this.policy,
      mockMic: options.mockMic,
      onModeChange: options.onModeChange,
      onStatusChange: options.onStatusChange,
      onAudioData: options.onAudioData,
      onError: options.onError,
      onHistoryUpdate: options.onHistoryUpdate,
    };

    // 2. stable strategyCallbacks
    this.strategyCallbacks = {
      onTranscriptUpdate: (data) => {
        if (this.isTerminated) return;
        pushTranscriptLifecycleTrace('engine:emit', {
          engine: this.mode,
          type: data.transcript.final ? 'final' : 'partial',
          textLength: (data.transcript.final || data.transcript.partial || '').length,
          preview: (data.transcript.final || data.transcript.partial || '').slice(0, 80),
        });
        if (isPrivateTranscriptTraceEnabled()) {
          logger.info({
            serviceId: this.serviceId,
            mode: this.mode,
            isFinal: Boolean(data.transcript.final),
            hasPartial: Boolean(data.transcript.partial),
            textLength: (data.transcript.final || data.transcript.partial || '').length,
          }, '[PRIVATE_TRACE] service_transcript_callback');
        }
        this.processTranscript(data);
      },
      onModelLoadProgress: (p) => {
        if (this.isTerminated) return;
        this.processModelLoadProgress(p);
      },
      onReady: () => {
        if (this.isTerminated) return;
        if (this.mode === 'private' && this.modelLoadingProgress !== null) {
          this.processModelLoadProgress(100);
        }
        this.options.onReady?.();
      },
      onStatusChange: (status) => {
        if (this.isTerminated) return;
        if (typeof status.progress === 'number') {
          this.processModelLoadProgress(status.progress);
        }
        this.options.onStatusChange?.(status);
      },
      onError: (error) => {
        if (this.isTerminated) return;
        this.idempotencyKey = null; // Reset on failure

        // 1. Check if we have a fallback path (e.g. from cloud to native)
        const canFallback =
          this.canFallbackToNative() &&
          (this.fsm.is('ENGINE_INITIALIZING') || this.fsm.is('READY'));

        if (canFallback) {
          logger.warn({ from: this.mode }, '[TranscriptionService] Attempting native fallback');
          void this.warmUp('native').catch((fallbackError) => {
            logger.error({
              originalError: error,
              fallbackError,
              from: this.mode,
            }, '[TranscriptionService] Native fallback warmup failed after strategy error');
            this.fsm.transition({ type: 'ERROR_OCCURRED', error });
            this.options.onError?.(error);
          });
          return;
        }

        // 2. Otherwise terminal failure
        this.fsm.transition({ type: 'ERROR_OCCURRED', error });
        this.options.onError?.(error);
      },
      onConnectionStateChange: (s) => {
        // Connection state is usually global to the strategy/service
        this.options.onStatusChange?.({ type: s === 'connected' ? 'ready' : 'info', message: `Connection ${s}` });
      },
      session: options.session || null,
      navigate: options.navigate || ((() => { }) as unknown as NavigateFunction),
      getAssemblyAIToken: options.getAssemblyAIToken || (async () => null),
      userWords: options.userWords || [],
      serviceId: this.serviceId,
      runId: this.runId || 'unknown'
    };

    // Expose callbacks for deterministic probing
    if (isBridgeActive()) {
      const win = window as unknown as Record<string, { _activeCallbacks?: TranscriptionModeOptions }>;
      if (win.__SS_E2E__) {
        win.__SS_E2E__._activeCallbacks = this.strategyCallbacks;
      }
    }

    this.fsm.subscribe(state => this.handleStateChange(state));

    // DB Persistence Wiring
    this.dbHandlers = {
      initDbSession: async (mode, idempotencyKey, metadata) => {
        // Record only if session is bound and policy permits persistence
        if (!this.options.session?.user) return null;
        // Map to saveSession contract
        const result = await saveSession(
          { user_id: this.options.session.user.id, mode } as unknown as never,
          { id: this.options.session.user.id } as unknown as never,
          mode,
          idempotencyKey,
          metadata as unknown as never
        );
        return result.session?.id || null;
      },
      heartbeatSession: async (sessionId) => {
        await heartbeatSession(sessionId);
      },
      completeSession: async (sessionId, transcript, duration) => {
        await completeSession(sessionId, { transcript, duration });
      }
    };
  }



  /**
   * Explicitly initiates model download at user request.
   * Resets DOWNLOAD_REQUIRED gate via FSM so normal initialization proceeds.
   * Do not call from automatic warm-up pulses — use warmUp() for those.
   */
  public async initiateDownload(mode?: TranscriptionMode): Promise<void> {
    const targetMode = mode || this.mode || 'private';
    const { mode: negotiatedMode, isMock } = STTNegotiator.negotiate(this.policy, targetMode);

    // 🛡️ RACECONDITION FIX: Clear idempotency key to allow re-initialization
    // after a background pulse has gated.
    this.idempotencyKey = null;

    await this.initializeStrategy(negotiatedMode, isMock, true);
  }

  public async warmUp(mode: TranscriptionMode): Promise<void> {
    const { mode: negotiatedMode, isMock } = STTNegotiator.negotiate(this.policy, mode);
    try {
      await this.initializeStrategy(negotiatedMode, isMock, false); // Background pulse — stop at DOWNLOAD_REQUIRED
    } catch (error) {
      logger.debug({ error, mode: negotiatedMode }, '[TranscriptionService] Warm-up failed (ignoring)');
    }
  }

  /**
   * Mode-Neutral Strategy Initialization.
   * Probes availability, handles BLOCKED states, and prepares strategy.
   */
  private async initializeStrategy(mode: TranscriptionMode, isMock: boolean = false, forceExplicit: boolean = false): Promise<void> {
    // 🛡️ RE-ENTRY GUARD: Prevent redundant initialization for the SAME mode
    if (this.fsm.is('ENGINE_INITIALIZING') && this.mode === mode) {
      logger.warn({ mode, isMock }, '[TranscriptionService] initializeStrategy already in progress for this mode — skipping');
      return;
    }

    logger.debug('[TRACE] STRATEGY_RESOLVE_START');

    /**
     * Engine Mode Validation Invariant.
     * Prevents unplanned mode switches after a strategy has been explicitly requested.
     * A mode can ONLY be switched to if it is the explicitly requested user mode
     * (from policy.preferredMode) or if preferredMode is completely unset.
     */
    // 🛡️ Engine Mode Validation Invariant
    if (this.policy.preferredMode && mode !== this.policy.preferredMode && mode !== 'mock') {
      throw new Error(`[Invariant Violation] Implicit mode switch detected: negotiated mode '${mode}' does not match explicit user preference '${this.policy.preferredMode}'`);
    }

    // 🛡️ 1. Mode Lock Guard: Block mid-session pivots (Security Invariant)
    if (this.isModeLocked && this.mode !== null && this.mode !== mode) {
      throw TranscriptionError.modeLocked(this.mode, mode);
    }

    // 🛡️ 2. Session Isolation: Purge old strategy BEFORE persisting new mode (Zombie prevention)
    if (this.strategy && this.mode !== mode) {
      this.strategyVersion++;
      try { await this.strategy.terminate(); } catch (e) { logger.warn({ e }, '[TranscriptionService] Strategy terminate failed during mode switch'); }
      this.strategy = null;
      this.activeStrategyId = null;
    }

    // 🏁 3. Persist Identity: Secure identity BEFORE engine creation (Logic Tier Fix)
    this.idempotencyKey = this.idempotencyKey || Math.random().toString(STT_CONFIG.ALPHANUMERIC_RADIX).substring(7);
    this.mode = mode;
    syncForensicAnchors(mapToRuntimeState(this.fsm.getState()), this.mode);

    // 🏗️ 4. Strategy Lifecycle: Instantiate or Preserve
    if (!this.strategy) {
      logger.debug('[TRACE] FACTORY_CREATE_START');

      const tempId = Math.random().toString(36).substring(7);
      this.activeStrategyId = tempId;

      const isolatedCallbacks: TranscriptionModeOptions = {
        ...this.strategyCallbacks,
        onTranscriptUpdate: (data) => {
          if (this.activeStrategyId !== tempId) return;
          if (!this.emissionsEnabled) {
            this.pendingTranscriptQueue.push(data);
            return;
          }
          this.strategyCallbacks.onTranscriptUpdate(data);
        },
        onReady: () => {
          if (this.activeStrategyId !== tempId) return;
          this.strategyCallbacks.onReady();
        },
        onModelLoadProgress: (p) => {
          if (this.activeStrategyId !== tempId) return;
          this.strategyCallbacks.onModelLoadProgress?.(p);
        },
        onStatusChange: (status) => {
          if (this.activeStrategyId !== tempId) return;
          this.strategyCallbacks.onStatusChange?.(status);
        },
        onAudioData: (data) => {
          if (this.activeStrategyId !== tempId) return;
          this.strategyCallbacks.onAudioData?.(data);
        },
        onError: (err) => {
          if (this.activeStrategyId !== tempId) return;
          if (mode === 'private') {
            this.failureManager.recordPrivateFailure();
          }
          this.strategyCallbacks.onError?.(err);
        }
      };

      const newStrategy = STTStrategyFactory.create(mode, isolatedCallbacks, this.policy);
      this.strategy = newStrategy;
      logger.debug('[TRACE] FACTORY_CREATE_END');
    }

    // 🛡️ 2. Availability Probe (Heartbeat Guard)
    const availability = typeof this.strategy.checkAvailability === 'function'
      ? await this.strategy.checkAvailability()
      : { isAvailable: true };

    // Skip availability gating for 'mock' mode
    if (mode !== 'mock') {
      const isExplicitInit = this.fsm.is('ENGINE_INITIALIZING') || forceExplicit;

      // Gate 1: CACHE_MISS specific
      if (!availability.isAvailable && availability.reason === 'CACHE_MISS') {
        if (!this.fsm.is('DOWNLOAD_REQUIRED') && !isExplicitInit
          && !this.fsm.is('READY') && !this.fsm.is('RECORDING')) {
          this.fsm.transition({ type: 'DOWNLOAD_REQUIRED' });
        }

        this.options.onStatusChange?.({
          type: 'download-required',
          message: 'Private model needs a one-time download.',
          detail: 'Download once to use offline transcription in this browser.',
          progress: 0
        });

        if (!isExplicitInit) return; // background pulse — stop here
        // explicit init — fall through to strategy.init()
      }

      // Gate 2: General availability failure
      if (!availability.isAvailable && availability.reason !== 'CACHE_MISS') {
        const error = TranscriptionError.engineFailure(mode, availability.message || 'Strategy unavailable');
        logger.error({ mode, reason: availability.reason }, '[TranscriptionService] Strategy NOT AVAILABLE. Gating execution.');
        this.fsm.transition({ type: 'ERROR_OCCURRED', error });
        this.options.onStatusChange?.({
          type: 'error',
          message: availability.message || 'Strategy blocked'
        });
        throw error;
      }
      // If isExplicitInit and !isAvailable due to CACHE_MISS — falls through to init()
    }

    // 4. Prepare Strategy (PREPARING state)
    this.fsm.transition({ type: 'ENGINE_INIT_REQUESTED' });
    try {
      const version = this.strategyVersion;
      const strategy = this.strategy;
      if (!strategy) return;

      logger.debug('[TRACE] ENGINE_INIT_START');
      const initResult = await this.strategy.init(STT_CONFIG.STRATEGY_INIT_TIMEOUT_MS, isMock);

      if (version !== this.strategyVersion) {
        logger.debug('[TranscriptionService] initializeStrategy aborted: strategy version mismatch');
        return;
      }

      if (!initResult.isOk) {
        const error = (initResult as { isOk: false; error: Error }).error;
        throw error || new Error('STRATEGY_INIT_FAILURE');
      }

      // Final READY transition
      if (this.fsm.is('ENGINE_INITIALIZING') || this.fsm.is('DOWNLOADING')) {
        logger.info({ runId: this.runId, mode: this.mode }, '[TranscriptionService] Strategy initialized. Transitioning to READY.');
        this.fsm.transition({ type: 'ENGINE_INIT_SUCCESS' });
        this.markPrivateModelReady();
        pushE2EEvent('ENGINE_READY', { serviceId: this.serviceId, source: 'TranscriptionService', sessionId: this.sessionId });
      }
    } catch (error: unknown) {
      console.error('[DIAGNOSTIC HEARTBEAT ERROR]', error);
      const err = error as { code?: string; message?: string };
      // CACHE_MISS can be thrown or returned during init
      if (err?.code === 'CACHE_MISS' || err?.message?.includes('CACHE_MISS')) {
        logger.warn({ mode }, '[TranscriptionService] Model CACHE_MISS detected during init. transitioning to DOWNLOAD_REQUIRED.');
        if (!this.fsm.is('READY') && !this.fsm.is('RECORDING')) {
          this.fsm.transition({ type: 'DOWNLOAD_REQUIRED' });
        }
        this.options.onStatusChange?.({
          type: 'download-required',
          message: 'Private model needs a one-time download.',
          detail: 'Download once to use offline transcription in this browser.',
          progress: 0
        });
        return;
      }

      if (mode === 'private') {
        this.failureManager.recordPrivateFailure();
        logger.warn({
          errorName: err?.constructor?.name,
          errorMessage: err?.message,
          errorCode: err?.code,
        }, '[TranscriptionService] Private model setup failed. Restoring explicit retry state.');

        this.markPrivateModelInitFailed(error);
        if (this.fsm.is('ENGINE_INITIALIZING') || this.fsm.is('DOWNLOADING') || this.fsm.is('DOWNLOAD_COMPLETE')) {
          this.fsm.transition({ type: 'INIT_FAILED', error: error as Error });
          return;
        }

        if (!this.fsm.is('READY') && !this.fsm.is('RECORDING')) {
          this.fsm.transition({ type: 'DOWNLOAD_REQUIRED' });
        }

        this.options.onStatusChange?.({
          type: 'download-required',
          message: 'Private model setup did not complete.',
          detail: 'Retry the local model setup. Check browser storage if setup fails again. Your audio stays on your machine.',
          progress: 0
        });
        return;
      }

      const canFallback = this.canFallbackToNative();
      if (canFallback) {
        logger.warn({
          errorName: err?.constructor?.name,
          errorMessage: err?.message,
          errorCode: err?.code,
        }, '[TranscriptionService] Init failed, attempting native fallback');
        return this.warmUp('native').catch((fallbackError) => {
          logger.error({
            originalError: error,
            fallbackError,
            mode,
          }, '[TranscriptionService] Native fallback warmup failed after init error');
          this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
        });
      }

      logger.error({ mode, error }, '[TranscriptionService] Strategy preparation failed');
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      throw error;
    }
  }

  /**
   * Primary Entry Point: Pre-warms the microphone stream.
   */
  public async init(): Promise<{ success: boolean }> {
    if (this.fsm.is('READY') || this.fsm.is('RECORDING') || this.fsm.is('ENGINE_INITIALIZING')) {
      return { success: true };
    }

    if (this.fsm.is('TERMINATED')) {
      this.fsm.transition({ type: 'RESET_REQUESTED' });
      this.destroyPromise = null; // Reset lock to allow future destruction
    }

    if (!this.fsm.is('IDLE') && !this.fsm.is('FAILED')) {
      logger.debug({ state: this.fsm.getState() }, '[TranscriptionService] init() called in unexpected state');
    }

    this.fsm.transition({ type: 'START_REQUESTED' });

    // 1. Mic Acquisition
    try {
      if (this.options.mockMic) {
        this.mic = this.options.mockMic;
      } else {
        this.mic = await createMicStream();
      }
      this.fsm.transition({ type: 'MIC_ACQUIRED' });
    } catch (error) {
      this.micError = error as Error;
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      return { success: false };
    }

    // 2. Unified Strategy Enrollment (Authoritative Gate - Consolidates Task 5.1.1)
    const requestedMode = this.policy.preferredMode || 'native';
    const { mode, isMock } = STTNegotiator.negotiate(this.policy, requestedMode);

    try {
      await this.initializeStrategy(mode, isMock);

      // ✅ READINESS RESTORATION: Ensure we settle in READY (Authoritative for Task 5.1.1)
      if (this.fsm.is('ENGINE_INITIALIZING')) {
        this.fsm.transition({ type: 'ENGINE_INIT_SUCCESS' });
        pushE2EEvent('ENGINE_READY', { serviceId: this.serviceId, source: 'TranscriptionService', sessionId: this.sessionId });
      }

      return { success: true };
    } catch (error) {
      // initializeStrategy already transitions FSM to ERROR_OCCURRED and logs
      return { success: false };
    }
  }

  /**
   * MULTI-SEGMENT HANDOFF:
   * Moves current work to history and switches to a fresh Native Browser session.
   */
  public async switchToNativeSegmented(): Promise<void> {
    if (!this.strategy || !this.mode) return;

    logger.info({ sId: this.serviceId, rId: this.runId }, '[TranscriptionService] Initiating multi-segment handoff to Native');
    this.options.onError?.(TranscriptionError.unknown('Speech recognition restart failed after multiple attempts'));

    // 1. Capture work done so far
    try {
      const text = await this.strategy.getTranscript();
      if (text.trim()) {
        this.transcriptHistory.push({ mode: this.mode, text, timestamp: Date.now() });
        this.options.onHistoryUpdate?.([...this.transcriptHistory]);
      }
    } catch (error) {
      logger.error({ sId: this.serviceId, rId: this.runId, error }, '[TranscriptionService] Failed to capture transcript for handoff');
    }

    // 2. Stop and dispose current strategy
    await this.destroy();

    // 3. Reset state for Fresh Start (handoff reuse — not a true termination)
    this.isTerminated = false;
    this.fsm.transition({ type: 'RESET_REQUESTED' });
    this.destroyPromise = null;

    // 4. Force Native Mode
    await this.updatePolicy({
      ...this.policy,
      allowPrivate: false,
      preferredMode: 'native',
      executionIntent: 'native-recovery'
    });

    // 5. Start Fresh
    logger.info({ sId: this.serviceId }, '[TranscriptionService] Starting fresh Native session');
    await this.startTranscription();
  }

  /**
   * Unified Entry Point for starting transcription.
   */
  public async startTranscription(runtimePolicy?: TranscriptionPolicy, userWords: string[] = []): Promise<void> {
    logger.debug('[TRACE] START_TRANSCRIPTION');
    this.assertAlive();
    this.options.userWords = userWords;
    if (runtimePolicy) await this.updatePolicy(runtimePolicy);

    if (this.fsm.is('CLEANING_UP')) {
      logger.warn('[TranscriptionService] startTranscription rejected - still cleaning up');
      throw new Error('TRANSCRIPTION_SERVICE_CLEANING_UP');
    }

    // 1. Session Isolation: Clear existing session if active
    if (this.fsm.is('RECORDING') || this.fsm.is('ENGINE_INITIALIZING') || this.fsm.is('PAUSED')) {
      logger.info('[TranscriptionService] Interrupting active session for new request');
      await this.destroy();
    }

    // 2. Auto-init mic if needed
    if (this.fsm.is('IDLE') || this.fsm.is('FAILED') || this.fsm.is('TERMINATED')) {
      const ok = await this.init();
      if (!ok.success) {
        if ((this.fsm.is('DOWNLOAD_REQUIRED') || this.fsm.is('FAILED')) && this.mode !== 'mock') return;
        if (this.strategy && this.fsm.is('ENGINE_INITIALIZING')) {
          this.fsm.transition({ type: 'ENGINE_INIT_SUCCESS' });
        }
      }
    }

    const requestedMode = this.policy.preferredMode || 'private';
    const { mode, isMock } = STTNegotiator.negotiate(this.policy, requestedMode);

    const hasMic = await this.ensureMicReadyForStart();
    if (!hasMic) {
      if ((this.fsm.is('DOWNLOAD_REQUIRED') || this.fsm.is('FAILED')) && this.mode !== 'mock') return;
      throw this.micError || new Error('MIC_STREAM_UNAVAILABLE');
    }

    this.runId = Math.random().toString(36).substring(7);
    this.idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

    logger.info({ serviceId: this.serviceId, runId: this.runId, mode }, '[TranscriptionService] 🚀 Start requested');
    this.pendingTranscriptQueue = [];
    this.emissionsEnabled = false;

    try {
      // 3. Initialize Strategy (Handles Availability & Preparation)
      logger.debug({ runId: this.runId, mode }, '[TranscriptionService] Calling initializeStrategy');
      await this.initializeStrategy(mode, isMock, true);

      // 4. Start Strategy Execution
      logger.debug({ runId: this.runId, mode }, '[TranscriptionService] Calling executeStrategy');
      await this.executeStrategy(mode, userWords);
    } catch (error) {
      logger.error({ mode, runId: this.runId, error }, '[TranscriptionService] startTranscription FAILED');
      // FSM and UI status already updated in initializeStrategy/executeStrategy
      throw error;
    }
  }

  private async executeStrategy(mode: TranscriptionMode, userWords: string[] = []): Promise<void> {
    logger.debug('[TRACE] STRATEGY_RESOLVE_END');
    this.options.userWords = userWords;
    if (!this.strategy) return;

    // 🛡️ Step 3: Block premature start
    if (this.fsm.is('READY')) {

      this.startTimestamp = Date.now();
    } else {
      logger.warn({ state: this.fsm.getState() }, '[TranscriptionService] executeStrategy aborted: FSM not in READY state');
      throw new Error(`TRANSCRIPTION_START_BLOCKED_STATE:${this.fsm.getState()}`);
    }

    const runId = this.runId; // 🛡️ Step 4: Capture runId for async coupling

    try {
      logger.info({
        runId,
        engine: this.strategy.getEngineType(),
        strategyObj: this.strategy?.constructor?.name
      }, '[TranscriptionService] 🚦 Executing strategy start...');

      this.attachMicFramePump(mode);
      await this.strategy.start(this.mic!, this.options.userWords ?? []);

      // 🛡️ Step 4: Strict Success Coupling
      if (this.runId !== runId) {
        logger.warn({ runId, current: this.runId }, '[TranscriptionService] Start settled after runId changed; preserving successful engine transition.');
      }

      this.fsm.transition({ type: 'ENGINE_STARTED' });
      this.emissionsEnabled = true;
      this.flushPendingTranscripts();
      logger.info({ runId }, '[TranscriptionService] Strategy started successfully');
      this.startTime = Date.now();
      this.options.onModeChange?.(mode);
      this.startWatchdog();

      const state = (useSessionStore as unknown as { getState: () => { setActiveEngine: (mode: string) => void } }).getState?.();
      if (state) state.setActiveEngine(mode);

      this.isModeLocked = true; // 🔒 Lock intent upon successful engine start
    } catch (error) {
      if (this.runId !== runId) return; // Ignore failures from stale runs

      logger.error({ runId, error }, '[TranscriptionService] Strategy execution FAILED');
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      throw error;
    }
  }

  private attachMicFramePump(mode: TranscriptionMode): void {
    this.detachMicFramePump();

    if (!this.mic || typeof this.mic.onFrame !== 'function') return;

    const strategy = this.strategy as (STTStrategy & { processAudio?: (data: Float32Array) => void }) | null;
    const shouldForwardToStrategy = mode === 'cloud' && typeof strategy?.processAudio === 'function';
    const shouldAnalyzeFrames = mode !== 'private';

    if (!shouldForwardToStrategy && !shouldAnalyzeFrames) return;

    this.micFramePumpCount = 0;
    this.micFrameDisposer = this.mic.onFrame((frame: Float32Array) => {
      const clonedFrame = frame.slice(0);
      this.micFramePumpCount++;

      if (shouldForwardToStrategy && (this.micFramePumpCount === 1 || this.micFramePumpCount % 25 === 0)) {
        logger.info({
          sId: this.serviceId,
          rId: this.runId,
          mode,
          frames: this.micFramePumpCount,
          samples: clonedFrame.length,
        }, '[TranscriptionService] cloud mic frame forwarded');
      }

      if (shouldAnalyzeFrames) {
        this.options.onAudioData?.(clonedFrame);
      }

      if (shouldForwardToStrategy) {
        strategy?.processAudio?.(clonedFrame);
      }
    });
  }

  private detachMicFramePump(): void {
    if (!this.micFrameDisposer) return;
    this.micFrameDisposer();
    this.micFrameDisposer = null;
  }

  private async ensureMicReadyForStart(): Promise<boolean> {
    if (this.mic) return true;

    try {
      if (this.options.mockMic) {
        this.mic = this.options.mockMic;
      } else if (ENV.isE2E) {
        this.mic = this.createE2EMockMic();
      } else {
        this.mic = await createMicStream();
      }
      return true;
    } catch (error) {
      this.micError = error as Error;
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      return false;
    }
  }

  private createE2EMockMic(): MicStream {
    const mediaStream = typeof MediaStream !== 'undefined' ? new MediaStream() : ({} as MediaStream);
    return {
      state: 'ready',
      sampleRate: PRIV_CLOUD_AUDIO.TARGET_SAMPLE_RATE_HZ,
      onFrame: () => () => { },
      offFrame: () => { },
      stop: () => { },
      close: () => { },
      _mediaStream: mediaStream
    };
  }

  private flushPendingTranscripts(): void {
    while (this.pendingTranscriptQueue.length > 0 && this.emissionsEnabled) {
      const update = this.pendingTranscriptQueue.shift();
      if (update) {
        this.strategyCallbacks.onTranscriptUpdate(update);
      }
    }
  }

  /**
   * Stop transcription and calculate stats.
   */
  public async stopTranscription(): Promise<{ success: boolean; transcript: string; stats: TranscriptStats } | null> {
    logger.debug('[TRACE] STOP_TRANSCRIPTION');
    logger.info({
      sId: this.serviceId,
      rId: this.runId,
      mode: this.mode,
      fsmState: this.fsm.getState(),
      hasStrategy: Boolean(this.strategy),
      currentTranscriptLength: this.currentTranscript.length,
      partialTranscriptLength: this.partialTranscript.length,
    }, '[DEBUG-STOP] TranscriptionService.stopTranscription entry');
    if (!this.fsm.is('RECORDING') && !this.fsm.is('PAUSED') && !this.fsm.is('ENGINE_INITIALIZING')) {
      logger.warn({
        sId: this.serviceId,
        rId: this.runId,
        mode: this.mode,
        fsmState: this.fsm.getState(),
        currentTranscriptLength: this.currentTranscript.length,
        partialTranscriptLength: this.partialTranscript.length,
      }, '[DEBUG-STOP] TranscriptionService.stopTranscription returning null: non-stoppable state');
      return null;
    }

    this.stopWatchdog();

    // Handle early stop during initialization
    if (this.fsm.is('ENGINE_INITIALIZING')) {
      logger.info({ sId: this.serviceId, rId: this.runId }, '[TranscriptionService] Early stop during initialization. Terminating strategy.');
      this.modelLoadingProgress = null;
      const state = (useSessionStore as unknown as { getState: () => { setModelLoadingProgress: (p: number | null) => void } }).getState?.();
      if (state) state.setModelLoadingProgress(null);

      this.fsm.transition({ type: 'STOP_REQUESTED' });
      // CRITICAL: Call destroy() to purge the initializing strategy/workers
      await this.destroy();

      return { success: true, transcript: '', stats: calculateTranscriptStats([], [], '', 0) };
    }

    this.fsm.transition({ type: 'STOP_REQUESTED' });

    try {
      let transcript = '';
      if (this.strategy) {
        await this.strategy.stop();
        this.detachMicFramePump();
        const strategyTranscript = (await this.strategy.getTranscript()).trim();
        // Streaming providers can expose useful live text as partial turns until
        // the final turn arrives. Stop/save must preserve that visible transcript
        // instead of treating a missing provider final as an empty session.
        const visibleTranscript = (this.currentTranscript || this.partialTranscript).trim();
        transcript = visibleTranscript.length > strategyTranscript.length
          ? visibleTranscript
          : strategyTranscript || visibleTranscript;
        logger.info({
          sId: this.serviceId,
          rId: this.runId,
          mode: this.mode,
          strategyTranscriptLength: strategyTranscript.length,
          currentTranscriptLength: this.currentTranscript.length,
          partialTranscriptLength: this.partialTranscript.length,
          selectedTranscriptLength: transcript.length,
        }, '[DEBUG-STOP] TranscriptionService.stopTranscription transcript selected');
      }

      const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
      const stats = calculateTranscriptStats([{ transcript }], [], '', duration);
      logger.info({
        sId: this.serviceId,
        rId: this.runId,
        mode: this.mode,
        duration,
        transcriptLength: transcript.length,
        totalWords: stats.total_words,
        accuracy: stats.accuracy,
      }, '[DEBUG-STOP] TranscriptionService.stopTranscription returning result');

      this.fsm.transition({ type: 'STOP_COMPLETED' });
      this.isModeLocked = false; // 🔓 Release lock
      const state = (useSessionStore as unknown as { getState: () => { setActiveEngine: (m: string | null) => void; setModelLoadingProgress: (p: number | null) => void } }).getState?.();
      if (state) {
        state.setActiveEngine(null);
        state.setModelLoadingProgress(null);
      }

      return { success: true, transcript, stats };
    } catch (error: unknown) {
      logger.error({ mode: this.mode, error: error as Error }, '[TranscriptionService] stopTranscription failed');
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      this.options.onError?.(error as Error);
      this.startTime = null;
      this.isModeLocked = false; // 🔓 Release lock always on completion
      return { success: false, transcript: '', stats: { transcript: '', total_words: 0, accuracy: 0, duration: 0 } };
    }
  }

  /**
   * Pause transcription.
   */
  public async pauseTranscription(): Promise<void> {
    if (!this.fsm.is('RECORDING')) {
      logger.warn({ state: this.fsm.getState() }, '[TranscriptionService] pauseTranscription ignored: not in RECORDING state');
      return;
    }

    logger.info({ sId: this.serviceId, rId: this.runId }, '[TranscriptionService] ⏸️ Pausing transcription...');
    this.fsm.transition({ type: 'PAUSE_REQUESTED' });

    try {
      if (this.strategy) {
        await this.strategy.pause();
      }
      this.fsm.transition({ type: 'PAUSE_COMPLETED' });
      this.options.onStatusChange?.({ type: 'paused', message: 'Paused' });
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] pauseTranscription failed');
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      throw error;
    }
  }

  /**
   * Resume transcription.
   */
  public async resumeTranscription(): Promise<void> {
    if (!this.fsm.is('PAUSED')) {
      logger.warn({ state: this.fsm.getState() }, '[TranscriptionService] resumeTranscription ignored: not in PAUSED state');
      return;
    }

    logger.info({ sId: this.serviceId, rId: this.runId }, '[TranscriptionService] ▶️ Resuming transcription...');
    this.fsm.transition({ type: 'RESUME_REQUESTED' });

    try {
      if (this.strategy) {
        await this.strategy.resume();
      }
      this.fsm.transition({ type: 'RESUME_COMPLETED' });
      this.options.onStatusChange?.({ type: 'recording', message: 'Recording' });
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] resumeTranscription failed');
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      throw error;
    }
  }

  /**
   * Cleanup resources.
   */
  /* Cleanup status tracked via FSM state 'CLEANING_UP' */

  /**
   * NUCLEAR CLEANUP: Forceful termination of all resources.
   * Idempotent and safe against concurrent calls.
   */
  public async destroy(): Promise<void> {
    this.isDestroyed = true;
    logger.info({ sId: this.serviceId, state: this.fsm.getState() }, '[TranscriptionService] destroy() invoked');

    if (this.destroyPromise) return this.destroyPromise;

    this.destroyPromise = (async () => {
      if (this.fsm.is('TERMINATED')) {
        // Already terminal — ensure lock is released if it somehow wasn't
        this.lock.release();
        return;
      }

      this.isModeLocked = false;
      this.fsm.transition({ type: 'TERMINATE_REQUESTED' }); // → CLEANING_UP (or TERMINATED for IDLE/FAILED)
      this.stopWatchdog();

      if (this.mic) {
        this.detachMicFramePump();
        this.mic.stop();
        this.mic = null;
      }

      if (this.strategy) {
        try {
          logger.debug('[TranscriptionService] Calling strategy.terminate()');
          await this.strategy.terminate(); // ← awaited; this is the only async gate
          logger.debug('[TranscriptionService] strategy.terminate() completed');
        } catch (error: unknown) {
          logger.error({ mode: this.mode, error: error as Error }, '[TranscriptionService] Strategy termination failed');
        }
        this.strategy = null;
        this.activeStrategyId = null;
      }

      this.runId = null;
      this.isTerminated = true;

      // Only transition to TERMINATED if we went through CLEANING_UP
      if (this.fsm.is('CLEANING_UP')) {
        this.fsm.transition({ type: 'TERMINATE_COMPLETED' }); // → TERMINATED
      }

      // Sync lock metadata with FSM state before release
      this.lock.updateState('TERMINATED');
      // ✅ Lock released HERE and only HERE — state is now guaranteed TERMINATED
      this.lock.release();

      this.reset('TERMINATED');
      logger.info({ sId: this.serviceId }, '[TranscriptionService] ✅ destroy() complete, lock released');
    })();

    return this.destroyPromise;
  }

  private assertAlive(): void {
    if (this.isTerminated) {
      throw new Error(`[Invariant Violation] ENGINE_ALREADY_TERMINATED (ID: ${this.serviceId})`);
    }
  }

  public isServiceDestroyed(): boolean {
    return this.fsm.is('TERMINATED');
  }

  /**
   * ✅ STRUCTURAL FIX: Explicit Unsubscribe Contract.
   * Enforces a single active subscriber to prevent listener leakage across remounts.
   */
  public subscribe(newOptions: Partial<TranscriptionServiceOptions>, subscriberId: string = 'unknown'): () => void {
    pushE2EEvent('SUBSCRIBE', { id: subscriberId, source: 'TranscriptionService', sessionId: this.sessionId });
    logger.debug({ id: subscriberId, serviceId: this.serviceId, timestamp: Date.now() }, '[SUBSCRIBE]');
    logger.info({}, '[TRACE] SUBSCRIBE');
    this.assertAlive();

    // 🛡️ STEP 3: Single Subscriber Invariant
    if (this.activeSubscriberId && this.activeSubscriberId !== subscriberId) {
      logger.error({ current: this.activeSubscriberId, requested: subscriberId }, '[TranscriptionService] 🛡️ Guard: SUBSCRIBER_ALREADY_ATTACHED');
      throw new Error('SUBSCRIBER_ALREADY_ATTACHED');
    }

    this.activeSubscriberId = subscriberId;
    this.updateCallbacks(newOptions);

    // 🛡️ REHYDRATION BRIDGE: Synchronously project the current ground truth state 
    // to new subscribers. This eliminates the 'Visibility Gap' during React 
    // StrictMode remounts where a new observer would otherwise see a blank state.
    if (this.currentTranscript || this.partialTranscript) {
      logger.debug(`[TRACE] REHYDRATE_TRANSCRIPT_PULSE ${!!this.currentTranscript}`);
      newOptions.onTranscriptUpdate?.({
        transcript: {
          final: this.currentTranscript,
          partial: this.partialTranscript
        }
      });
    }

    if (this.transcriptHistory.length > 0) {
      logger.debug(`[TRACE] REHYDRATE_HISTORY Segments: ${this.transcriptHistory.length}`);
      logger.info({ segments: this.transcriptHistory.length }, '[TranscriptionService] 🔄 Rehydrating new subscriber with history');
      newOptions.onHistoryUpdate?.(this.transcriptHistory);
    }

    // Project current FSM state to sync UI status (Step 5: SSOT)
    const currentState = this.fsm.getState();
    logger.debug({ state: currentState }, '[TranscriptionService] 🔄 Projecting current state to new subscriber');
    this.handleStateChange(currentState);

    return () => {
      pushE2EEvent('UNSUBSCRIBE', { id: subscriberId, source: 'TranscriptionService', sessionId: this.sessionId });
      logger.debug({ id: subscriberId, serviceId: this.serviceId }, '[UNSUBSCRIBE]');
      logger.debug({}, '[TRACE] UNSUBSCRIBE');
      if (this.activeSubscriberId === subscriberId) {
        logger.debug({ subscriberId }, '[TranscriptionService] Unsubscribing');
        this.activeSubscriberId = null;
        this.updateCallbacks({
          onTranscriptUpdate: () => { },
          onHistoryUpdate: undefined,
          onError: undefined,
          onStatusChange: undefined
        });
      }
    };
  }

  /**
   * INTERNAL: Updates the current callback closure.
   */
  public updateCallbacks(newOptions: Partial<TranscriptionServiceOptions>): void {
    this.options = { ...this.options, ...newOptions };

    this.strategyCallbacks.session = this.options.session;
    this.strategyCallbacks.navigate = this.options.navigate;
    this.strategyCallbacks.getAssemblyAIToken = this.options.getAssemblyAIToken;
    this.strategyCallbacks.userWords = this.options.userWords ?? [];
    const updateableStrategy = this.strategy as (STTStrategy & { updateOptions?: (options: Partial<TranscriptionModeOptions>) => void }) | null;
    updateableStrategy?.updateOptions?.({
      session: this.options.session,
      navigate: this.options.navigate,
      getAssemblyAIToken: this.options.getAssemblyAIToken,
      userWords: this.options.userWords ?? [],
    });

    // Project current FSM state to sync UI status (Step 5: SSOT)
    if (isBridgeActive()) {
      const win = window as unknown as Record<string, { _activeCallbacks?: TranscriptionModeOptions }>;
      if (win.__SS_E2E__) {
        win.__SS_E2E__._activeCallbacks = this.strategyCallbacks;
      }
    }
  }

  /**
   * Updates the transcription policy dynamically (e.g., after subscription upgrade).
   * 
   * @param newPolicy - The new policy to apply
   */
  public async updatePolicy(newPolicy: TranscriptionPolicy): Promise<void> {
    const nextMode = resolveMode(newPolicy);
    if (isEqual(this.policy, newPolicy) && this.mode === nextMode) return;

    const oldPolicy = this.policy;
    this.policy = newPolicy;
    this.options.policy = newPolicy;

    logger.info({
      policy: newPolicy,
      from: oldPolicy.executionIntent,
      mode: nextMode,
      to: newPolicy.executionIntent
    }, '[TranscriptionService] 🔄 Policy updated');

    this.setEngineReady(true);
  }

  public getSessionId(): string | null { return this.sessionId; }

  public getState(): TranscriptionState { return this.fsm.getState(); }
  public getMode(): TranscriptionMode | null { return this.mode; }
  public getPolicy(): TranscriptionPolicy { return this.policy; }
  public getTranscriptHistory(): HistorySegment[] { return this.transcriptHistory; }

  /**
   * ✅ E2E HOOK: Retrieves the current transcript from the strategy.
   */
  public async getTranscript(): Promise<string> {
    if (this.isDestroyed || !this.strategy) {
      return this.currentTranscript || this.partialTranscript || '';
    }
    const strategyTranscript = await this.strategy.getTranscript();
    return strategyTranscript || this.currentTranscript || this.partialTranscript || '';
  }

  /**
   * NUCLEAR RESET: authoritative clearing of all session state.
   * @param targetState - The state to transition the FSM to after clearing (default: 'IDLE')
   */
  public reset(targetState: TranscriptionState = 'IDLE'): void {
    logger.info({ sId: this.serviceId, targetState }, '[TranscriptionService] ☢️ NUCLEAR RESET: Clearing all async state and buffers');

    this.stopWatchdog();
    this.detachMicFramePump();

    // Clear ephemeral session state
    this.mode = null;
    this.isModeLocked = false;
    this.lastError = null;
    this.failureManager.resetFailureCount();

    this.sessionId = null;
    this.idempotencyKey = null;
    this.startTime = null;
    this.startTimestamp = 0;
    this.runId = null;

    // Clear buffers
    this.transcriptHistory = [];
    this.currentTranscript = '';
    this.partialTranscript = '';
    this.pendingTranscriptQueue = [];
    this.modelLoadingProgress = null;

    // Clear strategy and mic
    if (this.strategy) {
      this.strategyVersion++;
      // Note: termination is usually handled by destroy() before calling reset()
      this.strategy = null;
      this.activeStrategyId = null;
    }
    this.mic = null;

    // Reset FSM
    if (targetState === 'IDLE') {
      this.fsm.reset();
    } else {
      this.fsm.setState(targetState);
    }

    // Sync UI
    const state = (useSessionStore as unknown as {
      getState: () => {
        setActiveEngine: (m: unknown) => void;
        setSTTMode: (m: unknown) => void;
        setModelLoadingProgress: (p: unknown) => void;
        setSTTStatus: (s: unknown) => void;
      }
    }).getState?.();

    if (state) {
      state.setActiveEngine(null);
      state.setModelLoadingProgress(null);
      state.setSTTStatus({
        type: targetState === 'TERMINATED' ? 'idle' : 'idle',
        message: targetState === 'TERMINATED' ? 'Ready' : 'Ready'
      });
    }
  }

  /**
   * ✅ EXPERT FIX: Hard reset for test isolation.
   * Clears all ephemeral state but preserves WASM engine warm-up.
   */
  public resetEphemeralState(): void {
    logger.info('[TranscriptionService] 🧪 Resetting ephemeral state for isolation');
    this.detachMicFramePump();

    this.policy = PROD_FREE_POLICY;
    this.mode = null;
    this.isModeLocked = false;
    this.lastError = null;
    this.failureManager.resetFailureCount();

    // Clear Session State
    this.sessionId = null;
    this.idempotencyKey = null;
    this.startTime = null;
    this.startTimestamp = 0;
    this.runId = null;
    this.transcriptHistory = [];
    this.currentTranscript = '';
    this.partialTranscript = '';
    this.pendingTranscriptQueue = [];

    // Reset FSM to IDLE
    this.fsm.reset();


    this.modelLoadingProgress = null;

    // Clear strategy reference
    if (this.strategy) {
      this.strategyVersion++;
      void this.strategy.terminate().catch(e => logger.warn({ e }, '[TranscriptionService] Strategy terminate failed during reset'));
      this.strategy = null;
      this.activeStrategyId = null;
    }
    this.mic = null;

    const state = (useSessionStore as unknown as {
      getState: () => {
        setActiveEngine: (m: unknown) => void;
        setSTTMode: (m: unknown) => void;
        setModelLoadingProgress: (p: unknown) => void;
        modelLoadingProgress: number | null;
      }
    }).getState?.();
    if (state) {
      state.setModelLoadingProgress(null);
    }
  }

  /**
   * Abandons a pending download and clears associated state.
   */
  public async abandonDownload(): Promise<void> {
    logger.info('[TranscriptionService] Download abandoned');

    // Clear progress synchronously
    this.modelLoadingProgress = null;
    const state = (useSessionStore as unknown as {
      getState: () => {
        setActiveEngine: (m: unknown) => void;
        setSTTMode: (m: unknown) => void;
        setModelLoadingProgress: (p: unknown) => void;
        modelLoadingProgress: number | null;
      }
    }).getState?.();
    if (state) {
      state.setModelLoadingProgress(null);
    }

    // Cancel the download if in flight
    if (this.downloadController) {
      this.downloadController.abort();
      this.downloadController = null;
    }

    // Transition FSM
    this.fsm.transition({ type: 'STOP_REQUESTED' });
  }


  /**
   * Heartbeat Access:
   * Returns the last monotonic heartbeat from the active engine.
   */
  public getLastHeartbeatTimestamp(): number {
    if (this.isDestroyed || !this.strategy) return Date.now();
    return this.strategy.getLastHeartbeatTimestamp();
  }

  /**
   * Explicit Failure Escalation:
   * Called by the watchdog when an engine freeze is detected.
   */
  public handleHeartbeatFailure(error: Error): void {
    logger.error({ error, serviceId: this.options.session?.user?.id }, '[TranscriptionService] 🚨 Heartbeat Failure Escalated');
    this.options.onError?.(error);
  }

  private startWatchdog(): void {
    this.stopWatchdog();

    const timeout = this.watchdogTimeoutMs;

    this.watchdogTimer = setInterval(() => {
      if (!this.strategy) return;
      const lastHeartbeat = this.strategy.getLastHeartbeatTimestamp();
      const drift = Date.now() - lastHeartbeat;

      if (drift > timeout) {
        if (!this.isFrozen) {
          this.isFrozen = true;
          this.options.onStatusChange?.({
            type: 'warning',
            message: 'Speech recognition is taking a moment (Engine Frozen)',
            isFrozen: true
          });
        }
      } else if (this.isFrozen) {
        this.isFrozen = false;
        this.options.onStatusChange?.({
          type: 'info',
          message: 'Speech recognition recovered',
          isFrozen: false
        });
      }
    }, this.watchdogIntervalMs);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.isFrozen = false;
  }


  /**
   * Mandatory Transcript Processing Pipeline.
   * Ensures sanitation cannot be bypassed by configuration mistakes.
   */
  private processTranscript(update: TranscriptUpdate): void {
    logger.debug(`[TRACE] ENGINE_DATA ${!!update.transcript.final}`);
    pushTranscriptLifecycleTrace('service:receive', {
      engine: this.mode,
      type: update.transcript.final ? 'final' : 'partial',
      textLength: (update.transcript.final || update.transcript.partial || '').length,
      preview: (update.transcript.final || update.transcript.partial || '').slice(0, 80),
    });

    if (this.fsm.is('TERMINATED') || this.fsm.is('CLEANING_UP') || this.isTerminated) {
      logger.debug('[TranscriptionService] 🛡️ Guard: Dropping transcript update because service is terminated');
      return;
    }

    if (!this.emissionsEnabled) {
      this.pendingTranscriptQueue.push(update);
      return;
    }

    if (this.fsm.is('PAUSED')) {
      logger.debug('[TranscriptionService] Ignoring transcript update while PAUSED');
      return;
    }
    const transcript = update.transcript;
    logger.debug({ final: transcript.final?.length, partial: transcript.partial?.length }, '[TranscriptionService] Processing transcript');

    if (transcript.final) {
      transcript.final = this.sanitizeTranscript(transcript.final);
    }
    if (transcript.partial) {
      transcript.partial = this.sanitizeTranscript(transcript.partial);
    }

    // E2E partials can be projected immediately for deterministic UI checks.
    // Finals must still flow through the controller so the chunk-backed live
    // transcript remains the single visible source of truth.
    if (isBridgeActive() && transcript.partial && !transcript.final) {
      const store = useSessionStore.getState();
      store.updateTranscript(store.transcript.transcript, transcript.partial);
    }

    if (transcript.final) {
      this.currentTranscript = transcript.final;
      this.partialTranscript = '';
      this.options.onTranscriptUpdate?.({
        transcript: { final: this.currentTranscript }
      });
    }

    if (transcript.partial) {
      this.partialTranscript = transcript.partial;
      this.options.onTranscriptUpdate?.({
        transcript: { partial: this.partialTranscript }
      });
    }

    if (!transcript.final && !transcript.partial) {
      logger.warn('[TranscriptionService] Transcript EMPTY after sanitization; dropping.');
    }
  }

  /**
   * Centralized State Mutation.
   * Manages model progress with deterministic cleanup.
   */
  private processModelLoadProgress(progress: number | null): void {
    const percent = progress !== null ? Math.max(0, Math.min(100, Math.round(progress > 0 && progress <= 1 ? progress * 100 : progress))) : null;
    this.options.onModelLoadProgress(percent);
    this.modelLoadingProgress = percent; // Keep internal state in sync
    const state = (useSessionStore as unknown as {
      getState: () => {
        setActiveEngine: (m: unknown) => void;
        setSTTMode: (m: unknown) => void;
        setModelLoadingProgress: (p: unknown) => void;
        setSTTStatus: (status: SttStatus) => void;
        modelLoadingProgress: number | null;
      }
    }).getState?.();
    if (state) {
      state.setModelLoadingProgress(percent);
      if (percent !== null) {
        if (percent >= 100) {
          state.setSTTStatus({
            type: 'initializing',
            message: 'Download complete. Preparing Private model...',
            detail: 'Keep this tab open while the local model finishes initializing.',
            progress: 100
          });
        } else {
          if (!this.privateDownloadAlternativeToastShown && percent > 0) {
            this.privateDownloadAlternativeToastShown = true;
            toast.info('Private / Vault Mode is setting up in this browser. Keep this tab open; your audio stays on your machine.', {
              id: 'private-model-alternative-stt',
              duration: 5000,
            });
          }
          state.setSTTStatus({
            type: 'downloading',
            message: `Downloading private model... ${percent}%`,
            detail: 'Keep this tab open until the local model is cached. Your audio stays on your machine.',
            progress: percent
          });
        }
      }
    }

    // Progress 100 means the bytes are present. It does not mean the model is
    // usable; markPrivateModelReady() owns the user-visible ready transition.
  }

  /**
   * Internal helpers
   */

  public getStrategy(): STTStrategy | null {
    return this.strategy;
  }

  private getProxyOptions(): TranscriptionModeOptions {
    return this.strategyCallbacks;
  }

  /**
   * Whisper Garbage Filter (Optimization)
   * Strips raw tokens like [BLANK_AUDIO] and collapses redundant spaces.
   */
  private sanitizeTranscript(raw: string): string {
    // 🔴 PARETO FIX: Robust Sanitization (Bug #3)
    // Instead of a hardcoded list, we use generic regex to remove bracketed/parenthetical metadata tags.
    return sanitizeTranscriptText(raw);
  }

  private handleStateChange(state: TranscriptionState): void {
    logger.debug(`[TRACE] STATE_TRANSITION ${state}`);
    if (typeof document !== 'undefined') {
      const modelStatus: Record<TranscriptionState, string> = {
        IDLE: 'idle',
        ACTIVATING_MIC: 'loading',
        READY: 'ready',
        ENGINE_INITIALIZING: 'loading',
        RECORDING: 'ready',
        PAUSED: 'ready',
        STOPPING: 'ready',
        CLEANING_UP: 'idle',
        DOWNLOAD_REQUIRED: 'download-required',
        DOWNLOADING: 'loading',
        DOWNLOAD_COMPLETE: 'loading',
        INIT_FAILED: 'init-failed',
        FAILED: 'error',
        TERMINATED: 'idle',
      };
      document.documentElement.setAttribute('data-model-status', modelStatus[state]);
    }

    let status: SttStatus;
    switch (state) {
      case 'IDLE':
      case 'TERMINATED': status = { type: 'idle', message: 'Ready' }; break;
      case 'ACTIVATING_MIC': status = { type: 'initializing', message: 'Mic requested...' }; break;
      case 'READY': status = { type: 'ready', message: 'Mic ready' }; break;
      case 'ENGINE_INITIALIZING': status = { type: 'initializing', message: 'Initializing engine...' }; break;
      case 'RECORDING': {
        let label = 'Recording active';
        if (this.mode === 'native' && this.privateModelReady) {
          label = 'Recording active (Private Ready)';
        }
        status = { type: 'recording', message: label };
        break;
      }
      case 'DOWNLOAD_REQUIRED': status = {
        type: 'download-required',
        message: 'Private model needs a one-time download.',
        detail: 'Download once to use offline transcription in this browser.'
      }; break;
      case 'DOWNLOADING': status = {
        type: 'downloading',
        message: 'Downloading private model...',
        detail: 'Keep this tab open until the model is cached.'
      }; break;
      case 'DOWNLOAD_COMPLETE': status = {
        type: 'initializing',
        message: 'Download complete. Preparing Private model...',
        detail: 'Keep this tab open while the local model finishes initializing.'
      }; break;
      case 'INIT_FAILED': status = {
        type: 'init-failed',
        message: 'Private / Vault Mode could not finish setup.',
        detail: 'Check microphone permission and browser storage, then retry setup. Your audio stays on your machine.'
      }; break;
      case 'FAILED': status = { type: 'error', message: this.lastError?.message || 'Recording could not start. Check microphone permission and try again.' }; break;
      case 'STOPPING':
      case 'CLEANING_UP': status = { type: 'idle', message: 'Stopping...' }; break;
      default: status = { type: 'idle', message: 'Ready' };
    }

    // Propagate status to store and callbacks
    const store = useSessionStore?.getState?.() ?? null;
    if (store) {
      const currentProgress = store.modelLoadingProgress;
      if (currentProgress !== null && state !== 'TERMINATED') {
        status.progress = currentProgress;
      }
    }

    this.options.onStatusChange?.(status);
    if (store) {
      const currentStatus = store.sttStatus;
      // 🛡️ SSOT GUARD: Never overwrite active recording or controller-managed errors with service-level pulses
      const recoveryStatusTypes = new Set<SttStatus['type']>(['download-required', 'downloading', 'ready', 'initializing', 'init-failed']);
      if (currentStatus?.type === 'recording' || currentStatus?.type === 'error') {
        if (status.type !== 'recording' && status.type !== 'error' && !recoveryStatusTypes.has(status.type)) {
          return;
        }
      }
      store.setSTTStatus(status);
    }
  }


  public getStartTime(): number | null { return this.startTime; }
  public getIdempotencyKey(): string | null { return this.idempotencyKey; }
  public getMetadata() {
    const strategyMetadata = (this.strategy as unknown as { getMetadata?: () => { engineVersion: string; modelName: string; deviceType: string } | null })?.getMetadata?.();
    return strategyMetadata || this.metadata;
  }
  public setSessionId(id: string | null) { this.sessionId = id; }
}
