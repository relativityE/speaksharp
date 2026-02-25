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
import { useSessionStore } from '../../stores/useSessionStore';
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
    useSessionStore.getState().setSTTMode(mode);

    try {
      if (mode !== 'native' && !this.mic) throw new Error('Microphone not initialized');

      // FIX: Bypass Proxy (solution for E2E eval serialization) 
      // The Proxy object fails to serialize correctly when passed to eval-based test factories in the browser
      const engineConfig: TranscriptionModeOptions = {
        ...this.options,
        // Explicitly override the progress callback to ensure store updates happen
        onModelLoadProgress: (progress) => {
          logger.debug({ progress }, '[TranscriptionService] modelLoadProgress callback triggered');
          this.options.onModelLoadProgress?.(progress);
          const percent = progress !== null ? Math.round(progress * 100) : null;
          useSessionStore.getState().setModelLoadingProgress(percent);

          if (percent === 100) {
            setTimeout(() => {
              if (useSessionStore.getState().modelLoadingProgress === 100) {
                useSessionStore.getState().setModelLoadingProgress(null);
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

      logger.info(`[TranscriptionService] Creating engine for mode: ${mode}`);

      this.engine = await EngineFactory.create(mode, engineConfig, this.policy);

      let skipInitInExecute = false;

      if (mode === 'private') {
        const timeout = this.getLoadTimeout();
        logger.info({ timeout }, '[TranscriptionService] Starting Private STT with Optimistic Entry race');

        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new CacheMissEvent()), timeout);
        });

        const initPromise = this.engine.init();

        // ✅ INDUSTRY STANDARD: Handle background completion for Optimistic Entry
        initPromise.then(() => {
          // If we are recording in fallback mode (e.g. native), notify the user that private is now ready
          const activeEngine = useSessionStore.getState().activeEngine;
          if (this.fsm.is('RECORDING') && activeEngine === 'native') {
            logger.info('[TranscriptionService] Background private engine init complete');
            this.options.onStatusChange?.({
              type: 'info',
              message: 'Private model ready'
            });
          }
          // Clear progress indicator upon successful load
          useSessionStore.getState().setModelLoadingProgress(null);
        }).catch(err => {
          if (!isCacheMiss(err)) {
            logger.error({ err }, '[TranscriptionService] Background private engine init failed');
          }
        });

        try {
          await Promise.race([
            initPromise,
            timeoutPromise
          ]);
          skipInitInExecute = true; // Successfully initialized within timeout
        } finally {
          // @ts-expect-error - timeoutId is assigned in Promise executor
          if (timeoutId) clearTimeout(timeoutId);
        }
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
      useSessionStore.getState().setActiveEngine(mode);

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
      const transcript = this.engine ? await this.engine.stopTranscription() : '';
      const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;
      const stats = calculateTranscriptStats([{ transcript }], [], '', duration);

      this.fsm.transition({ type: 'STOP_COMPLETED' });
      useSessionStore.getState().setActiveEngine(null);

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

  private getLoadTimeout(): number {
    // ✅ EXPERT FIX: Allow E2E tests to override timeout for resilience testing
    const win = typeof window !== 'undefined' ? window as unknown as { __STT_LOAD_TIMEOUT__?: number } : null;
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
        useSessionStore.getState().setModelLoadingProgress(percent);

        // ✅ AUTO-CLEANUP: Clear indicator once it hits 100%
        if (percent === 100) {
          setTimeout(() => {
            // Only clear if still 100 (haven't started a new download)
            if (useSessionStore.getState().modelLoadingProgress === 100) {
              useSessionStore.getState().setModelLoadingProgress(null);
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
        const engineType = (this.engine as unknown as { getEngineType: () => string })?.getEngineType() || '';
        const isFast = engineType === 'whisper-turbo';
        const label = isFast ? '🔒 Private (Fast)' : (engineType === 'transformers-js' ? '🔒 Private (Safe)' : 'Recording active');
        status = { type: 'recording', message: label };
        break;
      }
      case 'ERROR': status = { type: 'error', message: this.lastError?.message || 'Error occurred' }; break;
      default: status = { type: 'idle', message: 'Ready' };
    }

    // PERSISTENCE FIX: Ensure background download progress isn't clobbered by state changes
    const currentProgress = useSessionStore.getState().modelLoadingProgress;
    if (currentProgress !== null && state !== 'TERMINATED') {
      status.progress = currentProgress;
    }

    this.options.onStatusChange?.(status);
    useSessionStore.getState().setSTTStatus(status);
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
    useSessionStore.getState().setModelLoadingProgress(0);

    // FIX: Must create a new Native engine instance
    const engineConfig: TranscriptionModeOptions = { ...this.options };
    this.engine = await EngineFactory.create('native', engineConfig, this.policy);

    await this.executeEngine('native', false);
  }
}
