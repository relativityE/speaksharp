import logger from '../../lib/logger';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { ITranscriptionMode, TranscriptionModeOptions } from './modes/types';
import { MicStream } from './utils/types';
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

// Extend Window interface for E2E mocks
declare global {
  interface Window {
    MockPrivateWhisper?: new (config: TranscriptionModeOptions) => ITranscriptionMode;
    __E2E_MOCK_LOCAL_WHISPER__?: boolean;
  }
}

export default class TranscriptionService {
  private static privateInitFailures = 0;
  private mode: TranscriptionMode | null = null;
  // ... existing private properties ...
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress: (progress: number | null) => void;
  private onReady: () => void;
  private onModeChange?: (mode: TranscriptionMode | null) => void;
  private onStatusChange?: (status: SttStatus) => void;
  private onAudioData?: (data: Float32Array) => void;
  private session: Session | null;
  private navigate: NavigateFunction;
  private getAssemblyAIToken: () => Promise<string | null>;
  private customVocabulary: string[];
  private policy: TranscriptionPolicy;
  private mockMic: MicStream | null;
  private instance: ITranscriptionMode | null = null;
  private mic: MicStream | null = null;

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
    this.policy = policy;
    this.mockMic = mockMic ?? null;
    this.onAudioData = onAudioData;
  }

  /**
   * Resets the static failure count.
   * STRICTLY FOR TESTING PURPOSES ONLY.
   */
  public static resetFailureCount(): void {
    TranscriptionService.privateInitFailures = 0;
  }

  private micError: Error | null = null;

  public async init(): Promise<{ success: boolean }> {
    // If a mock mic was injected (for E2E), use it directly
    if (this.mockMic) {
      logger.info('[TranscriptionService] Using injected mock microphone');
      this.mic = this.mockMic;
      return { success: true };
    }

    console.log('[TranscriptionService] Initializing mic stream...');
    try {
      this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
      console.log('[TranscriptionService] Mic stream created.');
      this.micError = null;
      return { success: true };
    } catch (error) {
      console.error('[TranscriptionService] Failed to initialize mic:', error);
      // Sentry.captureException(error, ...); // Optional: keep or remove noise

      // CRITICAL CHANGE: Don't throw yet. Store error and allow "native" mode to try.
      this.micError = error instanceof Error ? error : new Error(String(error));

      // Return success=false but don't explode.
      // The calling hook should check this check, or we handle it in startTranscription.
      return { success: false };
    }
  }

  public async startTranscription(): Promise<void> {
    console.log('[TranscriptionService] Attempting to start transcription...');

    // Resolve the mode using the injected policy
    let resolvedMode = resolveMode(this.policy);
    console.log(`[TranscriptionService] 🎯 Mode resolved: ${resolvedMode} (policy: ${this.policy.executionIntent})`);

    // CHECK MICROPHONE REQUIREMENT MOVED INSIDE TRY/CATCH


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
        // Propagate error to status change or main error handler if needed
        // For now, we can log it or let specific modes handle it.
        // Actually, useTranscriptionService doesn't pass onError in init options yet, 
        // but we can at least log it or map it to status.
        console.error('[TranscriptionService] Error from mode:', err);
        this.onStatusChange?.({ type: 'error', message: err.message });
      }
    };

    // CHECK MAX ATTEMPTS FOR PRIVATE MODE
    if (resolvedMode === 'private' && TranscriptionService.privateInitFailures >= STT_CONFIG.MAX_PRIVATE_ATTEMPTS) {
      console.warn(`[TranscriptionService] ⚠️ Max Private STT attempts (${STT_CONFIG.MAX_PRIVATE_ATTEMPTS}) reached. Forcing Native.`);

      this.onStatusChange?.({
        type: 'fallback',
        message: '⚠️ Too many failures. Switched to Native STT.',
        newMode: 'native'
      });

      resolvedMode = 'native';
    }

    logger.info(
      { resolvedMode, policy: this.policy.executionIntent },
      `[TranscriptionService] Resolved mode: ${resolvedMode}`
    );

    try {
      // CHECK MICROPHONE REQUIREMENT
      // Native mode does NOT need our custom mic stream (it uses browser native API)
      // Cloud and Private DO need it.
      if (resolvedMode !== 'native') {
        if (this.micError) {
          console.error('[TranscriptionService] Blocking start: Mic initialization failed previously.');
          throw this.micError;
        }
        if (!this.mic) {
          console.error('[TranscriptionService] Microphone not initialized.');
          throw new Error("Microphone not initialized. Call init() first.");
        }
      }

      await this.executeMode(resolvedMode, providerConfig);
    } catch (error) {
      // TRACK FAILURE
      if (resolvedMode === 'private') {
        TranscriptionService.privateInitFailures++;
        console.warn(`[TranscriptionService] Private mode failed. Failure count: ${TranscriptionService.privateInitFailures}`);
      }

      // If fallback is allowed, try alternatives
      if (this.policy.allowFallback) {
        console.warn(`[TranscriptionService] ⚠️ ${resolvedMode} failed, attempting fallback...`);
        logger.warn({ error }, `[TranscriptionService] ${resolvedMode} failed, attempting fallback`);
        await this.executeFallback(resolvedMode, providerConfig);
      } else {
        throw error;
      }
    }
  }

  /**
   * Execute transcription for the given mode.
   */
  private async executeMode(
    mode: TranscriptionMode,
    config: TranscriptionModeOptions
  ): Promise<void> {
    // Notify status: initializing
    const modeLabel = mode === 'native' ? 'Native Browser' : mode === 'cloud' ? 'Cloud' : 'Private';
    this.onStatusChange?.({ type: 'initializing', message: `Starting ${modeLabel} mode...` });

    switch (mode) {
      case 'native':
        console.log('[TranscriptionService] 🌐 Starting Native Browser mode');
        logger.info('[TranscriptionService] Starting Native Browser mode');
        this.instance = new NativeBrowser(config);
        break;

      case 'cloud':
        console.log('[TranscriptionService] ☁️ Starting Cloud (AssemblyAI) mode');
        logger.info('[TranscriptionService] Starting Cloud (AssemblyAI) mode');
        this.instance = new CloudAssemblyAI(config);
        break;

      case 'private': {
        console.log('[TranscriptionService] 🔒 Starting Private (Whisper) mode');
        logger.info('[TranscriptionService] Starting Private (Whisper) mode');
        // Check for E2E mock override (Must be explicitly enabled)
        if (window.MockPrivateWhisper && window.__E2E_MOCK_LOCAL_WHISPER__ === true) {
          console.log('[TranscriptionService] 🧪 Using MockPrivateWhisper for E2E');
          this.instance = new window.MockPrivateWhisper(config);
          break;
        }
        const module = await import('./modes/PrivateWhisper');
        this.instance = new module.default(config);
        break;
      }

      default:
        throw new Error(`Unknown transcription mode: ${mode}`);
    }

    await this.instance.init();
    await this.instance.startTranscription(this.mic!);
    this.mode = mode;
    this.onModeChange?.(this.mode);
    // Notify status: ready
    this.onStatusChange?.({ type: 'ready', message: `Recording active (${modeLabel})` });
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
    this.onModelLoadProgress(null); // Clear any loading state

    // Native is the base tier - no further fallback available
    if (failedMode === 'native') {
      console.error('[TranscriptionService] ❌ Native mode failed. No fallback available.');
      this.onStatusChange?.({ type: 'error', message: '❌ Native STT failed. No fallback available.' });
      throw new Error('[TranscriptionService] Native mode failed. No fallback available.');
    }

    // Cloud and Private both fall back to Native only
    console.log(`[TranscriptionService] 🔄 Fallback: ${failedMode} → native`);
    logger.info(`[TranscriptionService] Attempting fallback to native`);

    try {
      this.onStatusChange?.({
        type: 'fallback',
        message: `⚠️ Switched to Native Browser mode (${failedMode} unavailable)`,
        newMode: 'native'
      });
      await this.executeMode('native', config);
    } catch (nativeError) {
      console.error('[TranscriptionService] ❌ Native fallback also failed');
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

  public async stopTranscription(): Promise<string> {
    logger.info('[TranscriptionService] Stopping transcription.');
    if (!this.instance) return '';
    const result = await this.instance.stopTranscription();
    return result;
  }

  public async getTranscript(): Promise<string> {
    if (!this.instance) return '';
    return this.instance.getTranscript();
  }

  public getMode(): TranscriptionMode | null {
    return this.mode;
  }

  public async destroy(): Promise<void> {
    const start = performance.now();
    logger.info('[TranscriptionService] [DEBUG-TIMING] Destroying service START.');

    // CRITICAL: Stop microphone IMMEDIATELY to release hardware resources.
    // Waiting for instance.terminate() (which might be async/slow) causes a race condition
    // where the new service tries to acquire the mic while the old one is still holding it.
    try {
      if (this.mic) {
        this.mic.stop();
        this.mic = null;
        logger.info('[TranscriptionService] Microphone stopped immediately.');
      }
    } catch (error) {
      logger.debug({ error }, '[TranscriptionService] Error stopping mic during destroy');
    }

    // Attempt strict termination first if available (for Private STT worker cleanup)
    if (this.instance && typeof this.instance.terminate === 'function') {
      try {
        await this.instance.terminate();
        logger.info(`[TranscriptionService] [DEBUG-TIMING] Terminate completed in ${performance.now() - start}ms`);
      } catch (error) {
        logger.error({ error }, '[TranscriptionService] Error terminating instance');
      }
    } else {
      // Fallback to standard stop
      try {
        await this.stopTranscription();
        logger.info(`[TranscriptionService] [DEBUG-TIMING] StopTranscription completed in ${performance.now() - start}ms`);
      } catch (error) {
        logger.debug({ error }, '[TranscriptionService] Error stopping transcription during destroy');
      }
    }

    this.instance = null;
  }
}
