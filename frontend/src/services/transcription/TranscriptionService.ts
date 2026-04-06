import logger from '@/lib/logger';
import { isEqual } from 'lodash-es';
import { MicStream } from './utils/types';
import { STTNegotiator } from './STTNegotiator';
import { createMicStream } from './utils/audioUtils';
// Unused AudioProcessor removed
import { STTStrategy } from './STTStrategy';
import { STTStrategyFactory } from './STTStrategyFactory';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { TranscriptionModeOptions, Transcript, TranscriptionError } from './modes/types';
import {
  TranscriptionPolicy,
  TranscriptionMode,
  PROD_FREE_POLICY,
} from './TranscriptionPolicy';
import { useSessionStore } from '../../stores/useSessionStore';
import { calculateTranscriptStats, TranscriptStats } from '../../utils/fillerWordUtils';
import { ImmutableCallbackProxy } from './utils/ImmutableCallbackProxy';
import { TranscriptionFSM, TranscriptionState } from './TranscriptionFSM';
import { FailureManager } from './FailureManager';
import { STT_CONFIG } from '../../config';
import { SttStatus, TranscriptUpdate, HistorySegment } from '../../types/transcription';

import {
  saveSession,
  heartbeatSession,
  completeSession,
} from '../../lib/storage';

// Removed unused EngineCallbacks and isCacheMiss
import { ENV } from '../../config/TestFlags';


declare global {
  interface Window {
    __TRANSCRIPTION_SERVICE_INTERNAL__?: TranscriptionService;
  }
}

// ✅ EXPERT FIX: Module-level singleton instance to survive React remounts.
let _instance: TranscriptionService | null = null;

/**
 * @deprecated Use SpeechRuntimeController as the sole manager of service instances.
 * This is preserved only for the Controller's internal initialization.
 */
export function getTranscriptionService(options: Partial<TranscriptionServiceOptions> = {}): TranscriptionService {
  if (!_instance || _instance.isServiceDestroyed()) {
    _instance = new TranscriptionService(options);
  } else if (Object.keys(options).length > 0) {
    _instance.updateCallbacks(options);
  }
  return _instance;
}

export const resetTranscriptionService = (): void => {
  _instance = null;
};

// Types moved to src/types/transcription.ts

export interface TranscriptionServiceOptions {
  onTranscriptUpdate: (update: TranscriptUpdate) => void;
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
}

/**
 * ARCHITECTURE:
 * TranscriptionService serves as a Facade (GoF Pattern).
 * It orchestrates between FSM (State), Factory (Creation), and FailureManager (Resilience).
 * 
 * Goal: Low cognitive load, high testability, single responsibility.
 */
export default class TranscriptionService {
  public fsm: TranscriptionFSM;
  private failureManager: FailureManager;
  private strategy: STTStrategy | null = null;
  private mic: MicStream | null = null;
  private micError: Error | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private isFrozen: boolean = false;

  private callbackProxy: ImmutableCallbackProxy<TranscriptionModeOptions>;
  private policy: TranscriptionPolicy;
  private options: TranscriptionServiceOptions;

  private startTimestamp: number = 0;
  private startTime: number | null = null;
  private idempotencyKey: string | null = null;
  private sessionId: string | null = null;

  private metadata: { engineVersion: string; modelName: string; deviceType: string } | null = null;

  private transcriptHistory: HistorySegment[] = [];

  private mode: TranscriptionMode | null = null;
  private serviceId: string; // Unique ID for this service instance
  private runId: string | null = null; // Unique ID for each logical start run
  private lastError: Error | null = null;
  private destroyPromise: Promise<void> | null = null;
  private readonly MIN_RECORDING_DURATION_MS = 100;
  private downloadController: AbortController | null = null;
  private modelLoadingProgress: number | null = 0;
  private privateModelReady: boolean = false;

  public getFailureManager(): FailureManager {
    return this.failureManager;
  }

  // Handlers populated via injection
  private dbHandlers?: {
    initDbSession: (mode: string, idempotencyKey: string, metadata: unknown) => Promise<string | null>;
    heartbeatSession: (sessionId: string) => Promise<void>;
    completeSession: (sessionId: string, transcript: string, duration: number) => Promise<void>;
  };

  constructor(options: Partial<TranscriptionServiceOptions> = {}) {
    this.serviceId = Math.random().toString(36).substring(7);
    this.fsm = new TranscriptionFSM();
    this.failureManager = new FailureManager();
    this.policy = options.policy || PROD_FREE_POLICY;

    // ✅ E2E HOOK: Exposed Registry logic removed (Banned Patterns)

    // Default options to avoid undefined crashes
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

    this.fsm.subscribe(state => this.handleStateChange(state));

    logger.debug({ sId: this.serviceId }, '[TranscriptionService] Service initialized');

    // Initialize Proxy for stable callback references in modes
    this.callbackProxy = new ImmutableCallbackProxy(this.getProxyOptions());

    // ✅ DB Persistence Wiring
    this.dbHandlers = {
      initDbSession: async (mode, idempotencyKey, metadata) => {
        const isTestOrProd = this.options.policy?.executionIntent === 'prod' || this.options.policy?.executionIntent === 'test';
        if (!isTestOrProd) return null;
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
   * Cold Boot Accelerator: Pre-initializes the strategy without starting the mic.
   */
  public async warmUp(mode: TranscriptionMode): Promise<void> {
    logger.info(`[TranscriptionService] ⚡ Warming up strategy for mode: ${mode}`);
    try {
      await this.initializeStrategy(mode);
    } catch (error) {
      logger.warn({ mode, error }, '[TranscriptionService] Warm-up skipped or deferred');
    }
  }

  /**
   * Mode-Neutral Strategy Initialization.
   * Probes availability, handles BLOCKED states, and prepares strategy.
   */
  private async initializeStrategy(mode: TranscriptionMode): Promise<void> {
    /**
     * Engine Mode Validation Invariant.
     * Prevents unplanned mode switches after a strategy has been explicitly requested.
     * A mode can ONLY be switched to if it is the explicitly requested user mode
     * (from policy.preferredMode) or if preferredMode is completely unset.
     */
    if (this.policy.preferredMode && mode !== this.policy.preferredMode) {
      throw new Error(`[Invariant Violation] Implicit mode switch detected: negotiated mode '${mode}' does not match explicit user preference '${this.policy.preferredMode}'`);
    }

    // 1. Session Isolation: Mode change always triggers clean strategy termination
    if (this.mode !== mode && this.strategy) {
      logger.info({ from: this.mode, to: mode }, '[TranscriptionService] Mode switch detected. Purging current strategy.');
      await this.strategy.terminate();
      this.strategy = null;
    }

    this.idempotencyKey = Math.random().toString(STT_CONFIG.ALPHANUMERIC_RADIX).substring(7);
    this.mode = mode;

    // 2. Instantiate Strategy if needed
    if (!this.strategy) {
      this.strategy = STTStrategyFactory.create(mode, this.getProxyOptions(), this.policy);
    }

    // 3. Probe Availability (The 🛡️ Guard)
    const availability = await this.strategy.checkAvailability();
    
    if (!availability.isAvailable) {
      logger.warn({ mode, reason: availability.reason }, '[TranscriptionService] Strategy BLOCKED');
      
      // Update FSM state based on reason
      if (availability.reason === 'CACHE_MISS') {
        this.fsm.transition({ type: 'DOWNLOAD_REQUIRED' });
      } else {
        this.fsm.transition({ 
          type: 'ERROR_OCCURRED', 
          error: new TranscriptionError(
            availability.message || 'Strategy unavailable', 
            availability.reason || 'UNKNOWN', 
            true
          ) 
        });
      }
      
      // Update status for UI
      this.options.onStatusChange?.({
        type: availability.reason === 'CACHE_MISS' ? 'download-required' : 'error',
        message: availability.message || 'Strategy blocked',
        progress: availability.reason === 'CACHE_MISS' ? 0 : undefined
      });

      throw new Error(`Strategy BLOCKED: ${availability.reason}`);
    }

    // 4. Prepare Strategy (PREPARING state)
    this.fsm.transition({ type: 'ENGINE_INIT_REQUESTED' });
    
    try {
      // Guard: concurrent destroy() may null strategy at any await boundary
      if (!this.strategy) return;
      await this.strategy.prepare();

      // Strategy-specific init (legacy adapter)
      // Guard: concurrent destroy() may have nulled strategy during prepare()
      if (this.strategy && 'init' in this.strategy) {
        await (this.strategy as unknown as { init: (opts: TranscriptionModeOptions) => Promise<void> }).init(this.getProxyOptions());
      }

      // Guard: strategy may be nulled after init()
      if (!this.strategy) return;

      // ✅ INTEGRITY FIX: Atomic DB Session Persistence
      // Record the engine transition in the DB BEFORE moving to ENGINE_STARTED.
      if (this.dbHandlers) {
        logger.info({ mode, runId: this.runId }, '[TranscriptionService] Registering engine transition in DB...');
        const metadata = {
          engineType: this.strategy.getEngineType(),
          policy: this.policy.executionIntent,
          device: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
        };
        
        try {
          const sid = await this.dbHandlers.initDbSession(mode, this.idempotencyKey || 'no-key', metadata);
          if (sid) {
            this.sessionId = sid;
            const state = (useSessionStore as unknown as { getState: () => { setSessionId: (id: string) => void } }).getState?.();
            if (state) state.setSessionId(sid);
          }
        } catch (dbError) {
          logger.warn({ err: dbError }, '[TranscriptionService] DB session initialization failed (Non-blocking)');
        }
      }

      if (!this.strategy) return;
      this.fsm.transition({ type: 'ENGINE_STARTED' });
    } catch (error) {
      logger.error({ mode, error }, '[TranscriptionService] Strategy preparation failed');
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      throw error;
    }
  }

  private isStrategyCompatible(mode: TranscriptionMode): boolean {
    if (!this.strategy) return false;
    const existingType = this.strategy.getEngineType();
    const isPrivate = mode === 'private';

    if (isPrivate) {
      return existingType === 'transformers-js' || existingType === 'whisper-turbo';
    }
    return existingType === mode;
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
    const requestedMode = this.policy.preferredMode || 'native';
    const { mode } = STTNegotiator.negotiate(this.policy, requestedMode);

    await this.initializeStrategy(mode);

    if (this.options.mockMic) {
      this.mic = this.options.mockMic;
      this.fsm.transition({ type: 'MIC_ACQUIRED' });
      return { success: true };
    }

    try {
      this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
      this.micError = null;
      this.fsm.transition({ type: 'MIC_ACQUIRED' });
      return { success: true };
    } catch (error) {
      const e = error instanceof Error ? error : new Error(String(error));
      logger.error({ err: e }, '[TranscriptionService] Microphone initialization failed');
      this.micError = e;
      this.lastError = e;
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: e });
      this.options.onError?.(e);
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

    // 3. Reset state for Fresh Start
    this.fsm.transition({ type: 'RESET_REQUESTED' });
    this.destroyPromise = null;

    // 4. Force Native Mode
    this.updatePolicy({
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
  public async startTranscription(runtimePolicy?: TranscriptionPolicy): Promise<void> {
    if (runtimePolicy) this.updatePolicy(runtimePolicy);

    if (this.fsm.is('CLEANING_UP')) {
      logger.warn('[TranscriptionService] startTranscription rejected - still cleaning up');
      return;
    }

    // 1. Session Isolation: Clear existing session if active
    if (this.fsm.is('RECORDING') || this.fsm.is('ENGINE_INITIALIZING') || this.fsm.is('PAUSED')) {
      logger.info('[TranscriptionService] Interrupting active session for new request');
      await this.destroy();
    }

    // 2. Auto-init mic if needed
    if (this.fsm.is('IDLE') || this.fsm.is('FAILED') || this.fsm.is('TERMINATED')) {
      const ok = await this.init();
      if (!ok.success) return;
    }

    const mode = this.policy.preferredMode || 'private';
    this.runId = Math.random().toString(36).substring(7);
    this.idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

    try {
      // 3. Initialize Strategy (Handles Availability & Preparation)
      await this.initializeStrategy(mode);

      // 4. Start Strategy Execution
      await this.executeStrategy(mode);
    } catch (error) {
      logger.error({ mode, error }, '[TranscriptionService] startTranscription failed');
      // FSM and UI status already updated in initializeStrategy/executeStrategy
    }
  }

  private async executeStrategy(mode: TranscriptionMode): Promise<void> {
    if (!this.strategy) return;

    if (!this.fsm.is('ENGINE_INITIALIZING') && !this.fsm.is('READY') && !this.fsm.is('RECORDING')) {
      logger.warn({ state: this.fsm.getState() }, '[TranscriptionService] executeStrategy aborted due to invalid state');
      return;
    }

    try {
      await this.strategy.start(this.mic!);
      this.startTime = Date.now();
      this.options.onModeChange?.(mode);
      this.startWatchdog();

      const state = (useSessionStore as unknown as { getState: () => { setActiveEngine: (mode: string) => void } }).getState?.();
      if (state) state.setActiveEngine(mode);

      this.fsm.transition({ type: 'ENGINE_STARTED' });
    } catch (error) {
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      throw error;
    }
  }

  /**
   * Stop transcription and calculate stats.
   */
  public async stopTranscription(): Promise<{ success: boolean; transcript: string; stats: TranscriptStats } | null> {
    if (!this.fsm.is('RECORDING') && !this.fsm.is('PAUSED') && !this.fsm.is('ENGINE_INITIALIZING')) return null;

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
        transcript = await this.strategy.getTranscript();
      }

      const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
      const stats = calculateTranscriptStats([{ transcript }], [], '', duration);

      this.fsm.transition({ type: 'STOP_COMPLETED' });
      const state = (useSessionStore as unknown as { getState: () => { setActiveEngine: (m: string | null) => void; setModelLoadingProgress: (p: number | null) => void } }).getState?.();
      if (state) {
        state.setActiveEngine(null);
        state.setModelLoadingProgress(null);
      }

      return { success: true, transcript, stats };
    } catch (error) {
      logger.error({ mode: this.mode, error }, '[TranscriptionService] stopTranscription failed');
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: error as Error });
      this.options.onError?.(error as Error);
      return { success: false, transcript: '', stats: { transcript: '', total_words: 0, accuracy: 0, duration: 0 } };
    } finally {
      this.startTime = null;
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
    logger.info({ sId: this.serviceId, state: this.fsm.getState() }, '[TranscriptionService] destroy() invoked');

    if (this.destroyPromise) return this.destroyPromise;

    this.destroyPromise = (async () => {
      if (this.fsm.is('TERMINATED')) return;

      this.fsm.transition({ type: 'TERMINATE_REQUESTED' });
      this.stopWatchdog();

      if (this.mic) {
        this.mic.stop();
        this.mic = null;
      }

      if (this.strategy) {
        try {
          logger.debug('[TranscriptionService] Calling strategy.terminate()');
          await this.strategy.terminate();
          logger.debug('[TranscriptionService] strategy.terminate() completed');
        } catch (error) {
          logger.error({ mode: this.mode, error }, '[TranscriptionService] Strategy termination failed');
        }
        this.strategy = null;
      } else {
        logger.debug('[TranscriptionService] this.strategy is null, skipped terminate');
      }

      this.runId = null;
      this.fsm.transition({ type: 'TERMINATE_COMPLETED' });
      logger.info({ sId: this.serviceId }, '[TranscriptionService] ✅ Cleanup complete');
    })();

    return this.destroyPromise;
  }

  public isServiceDestroyed(): boolean {
    return this.fsm.is('TERMINATED') || (this.fsm.is('IDLE') && !this.mic && !this.strategy);
  }

  /**
   * EXTERNAL REHYDRATION: Fixes React Stale Closures.
   */
  public updateCallbacks(newOptions: Partial<TranscriptionServiceOptions>): void {
    this.options = { ...this.options, ...newOptions };
    this.callbackProxy.update(this.getProxyOptions());
  }

  /**
   * Updates the transcription policy dynamically (e.g., after subscription upgrade).
   * 
   * @param newPolicy - The new policy to apply
   */
  public updatePolicy(newPolicy: TranscriptionPolicy): void {
    if (isEqual(this.policy, newPolicy)) return;

    const oldPolicy = this.policy;
    this.policy = newPolicy;
    this.options.policy = newPolicy;

    // ✅ EXPERT FIX: Dispatch to FSM to ensure valid state transitions/re-eval
    this.fsm.transition({ type: 'POLICY_UPDATED', policy: newPolicy });

    logger.info({
      policy: newPolicy,
      from: oldPolicy.executionIntent,
      to: newPolicy.executionIntent
    }, '[TranscriptionService] 🔄 Policy updated');
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
    if (this.strategy) {
      return this.strategy.getTranscript();
    }
    return '';
  }

  /**
   * ✅ EXPERT FIX: Hard reset for test isolation.
   * Clears all ephemeral state but preserves WASM engine warm-up.
   */
  public resetEphemeralState(): void {
    logger.info('[TranscriptionService] 🧪 Resetting ephemeral state for isolation');

    this.policy = PROD_FREE_POLICY;
    this.mode = null;
    this.lastError = null;
    this.failureManager.resetFailureCount();

    // Clear Session State
    this.sessionId = null;
    this.idempotencyKey = null;
    this.startTime = null;
    this.startTimestamp = 0;
    this.runId = null;
    this.transcriptHistory = [];

    // Reset FSM to IDLE
    this.fsm.reset();


    this.modelLoadingProgress = null;

    // Clear strategy reference
    if (this.strategy) {
      void this.strategy.terminate();
      this.strategy = null;
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
    return this.strategy ? this.strategy.getLastHeartbeatTimestamp() : Date.now();
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

    const timeout = ENV.isE2E
      ? STT_CONFIG.HEARTBEAT_TIMEOUT_MS
      : STT_CONFIG.HEARTBEAT_TIMEOUT_MS;

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
    }, ENV.isE2E ? 50 : 2000);
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
  private processTranscript(update: { transcript: Transcript }): void {
    const transcript = update.transcript;
    if (transcript.final) {
      transcript.final = this.sanitizeTranscript(transcript.final);
    }
    if (transcript.partial) {
      transcript.partial = this.sanitizeTranscript(transcript.partial);
    }

    // Only forward if there's actually something left after sanitization
    if (transcript.final || transcript.partial) {
      this.options.onTranscriptUpdate(update);
    }
  }

  /**
   * Centralized State Mutation.
   * Manages model progress with deterministic cleanup.
   */
  private processModelLoadProgress(progress: number | null): void {
    this.options.onModelLoadProgress(progress);
    const percent = progress !== null ? Math.round(progress * 100) : null;
    this.modelLoadingProgress = percent; // Keep internal state in sync
    const state = (useSessionStore as unknown as {
      getState: () => {
        setActiveEngine: (m: unknown) => void;
        setSTTMode: (m: unknown) => void;
        setModelLoadingProgress: (p: unknown) => void;
        modelLoadingProgress: number | null;
      }
    }).getState?.();
    if (state) {
      state.setModelLoadingProgress(percent);
    }

    if (percent === 100) {
      if (ENV.isE2E) {
        if (state) state.setModelLoadingProgress(null);
      } else {
        setTimeout(() => {
          const currentState = (useSessionStore as unknown as { getState: () => { modelLoadingProgress: number | null, setModelLoadingProgress: (p: number | null) => void } }).getState?.();
          if (currentState && currentState.modelLoadingProgress === 100) {
            currentState.setModelLoadingProgress(null);
          }
        }, 1500);
      }
    }
  }

  /**
   * Internal helpers
   */

  public getStrategy(): STTStrategy | null {
    return this.strategy;
  }

  private getProxyOptions(): TranscriptionModeOptions {
    const runId = this.runId || 'no-run';
    logger.debug({ runId }, '[TranscriptionService] Generating proxy options');

    return {
      ...this.options,
      instanceId: runId, // Keep for backward compat with engine interface but use runId
      onModelLoadProgress: (p: number | null) => this.processModelLoadProgress(p),
      onTranscriptUpdate: (u: { transcript: Transcript }) => this.processTranscript(u),
      onReady: () => {
        logger.info('[STT] Strategy ready.');
        this.options.onReady?.();
      },
      onError: (err: Error) => {
        logger.error({ sId: this.serviceId, rId: runId, error: err }, '[TranscriptionService] Proxy: Error triggered');
        this.lastError = err;
        this.fsm.transition({ type: 'ERROR_OCCURRED', error: err });
        this.options.onError?.(err);
      }
    };
  }

  /**
   * Whisper Garbage Filter (Optimization)
   * Strips raw tokens like [BLANK_AUDIO] and collapses redundant spaces.
   */
  private sanitizeTranscript(raw: string): string {
    // 🔴 PARETO FIX: Robust Sanitization (Bug #3)
    // Instead of a hardcoded list, we use generic regex to remove bracketed/parenthetical metadata tags.
    const clean = raw
      .replace(/\[[A-Z_\s]+\]/gi, '') // Matches [MUSIC], [BLANK_AUDIO], [SILENCE], etc.
      .replace(/\([a-z\s]+\)/gi, '')  // Matches (applause), (laughter), etc.
      .replace(/\s{2,}/g, ' ')       // Normalize spaces
      .trim();

    return clean;
  }

  private handleStateChange(state: TranscriptionState): void {
    let status: SttStatus;
    switch (state) {
      case 'IDLE':
      case 'TERMINATED': status = { type: 'idle', message: 'Ready' }; break;
      case 'ACTIVATING_MIC': status = { type: 'initializing', message: 'Mic requested...' }; break;
      case 'READY': status = { type: 'idle', message: 'Mic ready' }; break;
      case 'ENGINE_INITIALIZING': status = { type: 'initializing', message: 'Initializing engine...' }; break;
      case 'RECORDING': {
        let label = 'Recording active';
        if (this.mode === 'native' && this.privateModelReady) {
          label = 'Recording active (Private Ready)';
        }
        status = { type: 'recording', message: label };
        break;
      }
      case 'DOWNLOAD_REQUIRED': status = { type: 'download-required', message: 'Private model unavailable at first-use. Click button for one-time download.' }; break;
      case 'FAILED': status = { type: 'error', message: this.lastError?.message || 'Error occurred' }; break;
      default: status = { type: 'idle', message: 'Ready' };
    }

    // PERSISTENCE FIX: Ensure background download progress isn't clobbered by state changes
    const store = typeof useSessionStore !== 'undefined' ? useSessionStore?.getState?.() : null;
    if (store) {
      const currentProgress = store.modelLoadingProgress;
      if (currentProgress !== null && state !== 'TERMINATED') {
        status.progress = currentProgress;
      }
    }

    this.options.onStatusChange?.(status);
    if (store) {
      store.setSTTStatus(status);
    }
  }


  public getStartTime(): number | null { return this.startTime; }
  public getIdempotencyKey(): string | null { return this.idempotencyKey; }
  public getMetadata() { return this.metadata; }

  // Expose these for tests/runtime controller if needed
  public setSessionId(id: string | null) { this.sessionId = id; }

}

