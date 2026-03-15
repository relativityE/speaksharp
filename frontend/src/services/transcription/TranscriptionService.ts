import logger from '@/lib/logger';
import { isEqual } from 'lodash-es';
import { createMicStream } from './utils/audioUtils';
import { EngineFactory } from './EngineFactory';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { ITranscriptionEngine, TranscriptionModeOptions, Transcript } from './modes/types';
import { MicStream } from './utils/types';
import { calculateTranscriptStats, TranscriptStats } from '../../utils/fillerWordUtils';
import { ImmutableCallbackProxy } from './utils/ImmutableCallbackProxy';
import {
  TranscriptionPolicy,
  TranscriptionMode,
  resolveMode,
  PROD_FREE_POLICY,
} from './TranscriptionPolicy';
import { useSessionStore } from '../../stores/useSessionStore';
import { TranscriptionFSM, TranscriptionState } from './TranscriptionFSM';
import { FailureManager } from './FailureManager';
import { STT_CONFIG } from '../../config';
import { SttStatus, TranscriptUpdate } from '../../types/transcription';
import { PracticeSession } from '../../types/session';
import { UserProfile } from '../../types/user';
import {
  isCacheMiss
} from './errors';
import { TestFlags } from '../../config/TestFlags';
import { IS_TEST_ENVIRONMENT } from '../../config/env';
import { getE2EConfig } from '../../../../tests/types/e2eConfig';

declare global {
  interface Window {
    __TRANSCRIPTION_SERVICE__?: TranscriptionService;
  }
}

// ✅ EXPERT FIX: Module-level singleton instance to survive React remounts.
let _instance: TranscriptionService | null = null;

export function getTranscriptionService(options: Partial<TranscriptionServiceOptions> = {}): TranscriptionService {
  if (!_instance) {
    _instance = new TranscriptionService(options);
  } else if (Object.keys(options).length > 0) {
    // If instance exists, update callbacks to handle React state changes (stale closures)
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
 * ARCHITECTURE (Senior Architect):
 * TranscriptionService serves as a Facade (GoF Pattern).
 * It orchestrates between FSM (State), Factory (Creation), and FailureManager (Resilience).
 * 
 * Goal: Low cognitive load, high testability, single responsibility.
 */
export default class TranscriptionService {
  public fsm: TranscriptionFSM;
  private failureManager: FailureManager;
  protected engine: ITranscriptionEngine | null = null;
  private mic: MicStream | null = null;
  private micError: Error | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  private timerFired: boolean = false;

  private callbackProxy: ImmutableCallbackProxy<TranscriptionModeOptions>;
  private policy: TranscriptionPolicy;
  private options: TranscriptionServiceOptions;

  private startTimestamp: number = 0;
  private startTime: number | null = null;
  private idempotencyKey: string | null = null;
  private sessionId: string | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private metadata: { engineVersion: string; modelName: string; deviceType: string } | null = null;

  private mode: TranscriptionMode | null = null;
  private serviceId: string; // ✅ SYSTEMATIC: Unique ID for this service instance
  private runId: string | null = null; // ✅ SYSTEMATIC: Unique ID for each logical start run
  private lastEngineId: string | null = null; // ✅ SYSTEMATIC: Track engine instance transitions
  private lastError: Error | null = null;
  private readonly MIN_RECORDING_DURATION_MS = 100;
  private readonly HEARTBEAT_PERIOD_MS = 30000; // 30 seconds
  private downloadController: AbortController | null = null;
  private modelLoadingProgress: number | null = 0;
  private initPromise: Promise<void> | null = null;
  private privateModelReady: boolean = false;

  // Handlers populated via injection
  private dbHandlers?: {
     initDbSession: (mode: string, idempotencyKey: string, metadata: unknown) => Promise<string | null>;
     heartbeatSession: (sessionId: string) => Promise<void>;
     completeSession: (sessionId: string, transcript: string, duration: number) => Promise<void>;
  };

  constructor(options: Partial<TranscriptionServiceOptions> = {}) {
    this.serviceId = Math.random().toString(36).substring(7);
    this.fsm = new TranscriptionFSM();
    this.failureManager = FailureManager.getInstance();
    this.policy = options.policy || PROD_FREE_POLICY;

    // ✅ E2E HOOK: Expose instance for behavioral inspection and isolation resets
    if (typeof window !== 'undefined') {
      window.__TRANSCRIPTION_SERVICE__ = this;
    }

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
    };

    this.fsm.subscribe(state => this.handleStateChange(state));

    logger.debug({ sId: this.serviceId }, '[TranscriptionService] Service initialized');

    // Initialize Proxy for stable callback references in modes
    this.callbackProxy = new ImmutableCallbackProxy(this.getProxyOptions());
  }

  public setDbHandlers(handlers: TranscriptionService['dbHandlers']): void {
      this.dbHandlers = handlers;
  }

  /**
   * Cold Boot Accelerator: Pre-initializes the engine without starting the mic.
   * Crucial for WASM/transformers.js where model loading takes significant time.
   */
  public async warmUp(mode: TranscriptionMode): Promise<void> {
    if (mode !== 'private') return; // Only private needs heavy warm-up
    logger.info(`[TranscriptionService] ⚡ Warming up engine for mode: ${mode}`);
    await this.ensureEngineInitialized(mode);
  }

  /**
   * Authoritative Single-Chain Initialization.
   * Ensures one init, many awaiters, and zero-leakage.
   */
  private async ensureEngineInitialized(mode: TranscriptionMode): Promise<void> {
    // Synchronization: Scope initPromise to the mode. 
    // Prevents fallback to 'native' from hanging on a 'private' init that is stuck.
    if (this.initPromise && this.mode === mode) return this.initPromise;

    this.initPromise = (async () => {
      try {
        // 1. Check if existing engine is compatible
        const isCompatible = this.isEngineCompatible(mode);
        const engineId = this.engine?.instanceId || 'none';
        
        if (!isCompatible) {
          logger.info({ sId: this.serviceId, rId: this.runId, eId: engineId, mode }, '[TranscriptionService] Engine incompatible, forcing new creation');
          if (this.engine) {
            logger.info('[TranscriptionService] Destroying incompatible engine instance');
            await this.engine.terminate?.();
          }
          await this.createEngine(mode);
        } else {
          logger.info({ sId: this.serviceId, rId: this.runId, eId: engineId }, '[TranscriptionService] Reusing compatible existing engine');
          // Update callbacks of existing engine to handle potential stale closures
          const engineWithUpdate = this.engine as unknown as { updateOptions?: (options: unknown) => void };
          if (typeof engineWithUpdate.updateOptions === 'function') {
            engineWithUpdate.updateOptions(this.getProxyOptions());
          }
        }

        this.lastEngineId = this.engine?.instanceId || 'none';

        // 2. Trigger init (this sets the data-stt-engine="ready" signal)
        logger.debug({ sId: this.serviceId, rId: this.runId, eId: this.lastEngineId }, '[TranscriptionService] Calling engine.init()');
        await this.engine!.init();
        logger.info({ sId: this.serviceId, rId: this.runId, eId: this.lastEngineId }, '[TranscriptionService] Engine initialization complete');
      } catch (error) {
        logger.error({ sId: this.serviceId, rId: this.runId, eId: this.lastEngineId, error }, '[TranscriptionService] ensureEngineInitialized failed');
        if (isCacheMiss(error as Error)) {
          logger.info('[TranscriptionService] Init: Cache miss (Expected for first-time use)');
        } else {
          logger.error({ error }, '[TranscriptionService] Engine initialization failed');
        }
        this.initPromise = null; // Reset on failure to prevent stale error reuse
        throw error; // Propagate to caller
      }
    })();

    // ✅ SURGICAL FIX (3.6a): Replace .finally() with explicit .then()/.catch()
    // This defuses the "Cleanup Bomb" by making it abort-aware.
    this.initPromise
      .then(() => {
        // SUCCESS: Download/Init actually completed
        if (mode === 'private') {
          this.privateModelReady = true;
          this.handleStateChange(this.fsm.getState());
        }
        this.cleanupInitResources();
        // Clear fallback timer explicitly on success to prevent race condition
        if (this.fallbackTimer) {
          clearTimeout(this.fallbackTimer);
          this.fallbackTimer = null;
        }
        logger.info({ mode }, '[TranscriptionService] Engine init completed cleanly');
      })
      .catch((error: Error) => {
        // FAILURE: Distinguish abort from genuine error
        const isAbort = error.message?.includes('Optimistic entry timeout') || 
                        error.message?.includes('AbortError') || 
                        isCacheMiss(error);
        

        if (isAbort) {
          // Do NOT clean up - the download continues in the background
          logger.info({ mode, message: error.message }, '[TranscriptionService] Init aborted/back-channel — preserving indicators');
          return;
        }
        
        // Genuine failure - clean up
        this.cleanupInitResources();
        logger.error({ mode, error }, '[TranscriptionService] Engine init genuinely failed');
      });

    return this.initPromise;
  }

  private isEngineCompatible(mode: TranscriptionMode): boolean {
    if (!this.engine) return false;
    const existingType = this.engine.getEngineType();
    const isPrivate = mode === 'private';
    
    if (isPrivate) {
      return existingType === 'transformers-js' || existingType === 'whisper-turbo';
    }
    return existingType === mode;
  }

  private async createEngine(mode: TranscriptionMode): Promise<void> {
    const proxyOptions = this.getProxyOptions();
    this.engine = await EngineFactory.create(mode, proxyOptions, this.policy);
  }

  private cleanupInitResources(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    
    // ✅ SURGICAL FIX (3.6b): Defense-in-depth guard.
    // Never clear the indicator if a background download is actively in progress.
    const store = useSessionStore.getState();
    const currentProgress = store.modelLoadingProgress;
    const isActivelyDownloading = currentProgress !== null && currentProgress < 100;

    if (isActivelyDownloading) {
      logger.info({ progress: currentProgress }, '[TranscriptionService] cleanupInitResources: preserving indicator (background download active)');
      return;
    }

    // Normal cleanup - progress is null or 100%, safe to clear
    store.setModelLoadingProgress(null);
  }

  /**
   * Primary Entry Point: Pre-warms the microphone stream.
   */
  public async init(): Promise<{ success: boolean }> {
    if (this.fsm.is('READY') || this.fsm.is('RECORDING') || this.fsm.is('ENGINE_INITIALIZING')) {
      return { success: true };
    }

    if (!this.fsm.is('IDLE') && !this.fsm.is('FAILED')) {
      logger.debug({ state: this.fsm.getState() }, '[TranscriptionService] init() called in unexpected state');
    }

    this.fsm.transition({ type: 'START_REQUESTED' });

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
   * Resolves mode, creates engine, and starts transcription.
   */
  public async startTranscription(runtimePolicy?: TranscriptionPolicy): Promise<void> {
    if (runtimePolicy) this.updatePolicy(runtimePolicy);

    // ✅ ROBUSTNESS: Handle initialization/cleanup races
    if (this.fsm.is('CLEANING_UP')) {
      logger.warn('[TranscriptionService] startTranscription rejected - still cleaning up');
      return;
    }

    if (this.fsm.is('RECORDING') || this.fsm.is('ENGINE_INITIALIZING') || this.fsm.is('PAUSED')) {
      logger.info('[TranscriptionService] Interrupting active session for new request');
      await this.destroy();
    }

    // Auto-init if needed
    if (this.fsm.is('IDLE') || this.fsm.is('FAILED')) {
      const ok = await this.init();
      if (!ok.success) return;
    }

    this.fsm.transition({ type: 'ENGINE_INIT_REQUESTED' });
    this.runId = Math.random().toString(36).substring(7);
    logger.info({ sId: this.serviceId, rId: this.runId }, '[TranscriptionService] startTranscription requested');

    let mode = resolveMode(this.policy);

    // Circuit Breaker: Fallback if too many failures
    if (mode === 'private' && this.failureManager.getEffectiveFailureCount() >= STT_CONFIG.MAX_PRIVATE_ATTEMPTS) {
      logger.warn({
        failures: this.failureManager.getEffectiveFailureCount(),
        max: STT_CONFIG.MAX_PRIVATE_ATTEMPTS
      }, '[TranscriptionService] Max Private attempts reached. Forcing Native Fallback.');

      this.options.onStatusChange?.({
        type: 'fallback',
        message: 'Using Native STT (too many private failures)',
        newMode: 'native'
      });
      mode = 'native';
    }

    // ✅ PHASE 2 IDEMPOTENCY: Generate key BEFORE any network calls
    this.idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);
    this.sessionId = null;
    this.metadata = {
      engineVersion: '1.0.0', // TODO: Source from STT_CONFIG
      modelName: mode === 'private' ? 'whisper-base-en' : 'default',
      deviceType: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'
    };

    this.mode = mode;
    this.startTimestamp = Date.now();
    useSessionStore.getState().setSTTMode(mode);

    try {
      if (mode !== 'native' && !this.mic) throw new Error('Microphone not initialized');

      logger.info(`[TranscriptionService] Preparing engine for mode: ${mode}`);

      if (mode === 'private') {
        const e2eConfig = getE2EConfig();
        const isE2E = e2eConfig.context === 'e2e' || e2eConfig.isE2E;
        const explicitTimeout = e2eConfig.stt.loadTimeout;

        if (isE2E && explicitTimeout === undefined) {
          logger.info('[TranscriptionService] 🧪 E2E Mode detected: Waiting for full engine init.');
          await this.ensureEngineInitialized(mode);
        } else {
          // Normal mode OR explicit E2E timeout override: Start the optimistic timeout race
          const initPromise = this.ensureEngineInitialized(mode);
          this.timerFired = false;
          this.startOptimisticEntryTimer();

          try {
            const timeoutPromise = new Promise((_, reject) => {
              const checkTimer = setInterval(() => {
                const e2eConfig = getE2EConfig();
                const isE2E = e2eConfig.context === 'e2e' || e2eConfig.isE2E;
                const hasExplicitTimeout = e2eConfig.stt.loadTimeout !== undefined;

                // Allow timer to fire in E2E ONLY if an explicit timeout is set.
                // Otherwise, wait for the full Playwright timeout.
                if (this.timerFired && (!isE2E || hasExplicitTimeout)) {
                  clearInterval(checkTimer);
                  reject(new Error('Optimistic entry timeout'));
                }
              }, 50);

              // Ensure we cancel the fallback timer immediately upon init resolving
              initPromise.then(() => {
                clearInterval(checkTimer);
                if (this.fallbackTimer) {
                  clearTimeout(this.fallbackTimer);
                  this.fallbackTimer = null;
                }
              }).catch(() => {
                clearInterval(checkTimer);
                if (this.fallbackTimer) {
                   clearTimeout(this.fallbackTimer);
                   this.fallbackTimer = null;
                }
              });
            });

            logger.debug({ mode }, '[TranscriptionService] Starting Promise.race');
            await Promise.race([initPromise, timeoutPromise]);
            logger.debug({ mode }, '[TranscriptionService] Promise.race RESOLVED');
          } finally {
            if (this.fallbackTimer) {
              clearTimeout(this.fallbackTimer);
              this.fallbackTimer = null;
            }
          }
        }
      } else {
        await this.ensureEngineInitialized(mode);
      }

      await this.executeEngine(mode);
    } catch (error: unknown) {
      // ✅ EXPECTED EVENT: Cache miss - start background download
      if (isCacheMiss(error as Error)) {
        logger.info('[TranscriptionService] Cache miss - triggering download');

        // Handle cache miss ONLY here - never pass to onError
        await this.handleCacheMiss();
        return; // ← Exit cleanly, no error propagation
      }

      // If we reach here, it's an unexpected error or a timeout that wasn't handled by cache miss
      await this.handleFailure(mode, error as Error);
    }
  }

  /**
   * Internal engine lifecycle execution.
   */
  private async executeEngine(mode: TranscriptionMode): Promise<void> {
    if (!this.engine) return;

    // ✅ INVARIANT GUARD: If initialization failed and handleFailure already transitioned us
    // the FSM will not be in ENGINE_INITIALIZING. Stop here.
    logger.debug({ mode, state: this.fsm.getState() }, '[TranscriptionService] executeEngine entry');
    if (!this.fsm.is('ENGINE_INITIALIZING')) {
      logger.warn({ mode, state: this.fsm.getState() }, '[TranscriptionService] executeEngine aborted due to invalid state');
      return;
    }
    try {
      await this.engine.startTranscription(this.mic!);

      this.startTime = Date.now();
      this.options.onModeChange?.(mode);
      useSessionStore.getState().setActiveEngine(mode);

      // PHASE 2 SESSION START: Atomic RPC to create session and check usage via injected logic
      if (this.dbHandlers && this.idempotencyKey) {
          const newSessionId = await this.dbHandlers.initDbSession(mode, this.idempotencyKey, this.metadata);

          // Guard: Only start heartbeat if we haven't stopped in the meantime
          if (newSessionId && (this.fsm.is('RECORDING') || this.fsm.is('ENGINE_INITIALIZING'))) {
              this.sessionId = newSessionId;
              this.startHeartbeat();
          } else {
              logger.warn({ hasSession: !!newSessionId, state: this.fsm.getState() }, '[TranscriptionService] Session created but guard blocked assignment');
          }
      }

      // FSM Transition Guarding: Ensure we are still in INITIALIZING before moving to RECORDING.
      if (!this.fsm.is('ENGINE_INITIALIZING')) {
        logger.warn({ sId: this.serviceId, rId: this.runId, state: this.fsm.getState() }, '[TranscriptionService] ENGINE_STARTED rejected due to invalid state');
        return;
      }

      this.fsm.transition({ type: 'ENGINE_STARTED' });
    } catch (error: unknown) {
      if (isCacheMiss(error as Error)) {
        await this.handleCacheMiss();
        throw error;
      }
      throw error;
    }
  }

  /**
   * Stop transcription and calculate stats.
   */
  public async stopTranscription(): Promise<{ success: boolean; transcript: string; stats: TranscriptStats } | null> {
    if (!this.fsm.is('RECORDING') && !this.fsm.is('PAUSED') && !this.fsm.is('ENGINE_INITIALIZING')) return null;
    
    // Fix 2: Handle early stop during initialization
    if (this.fsm.is('ENGINE_INITIALIZING')) {
      logger.info({ sId: this.serviceId, rId: this.runId }, '[TranscriptionService] Early stop during initialization');
      this.downloadController?.abort();
      this.downloadController = null;
      this.modelLoadingProgress = 0;
      this.fsm.transition({ type: 'STOP_REQUESTED' }); // now valid → IDLE
      return { success: true, transcript: '', stats: calculateTranscriptStats([], [], '', 0) };
    }

    this.fsm.transition({ type: 'STOP_REQUESTED' });

    try {
      // ✅ RESILIENCE: Race the engine stop against a timeout to prevent UI hangs
      const transcript = this.engine ? await Promise.race([
        this.engine.stopTranscription(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Engine stop timeout')), 3000)
        )
      ]) : '';

      const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

      // PHASE 2 SESSION COMPLETION: Finalize in DB via injected logic
      if (this.sessionId && this.dbHandlers) {
        await this.dbHandlers.completeSession(this.sessionId, transcript, Math.round(duration));
      }

      const stats = calculateTranscriptStats([{ transcript }], [], '', duration);

      this.fsm.transition({ type: 'STOP_COMPLETED' });
      useSessionStore.getState().setActiveEngine(null);
      this.modelLoadingProgress = null;
      useSessionStore.getState().setModelLoadingProgress(null);
      // Note: document.body.removeAttribute('data-download-progress') extracted to UI

      return { success: true, transcript, stats };
    } catch (error) {
      logger.error({ sId: this.serviceId, rId: this.runId, error }, '[TranscriptionService] stopTranscription failed');
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
   * Cleanup resources.
   * Idempotent and safe against concurrent calls.
   */
  public async destroy(): Promise<void> {
    const state = this.fsm.getState();

    // ✅ GUARD 1: Already cleaning up or terminated
    if (state === 'CLEANING_UP' || state === 'TERMINATED') {
      logger.debug(`[TranscriptionService] destroy() ignored - already in ${state}`);
      return;
    }

    // ✅ GUARD 2: IDLE means no work to do
    if (state === 'IDLE') {
      return;
    }

    logger.info('[TranscriptionService] 🧹 Starting cleanup sequence');

    try {
      this.fsm.transition({ type: 'TERMINATE_REQUESTED' });
      this.initPromise = null; // ✅ Hard Reset on termination

      if (this.mic) {
        this.mic.stop();
        this.mic = null;
      }

      const currentEngine = this.engine;
      this.engine = null; // Decouple immediately

      if (currentEngine) {
        try {
          // Call terminate with timeout to prevent hangs
          const terminator = typeof currentEngine.terminate === 'function'
            ? currentEngine.terminate()
            : currentEngine.stopTranscription();

          await Promise.race([
            terminator,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Engine terminate timeout')), 3000)
            )
          ]);
        } catch (error) {
          logger.error({ error }, '[TranscriptionService] Engine terminate failed or timed out');
        }
      }

      this.initPromise = null; 
      this.runId = null;

    } finally {
      // ✅ Transition to IDLE marks cleanup as complete
      this.fsm.transition({ type: 'RESET_REQUESTED' });
      logger.info('[TranscriptionService] ✅ Cleanup complete');
    }
  }

  public isServiceDestroyed(): boolean {
    return this.fsm.is('TERMINATED') || this.fsm.is('IDLE') && !this.mic && !this.engine;
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

  /**
   * ✅ E2E HOOK: Retrieves the current transcript from the engine.
   * Only supported by Private STT engines (Whisper).
   */
  public async getTranscript(): Promise<string> {
    if (this.engine) {
      return this.engine.getTranscript();
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
    this.initPromise = null;
    this.runId = null;

    // Reset FSM to IDLE
    this.fsm.reset();

    this.modelLoadingProgress = null;

    if (this.downloadController) {
      this.downloadController.abort();
      this.downloadController = null;
    }

    // Clear engine reference (but we don't destroy it to save WASM load time)
    this.engine = null;
    this.mic = null;

    useSessionStore.getState().setModelLoadingProgress(null);
  }

  /**
   * Abandons a pending download and clears associated state.
   */
  public async abandonDownload(): Promise<void> {
    logger.info('[TranscriptionService] Download abandoned');

    // Clear progress synchronously
    this.modelLoadingProgress = null;
    useSessionStore.getState().setModelLoadingProgress(null);

    // Cancel the download if in flight
    if (this.downloadController) {
      this.downloadController.abort();
      this.downloadController = null;
    }

    // Transition FSM
    this.fsm.transition({ type: 'STOP_REQUESTED' });
  }

  /**
   * Returns the configuration timeout for STT initialization.
   * ✅ E2E HOOK: Uses window.__STT_LOAD_TIMEOUT__ to allow tests to simulate 
   * long-tail hangs or force immediate transitions without modifying code.
   */
  private startOptimisticEntryTimer(): void {
    // Read lazily HERE, not in constructor — addInitScript flags
    // are not present at module evaluation time.
    const e2eConfig = getE2EConfig();
    const isE2E = e2eConfig.context === 'e2e' || e2eConfig.isE2E;
    const explicitTimeout = e2eConfig.stt.loadTimeout;
    
    if (isE2E && explicitTimeout === undefined) {
      logger.info('[STT] E2E context detected: fallback timer DISABLED. Private engine must initialize or test will fail.');
      return; // No timer. No fallback. Engine gets full Playwright timeout.
    }

    const timeout = explicitTimeout ?? this.getLoadTimeout();

    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
    }

    logger.info(`[STT] Fallback timer started: ${timeout}ms`);
    this.fallbackTimer = setTimeout(() => {
      // ✅ RESILIENCE: Before actually doing the fallback logic, double check
      // if the initPromise resolved or mode changed.
      // And we mark timerFired.
      this.timerFired = true;
      logger.warn('[STT] Private engine timeout. Falling back to Native Browser STT.');
      this.fallbackToNative();
    }, timeout);
  }

  private fallbackToNative(): void {
    // Privacy: Avoid silent fallback. Native STT often processes audio remotely.
    // Native STT (browser-level) often sends audio to Google/Apple servers.
    // Private STT (Whisper WASM) stays local.
    const hasConsent = typeof window !== 'undefined' && localStorage.getItem('stt_privacy_consent') === 'true';
    const isE2E = TestFlags.IS_TEST_MODE;

    if (!hasConsent && !isE2E) {
      logger.error('[TranscriptionService] Blocked Native Fallback: Explicit user consent missing.');
      this.fsm.transition({
        type: 'ERROR_OCCURRED',
        error: new Error('Privacy Guard: Native STT requires explicit consent for remote processing.')
      });
      return;
    }

    const duration = Date.now() - (this.startTimestamp || Date.now());
    logger.warn(`[STT] Private engine timeout after ${duration}ms. Falling back to Native Browser STT.`);
    if (this.mode) {
      this.handleFailure(this.mode, new Error('Optimistic entry timeout'));
    }
  }

  private getLoadTimeout(): number {
    const win = typeof window !== 'undefined' ? window as unknown as { __STT_LOAD_TIMEOUT__?: number } : null;
    if (win && win.__STT_LOAD_TIMEOUT__) {
      return win.__STT_LOAD_TIMEOUT__;
    }
    return IS_TEST_ENVIRONMENT
      ? STT_CONFIG.LOAD_CACHE_TIMEOUT_MS.CI
      : STT_CONFIG.LOAD_CACHE_TIMEOUT_MS.PROD;
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
    useSessionStore.getState().setModelLoadingProgress(percent);

    if (percent === 100) {
      if (TestFlags.IS_TEST_MODE) {
        useSessionStore.getState().setModelLoadingProgress(null);
      } else {
        setTimeout(() => {
          if (useSessionStore.getState().modelLoadingProgress === 100) {
            useSessionStore.getState().setModelLoadingProgress(null);
          }
        }, 1500);
      }
    }
  }

  /**
   * Internal helpers
   */

  private getProxyOptions(): TranscriptionModeOptions {
    const runId = this.runId || 'no-run';
    logger.debug({ runId }, '[TranscriptionService] Generating proxy options');
    
    return {
      ...this.options,
      instanceId: runId, // Keep for backward compat with engine interface but use runId
      onModelLoadProgress: (p) => this.processModelLoadProgress(p),
      onTranscriptUpdate: (u) => this.processTranscript(u),
      onReady: () => {
        logger.info('[STT] Private engine ready. Transitioning to local processing.');
        this.options.onReady?.();
      },
      onError: (err) => {
        logger.error({ sId: this.serviceId, rId: runId, error: err }, '[TranscriptionService] Proxy: Error triggered');
        this.lastError = err;
        this.fsm.transition({ type: 'ERROR_OCCURRED', error: err });
        this.options.onError?.(err);
      }
    };
  }

  /**
   * Whisper Garbage Filter (Pareto Fix #1)
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

  private async handleFailure(mode: TranscriptionMode, error: Error): Promise<void> {
    const isOptimisticTimeout = mode === 'private' && error.message?.includes('Optimistic entry timeout');

    // ✅ RESILIENCE: If a background engine (e.g. Private while in Native fallback) fails,
    // we must NOT clobber the active session or its indicators.
    if (mode !== this.mode && this.mode !== null) {
      const isExpectedTransition = mode === 'private' && (isOptimisticTimeout || isCacheMiss(error));
      
      if (!isExpectedTransition) {
        logger.warn({ mode, currentMode: this.mode, error }, '[STT] Background engine failure -> Clearing indicator');
        useSessionStore.getState().setModelLoadingProgress(null);
      } else {
        // No log here, as per instruction
      }
      return;
    }

    // Safety check: Should never receive a CACHE_MISS here
    if (isCacheMiss(error)) {
      logger.error('[TranscriptionService] BUG: CACHE_MISS reached handleFailure!');
      return; // Swallow it, don't call onError
    }

    logger.error({ mode, error }, '[TranscriptionService] Implementation failure');
    if (mode === 'private' && error.message !== 'CACHE_MISS') {
      this.failureManager.recordPrivateFailure();
    }

    logger.debug({ 
      mode, 
      errorMsg: error.message, 
      allowFallback: this.policy.allowFallback, 
      isOptimisticTimeout 
    }, '[TranscriptionService] handleFailure diagnostic');

    if ((this.policy.allowFallback || isOptimisticTimeout) && mode !== 'native') {
      logger.info('[STT] Attempting Native Fallback...');
      this.options.onStatusChange?.({ 
        type: 'fallback', 
        message: 'Private model performing one-time download. Using Browser STT till available...', 
        newMode: 'native' 
      });
      
      // ✅ EXPERT FIX: Ensure background indicator is visible during fallback
      useSessionStore.getState().setModelLoadingProgress(0);

      // Synchronization: Reset initPromise and mode to allow Native initialization
      this.initPromise = null;
      this.mode = 'native';
      try {
        const engineConfig: TranscriptionModeOptions = this.getProxyOptions();
        this.engine = await EngineFactory.create('native', engineConfig, this.policy);
        await this.engine.init();
        await this.executeEngine('native');
      } catch (fallbackError: unknown) {
        logger.error({ error: fallbackError }, '[STT] Native Fallback failed');
        await this.handleFailure('native', fallbackError as Error);
      }
    } else {
      logger.error({ sId: this.serviceId, error }, '[TranscriptionService] Terminal failure reached');
      this.lastError = error;
      this.fsm.transition({ type: 'ERROR_OCCURRED', error });
      this.initPromise = null; // Reset promise chain
      this.engine = null; // Force new engine on next attempt
      this.options.onError?.(error);
    }
  }

  private async handleCacheMiss(): Promise<void> {
    logger.info({
      allowFallback: this.policy.allowFallback,
      policy: this.policy
    }, '[TranscriptionService] Cache miss detected');

    // Trigger progress bar immediately
    useSessionStore.getState().setModelLoadingProgress(0);

    // ✅ LAZY POLICY READ: Read policy at call time, not construction time
    if (!this.policy.allowFallback) {
      logger.info('[TranscriptionService] allowFallback=false — waiting for download');
      // Do NOT switch to native. Stay in downloading state.
      // The test can now observe the download progress UI.
      return;
    }

    logger.info('[TranscriptionService] Switching to native fallback');

    this.options.onStatusChange?.({
      type: 'fallback',
      message: 'Private model failed. Using Browser STT (Native)...',
      progress: 0,
      newMode: 'native'
    });

    // We still keep the loading progress at 0 for the background download indicator
    useSessionStore.getState().setModelLoadingProgress(0);

    try {
      // FIX: Must create a new Native engine instance explicitly so we don't terminate the downloading Private engine
      const engineConfig: TranscriptionModeOptions = this.getProxyOptions();
      this.engine = await EngineFactory.create('native', engineConfig, this.policy);
      await this.engine.init();
      await this.executeEngine('native');
    } catch (error: unknown) {
      await this.handleFailure('native', error as Error);
    }
  }

  public getStartTime(): number | null { return this.startTime; }
  public getIdempotencyKey(): string | null { return this.idempotencyKey; }
  public getMetadata() { return this.metadata; }

  // Expose these for tests/runtime controller if needed
  public setSessionId(id: string | null) { this.sessionId = id; }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      if (!this.sessionId || !this.fsm.is('RECORDING')) return;
      if (this.dbHandlers) {
          await this.dbHandlers.heartbeatSession(this.sessionId);
      }
    }, this.HEARTBEAT_PERIOD_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

