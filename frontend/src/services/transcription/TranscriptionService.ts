import logger from '../../lib/logger';
import * as Sentry from '@sentry/react';
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
}

export default class TranscriptionService {
  private mode: TranscriptionMode | null = null;
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress: (progress: number | null) => void;
  private onReady: () => void;
  private onModeChange?: (mode: TranscriptionMode | null) => void;
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
  }: TranscriptionServiceOptions) {
    logger.info(
      { policy: policy.executionIntent },
      `[TranscriptionService] Constructor called with policy: ${policy.executionIntent}`
    );
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.onModeChange = onModeChange;
    this.session = session;
    this.navigate = navigate;
    this.getAssemblyAIToken = getAssemblyAIToken;
    this.customVocabulary = customVocabulary;
    this.policy = policy;
    this.mockMic = mockMic ?? null;
  }

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
      return { success: true };
    } catch (error) {
      console.error('[TranscriptionService] Failed to initialize mic:', error);
      Sentry.captureException(error, { tags: { component: 'TranscriptionService', method: 'init' } });
      throw error;
    }
  }

  public async startTranscription(): Promise<void> {
    console.log('[TranscriptionService] Attempting to start transcription...');
    if (!this.mic) {
      console.error('[TranscriptionService] Microphone not initialized.');
      throw new Error("Microphone not initialized. Call init() first.");
    }

    const providerConfig: TranscriptionModeOptions = {
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: this.onModelLoadProgress,
      onReady: this.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
      customVocabulary: this.customVocabulary,
    };

    // Resolve the mode using the injected policy
    const resolvedMode = resolveMode(this.policy);
    logger.info(
      { resolvedMode, policy: this.policy.executionIntent },
      `[TranscriptionService] Resolved mode: ${resolvedMode}`
    );

    try {
      await this.executeMode(resolvedMode, providerConfig);
    } catch (error) {
      // If fallback is allowed, try alternatives
      if (this.policy.allowFallback) {
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
    switch (mode) {
      case 'native':
        logger.info('[TranscriptionService] Starting Native Browser mode');
        this.instance = new NativeBrowser(config);
        break;

      case 'cloud':
        logger.info('[TranscriptionService] Starting Cloud (AssemblyAI) mode');
        this.instance = new CloudAssemblyAI(config);
        break;

      case 'private': {
        logger.info('[TranscriptionService] Starting Private (Whisper) mode');
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
  }

  /**
   * Attempt fallback to an alternative mode after failure.
   */
  private async executeFallback(
    failedMode: TranscriptionMode,
    config: TranscriptionModeOptions
  ): Promise<void> {
    this.onModelLoadProgress(null); // Clear any loading state

    // Fallback priority: native is always safest
    const fallbackOrder: TranscriptionMode[] = ['native', 'cloud', 'private'];

    for (const fallbackMode of fallbackOrder) {
      if (fallbackMode === failedMode) continue; // Skip the mode that failed
      if (!this.isModeAllowedByPolicy(fallbackMode)) continue; // Skip disallowed modes

      try {
        logger.info(`[TranscriptionService] Attempting fallback to ${fallbackMode}`);
        await this.executeMode(fallbackMode, config);
        return;
      } catch (fallbackError) {
        logger.warn({ error: fallbackError }, `[TranscriptionService] Fallback ${fallbackMode} also failed`);
      }
    }

    throw new Error('[TranscriptionService] All fallback modes failed');
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
    logger.info('[TranscriptionService] Destroying service.');
    try {
      await this.stopTranscription();
    } catch (error) {
      logger.debug({ error }, '[TranscriptionService] Error stopping transcription during destroy');
    }
    try {
      this.mic?.stop();
    } catch (error) {
      logger.debug({ error }, '[TranscriptionService] Error stopping mic during destroy');
    }
    this.instance = null;
    this.mic = null;
  }
}
