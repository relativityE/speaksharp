import logger from '../../lib/logger';
import * as Sentry from '@sentry/react';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import { createMicStream } from './utils/audioUtils';
import { UserProfile } from '../../types/user';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { ITranscriptionMode, TranscriptionModeOptions } from './modes/types';
import { MicStream } from './utils/types';
import { isPro } from '@/constants/subscriptionTiers';
import { getTestConfig } from '@/config/test.config';

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
  profile: UserProfile | null;
  session: Session | null;
  navigate: NavigateFunction;
  getAssemblyAIToken: () => Promise<string | null>;
  customVocabulary?: string[];
  forceCloud?: boolean;
  forcePrivate?: boolean;
  forceNative?: boolean;
  onModeChange?: (mode: 'native' | 'cloud' | 'private' | null) => void;
}

export default class TranscriptionService {
  private mode: 'native' | 'cloud' | 'private' | null = null;
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress: (progress: number | null) => void;
  private onReady: () => void;
  private onModeChange?: (mode: 'native' | 'cloud' | 'private' | null) => void;
  private profile: UserProfile | null;
  private session: Session | null;
  private navigate: NavigateFunction;
  private getAssemblyAIToken: () => Promise<string | null>;
  private forceCloud: boolean;
  private forcePrivate: boolean;
  private forceNative: boolean;
  private customVocabulary: string[];
  private instance: ITranscriptionMode | null = null;
  private mic: MicStream | null = null;

  constructor({
    onTranscriptUpdate,
    onModelLoadProgress,
    onReady,
    profile,
    forceCloud = false,
    forcePrivate = false,
    forceNative = false,
    customVocabulary = [],
    session,
    navigate,
    getAssemblyAIToken,
    onModeChange,
  }: TranscriptionServiceOptions) {
    logger.info({ forceCloud, forcePrivate, forceNative }, `[TranscriptionService] Constructor called`);
    console.log('[TranscriptionService] Constructor options:', { forceCloud, forcePrivate, forceNative });
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.onModeChange = onModeChange;
    this.profile = profile;
    this.session = session;
    this.navigate = navigate;
    this.getAssemblyAIToken = getAssemblyAIToken;
    this.customVocabulary = customVocabulary;
    this.forceCloud = forceCloud;
    this.forcePrivate = forcePrivate;
    this.forceNative = forceNative;
  }

  public async init(): Promise<{ success: boolean }> {
    const { mockSession } = getTestConfig();
    if (mockSession) {
      this.mic = {
        stop: () => { },
      } as unknown as MicStream;
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

    const { isTestMode, useMockPrivateWhisper } = getTestConfig();

    if (isTestMode && !useMockPrivateWhisper && !this.forcePrivate) {
      logger.info('[TEST_MODE] Forcing Native Browser mode.');
      this.instance = new NativeBrowser(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'native';
      this.onModeChange?.(this.mode);
      return;
    }

    if (this.forceNative) {
      logger.info('[TranscriptionService] Creating NativeBrowser instance (forceNative)...');
      this.instance = new NativeBrowser(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'native';
      this.onModeChange?.(this.mode);
      return;
    }

    const isProUser = isPro(this.profile?.subscription_status);
    const usePrivate = this.forcePrivate || (isProUser && this.profile?.preferred_mode === 'private');

    console.log('[TranscriptionService] Decision logic:', { isProUser, usePrivate, forcePrivate: this.forcePrivate, preferred_mode: this.profile?.preferred_mode });

    if (usePrivate) {
      console.log('[TranscriptionService] Entering Private block');
      logger.info('[TranscriptionService] Attempting to use Private (PrivateWhisper) mode for Pro user.');

      let PrivateWhisperClass;
      if (useMockPrivateWhisper) {
        PrivateWhisperClass = (window as Window & { MockPrivateWhisper?: typeof import('./modes/PrivateWhisper').default }).MockPrivateWhisper;
        if (!PrivateWhisperClass) {
          throw new Error('MockPrivateWhisper not found on window - E2E test setup incomplete');
        }
      } else {
        const module = await import('./modes/PrivateWhisper');
        PrivateWhisperClass = module.default;
      }

      try {
        this.instance = new PrivateWhisperClass(providerConfig);
        if (this.instance) {
          await this.instance.init();
          await this.instance.startTranscription(this.mic);
        }
        this.mode = 'private';
        this.onModeChange?.(this.mode);
        return;
      } catch (error) {
        logger.warn({ error }, '[TranscriptionService] Private init failed, falling back to Native Browser.');
        this.onModelLoadProgress(null);

        this.instance = new NativeBrowser(providerConfig);
        try {
          await this.instance.init();
          await this.instance.startTranscription(this.mic);
          this.mode = 'native';
          this.onModeChange?.(this.mode);
          return;
        } catch (fallbackError) {
          logger.error({ error: fallbackError }, '[TranscriptionService] Native fallback also failed.');
          throw fallbackError;
        }
      }
    }

    const useCloud = this.forceCloud || isProUser;
    if (useCloud) {
      logger.info('[TranscriptionService] Attempting to use Cloud (AssemblyAI) mode for Pro user.');
      this.instance = new CloudAssemblyAI(providerConfig);
      try {
        await this.instance.init();
        await this.instance.startTranscription(this.mic);
        this.mode = 'cloud';
        this.onModeChange?.(this.mode);
        return;
      } catch (error) {
        logger.warn({ error }, '[TranscriptionService] Cloud mode failed to start.');
        if (this.forceCloud) throw error;
        logger.warn('[TranscriptionService] Proceeding with native fallback for Pro user.');
      }
    }

    logger.info('[TranscriptionService] Starting Native Browser mode as default or fallback.');
    this.instance = new NativeBrowser(providerConfig);
    await this.instance.init();
    await this.instance.startTranscription(this.mic);
    this.mode = 'native';
    this.onModeChange?.(this.mode);
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

  public getMode(): 'native' | 'cloud' | 'private' | null {
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
