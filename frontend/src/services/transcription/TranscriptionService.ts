import logger from '../../lib/logger';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';
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

export interface TranscriptUpdate {
  transcript: {
    partial?: string;
    final?: string;
  };
  chunks?: { timestamp: [number, number]; text: string }[];
}

export type SttStatusType = 'idle' | 'initializing' | 'downloading' | 'ready' | 'fallback' | 'error';

/**
 * ARCHITECTURE (Senior Architect):
 * Explicit states for TranscriptionService FSM.
 * IDLE -> INITIALIZING -> READY -> STARTING -> RECORDING -> STOPPING -> IDLE
 * Any state -> ERROR
 */
export type ServiceState =
  | 'IDLE'
  | 'INITIALIZING_ENGINE'
  | 'ENGINE_READY'
  | 'ACTIVATING_MIC'
  | 'READY'
  | 'STARTING'
  | 'RECORDING'
  | 'STOPPING'
  | 'ERROR';

export interface SttStatus {
  type: SttStatusType;
  message: string;
  progress?: number;
  newMode?: TranscriptionMode;
}

export interface TranscriptionServiceOptions {
  onTranscriptUpdate: (update: TranscriptUpdate) => void;
  onModelLoadProgress: (progress: number | null) => void;
  onReady: () => void;
  session: Session | null;
  navigate: NavigateFunction;
  getAssemblyAIToken: () => Promise<string | null>;
  customVocabulary?: string[];
  /** 
   * The policy that controls which modes are allowed and preferred.
   * Defaults to PROD_FREE_POLICY if not provided.
   */
  policy?: TranscriptionPolicy;
  /**
   * Optional: Inject a mock microphone for E2E testing.
   * If provided, the service will use this instead of creating a real mic.
   */
  mockMic?: MicStream;
  onModeChange?: (mode: TranscriptionMode | null) => void;
  /** Callback for STT status changes (initialization, fallback, errors) */
  onStatusChange?: (status: SttStatus) => void;
  /** Callback for raw audio data (for visualization/analysis) */
  onAudioData?: (data: Float32Array) => void;
}

import { STT_CONFIG } from '../../config';
import { IS_TEST_ENVIRONMENT } from '@/config/env';
import posthog from 'posthog-js';
import { testRegistry } from './TestRegistry'; // Test Registry Pattern
import { IPrivateSTT } from './engines/IPrivateSTT';

// Extend Window interface for E2E mocks
declare global {
  interface Window {
    MockPrivateWhisper?: new (config: TranscriptionModeOptions) => ITranscriptionMode;
    __E2E_MOCK_LOCAL_WHISPER__?: boolean;
    MockNativeBrowser?: new (config: TranscriptionModeOptions) => ITranscriptionMode;
    __E2E_MOCK_NATIVE__?: boolean;
    __FAKE_PRIVATE_STT__?: IPrivateSTT; // Injected Fake
  }
}

/**
 * Track failures with timestamps for time-based decay.
 * Failures expire after FAILURE_DECAY_MS to prevent permanent lockout.
 */
const FAILURE_DECAY_MS = 5 * 60 * 1000; // 5 minutes

interface FailureRecord {
  count: number;
  lastFailureTime: number;
}

export default class TranscriptionService {
  private static privateFailures: FailureRecord = { count: 0, lastFailureTime: 0 };
  private mode: TranscriptionMode | null = null;
  private state: ServiceState = 'IDLE';
  // ... existing private properties ...
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress: (progress: number | null) => void;
  private onReady: () => void;
  private onModeChange?: (mode: TranscriptionMode | null) => void;

  // ZOMBIE PREVENTION: Guard against concurrent terminate calls
  private isTerminating = false;
  private onStatusChange?: (status: SttStatus) => void;
  private onAudioData?: (data: Float32Array) => void;
  private session: Session | null;
  private navigate: NavigateFunction;
  private getAssemblyAIToken: () => Promise<string | null>;
  private customVocabulary: string[];
  private policy: TranscriptionPolicy;
  private mockMic: MicStream | null;
  private mic: MicStream | null = null;
  private callbackProxy: ImmutableCallbackProxy<TranscriptionModeOptions>;
  private instance: ITranscriptionMode | null = null;
  private startTime: number | null = null;

  constructor({
    onTranscriptUpdate,
    onModelLoadProgress,
    onReady,
    customVocabulary = [],
    session,
    navigate,
    getAssemblyAIToken,
    policy = PROD_FREE_POLICY,
    mockMic,
    onModeChange,
    onStatusChange,
    onAudioData,
  }: TranscriptionServiceOptions) {
    logger.info(
      { policy: policy.executionIntent },
      `[TranscriptionService] Constructor called with policy: ${policy.executionIntent}`
    );
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.onModeChange = onModeChange;
    this.onStatusChange = onStatusChange;
    this.session = session;
    this.navigate = navigate;
    this.getAssemblyAIToken = getAssemblyAIToken;
    this.customVocabulary = customVocabulary;
    this.policy = policy;
    this.mockMic = mockMic ?? null;
    this.onAudioData = onAudioData;

    // Initialize the callback proxy with the initial options
    this.callbackProxy = new ImmutableCallbackProxy({
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: this.onModelLoadProgress,
      onReady: this.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
      customVocabulary: this.customVocabulary,
      onAudioData: this.onAudioData,
      onError: (err: Error) => {
        logger.error({ err }, '[TranscriptionService] Error from mode provider');
        this.transitionTo('ERROR');
        this.onStatusChange?.({ type: 'error', message: err.message });
      }
    });
  }

  /**
   * Resets the static failure count.
   * STRICTLY FOR TESTING PURPOSES ONLY.
   */
  public static resetFailureCount(): void {
    TranscriptionService.privateFailures = { count: 0, lastFailureTime: 0 };
  }

  /**
   * Get effective failure count with time-based decay.
   * Failures older than FAILURE_DECAY_MS are ignored.
   */
  private static getEffectiveFailureCount(): number {
    const now = Date.now();
    if (now - TranscriptionService.privateFailures.lastFailureTime > FAILURE_DECAY_MS) {
      // Failures have decayed, reset count
      TranscriptionService.privateFailures = { count: 0, lastFailureTime: 0 };
      return 0;
    }
    return TranscriptionService.privateFailures.count;
  }

  /**
   * Record a private mode failure with timestamp.
   */
  private static recordPrivateFailure(): void {
    TranscriptionService.privateFailures = {
      count: TranscriptionService.getEffectiveFailureCount() + 1,
      lastFailureTime: Date.now()
    };
  }

  private micError: Error | null = null;
  private engineInitPromise: Promise<void> | null = null;

  private transitionTo(newState: ServiceState): void {
    logger.info({ from: this.state, to: newState }, `[TranscriptionService] State transition: ${this.state} -> ${newState}`);
    this.state = newState;

    // Sync external status if applicable
    const statusMap: Partial<Record<ServiceState, SttStatusType>> = {
      IDLE: 'idle',
      INITIALIZING_ENGINE: 'initializing',
      ENGINE_READY: 'ready',
      ACTIVATING_MIC: 'initializing',
      READY: 'ready',
      STARTING: 'initializing',
      RECORDING: 'ready',
      ERROR: 'error',
      STOPPING: 'idle'
    };

    if (statusMap[newState]) {
      this.onStatusChange?.({
        type: statusMap[newState]!,
        message: `State: ${newState}`
      });
    }
  }

  /**
   * Primary Entry Point: Pre-warms the engine and optionally activates the microphone.
   * Following Option 1 (System Integrity): Decouples WASM warmup from hardware.
   */
  public async init(): Promise<{ success: boolean }> {
    if (this.state !== 'IDLE' && this.state !== 'ERROR') {
      logger.warn({ currentState: this.state }, '[TranscriptionService] init() called in non-IDLE state');
      return { success: this.state === 'READY' || this.state === 'RECORDING' || this.state === 'ENGINE_READY' };
    }

    // PHASE 1: Initialize Engine (WASM, Models, Workers)
    if (!this.engineInitPromise) {
      this.transitionTo('INITIALIZING_ENGINE');
      const resolvedMode = resolveMode(this.policy);

      this.engineInitPromise = (async () => {
        try {
          logger.info({ mode: resolvedMode }, '[TranscriptionService] 🛡️ [System Integrity] Pre-loading Engine...');
          await this.ensureInstanceInitialized(resolvedMode);
          this.transitionTo('ENGINE_READY');
        } catch (error) {
          logger.error({ error }, '[TranscriptionService] Failed to initialize engine');
          this.transitionTo('ERROR');
          this.engineInitPromise = null;
          throw error;
        }
      })();
    }

    try {
      await this.engineInitPromise;
    } catch (e) {
      return { success: false };
    }

    // PHASE 2: Activate Microphone
    return this.initializeMic();
  }

  /**
   * Explicitly activate the microphone input.
   * Can be called after engine is ready to finalise the pipeline.
   */
  public async initializeMic(): Promise<{ success: boolean }> {
    if (this.state === 'READY') return { success: true };
    if (this.state !== 'ENGINE_READY') {
      logger.error({ state: this.state }, '[TranscriptionService] Cannot activate mic before engine is ready');
      return { success: false };
    }

    this.transitionTo('ACTIVATING_MIC');

    // If a mock mic was injected (for E2E), use it directly
    if (this.mockMic) {
      logger.info('[TranscriptionService] Using injected mock microphone');
      this.mic = this.mockMic;
      this.transitionTo('READY');
      return { success: true };
    }

    logger.info('[TranscriptionService] Initializing mic stream...');
    try {
      this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
      logger.info('[TranscriptionService] Mic stream created.');
      this.micError = null;
      this.transitionTo('READY');
      return { success: true };
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] Failed to initialize mic');
      this.micError = error instanceof Error ? error : new Error(String(error));

      // Still in ENGINE_READY state effectively from a compute perspective,
      // but the SERVICE is in ERROR because it can't record.
      this.transitionTo('ERROR');
      return { success: false };
    }
  }

  /**
   * Internal helper to ensure the STT instance is created and init() called.
   * This is part of Option 1 (System Integrity) to allow background initialization.
   */
  private async ensureInstanceInitialized(mode: TranscriptionMode): Promise<void> {
    if (this.instance) {
      logger.info({ mode }, '[TranscriptionService] Instance already exists, reusing.');
      return;
    }

    const providerConfig: TranscriptionModeOptions = this.callbackProxy.getProxy();

    switch (mode) {
      case 'native':
        logger.info('[TranscriptionService] 🌐 Initializing Native Browser mode');
        if (window.MockNativeBrowser && window.__E2E_MOCK_NATIVE__ === true) {
          logger.info('[TranscriptionService] 🧪 Using MockNativeBrowser for E2E');
          this.instance = new window.MockNativeBrowser(providerConfig);
        } else {
          this.instance = new NativeBrowser(providerConfig);
        }
        break;

      case 'cloud':
        logger.info('[TranscriptionService] ☁️ Initializing Cloud (AssemblyAI) mode');
        this.instance = new CloudAssemblyAI(providerConfig);
        break;

      case 'private': {
        logger.info('[TranscriptionService] 🔒 Initializing Private (Whisper) mode');

        // DI / Test Registry Pattern for Constructor Injection
        let injectedSTT: IPrivateSTT | undefined = undefined;
        if (import.meta.env.MODE === 'test' || import.meta.env.DEV) {
          const factory = testRegistry.get<() => IPrivateSTT>('privateSTT');
          if (factory) {
            const fake = factory();

            // Runtime Type Guard
            const isValidFakeSTT = (obj: unknown): obj is IPrivateSTT => {
              const o = obj as Record<string, unknown>;
              return (
                !!o &&
                typeof o.init === 'function' &&
                typeof o.transcribe === 'function' &&
                typeof o.destroy === 'function' &&
                typeof o.getEngineType === 'function'
              );
            };

            if (isValidFakeSTT(fake)) {
              logger.info('[TranscriptionService] 🧪 Injecting Valid FakePrivateSTT from Registry');
              injectedSTT = fake;
            } else {
              logger.warn('[TranscriptionService] ⚠️ Invalid factory result from registry. Ignoring injection.');
            }
          }
        }

        const module = await import('./modes/PrivateWhisper');
        this.instance = new module.default(providerConfig, injectedSTT);
        break;
      }
    }

    if (this.instance) {
      await this.instance.init();
    }
  }

  public async startTranscription(): Promise<void> {
    if (this.state === 'RECORDING' || this.state === 'STARTING') {
      logger.warn({ currentState: this.state }, '[TranscriptionService] startTranscription() called while already active');
      return;
    }

    if (this.state !== 'READY') {
      // Auto-init if called while IDLE
      if (this.state === 'IDLE' || this.state === 'ERROR') {
        const initResult = await this.init();
        if (!initResult.success && resolveMode(this.policy) !== 'native') {
          throw new Error('Transcription cannot start: Initializing failed and no fallback possible.');
        }
      } else {
        throw new Error(`Invalid state for startTranscription: ${this.state}`);
      }
    }

    this.transitionTo('STARTING');
    logger.info('[TranscriptionService] Attempting to start transcription...');

    // Resolve the mode using the injected policy
    let resolvedMode = resolveMode(this.policy);
    logger.info({ resolvedMode, policy: this.policy.executionIntent }, `[TranscriptionService] 🎯 Mode resolved`);

    const providerConfig: TranscriptionModeOptions = {
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: this.onModelLoadProgress,
      onReady: this.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
      customVocabulary: this.customVocabulary,
      onAudioData: this.onAudioData,
      onError: (err) => {
        logger.error({ err }, '[TranscriptionService] Error from mode provider');
        this.transitionTo('ERROR');
        this.onStatusChange?.({ type: 'error', message: err.message });
      }
    };

    // CHECK MAX ATTEMPTS FOR PRIVATE MODE (with time-based decay)
    const effectiveFailures = TranscriptionService.getEffectiveFailureCount();
    if (resolvedMode === 'private' && effectiveFailures >= STT_CONFIG.MAX_PRIVATE_ATTEMPTS) {
      logger.warn({ attempts: effectiveFailures }, `[TranscriptionService] ⚠️ Max Private STT attempts reached. Forcing Native.`);

      this.onStatusChange?.({
        type: 'fallback',
        message: '⚠️ Too many failures. Switched to Native STT.',
        newMode: 'native'
      });

      resolvedMode = 'native';
    }

    try {
      // CHECK MICROPHONE REQUIREMENT
      if (resolvedMode !== 'native') {
        if (this.micError) {
          logger.error('[TranscriptionService] Blocking start: Mic initialization failed previously.');
          throw this.micError;
        }
        if (!this.mic) {
          logger.error('[TranscriptionService] Microphone not initialized.');
          throw new Error("Microphone not initialized. Call init() first.");
        }
      }

      await this.executeMode(resolvedMode, providerConfig);
    } catch (error) {
      // TRACK FAILURE with timestamp (Exclude CACHE_MISS which is just a loading state - Issue C)
      const isCacheMiss = error instanceof Error && error.message === 'CACHE_MISS';
      if (resolvedMode === 'private' && !isCacheMiss) {
        TranscriptionService.recordPrivateFailure();
        logger.warn({ failures: TranscriptionService.getEffectiveFailureCount() }, `[TranscriptionService] Private mode failed`);
      }

      // If fallback is allowed, try alternatives
      if (this.policy.allowFallback) {
        logger.warn({ error, failedMode: resolvedMode }, `[TranscriptionService] ⚠️ Mode failed, attempting fallback...`);
        await this.executeFallback(resolvedMode, providerConfig);
      } else {
        this.transitionTo('ERROR');
        throw error;
      }
    }
  }

  /**
   * Execute transcription for the given mode.
   */
  protected async executeMode(
    mode: TranscriptionMode,
    config: TranscriptionModeOptions
  ): Promise<void> {
    // CRITICAL: Always terminate previous instance safely to prevent zombies
    await this.safeTerminateInstance();

    // Notify status: initializing
    const modeLabel = mode === 'native' ? 'Native Browser' : mode === 'cloud' ? 'Cloud' : 'Private';
    this.onStatusChange?.({ type: 'initializing', message: `Starting ${modeLabel} mode...` });

    // [Option 1: System Integrity]
    // Use the central initializer to ensure instance consistency 
    // and reuse background warmup if available.
    await this.ensureInstanceInitialized(mode);

    try {
      // Optimistic Entry Logic
      if (mode === 'private') {
        logger.info('[TranscriptionService] ⚡ Using Optimistic Entry for Private mode');

        // At this point this.instance!.init() has already been called or is in progress
        const initPromise = this.instance!.init();
        const LOAD_CACHE_TIMEOUT_MS = 2000; /**** ISSUE B: Softened for CI Stability ****/
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('CACHE_MISS')), LOAD_CACHE_TIMEOUT_MS);
        });

        try {
          await Promise.race([initPromise, timeoutPromise]);
          logger.info('[TranscriptionService] ✅ Private model Cache Hit - Instant Start');
        } catch (err: unknown) {
          const error = err as Error;
          if (error.message === 'CACHE_MISS') {
            logger.info('[TranscriptionService] ⏳ Private model Cache Miss - Triggering Background Load + Fallback');
            this.onModelLoadProgress(0);

            initPromise.then(() => {
              logger.info('[TranscriptionService] ✨ Background Private model ready.');
              this.onModelLoadProgress(100);
              this.onReady();
            }).catch(backgroundErr => {
              logger.error({ backgroundErr }, '[TranscriptionService] Background model load failed');
            });
            throw err;
          }
          throw err;
        }
      } else {
        await this.instance!.init();
      }

      await this.instance!.startTranscription(this.mic!);
      this.startTime = Date.now();
      this.mode = mode;
      this.onModeChange?.(this.mode);
      this.transitionTo('RECORDING');
      this.onStatusChange?.({ type: 'ready', message: `Recording active (${modeLabel})` });

      // [Bug Fix] Trigger onReady for all successfully started modes
      // This ensures the UI reflects ready state consistently.
      if (mode !== 'private') {
        this.onReady();
      }

    } catch (error) {
      logger.error({ error, mode }, '[TranscriptionService] execution failed');
      this.transitionTo('ERROR');
      throw error;
    }
  }

  /**
   * Attempt fallback to an alternative mode after failure.
   * 
   * FALLBACK RULES:
   * - Native: No fallback (it's the base tier)
   * - Cloud: Falls back to Native only
   * - Private: Falls back to Native only (internal WebGPU→CPU handled by PrivateSTT)
   * 
   * Cloud and Private are Pro-only features and cannot be fallback targets.
   */
  private async executeFallback(
    failedMode: TranscriptionMode,
    config: TranscriptionModeOptions
  ): Promise<void> {
    // Native is the base tier - no further fallback available
    if (failedMode === 'native') {
      logger.error('[TranscriptionService] ❌ Native mode failed. No fallback available.');
      this.onStatusChange?.({ type: 'error', message: '❌ Native STT failed. No fallback available.' });
      throw new Error('[TranscriptionService] Native mode failed. No fallback available.');
    }

    // Cloud and Private both fall back to Native only
    logger.info({ failedMode, targetMode: 'native' }, '[TranscriptionService] 🔄 Fallback');

    try {
      this.onStatusChange?.({
        type: 'fallback',
        message: `⚠️ Switched to Native Browser mode (${failedMode} unavailable)`,
        newMode: 'native'
      });

      // [Telemetry] Track fallback events
      if (!IS_TEST_ENVIRONMENT) {
        posthog.capture('stt_fallback_triggered', {
          failed_mode: failedMode,
          target_mode: 'native'
        });
      }

      await this.executeMode('native', config);
    } catch (nativeError) {
      logger.error('[TranscriptionService] ❌ Native fallback also failed');
      logger.error({ error: nativeError }, '[TranscriptionService] Native fallback also failed');
      this.onStatusChange?.({ type: 'error', message: '❌ All transcription modes failed' });
      throw new Error('[TranscriptionService] All fallback modes failed');
    }
  }

  /**
   * Check if a mode is allowed by the current policy.
   */
  private isModeAllowedByPolicy(mode: TranscriptionMode): boolean {
    switch (mode) {
      case 'native': return this.policy.allowNative;
      case 'cloud': return this.policy.allowCloud;
      case 'private': return this.policy.allowPrivate;
      default: return false;
    }
  }

  public async stopTranscription(): Promise<{ success: boolean; transcript: string; stats: TranscriptStats } | null> {
    if (this.state !== 'RECORDING' && this.state !== 'STARTING') {
      logger.warn({ currentState: this.state }, '[TranscriptionService] stopTranscription() called while not active');
      return null;
    }

    this.transitionTo('STOPPING');
    logger.info('[TranscriptionService] Stopping transcription.');

    try {
      const finalTranscript = this.instance ? await this.instance.stopTranscription() : '';
      const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

      const stats = calculateTranscriptStats(
        [{ text: finalTranscript }],
        [],
        '',
        duration
      );

      this.transitionTo('READY');
      return {
        success: true,
        transcript: finalTranscript,
        stats
      };
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] stopTranscription failed');
      this.transitionTo('ERROR');
      return { success: false, transcript: '', stats: { transcript: '', total_words: 0, accuracy: 0, duration: 0 } };
    } finally {
      this.startTime = null;
    }
  }

  public async getTranscript(): Promise<string> {
    if (!this.instance) return '';
    return this.instance.getTranscript();
  }

  public getMode(): TranscriptionMode | null {
    return this.mode;
  }

  public async destroy(): Promise<void> {
    if (this.state === 'IDLE') return;

    logger.info({ currentState: this.state }, '[TranscriptionService] Destroying service.');
    this.transitionTo('STOPPING');

    // CRITICAL: Stop microphone IMMEDIATELY to release hardware resources.
    try {
      if (this.mic) {
        this.mic.stop();
        this.mic = null;
        logger.info('[TranscriptionService] Microphone stopped.');
      }
    } catch (error) {
      logger.debug({ error }, '[TranscriptionService] Error stopping mic during destroy');
    }

    // Attempt strict termination if available
    await this.safeTerminateInstance();

    this.transitionTo('IDLE');
  }

  /**
   * Safely terminates the current instance with double-dispose guard.
   * Prevents race conditions where a new instance is created before the old one dies.
   */
  protected async safeTerminateInstance(): Promise<void> {
    if (!this.instance) return;

    // Guard against concurrent terminate calls
    // Guard against concurrent terminate calls
    if (this.isTerminating) {
      logger.warn('[TranscriptionService] Terminate already in progress, waiting...');

      // Retry loop: wait up to 2000ms (conservative for slow devices)
      let retries = 40; // 40 * 50ms = 2000ms
      while (this.isTerminating && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 50));
        retries--;
      }

      if (this.isTerminating) {
        logger.warn('[TranscriptionService] Timeout waiting for concurrent termination. Proceeding forcibly.');
      }
    }

    this.isTerminating = true;

    try {
      const instanceToTerminate = this.instance;
      // CRITICAL: Immediately null out to prevent use-after-free or zombie usage
      this.instance = null;

      logger.info('[TranscriptionService] Terminating active instance...');

      if (typeof instanceToTerminate.terminate === 'function') {
        await instanceToTerminate.terminate();
      } else {
        await instanceToTerminate.stopTranscription();
      }
      logger.info('[TranscriptionService] Instance terminated successfully.');
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] Error cleaning up instance');
    } finally {
      this.isTerminating = false;
    }
  }
}
