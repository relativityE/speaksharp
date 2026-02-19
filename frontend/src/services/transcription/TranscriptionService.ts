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
  customVocabulary?: string[];
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
      customVocabulary: options.customVocabulary || [],
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
    if (!this.fsm.is('IDLE') && !this.fsm.is('ERROR')) return { success: true };

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

    // ✅ ROBUSTNESS: If already recording or initializing, clean up first (Mode Switch)
    if (this.fsm.is('RECORDING') || this.fsm.is('INITIALIZING_ENGINE') || this.fsm.is('PAUSED')) {
      logger.info('[TranscriptionService] Interrupting active session for new request');
      await this.destroy();
    }

    // Auto-init if needed
    if (this.fsm.is('IDLE') || this.fsm.is('ERROR')) {
      const ok = await this.init();
      if (!ok) return;
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
          // We must manually replicate the proxy's behavior here since we are bypassing it
          this.options.onModelLoadProgress?.(progress);
          useSessionStore.getState().setModelLoadingProgress(progress !== null ? Math.round(progress * 100) : null);
        },
        onError: (err) => {
          // Forward to the main handler
          this.handleFailure(mode, err); // Pass mode to handleFailure
        }
      };

      logger.info(`[TranscriptionService] Creating engine for mode: ${mode}`);

      this.engine = await EngineFactory.create(mode, engineConfig, this.policy);

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
        } finally {
          // @ts-expect-error - timeoutId is assigned in Promise executor
          if (timeoutId) clearTimeout(timeoutId);
        }
      } else {
        await this.engine.init();
      }

      await this.executeEngine(mode);
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

      this.handleFailure(mode, error as Error);
    }
  }

  /**
   * Internal engine lifecycle execution.
   */
  private async executeEngine(mode: TranscriptionMode): Promise<void> {
    if (!this.engine) return;

    try {
      await this.engine.init();
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
      const stats = calculateTranscriptStats([{ text: transcript }], [], '', duration);

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
  private isDestroying = false;
  private isDestroyed = false;

  /**
   * Cleanup resources.
   * Idempotent and safe against concurrent calls.
   */
  public async destroy(): Promise<void> {
    // ✅ GUARD 1: Already destroyed - immediate return
    if (this.isDestroyed) {
      return;
    }

    // ✅ GUARD 2: Currently destroying - wait for it to complete
    if (this.isDestroying) {
      // Wait for the current destroy to complete
      await new Promise(resolve => {
        const checkInterval = setInterval(() => {
          if (!this.isDestroying) {
            clearInterval(checkInterval);
            resolve(undefined);
          }
        }, 10);
      });
      return;
    }

    // ✅ Set destroying flag (prevents concurrent destroys)
    this.isDestroying = true;

    try {
      this.fsm.transition({ type: 'TERMINATE_REQUESTED' });

      if (this.mic) {
        this.mic.stop();
        this.mic = null;
      }

      if (this.engine) {
        try {
          // Call terminate with timeout to prevent hangs
          // Check if terminate exists (Interface compliance)
          const terminator = typeof this.engine.terminate === 'function'
            ? this.engine.terminate()
            : this.engine.stopTranscription();

          await Promise.race([
            terminator,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Engine terminate timeout')), 5000)
            )
          ]);
        } catch (error) {
          logger.error({ error }, '[TranscriptionService] Engine terminate failed or timed out');
        }
        this.engine = null;
      }

      this.fsm.transition({ type: 'RESET_REQUESTED' });

    } finally {
      // ✅ Always set flags, even if cleanup fails
      this.isDestroying = false;
      this.isDestroyed = true;
    }
  }

  public isServiceDestroyed(): boolean {
    return this.isDestroyed;
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
      onTranscriptUpdate: this.options.onTranscriptUpdate,
      onModelLoadProgress: (progress) => {
        this.options.onModelLoadProgress(progress);
        useSessionStore.getState().setModelLoadingProgress(progress !== null ? Math.round(progress * 100) : null);
      },
      onReady: this.options.onReady,
      session: this.options.session,
      navigate: this.options.navigate,
      getAssemblyAIToken: this.options.getAssemblyAIToken,
      customVocabulary: this.options.customVocabulary || [],
      onAudioData: this.options.onAudioData,
      onError: (err) => {
        this.fsm.transition({ type: 'ERROR_OCCURRED', error: err });
        this.options.onError?.(err);
      },
      onModeChange: this.options.onModeChange,
      onStatusChange: this.options.onStatusChange,
    };
  }

  private handleStateChange(state: TranscriptionState): void {
    let status: SttStatus;
    switch (state) {
      case 'IDLE':
      case 'TERMINATED': status = { type: 'idle', message: 'Ready' }; break;
      case 'ACTIVATING_MIC': status = { type: 'initializing', message: 'Mic requested...' }; break;
      case 'READY': status = { type: 'idle', message: 'Mic ready' }; break;
      case 'INITIALIZING_ENGINE': status = { type: 'initializing', message: 'Initializing engine...' }; break;
      case 'RECORDING': status = { type: 'recording', message: 'Recording active' }; break;
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

  private handleFailure(mode: TranscriptionMode, error: Error): void {
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
      this.startTranscription({ ...this.policy, preferredMode: 'native' });
    } else {
      this.lastError = error;
      this.fsm.transition({ type: 'ERROR_OCCURRED', error });
      this.options.onError?.(error);
    }
  }

  private async handleCacheMiss(): Promise<void> {
    logger.info('[TranscriptionService] Handling cache miss');

    this.options.onStatusChange?.({ type: 'downloading', message: 'Private model not cached, downloading...', progress: 0 });

    // Explicitly set store state so UI components can find it separately from engine status
    useSessionStore.getState().setModelLoadingProgress(0);

    // Start fallback engine immediately so user can record while downloading
    // This matches the "Optimistic Entry" pattern
    // FIX: Must create a new Native engine instance, otherwise we reuse the failing Private engine!
    const engineConfig: TranscriptionModeOptions = { ...this.options }; // Use base options for native
    this.engine = await EngineFactory.create('native', engineConfig, this.policy);
    await this.engine.init(); // Init native engine

    await this.executeEngine('native');
  }
}
