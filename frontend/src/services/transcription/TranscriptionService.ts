import logger from '../../lib/logger';
import { createMicStream } from './utils/audioUtils';
import { EngineFactory } from './EngineFactory';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { ITranscriptionMode, TranscriptionModeOptions } from './modes/types';
import { MicStream } from './utils/types';
import { calculateTranscriptStats, TranscriptStats } from '../../utils/fillerWordUtils';
import { ImmutableCallbackProxy } from './utils/ImmutableCallbackProxy';
import {
  TranscriptionPolicy,
  TranscriptionMode,
  resolveMode,
  PROD_FREE_POLICY,
} from './TranscriptionPolicy';
import { useSessionStore, SessionStore } from '../../stores/useSessionStore';
import { TranscriptionFSM, TranscriptionState } from './TranscriptionFSM';
import { FailureManager } from './FailureManager';
import { STT_CONFIG } from '../../config';
import { SttStatus, TranscriptUpdate } from '../../types/transcription';
import {
  isCacheMiss,
  isExpectedEvent,
  CacheMissEvent,
} from './errors';
import { IS_TEST_ENVIRONMENT } from '../../config/env';

// ✅ EXPERT FIX: Module-level singleton instance to survive React remounts.
let _instance: TranscriptionService | null = null;

/**
 * ARCHITECTURAL SAFETY: Returns the current session store state if available.
 * Prevents crashes in test environments where the store is mocked without getState.
 */
function getStore(): SessionStore | null {
  try {
    return typeof useSessionStore.getState === 'function' ? useSessionStore.getState() : null;
  } catch {
    return null;
  }
}

export function getTranscriptionService(options: Partial<TranscriptionServiceOptions> = {}): TranscriptionService {
  if (!_instance) {
    _instance = new TranscriptionService(options);
  } else if (Object.keys(options).length > 0) {
    // If instance exists, update callbacks to handle React state changes (stale closures)
    _instance.updateCallbacks(options);
  }
  return _instance;
}

/**
 * TEST ONLY: Resets the singleton instance.
 */
export function resetTranscriptionService(): void {
  _instance = null;
}

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
  protected engine: ITranscriptionMode | null = null;
  private mic: MicStream | null = null;
  private micError: Error | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;

  private callbackProxy: ImmutableCallbackProxy<TranscriptionModeOptions>;
  private policy: TranscriptionPolicy;
  private options: TranscriptionServiceOptions;

  private startTimestamp: number = 0;
  private startTime: number | null = null;
  private mode: TranscriptionMode | null = null;
  private lastError: Error | null = null;
  private readonly MIN_RECORDING_DURATION_MS = 100;

  constructor(options: Partial<TranscriptionServiceOptions> = {}) {
    this.fsm = new TranscriptionFSM();
    this.failureManager = FailureManager.getInstance();
    this.policy = options.policy || PROD_FREE_POLICY;

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

    // Initialize Proxy for stable callback references in modes
    this.callbackProxy = new ImmutableCallbackProxy(this.getProxyOptions());
  }

  /**
   * Cold Boot Accelerator: Pre-initializes the engine without starting the mic.
   * Crucial for WASM/transformers.js where model loading takes significant time.
   */
  public async warmUp(mode: TranscriptionMode): Promise<void> {
    if (mode !== 'private') return; // Only private needs heavy warm-up

    logger.info(`[TranscriptionService] ⚡ Warming up engine for mode: ${mode}`);

    try {
      // 1. Create engine if not exists (or different)
      if (!this.engine || (this.engine as unknown as { type?: string }).type !== 'transformers-js') {
        const _engineConfig: TranscriptionModeOptions = {
          ...this.getProxyOptions(),
          onModelLoadProgress: (progress) => {
            const percent = progress !== null ? Math.round(progress * 100) : null;
            getStore()?.setModelLoadingProgress(percent);
            if (percent === 100) {
              setTimeout(() => {
                if (getStore()?.modelLoadingProgress === 100) {
                  getStore()?.setModelLoadingProgress(null);
                }
              }, 1500);
            }
          }
        };
        this.engine = await EngineFactory.create(mode, _engineConfig, this.policy);
      }

      // 2. Trigger init (this sets the data-stt-engine="ready" signal in PrivateWhisper)
      if (this.engine) {
        await this.engine.init();
        logger.info(`[TranscriptionService] ✅ Warm-up complete for ${mode}`);
      }
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] Warm-up failed');
    }
  }

  /**
   * Primary Entry Point: Pre-warms the microphone stream.
   */
  public async init(): Promise<{ success: boolean }> {
    if (this.fsm.is('READY') || this.fsm.is('RECORDING') || this.fsm.is('INITIALIZING_ENGINE')) {
      return { success: true };
    }

    if (!this.fsm.is('IDLE') && !this.fsm.is('ERROR')) {
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
      this.micError = error instanceof Error ? error : new Error(String(error));
      this.fsm.transition({ type: 'ERROR_OCCURRED', error: this.micError });
      this.options.onError?.(this.micError);
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

    if (this.fsm.is('RECORDING') || this.fsm.is('INITIALIZING_ENGINE') || this.fsm.is('PAUSED')) {
      logger.info('[TranscriptionService] Interrupting active session for new request');
      await this.destroy();
    }

    // Auto-init if needed
    if (this.fsm.is('IDLE') || this.fsm.is('ERROR')) {
      const ok = await this.init();
      if (!ok.success) return;
    }

    if (!this.fsm.is('READY')) return;

    this.fsm.transition({ type: 'ENGINE_INIT_REQUESTED' });

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

    this.mode = mode;
    this.startTimestamp = Date.now();
    getStore()?.setSTTMode(mode);

    try {
      if (mode !== 'native' && !this.mic) throw new Error('Microphone not initialized');

      // FIX: Bypass Proxy (solution for E2E eval serialization) 
      // The Proxy object fails to serialize correctly when passed to eval-based test factories in the browser
      const _bypassProxyOptions: TranscriptionModeOptions = {
        ...this.options,
        // Explicitly override the progress callback to ensure store updates happen
        onModelLoadProgress: (progress) => {
          logger.debug({ progress }, '[TranscriptionService] modelLoadProgress callback triggered');
          this.options.onModelLoadProgress?.(progress);
          // Standardize: If already 0-100 (from engine), use it; if 0-1 (legacy), scale it.
          // Engines like TransformersJSEngine and WhisperTurboEngine now emit 0-100.
          const percent = (progress !== null && progress <= 1) ? Math.round(progress * 100) : (progress as number | null);
          getStore()?.setModelLoadingProgress(percent);

          if (percent === 100) {
            setTimeout(() => {
              if (getStore()?.modelLoadingProgress === 100) {
                getStore()?.setModelLoadingProgress(null);
              }
            }, 1500);
          }
        },
        onTranscriptUpdate: (update) => {
          if (update.transcript.final) {
            update.transcript.final = this.sanitizeTranscript(update.transcript.final);
          }
          if (update.transcript.partial) {
            update.transcript.partial = this.sanitizeTranscript(update.transcript.partial);
          }
          // Only forward if there's actually something left after sanitization
          if (update.transcript.final || update.transcript.partial) {
            this.options.onTranscriptUpdate(update);
          }
        },
        onError: (err) => {
          // Forward to the main handler
          this.handleFailure(mode, err); // Pass mode to handleFailure
        }
      };

      logger.info(`[TranscriptionService] Preparing engine for mode: ${mode}`);

      // ✅ EXPERT OPTIMIZATION: Preserve warm-up by reusing existing engine if mode matches
      const existingType = this.engine ? (this.engine as unknown as { getEngineType?: () => string, type?: string }).getEngineType?.() || (this.engine as unknown as { type?: string }).type : null;
      const isPrivate = mode === 'private';
      const isSameMode = (isPrivate && (existingType === 'transformers-js' || existingType === 'whisper-turbo')) ||
        (mode === 'native' && existingType === 'native') ||
        (mode === 'cloud' && existingType === 'cloud');

      if (this.engine && isSameMode) {
        logger.info(`[TranscriptionService] Reusing existing ${mode} engine instance`);
        // Update callbacks of existing engine to handle potential stale closures
        const engineWithUpdate = this.engine as unknown as { updateOptions?: (opts: TranscriptionModeOptions) => void };
        if (typeof engineWithUpdate.updateOptions === 'function') {
          engineWithUpdate.updateOptions(this.getProxyOptions());
        }
      } else {
        if (this.engine) {
          logger.info('[TranscriptionService] Mode changed, destroying old engine');
          await this.engine.terminate?.();
        }
        this.engine = await EngineFactory.create(mode, _bypassProxyOptions, this.policy);
      }

      let skipInitInExecute = false;

      if (mode === 'private') {
        // Trigger init (this starts the WASM loading)
        const initPromise = this.engine.init();

        // ✅ EXPERT FIX: Disabling fallback entirely in E2E context to allow full WASM init.
        const win = typeof window !== 'undefined' ? window as unknown as { __E2E_CONTEXT__?: boolean, REAL_WHISPER_TEST?: boolean } : {};
        const isE2E = win.__E2E_CONTEXT__ || win.REAL_WHISPER_TEST || IS_TEST_ENVIRONMENT;

        if (isE2E) {
          logger.info('[TranscriptionService] 🧪 E2E Mode detected: DISABLING optimistic fallback. Waiting for full engine init.');
          await initPromise;
          skipInitInExecute = true;
        } else {
          // Normal mode: Start the optimistic timeout race
          this.startOptimisticEntryTimer();

          try {
            // We still need to race the initPromise with the error from the timer
            // I'll adapt to use a promise-wrapped version of the timer for the race.
            const timeoutPromise = new Promise((_, reject) => {
              // The startOptimisticEntryTimer sets this.fallbackTimer
              // We just need to wait for it or for initPromise
              const checkTimer = setInterval(() => {
                if (!this.fallbackTimer && !isE2E) {
                  clearInterval(checkTimer);
                  reject(new CacheMissEvent());
                }
              }, 100);
              initPromise.finally(() => clearInterval(checkTimer));
            });

            await Promise.race([initPromise, timeoutPromise]);
            skipInitInExecute = true;
          } finally {
            if (this.fallbackTimer) {
              clearTimeout(this.fallbackTimer);
              this.fallbackTimer = null;
            }
          }
        }

        // ✅ INDUSTRY STANDARD: Handle background completion
        initPromise.then(() => {
          // If we are recording in fallback mode (e.g. native), notify the user that private is now ready
          const activeEngine = getStore()?.activeEngine;
          if (this.fsm.is('RECORDING') && activeEngine === 'native') {
            logger.info('[TranscriptionService] Background private engine init complete');
            this.options.onStatusChange?.({
              type: 'info',
              message: 'Private model ready'
            });
          }
          // Clear progress indicator upon successful load
          getStore()?.setModelLoadingProgress(null);
        }).catch(err => {
          if (!isCacheMiss(err)) {
            logger.error({ err }, '[TranscriptionService] Background private engine init failed');
          }
        });

      }

      await this.executeEngine(mode, skipInitInExecute);
    } catch (error) {
      // ✅ EXPECTED EVENT: Cache miss - start background download
      if (isCacheMiss(error)) {
        logger.info('[TranscriptionService] Cache miss - triggering download');

        // Handle cache miss ONLY here - never pass to onError
        await this.handleCacheMiss();
        return; // ← Exit cleanly, no error propagation
      }

      // ✅ EXPECTED EVENT: Any other known event
      if (isExpectedEvent(error)) {
        const code = (error as unknown as Record<string, unknown>).code;
        logger.info({ code: String(code) }, '[TranscriptionService] Expected event');
        // Handle gracefully, no error propagation
        return;
      }

      await this.handleFailure(mode, error as Error);
    }
  }

  /**
   * Internal engine lifecycle execution.
   */
  private async executeEngine(mode: TranscriptionMode, skipInit: boolean = false): Promise<void> {
    if (!this.engine) return;

    try {
      if (!skipInit) {
        await this.engine.init();
      }
      await this.engine.startTranscription(this.mic!);

      this.startTime = Date.now();
      this.options.onModeChange?.(mode);
      getStore()?.setActiveEngine(mode);

      this.fsm.transition({ type: 'ENGINE_STARTED' });
    } catch (error) {
      // Specialized handling for Whisper Cache Miss
      if (error instanceof Error && error.message === 'CACHE_MISS') {
        this.handleCacheMiss();
        throw error; // Re-throw to caller to handle fallback
      }
      throw error;
    }
  }

  /**
   * Stop transcription and calculate stats.
   */
  public async stopTranscription(): Promise<{ success: boolean; transcript: string; stats: TranscriptStats } | null> {
    const elapsed = Date.now() - this.startTimestamp;
    if (elapsed < this.MIN_RECORDING_DURATION_MS) return null;

    if (!this.fsm.is('RECORDING') && !this.fsm.is('PAUSED') && !this.fsm.is('INITIALIZING_ENGINE')) return null;

    this.fsm.transition({ type: 'STOP_REQUESTED' });

    try {
      // ✅ RESILIENCE: Race the engine stop against a timeout to prevent UI hangs
      const transcript = this.engine ? await Promise.race([
        this.engine.stopTranscription(),
        new Promise<string>((_resolve, reject) =>
          setTimeout(() => reject(new Error('Engine stop timeout')), 3000)
        )
      ]) : '';

      const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
      const stats = calculateTranscriptStats([{ transcript }], [], '', duration);

      this.fsm.transition({ type: 'STOP_COMPLETED' });
      getStore()?.setActiveEngine(null);

      return { success: true, transcript, stats };
    } catch (error) {
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

      if (this.fallbackTimer) {
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }

      if (this.mic) {
        this.mic.stop();
        this.mic = null;
      }

      const currentEngine = this.engine;
      this.engine = null; // Decouple immediately

      if (currentEngine) {
        try {
          // Call terminate with timeout to prevent hangs
          const terminator = currentEngine.terminate
            ? currentEngine.terminate()
            : currentEngine.stopTranscription();

          await Promise.race([
            terminator,
            new Promise((_resolve, reject) =>
              setTimeout(() => reject(new Error('Engine terminate timeout')), 3000)
            )
          ]);
        } catch (error) {
          logger.error({ error }, '[TranscriptionService] Engine terminate failed or timed out');
        }
      }

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

  public updatePolicy(newPolicy: TranscriptionPolicy): void {
    this.policy = newPolicy;
    this.options.policy = newPolicy;
  }

  public getState(): TranscriptionState { return this.fsm.getState(); }
  public getMode(): TranscriptionMode | null { return this.mode; }
  public getPolicy(): TranscriptionPolicy { return this.policy; }

  /**
   * Returns the configuration timeout for STT initialization.
   * ✅ E2E HOOK: Uses window.__STT_LOAD_TIMEOUT__ to allow tests to simulate 
   * long-tail hangs or force immediate transitions without modifying code.
   */
  private startOptimisticEntryTimer(): void {
    // Read lazily HERE, not in constructor — addInitScript flags
    // are not present at module evaluation time.
    const win = typeof window !== 'undefined' ? window as unknown as { __E2E_CONTEXT__?: boolean, REAL_WHISPER_TEST?: boolean } : {};
    const isE2E = win.__E2E_CONTEXT__ === true || win.REAL_WHISPER_TEST === true;

    if (isE2E) {
      logger.info('[STT] E2E context detected: fallback timer DISABLED. Private engine must initialize or test will fail.');
      return; // No timer. No fallback. Engine gets full Playwright timeout.
    }

    const timeout = (typeof window !== 'undefined' && (window as unknown as { __STT_LOAD_TIMEOUT__?: number }).__STT_LOAD_TIMEOUT__)
      ?? STT_CONFIG.LOAD_CACHE_TIMEOUT_MS.CI;

    logger.info(`[STT] Starting fallback timer: ${timeout}ms`);
    this.fallbackTimer = setTimeout(() => {
      logger.warn('[STT] Fallback timer fired — switching to Native STT');
      this.fallbackToNative();
    }, timeout);
  }

  private fallbackToNative(): void {
    // Trigger the failure which will cause the FSM to fallback
    if (this.mode) {
      this.handleFailure(this.mode, new Error('Optimistic entry timeout'));
    }
  }

  private getLoadTimeout(): number {
    const win = typeof window !== 'undefined' ? (window as unknown as { __STT_LOAD_TIMEOUT__?: number }) : null;
    if (win && win.__STT_LOAD_TIMEOUT__) {
      return win.__STT_LOAD_TIMEOUT__;
    }
    return IS_TEST_ENVIRONMENT
      ? STT_CONFIG.LOAD_CACHE_TIMEOUT_MS.CI
      : STT_CONFIG.LOAD_CACHE_TIMEOUT_MS.PROD;
  }

  /**
   * Internal helpers
   */

  private getProxyOptions(): TranscriptionModeOptions {
    return {
      onModelLoadProgress: (progress) => {
        this.options.onModelLoadProgress(progress);
        const percent = progress !== null ? Math.round(progress * 100) : null;
        getStore()?.setModelLoadingProgress(percent);

        // ✅ AUTO-CLEANUP: Clear indicator once it hits 100%
        if (percent === 100) {
          setTimeout(() => {
            // Only clear if still 100 (haven't started a new download)
            if (getStore()?.modelLoadingProgress === 100) {
              getStore()?.setModelLoadingProgress(null);
            }
          }, 1500); // Give user a moment to see "100%"
        }
      },
      onReady: this.options.onReady,
      onTranscriptUpdate: (update) => {
        if (update.transcript.final) {
          update.transcript.final = this.sanitizeTranscript(update.transcript.final);
        }
        if (update.transcript.partial) {
          update.transcript.partial = this.sanitizeTranscript(update.transcript.partial);
        }
        // Only forward if there's actually something left after sanitization
        if (update.transcript.final || update.transcript.partial) {
          this.options.onTranscriptUpdate(update);
        }
      },
      session: this.options.session,
      navigate: this.options.navigate,
      getAssemblyAIToken: this.options.getAssemblyAIToken,
      userWords: this.options.userWords || [],
      onAudioData: this.options.onAudioData,
      onError: (err) => {
        this.lastError = err;
        this.fsm.transition({ type: 'ERROR_OCCURRED', error: err });
        this.options.onError?.(err);
      },
      onModeChange: this.options.onModeChange,
      onStatusChange: this.options.onStatusChange,
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
      case 'INITIALIZING_ENGINE': status = { type: 'initializing', message: 'Initializing engine...' }; break;
      case 'RECORDING': {
        const engineType = (this.engine as unknown as { getEngineType?: () => string })?.getEngineType?.() || '';
        const isFast = engineType === 'whisper-turbo';
        const label = isFast ? '🔒 Private (Fast)' : (engineType === 'transformers-js' ? '🔒 Private (Safe)' : 'Recording active');
        status = { type: 'recording', message: label };
        break;
      }
      case 'ERROR': status = { type: 'error', message: this.lastError?.message || 'Error occurred' }; break;
      default: status = { type: 'idle', message: 'Ready' };
    }

    // PERSISTENCE FIX: Ensure background download progress isn't clobbered by state changes
    const store = getStore();
    if (store) {
      const currentProgress = store.modelLoadingProgress;
      if (currentProgress !== undefined && currentProgress !== null && state !== 'TERMINATED') {
        status.progress = currentProgress;
      }
    }

    this.options.onStatusChange?.(status);
    if (store && typeof store.setSTTStatus === 'function') {
      store.setSTTStatus(status);
    }
  }

  private async handleFailure(mode: TranscriptionMode, error: Error): Promise<void> {
    // Safety check: Should never receive a CACHE_MISS here
    if (isCacheMiss(error)) {
      logger.error('[TranscriptionService] BUG: CACHE_MISS reached handleFailure!');
      return; // Swallow it, don't call onError
    }

    logger.error({ mode, error }, '[TranscriptionService] Implementation failure');
    if (mode === 'private' && error.message !== 'CACHE_MISS') {
      this.failureManager.recordPrivateFailure();
    }

    if (this.policy.allowFallback && mode !== 'native') {
      logger.info('[TranscriptionService] Attempting Native Fallback...');
      this.options.onStatusChange?.({ type: 'fallback', message: 'Falling back to Native browser mode', newMode: 'native' });

      // ✅ FIX: Await the fallback to ensure deterministic state transitions
      await this.startTranscription({ ...this.policy, preferredMode: 'native' });
    } else {
      this.lastError = error;
      this.fsm.transition({ type: 'ERROR_OCCURRED', error });
      this.options.onError?.(error);
    }
  }

  private async handleCacheMiss(): Promise<void> {
    logger.info('[TranscriptionService] Handling cache miss - switching to native fallback');

    this.options.onStatusChange?.({
      type: 'fallback',
      message: 'Private model not ready. using Browser STT (Native)...',
      progress: 0
    });

    // We still keep the loading progress at 0 for the background download indicator
    getStore()?.setModelLoadingProgress(0);

    // FIX: Must create a new Native engine instance
    const engineConfig: TranscriptionModeOptions = { ...this.options };
    this.engine = await EngineFactory.create('native', engineConfig, this.policy);

    await this.executeEngine('native', false);
  }
}
