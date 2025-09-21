import logger from '../../lib/logger';
import CloudAssemblyAI from './modes/CloudAssemblyAI';
import NativeBrowser from './modes/NativeBrowser';
import LocalWhisper from './modes/LocalWhisper';
import { createMicStream } from './utils/audioUtils';
import { UserProfile } from '../../types/user';
import { Session } from '@supabase/supabase-js';
import { NavigateFunction } from 'react-router-dom';
import { ITranscriptionMode, TranscriptionModeOptions } from './modes/types';
import { MicStream } from './utils/types';

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
    this.forceCloud = forceCloud;
    this.forceOnDevice = forceOnDevice;
    this.forceNative = forceNative;
  }

  public async init(): Promise<{ success: boolean }> {
    logger.info('[TranscriptionService] Initializing mic stream...');
    try {
      this.mic = await createMicStream({ sampleRate: 16000, frameSize: 1024 });
      logger.info('[TranscriptionService] Mic stream created.');
      return { success: true };
    } catch (error) {
      logger.error({ error }, '[TranscriptionService] Failed to initialize mic.');
      throw error;
    }
  }

  public async startTranscription(): Promise<void> {
    logger.info('[TranscriptionService] Attempting to start transcription...');
    if (!this.mic) {
      throw new Error("Microphone not initialized. Call init() first.");
    }

    const providerConfig: TranscriptionModeOptions = {
      onTranscriptUpdate: this.onTranscriptUpdate,
      onModelLoadProgress: this.onModelLoadProgress,
      onReady: this.onReady,
      session: this.session,
      navigate: this.navigate,
      getAssemblyAIToken: this.getAssemblyAIToken,
    };

    if (this.forceNative) {
      logger.info('[TranscriptionService] Dev Toggle: Forcing Native Browser mode.');
      this.instance = new NativeBrowser(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'native';
      return;
    }

    // --- Provider Selection Logic ---
    const isPro = this.profile?.subscription_status === 'pro';

    // Pro users can prefer on-device mode. Also allow forcing for dev.
    const useOnDevice = this.forceOnDevice || (isPro && this.profile?.preferred_mode === 'on-device');

    if (useOnDevice) {
      logger.info('[TranscriptionService] Attempting to use On-Device (LocalWhisper) mode for Pro user.');
      this.instance = new LocalWhisper(providerConfig);
      await this.instance.init();
      await this.instance.startTranscription(this.mic);
      this.mode = 'on-device';
      return;
    }

    // Pro users who don't prefer on-device get Cloud AI. Also allow forcing for dev.
    const useCloud = this.forceCloud || isPro;

    if (useCloud) {
        logger.info('[TranscriptionService] Attempting to use Cloud (AssemblyAI) mode for Pro user.');
        const token = await this.getAssemblyAIToken();
        if (token) {
            this.instance = new CloudAssemblyAI(providerConfig);
            await this.instance.init();
            await this.instance.startTranscription(this.mic);
            this.mode = 'cloud';
            return;
        } else {
            logger.warn('[TranscriptionService] Failed to get AssemblyAI token for Pro user.');
            if (this.forceCloud) {
                throw new Error('Failed to get AssemblyAI token in forceCloud mode.');
            }
            logger.warn('[TranscriptionService] Proceeding with native fallback for Pro user.');
        }
    }

    // Default/fallback for free users or Pro users where cloud failed
    logger.info('[TranscriptionService] Starting Native Browser mode as default or fallback.');
    this.instance = new NativeBrowser(providerConfig);
    await this.instance.init();
    await this.instance.startTranscription(this.mic);
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
    try { await this.stopTranscription(); } catch { /* best effort */ }
    try {
      this.mic?.stop();
      logger.info('[TranscriptionService] Mic stream stopped.');
    } catch { /* best effort */ }
    this.instance = null;
    this.mic = null;
    logger.info('[TranscriptionService] Service destroyed.');
  }
}
