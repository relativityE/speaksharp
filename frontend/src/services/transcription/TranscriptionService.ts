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
  onModelLoadProgress: (progress: number) => void;
  onReady: () => void;
  profile: UserProfile | null;
  session: Session | null;
  navigate: NavigateFunction;
  getAssemblyAIToken: () => Promise<string | null>;
  customVocabulary?: string[];
  forceCloud?: boolean;
  forceOnDevice?: boolean;
  forceNative?: boolean;
}

export default class TranscriptionService {
  private mode: 'native' | 'cloud' | 'on-device' | null = null;
  private onTranscriptUpdate: (update: TranscriptUpdate) => void;
  private onModelLoadProgress: (progress: number) => void;
  private onReady: () => void;
  private profile: UserProfile | null;
  private session: Session | null;
  private navigate: NavigateFunction;
  private getAssemblyAIToken: () => Promise<string | null>;
  private forceCloud: boolean;
  private forceOnDevice: boolean;
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
    forceOnDevice = false,
    forceNative = false,
    customVocabulary = [],
    session,
    navigate,
    getAssemblyAIToken,
  }: TranscriptionServiceOptions) {
    logger.info({ forceCloud, forceOnDevice, forceNative }, `[TranscriptionService] Constructor called`);
    this.onTranscriptUpdate = onTranscriptUpdate;
    this.onModelLoadProgress = onModelLoadProgress;
    this.onReady = onReady;
    this.profile = profile;
    this.session = session;
    this.navigate = navigate;
    this.getAssemblyAIToken = getAssemblyAIToken;
    this.customVocabulary = customVocabulary;
    this.forceCloud = forceCloud;
    this.forceOnDevice = forceOnDevice;
    this.forceNative = forceNative;
  }

  public async init(): Promise<{ success: boolean }> {
    // In E2E test mode, we skip microphone initialization
    // Uses centralized test config instead of direct window access (Gap Analysis fix)
    const { mockSession } = getTestConfig();
    if (mockSession) {
      // Initialize a dummy mic object to satisfy checks
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

    // --- Provider Selection Logic ---

    // CRITICAL FIX: In test mode, ALWAYS fall back to NativeBrowser
    // to prevent silent crashes from the onnxruntime-web library.
    // This MUST be the first check to prevent the dynamic import below.
    // EXCEPTION: If useMockOnDeviceWhisper is set, we allow OnDeviceWhisper (mocked) to proceed.
    // Uses centralized test config instead of direct window access (Gap Analysis fix)
    const { isTestMode, useMockOnDeviceWhisper } = getTestConfig();

    if (isTestMode && !useMockOnDeviceWhisper) {
      logger.info('[TEST_MODE] Forcing Native Browser mode.');
      this.instance = new NativeBrowser(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'native';
      return;
    }

    if (this.forceNative) {
      logger.info('[TranscriptionService] Dev Toggle: Forcing Native Browser mode.');
      logger.info('[TranscriptionService] Creating NativeBrowser instance (forceNative)...');
      this.instance = new NativeBrowser(providerConfig);
      logger.info('[TranscriptionService] Initializing NativeBrowser (forceNative)...');
      await this.instance.init();
      logger.info('[TranscriptionService] Starting NativeBrowser transcription (forceNative)...');
      await this.instance.startTranscription(this.mic);
      logger.info('[TranscriptionService] NativeBrowser started successfully (forceNative).');
      this.mode = 'native';
      return;
    }

    const isProUser = isPro(this.profile?.subscription_status);
    const useOnDevice = this.forceOnDevice || (isProUser && this.profile?.preferred_mode === 'on-device');

    if (useOnDevice) {
      logger.info('[TranscriptionService] Attempting to use Private (PrivateWhisper) mode for Pro user.');

      let PrivateWhisperClass;
      if (useMockOnDeviceWhisper) {
        logger.info('[TranscriptionService] Using MockPrivateWhisper for E2E test.');
        PrivateWhisperClass = (window as Window & { MockPrivateWhisper?: typeof import('./modes/PrivateWhisper').default }).MockPrivateWhisper;
        if (!PrivateWhisperClass) {
          throw new Error('MockPrivateWhisper not found on window - E2E test setup incomplete');
        }
      } else {
        // Dynamic import to avoid loading whisper-turbo on initial load
        const module = await import('./modes/PrivateWhisper');
        PrivateWhisperClass = module.default;
      }

      try {
        this.instance = new PrivateWhisperClass(providerConfig);
        if (this.instance) {
          await this.instance.init();
          await this.instance.startTranscription(this.mic);
        }
        this.mode = 'on-device';
        return;
      } catch (error) {
        logger.warn({ error }, '[TranscriptionService] Private init failed, falling back to Native Browser.');
        // Fallback to Native Browser
        this.instance = new NativeBrowser(providerConfig);
        await this.instance.startTranscription(this.mic);
        logger.info('[TranscriptionService] NativeBrowser started successfully (Private fallback).');
        this.mode = 'native';
        return;
      }
    }

    const useCloud = this.forceCloud || isProUser;
    if (useCloud) {
      logger.info('[TranscriptionService] Attempting to use Cloud (AssemblyAI) mode for Pro user.');
      // Note: CloudAssemblyAI handles token fetching internally in startTranscription()
      // We don't pre-fetch here to avoid triggering the rate limiter twice
      logger.info('[TranscriptionService] Creating CloudAssemblyAI instance...');
      this.instance = new CloudAssemblyAI(providerConfig);
      logger.info('[TranscriptionService] Initializing CloudAssemblyAI...');
      await this.instance.init();
      logger.info('[TranscriptionService] Starting CloudAssemblyAI transcription...');
      try {
        await this.instance.startTranscription(this.mic);
        logger.info('[TranscriptionService] CloudAssemblyAI transcription started successfully.');
        this.mode = 'cloud';
        return;
      } catch (error) {
        logger.warn({ error }, '[TranscriptionService] Cloud mode failed to start.');
        if (this.forceCloud) {
          throw error; // Re-throw if forced
        }
        logger.warn('[TranscriptionService] Proceeding with native fallback for Pro user.');
      }
    }

    logger.info('[TranscriptionService] Starting Native Browser mode as default or fallback.');
    logger.info('[TranscriptionService] Creating NativeBrowser instance...');
    this.instance = new NativeBrowser(providerConfig);
    logger.info('[TranscriptionService] Initializing NativeBrowser...');
    await this.instance.init();
    logger.info('[TranscriptionService] Starting NativeBrowser transcription...');
    await this.instance.startTranscription(this.mic);
    logger.info('[TranscriptionService] NativeBrowser transcription started successfully.');
    this.mode = 'native';
  }

  public async stopTranscription(): Promise<string> {
    logger.info('[TranscriptionService] Stopping transcription.');
    if (!this.instance) {
      logger.warn('[TranscriptionService] No instance to stop.');
      return '';
    }
    const result = await this.instance.stopTranscription();
    logger.info('[TranscriptionService] Transcription stopped.');
    return result;
  }

  public async getTranscript(): Promise<string> {
    if (!this.instance) return '';
    return this.instance.getTranscript();
  }

  public getMode(): 'native' | 'cloud' | 'on-device' | null {
    return this.mode;
  }

  public async destroy(): Promise<void> {
    logger.info('[TranscriptionService] Destroying service.');
    try {
      await this.stopTranscription();
    } catch (error) {
      // Best effort - service is being destroyed anyway
      logger.debug({ error }, '[TranscriptionService] Error stopping transcription during destroy');
    }
    try {
      this.mic?.stop();
      logger.info('[TranscriptionService] Mic stream stopped.');
    } catch (error) {
      // Best effort - mic cleanup failure is non-critical during destroy
      logger.debug({ error }, '[TranscriptionService] Error stopping mic during destroy');
    }
    this.instance = null;
    this.mic = null;
    logger.info('[TranscriptionService] Service destroyed.');
  }
}
